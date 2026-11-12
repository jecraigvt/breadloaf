// Provider model IDs live in one dependency-light module so retrieval helpers
// do not need to import the full assistant runtime.
const HYDROGEN = "gemini-4-hydrogen";

export const MODELS = {
  flash: HYDROGEN,
  pro: HYDROGEN,
  localWorker: "gpt-5.6-terra",
  embedding: "text-embedding-3-small",
  transcription: "gemini-3.5-transcribe",
  videoTranscription: HYDROGEN,
} as const;
