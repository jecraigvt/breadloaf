import assert from "node:assert/strict";
import test from "node:test";
import {
  captureQuickVoiceNote,
  isQuickVoiceNote,
  quickVoiceNoteTopic,
  type VoiceMemoryData,
} from "./voice-note";

test("only Task 9 voice-memo triage can route to a quick note", () => {
  assert.equal(isQuickVoiceNote({ documentType: "voice_memo", voiceMemoDisposition: "quick_note" }), true);
  assert.equal(isQuickVoiceNote({ documentType: "voice_memo", voiceMemoDisposition: "archive_document" }), false);
  assert.equal(isQuickVoiceNote({ documentType: "corporate_record", voiceMemoDisposition: "quick_note" }), false);
});

test("a quick recording creates an attributed memory and never needs a document writer", async () => {
  const created: VoiceMemoryData[] = [];
  const indexed: string[] = [];
  const result = await captureQuickVoiceNote({
    findExisting: async () => null,
    createMemory: async (data) => {
      created.push(data);
      return { id: "memory-1", topic: data.topic };
    },
    indexMemory: async (id) => { indexed.push(id); },
  }, {
    transcript: "Gate code is 4821.",
    checksum: "audio-sha256",
    actorName: "Jim Craig",
  });

  assert.equal(result.created, true);
  assert.equal(created[0].source, "Voice note from Jim Craig");
  assert.equal(created[0].sourceType, "voice_note");
  assert.equal(created[0].content, "Gate code is 4821.");
  assert.deepEqual(indexed, ["memory-1"]);
});

test("an identical recording is retry-safe", async () => {
  let creates = 0;
  const result = await captureQuickVoiceNote({
    findExisting: async () => ({ id: "memory-existing", topic: "Gate code is 4821" }),
    createMemory: async () => {
      creates += 1;
      return { id: "unexpected", topic: "unexpected" };
    },
    indexMemory: async () => undefined,
  }, {
    transcript: "Gate code is 4821.",
    checksum: "audio-sha256",
    actorName: "Jim Craig",
  });

  assert.equal(result.created, false);
  assert.equal(creates, 0);
  assert.equal(quickVoiceNoteTopic("Gate code is 4821."), "Gate code is 4821");
});
