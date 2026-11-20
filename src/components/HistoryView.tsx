import React, { useMemo, useState } from "react";
import { AlertCircle, CheckCircle2, Clock, Download, Search } from "lucide-react";
import type { TransactionRecord, UserProfile } from "../types";
import { downloadTransactionReceipt, formatINR, formatIST } from "../utils/format";

interface HistoryViewProps {
  transactions: TransactionRecord[];
  user: UserProfile;
  onSelectTransaction: (tx: TransactionRecord) => void;
}

export const HistoryView: React.FC<HistoryViewProps> = ({
  transactions,
  user,
  onSelectTransaction,
}) => {
  const [statusFilter, setStatusFilter] = useState<"ALL" | "SUCCESS" | "PENDING" | "FAILED">(
    "ALL"
  );
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return transactions.filter((tx) => {
      if (statusFilter !== "ALL" && tx.status !== statusFilter) return false;
      if (!q) return true;
      return (
        tx.id.toLowerCase().includes(q) ||
        tx.counterparty_name.toLowerCase().includes(q) ||
        tx.counterparty_vpa.toLowerCase().includes(q) ||
        (tx.utr_rrn || "").toLowerCase().includes(q) ||
        (tx.note || "").toLowerCase().includes(q)
      );
    });
  }, [transactions, statusFilter, query]);

  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-6 space-y-5">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="font-display text-lg font-bold text-[#081124]">
            Transaction History &amp; Receipts
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Complete audit ledger with NPCI UTR/RRN references and downloadable receipts
          </p>
        </div>

        <div className="flex items-center gap-1 p-1 bg-[#F4F7FB] rounded-xl self-start">
          {(["ALL", "SUCCESS", "PENDING", "FAILED"] as const).map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => setStatusFilter(tab)}
              className={`min-h-[38px] px-3.5 py-1.5 rounded-lg text-xs font-medium transition-colors whitespace-nowrap cursor-pointer ${
                statusFilter === tab
                  ? "bg-white text-[#081124] shadow-sm"
                  : "text-slate-600 hover:text-[#081124]"
              }`}
            >
              {tab === "ALL"
                ? "All"
                : tab === "SUCCESS"
                  ? "Successful"
                  : tab === "PENDING"
                    ? "Pending"
                    : "Failed"}
            </button>
          ))}
        </div>
      </div>

      <div className="relative">
        <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by Transaction ID, UTR, recipient name, or UPI VPA..."
          className="w-full rounded-xl border border-slate-300 pl-10 pr-4 py-2.5 text-sm text-[#081124] outline-none focus:border-[#081124]"
        />
      </div>

      {filtered.length === 0 ? (
        <div className="py-12 text-center text-sm text-slate-500">
          No transactions match your current filter.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-200 text-xs font-medium text-slate-500">
                <th className="py-3 pr-4">Transaction ID</th>
                <th className="py-3 px-4">Date &amp; Time (IST)</th>
                <th className="py-3 px-4">Recipient / VPA</th>
                <th className="py-3 px-4">Status</th>
                <th className="py-3 px-4 text-right">Amount</th>
                <th className="py-3 pl-4 text-right">Receipt</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-sm">
              {filtered.map((tx) => (
                <tr
                  key={tx.id}
                  onClick={() => onSelectTransaction(tx)}
                  className="hover:bg-[#F4F7FB] transition-colors cursor-pointer"
                >
                  <td className="py-3.5 pr-4 font-mono text-xs font-medium text-[#081124] whitespace-nowrap">
                    {tx.id}
                  </td>
                  <td className="py-3.5 px-4 text-xs text-slate-600 whitespace-nowrap tabular-nums">
                    {formatIST(tx.created_at)}
                  </td>
                  <td className="py-3.5 px-4">
                    <div className="font-medium text-[#081124]">{tx.counterparty_name}</div>
                    <div className="font-mono text-xs text-slate-500">{tx.counterparty_vpa}</div>
                  </td>
                  <td className="py-3.5 px-4 whitespace-nowrap">
                    <span className="inline-flex items-center gap-1.5 text-xs font-medium">
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
                    </span>
                  </td>
                  <td
                    className={`py-3.5 px-4 text-right font-mono font-bold tabular-nums whitespace-nowrap ${
                      tx.direction === "CREDIT" ? "text-emerald-700" : "text-[#081124]"
                    }`}
                  >
                    {tx.direction === "CREDIT" ? "+" : "-"}
                    {formatINR(tx.amount_paise)}
                  </td>
                  <td
                    className="py-3.5 pl-4 text-right whitespace-nowrap"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <button
                      type="button"
                      onClick={() => downloadTransactionReceipt(tx, user)}
                      aria-label={`Download receipt for ${tx.id}`}
                      className="min-h-[40px] px-3 rounded-lg border border-slate-200 hover:bg-white text-xs font-medium text-[#081124] inline-flex items-center gap-1.5 cursor-pointer"
                    >
                      <Download className="w-3.5 h-3.5" />
                      <span>Receipt</span>
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};
