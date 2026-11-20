import { GoogleGenAI, Modality, Type } from "@google/genai";
import type { FunctionDeclaration, LiveServerMessage } from "@google/genai";
import type { WebSocket } from "ws";

export function createGeminiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is not configured in server environment.");
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        "User-Agent": "aistudio-build",
      },
    },
  });
}

const proposeImageEditDeclaration: FunctionDeclaration = {
  name: "proposeImageEdit",
  description:
    "Stages a localized Nano Banana image edit instruction based on where the user pointed on the picture and what change they requested verbally.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      targetRegionDescription: {
        type: Type.STRING,
        description: "Short description of the pointed object or region in the image.",
      },
      editPrompt: {
        type: Type.STRING,
        description:
          "Clear, concrete visual editing instruction referencing the exact region to modify.",
      },
    },
    required: ["targetRegionDescription", "editPrompt"],
  },
};

export async function attachLiveStudioWebSocket(clientWs: WebSocket): Promise<void> {
  let ai: GoogleGenAI;
  try {
    ai = createGeminiClient();
  } catch (err) {
    clientWs.send(
      JSON.stringify({
        error: err instanceof Error ? err.message : "Gemini API key missing.",
      })
    );
    clientWs.close();
    return;
  }

  let closed = false;
  let session: Awaited<ReturnType<typeof ai.live.connect>> | null = null;

  try {
    session = await ai.live.connect({
      model: "gemini-3.8-live",
      config: {
        responseModalities: [Modality.AUDIO],
        speechConfig: {
          voiceConfig: { prebuiltVoiceConfig: { voiceName: "Zephyr" } },
        },
        inputAudioTranscription: {},
        outputAudioTranscription: {},
        tools: [{ functionDeclarations: [proposeImageEditDeclaration] }],
        systemInstruction:
          "You are the SmartPay Visual Studio voice assistant. The user shares an image and clicks/points at specific normalized coordinates (x%, y%) on the picture while speaking how they want to change that area. Acknowledge what is at those coordinates concisely, confirm the intended edit aloud, and call proposeImageEdit so the user can apply it with Nano Banana.",
      },
      callbacks: {
        onopen: () => {
          if (!closed && clientWs.readyState === 1) {
            clientWs.send(JSON.stringify({ ready: true }));
          }
        },
        onmessage: (message: LiveServerMessage) => {
          if (closed || clientWs.readyState !== 1) return;

          const content = message.serverContent;
          if (content?.inputTranscription?.text) {
            clientWs.send(
              JSON.stringify({ inputTranscript: content.inputTranscription.text })
            );
          }
          if (content?.outputTranscription?.text) {
            clientWs.send(
              JSON.stringify({ outputTranscript: content.outputTranscription.text })
            );
          }
          for (const part of content?.modelTurn?.parts ?? []) {
            if (part.inlineData?.data) {
              clientWs.send(JSON.stringify({ audio: part.inlineData.data }));
            }
          }
          if (content?.interrupted) {
            clientWs.send(JSON.stringify({ interrupted: true }));
          }
          if (content?.turnComplete) {
            clientWs.send(JSON.stringify({ turnComplete: true }));
          }

          for (const call of message.toolCall?.functionCalls ?? []) {
            if (call.name === "proposeImageEdit") {
              const args = (call.args || {}) as {
                targetRegionDescription?: string;
                editPrompt?: string;
              };
              clientWs.send(
                JSON.stringify({
                  stagedEdit: {
                    targetRegionDescription: args.targetRegionDescription || "",
                    editPrompt: args.editPrompt || "",
                  },
                })
              );
              session?.sendToolResponse({
                functionResponses: [
                  {
                    id: call.id,
                    name: call.name,
                    response: {
                      status: "staged",
                      message: "Edit prompt staged in Nano Banana studio panel.",
                    },
                  },
                ],
              });
            }
          }
        },
        onerror: (err) => {
          if (!closed && clientWs.readyState === 1) {
            clientWs.send(
              JSON.stringify({
                error: err instanceof Error ? err.message : "Live API connection error.",
              })
            );
          }
        },
        onclose: () => {
          if (!closed && clientWs.readyState === 1) {
            clientWs.close();
          }
        },
      },
    });
  } catch (err) {
    if (clientWs.readyState === 1) {
      clientWs.send(
        JSON.stringify({
          error:
            err instanceof Error
              ? err.message
              : "Failed to initialize Gemini Live session.",
        })
      );
      clientWs.close();
    }
    return;
  }

  clientWs.on("message", (raw) => {
    if (closed || !session) return;
    try {
      const payload = JSON.parse(raw.toString()) as {
        audio?: string;
        image?: string;
        mimeType?: string;
        pointerContext?: string;
        text?: string;
      };

      if (payload.audio) {
        session.sendRealtimeInput({
          audio: { data: payload.audio, mimeType: "audio/pcm;rate=16000" },
        });
      }
      if (payload.image) {
        session.sendRealtimeInput({
          video: {
            data: payload.image,
            mimeType: payload.mimeType || "image/jpeg",
          },
        });
      }
      if (payload.pointerContext) {
        session.sendRealtimeInput({
          text: payload.pointerContext,
        });
      }
      if (payload.text) {
        session.sendRealtimeInput({
          text: payload.text,
        });
      }
    } catch {
      // Ignore malformed WebSocket frames
    }
  });

  clientWs.on("close", () => {
    closed = true;
    try {
      session?.close();
    } catch {
      // Ignore teardown errors
    }
  });
}

export async function runNanoBananaEdit(params: {
  imageBase64: string;
  mimeType: string;
  instruction: string;
  pointerXPercent?: number;
  pointerYPercent?: number;
  model?: "gemini-3.1-flash-lite-image" | "gemini-nano-banana-2.1";
}): Promise<{
  imageDataUrl: string;
  caption: string;
}> {
  const ai = createGeminiClient();
  const modelName = params.model || "gemini-3.1-flash-lite-image";

  const coordHint =
    typeof params.pointerXPercent === "number" && typeof params.pointerYPercent === "number"
      ? `Focus the edit specifically around the pointed region at (${params.pointerXPercent.toFixed(1)}% from left, ${params.pointerYPercent.toFixed(1)}% from top). `
      : "";

  const response = await ai.models.generateContent({
    model: modelName,
    contents: {
      parts: [
        {
          inlineData: {
            data: params.imageBase64,
            mimeType: params.mimeType,
          },
        },
        {
          text: `${coordHint}Preserve the rest of the photograph naturally and seamlessly. Edit instruction: ${params.instruction}`,
        },
      ],
    },
  });

  let imageDataUrl = "";
  let caption = "";

  for (const part of response.candidates?.[0]?.content?.parts ?? []) {
    if (part.inlineData?.data) {
      const mime = part.inlineData.mimeType ?? "image/png";
      imageDataUrl = `data:${mime};base64,${part.inlineData.data}`;
    } else if (part.text) {
      caption += part.text;
    }
  }

  if (!imageDataUrl) {
    throw new Error("Nano Banana did not return an edited image part.");
  }

  return { imageDataUrl, caption: caption.trim() };
}
