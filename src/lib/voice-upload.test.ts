import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { storeFileBuffer } from "./file-storage";
import { captureQuickVoiceNote, type VoiceMemoryData } from "./voice-note";
import { processVoiceUpload } from "./voice-upload";

async function withUploadRoot(run: (uploadRoot: string) => Promise<void>) {
  const uploadRoot = await mkdtemp(path.join(os.tmpdir(), "breadloaf-voice-route-"));
  try {
    await run(uploadRoot);
  } finally {
    await rm(uploadRoot, { recursive: true, force: true });
  }
}

test("a quick note keeps playable bytes on disk and creates no Document", async () => {
  await withUploadRoot(async (uploadRoot) => {
    const events: string[] = [];
    const memories: VoiceMemoryData[] = [];
    let documentCreates = 0;
    const buffer = Buffer.from("short voice note bytes");

    const result = await processVoiceUpload({
      findRetainedFile: async () => null,
      storeFile: async (options) => {
        const stored = await storeFileBuffer({ ...options, uploadRoot });
        events.push("stored");
        return stored;
      },
      transcribe: async () => {
        events.push("transcribed");
        return "Gate code is 4821.";
      },
      triage: async () => {
        events.push("triaged");
        return { documentType: "voice_memo", voiceMemoDisposition: "quick_note" };
      },
      captureQuickNote: (input) => captureQuickVoiceNote({
        findExisting: async () => null,
        createMemory: async (data) => {
          memories.push(data);
          return { id: "memory-1", topic: data.topic, filePath: data.filePath };
        },
        attachFile: async () => { throw new Error("new memory should already be linked"); },
        indexMemory: async () => undefined,
      }, input),
      fileDocument: async () => {
        documentCreates++;
        throw new Error("quick notes must not enter document filing");
      },
    }, {
      buffer,
      fileName: "gate-code.m4a",
      contentType: "audio/mp4",
      actorName: "Jim Craig",
    });

    assert.equal(result.route, "quick_note");
    assert.deepEqual(events, ["stored", "transcribed", "triaged"]);
    assert.equal(documentCreates, 0);
    assert.equal(memories[0].source, "Voice note from Jim Craig");
    assert.equal(memories[0].filePath, result.storedFile.filePath);
    assert.deepEqual(
      await readFile(path.join(uploadRoot, path.basename(memories[0].filePath))),
      buffer
    );
  });
});

test("a substantive recording reuses the retained file in Document filing", async () => {
  await withUploadRoot(async (uploadRoot) => {
    const events: string[] = [];
    const buffer = Buffer.from("long property walkthrough bytes");

    const result = await processVoiceUpload({
      findRetainedFile: async () => null,
      storeFile: async (options) => {
        const stored = await storeFileBuffer({ ...options, uploadRoot });
        events.push("stored");
        return stored;
      },
      transcribe: async () => {
        events.push("transcribed");
        return "This is a detailed walkthrough of the furnace and well systems.";
      },
      triage: async () => {
        events.push("triaged");
        return { documentType: "voice_memo", voiceMemoDisposition: "archive_document" };
      },
      captureQuickNote: async () => {
        throw new Error("substantive recordings must not create quick-note memories");
      },
      fileDocument: async (options) => {
        events.push("document");
        assert.ok(options.storedFile);
        assert.deepEqual(
          await readFile(path.join(uploadRoot, path.basename(options.storedFile.filePath))),
          buffer
        );
        return {
          id: "document-1",
          title: "Furnace and well walkthrough",
          category: "Maintenance",
          categoryCreated: false,
          needsReview: false,
          summary: "A detailed systems walkthrough.",
          extractedText: "Furnace and well systems.",
          analysisState: "ok",
          analysisError: null,
          alreadyExisted: false,
        };
      },
    }, {
      buffer,
      fileName: "walkthrough.m4a",
      contentType: "audio/mp4",
      actorName: "Jim Craig",
    });

    assert.equal(result.route, "document");
    assert.equal(result.document.id, "document-1");
    assert.deepEqual(events, ["stored", "transcribed", "triaged", "document"]);
  });
});

test("audio remains on disk when transcription fails after retention", async () => {
  await withUploadRoot(async (uploadRoot) => {
    const buffer = Buffer.from("voice bytes before provider failure");
    await assert.rejects(
      processVoiceUpload({
        findRetainedFile: async () => null,
        storeFile: (options) => storeFileBuffer({ ...options, uploadRoot }),
        transcribe: async () => { throw new Error("provider unavailable"); },
        triage: async () => {
          throw new Error("triage must not run after transcription fails");
        },
        captureQuickNote: async () => {
          throw new Error("capture must not run after transcription fails");
        },
        fileDocument: async () => {
          throw new Error("filing must not run after transcription fails");
        },
      }, {
        buffer,
        fileName: "interrupted.m4a",
        contentType: "audio/mp4",
        actorName: "Jim Craig",
      }),
      /provider unavailable/
    );

    const [storedName] = await readdir(uploadRoot);
    assert.ok(storedName);
    assert.deepEqual(await readFile(path.join(uploadRoot, storedName)), buffer);
  });
});
