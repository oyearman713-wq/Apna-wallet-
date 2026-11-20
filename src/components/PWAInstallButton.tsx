import React, { useState } from "react";
import { Download, Share, Smartphone, X } from "lucide-react";
import { usePWAInstall } from "../hooks/usePWAInstall";

interface PWAInstallButtonProps {
  variant?: "header" | "sidebar" | "card";
}

export const PWAInstallButton: React.FC<PWAInstallButtonProps> = ({
  variant = "header",
}) => {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showGuide, setShowGuide] = useState(false);

  // Suppress button when already running in standalone installed PWA mode
  if (isInstalled) {
    return null;
  }

  const handleInstallClick = async () => {
    if (isInstallable) {
      await install();
      return;
    }
    setShowGuide(true);
  };

  if (!isInstallable && !isIOS && variant === "header") {
    return null;
  }

  const buttonClasses =
    variant === "sidebar"
      ? "w-full min-h-[44px] px-3.5 py-2 rounded-xl text-xs font-medium bg-white/10 hover:bg-white/20 text-white flex items-center gap-2.5 transition-colors whitespace-nowrap cursor-pointer"
      : variant === "card"
        ? "min-h-[44px] px-4 py-2.5 rounded-xl bg-[#081124] hover:bg-[#0F1E3D] text-white text-xs font-semibold inline-flex items-center gap-2 transition-colors whitespace-nowrap cursor-pointer"
        : "min-h-[40px] px-3.5 py-2 rounded-xl border border-slate-300 hover:bg-slate-50 text-[#081124] text-xs font-medium inline-flex items-center gap-1.5 transition-colors whitespace-nowrap cursor-pointer";

  return (
    <>
      <button type="button" onClick={handleInstallClick} className={buttonClasses}>
        <Download className="w-3.5 h-3.5 shrink-0" />
        <span>
          {isInstallable
            ? "Install App"
            : isIOS
              ? "Install on iOS"
              : "Install SmartPay"}
        </span>
      </button>

      {showGuide && (
        <div
          className="fixed inset-0 z-50 bg-[#081124]/60 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="pwa-install-guide-title"
        >
          <div className="w-full sm:max-w-md bg-white rounded-t-3xl sm:rounded-2xl border border-slate-200 shadow-2xl overflow-hidden">
            <div className="bg-[#081124] text-white px-6 py-4 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <Smartphone className="w-4 h-4 text-blue-300" />
                <h3 id="pwa-install-guide-title" className="font-display text-base font-bold">
                  Install SmartPay Wallet
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setShowGuide(false)}
                aria-label="Close install instructions"
                className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl text-slate-300 hover:text-white hover:bg-white/10 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 space-y-4 text-sm text-slate-700">
              {isIOS ? (
                <div className="space-y-3">
                  <p className="text-xs text-slate-500">
                    Install SmartPay onto your iPhone or iPad home screen via Safari:
                  </p>
                  <ol className="space-y-2.5 text-sm list-decimal list-inside">
                    <li>
                      Tap the{" "}
                      <span className="inline-flex items-center gap-1 font-semibold text-[#081124]">
                        <Share className="w-3.5 h-3.5" /> Share
                      </span>{" "}
                      button in the Safari toolbar.
                    </li>
                    <li>
                      Scroll down and tap{" "}
                      <span className="font-semibold text-[#081124]">
                        Add to Home Screen
                      </span>
                      .
                    </li>
                    <li>
                      Tap <span className="font-semibold text-[#081124]">Add</span> to launch
                      SmartPay in standalone mode.
                    </li>
                  </ol>
                </div>
              ) : (
                <div className="space-y-3">
                  <p className="text-xs text-slate-500">
                    Install SmartPay as a standalone Android or desktop app:
                  </p>
                  <ol className="space-y-2.5 text-sm list-decimal list-inside">
                    <li>
                      Open SmartPay directly in its own browser tab (outside embedded preview
                      frames if applicable).
                    </li>
                    <li>
                      On Android Chrome, tap the browser menu and select{" "}
                      <span className="font-semibold text-[#081124]">Install app</span> or{" "}
                      <span className="font-semibold text-[#081124]">Add to Home screen</span>.
                    </li>
                    <li>
                      On desktop Chrome or Edge, click the install icon in the address bar.
                    </li>
                  </ol>
                </div>
              )}

              <button
                type="button"
                onClick={() => setShowGuide(false)}
                className="w-full min-h-[46px] rounded-xl bg-[#081124] hover:bg-[#0F1E3D] text-white text-sm font-medium cursor-pointer"
              >
                Got It
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
