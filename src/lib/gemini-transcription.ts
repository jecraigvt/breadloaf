import { GoogleGenAI } from "@google/genai";
import { MODELS } from "@/lib/ai-models";
import { withRetry } from "@/lib/openai-client";

let client: GoogleGenAI | null = null;

const BUCKY_TRANSCRIPTION_VOCABULARY = [
  "Breadloaf Hill",
  "Bucky",
  "Ripton",
  "Vermont Route 125",
  "Craig",
  "Tom Craig",
  "Jim Craig",
  "Sandy Craig",
  "Greg Craig",
  "Wedge Room",
  "Upper Annex",
  "Lower Annex",
  "Woods Cabin",
];

function getGeminiClient(): GoogleGenAI {
  const apiKey = process.env.GOOGLE_AI_API_KEY;
  if (!apiKey) throw new Error("GOOGLE_AI_API_KEY is not configured");
  if (!client) client = new GoogleGenAI({ apiKey });
  return client;
}

export function normalizeGeminiAudioMimeType(mimeType: string): string {
  const normalized = mimeType.split(";", 1)[0].trim().toLowerCase();
  if (normalized === "audio/mp4" || normalized === "audio/x-m4a") {
    return "audio/m4a";
  }
  return normalized;
}

export function extractGeminiTranscript(response: unknown): string {
  if (!response || typeof response !== "object") return "";
  const interaction = response as {
    output_text?: unknown;
    steps?: Array<{ content?: Array<{ text?: unknown }> }>;
  };
  if (typeof interaction.output_text === "string") {
    const outputText = interaction.output_text.trim();
    if (outputText) return outputText;
  }
  return (interaction.steps || [])
    .flatMap((step) => step.content || [])
    .map((content) => (typeof content.text === "string" ? content.text : ""))
    .filter(Boolean)
    .join("\n")
    .trim();
}

export async function transcribeAudioBufferWithGemini(
  buffer: Buffer,
  mimeType: string,
  fileName = "recording"
): Promise<string> {
  const ai = getGeminiClient();
  const normalizedMimeType = normalizeGeminiAudioMimeType(mimeType);
  const audio = new Blob([new Uint8Array(buffer)], { type: normalizedMimeType });
  let uploadedFileName: string | undefined;

  try {
    const uploadedFile = await withRetry(() =>
      ai.files.upload({
        file: audio,
        config: {
          mimeType: normalizedMimeType,
          displayName: fileName,
        },
      })
    );
    uploadedFileName = uploadedFile.name;
    if (!uploadedFile.uri) {
      throw new Error("Gemini did not return a URI for the uploaded recording");
    }

    const interaction = await withRetry(() =>
      ai.interactions.create({
        model: MODELS.transcription,
        input: [
          {
            type: "audio",
            uri: uploadedFile.uri,
            mime_type: normalizedMimeType,
          },
        ],
        generation_config: {
          transcription_config: {
            mode: "verbatim",
            language_codes: ["en-US"],
            custom_vocabulary: BUCKY_TRANSCRIPTION_VOCABULARY,
          },
        },
        store: false,
      })
    );
    const transcript = extractGeminiTranscript(interaction);
    if (!transcript) throw new Error("Gemini returned an empty audio transcript");
    return transcript;
  } finally {
    if (uploadedFileName) {
      try {
        await ai.files.delete({ name: uploadedFileName });
      } catch (error) {
        console.warn(`[Gemini] Could not delete temporary recording ${uploadedFileName}`, error);
      }
    }
  }
}
