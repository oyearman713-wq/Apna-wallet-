import React from "react";
import { WifiOff } from "lucide-react";
import { useOnlineStatus } from "../hooks/usePWAInstall";

export const OfflineIndicator: React.FC = () => {
  const isOnline = useOnlineStatus();

  if (isOnline) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed bottom-20 lg:bottom-5 left-4 z-50 flex items-center gap-2 rounded-xl bg-[#081124] border border-amber-400/50 px-4 py-2.5 text-xs font-medium text-white shadow-xl"
    >
      <WifiOff className="w-4 h-4 text-amber-300 shrink-0" />
      <span>Offline Mode — Cached wallet shell active</span>
    </div>
  );
};
