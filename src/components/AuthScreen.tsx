import React, { useState } from "react";
import { ArrowRight, CheckCircle2, Lock, ShieldCheck, Smartphone } from "lucide-react";
import type { BankAccount, ComplianceStatus, UserProfile } from "../types";

interface AuthScreenProps {
  compliance: ComplianceStatus | null;
  onAuthenticated: (payload: {
    token: string;
    deviceId: string;
    user: UserProfile;
    bankAccounts: BankAccount[];
    compliance: ComplianceStatus;
  }) => void;
}

export const AuthScreen: React.FC<AuthScreenProps> = ({
  compliance,
  onAuthenticated,
}) => {
  const [step, setStep] = useState<"phone" | "otp">("phone");
  const [phoneInput, setPhoneInput] = useState("9876543210");
  const [fullName, setFullName] = useState("");
  const [otpInput, setOtpInput] = useState("");
  const [challengeId, setChallengeId] = useState("");
  const [normalizedPhone, setNormalizedPhone] = useState("");
  const [isExistingUser, setIsExistingUser] = useState(true);
  const [existingName, setExistingName] = useState<string | null>(null);
  const [sandboxOtpPreview, setSandboxOtpPreview] = useState<string | null>(null);
  const [smsNotice, setSmsNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleRequestOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/auth/request-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: phoneInput }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Unable to send OTP.");
      }
      setChallengeId(data.challengeId);
      setNormalizedPhone(data.phone);
      setIsExistingUser(Boolean(data.isExistingUser));
      setExistingName(data.existingName || null);
      setSandboxOtpPreview(data.sandboxOtpPreview || null);
      setSmsNotice(data.notice || null);
      setOtpInput(data.sandboxOtpPreview || "");
      setStep("otp");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to request OTP.");
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/auth/verify-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          challengeId,
          phone: normalizedPhone,
          otp: otpInput,
          fullName: isExistingUser ? undefined : fullName,
          deviceLabel: /Android/i.test(navigator.userAgent)
            ? "Android Mobile Browser"
            : "Web Workspace Client",
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "OTP verification failed.");
      }
      onAuthenticated({
        token: data.token,
        deviceId: data.deviceId,
        user: data.user,
        bankAccounts: data.bankAccounts || [],
        compliance: data.compliance,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Verification failed.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#F4F7FB] text-[#0A162E] flex flex-col lg:flex-row">
      {/* Left Navy Showcase Column */}
      <div className="lg:w-[52%] bg-[#081124] text-white p-6 sm:p-10 lg:p-14 flex flex-col justify-between">
        <div>
          <div className="flex items-center justify-between gap-4">
            <span className="font-display text-xl font-bold tracking-tight whitespace-nowrap">
              SmartPay Wallet
            </span>
            <span className="text-xs font-mono text-slate-300 whitespace-nowrap">
              {compliance?.activeMode === "live" ? "Live TPAP" : "Sandbox Environment"}
            </span>
          </div>

          <div className="mt-10 lg:mt-14 max-w-xl">
            <h1 className="font-display text-3xl sm:text-4xl lg:text-[42px] font-bold tracking-tight leading-[1.15] [text-wrap:balance]">
              Instant UPI payments and wallet control built for India.
            </h1>
            <p className="mt-4 text-sm sm:text-base text-slate-300 leading-relaxed max-w-lg">
              Register with your Indian mobile number, scan NPCI-compliant UPI QR codes,
              manage collect requests, and audit every transaction with verifiable HMAC-signed
              sandbox settlement.
            </p>
          </div>

          <div className="mt-8 rounded-2xl overflow-hidden border border-white/10 bg-[#0F1E3D] max-w-xl">
            <img
              src="/src/assets/images/smartpay_card_hero_1795201838283.jpg"
              alt="SmartPay dark navy anodized payment card"
              referrerPolicy="no-referrer"
              className="w-full h-48 sm:h-60 object-cover"
            />
          </div>
        </div>

        <div className="mt-8 pt-6 border-t border-white/10 grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs text-slate-300">
          <div className="flex items-start gap-2.5">
            <ShieldCheck className="w-4 h-4 text-blue-300 shrink-0 mt-0.5" />
            <span>Zero stored UPI PINs. PSP handoff &amp; idempotent settlement.</span>
          </div>
          <div className="flex items-start gap-2.5">
            <Lock className="w-4 h-4 text-blue-300 shrink-0 mt-0.5" />
            <span>Rate-limited OTP login, velocity checks &amp; WebAuthn biometrics.</span>
          </div>
          <div className="flex items-start gap-2.5">
            <CheckCircle2 className="w-4 h-4 text-blue-300 shrink-0 mt-0.5" />
            <span>Sandbox transactions separated cleanly from live NPCI rails.</span>
          </div>
        </div>
      </div>

      {/* Right Crisp White Auth Panel */}
      <div className="lg:w-[48%] flex items-center justify-center p-6 sm:p-10 lg:p-14 bg-white">
        <div className="w-full max-w-md">
          <div className="mb-8">
            <p className="text-xs font-medium text-slate-500">
              Mobile OTP Authentication · India (+91)
            </p>
            <h2 className="mt-1.5 font-display text-2xl font-bold text-[#081124]">
              {step === "phone" ? "Sign in or create wallet" : "Verify 6-digit OTP"}
            </h2>
            <p className="mt-2 text-sm text-slate-600">
              {step === "phone"
                ? "Enter your 10-digit Indian mobile number. Use 9876543210 for the pre-seeded sandbox account or any valid number to register."
                : `We sent a 6-digit verification code to ${normalizedPhone}.`}
            </p>
          </div>

          {error && (
            <div
              role="alert"
              className="mb-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"
            >
              {error}
            </div>
          )}

          {step === "phone" ? (
            <form onSubmit={handleRequestOtp} className="space-y-5">
              <div>
                <label
                  htmlFor="mobile-number"
                  className="block text-sm font-medium text-slate-700 mb-1.5"
                >
                  Mobile Number
                </label>
                <div className="flex items-center rounded-xl border border-slate-300 bg-white focus-within:border-[#081124] focus-within:ring-2 focus-within:ring-[#081124]/10 overflow-hidden">
                  <span className="px-3.5 py-3 text-sm font-mono font-medium text-slate-600 bg-slate-50 border-r border-slate-200 select-none">
                    +91
                  </span>
                  <input
                    id="mobile-number"
                    type="tel"
                    inputMode="numeric"
                    autoComplete="tel-national"
                    maxLength={10}
                    required
                    value={phoneInput}
                    onChange={(e) => setPhoneInput(e.target.value.replace(/\D/g, ""))}
                    placeholder="9876543210"
                    className="w-full px-3.5 py-3 text-base font-mono tabular-nums text-[#081124] outline-none"
                  />
                </div>
                <div className="mt-2 flex items-center justify-between text-xs text-slate-500">
                  <span>Pre-seeded sandbox user: 9876543210</span>
                  <button
                    type="button"
                    onClick={() => setPhoneInput("9876543210")}
                    className="font-medium text-[#1D4ED8] hover:underline whitespace-nowrap"
                  >
                    Use Sandbox Number
                  </button>
                </div>
              </div>

              <button
                type="submit"
                disabled={loading || phoneInput.length !== 10}
                className="w-full min-h-[48px] rounded-xl bg-[#081124] hover:bg-[#0F1E3D] disabled:opacity-50 text-white font-medium text-sm px-5 py-3 flex items-center justify-center gap-2 transition-colors cursor-pointer"
              >
                <Smartphone className="w-4 h-4" />
                <span>{loading ? "Sending OTP..." : "Send Verification OTP"}</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            </form>
          ) : (
            <form onSubmit={handleVerifyOtp} className="space-y-5">
              {smsNotice && (
                <div className="rounded-xl border border-slate-200 bg-[#F4F7FB] px-4 py-3 text-xs text-slate-700 space-y-1">
                  <div className="font-medium text-[#081124]">{smsNotice}</div>
                  {sandboxOtpPreview && (
                    <div className="font-mono text-sm text-[#1D4ED8] font-semibold tabular-nums">
                      Sandbox OTP Code: {sandboxOtpPreview}
                    </div>
                  )}
                </div>
              )}

              {!isExistingUser ? (
                <div>
                  <label
                    htmlFor="full-name"
                    className="block text-sm font-medium text-slate-700 mb-1.5"
                  >
                    Full Legal Name (New Account)
                  </label>
                  <input
                    id="full-name"
                    type="text"
                    required
                    minLength={2}
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    placeholder="e.g. Kavya Deshmukh"
                    className="w-full rounded-xl border border-slate-300 px-3.5 py-3 text-sm text-[#081124] outline-none focus:border-[#081124] focus:ring-2 focus:ring-[#081124]/10"
                  />
                </div>
              ) : (
                existingName && (
                  <div className="text-sm text-slate-600">
                    Signing in as <span className="font-semibold text-[#081124]">{existingName}</span>
                  </div>
                )
              )}

              <div>
                <label
                  htmlFor="otp-code"
                  className="block text-sm font-medium text-slate-700 mb-1.5"
                >
                  6-Digit OTP Code
                </label>
                <input
                  id="otp-code"
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  required
                  value={otpInput}
                  onChange={(e) => setOtpInput(e.target.value.replace(/\D/g, ""))}
                  placeholder="Enter 6-digit code"
                  className="w-full rounded-xl border border-slate-300 px-4 py-3 text-lg font-mono tracking-[0.25em] tabular-nums text-[#081124] outline-none focus:border-[#081124] focus:ring-2 focus:ring-[#081124]/10"
                />
              </div>

              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => {
                    setStep("phone");
                    setError(null);
                  }}
                  className="min-h-[48px] px-4 rounded-xl border border-slate-300 text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors whitespace-nowrap cursor-pointer"
                >
                  Change Number
                </button>
                <button
                  type="submit"
                  disabled={loading || otpInput.length !== 6}
                  className="flex-1 min-h-[48px] rounded-xl bg-[#081124] hover:bg-[#0F1E3D] disabled:opacity-50 text-white font-medium text-sm px-5 py-3 flex items-center justify-center gap-2 transition-colors cursor-pointer"
                >
                  <span>{loading ? "Verifying..." : "Verify & Sign In"}</span>
                  <ArrowRight className="w-4 h-4" />
                </button>
              </div>
            </form>
          )}

          <div className="mt-8 pt-6 border-t border-slate-200 text-xs text-slate-500 leading-relaxed">
            {compliance?.notice ||
              "Sandbox mode active. Real-money UPI transfers require NPCI TPAP onboarding, KYC verification, and live PSP credentials."}
          </div>
        </div>
      </div>
    </div>
  );
};
