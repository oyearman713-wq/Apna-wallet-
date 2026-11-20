import React, { useEffect, useRef, useState } from "react";
import {
  Crosshair,
  ImagePlus,
  Mic,
  MicOff,
  Sparkles,
  Volume2,
  Wand2,
  AlertCircle,
} from "lucide-react";

interface PointEditStudioProps {
  token: string;
}

interface PointerSpot {
  xPercent: number;
  yPercent: number;
}

const SAMPLE_PICTURES = [
  {
    label: "Bengaluru Cafe",
    src: "/src/assets/images/studio_sample_cafe_1795201838586.jpg",
  },
  {
    label: "Boutique Storefront",
    src: "/src/assets/images/studio_sample_storefront_1795201839120.jpg",
  },
  {
    label: "SmartPay Card",
    src: "/src/assets/images/smartpay_card_hero_1795201838283.jpg",
  },
];

function pcmFloat32ToBase64(float32: Float32Array): string {
  const int16 = new Int16Array(float32.length);
  for (let i = 0; i < float32.length; i++) {
    const s = Math.max(-1, Math.min(1, float32[i]));
    int16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  const bytes = new Uint8Array(int16.buffer);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function base64PcmToFloat32(base64: string): Float32Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  const int16 = new Int16Array(bytes.buffer);
  const float32 = new Float32Array(int16.length);
  for (let i = 0; i < int16.length; i++) {
    float32[i] = int16[i] / 0x8000;
  }
  return float32;
}

async function imageUrlToBase64Jpeg(src: string): Promise<{ base64: string; mimeType: string }> {
  if (src.startsWith("data:")) {
    const [header, data] = src.split(",");
    const mimeMatch = header.match(/data:([^;]+)/);
    return { base64: data, mimeType: mimeMatch?.[1] || "image/jpeg" };
  }

  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      const maxDim = 1024;
      const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        reject(new Error("Canvas unavailable"));
        return;
      }
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      const dataUrl = canvas.toDataURL("image/jpeg", 0.88);
      resolve({ base64: dataUrl.split(",")[1], mimeType: "image/jpeg" });
    };
    img.onerror = () => reject(new Error("Failed to load image for processing."));
    img.src = src;
  });
}

export const PointEditStudio: React.FC<PointEditStudioProps> = ({ token }) => {
  const [sourceImage, setSourceImage] = useState<string>(SAMPLE_PICTURES[0].src);
  const [editedImage, setEditedImage] = useState<string | null>(null);
  const [pointer, setPointer] = useState<PointerSpot | null>({ xPercent: 52, yPercent: 48 });
  const [editPrompt, setEditPrompt] = useState("");
  const [regionLabel, setRegionLabel] = useState("");

  // Live API Voice Session State + Refs (avoid stale closures in audio callbacks)
  const [liveConnected, setLiveConnected] = useState(false);
  const [liveConnecting, setLiveConnecting] = useState(false);
  const [liveError, setLiveError] = useState<string | null>(null);
  const [transcripts, setTranscripts] = useState<
    Array<{ role: "user" | "assistant"; text: string }>
  >([]);

  const [applyingEdit, setApplyingEdit] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [requiresPaidKey, setRequiresPaidKey] = useState(false);

  const wsRef = useRef<WebSocket | null>(null);
  const inputCtxRef = useRef<AudioContext | null>(null);
  const outputCtxRef = useRef<AudioContext | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const nextStartTimeRef = useRef<number>(0);
  const activeSourcesRef = useRef<AudioBufferSourceNode[]>([]);
  const pointerRef = useRef<PointerSpot | null>(pointer);
  const sourceImageRef = useRef<string>(sourceImage);

  useEffect(() => {
    pointerRef.current = pointer;
  }, [pointer]);

  useEffect(() => {
    sourceImageRef.current = sourceImage;
  }, [sourceImage]);

  const stopAudioPlaybackQueue = () => {
    for (const src of activeSourcesRef.current) {
      try {
        src.stop();
      } catch {
        // Ignore already stopped sources
      }
    }
    activeSourcesRef.current = [];
    if (outputCtxRef.current) {
      nextStartTimeRef.current = outputCtxRef.current.currentTime;
    }
  };

  const playPcmChunk24k = (base64Audio: string) => {
    const ctx = outputCtxRef.current;
    if (!ctx) return;
    if (ctx.state === "suspended") {
      void ctx.resume();
    }

    const float32 = base64PcmToFloat32(base64Audio);
    const buffer = ctx.createBuffer(1, float32.length, 24000);
    buffer.getChannelData(0).set(float32);

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);

    const now = ctx.currentTime;
    const startTime = Math.max(now, nextStartTimeRef.current);
    source.start(startTime);
    nextStartTimeRef.current = startTime + buffer.duration;

    activeSourcesRef.current.push(source);
    source.onended = () => {
      activeSourcesRef.current = activeSourcesRef.current.filter((s) => s !== source);
    };
  };

  const disconnectLiveSession = () => {
    if (processorRef.current) {
      processorRef.current.disconnect();
      processorRef.current = null;
    }
    if (micStreamRef.current) {
      micStreamRef.current.getTracks().forEach((t) => t.stop());
      micStreamRef.current = null;
    }
    if (inputCtxRef.current) {
      void inputCtxRef.current.close();
      inputCtxRef.current = null;
    }
    stopAudioPlaybackQueue();
    if (outputCtxRef.current) {
      void outputCtxRef.current.close();
      outputCtxRef.current = null;
    }
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    setLiveConnected(false);
    setLiveConnecting(false);
  };

  useEffect(() => {
    return () => disconnectLiveSession();
  }, []);

  const sendImageAndPointerContext = async (spot: PointerSpot | null) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    try {
      const { base64, mimeType } = await imageUrlToBase64Jpeg(sourceImageRef.current);
      ws.send(JSON.stringify({ image: base64, mimeType }));
      if (spot) {
        ws.send(
          JSON.stringify({
            pointerContext: `The user is now pointing at coordinates (${spot.xPercent.toFixed(
              1
            )}% from left, ${spot.yPercent.toFixed(
              1
            )}% from top) on the picture. Wait for or respond to their spoken instruction for what to change there.`,
          })
        );
      }
    } catch {
      // Ignore frame send failure
    }
  };

  const startLiveSession = async () => {
    setLiveError(null);
    setLiveConnecting(true);

    try {
      const inputCtx = new AudioContext({ sampleRate: 16000 });
      const outputCtx = new AudioContext({ sampleRate: 24000 });
      inputCtxRef.current = inputCtx;
      outputCtxRef.current = outputCtx;
      nextStartTimeRef.current = outputCtx.currentTime;

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      micStreamRef.current = stream;

      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      const ws = new WebSocket(
        `${protocol}//${window.location.host}/api/live?token=${encodeURIComponent(token)}`
      );
      wsRef.current = ws;

      ws.onopen = () => {
        const source = inputCtx.createMediaStreamSource(stream);
        const processor = inputCtx.createScriptProcessor(4096, 1, 1);
        processorRef.current = processor;

        source.connect(processor);
        processor.connect(inputCtx.destination);

        processor.onaudioprocess = (event) => {
          if (ws.readyState !== WebSocket.OPEN) return;
          const base64 = pcmFloat32ToBase64(event.inputBuffer.getChannelData(0));
          ws.send(JSON.stringify({ audio: base64 }));
        };
      };

      ws.onmessage = (event) => {
        const msg = JSON.parse(event.data) as {
          ready?: boolean;
          audio?: string;
          interrupted?: boolean;
          inputTranscript?: string;
          outputTranscript?: string;
          stagedEdit?: { targetRegionDescription: string; editPrompt: string };
          error?: string;
        };

        if (msg.ready) {
          setLiveConnecting(false);
          setLiveConnected(true);
          void sendImageAndPointerContext(pointerRef.current);
        }
        if (msg.audio) {
          playPcmChunk24k(msg.audio);
        }
        if (msg.interrupted) {
          stopAudioPlaybackQueue();
        }
        if (msg.inputTranscript) {
          setTranscripts((prev) => {
            const last = prev[prev.length - 1];
            if (last?.role === "user") {
              return [...prev.slice(0, -1), { role: "user", text: last.text + msg.inputTranscript }];
            }
            return [...prev.slice(-8), { role: "user", text: msg.inputTranscript! }];
          });
        }
        if (msg.outputTranscript) {
          setTranscripts((prev) => {
            const last = prev[prev.length - 1];
            if (last?.role === "assistant") {
              return [
                ...prev.slice(0, -1),
                { role: "assistant", text: last.text + msg.outputTranscript },
              ];
            }
            return [...prev.slice(-8), { role: "assistant", text: msg.outputTranscript! }];
          });
        }
        if (msg.stagedEdit) {
          setRegionLabel(msg.stagedEdit.targetRegionDescription);
          setEditPrompt(msg.stagedEdit.editPrompt);
        }
        if (msg.error) {
          setLiveError(msg.error);
          disconnectLiveSession();
        }
      };

      ws.onerror = () => {
        setLiveError("Live WebSocket connection error.");
        disconnectLiveSession();
      };

      ws.onclose = () => {
        setLiveConnected(false);
        setLiveConnecting(false);
      };
    } catch (err) {
      setLiveError(
        err instanceof Error ? err.message : "Microphone or Live API session failed."
      );
      disconnectLiveSession();
    }
  };

  const handleImagePointClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const xPercent = Math.max(0, Math.min(100, ((e.clientX - rect.left) / rect.width) * 100));
    const yPercent = Math.max(0, Math.min(100, ((e.clientY - rect.top) / rect.height) * 100));
    const nextSpot = { xPercent, yPercent };
    setPointer(nextSpot);
    if (liveConnected) {
      void sendImageAndPointerContext(nextSpot);
    }
  };

  const handleUploadPicture = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result);
      setSourceImage(dataUrl);
      setEditedImage(null);
      setEditError(null);
      if (liveConnected) {
        setTimeout(() => void sendImageAndPointerContext(pointerRef.current), 100);
      }
    };
    reader.readAsDataURL(file);
  };

  const handleApplyNanoBananaEdit = async () => {
    if (!editPrompt.trim()) return;
    setApplyingEdit(true);
    setEditError(null);
    setRequiresPaidKey(false);

    try {
      const { base64, mimeType } = await imageUrlToBase64Jpeg(editedImage || sourceImage);
      const res = await fetch("/api/studio/nano-banana-edit", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          imageBase64: base64,
          mimeType,
          instruction: editPrompt,
          pointerXPercent: pointer?.xPercent,
          pointerYPercent: pointer?.yPercent,
          model: "gemini-3.1-flash-lite-image",
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (data.requiresPaidKey) setRequiresPaidKey(true);
        throw new Error(data.error || "Nano Banana image edit failed.");
      }
      setEditedImage(data.imageDataUrl);
    } catch (err) {
      setEditError(err instanceof Error ? err.message : "Failed to apply image edit.");
    } finally {
      setApplyingEdit(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left: Interactive Point-and-Select Image Canvas */}
        <div className="lg:col-span-7 bg-white rounded-2xl border border-slate-200 p-6 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="font-display text-lg font-bold text-[#081124]">
                Point &amp; Edit Picture Studio
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Click anywhere on the image to point, then speak via Gemini Live API or enter
                your Nano Banana edit instruction.
              </p>
            </div>
            <label className="min-h-[44px] rounded-xl border border-slate-300 hover:bg-slate-50 text-xs font-medium text-[#081124] px-4 py-2.5 flex items-center gap-2 transition-colors whitespace-nowrap cursor-pointer">
              <ImagePlus className="w-4 h-4" />
              <span>Upload Photo</span>
              <input
                type="file"
                accept="image/*"
                onChange={handleUploadPicture}
                className="hidden"
              />
            </label>
          </div>

          {/* Sample Picture Picker */}
          <div className="flex flex-wrap items-center gap-2">
            {SAMPLE_PICTURES.map((sample) => (
              <button
                key={sample.src}
                type="button"
                onClick={() => {
                  setSourceImage(sample.src);
                  setEditedImage(null);
                  setEditError(null);
                  if (liveConnected) {
                    setTimeout(() => void sendImageAndPointerContext(pointerRef.current), 100);
                  }
                }}
                className={`min-h-[38px] px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors whitespace-nowrap cursor-pointer ${
                  sourceImage === sample.src
                    ? "bg-[#081124] text-white border-[#081124]"
                    : "bg-[#F4F7FB] text-slate-700 border-slate-200 hover:border-slate-300"
                }`}
              >
                {sample.label}
              </button>
            ))}
          </div>

          {/* Interactive Pointing Surface */}
          <div
            onClick={handleImagePointClick}
            className="relative rounded-2xl overflow-hidden border border-slate-200 bg-slate-900 cursor-crosshair select-none"
          >
            <img
              src={editedImage || sourceImage}
              alt="Interactive picture canvas for pointing and editing"
              referrerPolicy="no-referrer"
              className="w-full max-h-[440px] object-contain mx-auto block"
            />
            {pointer && (
              <div
                style={{
                  left: `${pointer.xPercent}%`,
                  top: `${pointer.yPercent}%`,
                }}
                className="pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 flex flex-col items-center"
              >
                <div className="w-9 h-9 rounded-full border-2 border-white bg-[#1D4ED8]/70 shadow-lg flex items-center justify-center">
                  <Crosshair className="w-4 h-4 text-white" />
                </div>
                <span className="mt-1 px-2 py-0.5 rounded bg-[#081124]/90 text-[10px] font-mono text-white whitespace-nowrap tabular-nums">
                  {pointer.xPercent.toFixed(0)}%, {pointer.yPercent.toFixed(0)}%
                </span>
              </div>
            )}
          </div>

          <div className="flex items-center justify-between text-xs text-slate-500">
            <span>
              {pointer
                ? `Target pin placed at (${pointer.xPercent.toFixed(1)}%, ${pointer.yPercent.toFixed(
                    1
                  )}%)`
                : "Click on the picture to mark a target spot"}
            </span>
            {editedImage && (
              <button
                type="button"
                onClick={() => setEditedImage(null)}
                className="text-[#1D4ED8] font-medium hover:underline cursor-pointer"
              >
                Reset to Original
              </button>
            )}
          </div>
        </div>

        {/* Right: Gemini Live Voice Control + Nano Banana Execution */}
        <div className="lg:col-span-5 space-y-6">
          {/* Live API Voice Panel */}
          <div className="bg-[#081124] text-white rounded-2xl p-6 space-y-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-xs text-slate-300">Gemini Live API · Real-Time Voice</p>
                <h3 className="font-display text-base font-bold mt-0.5">
                  Speak Your Edit Instructions
                </h3>
              </div>
              <Volume2 className="w-5 h-5 text-blue-300 shrink-0" />
            </div>

            <p className="text-xs text-slate-300 leading-relaxed">
              Start a live voice session, point at any object in the photo, and say how you
              want it changed (for example: &ldquo;Replace this coffee cup with a brass teapot&rdquo;).
            </p>

            {!liveConnected ? (
              <button
                type="button"
                disabled={liveConnecting}
                onClick={startLiveSession}
                className="w-full min-h-[48px] rounded-xl bg-white hover:bg-slate-100 disabled:opacity-60 text-[#081124] text-sm font-semibold px-4 py-3 flex items-center justify-center gap-2 transition-colors cursor-pointer"
              >
                <Mic className="w-4 h-4" />
                <span>{liveConnecting ? "Connecting Live API..." : "Start Live Voice Session"}</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={disconnectLiveSession}
                className="w-full min-h-[48px] rounded-xl bg-red-600 hover:bg-red-700 text-white text-sm font-semibold px-4 py-3 flex items-center justify-center gap-2 transition-colors cursor-pointer"
              >
                <MicOff className="w-4 h-4" />
                <span>End Live Voice Session</span>
              </button>
            )}

            {liveError && (
              <div className="rounded-xl bg-red-950/60 border border-red-400/30 px-3.5 py-2.5 text-xs text-red-200">
                {liveError}
              </div>
            )}

            {transcripts.length > 0 && (
              <div className="rounded-xl bg-white/5 border border-white/10 p-3.5 space-y-2 max-h-44 overflow-y-auto text-xs">
                {transcripts.map((item, idx) => (
                  <div key={idx} className="leading-relaxed">
                    <span className="font-semibold text-blue-300 mr-1.5">
                      {item.role === "user" ? "You:" : "Studio:"}
                    </span>
                    <span className="text-slate-200">{item.text}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Nano Banana Edit Stager */}
          <div className="bg-white rounded-2xl border border-slate-200 p-6 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-display text-base font-bold text-[#081124]">
                  Nano Banana Image Editor
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Model: gemini-3.1-flash-lite-image
                </p>
              </div>
              <Sparkles className="w-4 h-4 text-[#1D4ED8]" />
            </div>

            {regionLabel && (
              <div className="text-xs text-slate-600">
                Pointed object: <span className="font-semibold text-[#081124]">{regionLabel}</span>
              </div>
            )}

            <div>
              <label
                htmlFor="nano-banana-prompt"
                className="block text-xs font-medium text-slate-700 mb-1.5"
              >
                Localized Edit Prompt
              </label>
              <textarea
                id="nano-banana-prompt"
                rows={3}
                value={editPrompt}
                onChange={(e) => setEditPrompt(e.target.value)}
                placeholder="Click a spot on the photo and describe the change (or let Gemini Live voice populate this automatically)..."
                className="w-full rounded-xl border border-slate-300 px-3.5 py-2.5 text-sm text-[#081124] outline-none focus:border-[#081124]"
              />
            </div>

            {editError && (
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-3.5 text-xs text-amber-950 space-y-1">
                <div className="flex items-center gap-2 font-semibold">
                  <AlertCircle className="w-4 h-4 shrink-0 text-amber-700" />
                  <span>
                    {requiresPaidKey
                      ? "Paid Gemini API Key Required for Nano Banana"
                      : "Image Edit Notice"}
                  </span>
                </div>
                <p className="leading-relaxed">
                  {requiresPaidKey
                    ? "Nano Banana (gemini-3.1-flash-lite-image) requires a billing-enabled Gemini API key in Settings > Secrets. Your Gemini Live voice session and pointer coordinates remain active."
                    : editError}
                </p>
              </div>
            )}

            <button
              type="button"
              disabled={applyingEdit || !editPrompt.trim()}
              onClick={handleApplyNanoBananaEdit}
              className="w-full min-h-[48px] rounded-xl bg-[#081124] hover:bg-[#0F1E3D] disabled:opacity-50 text-white text-sm font-medium px-5 py-3 flex items-center justify-center gap-2 transition-colors cursor-pointer"
            >
              <Wand2 className="w-4 h-4" />
              <span>{applyingEdit ? "Rendering Edit..." : "Apply Nano Banana Edit"}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
