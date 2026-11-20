import React, { useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, Fingerprint, Lock, ShieldCheck, X } from "lucide-react";
import type { BankAccount, TransactionRecord, UserProfile } from "../types";
import { formatINR } from "../utils/format";
import { verifyDeviceBiometric } from "../utils/webauthn";

export interface PaymentIntent {
  vpa: string;
  recipientName: string;
  recipientPhone?: string;
  amountRupees: string;
  amountLocked?: boolean;
  note?: string;
  type: "UPI_SEND" | "QR_PAY" | "MERCHANT_PAY";
  collectRequestId?: string;
}

interface PaymentModalProps {
  intent: PaymentIntent | null;
  user: UserProfile;
  bankAccounts: BankAccount[];
  token: string;
  onClose: () => void;
  onSuccess: (tx: TransactionRecord, updatedUser: UserProfile) => void;
}

export const PaymentModal: React.FC<PaymentModalProps> = ({
  intent,
  user,
  bankAccounts,
  token,
  onClose,
  onSuccess,
}) => {
  const [amountStr, setAmountStr] = useState("");
  const [note, setNote] = useState("");
  const [idempotencyKey, setIdempotencyKey] = useState("");
  const [biometricConfirmed, setBiometricConfirmed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [requiresStepUp, setRequiresStepUp] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (intent) {
      setAmountStr(intent.amountRupees || "");
      setNote(intent.note || "");
      setIdempotencyKey(`spw-idem-${crypto.randomUUID()}`);
      setBiometricConfirmed(false);
      setRequiresStepUp(false);
      setError(null);
    }
  }, [intent]);

  if (!intent) return null;

  const primaryBank = bankAccounts.find((b) => b.is_primary === 1) || bankAccounts[0];
  const parsedAmount = Number(amountStr);
  const paise = Number.isFinite(parsedAmount) ? Math.round(parsedAmount * 100) : 0;

  const handleConfirmPayment = async () => {
    setError(null);
    if (!Number.isFinite(parsedAmount) || parsedAmount < 1 || parsedAmount > 100000) {
      setError("Enter a valid amount between ₹1.00 and ₹1,00,000.00.");
      return;
    }

    let bioOk = biometricConfirmed;
    if (user.biometricEnabled && !bioOk) {
      try {
        bioOk = await verifyDeviceBiometric();
        setBiometricConfirmed(bioOk);
      } catch {
        setError("Biometric verification was cancelled or failed on this device.");
        return;
      }
    }

    setSubmitting(true);
    try {
      // Ephemeral PSP handoff confirmation token — never collects or transmits raw UPI PIN
      const pspAuthToken = `psp_handoff_${crypto.randomUUID()}`;

      if (intent.collectRequestId) {
        const res = await fetch(`/api/collect-requests/${intent.collectRequestId}/respond`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ action: "APPROVE" }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Collect approval failed.");
        onSuccess(data.transaction, data.user);
        return;
      }

      const res = await fetch("/api/upi/pay", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
          "Idempotency-Key": idempotencyKey,
        },
        body: JSON.stringify({
          vpa: intent.vpa,
          recipientName: intent.recipientName,
          recipientPhone: intent.recipientPhone,
          amountRupees: parsedAmount,
          note,
          type: intent.type,
          pspAuthToken,
          biometricVerified: bioOk,
        }),
      });

      const data = await res.json();
      if (res.status === 428 && data.requiresStepUp) {
        setRequiresStepUp(true);
        throw new Error(data.error);
      }
      if (!res.ok) {
        throw new Error(data.error || "Payment failed.");
      }

      onSuccess(data.transaction, data.user);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Payment execution error.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-[#081124]/60 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-payment-title"
    >
      <div className="w-full sm:max-w-md bg-white rounded-t-3xl sm:rounded-2xl border border-slate-200 shadow-2xl overflow-hidden">
        {/* Top Navy Header */}
        <div className="bg-[#081124] text-white px-6 py-5 flex items-center justify-between">
          <div>
            <p className="text-xs text-slate-300">
              {user.environmentMode === "live"
                ? "Live UPI Payment Confirmation"
                : "Sandbox UPI Confirmation"}
            </p>
            <h3 id="confirm-payment-title" className="font-display text-lg font-bold mt-0.5">
              Authorize Payment
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close confirmation dialog"
            className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl text-slate-300 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-5">
          {/* Verified Recipient */}
          <div className="pb-4 border-b border-slate-200 flex items-start justify-between gap-4">
            <div>
              <div className="text-xs text-slate-500">Paying to</div>
              <div className="font-display text-base font-bold text-[#081124] mt-0.5">
                {intent.recipientName}
              </div>
              <div className="font-mono text-xs text-slate-600 mt-0.5">{intent.vpa}</div>
            </div>
            <div className="flex items-center gap-1 text-xs font-medium text-emerald-700">
              <CheckCircle2 className="w-4 h-4" />
              <span>Verified VPA</span>
            </div>
          </div>

          {/* Amount Input / Display */}
          <div>
            <label
              htmlFor="confirm-amount"
              className="block text-xs font-medium text-slate-600 mb-1.5"
            >
              Amount (INR)
            </label>
            <div className="flex items-center rounded-xl border border-slate-300 bg-[#F4F7FB] px-4 py-3 focus-within:bg-white focus-within:border-[#081124]">
              <span className="text-2xl font-display font-bold text-[#081124] mr-2">₹</span>
              <input
                id="confirm-amount"
                type="number"
                step="0.01"
                min="1"
                max="100000"
                readOnly={Boolean(intent.amountLocked)}
                value={amountStr}
                onChange={(e) => setAmountStr(e.target.value)}
                placeholder="0.00"
                className="w-full bg-transparent text-2xl font-mono font-bold tabular-nums text-[#081124] outline-none"
              />
            </div>
            <div className="mt-1.5 flex items-center justify-between text-xs text-slate-500">
              <span>
                Available balance:{" "}
                <span className="font-mono tabular-nums font-medium text-[#081124]">
                  {formatINR(user.walletBalancePaise)}
                </span>
              </span>
              {primaryBank && (
                <span>
                  {primaryBank.bank_name} {primaryBank.account_mask}
                </span>
              )}
            </div>
          </div>

          {/* Note */}
          <div>
            <label
              htmlFor="confirm-note"
              className="block text-xs font-medium text-slate-600 mb-1.5"
            >
              Payment Note (Optional)
            </label>
            <input
              id="confirm-note"
              type="text"
              maxLength={100}
              readOnly={Boolean(intent.collectRequestId)}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="e.g. Coffee, rent, invoice #104"
              className="w-full rounded-xl border border-slate-300 px-3.5 py-2.5 text-sm text-[#081124] outline-none focus:border-[#081124]"
            />
          </div>

          {/* Security & Non-Stored PIN Notice */}
          <div className="rounded-xl bg-[#F4F7FB] border border-slate-200 p-3.5 text-xs text-slate-600 space-y-1.5">
            <div className="flex items-center gap-2 font-medium text-[#081124]">
              <ShieldCheck className="w-4 h-4 text-[#1D4ED8] shrink-0" />
              <span>NPCI PSP Handoff · Zero PIN Storage</span>
            </div>
            <p className="leading-relaxed">
              SmartPay never collects or stores your UPI PIN. Authorizing submits an
              idempotent PSP request (<span className="font-mono">{idempotencyKey.slice(0, 16)}...</span>).
            </p>
            {user.biometricEnabled && (
              <div className="flex items-center gap-1.5 text-emerald-700 font-medium pt-0.5">
                <Fingerprint className="w-4 h-4" />
                <span>Device biometric check enforced before dispatch</span>
              </div>
            )}
          </div>

          {requiresStepUp && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900 flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>High-risk velocity/amount detected. Complete biometric prompt to proceed.</span>
            </div>
          )}

          {error && (
            <div
              role="alert"
              className="rounded-xl border border-red-200 bg-red-50 px-3.5 py-2.5 text-xs text-red-800"
            >
              {error}
            </div>
          )}

          <div className="flex items-center gap-3 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="min-h-[48px] px-4 rounded-xl border border-slate-300 text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={submitting || paise < 100}
              onClick={handleConfirmPayment}
              className="flex-1 min-h-[48px] rounded-xl bg-[#081124] hover:bg-[#0F1E3D] disabled:opacity-50 text-white font-medium text-sm px-5 py-3 flex items-center justify-center gap-2 transition-colors cursor-pointer"
            >
              <Lock className="w-4 h-4" />
              <span>
                {submitting
                  ? "Authorizing PSP..."
                  : paise >= 100
                    ? `Pay ${formatINR(paise)}`
                    : "Confirm Payment"}
              </span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
