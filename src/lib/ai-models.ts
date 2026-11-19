// Provider model IDs live in one dependency-light module so retrieval helpers
// do not need to import the full assistant runtime.
export const MODELS = {
  flash: "gpt-5.6-luna",
  pro: "gpt-5.6-terra",
  embedding: "text-embedding-3-small",
  transcription: "gemini-3.5-transcribe",
  videoTranscription: "gpt-4o-mini-transcribe",
} as const;
