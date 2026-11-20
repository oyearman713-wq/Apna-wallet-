export type PaymentEnvironment = "sandbox" | "live";

export interface UserProfile {
  id: string;
  phone: string;
  fullName: string;
  email: string | null;
  vpa: string;
  kycStatus: "PENDING" | "VERIFIED";
  kycPanLast4: string | null;
  walletBalancePaise: number;
  environmentMode: PaymentEnvironment;
  biometricEnabled: boolean;
  biometricDeviceLabel: string | null;
  dailyLimitPaise: number;
  createdAt: string;
}

export interface BankAccount {
  id: string;
  user_id: string;
  bank_name: string;
  account_mask: string;
  ifsc: string;
  vpa: string;
  is_primary: number;
  psp_partner: string;
  verified_at: string;
}

export interface Contact {
  id: string;
  user_id: string;
  name: string;
  phone: string | null;
  vpa: string;
  verified_name: string;
  is_merchant: number;
  merchant_code: string | null;
  category: string;
}

export interface TransactionRecord {
  id: string;
  user_id: string;
  idempotency_key: string;
  type: "UPI_SEND" | "UPI_COLLECT" | "WALLET_ADD" | "WALLET_WITHDRAW" | "QR_PAY" | "MERCHANT_PAY";
  direction: "DEBIT" | "CREDIT";
  amount_paise: number;
  counterparty_name: string;
  counterparty_vpa: string;
  counterparty_phone: string | null;
  note: string | null;
  status: "PENDING" | "SUCCESS" | "FAILED";
  environment: PaymentEnvironment;
  psp_provider: string;
  psp_order_id: string | null;
  psp_payment_id: string | null;
  utr_rrn: string | null;
  failure_reason: string | null;
  risk_score: number;
  risk_flags: string;
  receipt_hash: string;
  created_at: string;
  updated_at: string;
}

export interface CollectRequest {
  id: string;
  user_id: string;
  requester_name: string;
  requester_vpa: string;
  amount_paise: number;
  note: string | null;
  status: "PENDING" | "APPROVED" | "DECLINED" | "EXPIRED";
  environment: PaymentEnvironment;
  expires_at: string;
  created_at: string;
}

export interface ComplianceStatus {
  activeMode: PaymentEnvironment;
  pspProvider: string;
  liveReady: boolean;
  requirements: {
    hasRazorpayKeys: boolean;
    hasWebhookSecret: boolean;
    hasNpciTpapLicense: boolean;
  };
  notice: string;
}

export interface DailyStats {
  spentTodayPaise: number;
  receivedTodayPaise: number;
  pendingCount: number;
}

export interface AuditLogRecord {
  id: string;
  event_type: string;
  actor_ip: string | null;
  device_id: string | null;
  details_json: string;
  created_at: string;
}

export interface ParsedUpiQr {
  vpa: string;
  payeeName: string;
  amountRupees: string;
  amountLocked: boolean;
  note: string;
  merchantCode: string;
  currency: string;
  rawUri: string;
}
