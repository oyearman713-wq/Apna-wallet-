import React, { useEffect, useState } from "react";
import { CheckCircle2, Fingerprint, Landmark, ShieldCheck, AlertTriangle } from "lucide-react";
import type { AuditLogRecord, BankAccount, ComplianceStatus, UserProfile } from "../types";
import { formatIST } from "../utils/format";
import { enrollDeviceBiometric, isWebAuthnSupported } from "../utils/webauthn";

interface AccountSettingsViewProps {
  user: UserProfile;
  bankAccounts: BankAccount[];
  compliance: ComplianceStatus | null;
  token: string;
  onUserUpdated: (u: UserProfile) => void;
}

export const AccountSettingsView: React.FC<AccountSettingsViewProps> = ({
  user,
  bankAccounts,
  compliance,
  token,
  onUserUpdated,
}) => {
  const [fullName, setFullName] = useState(user.fullName);
  const [email, setEmail] = useState(user.email || "");
  const [panNumber, setPanNumber] = useState("");
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [auditLogs, setAuditLogs] = useState<AuditLogRecord[]>([]);

  useEffect(() => {
    const fetchLogs = async () => {
      try {
        const res = await fetch("/api/security/audit-logs", {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res.ok) {
          const data = await res.json();
          setAuditLogs(data.logs || []);
        }
      } catch {
        // Ignore audit load errors
      }
    };
    void fetchLogs();
  }, [token]);

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setNotice(null);
    setError(null);
    try {
      const res = await fetch("/api/profile", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          fullName,
          email: email || undefined,
          panNumber: panNumber || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not update profile.");
      onUserUpdated(data.user);
      setPanNumber("");
      setNotice("Profile & KYC settings updated.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Update failed.");
    } finally {
      setSaving(false);
    }
  };

  const handleToggleBiometric = async () => {
    setError(null);
    setNotice(null);
    try {
      if (user.biometricEnabled) {
        const res = await fetch("/api/security/biometric", {
          method: "DELETE",
          headers: { Authorization: `Bearer ${token}` },
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Could not disable biometric.");
        onUserUpdated(data.user);
        setNotice("Device biometric confirmation disabled.");
      } else {
        const enrolled = await enrollDeviceBiometric({
          userId: user.id,
          userName: user.fullName,
          phone: user.phone,
        });
        const res = await fetch("/api/security/biometric/register", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify(enrolled),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Could not save biometric enrollment.");
        onUserUpdated(data.user);
        setNotice("Device biometric passkey enrolled.");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Biometric setup failed.");
    }
  };

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Profile & KYC */}
        <form
          onSubmit={handleSaveProfile}
          className="lg:col-span-6 bg-white rounded-2xl border border-slate-200 p-6 space-y-5"
        >
          <div className="flex items-center gap-4">
            <img
              src="/src/assets/images/avatar_user_arjun_1795201837873.jpg"
              alt={user.fullName}
              referrerPolicy="no-referrer"
              className="w-16 h-16 rounded-2xl object-cover border border-slate-200"
            />
            <div>
              <h2 className="font-display text-lg font-bold text-[#081124]">
                {user.fullName}
              </h2>
              <p className="text-xs font-mono text-slate-600">
                {user.phone} · {user.vpa}
              </p>
              <p className="text-xs text-slate-500 mt-0.5">
                KYC Status:{" "}
                <span className="font-semibold text-[#081124]">{user.kycStatus}</span>
                {user.kycPanLast4 ? ` (PAN •••••${user.kycPanLast4})` : ""}
              </p>
            </div>
          </div>

          <div className="space-y-4">
            <div>
              <label htmlFor="prof-name" className="block text-xs font-medium text-slate-700 mb-1">
                Full Name
              </label>
              <input
                id="prof-name"
                type="text"
                required
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                className="w-full rounded-xl border border-slate-300 px-3.5 py-2.5 text-sm text-[#081124] outline-none focus:border-[#081124]"
              />
            </div>

            <div>
              <label htmlFor="prof-email" className="block text-xs font-medium text-slate-700 mb-1">
                Email Address (for statements)
              </label>
              <input
                id="prof-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="name@example.in"
                className="w-full rounded-xl border border-slate-300 px-3.5 py-2.5 text-sm text-[#081124] outline-none focus:border-[#081124]"
              />
            </div>

            <div>
              <label htmlFor="prof-pan" className="block text-xs font-medium text-slate-700 mb-1">
                Verify PAN (Required for Live KYC)
              </label>
              <input
                id="prof-pan"
                type="text"
                maxLength={10}
                value={panNumber}
                onChange={(e) => setPanNumber(e.target.value.toUpperCase())}
                placeholder="ABCDE1234F (optional update)"
                className="w-full rounded-xl border border-slate-300 px-3.5 py-2.5 text-sm font-mono uppercase text-[#081124] outline-none focus:border-[#081124]"
              />
            </div>
          </div>

          {notice && (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3.5 py-2.5 text-xs text-emerald-800">
              {notice}
            </div>
          )}
          {error && (
            <div className="rounded-xl border border-red-200 bg-red-50 px-3.5 py-2.5 text-xs text-red-800">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={saving}
            className="min-h-[46px] rounded-xl bg-[#081124] hover:bg-[#0F1E3D] text-white text-sm font-medium px-5 py-2.5 cursor-pointer"
          >
            {saving ? "Saving..." : "Save Profile & KYC"}
          </button>
        </form>

        {/* Right: Linked Banks, Biometrics & Live TPAP Gate */}
        <div className="lg:col-span-6 space-y-6">
          <div className="bg-white rounded-2xl border border-slate-200 p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-display text-base font-bold text-[#081124]">
                Linked UPI Bank Accounts
              </h3>
              <Landmark className="w-4 h-4 text-slate-500" />
            </div>
            <div className="divide-y divide-slate-100">
              {bankAccounts.map((b) => (
                <div key={b.id} className="py-3 flex items-center justify-between gap-4">
                  <div>
                    <div className="font-medium text-sm text-[#081124]">
                      {b.bank_name} {b.account_mask}
                    </div>
                    <div className="font-mono text-xs text-slate-500 mt-0.5">
                      {b.vpa} · {b.ifsc}
                    </div>
                  </div>
                  <span className="text-xs font-medium text-slate-600">
                    {b.is_primary ? "Primary" : "Secondary"}
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-white rounded-2xl border border-slate-200 p-6 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-display text-base font-bold text-[#081124]">
                  Device Biometric Authentication
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  WebAuthn platform authenticator for step-up UPI confirmation
                </p>
              </div>
              <Fingerprint className="w-5 h-5 text-[#1D4ED8]" />
            </div>

            <div className="flex items-center justify-between gap-4 pt-1">
              <div className="text-xs text-slate-600">
                {user.biometricEnabled
                  ? `Active: ${user.biometricDeviceLabel}`
                  : isWebAuthnSupported()
                    ? "Not enrolled on this browser device"
                    : "WebAuthn unavailable in this iframe/browser"}
              </div>
              <button
                type="button"
                onClick={handleToggleBiometric}
                disabled={!user.biometricEnabled && !isWebAuthnSupported()}
                className="min-h-[44px] px-4 rounded-xl border border-slate-300 hover:bg-slate-50 disabled:opacity-40 text-xs font-semibold text-[#081124] whitespace-nowrap cursor-pointer"
              >
                {user.biometricEnabled ? "Disable Biometrics" : "Enroll Device"}
              </button>
            </div>
          </div>

          {/* Compliance Gate */}
          <div className="bg-[#081124] text-white rounded-2xl p-6 space-y-3">
            <div className="flex items-center gap-2">
              <ShieldCheck className="w-5 h-5 text-blue-300" />
              <h3 className="font-display text-base font-bold">
                Sandbox vs. Live UPI Compliance Gate
              </h3>
            </div>
            <p className="text-xs text-slate-300 leading-relaxed">
              {compliance?.notice}
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-1 text-xs">
              <div className="flex items-center gap-2">
                {user.kycStatus === "VERIFIED" ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                ) : (
                  <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
                )}
                <span>Customer KYC ({user.kycStatus})</span>
              </div>
              <div className="flex items-center gap-2">
                {compliance?.requirements.hasRazorpayKeys ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                ) : (
                  <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
                )}
                <span>PSP Production Keys</span>
              </div>
              <div className="flex items-center gap-2">
                {compliance?.requirements.hasWebhookSecret ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                ) : (
                  <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
                )}
                <span>HMAC Webhook Secret</span>
              </div>
              <div className="flex items-center gap-2">
                {compliance?.requirements.hasNpciTpapLicense ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                ) : (
                  <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
                )}
                <span>NPCI TPAP License ID</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Security Audit Log */}
      <div className="bg-white rounded-2xl border border-slate-200 p-6 space-y-4">
        <div>
          <h3 className="font-display text-base font-bold text-[#081124]">
            Recent Security Audit Trail
          </h3>
          <p className="text-xs text-slate-500 mt-0.5">
            Server-side authentication, webhook, and transaction verification events
          </p>
        </div>

        <div className="divide-y divide-slate-100 text-xs">
          {auditLogs.slice(0, 8).map((log) => (
            <div key={log.id} className="py-2.5 flex flex-wrap items-center justify-between gap-2">
              <div className="font-mono font-medium text-[#081124]">{log.event_type}</div>
              <div className="text-slate-500 font-mono tabular-nums">
                {log.device_id || "—"} · {formatIST(log.created_at)}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
