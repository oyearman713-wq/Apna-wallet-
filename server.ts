import "dotenv/config";
import crypto from "crypto";
import express from "express";
import type { NextFunction, Request, Response } from "express";
import http from "http";
import path from "path";
import { createServer as createViteServer } from "vite";
import { WebSocketServer } from "ws";
import { db, seedDefaultUserData, writeAuditLog } from "./server/db.ts";
import { attachLiveStudioWebSocket, runNanoBananaEdit } from "./server/gemini.ts";
import { dispatchOtpSms } from "./server/providers/sms.ts";
import {
  executeUpiPaymentViaPsp,
  getProviderComplianceStatus,
  signWebhookPayload,
  verifyVpaWithPsp,
  verifyWebhookSignature,
} from "./server/providers/upi.ts";
import {
  assessTransactionRisk,
  createRateLimiter,
  generateSecureOtp,
  generateSessionToken,
  hashOtp,
  hashToken,
  isValidUpiVpa,
  normalizeIndianPhone,
  parseValidPaise,
  rejectRawUpiPinMiddleware,
  timingSafeEqualHex,
} from "./server/security.ts";

interface AuthenticatedUser {
  id: string;
  phone: string;
  full_name: string;
  email: string | null;
  vpa: string;
  kyc_status: string;
  kyc_pan_last4: string | null;
  wallet_balance_paise: number;
  environment_mode: string;
  biometric_credential_id: string | null;
  biometric_device_label: string | null;
  daily_limit_paise: number;
  created_at: string;
}

interface AuthedRequest extends Request {
  user?: AuthenticatedUser;
  sessionTokenHash?: string;
  deviceId?: string;
  rawBody?: string;
}

function formatUserResponse(u: AuthenticatedUser) {
  return {
    id: u.id,
    phone: u.phone,
    fullName: u.full_name,
    email: u.email,
    vpa: u.vpa,
    kycStatus: u.kyc_status,
    kycPanLast4: u.kyc_pan_last4,
    walletBalancePaise: u.wallet_balance_paise,
    environmentMode: u.environment_mode,
    biometricEnabled: Boolean(u.biometric_credential_id),
    biometricDeviceLabel: u.biometric_device_label,
    dailyLimitPaise: u.daily_limit_paise,
    createdAt: u.created_at,
  };
}

function authenticateToken(rawToken: string): {
  user: AuthenticatedUser;
  tokenHash: string;
  deviceId: string;
} | null {
  const tokenHash = hashToken(rawToken);
  const session = db
    .prepare(
      `SELECT token_hash, user_id, device_id, expires_at, revoked_at
       FROM sessions
       WHERE token_hash = ?`
    )
    .get(tokenHash) as
    | {
        token_hash: string;
        user_id: string;
        device_id: string;
        expires_at: number;
        revoked_at: number | null;
      }
    | undefined;

  if (!session || session.revoked_at !== null || session.expires_at <= Date.now()) {
    return null;
  }

  const user = db
    .prepare("SELECT * FROM users WHERE id = ?")
    .get(session.user_id) as AuthenticatedUser | undefined;

  if (!user) return null;
  return { user, tokenHash, deviceId: session.device_id };
}

function requireAuth(req: AuthedRequest, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    res.status(401).json({ error: "Authentication required." });
    return;
  }
  const rawToken = authHeader.slice(7).trim();
  const resolved = authenticateToken(rawToken);
  if (!resolved) {
    res.status(401).json({ error: "Session expired or invalid. Please sign in again." });
    return;
  }
  req.user = resolved.user;
  req.sessionTokenHash = resolved.tokenHash;
  req.deviceId = resolved.deviceId;
  next();
}

async function startServer() {
  const app = express();
  app.set("trust proxy", true);

  app.use(
    express.json({
      limit: "10mb",
      verify: (req, _res, buf) => {
        (req as AuthedRequest).rawBody = buf.toString("utf8");
      },
    })
  );

  // Security headers
  app.use((_req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    next();
  });

  const apiLimiter = createRateLimiter({
    windowMs: 60_000,
    maxRequests: 150,
    keyPrefix: "api",
  });
  const otpLimiter = createRateLimiter({
    windowMs: 60_000,
    maxRequests: 6,
    keyPrefix: "otp",
    keyExtractor: (req) => `${req.ip}:${String((req.body as { phone?: string })?.phone || "")}`,
  });
  const paymentLimiter = createRateLimiter({
    windowMs: 60_000,
    maxRequests: 25,
    keyPrefix: "pay",
    keyExtractor: (req) => (req as AuthedRequest).user?.id || req.ip || "anon",
  });

  app.use("/api", apiLimiter);

  // Health & Compliance
  app.get("/api/health", (_req, res) => {
    res.json({ ok: true, timestamp: new Date().toISOString() });
  });

  app.get("/api/compliance", (_req, res) => {
    res.json(getProviderComplianceStatus());
  });

  // 1. User Registration & Login (OTP)
  app.post("/api/auth/request-otp", otpLimiter, async (req, res) => {
    try {
      const { phone } = req.body as { phone?: string };
      const normalized = typeof phone === "string" ? normalizeIndianPhone(phone) : null;
      if (!normalized) {
        res.status(400).json({
          error: "Enter a valid 10-digit Indian mobile number (+91).",
        });
        return;
      }

      const otp = generateSecureOtp();
      const otpHash = hashOtp(normalized, otp);
      const challengeId = `OTP-${crypto.randomUUID().slice(0, 12).toUpperCase()}`;
      const expiresAt = Date.now() + 5 * 60_000;

      const smsResult = await dispatchOtpSms(normalized, otp);

      db.prepare(
        `INSERT INTO otp_challenges (id, phone, otp_hash, provider, provider_message_id, attempts, expires_at, created_at)
         VALUES (?, ?, ?, ?, ?, 0, ?, ?)`
      ).run(
        challengeId,
        normalized,
        otpHash,
        smsResult.provider,
        smsResult.providerMessageId,
        expiresAt,
        new Date().toISOString()
      );

      writeAuditLog({
        eventType: "AUTH_OTP_REQUESTED",
        actorIp: req.ip,
        details: { phone: normalized, provider: smsResult.provider, challengeId },
      });

      const existingUser = db
        .prepare("SELECT id, full_name FROM users WHERE phone = ?")
        .get(normalized) as { id: string; full_name: string } | undefined;

      res.json({
        challengeId,
        phone: normalized,
        isExistingUser: Boolean(existingUser),
        existingName: existingUser?.full_name || null,
        provider: smsResult.provider,
        notice: smsResult.notice,
        expiresInSeconds: 300,
        // Only populated in sandbox SMS mode when real carrier keys are not set
        sandboxOtpPreview: smsResult.sandboxOtpPreview,
      });
    } catch (err) {
      res.status(502).json({
        error: err instanceof Error ? err.message : "Failed to dispatch OTP.",
      });
    }
  });

  app.post("/api/auth/verify-otp", otpLimiter, (req, res) => {
    const { challengeId, phone, otp, fullName, deviceLabel } = req.body as {
      challengeId?: string;
      phone?: string;
      otp?: string;
      fullName?: string;
      deviceLabel?: string;
    };

    const normalized = typeof phone === "string" ? normalizeIndianPhone(phone) : null;
    if (!normalized || !challengeId || !otp || !/^\d{6}$/.test(otp.trim())) {
      res.status(400).json({ error: "Valid mobile number, challenge ID, and 6-digit OTP are required." });
      return;
    }

    const challenge = db
      .prepare(
        `SELECT * FROM otp_challenges WHERE id = ? AND phone = ?`
      )
      .get(challengeId, normalized) as
      | {
          id: string;
          phone: string;
          otp_hash: string;
          attempts: number;
          expires_at: number;
          verified_at: number | null;
        }
      | undefined;

    if (!challenge) {
      res.status(404).json({ error: "OTP challenge not found. Request a new code." });
      return;
    }

    if (challenge.verified_at !== null) {
      res.status(400).json({ error: "This OTP has already been used." });
      return;
    }

    if (challenge.expires_at <= Date.now()) {
      res.status(400).json({ error: "OTP expired. Please request a fresh code." });
      return;
    }

    if (challenge.attempts >= 5) {
      res.status(429).json({ error: "Too many failed attempts. Request a new OTP." });
      return;
    }

    const expectedHash = hashOtp(normalized, otp.trim());
    if (!timingSafeEqualHex(challenge.otp_hash, expectedHash)) {
      db.prepare("UPDATE otp_challenges SET attempts = attempts + 1 WHERE id = ?").run(
        challenge.id
      );
      res.status(401).json({ error: "Incorrect OTP. Please try again." });
      return;
    }

    db.prepare("UPDATE otp_challenges SET verified_at = ? WHERE id = ?").run(
      Date.now(),
      challenge.id
    );

    let user = db
      .prepare("SELECT * FROM users WHERE phone = ?")
      .get(normalized) as AuthenticatedUser | undefined;

    if (!user) {
      const cleanName =
        typeof fullName === "string" && fullName.trim().length >= 2
          ? fullName.trim().slice(0, 60)
          : `SmartPay User ${normalized.slice(-4)}`;
      const baseHandle = cleanName
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ".")
        .replace(/^\.+|\.+$/g, "")
        .slice(0, 18);
      const vpa = `${baseHandle || "user"}.${normalized.slice(-4)}@smartpay`;
      const userId = `USR-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;

      db.prepare(
        `INSERT INTO users (id, phone, full_name, email, vpa, kyc_status, wallet_balance_paise, environment_mode, daily_limit_paise, created_at)
         VALUES (?, ?, ?, ?, ?, 'PENDING', ?, 'sandbox', 10000000, ?)`
      ).run(
        userId,
        normalized,
        cleanName,
        null,
        vpa,
        1000000, // Initial ₹10,000.00 sandbox balance
        new Date().toISOString()
      );

      seedDefaultUserData(userId);
      user = db.prepare("SELECT * FROM users WHERE id = ?").get(userId) as AuthenticatedUser;
    }

    const rawToken = generateSessionToken();
    const tokenHash = hashToken(rawToken);
    const deviceId = `DEV-${crypto.randomBytes(6).toString("hex")}`;
    const safeDeviceLabel =
      typeof deviceLabel === "string" && deviceLabel.trim()
        ? deviceLabel.trim().slice(0, 80)
        : req.headers["user-agent"]?.slice(0, 80) || "Android Mobile Web";

    db.prepare(
      `INSERT INTO sessions (token_hash, user_id, device_id, device_label, ip_address, expires_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(
      tokenHash,
      user.id,
      deviceId,
      safeDeviceLabel,
      req.ip || null,
      Date.now() + 1000 * 60 * 60 * 24 * 7, // 7-day session
      new Date().toISOString()
    );

    writeAuditLog({
      userId: user.id,
      eventType: "AUTH_LOGIN_VERIFIED",
      actorIp: req.ip,
      deviceId,
      details: { phone: user.phone, deviceLabel: safeDeviceLabel },
    });

    const banks = db
      .prepare("SELECT * FROM bank_accounts WHERE user_id = ? ORDER BY is_primary DESC")
      .all(user.id);

    res.json({
      token: rawToken,
      deviceId,
      user: formatUserResponse(user),
      bankAccounts: banks,
      compliance: getProviderComplianceStatus(),
    });
  });

  app.get("/api/auth/me", requireAuth, (req: AuthedRequest, res) => {
    const user = req.user!;
    const banks = db
      .prepare("SELECT * FROM bank_accounts WHERE user_id = ? ORDER BY is_primary DESC")
      .all(user.id);
    const sessions = db
      .prepare(
        `SELECT device_id, device_label, ip_address, created_at, expires_at
         FROM sessions
         WHERE user_id = ? AND revoked_at IS NULL AND expires_at > ?
         ORDER BY created_at DESC LIMIT 10`
      )
      .all(user.id, Date.now());

    res.json({
      user: formatUserResponse(user),
      bankAccounts: banks,
      activeSessions: sessions,
      compliance: getProviderComplianceStatus(),
    });
  });

  app.post("/api/auth/logout", requireAuth, (req: AuthedRequest, res) => {
    db.prepare("UPDATE sessions SET revoked_at = ? WHERE token_hash = ?").run(
      Date.now(),
      req.sessionTokenHash!
    );
    writeAuditLog({
      userId: req.user!.id,
      eventType: "AUTH_LOGOUT",
      actorIp: req.ip,
      deviceId: req.deviceId,
      details: {},
    });
    res.json({ ok: true });
  });

  app.patch("/api/profile", requireAuth, (req: AuthedRequest, res) => {
    const user = req.user!;
    const { fullName, email, panNumber } = req.body as {
      fullName?: string;
      email?: string;
      panNumber?: string;
    };

    const nextName =
      typeof fullName === "string" && fullName.trim().length >= 2
        ? fullName.trim().slice(0, 60)
        : user.full_name;
    const nextEmail =
      typeof email === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())
        ? email.trim().toLowerCase()
        : user.email;

    let kycStatus = user.kyc_status;
    let panLast4 = user.kyc_pan_last4;

    if (typeof panNumber === "string" && panNumber.trim().length > 0) {
      const normalizedPan = panNumber.trim().toUpperCase();
      if (!/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(normalizedPan)) {
        res.status(400).json({ error: "Enter a valid 10-character PAN (e.g. ABCDE1234F)." });
        return;
      }
      kycStatus = "VERIFIED";
      panLast4 = normalizedPan.slice(-5);
    }

    db.prepare(
      `UPDATE users SET full_name = ?, email = ?, kyc_status = ?, kyc_pan_last4 = ? WHERE id = ?`
    ).run(nextName, nextEmail, kycStatus, panLast4, user.id);

    const updated = db
      .prepare("SELECT * FROM users WHERE id = ?")
      .get(user.id) as AuthenticatedUser;

    writeAuditLog({
      userId: user.id,
      eventType: "PROFILE_UPDATED",
      actorIp: req.ip,
      deviceId: req.deviceId,
      details: { kycStatus, updatedEmail: Boolean(email) },
    });

    res.json({ user: formatUserResponse(updated) });
  });

  // Biometric WebAuthn device binding
  app.post("/api/security/biometric/register", requireAuth, (req: AuthedRequest, res) => {
    const { credentialId, deviceLabel } = req.body as {
      credentialId?: string;
      deviceLabel?: string;
    };
    if (!credentialId || credentialId.length < 8) {
      res.status(400).json({ error: "Valid WebAuthn credential ID required." });
      return;
    }

    const label =
      typeof deviceLabel === "string" && deviceLabel.trim()
        ? deviceLabel.trim().slice(0, 60)
        : "Biometric Passkey Device";

    db.prepare(
      `UPDATE users SET biometric_credential_id = ?, biometric_device_label = ? WHERE id = ?`
    ).run(credentialId.slice(0, 256), label, req.user!.id);

    writeAuditLog({
      userId: req.user!.id,
      eventType: "BIOMETRIC_ENROLLED",
      actorIp: req.ip,
      deviceId: req.deviceId,
      details: { deviceLabel: label },
    });

    const updated = db
      .prepare("SELECT * FROM users WHERE id = ?")
      .get(req.user!.id) as AuthenticatedUser;
    res.json({ user: formatUserResponse(updated) });
  });

  app.delete("/api/security/biometric", requireAuth, (req: AuthedRequest, res) => {
    db.prepare(
      `UPDATE users SET biometric_credential_id = NULL, biometric_device_label = NULL WHERE id = ?`
    ).run(req.user!.id);

    writeAuditLog({
      userId: req.user!.id,
      eventType: "BIOMETRIC_REMOVED",
      actorIp: req.ip,
      deviceId: req.deviceId,
      details: {},
    });

    const updated = db
      .prepare("SELECT * FROM users WHERE id = ?")
      .get(req.user!.id) as AuthenticatedUser;
    res.json({ user: formatUserResponse(updated) });
  });

  app.get("/api/security/audit-logs", requireAuth, (req: AuthedRequest, res) => {
    const logs = db
      .prepare(
        `SELECT id, event_type, actor_ip, device_id, details_json, created_at
         FROM audit_logs
         WHERE user_id = ?
         ORDER BY created_at DESC LIMIT 30`
      )
      .all(req.user!.id);
    res.json({ logs });
  });

  // Contacts & VPA Verification
  app.get("/api/contacts", requireAuth, (req: AuthedRequest, res) => {
    const contacts = db
      .prepare("SELECT * FROM contacts WHERE user_id = ? ORDER BY is_merchant ASC, name ASC")
      .all(req.user!.id);
    res.json({ contacts });
  });

  app.post("/api/contacts/verify-vpa", requireAuth, async (req: AuthedRequest, res) => {
    const { vpa } = req.body as { vpa?: string };
    if (!vpa || !isValidUpiVpa(vpa)) {
      res.status(400).json({ error: "Enter a valid UPI ID (e.g. name@okaxis or merchant@icici)." });
      return;
    }

    const result = await verifyVpaWithPsp(vpa.trim());
    if (!result.valid) {
      res.status(404).json({ error: "UPI ID could not be verified with NPCI PSP directory." });
      return;
    }
    res.json(result);
  });

  app.post("/api/contacts", requireAuth, async (req: AuthedRequest, res) => {
    const { name, vpa, phone, category } = req.body as {
      name?: string;
      vpa?: string;
      phone?: string;
      category?: string;
    };
    if (!name || !vpa || !isValidUpiVpa(vpa)) {
      res.status(400).json({ error: "Recipient name and valid UPI ID are required." });
      return;
    }

    const normalizedPhone = phone ? normalizeIndianPhone(phone) : null;
    const verification = await verifyVpaWithPsp(vpa.trim());
    if (!verification.valid) {
      res.status(400).json({ error: "UPI ID failed PSP verification." });
      return;
    }

    const id = `CNT-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
    db.prepare(
      `INSERT INTO contacts (id, user_id, name, phone, vpa, verified_name, is_merchant, category)
       VALUES (?, ?, ?, ?, ?, ?, 0, ?)`
    ).run(
      id,
      req.user!.id,
      name.trim().slice(0, 50),
      normalizedPhone,
      vpa.trim().toLowerCase(),
      verification.verifiedName,
      (category || "Peer").slice(0, 30)
    );

    const created = db.prepare("SELECT * FROM contacts WHERE id = ?").get(id);
    res.status(201).json({ contact: created });
  });

  // Transactions & Daily Summary
  app.get("/api/transactions", requireAuth, (req: AuthedRequest, res) => {
    const userId = req.user!.id;
    const statusFilter = typeof req.query.status === "string" ? req.query.status.toUpperCase() : "ALL";
    const search = typeof req.query.q === "string" ? req.query.q.trim().toLowerCase() : "";

    let sql = "SELECT * FROM transactions WHERE user_id = ?";
    const params: unknown[] = [userId];

    if (statusFilter === "SUCCESS" || statusFilter === "PENDING" || statusFilter === "FAILED") {
      sql += " AND status = ?";
      params.push(statusFilter);
    }

    if (search) {
      sql +=
        " AND (LOWER(counterparty_name) LIKE ? OR LOWER(counterparty_vpa) LIKE ? OR LOWER(id) LIKE ? OR LOWER(COALESCE(note, '')) LIKE ?)";
      const like = `%${search}%`;
      params.push(like, like, like, like);
    }

    sql += " ORDER BY created_at DESC LIMIT 100";
    const transactions = db.prepare(sql).all(...params);

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const dailyStats = db
      .prepare(
        `SELECT
           COALESCE(SUM(CASE WHEN direction = 'DEBIT' AND status = 'SUCCESS' THEN amount_paise ELSE 0 END), 0) as spentTodayPaise,
           COALESCE(SUM(CASE WHEN direction = 'CREDIT' AND status = 'SUCCESS' THEN amount_paise ELSE 0 END), 0) as receivedTodayPaise,
           COUNT(CASE WHEN status = 'PENDING' THEN 1 END) as pendingCount
         FROM transactions
         WHERE user_id = ? AND created_at >= ?`
      )
      .get(userId, todayStart.toISOString()) as {
      spentTodayPaise: number;
      receivedTodayPaise: number;
      pendingCount: number;
    };

    res.json({ transactions, dailyStats });
  });

  app.get("/api/transactions/:id", requireAuth, (req: AuthedRequest, res) => {
    const tx = db
      .prepare("SELECT * FROM transactions WHERE id = ? AND user_id = ?")
      .get(req.params.id, req.user!.id);
    if (!tx) {
      res.status(404).json({ error: "Transaction not found." });
      return;
    }
    res.json({ transaction: tx });
  });

  // Execute UPI Payment (Send to VPA, Pay Contact, Scan & Pay QR, Pay Merchant)
  app.post(
    "/api/upi/pay",
    requireAuth,
    rejectRawUpiPinMiddleware,
    paymentLimiter,
    async (req: AuthedRequest, res) => {
      const user = req.user!;
      const idempotencyKey =
        String(req.headers["idempotency-key"] || (req.body as { idempotencyKey?: string })?.idempotencyKey || "").trim();

      if (!idempotencyKey || idempotencyKey.length < 8) {
        res.status(400).json({ error: "Idempotency-Key header is required for duplicate payment prevention." });
        return;
      }

      // Duplicate payment prevention via Idempotency-Key
      const existingTx = db
        .prepare("SELECT * FROM transactions WHERE user_id = ? AND idempotency_key = ?")
        .get(user.id, idempotencyKey);
      if (existingTx) {
        res.json({
          transaction: existingTx,
          user: formatUserResponse(user),
          duplicatePrevented: true,
        });
        return;
      }

      const {
        vpa,
        recipientName,
        recipientPhone,
        amountRupees,
        note,
        type,
        pspAuthToken,
        biometricVerified,
      } = req.body as {
        vpa?: string;
        recipientName?: string;
        recipientPhone?: string;
        amountRupees?: number | string;
        note?: string;
        type?: "UPI_SEND" | "QR_PAY" | "MERCHANT_PAY";
        pspAuthToken?: string;
        biometricVerified?: boolean;
      };

      if (!vpa || !isValidUpiVpa(vpa)) {
        res.status(400).json({ error: "Valid recipient UPI ID is required." });
        return;
      }

      const amountPaise = parseValidPaise(amountRupees);
      if (!amountPaise) {
        res.status(400).json({ error: "Amount must be between ₹1.00 and ₹1,00,000.00." });
        return;
      }

      if (!pspAuthToken || pspAuthToken.length < 8) {
        res.status(400).json({
          error: "Authorized PSP handoff confirmation token is required.",
        });
        return;
      }

      if (amountPaise > user.wallet_balance_paise) {
        res.status(400).json({
          error: "Insufficient SmartPay Wallet balance. Add funds or select a bank rail.",
        });
        return;
      }

      // Check daily limit
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);
      const spentToday = db
        .prepare(
          `SELECT COALESCE(SUM(amount_paise), 0) as total
           FROM transactions
           WHERE user_id = ? AND direction = 'DEBIT' AND status != 'FAILED' AND created_at >= ?`
        )
        .get(user.id, todayStart.toISOString()) as { total: number };

      if (spentToday.total + amountPaise > user.daily_limit_paise) {
        res.status(400).json({
          error: "Payment exceeds your ₹1,00,000 daily UPI transfer limit.",
        });
        return;
      }

      // Fraud & velocity assessment
      const fiveMinAgo = new Date(Date.now() - 5 * 60_000).toISOString();
      const oneMinAgo = new Date(Date.now() - 60_000).toISOString();
      const recentVelocity = db
        .prepare(
          `SELECT COUNT(*) as cnt FROM transactions WHERE user_id = ? AND direction = 'DEBIT' AND created_at >= ?`
        )
        .get(user.id, fiveMinAgo) as { cnt: number };

      const duplicateRecent = db
        .prepare(
          `SELECT COUNT(*) as cnt FROM transactions
           WHERE user_id = ? AND counterparty_vpa = ? AND amount_paise = ? AND status != 'FAILED' AND created_at >= ?`
        )
        .get(user.id, vpa.trim().toLowerCase(), amountPaise, oneMinAgo) as { cnt: number };

      const knownContact = db
        .prepare("SELECT id FROM contacts WHERE user_id = ? AND LOWER(vpa) = ?")
        .get(user.id, vpa.trim().toLowerCase());

      const risk = assessTransactionRisk({
        amountPaise,
        recentTxCountLast5Min: recentVelocity.cnt,
        duplicateRecentCount: duplicateRecent.cnt,
        isKnownCounterparty: Boolean(knownContact),
      });

      if (risk.action === "BLOCK") {
        writeAuditLog({
          userId: user.id,
          eventType: "PAYMENT_BLOCKED_RISK",
          actorIp: req.ip,
          deviceId: req.deviceId,
          details: { vpa, amountPaise, risk },
        });
        res.status(403).json({
          error: "Blocked by fraud protection: " + risk.flags.join("; "),
          risk,
        });
        return;
      }

      if (risk.action === "STEP_UP_VERIFICATION" && !biometricVerified && user.biometric_credential_id) {
        res.status(428).json({
          error: "Biometric step-up confirmation required for this transaction.",
          requiresStepUp: true,
          risk,
        });
        return;
      }

      const txId = `SPW-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-${crypto.randomInt(1000, 9999)}`;
      const safeType = type === "QR_PAY" || type === "MERCHANT_PAY" ? type : "UPI_SEND";
      const safeName =
        typeof recipientName === "string" && recipientName.trim()
          ? recipientName.trim().slice(0, 60)
          : vpa.split("@")[0];
      const safeNote = typeof note === "string" ? note.trim().slice(0, 100) : "";

      const pspResult = await executeUpiPaymentViaPsp({
        txId,
        amountPaise,
        counterpartyVpa: vpa.trim().toLowerCase(),
        counterpartyName: safeName,
        note: safeNote,
        userPhone: user.phone,
      });

      const nowIso = new Date().toISOString();
      const receiptHash = crypto
        .createHash("sha256")
        .update(`${txId}:${amountPaise}:${vpa}:${nowIso}`)
        .digest("hex")
        .slice(0, 24);

      const commitTx = db.transaction(() => {
        // Reserve/deduct balance for SUCCESS or PENDING; do not deduct for immediate FAILED
        if (pspResult.status === "SUCCESS" || pspResult.status === "PENDING") {
          const updated = db
            .prepare(
              `UPDATE users SET wallet_balance_paise = wallet_balance_paise - ?
               WHERE id = ? AND wallet_balance_paise >= ?`
            )
            .run(amountPaise, user.id, amountPaise);
          if (updated.changes === 0) {
            throw new Error("Insufficient balance during atomic debit.");
          }
        }

        db.prepare(
          `INSERT INTO transactions (
            id, user_id, idempotency_key, type, direction, amount_paise,
            counterparty_name, counterparty_vpa, counterparty_phone, note,
            status, environment, psp_provider, psp_order_id, psp_payment_id,
            utr_rrn, failure_reason, risk_score, risk_flags, receipt_hash, created_at, updated_at
          ) VALUES (?, ?, ?, ?, 'DEBIT', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(
          txId,
          user.id,
          idempotencyKey,
          safeType,
          amountPaise,
          safeName,
          vpa.trim().toLowerCase(),
          recipientPhone ? normalizeIndianPhone(recipientPhone) : null,
          safeNote,
          pspResult.status,
          pspResult.environment,
          pspResult.pspProvider,
          pspResult.pspOrderId,
          pspResult.pspPaymentId,
          pspResult.utrRrn,
          pspResult.failureReason,
          risk.riskScore,
          JSON.stringify(risk.flags),
          receiptHash,
          nowIso,
          nowIso
        );
      });

      commitTx();

      writeAuditLog({
        userId: user.id,
        eventType: "UPI_PAYMENT_EXECUTED",
        actorIp: req.ip,
        deviceId: req.deviceId,
        details: {
          txId,
          status: pspResult.status,
          environment: pspResult.environment,
          amountPaise,
          vpa: vpa.trim().toLowerCase(),
          riskScore: risk.riskScore,
        },
      });

      const createdTx = db.prepare("SELECT * FROM transactions WHERE id = ?").get(txId);
      const updatedUser = db
        .prepare("SELECT * FROM users WHERE id = ?")
        .get(user.id) as AuthenticatedUser;

      res.status(201).json({
        transaction: createdTx,
        user: formatUserResponse(updatedUser),
        risk,
      });
    }
  );

  // Add money to Wallet
  app.post(
    "/api/wallet/add",
    requireAuth,
    rejectRawUpiPinMiddleware,
    paymentLimiter,
    async (req: AuthedRequest, res) => {
      const user = req.user!;
      const idempotencyKey = String(req.headers["idempotency-key"] || "").trim();
      if (!idempotencyKey || idempotencyKey.length < 8) {
        res.status(400).json({ error: "Idempotency-Key header is required." });
        return;
      }

      const existing = db
        .prepare("SELECT * FROM transactions WHERE user_id = ? AND idempotency_key = ?")
        .get(user.id, idempotencyKey);
      if (existing) {
        res.json({ transaction: existing, user: formatUserResponse(user), duplicatePrevented: true });
        return;
      }

      const { amountRupees } = req.body as { amountRupees?: number | string };
      const amountPaise = parseValidPaise(amountRupees);
      if (!amountPaise) {
        res.status(400).json({ error: "Enter an amount between ₹1.00 and ₹1,00,000.00." });
        return;
      }

      const primaryBank = db
        .prepare("SELECT * FROM bank_accounts WHERE user_id = ? ORDER BY is_primary DESC LIMIT 1")
        .get(user.id) as { bank_name: string; account_mask: string; vpa: string } | undefined;

      const txId = `SPW-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-${crypto.randomInt(1000, 9999)}`;
      const pspResult = await executeUpiPaymentViaPsp({
        txId,
        amountPaise,
        counterpartyVpa: primaryBank?.vpa || user.vpa,
        counterpartyName: primaryBank
          ? `${primaryBank.bank_name} ${primaryBank.account_mask}`
          : "Linked Bank Account",
        note: "SmartPay Wallet Top-up",
        userPhone: user.phone,
      });

      const nowIso = new Date().toISOString();
      const receiptHash = crypto
        .createHash("sha256")
        .update(`${txId}:${amountPaise}:ADD:${nowIso}`)
        .digest("hex")
        .slice(0, 24);

      const commitAdd = db.transaction(() => {
        if (pspResult.status === "SUCCESS") {
          db.prepare(
            "UPDATE users SET wallet_balance_paise = wallet_balance_paise + ? WHERE id = ?"
          ).run(amountPaise, user.id);
        }

        db.prepare(
          `INSERT INTO transactions (
            id, user_id, idempotency_key, type, direction, amount_paise,
            counterparty_name, counterparty_vpa, note, status, environment,
            psp_provider, psp_order_id, psp_payment_id, utr_rrn, failure_reason,
            risk_score, risk_flags, receipt_hash, created_at, updated_at
          ) VALUES (?, ?, ?, 'WALLET_ADD', 'CREDIT', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 5, '[]', ?, ?, ?)`
        ).run(
          txId,
          user.id,
          idempotencyKey,
          amountPaise,
          primaryBank ? `${primaryBank.bank_name} ${primaryBank.account_mask}` : "Linked Bank",
          primaryBank?.vpa || user.vpa,
          "Sandbox wallet load via UPI PSP",
          pspResult.status,
          pspResult.environment,
          pspResult.pspProvider,
          pspResult.pspOrderId,
          pspResult.pspPaymentId,
          pspResult.utrRrn,
          pspResult.failureReason,
          receiptHash,
          nowIso,
          nowIso
        );
      });

      commitAdd();

      const tx = db.prepare("SELECT * FROM transactions WHERE id = ?").get(txId);
      const updatedUser = db
        .prepare("SELECT * FROM users WHERE id = ?")
        .get(user.id) as AuthenticatedUser;
      res.status(201).json({ transaction: tx, user: formatUserResponse(updatedUser) });
    }
  );

  // Withdraw money from Wallet to Bank
  app.post(
    "/api/wallet/withdraw",
    requireAuth,
    rejectRawUpiPinMiddleware,
    paymentLimiter,
    async (req: AuthedRequest, res) => {
      const user = req.user!;
      const idempotencyKey = String(req.headers["idempotency-key"] || "").trim();
      if (!idempotencyKey || idempotencyKey.length < 8) {
        res.status(400).json({ error: "Idempotency-Key header is required." });
        return;
      }

      const existing = db
        .prepare("SELECT * FROM transactions WHERE user_id = ? AND idempotency_key = ?")
        .get(user.id, idempotencyKey);
      if (existing) {
        res.json({ transaction: existing, user: formatUserResponse(user), duplicatePrevented: true });
        return;
      }

      const { amountRupees } = req.body as { amountRupees?: number | string };
      const amountPaise = parseValidPaise(amountRupees);
      if (!amountPaise) {
        res.status(400).json({ error: "Enter an amount between ₹1.00 and ₹1,00,000.00." });
        return;
      }

      if (amountPaise > user.wallet_balance_paise) {
        res.status(400).json({ error: "Insufficient wallet balance for withdrawal." });
        return;
      }

      const primaryBank = db
        .prepare("SELECT * FROM bank_accounts WHERE user_id = ? ORDER BY is_primary DESC LIMIT 1")
        .get(user.id) as { bank_name: string; account_mask: string; vpa: string } | undefined;

      const txId = `SPW-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-${crypto.randomInt(1000, 9999)}`;
      const pspResult = await executeUpiPaymentViaPsp({
        txId,
        amountPaise,
        counterpartyVpa: primaryBank?.vpa || user.vpa,
        counterpartyName: primaryBank
          ? `${primaryBank.bank_name} ${primaryBank.account_mask}`
          : "Linked Bank Account",
        note: "SmartPay Wallet Settlement Withdrawal",
        userPhone: user.phone,
      });

      const nowIso = new Date().toISOString();
      const receiptHash = crypto
        .createHash("sha256")
        .update(`${txId}:${amountPaise}:WITHDRAW:${nowIso}`)
        .digest("hex")
        .slice(0, 24);

      const commitWithdraw = db.transaction(() => {
        if (pspResult.status === "SUCCESS" || pspResult.status === "PENDING") {
          const updated = db
            .prepare(
              `UPDATE users SET wallet_balance_paise = wallet_balance_paise - ?
               WHERE id = ? AND wallet_balance_paise >= ?`
            )
            .run(amountPaise, user.id, amountPaise);
          if (updated.changes === 0) throw new Error("Insufficient balance.");
        }

        db.prepare(
          `INSERT INTO transactions (
            id, user_id, idempotency_key, type, direction, amount_paise,
            counterparty_name, counterparty_vpa, note, status, environment,
            psp_provider, psp_order_id, psp_payment_id, utr_rrn, failure_reason,
            risk_score, risk_flags, receipt_hash, created_at, updated_at
          ) VALUES (?, ?, ?, 'WALLET_WITHDRAW', 'DEBIT', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 5, '[]', ?, ?, ?)`
        ).run(
          txId,
          user.id,
          idempotencyKey,
          amountPaise,
          primaryBank ? `${primaryBank.bank_name} ${primaryBank.account_mask}` : "Linked Bank",
          primaryBank?.vpa || user.vpa,
          "Wallet withdrawal to primary bank account",
          pspResult.status,
          pspResult.environment,
          pspResult.pspProvider,
          pspResult.pspOrderId,
          pspResult.pspPaymentId,
          pspResult.utrRrn,
          pspResult.failureReason,
          receiptHash,
          nowIso,
          nowIso
        );
      });

      commitWithdraw();

      const tx = db.prepare("SELECT * FROM transactions WHERE id = ?").get(txId);
      const updatedUser = db
        .prepare("SELECT * FROM users WHERE id = ?")
        .get(user.id) as AuthenticatedUser;
      res.status(201).json({ transaction: tx, user: formatUserResponse(updatedUser) });
    }
  );

  // Collect Payment Requests
  app.get("/api/collect-requests", requireAuth, (req: AuthedRequest, res) => {
    const requests = db
      .prepare("SELECT * FROM collect_requests WHERE user_id = ? ORDER BY created_at DESC")
      .all(req.user!.id);
    res.json({ collectRequests: requests });
  });

  app.post("/api/collect-requests", requireAuth, (req: AuthedRequest, res) => {
    const { payerVpa, payerName, amountRupees, note } = req.body as {
      payerVpa?: string;
      payerName?: string;
      amountRupees?: number | string;
      note?: string;
    };
    if (!payerVpa || !isValidUpiVpa(payerVpa)) {
      res.status(400).json({ error: "Enter a valid payer UPI ID." });
      return;
    }
    const amountPaise = parseValidPaise(amountRupees);
    if (!amountPaise) {
      res.status(400).json({ error: "Amount must be between ₹1.00 and ₹1,00,000.00." });
      return;
    }

    const compliance = getProviderComplianceStatus();
    const id = `COL-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-${crypto.randomInt(100, 999)}`;
    const nowIso = new Date().toISOString();
    const expiresAt = new Date(Date.now() + 24 * 60 * 60_000).toISOString();

    db.prepare(
      `INSERT INTO collect_requests (id, user_id, requester_name, requester_vpa, amount_paise, note, status, environment, expires_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 'PENDING', ?, ?, ?)`
    ).run(
      id,
      req.user!.id,
      (payerName || payerVpa.split("@")[0]).trim().slice(0, 60),
      payerVpa.trim().toLowerCase(),
      amountPaise,
      (note || "UPI Collect Request").trim().slice(0, 100),
      compliance.activeMode,
      expiresAt,
      nowIso
    );

    const created = db.prepare("SELECT * FROM collect_requests WHERE id = ?").get(id);
    res.status(201).json({ collectRequest: created });
  });

  app.post(
    "/api/collect-requests/:id/respond",
    requireAuth,
    rejectRawUpiPinMiddleware,
    paymentLimiter,
    async (req: AuthedRequest, res) => {
      const user = req.user!;
      const { action } = req.body as { action?: "APPROVE" | "DECLINE" };
      const collect = db
        .prepare("SELECT * FROM collect_requests WHERE id = ? AND user_id = ?")
        .get(req.params.id, user.id) as
        | {
            id: string;
            requester_name: string;
            requester_vpa: string;
            amount_paise: number;
            note: string | null;
            status: string;
          }
        | undefined;

      if (!collect) {
        res.status(404).json({ error: "Collect request not found." });
        return;
      }
      if (collect.status !== "PENDING") {
        res.status(400).json({ error: `Collect request is already ${collect.status}.` });
        return;
      }

      if (action === "DECLINE") {
        db.prepare("UPDATE collect_requests SET status = 'DECLINED' WHERE id = ?").run(
          collect.id
        );
        res.json({ status: "DECLINED", user: formatUserResponse(user) });
        return;
      }

      if (action !== "APPROVE") {
        res.status(400).json({ error: "Action must be APPROVE or DECLINE." });
        return;
      }

      if (collect.amount_paise > user.wallet_balance_paise) {
        res.status(400).json({ error: "Insufficient SmartPay Wallet balance." });
        return;
      }

      const txId = `SPW-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-${crypto.randomInt(1000, 9999)}`;
      const pspResult = await executeUpiPaymentViaPsp({
        txId,
        amountPaise: collect.amount_paise,
        counterpartyVpa: collect.requester_vpa,
        counterpartyName: collect.requester_name,
        note: collect.note || "Approved Collect Request",
        userPhone: user.phone,
      });

      const nowIso = new Date().toISOString();
      const receiptHash = crypto
        .createHash("sha256")
        .update(`${txId}:${collect.amount_paise}:${collect.requester_vpa}:${nowIso}`)
        .digest("hex")
        .slice(0, 24);

      const commitCollect = db.transaction(() => {
        if (pspResult.status === "SUCCESS" || pspResult.status === "PENDING") {
          const updated = db
            .prepare(
              `UPDATE users SET wallet_balance_paise = wallet_balance_paise - ?
               WHERE id = ? AND wallet_balance_paise >= ?`
            )
            .run(collect.amount_paise, user.id, collect.amount_paise);
          if (updated.changes === 0) throw new Error("Insufficient balance.");
        }

        db.prepare(
          `UPDATE collect_requests SET status = ? WHERE id = ?`
        ).run(pspResult.status === "FAILED" ? "PENDING" : "APPROVED", collect.id);

        db.prepare(
          `INSERT INTO transactions (
            id, user_id, idempotency_key, type, direction, amount_paise,
            counterparty_name, counterparty_vpa, note, status, environment,
            psp_provider, psp_order_id, psp_payment_id, utr_rrn, failure_reason,
            risk_score, risk_flags, receipt_hash, created_at, updated_at
          ) VALUES (?, ?, ?, 'UPI_COLLECT', 'DEBIT', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 10, '[]', ?, ?, ?)`
        ).run(
          txId,
          user.id,
          `collect-${collect.id}`,
          collect.amount_paise,
          collect.requester_name,
          collect.requester_vpa,
          collect.note || "UPI Collect Request Approved",
          pspResult.status,
          pspResult.environment,
          pspResult.pspProvider,
          pspResult.pspOrderId,
          pspResult.pspPaymentId,
          pspResult.utrRrn,
          pspResult.failureReason,
          receiptHash,
          nowIso,
          nowIso
        );
      });

      commitCollect();

      const tx = db.prepare("SELECT * FROM transactions WHERE id = ?").get(txId);
      const updatedUser = db
        .prepare("SELECT * FROM users WHERE id = ?")
        .get(user.id) as AuthenticatedUser;

      res.json({
        status: "APPROVED",
        transaction: tx,
        user: formatUserResponse(updatedUser),
      });
    }
  );

  // Webhook Handler with HMAC-SHA256 Verification
  function processVerifiedWebhook(payload: {
    txId: string;
    status: "SUCCESS" | "FAILED";
    failureReason?: string;
    utrRrn?: string;
  }) {
    const tx = db
      .prepare("SELECT * FROM transactions WHERE id = ?")
      .get(payload.txId) as
      | {
          id: string;
          user_id: string;
          direction: string;
          amount_paise: number;
          status: string;
        }
      | undefined;

    if (!tx) return { found: false };
    if (tx.status !== "PENDING") return { found: true, alreadyFinalized: true, tx };

    const nowIso = new Date().toISOString();
    const settle = db.transaction(() => {
      db.prepare(
        `UPDATE transactions SET status = ?, failure_reason = ?, utr_rrn = COALESCE(?, utr_rrn), updated_at = ?
         WHERE id = ?`
      ).run(
        payload.status,
        payload.status === "FAILED"
          ? payload.failureReason || "PSP webhook reported payment failure — amount reversed"
          : null,
        payload.utrRrn || null,
        nowIso,
        tx.id
      );

      // Reversal if DEBIT failed after reserve, or credit if CREDIT succeeded
      if (tx.direction === "DEBIT" && payload.status === "FAILED") {
        db.prepare(
          "UPDATE users SET wallet_balance_paise = wallet_balance_paise + ? WHERE id = ?"
        ).run(tx.amount_paise, tx.user_id);
      } else if (tx.direction === "CREDIT" && payload.status === "SUCCESS") {
        db.prepare(
          "UPDATE users SET wallet_balance_paise = wallet_balance_paise + ? WHERE id = ?"
        ).run(tx.amount_paise, tx.user_id);
      }
    });

    settle();
    writeAuditLog({
      userId: tx.user_id,
      eventType: "PSP_WEBHOOK_SETTLED",
      details: { txId: tx.id, newStatus: payload.status },
    });

    const updatedTx = db.prepare("SELECT * FROM transactions WHERE id = ?").get(tx.id);
    return { found: true, alreadyFinalized: false, tx: updatedTx };
  }

  app.post("/api/webhooks/upi", (req: AuthedRequest, res) => {
    const signature =
      (req.headers["x-razorpay-signature"] as string | undefined) ||
      (req.headers["x-smartpay-signature"] as string | undefined);
    const rawBody = req.rawBody || JSON.stringify(req.body);

    if (!verifyWebhookSignature(rawBody, signature)) {
      writeAuditLog({
        eventType: "WEBHOOK_SIGNATURE_REJECTED",
        actorIp: req.ip,
        details: { hasSignature: Boolean(signature) },
      });
      res.status(401).json({ error: "Invalid HMAC-SHA256 webhook signature." });
      return;
    }

    const body = req.body as {
      txId?: string;
      status?: "SUCCESS" | "FAILED";
      failureReason?: string;
      utrRrn?: string;
    };

    if (!body.txId || (body.status !== "SUCCESS" && body.status !== "FAILED")) {
      res.status(400).json({ error: "Invalid webhook payload." });
      return;
    }

    const outcome = processVerifiedWebhook({
      txId: body.txId,
      status: body.status,
      failureReason: body.failureReason,
      utrRrn: body.utrRrn,
    });

    if (!outcome.found) {
      res.status(404).json({ error: "Transaction referenced in webhook not found." });
      return;
    }

    res.json({ verified: true, ...outcome });
  });

  // Authenticated sandbox webhook trigger to test pending transaction settlement
  app.post("/api/sandbox/settle-pending", requireAuth, (req: AuthedRequest, res) => {
    const compliance = getProviderComplianceStatus();
    if (compliance.activeMode !== "sandbox") {
      res.status(403).json({ error: "Sandbox webhook testing is disabled in live mode." });
      return;
    }

    const { txId, outcome } = req.body as {
      txId?: string;
      outcome?: "SUCCESS" | "FAILED";
    };

    if (!txId || (outcome !== "SUCCESS" && outcome !== "FAILED")) {
      res.status(400).json({ error: "txId and outcome (SUCCESS | FAILED) are required." });
      return;
    }

    const ownedTx = db
      .prepare("SELECT * FROM transactions WHERE id = ? AND user_id = ?")
      .get(txId, req.user!.id);
    if (!ownedTx) {
      res.status(404).json({ error: "Transaction not found." });
      return;
    }

    const payloadString = JSON.stringify({
      txId,
      status: outcome,
      utrRrn: outcome === "SUCCESS" ? `4325${crypto.randomInt(10000000, 99999999)}` : undefined,
      failureReason:
        outcome === "FAILED" ? "Sandbox Webhook: NPCI Remitter PSP declined" : undefined,
    });

    const sig = signWebhookPayload(payloadString);
    if (!verifyWebhookSignature(payloadString, sig)) {
      res.status(500).json({ error: "Webhook signature verification failed." });
      return;
    }

    const result = processVerifiedWebhook(JSON.parse(payloadString));
    const updatedUser = db
      .prepare("SELECT * FROM users WHERE id = ?")
      .get(req.user!.id) as AuthenticatedUser;

    res.json({
      webhookSignatureVerified: true,
      transaction: result.tx,
      user: formatUserResponse(updatedUser),
    });
  });

  // Nano Banana Image Edit Route (server-side @google/genai)
  app.post("/api/studio/nano-banana-edit", requireAuth, async (req: AuthedRequest, res) => {
    try {
      const {
        imageBase64,
        mimeType,
        instruction,
        pointerXPercent,
        pointerYPercent,
        model,
      } = req.body as {
        imageBase64?: string;
        mimeType?: string;
        instruction?: string;
        pointerXPercent?: number;
        pointerYPercent?: number;
        model?: "gemini-3.1-flash-lite-image" | "gemini-nano-banana-2.1";
      };

      if (!imageBase64 || !instruction || !instruction.trim()) {
        res.status(400).json({ error: "Image data and edit instruction are required." });
        return;
      }

      const allowedMime = mimeType && mimeType.startsWith("image/") ? mimeType : "image/jpeg";
      const result = await runNanoBananaEdit({
        imageBase64,
        mimeType: allowedMime,
        instruction: instruction.trim(),
        pointerXPercent,
        pointerYPercent,
        model:
          model === "gemini-nano-banana-2.1"
            ? "gemini-nano-banana-2.1"
            : "gemini-3.1-flash-lite-image",
      });

      res.json(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Nano Banana image edit failed.";
      const lower = message.toLowerCase();
      const requiresPaidKey =
        lower.includes("403") ||
        lower.includes("permission_denied") ||
        lower.includes("billing") ||
        lower.includes("paid") ||
        lower.includes("quota") ||
        lower.includes("429") ||
        lower.includes("api_key");

      res.status(requiresPaidKey ? 402 : 500).json({
        error: message,
        requiresPaidKey,
      });
    }
  });

  const server = http.createServer(app);

  // WebSocket Server for Gemini Live API (/api/live)
  const wss = new WebSocketServer({ noServer: true });
  server.on("upgrade", (request, socket, head) => {
    const reqUrl = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);
    if (reqUrl.pathname !== "/api/live") {
      return;
    }

    const token = reqUrl.searchParams.get("token") || "";
    const resolved = authenticateToken(token);
    if (!resolved) {
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      socket.destroy();
      return;
    }

    wss.handleUpgrade(request, socket, head, (ws) => {
      void attachLiveStudioWebSocket(ws);
    });
  });

  // Vite dev middleware or static production files
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), "dist");
    app.use(express.static(distDir));
    app.get("*", (_req, res) => {
      res.sendFile(path.join(distDir, "index.html"));
    });
  }

  const PORT = 3000;
  server.listen(PORT, "0.0.0.0", () => {
    console.log(`SmartPay Wallet server listening on http://0.0.0.0:${PORT}`);
  });
}

void startServer();
