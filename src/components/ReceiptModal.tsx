import React, { useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  Clock,
  Download,
  Printer,
  RefreshCw,
  X,
} from "lucide-react";
import type { TransactionRecord, UserProfile } from "../types";
import { downloadTransactionReceipt, formatINR, formatIST } from "../utils/format";

interface ReceiptModalProps {
  transaction: TransactionRecord | null;
  user: UserProfile;
  token: string;
  onClose: () => void;
  onTransactionUpdated: (tx: TransactionRecord, updatedUser: UserProfile) => void;
}

export const ReceiptModal: React.FC<ReceiptModalProps> = ({
  transaction,
  user,
  token,
  onClose,
  onTransactionUpdated,
}) => {
  const [settling, setSettling] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!transaction) return null;

  const statusMeta =
    transaction.status === "SUCCESS"
      ? {
          label: "Payment Successful",
          color: "text-emerald-700",
          icon: <CheckCircle2 className="w-5 h-5 text-emerald-600" />,
        }
      : transaction.status === "PENDING"
        ? {
            label: "Awaiting PSP Settlement",
            color: "text-amber-700",
            icon: <Clock className="w-5 h-5 text-amber-600" />,
          }
        : {
            label: "Payment Failed",
            color: "text-red-700",
            icon: <AlertCircle className="w-5 h-5 text-red-600" />,
          };

  const handleSandboxWebhook = async (outcome: "SUCCESS" | "FAILED") => {
    setSettling(true);
    setError(null);
    try {
      const res = await fetch("/api/sandbox/settle-pending", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ txId: transaction.id, outcome }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Webhook settlement failed.");
      onTransactionUpdated(data.transaction, data.user);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to settle pending transaction.");
    } finally {
      setSettling(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-[#081124]/60 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="receipt-modal-title"
    >
      <div className="w-full sm:max-w-lg bg-white rounded-t-3xl sm:rounded-2xl border border-slate-200 shadow-2xl overflow-hidden max-h-[92vh] flex flex-col">
        <div className="bg-[#081124] text-white px-6 py-5 flex items-center justify-between shrink-0">
          <div>
            <p className="text-xs text-slate-300">
              {transaction.environment === "live"
                ? "Live UPI Receipt"
                : "Official Sandbox Receipt"}
            </p>
            <h3 id="receipt-modal-title" className="font-display text-lg font-bold mt-0.5">
              Transaction Details
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close receipt"
            className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl text-slate-300 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 overflow-y-auto space-y-5">
          <div className="text-center pb-5 border-b border-slate-200">
            <div className="inline-flex items-center gap-2 text-sm font-semibold mb-2">
              {statusMeta.icon}
              <span className={statusMeta.color}>{statusMeta.label}</span>
            </div>
            <div className="text-3xl font-mono font-bold tabular-nums text-[#081124]">
              {transaction.direction === "CREDIT" ? "+" : "-"}
              {formatINR(transaction.amount_paise)}
            </div>
            <div className="mt-1 text-xs text-slate-500">
              {formatIST(transaction.created_at)} · {transaction.type.replace("_", " ")}
            </div>
          </div>

          {transaction.failure_reason && (
            <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-800">
              <span className="font-semibold">Failure Reason: </span>
              {transaction.failure_reason}
            </div>
          )}

          <dl className="divide-y divide-slate-100 text-sm">
            <div className="py-2.5 flex justify-between gap-4">
              <dt className="text-slate-500">Transaction ID</dt>
              <dd className="font-mono text-xs font-medium text-[#081124] text-right">
                {transaction.id}
              </dd>
            </div>
            <div className="py-2.5 flex justify-between gap-4">
              <dt className="text-slate-500">Counterparty</dt>
              <dd className="font-medium text-[#081124] text-right">
                {transaction.counterparty_name}
              </dd>
            </div>
            <div className="py-2.5 flex justify-between gap-4">
              <dt className="text-slate-500">UPI ID (VPA)</dt>
              <dd className="font-mono text-xs text-[#081124] text-right">
                {transaction.counterparty_vpa}
              </dd>
            </div>
            <div className="py-2.5 flex justify-between gap-4">
              <dt className="text-slate-500">NPCI UTR / RRN</dt>
              <dd className="font-mono text-xs text-[#081124] text-right">
                {transaction.utr_rrn || "Awaiting settlement"}
              </dd>
            </div>
            <div className="py-2.5 flex justify-between gap-4">
              <dt className="text-slate-500">PSP Order / Ref</dt>
              <dd className="font-mono text-xs text-[#081124] text-right">
                {transaction.psp_order_id || "—"}
              </dd>
            </div>
            <div className="py-2.5 flex justify-between gap-4">
              <dt className="text-slate-500">Environment</dt>
              <dd className="font-medium text-[#081124] text-right uppercase text-xs">
                {transaction.environment} ({transaction.psp_provider})
              </dd>
            </div>
            <div className="py-2.5 flex justify-between gap-4">
              <dt className="text-slate-500">Note</dt>
              <dd className="text-[#081124] text-right">{transaction.note || "—"}</dd>
            </div>
            <div className="py-2.5 flex justify-between gap-4">
              <dt className="text-slate-500">Receipt Integrity Hash</dt>
              <dd className="font-mono text-xs text-slate-600 text-right">
                {transaction.receipt_hash}
              </dd>
            </div>
          </dl>

          {transaction.status === "PENDING" && transaction.environment === "sandbox" && (
            <div className="rounded-xl border border-slate-200 bg-[#F4F7FB] p-4 space-y-3">
              <div className="flex items-center gap-2 text-xs font-semibold text-[#081124]">
                <RefreshCw className="w-4 h-4 text-[#1D4ED8]" />
                <span>Sandbox Webhook Settlement</span>
              </div>
              <p className="text-xs text-slate-600">
                Dispatch an HMAC-SHA256 signed PSP webhook to settle or reverse this pending
                sandbox transaction.
              </p>
              <div className="flex items-center gap-2.5">
                <button
                  type="button"
                  disabled={settling}
                  onClick={() => handleSandboxWebhook("SUCCESS")}
                  className="flex-1 min-h-[44px] rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-medium px-3 py-2 transition-colors cursor-pointer"
                >
                  Settle Success
                </button>
                <button
                  type="button"
                  disabled={settling}
                  onClick={() => handleSandboxWebhook("FAILED")}
                  className="flex-1 min-h-[44px] rounded-xl bg-red-700 hover:bg-red-800 text-white text-xs font-medium px-3 py-2 transition-colors cursor-pointer"
                >
                  Trigger Failure &amp; Reverse
                </button>
              </div>
            </div>
          )}

          {error && (
            <div className="rounded-xl border border-red-200 bg-red-50 px-3.5 py-2.5 text-xs text-red-800">
              {error}
            </div>
          )}

          <div className="flex items-center gap-3 pt-2 no-print">
            <button
              type="button"
              onClick={() => window.print()}
              className="flex-1 min-h-[44px] rounded-xl border border-slate-300 hover:bg-slate-50 text-sm font-medium text-[#081124] px-4 py-2.5 flex items-center justify-center gap-2 transition-colors cursor-pointer"
            >
              <Printer className="w-4 h-4" />
              <span>Print / PDF</span>
            </button>
            <button
              type="button"
              onClick={() => downloadTransactionReceipt(transaction, user)}
              className="flex-1 min-h-[44px] rounded-xl bg-[#081124] hover:bg-[#0F1E3D] text-white text-sm font-medium px-4 py-2.5 flex items-center justify-center gap-2 transition-colors cursor-pointer"
            >
              <Download className="w-4 h-4" />
              <span>Download Receipt</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
