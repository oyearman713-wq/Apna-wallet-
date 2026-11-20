import React, { useCallback, useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  History,
  LayoutDashboard,
  LogOut,
  QrCode,
  Send,
  Settings,
  Wand2,
} from "lucide-react";
import { AccountSettingsView } from "./components/AccountSettingsView";
import { AuthScreen } from "./components/AuthScreen";
import { HistoryView } from "./components/HistoryView";
import { PaymentModal, type PaymentIntent } from "./components/PaymentModal";
import { PayView } from "./components/PayView";
import { PointEditStudio } from "./components/PointEditStudio";
import { QrPaymentView } from "./components/QrPaymentView";
import { ReceiptModal } from "./components/ReceiptModal";
import { WalletOverview } from "./components/WalletOverview";
import type {
  BankAccount,
  CollectRequest,
  ComplianceStatus,
  Contact,
  DailyStats,
  TransactionRecord,
  UserProfile,
} from "./types";

type ActiveTab = "overview" | "pay" | "qr" | "history" | "studio" | "settings";

export default function App() {
  // Bearer token kept strictly in React memory (never persisted in localStorage)
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<UserProfile | null>(null);
  const [bankAccounts, setBankAccounts] = useState<BankAccount[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [transactions, setTransactions] = useState<TransactionRecord[]>([]);
  const [collectRequests, setCollectRequests] = useState<CollectRequest[]>([]);
  const [dailyStats, setDailyStats] = useState<DailyStats>({
    spentTodayPaise: 0,
    receivedTodayPaise: 0,
    pendingCount: 0,
  });
  const [compliance, setCompliance] = useState<ComplianceStatus | null>(null);

  const [activeTab, setActiveTab] = useState<ActiveTab>("overview");
  const [paymentIntent, setPaymentIntent] = useState<PaymentIntent | null>(null);
  const [selectedTx, setSelectedTx] = useState<TransactionRecord | null>(null);

  useEffect(() => {
    const loadCompliance = async () => {
      try {
        const res = await fetch("/api/compliance");
        if (res.ok) {
          const data = (await res.json()) as ComplianceStatus;
          setCompliance(data);
        }
      } catch {
        // Ignore transient startup errors
      }
    };
    void loadCompliance();
  }, []);

  const refreshWalletData = useCallback(async () => {
    if (!token) return;
    const headers = { Authorization: `Bearer ${token}` };

    const [meRes, txRes, contactsRes, collectRes] = await Promise.all([
      fetch("/api/auth/me", { headers }),
      fetch("/api/transactions", { headers }),
      fetch("/api/contacts", { headers }),
      fetch("/api/collect-requests", { headers }),
    ]);

    if (meRes.status === 401) {
      setToken(null);
      setUser(null);
      return;
    }

    if (meRes.ok) {
      const meData = await meRes.json();
      setUser(meData.user);
      setBankAccounts(meData.bankAccounts || []);
      setCompliance(meData.compliance || null);
    }
    if (txRes.ok) {
      const txData = await txRes.json();
      setTransactions(txData.transactions || []);
      if (txData.dailyStats) setDailyStats(txData.dailyStats);
    }
    if (contactsRes.ok) {
      const cData = await contactsRes.json();
      setContacts(cData.contacts || []);
    }
    if (collectRes.ok) {
      const colData = await collectRes.json();
      setCollectRequests(colData.collectRequests || []);
    }
  }, [token]);

  useEffect(() => {
    if (token) {
      void refreshWalletData();
    }
  }, [token, refreshWalletData]);

  const handleLogout = async () => {
    if (token) {
      try {
        await fetch("/api/auth/logout", {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
        });
      } catch {
        // Proceed with local sign-out
      }
    }
    setToken(null);
    setUser(null);
    setTransactions([]);
    setContacts([]);
    setCollectRequests([]);
    setActiveTab("overview");
  };

  if (!token || !user) {
    return (
      <AuthScreen
        compliance={compliance}
        onAuthenticated={(payload) => {
          setToken(payload.token);
          setUser(payload.user);
          setBankAccounts(payload.bankAccounts);
          setCompliance(payload.compliance);
        }}
      />
    );
  }

  const navItems: Array<{
    id: ActiveTab;
    label: string;
    mobileLabel: string;
    icon: React.ReactNode;
  }> = [
    {
      id: "overview",
      label: "Wallet Overview",
      mobileLabel: "Home",
      icon: <LayoutDashboard className="w-5 h-5" />,
    },
    {
      id: "pay",
      label: "Send & Collect",
      mobileLabel: "Pay",
      icon: <Send className="w-5 h-5" />,
    },
    {
      id: "qr",
      label: "Scan & Pay QR",
      mobileLabel: "Scan QR",
      icon: <QrCode className="w-5 h-5" />,
    },
    {
      id: "history",
      label: "Transactions",
      mobileLabel: "History",
      icon: <History className="w-5 h-5" />,
    },
    {
      id: "studio",
      label: "Point & Edit Studio",
      mobileLabel: "Studio",
      icon: <Wand2 className="w-5 h-5" />,
    },
    {
      id: "settings",
      label: "Account & Security",
      mobileLabel: "Account",
      icon: <Settings className="w-5 h-5" />,
    },
  ];

  const activeTitle =
    navItems.find((item) => item.id === activeTab)?.label || "SmartPay Wallet";

  return (
    <div className="min-h-screen bg-[#F4F7FB] text-[#0A162E] flex">
      {/* Desktop Navy Sidebar */}
      <aside className="hidden lg:flex lg:w-64 lg:flex-col lg:fixed lg:inset-y-0 bg-[#081124] text-white border-r border-slate-800">
        <div className="px-6 py-6 border-b border-white/10">
          <div className="font-display text-xl font-bold tracking-tight whitespace-nowrap">
            SmartPay Wallet
          </div>
          <div className="mt-1 text-xs text-slate-300 font-mono">
            {compliance?.activeMode === "live" ? "Live TPAP Network" : "Sandbox Mode"}
          </div>
        </div>

        <nav className="flex-1 px-3 py-5 space-y-1">
          {navItems.map((item) => {
            const active = activeTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setActiveTab(item.id)}
                className={`w-full min-h-[44px] px-3.5 py-2.5 rounded-xl text-sm font-medium flex items-center gap-3 transition-colors whitespace-nowrap cursor-pointer ${
                  active
                    ? "bg-white text-[#081124]"
                    : "text-slate-300 hover:text-white hover:bg-white/10"
                }`}
              >
                {item.icon}
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>

        <div className="p-4 border-t border-white/10 space-y-3">
          <div className="flex items-center gap-3 px-2">
            <img
              src="/src/assets/images/avatar_user_arjun_1795201837873.jpg"
              alt={user.fullName}
              referrerPolicy="no-referrer"
              className="w-9 h-9 rounded-full object-cover border border-white/20 shrink-0"
            />
            <div className="min-w-0">
              <div className="text-xs font-semibold text-white truncate">
                {user.fullName}
              </div>
              <div className="text-[11px] font-mono text-slate-400 truncate">
                {user.vpa}
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={handleLogout}
            className="w-full min-h-[44px] px-3.5 py-2 rounded-xl text-xs font-medium text-slate-300 hover:text-white hover:bg-white/10 flex items-center gap-2.5 transition-colors cursor-pointer"
          >
            <LogOut className="w-4 h-4" />
            <span>Sign Out</span>
          </button>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex-1 lg:pl-64 flex flex-col min-w-0 pb-20 lg:pb-8">
        {/* Top Bar Contract (3 zones) */}
        <header className="sticky top-0 z-30 h-14 bg-white/95 backdrop-blur-md border-b border-slate-200 px-4 sm:px-6 lg:px-8 flex items-center justify-between gap-8">
          <div className="flex items-center gap-3 min-w-0">
            <span className="lg:hidden font-display text-base font-bold text-[#081124] whitespace-nowrap">
              SmartPay Wallet
            </span>
            <h1 className="hidden lg:block font-display text-base font-bold text-[#081124] whitespace-nowrap">
              {activeTitle}
            </h1>
          </div>

          <div className="hidden md:flex items-center gap-5 text-xs text-slate-600">
            <span className="font-mono whitespace-nowrap">{user.vpa}</span>
            <span aria-hidden="true">·</span>
            <span className="whitespace-nowrap">
              {compliance?.activeMode === "live" ? "Live UPI" : "Sandbox Testing"}
            </span>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => setActiveTab("qr")}
              className="min-h-[40px] px-4 py-2 rounded-xl bg-[#081124] hover:bg-[#0F1E3D] text-white text-xs font-medium flex items-center gap-1.5 transition-colors whitespace-nowrap cursor-pointer"
            >
              <QrCode className="w-3.5 h-3.5" />
              <span>Scan &amp; Pay</span>
            </button>
          </div>
        </header>

        <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <AnimatePresence mode="wait">
            <motion.div
              key={activeTab}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
            >
              {activeTab === "overview" && (
                <WalletOverview
                  user={user}
                  bankAccounts={bankAccounts}
                  transactions={transactions}
                  collectRequests={collectRequests}
                  dailyStats={dailyStats}
                  compliance={compliance}
                  token={token}
                  onNavigate={setActiveTab}
                  onStartPayment={setPaymentIntent}
                  onSelectTransaction={setSelectedTx}
                  onRefreshData={refreshWalletData}
                  onUserUpdated={setUser}
                />
              )}

              {activeTab === "pay" && (
                <PayView
                  contacts={contacts}
                  token={token}
                  onStartPayment={setPaymentIntent}
                  onRefreshData={refreshWalletData}
                />
              )}

              {activeTab === "qr" && (
                <QrPaymentView user={user} onStartPayment={setPaymentIntent} />
              )}

              {activeTab === "history" && (
                <HistoryView
                  transactions={transactions}
                  user={user}
                  onSelectTransaction={setSelectedTx}
                />
              )}

              {activeTab === "studio" && <PointEditStudio token={token} />}

              {activeTab === "settings" && (
                <AccountSettingsView
                  user={user}
                  bankAccounts={bankAccounts}
                  compliance={compliance}
                  token={token}
                  onUserUpdated={setUser}
                />
              )}
            </motion.div>
          </AnimatePresence>
        </main>
      </div>

      {/* Android-First Fixed Mobile Bottom Navigation Bar */}
      <nav
        aria-label="Mobile Navigation"
        className="lg:hidden fixed bottom-0 left-0 right-0 z-40 h-16 bg-white/95 backdrop-blur-md border-t border-slate-200 grid grid-cols-6 items-center px-1"
      >
        {navItems.map((item) => {
          const active = activeTab === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => setActiveTab(item.id)}
              className={`min-h-[48px] flex flex-col items-center justify-center gap-0.5 rounded-lg transition-colors cursor-pointer ${
                active ? "text-[#081124] font-semibold" : "text-slate-500"
              }`}
            >
              {item.icon}
              <span className="text-[10px] leading-none whitespace-nowrap">
                {item.mobileLabel}
              </span>
            </button>
          );
        })}
      </nav>

      {/* Modals */}
      <PaymentModal
        intent={paymentIntent}
        user={user}
        bankAccounts={bankAccounts}
        token={token}
        onClose={() => setPaymentIntent(null)}
        onSuccess={(tx, updatedUser) => {
          setPaymentIntent(null);
          setUser(updatedUser);
          setSelectedTx(tx);
          void refreshWalletData();
        }}
      />

      <ReceiptModal
        transaction={selectedTx}
        user={user}
        token={token}
        onClose={() => setSelectedTx(null)}
        onTransactionUpdated={(updatedTx, updatedUser) => {
          setSelectedTx(updatedTx);
          setUser(updatedUser);
          void refreshWalletData();
        }}
      />
    </div>
  );
}
