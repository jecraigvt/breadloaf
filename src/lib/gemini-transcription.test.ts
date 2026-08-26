import assert from "node:assert/strict";
import test from "node:test";
import {
  extractGeminiTranscript,
  normalizeGeminiAudioMimeType,
} from "./gemini-transcription";

test("normalizes Bucky browser recording MIME types for Gemini", () => {
  assert.equal(normalizeGeminiAudioMimeType("audio/mp4"), "audio/m4a");
  assert.equal(
    normalizeGeminiAudioMimeType("audio/webm;codecs=opus"),
    "audio/webm"
  );
});

test("extracts the SDK transcript and trims surrounding whitespace", () => {
  assert.equal(
    extractGeminiTranscript({ output_text: "  Breadloaf Hill is ready. \n" }),
    "Breadloaf Hill is ready."
  );
});

test("extracts transcript text from raw Interaction steps as a fallback", () => {
  assert.equal(
    extractGeminiTranscript({
      output_text: "",
      steps: [
        { content: [{ text: "First speaker." }] },
        { content: [{ text: "Second speaker." }] },
      ],
    }),
    "First speaker.\nSecond speaker."
  );
});
