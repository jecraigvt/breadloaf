import assert from "node:assert/strict";
import test from "node:test";
import type { ActorContext } from "./actor";
import { getAssistantBackgroundWorkStatus, queueAssistantBackgroundWork } from "./bucky-background-assistant";

const actor: ActorContext = { memberId: "member-1", displayName: "Jeremy", fullName: "Jeremy Craig", branch: "Tom", boardRole: null, isBoardMember: false, isCurator: true };
const job = { id: "job-1", kind: "document_analysis", status: "queued", request: { title: "Minutes", sourceDocumentIds: ["doc-1"] }, sourceDocumentId: "doc-1", fallbackAfter: new Date("2026-09-06T12:00:00Z") };
const noWrites = {
  familyDocuments: async () => [{ id: "doc-1" }],
  queueDocument: async () => { throw new Error("Unexpected write"); },
  enqueue: async () => { throw new Error("Unexpected write"); },
  findJobs: async () => [job],
};

test("chat cannot grant website authority through model arguments or a claimed name", async () => {
  const result = await queueAssistantBackgroundWork({ kind: "site_improvement", instructions: "Improve the calendar", actor, username: "Jeremy", isCurator: true }, null, noWrites);
  assert.equal(result.success, false);
  assert.match(String(result.error), /signed-in curator or board identity/);
});

test("document background analysis needs an exact source ID and uses only the server actor", async () => {
  const missing = await queueAssistantBackgroundWork({ kind: "document_analysis" }, actor, noWrites);
  assert.equal(missing.success, false);
  let receivedActor: ActorContext | null = null;
  const result = await queueAssistantBackgroundWork({ kind: "document_analysis", documentId: "doc-1", uploadedBy: "Forged", actor: { memberId: "forged" } }, actor, {
    ...noWrites, queueDocument: async (id, trustedActor) => { assert.equal(id, "doc-1"); receivedActor = trustedActor; return job; },
  });
  assert.equal(receivedActor, actor);
  assert.equal(result.success, true);
  assert.equal((result.job as { status: string }).status, "queued");
  assert.match(String(result.note), /do not claim analysis/);
});

test("archive review rejects a missing or restricted source before enqueueing", async () => {
  const result = await queueAssistantBackgroundWork({ kind: "archive_review", instructions: "Review these", sourceDocumentIds: ["doc-1", "restricted"] }, actor, noWrites);
  assert.equal(result.success, false);
});

test("authorized website requests use trusted attribution and cannot force urgency", async () => {
  let submitted: Record<string, unknown> | null = null;
  const result = await queueAssistantBackgroundWork({ kind: "site_improvement", instructions: "Improve the calendar", initiatedById: "forged", priority: 100 }, actor, {
    ...noWrites, enqueue: async (input) => { submitted = input; return { ...job, kind: "site_improvement", sourceDocumentId: null }; },
  });
  assert.equal(result.success, true);
  assert.deepEqual(submitted, { kind: "site_improvement", request: { title: "Website improvement", instructions: "Improve the calendar" }, initiatedById: "member-1", initiatedByName: "Jeremy" });
});

test("status is read-only and excludes jobs whose attached source is no longer available", async () => {
  const result = await getAssistantBackgroundWorkStatus({}, { ...noWrites, familyDocuments: async () => [] });
  assert.equal(result.success, undefined);
  assert.deepEqual(result.jobs, []);
  const visible = await getAssistantBackgroundWorkStatus({ jobId: "job-1" }, noWrites);
  assert.equal(visible.success, undefined);
  assert.equal((visible.jobs as unknown[]).length, 1);
  assert.equal(JSON.stringify(visible).includes("leaseToken"), false);
});
