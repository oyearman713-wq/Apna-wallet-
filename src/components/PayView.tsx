import React, { useState } from "react";
import { ArrowRight, CheckCircle2, Search, Store, UserPlus, Users } from "lucide-react";
import type { Contact } from "../types";
import type { PaymentIntent } from "./PaymentModal";

interface PayViewProps {
  contacts: Contact[];
  token: string;
  onStartPayment: (intent: PaymentIntent) => void;
  onRefreshData: () => Promise<void>;
}

export const PayView: React.FC<PayViewProps> = ({
  contacts,
  token,
  onStartPayment,
  onRefreshData,
}) => {
  const [vpaInput, setVpaInput] = useState("");
  const [amountInput, setAmountInput] = useState("");
  const [noteInput, setNoteInput] = useState("");
  const [verifiedPayee, setVerifiedPayee] = useState<{
    vpa: string;
    verifiedName: string;
  } | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [vpaError, setVpaError] = useState<string | null>(null);

  const [contactSearch, setContactSearch] = useState("");
  const [contactTab, setContactTab] = useState<"peers" | "merchants">("peers");

  // Create Collect Request form
  const [collectVpa, setCollectVpa] = useState("");
  const [collectAmount, setCollectAmount] = useState("");
  const [collectNote, setCollectNote] = useState("");
  const [collectNotice, setCollectNotice] = useState<string | null>(null);
  const [collectBusy, setCollectBusy] = useState(false);

  // Add Contact form
  const [showAddContact, setShowAddContact] = useState(false);
  const [newName, setNewName] = useState("");
  const [newPhone, setNewPhone] = useState("");
  const [newVpa, setNewVpa] = useState("");

  const handleVerifyVpa = async () => {
    setVpaError(null);
    setVerifiedPayee(null);
    if (!vpaInput.trim()) return;
    setVerifying(true);
    try {
      const res = await fetch("/api/contacts/verify-vpa", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ vpa: vpaInput.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "UPI ID verification failed.");
      setVerifiedPayee({ vpa: vpaInput.trim().toLowerCase(), verifiedName: data.verifiedName });
    } catch (err) {
      setVpaError(err instanceof Error ? err.message : "Could not verify VPA.");
    } finally {
      setVerifying(false);
    }
  };

  const handleSendToVpa = async (e: React.FormEvent) => {
    e.preventDefault();
    setVpaError(null);
    let targetName = verifiedPayee?.verifiedName;
    const cleanVpa = vpaInput.trim().toLowerCase();

    if (!verifiedPayee || verifiedPayee.vpa !== cleanVpa) {
      setVerifying(true);
      try {
        const res = await fetch("/api/contacts/verify-vpa", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ vpa: cleanVpa }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Invalid UPI ID.");
        targetName = data.verifiedName;
        setVerifiedPayee({ vpa: cleanVpa, verifiedName: data.verifiedName });
      } catch (err) {
        setVpaError(err instanceof Error ? err.message : "UPI verification failed.");
        setVerifying(false);
        return;
      }
      setVerifying(false);
    }

    onStartPayment({
      vpa: cleanVpa,
      recipientName: targetName || cleanVpa.split("@")[0],
      amountRupees: amountInput,
      note: noteInput,
      type: "UPI_SEND",
    });
  };

  const handleCreateCollect = async (e: React.FormEvent) => {
    e.preventDefault();
    setCollectBusy(true);
    setCollectNotice(null);
    try {
      const res = await fetch("/api/collect-requests", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          payerVpa: collectVpa,
          amountRupees: Number(collectAmount),
          note: collectNote,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Collect request failed.");
      setCollectNotice(`Collect request ${data.collectRequest.id} created in sandbox.`);
      setCollectVpa("");
      setCollectAmount("");
      setCollectNote("");
      await onRefreshData();
    } catch (err) {
      setCollectNotice(err instanceof Error ? err.message : "Failed to create request.");
    } finally {
      setCollectBusy(false);
    }
  };

  const handleAddContact = async (e: React.FormEvent) => {
    e.preventDefault();
    setVpaError(null);
    const res = await fetch("/api/contacts", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ name: newName, phone: newPhone, vpa: newVpa }),
    });
    const data = await res.json();
    if (!res.ok) {
      setVpaError(data.error || "Could not add contact.");
      return;
    }
    setNewName("");
    setNewPhone("");
    setNewVpa("");
    setShowAddContact(false);
    await onRefreshData();
  };

  const filteredContacts = contacts.filter((c) => {
    const matchesTab = contactTab === "merchants" ? c.is_merchant === 1 : c.is_merchant === 0;
    const q = contactSearch.trim().toLowerCase();
    const matchesSearch =
      !q ||
      c.name.toLowerCase().includes(q) ||
      c.vpa.toLowerCase().includes(q) ||
      (c.phone || "").includes(q);
    return matchesTab && matchesSearch;
  });

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left: Send to UPI ID + Create Collect Request */}
        <div className="lg:col-span-5 space-y-6">
          <form
            onSubmit={handleSendToVpa}
            className="bg-white rounded-2xl border border-slate-200 p-6 space-y-4"
          >
            <div>
              <h2 className="font-display text-lg font-bold text-[#081124]">
                Send Money to UPI ID
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Verify recipient name with PSP directory before paying. Test VPAs:
                <span className="font-mono"> pending@upi</span> or{" "}
                <span className="font-mono">fail@upi</span>
              </p>
            </div>

            <div>
              <label htmlFor="send-vpa" className="block text-xs font-medium text-slate-700 mb-1.5">
                Recipient UPI ID (VPA)
              </label>
              <div className="flex gap-2">
                <input
                  id="send-vpa"
                  type="text"
                  required
                  value={vpaInput}
                  onChange={(e) => {
                    setVpaInput(e.target.value);
                    setVerifiedPayee(null);
                  }}
                  placeholder="name@okhdfcbank"
                  className="flex-1 rounded-xl border border-slate-300 px-3.5 py-2.5 text-sm font-mono text-[#081124] outline-none focus:border-[#081124]"
                />
                <button
                  type="button"
                  onClick={handleVerifyVpa}
                  disabled={verifying || !vpaInput.trim()}
                  className="min-h-[44px] px-4 rounded-xl border border-slate-300 hover:bg-slate-50 text-xs font-medium text-[#081124] whitespace-nowrap cursor-pointer"
                >
                  {verifying ? "Checking..." : "Verify"}
                </button>
              </div>
              {verifiedPayee && (
                <div className="mt-2 flex items-center gap-1.5 text-xs font-medium text-emerald-700">
                  <CheckCircle2 className="w-4 h-4" />
                  <span>Verified Account: {verifiedPayee.verifiedName}</span>
                </div>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label htmlFor="send-amt" className="block text-xs font-medium text-slate-700 mb-1.5">
                  Amount (INR)
                </label>
                <input
                  id="send-amt"
                  type="number"
                  min="1"
                  max="100000"
                  step="0.01"
                  required
                  value={amountInput}
                  onChange={(e) => setAmountInput(e.target.value)}
                  placeholder="500.00"
                  className="w-full rounded-xl border border-slate-300 px-3.5 py-2.5 text-sm font-mono font-semibold tabular-nums text-[#081124] outline-none focus:border-[#081124]"
                />
              </div>
              <div>
                <label htmlFor="send-note" className="block text-xs font-medium text-slate-700 mb-1.5">
                  Note
                </label>
                <input
                  id="send-note"
                  type="text"
                  maxLength={100}
                  value={noteInput}
                  onChange={(e) => setNoteInput(e.target.value)}
                  placeholder="Optional remark"
                  className="w-full rounded-xl border border-slate-300 px-3.5 py-2.5 text-sm text-[#081124] outline-none focus:border-[#081124]"
                />
              </div>
            </div>

            {vpaError && (
              <div className="rounded-xl border border-red-200 bg-red-50 px-3.5 py-2.5 text-xs text-red-800">
                {vpaError}
              </div>
            )}

            <button
              type="submit"
              disabled={verifying || !vpaInput.trim() || !amountInput}
              className="w-full min-h-[48px] rounded-xl bg-[#081124] hover:bg-[#0F1E3D] disabled:opacity-50 text-white text-sm font-medium px-5 py-3 flex items-center justify-center gap-2 transition-colors cursor-pointer"
            >
              <span>Review &amp; Confirm Payment</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </form>

          {/* Request Money / UPI Collect */}
          <form
            onSubmit={handleCreateCollect}
            className="bg-white rounded-2xl border border-slate-200 p-6 space-y-4"
          >
            <div>
              <h3 className="font-display text-base font-bold text-[#081124]">
                Request Payment (UPI Collect)
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Raise a sandbox collect request against another UPI ID
              </p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <input
                type="text"
                required
                value={collectVpa}
                onChange={(e) => setCollectVpa(e.target.value)}
                placeholder="payer@okicici"
                className="rounded-xl border border-slate-300 px-3.5 py-2.5 text-sm font-mono text-[#081124] outline-none focus:border-[#081124]"
              />
              <input
                type="number"
                required
                min="1"
                max="100000"
                step="0.01"
                value={collectAmount}
                onChange={(e) => setCollectAmount(e.target.value)}
                placeholder="Amount ₹"
                className="rounded-xl border border-slate-300 px-3.5 py-2.5 text-sm font-mono tabular-nums text-[#081124] outline-none focus:border-[#081124]"
              />
            </div>
            <div className="flex gap-2">
              <input
                type="text"
                value={collectNote}
                onChange={(e) => setCollectNote(e.target.value)}
                placeholder="Reason (e.g. Split dinner)"
                className="flex-1 rounded-xl border border-slate-300 px-3.5 py-2.5 text-sm text-[#081124] outline-none focus:border-[#081124]"
              />
              <button
                type="submit"
                disabled={collectBusy}
                className="min-h-[44px] px-4 rounded-xl bg-[#081124] hover:bg-[#0F1E3D] text-white text-xs font-medium whitespace-nowrap cursor-pointer"
              >
                {collectBusy ? "Sending..." : "Send Request"}
              </button>
            </div>
            {collectNotice && (
              <div className="text-xs text-[#1D4ED8] font-medium">{collectNotice}</div>
            )}
          </form>
        </div>

        {/* Right: Pay Mobile Contacts & Merchants */}
        <div className="lg:col-span-7 bg-white rounded-2xl border border-slate-200 p-6 space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-1 p-1 bg-[#F4F7FB] rounded-xl">
              <button
                type="button"
                onClick={() => setContactTab("peers")}
                className={`min-h-[40px] px-4 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5 transition-colors cursor-pointer ${
                  contactTab === "peers"
                    ? "bg-white text-[#081124] shadow-sm"
                    : "text-slate-600 hover:text-[#081124]"
                }`}
              >
                <Users className="w-3.5 h-3.5" />
                <span>Mobile Contacts</span>
              </button>
              <button
                type="button"
                onClick={() => setContactTab("merchants")}
                className={`min-h-[40px] px-4 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5 transition-colors cursor-pointer ${
                  contactTab === "merchants"
                    ? "bg-white text-[#081124] shadow-sm"
                    : "text-slate-600 hover:text-[#081124]"
                }`}
              >
                <Store className="w-3.5 h-3.5" />
                <span>Verified Merchants</span>
              </button>
            </div>

            <button
              type="button"
              onClick={() => setShowAddContact((v) => !v)}
              className="min-h-[42px] px-3.5 rounded-xl border border-slate-300 hover:bg-slate-50 text-xs font-medium text-[#081124] flex items-center gap-1.5 cursor-pointer"
            >
              <UserPlus className="w-3.5 h-3.5" />
              <span>Add Contact</span>
            </button>
          </div>

          {showAddContact && (
            <form
              onSubmit={handleAddContact}
              className="rounded-xl bg-[#F4F7FB] border border-slate-200 p-4 grid grid-cols-1 sm:grid-cols-3 gap-3"
            >
              <input
                type="text"
                required
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Contact Name"
                className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs text-[#081124] outline-none"
              />
              <input
                type="tel"
                value={newPhone}
                onChange={(e) => setNewPhone(e.target.value)}
                placeholder="+91 mobile (optional)"
                className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-mono text-[#081124] outline-none"
              />
              <div className="flex gap-2">
                <input
                  type="text"
                  required
                  value={newVpa}
                  onChange={(e) => setNewVpa(e.target.value)}
                  placeholder="vpa@bank"
                  className="flex-1 rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-mono text-[#081124] outline-none"
                />
                <button
                  type="submit"
                  className="px-3 py-2 rounded-xl bg-[#081124] text-white text-xs font-medium cursor-pointer"
                >
                  Save
                </button>
              </div>
            </form>
          )}

          <div className="relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="search"
              value={contactSearch}
              onChange={(e) => setContactSearch(e.target.value)}
              placeholder="Search by name, mobile number, or UPI VPA..."
              className="w-full rounded-xl border border-slate-300 pl-10 pr-4 py-2.5 text-sm text-[#081124] outline-none focus:border-[#081124]"
            />
          </div>

          <div className="divide-y divide-slate-100">
            {filteredContacts.length === 0 ? (
              <div className="py-8 text-center text-sm text-slate-500">
                No matching {contactTab === "merchants" ? "merchants" : "contacts"} found.
              </div>
            ) : (
              filteredContacts.map((c) => (
                <div
                  key={c.id}
                  className="py-3.5 flex items-center justify-between gap-4"
                >
                  <div className="flex items-center gap-3.5 min-w-0">
                    <div className="w-10 h-10 rounded-full bg-[#081124] text-white font-display font-bold text-xs flex items-center justify-center shrink-0">
                      {c.name
                        .split(" ")
                        .slice(0, 2)
                        .map((n) => n[0])
                        .join("")}
                    </div>
                    <div className="min-w-0">
                      <div className="font-medium text-sm text-[#081124] truncate">
                        {c.name}
                      </div>
                      <div className="text-xs text-slate-500 truncate mt-0.5 font-mono">
                        {c.vpa}
                        {c.phone ? ` · ${c.phone}` : ` · ${c.category}`}
                      </div>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() =>
                      onStartPayment({
                        vpa: c.vpa,
                        recipientName: c.name,
                        recipientPhone: c.phone || undefined,
                        amountRupees: "",
                        note: c.is_merchant ? `Payment to ${c.name}` : "",
                        type: c.is_merchant ? "MERCHANT_PAY" : "UPI_SEND",
                      })
                    }
                    className="min-h-[44px] px-4 rounded-xl bg-[#F4F7FB] hover:bg-[#081124] hover:text-white text-[#081124] text-xs font-semibold transition-colors whitespace-nowrap cursor-pointer"
                  >
                    Pay Now
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
