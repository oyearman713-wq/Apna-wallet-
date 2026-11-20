import Database from "better-sqlite3";
import crypto from "crypto";
import fs from "fs";
import path from "path";

let DATA_DIR = path.resolve(process.cwd(), "data");
try {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  fs.accessSync(DATA_DIR, fs.constants.W_OK);
} catch {
  DATA_DIR = path.resolve("/tmp", "smartpay-data");
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

const DB_PATH = path.join(DATA_DIR, "smartpay.db");
export const db = new Database(DB_PATH);

db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    phone TEXT NOT NULL UNIQUE,
    full_name TEXT NOT NULL,
    email TEXT,
    vpa TEXT NOT NULL UNIQUE,
    kyc_status TEXT NOT NULL DEFAULT 'PENDING',
    kyc_pan_last4 TEXT,
    wallet_balance_paise INTEGER NOT NULL DEFAULT 0,
    environment_mode TEXT NOT NULL DEFAULT 'sandbox',
    biometric_credential_id TEXT,
    biometric_device_label TEXT,
    daily_limit_paise INTEGER NOT NULL DEFAULT 10000000,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS otp_challenges (
    id TEXT PRIMARY KEY,
    phone TEXT NOT NULL,
    otp_hash TEXT NOT NULL,
    provider TEXT NOT NULL,
    provider_message_id TEXT,
    attempts INTEGER NOT NULL DEFAULT 0,
    expires_at INTEGER NOT NULL,
    verified_at INTEGER,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    device_id TEXT NOT NULL,
    device_label TEXT NOT NULL,
    ip_address TEXT,
    expires_at INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    revoked_at INTEGER,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS bank_accounts (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    bank_name TEXT NOT NULL,
    account_mask TEXT NOT NULL,
    ifsc TEXT NOT NULL,
    vpa TEXT NOT NULL,
    is_primary INTEGER NOT NULL DEFAULT 0,
    psp_partner TEXT NOT NULL,
    verified_at TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS contacts (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    name TEXT NOT NULL,
    phone TEXT,
    vpa TEXT NOT NULL,
    verified_name TEXT NOT NULL,
    is_merchant INTEGER NOT NULL DEFAULT 0,
    merchant_code TEXT,
    category TEXT NOT NULL DEFAULT 'Peer',
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS transactions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    idempotency_key TEXT NOT NULL,
    type TEXT NOT NULL,
    direction TEXT NOT NULL,
    amount_paise INTEGER NOT NULL,
    counterparty_name TEXT NOT NULL,
    counterparty_vpa TEXT NOT NULL,
    counterparty_phone TEXT,
    note TEXT,
    status TEXT NOT NULL,
    environment TEXT NOT NULL,
    psp_provider TEXT NOT NULL,
    psp_order_id TEXT,
    psp_payment_id TEXT,
    utr_rrn TEXT,
    failure_reason TEXT,
    risk_score INTEGER NOT NULL DEFAULT 0,
    risk_flags TEXT NOT NULL DEFAULT '[]',
    receipt_hash TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(user_id, idempotency_key),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS collect_requests (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    requester_name TEXT NOT NULL,
    requester_vpa TEXT NOT NULL,
    amount_paise INTEGER NOT NULL,
    note TEXT,
    status TEXT NOT NULL DEFAULT 'PENDING',
    environment TEXT NOT NULL DEFAULT 'sandbox',
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS audit_logs (
    id TEXT PRIMARY KEY,
    user_id TEXT,
    event_type TEXT NOT NULL,
    actor_ip TEXT,
    device_id TEXT,
    details_json TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
`);

export function writeAuditLog(params: {
  userId?: string | null;
  eventType: string;
  actorIp?: string;
  deviceId?: string;
  details: Record<string, unknown>;
}) {
  db.prepare(
    `INSERT INTO audit_logs (id, user_id, event_type, actor_ip, device_id, details_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    `AUD-${crypto.randomUUID().slice(0, 12).toUpperCase()}`,
    params.userId ?? null,
    params.eventType,
    params.actorIp ?? null,
    params.deviceId ?? null,
    JSON.stringify(params.details),
    new Date().toISOString()
  );
}

export function seedDefaultUserData(userId: string) {
  const existingBanks = db
    .prepare("SELECT COUNT(*) as cnt FROM bank_accounts WHERE user_id = ?")
    .get(userId) as { cnt: number };

  if (existingBanks.cnt === 0) {
    const now = new Date().toISOString();
    const insertBank = db.prepare(
      `INSERT INTO bank_accounts (id, user_id, bank_name, account_mask, ifsc, vpa, is_primary, psp_partner, verified_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    insertBank.run(
      `BNK-${crypto.randomUUID().slice(0, 8).toUpperCase()}`,
      userId,
      "HDFC Bank",
      "•••• 4821",
      "HDFC0000240",
      "arjun.mehta@okhdfcbank",
      1,
      "HDFC UPI PSP (Sandbox)",
      now
    );
    insertBank.run(
      `BNK-${crypto.randomUUID().slice(0, 8).toUpperCase()}`,
      userId,
      "ICICI Bank",
      "•••• 9104",
      "ICIC0000047",
      "arjun.mehta@okicici",
      0,
      "ICICI UPI PSP (Sandbox)",
      now
    );
  }

  const existingContacts = db
    .prepare("SELECT COUNT(*) as cnt FROM contacts WHERE user_id = ?")
    .get(userId) as { cnt: number };

  if (existingContacts.cnt === 0) {
    const insertContact = db.prepare(
      `INSERT INTO contacts (id, user_id, name, phone, vpa, verified_name, is_merchant, merchant_code, category)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    const seedContacts = [
      ["Priya Nair", "+919820114502", "priya.nair@okicici", "PRIYA NAIR", 0, null, "Peer"],
      ["Rohan Sharma", "+919910443218", "rohan.sharma@oksbi", "ROHAN SHARMA", 0, null, "Peer"],
      ["Ananya Iyer", "+919845221904", "ananya.iyer@ybl", "ANANYA IYER", 0, null, "Peer"],
      ["Blue Tokai Coffee", null, "bluetokai@okaxis", "BLUE TOKAI ROASTERS PVT LTD", 1, "5814", "Food & Dining"],
      ["Zepto Express", null, "zepto.pay@okicici", "KIRANAKART TECHNOLOGIES", 1, "5411", "Groceries"],
      ["Namma Metro BMRCL", null, "bmrcl.qr@oksbi", "BANGALORE METRO RAIL CORP", 1, "4111", "Transit"],
      ["BESCOM Electricity", null, "bescom.bill@okhdfcbank", "BANGALORE ELECTRICITY SUPPLY", 1, "4900", "Utilities"],
    ] as const;

    for (const [name, phone, vpa, verifiedName, isMerchant, mcc, category] of seedContacts) {
      insertContact.run(
        `CNT-${crypto.randomUUID().slice(0, 8).toUpperCase()}`,
        userId,
        name,
        phone,
        vpa,
        verifiedName,
        isMerchant,
        mcc,
        category
      );
    }
  }
}

// Seed initial sandbox account if database is empty
const userCount = db.prepare("SELECT COUNT(*) as cnt FROM users").get() as { cnt: number };
if (userCount.cnt === 0) {
  const demoUserId = "USR-ARJUN-001";
  const now = Date.now();
  db.prepare(
    `INSERT INTO users (id, phone, full_name, email, vpa, kyc_status, kyc_pan_last4, wallet_balance_paise, environment_mode, daily_limit_paise, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    demoUserId,
    "+919876543210",
    "Arjun Mehta",
    "arjun.mehta@smartpay.in",
    "arjun.mehta@smartpay",
    "VERIFIED",
    "4892K",
    4825000, // ₹48,250.00
    "sandbox",
    10000000, // ₹1,00,000.00
    new Date(now - 1000 * 60 * 60 * 24 * 14).toISOString()
  );

  seedDefaultUserData(demoUserId);

  const insertTx = db.prepare(
    `INSERT INTO transactions (
      id, user_id, idempotency_key, type, direction, amount_paise,
      counterparty_name, counterparty_vpa, counterparty_phone, note,
      status, environment, psp_provider, psp_order_id, psp_payment_id,
      utr_rrn, failure_reason, risk_score, risk_flags, receipt_hash, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );

  const seedTxs = [
    {
      id: "SPW-20261120-9041",
      idem: "seed-tx-1",
      type: "QR_PAY",
      dir: "DEBIT",
      amt: 34000,
      name: "Blue Tokai Coffee",
      vpa: "bluetokai@okaxis",
      phone: null,
      note: "Pour-over & croissant — Indiranagar",
      status: "SUCCESS",
      utr: "432511982041",
      reason: null,
      offsetMin: 42,
    },
    {
      id: "SPW-20261120-8812",
      idem: "seed-tx-2",
      type: "UPI_SEND",
      dir: "DEBIT",
      amt: 245000,
      name: "Priya Nair",
      vpa: "priya.nair@okicici",
      phone: "+919820114502",
      note: "Dinner split Koramangala",
      status: "SUCCESS",
      utr: "432511904412",
      reason: null,
      offsetMin: 185,
    },
    {
      id: "SPW-20261120-8409",
      idem: "seed-tx-3",
      type: "WALLET_ADD",
      dir: "CREDIT",
      amt: 1500000,
      name: "HDFC Bank •••• 4821",
      vpa: "arjun.mehta@okhdfcbank",
      phone: null,
      note: "Sandbox wallet load via HDFC UPI",
      status: "SUCCESS",
      utr: "432511810922",
      reason: null,
      offsetMin: 410,
    },
    {
      id: "SPW-20261119-7730",
      idem: "seed-tx-4",
      type: "MERCHANT_PAY",
      dir: "DEBIT",
      amt: 189500,
      name: "BESCOM Electricity",
      vpa: "bescom.bill@okhdfcbank",
      phone: null,
      note: "Bill #BES-8829104",
      status: "PENDING",
      utr: "432510773019",
      reason: null,
      offsetMin: 980,
    },
    {
      id: "SPW-20261119-7104",
      idem: "seed-tx-5",
      type: "UPI_SEND",
      dir: "DEBIT",
      amt: 62000,
      name: "Rohan Sharma",
      vpa: "rohan.sharma@oksbi",
      phone: "+919910443218",
      note: "Badminton court booking",
      status: "FAILED",
      utr: null,
      reason: "NPCI Sandbox U30: Remitter PSP timeout — auto-reversed",
      offsetMin: 1520,
    },
  ];

  for (const tx of seedTxs) {
    const ts = new Date(now - tx.offsetMin * 60_000).toISOString();
    const receiptHash = crypto
      .createHash("sha256")
      .update(`${tx.id}:${tx.amt}:${tx.vpa}:${ts}`)
      .digest("hex")
      .slice(0, 24);
    insertTx.run(
      tx.id,
      demoUserId,
      tx.idem,
      tx.type,
      tx.dir,
      tx.amt,
      tx.name,
      tx.vpa,
      tx.phone,
      tx.note,
      tx.status,
      "sandbox",
      "razorpay_sandbox",
      `order_sbx_${tx.id.slice(-4)}`,
      `pay_sbx_${tx.id.slice(-4)}`,
      tx.utr,
      tx.reason,
      8,
      "[]",
      receiptHash,
      ts,
      ts
    );
  }

  db.prepare(
    `INSERT INTO collect_requests (id, user_id, requester_name, requester_vpa, amount_paise, note, status, environment, expires_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    "COL-20261120-101",
    demoUserId,
    "Ananya Iyer",
    "ananya.iyer@ybl",
    85000, // ₹850.00
    "Cab share to Kempegowda Airport",
    "PENDING",
    "sandbox",
    new Date(now + 1000 * 60 * 60 * 24).toISOString(),
    new Date(now - 1000 * 60 * 25).toISOString()
  );
}
