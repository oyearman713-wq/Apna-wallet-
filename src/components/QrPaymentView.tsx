import React, { useEffect, useRef, useState } from "react";
import jsQR from "jsqr";
import QRCode from "qrcode";
import { Camera, CameraOff, QrCode, Upload, CheckCircle2, ArrowRight } from "lucide-react";
import type { ParsedUpiQr, UserProfile } from "../types";
import { parseUpiUri } from "../utils/format";
import type { PaymentIntent } from "./PaymentModal";

interface QrPaymentViewProps {
  user: UserProfile;
  onStartPayment: (intent: PaymentIntent) => void;
}

interface SampleMerchantQr {
  title: string;
  subtitle: string;
  uri: string;
  dataUrl: string;
}

const SAMPLE_MERCHANT_URIS = [
  {
    title: "Blue Tokai Coffee",
    subtitle: "Fixed amount ₹340.00 · Indiranagar",
    uri: "upi://pay?pa=bluetokai@okaxis&pn=Blue%20Tokai%20Coffee&am=340.00&cu=INR&mc=5814&tn=Pour-over%20Coffee",
  },
  {
    title: "Namma Metro BMRCL",
    subtitle: "Open amount · Enter fare at confirmation",
    uri: "upi://pay?pa=bmrcl.qr@oksbi&pn=Namma%20Metro%20BMRCL&cu=INR&mc=4111&tn=Metro%20QR%20Ticket",
  },
  {
    title: "Zepto Express",
    subtitle: "Fixed amount ₹685.00 · Groceries",
    uri: "upi://pay?pa=zepto.pay@okicici&pn=Zepto%20Express&am=685.00&cu=INR&mc=5411&tn=Order%20%23ZP9021",
  },
];

export const QrPaymentView: React.FC<QrPaymentViewProps> = ({ user, onStartPayment }) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);

  const [cameraActive, setCameraActive] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [decodedQr, setDecodedQr] = useState<ParsedUpiQr | null>(null);
  const [manualUri, setManualUri] = useState("");
  const [sampleQrs, setSampleQrs] = useState<SampleMerchantQr[]>([]);
  const [myReceiveQr, setMyReceiveQr] = useState<string>("");
  const [customAmount, setCustomAmount] = useState("");

  useEffect(() => {
    let active = true;
    const buildQrs = async () => {
      const built: SampleMerchantQr[] = [];
      for (const item of SAMPLE_MERCHANT_URIS) {
        const dataUrl = await QRCode.toDataURL(item.uri, {
          width: 220,
          margin: 1,
          color: { dark: "#081124", light: "#FFFFFF" },
        });
        built.push({ ...item, dataUrl });
      }
      const receiveUri = `upi://pay?pa=${encodeURIComponent(user.vpa)}&pn=${encodeURIComponent(
        user.fullName
      )}&cu=INR`;
      const receiveUrl = await QRCode.toDataURL(receiveUri, {
        width: 240,
        margin: 1,
        color: { dark: "#081124", light: "#FFFFFF" },
      });
      if (active) {
        setSampleQrs(built);
        setMyReceiveQr(receiveUrl);
      }
    };
    void buildQrs();
    return () => {
      active = false;
    };
  }, [user.vpa, user.fullName]);

  const stopCamera = () => {
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setCameraActive(false);
  };

  useEffect(() => {
    return () => stopCamera();
  }, []);

  const handleDecodedString = (raw: string) => {
    const parsed = parseUpiUri(raw);
    if (!parsed) {
      setCameraError("QR detected, but it is not a standard NPCI upi://pay QR code.");
      return;
    }
    setCameraError(null);
    setDecodedQr(parsed);
    setCustomAmount(parsed.amountRupees || "");
    stopCamera();
  };

  const scanFrame = () => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || video.readyState < 2) {
      rafRef.current = requestAnimationFrame(scanFrame);
      return;
    }

    const width = video.videoWidth;
    const height = video.videoHeight;
    if (width > 0 && height > 0) {
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (ctx) {
        ctx.drawImage(video, 0, 0, width, height);
        const imageData = ctx.getImageData(0, 0, width, height);
        const code = jsQR(imageData.data, imageData.width, imageData.height, {
          inversionAttempts: "dontInvert",
        });
        if (code?.data) {
          handleDecodedString(code.data);
          return;
        }
      }
    }
    rafRef.current = requestAnimationFrame(scanFrame);
  };

  const startCamera = async () => {
    setCameraError(null);
    setDecodedQr(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" } },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setCameraActive(true);
      rafRef.current = requestAnimationFrame(scanFrame);
    } catch (err) {
      setCameraError(
        err instanceof Error
          ? `Camera access unavailable (${err.message}). Upload a QR image or select a merchant QR below.`
          : "Camera permission denied."
      );
      stopCamera();
    }
  };

  const handleQrFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setCameraError(null);
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement("canvas");
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        ctx.drawImage(img, 0, 0);
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const code = jsQR(imageData.data, imageData.width, imageData.height);
        if (!code?.data) {
          setCameraError("No readable QR code found in the uploaded image.");
          return;
        }
        handleDecodedString(code.data);
      };
      img.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  };

  const handleProceedToConfirm = () => {
    if (!decodedQr) return;
    const amt = decodedQr.amountLocked ? decodedQr.amountRupees : customAmount;
    onStartPayment({
      vpa: decodedQr.vpa,
      recipientName: decodedQr.payeeName,
      amountRupees: amt,
      amountLocked: decodedQr.amountLocked,
      note: decodedQr.note,
      type: "QR_PAY",
    });
  };

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left: Live Camera & Image QR Scanner */}
        <div className="lg:col-span-7 bg-white rounded-2xl border border-slate-200 p-6 space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="font-display text-lg font-bold text-[#081124]">
                Scan &amp; Pay UPI QR
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Reads standard NPCI upi://pay QR codes from your camera or gallery
              </p>
            </div>
            <div className="flex items-center gap-2">
              {!cameraActive ? (
                <button
                  type="button"
                  onClick={startCamera}
                  className="min-h-[44px] rounded-xl bg-[#081124] hover:bg-[#0F1E3D] text-white text-xs font-medium px-4 py-2.5 flex items-center gap-2 transition-colors whitespace-nowrap cursor-pointer"
                >
                  <Camera className="w-4 h-4" />
                  <span>Open Camera</span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={stopCamera}
                  className="min-h-[44px] rounded-xl bg-red-700 hover:bg-red-800 text-white text-xs font-medium px-4 py-2.5 flex items-center gap-2 transition-colors whitespace-nowrap cursor-pointer"
                >
                  <CameraOff className="w-4 h-4" />
                  <span>Stop Camera</span>
                </button>
              )}

              <label className="min-h-[44px] rounded-xl border border-slate-300 hover:bg-slate-50 text-xs font-medium text-[#081124] px-4 py-2.5 flex items-center gap-2 transition-colors whitespace-nowrap cursor-pointer">
                <Upload className="w-4 h-4" />
                <span>Upload QR</span>
                <input
                  type="file"
                  accept="image/*"
                  onChange={handleQrFileUpload}
                  className="hidden"
                />
              </label>
            </div>
          </div>

          {/* Camera Viewport */}
          <div className="relative rounded-2xl overflow-hidden bg-[#081124] border border-slate-800 aspect-[4/3] flex items-center justify-center">
            <video
              ref={videoRef}
              playsInline
              muted
              className={`w-full h-full object-cover ${cameraActive ? "block" : "hidden"}`}
            />
            <canvas ref={canvasRef} className="hidden" />

            {cameraActive ? (
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                <div className="w-52 h-52 border-2 border-white/80 rounded-2xl shadow-[0_0_0_9999px_rgba(8,17,36,0.45)]" />
              </div>
            ) : (
              <div className="text-center p-6 max-w-sm">
                <QrCode className="w-12 h-12 text-slate-400 mx-auto mb-3" />
                <p className="text-sm font-medium text-white">
                  Point camera at any BharatQR / UPI QR
                </p>
                <p className="text-xs text-slate-300 mt-1">
                  Or upload a QR screenshot, paste a upi://pay link, or test one of the
                  sandbox merchant QRs on the right.
                </p>
              </div>
            )}
          </div>

          {cameraError && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-900">
              {cameraError}
            </div>
          )}

          {/* Decoded QR Preview Card */}
          {decodedQr && (
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50/60 p-5 space-y-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-1.5 text-xs font-semibold text-emerald-800">
                    <CheckCircle2 className="w-4 h-4" />
                    <span>Valid NPCI UPI QR Verified</span>
                  </div>
                  <h3 className="font-display text-lg font-bold text-[#081124] mt-1">
                    {decodedQr.payeeName}
                  </h3>
                  <p className="font-mono text-xs text-slate-600">{decodedQr.vpa}</p>
                  {decodedQr.note && (
                    <p className="text-xs text-slate-600 mt-1">Note: {decodedQr.note}</p>
                  )}
                </div>
                {decodedQr.merchantCode && (
                  <span className="font-mono text-xs text-slate-500">
                    MCC {decodedQr.merchantCode}
                  </span>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-end">
                <div>
                  <label
                    htmlFor="qr-amount-input"
                    className="block text-xs font-medium text-slate-700 mb-1"
                  >
                    {decodedQr.amountLocked
                      ? "Merchant Specified Amount (INR)"
                      : "Enter Amount (INR)"}
                  </label>
                  <input
                    id="qr-amount-input"
                    type="number"
                    min="1"
                    max="100000"
                    step="0.01"
                    readOnly={decodedQr.amountLocked}
                    value={decodedQr.amountLocked ? decodedQr.amountRupees : customAmount}
                    onChange={(e) => setCustomAmount(e.target.value)}
                    placeholder="e.g. 250.00"
                    className="w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-base font-mono font-semibold tabular-nums text-[#081124] outline-none focus:border-[#081124]"
                  />
                </div>
                <button
                  type="button"
                  onClick={handleProceedToConfirm}
                  disabled={
                    !decodedQr.amountLocked &&
                    (!customAmount || Number(customAmount) < 1)
                  }
                  className="min-h-[46px] rounded-xl bg-[#081124] hover:bg-[#0F1E3D] disabled:opacity-50 text-white text-sm font-medium px-5 py-2.5 flex items-center justify-center gap-2 transition-colors cursor-pointer"
                >
                  <span>Review &amp; Pay</span>
                  <ArrowRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}

          {/* Manual UPI URI Input */}
          <div className="pt-2 border-t border-slate-200">
            <label htmlFor="manual-upi-uri" className="block text-xs font-medium text-slate-600 mb-1.5">
              Or paste a raw NPCI UPI QR string
            </label>
            <div className="flex gap-2">
              <input
                id="manual-upi-uri"
                type="text"
                value={manualUri}
                onChange={(e) => setManualUri(e.target.value)}
                placeholder="upi://pay?pa=merchant@okaxis&pn=Merchant&am=150&cu=INR"
                className="flex-1 rounded-xl border border-slate-300 px-3.5 py-2.5 text-xs font-mono text-[#081124] outline-none focus:border-[#081124]"
              />
              <button
                type="button"
                onClick={() => handleDecodedString(manualUri)}
                disabled={!manualUri.trim()}
                className="min-h-[44px] rounded-xl border border-slate-300 hover:bg-slate-50 disabled:opacity-40 px-4 text-xs font-medium text-[#081124] whitespace-nowrap cursor-pointer"
              >
                Parse QR
              </button>
            </div>
          </div>
        </div>

        {/* Right: My Receive QR + Sandbox Scannable Merchant QRs */}
        <div className="lg:col-span-5 space-y-6">
          <div className="bg-[#081124] text-white rounded-2xl p-6">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs text-slate-300">Receive Money via UPI QR</p>
                <h3 className="font-display text-lg font-bold mt-0.5">{user.fullName}</h3>
                <p className="font-mono text-xs text-blue-200 mt-0.5">{user.vpa}</p>
              </div>
            </div>
            <div className="mt-5 flex items-center gap-5">
              {myReceiveQr && (
                <div className="bg-white p-2.5 rounded-xl shrink-0">
                  <img
                    src={myReceiveQr}
                    alt={`UPI QR for ${user.vpa}`}
                    className="w-28 h-28"
                  />
                </div>
              )}
              <p className="text-xs text-slate-300 leading-relaxed">
                Any UPI app or SmartPay camera scanner can decode this QR to pay directly
                to your handle in the{" "}
                <span className="font-semibold text-white">
                  {user.environmentMode.toUpperCase()}
                </span>{" "}
                environment.
              </p>
            </div>
          </div>

          <div className="bg-white rounded-2xl border border-slate-200 p-6 space-y-4">
            <div>
              <h3 className="font-display text-base font-bold text-[#081124]">
                Sandbox Merchant QR Codes
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Click any scannable QR below to load its NPCI payload into the confirmation flow.
              </p>
            </div>

            <div className="divide-y divide-slate-100">
              {sampleQrs.map((qr) => (
                <button
                  key={qr.title}
                  type="button"
                  onClick={() => handleDecodedString(qr.uri)}
                  className="w-full py-3.5 flex items-center gap-4 text-left hover:bg-[#F4F7FB] px-2 -mx-2 rounded-xl transition-colors cursor-pointer"
                >
                  <img
                    src={qr.dataUrl}
                    alt={`${qr.title} QR`}
                    className="w-14 h-14 rounded-lg border border-slate-200 shrink-0"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="font-medium text-sm text-[#081124] truncate">
                      {qr.title}
                    </div>
                    <div className="text-xs text-slate-500 truncate mt-0.5">
                      {qr.subtitle}
                    </div>
                  </div>
                  <ArrowRight className="w-4 h-4 text-slate-400 shrink-0" />
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
