import crypto from "crypto";
import type { NextFunction, Request, Response } from "express";

// Ephemeral in-memory fallback when SESSION_SIGNING_KEY is not configured in environment
const SESSION_SIGNING_KEY =
  process.env.SESSION_SIGNING_KEY || crypto.randomBytes(32).toString("hex");

export const SANDBOX_WEBHOOK_SECRET =
  process.env.RAZORPAY_WEBHOOK_SECRET ||
  crypto.createHmac("sha256", SESSION_SIGNING_KEY).update("smartpay-sandbox-webhook").digest("hex");

export function hashToken(rawToken: string): string {
  return crypto
    .createHmac("sha256", SESSION_SIGNING_KEY)
    .update(rawToken)
    .digest("hex");
}

export function hashOtp(phone: string, otp: string): string {
  return crypto
    .createHmac("sha256", SESSION_SIGNING_KEY)
    .update(`${phone}:${otp}`)
    .digest("hex");
}

export function generateSecureOtp(): string {
  return String(crypto.randomInt(100000, 999999));
}

export function generateSessionToken(): string {
  return `spw_live_${crypto.randomBytes(32).toString("base64url")}`;
}

export function timingSafeEqualHex(aHex: string, bHex: string): boolean {
  try {
    const a = Buffer.from(aHex, "hex");
    const b = Buffer.from(bHex, "hex");
    if (a.length !== b.length || a.length === 0) return false;
    return crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

export function normalizeIndianPhone(input: string): string | null {
  const cleaned = input.replace(/[\s()-]/g, "");
  const match = cleaned.match(/^(?:\+?91)?([6-9]\d{9})$/);
  if (!match) return null;
  return `+91${match[1]}`;
}

export function isValidUpiVpa(vpa: string): boolean {
  const trimmed = vpa.trim();
  return /^[a-zA-Z0-9._-]{2,64}@[a-zA-Z0-9]{2,32}$/.test(trimmed);
}

export function parseValidPaise(amountRupees: unknown): number | null {
  if (typeof amountRupees !== "number" && typeof amountRupees !== "string") {
    return null;
  }
  const numeric = typeof amountRupees === "number" ? amountRupees : Number(amountRupees);
  if (!Number.isFinite(numeric)) return null;
  const paise = Math.round(numeric * 100);
  // NPCI standard UPI per-transaction bounds: ₹1 (100 paise) to ₹1,00,000 (10,000,000 paise)
  if (paise < 100 || paise > 10_000_000) return null;
  return paise;
}

export function rejectRawUpiPinMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  if (req.body && typeof req.body === "object") {
    const forbiddenKeys = ["upiPin", "upi_pin", "mpin", "pin"];
    for (const key of forbiddenKeys) {
      if (key in req.body && req.body[key] !== undefined && req.body[key] !== "") {
        res.status(400).json({
          error:
            "SmartPay never accepts or stores raw UPI PINs on application servers. Confirm transactions via the authorized PSP handoff token.",
        });
        return;
      }
    }
  }
  next();
}

interface RateBucket {
  count: number;
  resetAt: number;
}

export function createRateLimiter(options: {
  windowMs: number;
  maxRequests: number;
  keyPrefix: string;
  keyExtractor?: (req: Request) => string;
}) {
  const buckets = new Map<string, RateBucket>();

  return (req: Request, res: Response, next: NextFunction): void => {
    const now = Date.now();
    const identity = options.keyExtractor
      ? options.keyExtractor(req)
      : req.ip || "unknown";
    const bucketKey = `${options.keyPrefix}:${identity}`;
    const existing = buckets.get(bucketKey);

    if (!existing || existing.resetAt <= now) {
      buckets.set(bucketKey, { count: 1, resetAt: now + options.windowMs });
      next();
      return;
    }

    if (existing.count >= options.maxRequests) {
      const retryAfterSec = Math.ceil((existing.resetAt - now) / 1000);
      res.setHeader("Retry-After", String(retryAfterSec));
      res.status(429).json({
        error: `Rate limit exceeded. Please wait ${retryAfterSec}s before retrying.`,
        retryAfterSec,
      });
      return;
    }

    existing.count += 1;
    next();
  };
}

export interface RiskAssessment {
  riskScore: number;
  flags: string[];
  action: "ALLOW" | "STEP_UP_VERIFICATION" | "BLOCK";
}

export function assessTransactionRisk(params: {
  amountPaise: number;
  recentTxCountLast5Min: number;
  duplicateRecentCount: number;
  isKnownCounterparty: boolean;
}): RiskAssessment {
  let score = 5;
  const flags: string[] = [];

  if (params.duplicateRecentCount > 0) {
    score += 45;
    flags.push("Rapid repeat payment to same recipient within 60 seconds");
  }

  if (params.recentTxCountLast5Min >= 5) {
    score += 35;
    flags.push("High transfer velocity (5+ payments in 5 minutes)");
  }

  if (params.amountPaise >= 2_500_000) {
    // >= ₹25,000
    score += 25;
    flags.push("High-value transfer above ₹25,000 threshold");
  }

  if (!params.isKnownCounterparty && params.amountPaise >= 1_000_000) {
    score += 20;
    flags.push("First-time recipient above ₹10,000");
  }

  let action: RiskAssessment["action"] = "ALLOW";
  if (score >= 85) {
    action = "BLOCK";
  } else if (score >= 45) {
    action = "STEP_UP_VERIFICATION";
  }

  return {
    riskScore: Math.min(100, score),
    flags,
    action,
  };
}
