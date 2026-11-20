import React, { useState } from "react";
import {
  ArrowDownLeft,
  ArrowUpRight,
  CheckCircle2,
  Clock,
  AlertCircle,
  Plus,
  QrCode,
  Send,
  Wallet,
  X,
} from "lucide-react";
import type {
  BankAccount,
  CollectRequest,
  ComplianceStatus,
  DailyStats,
  TransactionRecord,
  UserProfile,
} from "../types";
import { formatINR, formatIST } from "../utils/format";
import type { PaymentIntent } from "./PaymentModal";

interface WalletOverviewProps {
  user: UserProfile;
  bankAccounts: BankAccount[];
  transactions: TransactionRecord[];
  collectRequests: CollectRequest[];
  dailyStats: DailyStats;
  compliance: ComplianceStatus | null;
  token: string;
  onNavigate: (tab: "overview" | "pay" | "qr" | "history" | "studio" | "settings") => void;
  onStartPayment: (intent: PaymentIntent) => void;
  onSelectTransaction: (tx: TransactionRecord) => void;
  onRefreshData: () => Promise<void>;
  onUserUpdated: (u: UserProfile) => void;
}

export const WalletOverview: React.FC<WalletOverviewProps> = ({
  user,
  bankAccounts,
  transactions,
  collectRequests,
  dailyStats,
  compliance,
  token,
  onNavigate,
  onStartPayment,
  onSelectTransaction,
  onRefreshData,
  onUserUpdated,
}) => {
  const [walletAction, setWalletAction] = useState<"add" | "withdraw" | null>(null);
  const [walletAmount, setWalletAmount] = useState("1000");
  const [walletBusy, setWalletBusy] = useState(false);
  const [walletError, setWalletError] = useState<string | null>(null);

  const primaryBank = bankAccounts.find((b) => b.is_primary === 1) || bankAccounts[0];
  const pendingCollects = collectRequests.filter((c) => c.status === "PENDING");

  const handleWalletTransfer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!walletAction) return;
    setWalletBusy(true);
    setWalletError(null);
    try {
      const endpoint = walletAction === "add" ? "/api/wallet/add" : "/api/wallet/withdraw";
      const res = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
          "Idempotency-Key": `spw-wallet-${crypto.randomUUID()}`,
        },
        body: JSON.stringify({ amountRupees: Number(walletAmount) }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Wallet operation failed.");
      onUserUpdated(data.user);
      await onRefreshData();
      setWalletAction(null);
      if (data.transaction) {
        onSelectTransaction(data.transaction);
      }
    } catch (err) {
      setWalletError(err instanceof Error ? err.message : "Operation failed.");
    } finally {
      setWalletBusy(false);
    }
  };

  const handleDeclineCollect = async (id: string) => {
    await fetch(`/api/collect-requests/${id}/respond`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ action: "DECLINE" }),
    });
    await onRefreshData();
  };

  return (
    <div className="space-y-6">
      {/* Top 2-Column Hero Balance & Daily Summary */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
        {/* Dominant Dark Navy Wallet Balance Card */}
        <div className="lg:col-span-7 bg-[#081124] text-white rounded-2xl p-6 sm:p-8 flex flex-col justify-between">
          <div>
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-300">
              <span>
                {compliance?.activeMode === "live"
                  ? "Live TPAP Wallet Ledger"
                  : "Official Sandbox Wallet Ledger"}
              </span>
              <span className="font-mono">{user.vpa}</span>
            </div>

            <div className="mt-5">
              <div className="text-xs text-slate-300">Available Balance</div>
              <div className="mt-1 font-display text-3xl sm:text-4xl font-bold font-mono tabular-nums tracking-tight">
                {formatINR(user.walletBalancePaise)}
              </div>
              {primaryBank && (
                <div className="mt-2 text-xs text-slate-300">
                  Primary Rail: {primaryBank.bank_name} {primaryBank.account_mask} ·{" "}
                  <span className="font-mono">{primaryBank.ifsc}</span>
                </div>
              )}
            </div>
          </div>

          <div className="mt-8 grid grid-cols-2 sm:grid-cols-4 gap-2.5">
            <button
              type="button"
              onClick={() => onNavigate("pay")}
              className="min-h-[46px] rounded-xl bg-white hover:bg-slate-100 text-[#081124] text-xs font-semibold px-3 py-2.5 flex items-center justify-center gap-1.5 transition-colors whitespace-nowrap cursor-pointer"
            >
              <Send className="w-3.5 h-3.5" />
              <span>Send UPI</span>
            </button>
            <button
              type="button"
              onClick={() => onNavigate("qr")}
              className="min-h-[46px] rounded-xl bg-white/10 hover:bg-white/20 text-white text-xs font-medium px-3 py-2.5 flex items-center justify-center gap-1.5 transition-colors whitespace-nowrap cursor-pointer"
            >
              <QrCode className="w-3.5 h-3.5" />
              <span>Scan QR</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setWalletAction("add");
                setWalletAmount("1000");
                setWalletError(null);
              }}
              className="min-h-[46px] rounded-xl bg-white/10 hover:bg-white/20 text-white text-xs font-medium px-3 py-2.5 flex items-center justify-center gap-1.5 transition-colors whitespace-nowrap cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Add Money</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setWalletAction("withdraw");
                setWalletAmount("500");
                setWalletError(null);
              }}
              className="min-h-[46px] rounded-xl bg-white/10 hover:bg-white/20 text-white text-xs font-medium px-3 py-2.5 flex items-center justify-center gap-1.5 transition-colors whitespace-nowrap cursor-pointer"
            >
              <Wallet className="w-3.5 h-3.5" />
              <span>Withdraw</span>
            </button>
          </div>
        </div>

        {/* Right: Daily Telemetry & Card Visual */}
        <div className="lg:col-span-5 bg-white rounded-2xl border border-slate-200 p-6 flex flex-col justify-between space-y-5">
          <div>
            <h2 className="font-display text-base font-bold text-[#081124]">
              Daily Activity Summary
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Settled INR volume today (IST) · Daily limit{" "}
              <span className="font-mono tabular-nums">
                {formatINR(user.dailyLimitPaise)}
              </span>
            </p>
          </div>

          <div className="grid grid-cols-3 gap-3 py-2 border-y border-slate-100">
            <div>
              <div className="text-xs text-slate-500">Spent Today</div>
              <div className="mt-1 font-mono text-base font-bold tabular-nums text-[#081124]">
                {formatINR(dailyStats.spentTodayPaise)}
              </div>
            </div>
            <div>
              <div className="text-xs text-slate-500">Received</div>
              <div className="mt-1 font-mono text-base font-bold tabular-nums text-emerald-700">
                {formatINR(dailyStats.receivedTodayPaise)}
              </div>
            </div>
            <div>
              <div className="text-xs text-slate-500">Pending</div>
              <div className="mt-1 font-mono text-base font-bold tabular-nums text-amber-700">
                {dailyStats.pendingCount}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-4">
            <img
              src="/src/assets/images/smartpay_card_hero_1795201838283.jpg"
              alt="SmartPay virtual titanium card"
              referrerPolicy="no-referrer"
              className="w-24 h-16 rounded-xl object-cover border border-slate-200 shrink-0"
            />
            <div className="min-w-0">
              <div className="text-sm font-semibold text-[#081124]">
                KYC Status: {user.kycStatus}
              </div>
              <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">
                {user.biometricEnabled
                  ? `Biometric lock enabled (${user.biometricDeviceLabel || "Device Passkey"})`
                  : "Enable device biometrics in Account Settings for step-up signing."}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Inline Add / Withdraw Panel */}
      {walletAction && (
        <form
          onSubmit={handleWalletTransfer}
          className="bg-white rounded-2xl border border-slate-200 p-6 space-y-4"
        >
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-display text-base font-bold text-[#081124]">
                {walletAction === "add"
                  ? "Add Money to SmartPay Wallet"
                  : "Withdraw Money to Linked Bank"}
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                {primaryBank
                  ? `${primaryBank.bank_name} ${primaryBank.account_mask} (${primaryBank.vpa})`
                  : "Primary Bank Rail"}{" "}
                · {user.environmentMode.toUpperCase()}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setWalletAction(null)}
              aria-label="Close wallet transfer form"
              className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl text-slate-500 hover:bg-slate-100 cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          <div className="flex flex-col sm:flex-row gap-3 items-stretch sm:items-end">
            <div className="flex-1">
              <label
                htmlFor="wallet-transfer-amt"
                className="block text-xs font-medium text-slate-700 mb-1.5"
              >
                Amount (INR)
              </label>
              <input
                id="wallet-transfer-amt"
                type="number"
                min="1"
                max="100000"
                step="0.01"
                required
                value={walletAmount}
                onChange={(e) => setWalletAmount(e.target.value)}
                className="w-full rounded-xl border border-slate-300 px-4 py-2.5 text-base font-mono font-semibold tabular-nums text-[#081124] outline-none focus:border-[#081124]"
              />
            </div>
            <div className="flex items-center gap-2">
              {["500", "2000", "5000"].map((preset) => (
                <button
                  key={preset}
                  type="button"
                  onClick={() => setWalletAmount(preset)}
                  className="min-h-[44px] px-3 rounded-xl border border-slate-200 hover:bg-slate-50 text-xs font-mono font-medium text-[#081124] cursor-pointer"
                >
                  ₹{preset}
                </button>
              ))}
            </div>
            <button
              type="submit"
              disabled={walletBusy}
              className="min-h-[46px] rounded-xl bg-[#081124] hover:bg-[#0F1E3D] disabled:opacity-50 text-white text-sm font-medium px-6 py-2.5 whitespace-nowrap cursor-pointer"
            >
              {walletBusy
                ? "Processing..."
                : walletAction === "add"
                  ? "Confirm Top-Up"
                  : "Withdraw Funds"}
            </button>
          </div>

          {walletError && (
            <div className="rounded-xl border border-red-200 bg-red-50 px-3.5 py-2.5 text-xs text-red-800">
              {walletError}
            </div>
          )}
        </form>
      )}

      {/* Pending Collect Requests */}
      {pendingCollects.length > 0 && (
        <div className="bg-white rounded-2xl border border-slate-200 p-6 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-display text-base font-bold text-[#081124]">
                Incoming UPI Collect Requests
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Approve or decline payment requests sent to {user.vpa}
              </p>
            </div>
          </div>

          <div className="divide-y divide-slate-100">
            {pendingCollects.map((req) => (
              <div
                key={req.id}
                className="py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-4"
              >
                <div>
                  <div className="font-medium text-sm text-[#081124]">
                    {req.requester_name}{" "}
                    <span className="font-mono text-xs text-slate-500">
                      ({req.requester_vpa})
                    </span>
                  </div>
                  <div className="text-xs text-slate-500 mt-0.5">
                    {req.note || "Collect request"} · {formatIST(req.created_at)}
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <span className="font-mono text-base font-bold tabular-nums text-[#081124]">
                    {formatINR(req.amount_paise)}
                  </span>
                  <button
                    type="button"
                    onClick={() => handleDeclineCollect(req.id)}
                    className="min-h-[44px] px-3.5 rounded-xl border border-slate-300 hover:bg-slate-50 text-xs font-medium text-slate-700 cursor-pointer"
                  >
                    Decline
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      onStartPayment({
                        vpa: req.requester_vpa,
                        recipientName: req.requester_name,
                        amountRupees: (req.amount_paise / 100).toFixed(2),
                        amountLocked: true,
                        note: req.note || "Collect Request",
                        type: "UPI_SEND",
                        collectRequestId: req.id,
                      })
                    }
                    className="min-h-[44px] px-4 rounded-xl bg-[#081124] hover:bg-[#0F1E3D] text-white text-xs font-medium cursor-pointer"
                  >
                    Approve &amp; Pay
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Recent Daily Transactions */}
      <div className="bg-white rounded-2xl border border-slate-200 p-6 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="font-display text-base font-bold text-[#081124]">
              Recent Transactions
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Click any entry to inspect UTR/RRN or download a receipt
            </p>
          </div>
          <button
            type="button"
            onClick={() => onNavigate("history")}
            className="text-xs font-medium text-[#1D4ED8] hover:underline whitespace-nowrap cursor-pointer"
          >
            View All History
          </button>
        </div>

        {transactions.length === 0 ? (
          <div className="py-10 text-center text-sm text-slate-500">
            No transactions recorded yet. Send a UPI payment or scan a QR to begin.
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {transactions.slice(0, 6).map((tx) => (
              <button
                key={tx.id}
                type="button"
                onClick={() => onSelectTransaction(tx)}
                className="w-full min-h-[60px] py-3 px-2 -mx-2 rounded-xl hover:bg-[#F4F7FB] flex items-center justify-between gap-4 text-left transition-colors cursor-pointer"
              >
                <div className="flex items-center gap-3.5 min-w-0">
                  <div className="w-10 h-10 rounded-xl bg-[#F4F7FB] border border-slate-200 flex items-center justify-center shrink-0 text-[#081124]">
                    {tx.direction === "CREDIT" ? (
                      <ArrowDownLeft className="w-4 h-4 text-emerald-700" />
                    ) : (
                      <ArrowUpRight className="w-4 h-4 text-[#081124]" />
                    )}
                  </div>
                  <div className="min-w-0">
                    <div className="font-medium text-sm text-[#081124] truncate">
                      {tx.counterparty_name}
                    </div>
                    <div className="text-xs text-slate-500 truncate mt-0.5">
                      {tx.counterparty_vpa} · {formatIST(tx.created_at)}
                    </div>
                  </div>
                </div>

                <div className="text-right shrink-0">
                  <div
                    className={`font-mono text-sm font-bold tabular-nums ${
                      tx.direction === "CREDIT" ? "text-emerald-700" : "text-[#081124]"
                    }`}
                  >
                    {tx.direction === "CREDIT" ? "+" : "-"}
                    {formatINR(tx.amount_paise)}
                  </div>
                  <div className="mt-0.5 inline-flex items-center gap-1 text-[11px] font-medium">
                    {tx.status === "SUCCESS" ? (
                      <>
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                        <span className="text-emerald-700">Success</span>
                      </>
                    ) : tx.status === "PENDING" ? (
                      <>
                        <Clock className="w-3.5 h-3.5 text-amber-600" />
                        <span className="text-amber-700">Pending</span>
                      </>
                    ) : (
                      <>
                        <AlertCircle className="w-3.5 h-3.5 text-red-600" />
                        <span className="text-red-700">Failed</span>
                      </>
                    )}
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
