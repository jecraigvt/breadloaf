import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";
import { filterScopedDerivedRows } from "./derived-source-access";
import { prisma } from "./prisma";
import { createAuthToken, getAuthCookieName } from "./auth";
import { GET as questions } from "../app/api/bucky/questions/route";
import { PATCH as answerQuestion } from "../app/api/bucky/questions/[id]/route";
import { GET as maintenance, POST as createMaintenance } from "../app/api/maintenance/route";
import { GET as recording } from "../app/api/maintenance/[id]/recording/route";
import { GET as rawFile } from "../app/api/retained-files/[...path]/route";
import { POST as createDocument } from "../app/api/documents/route";
import { confirmFamilyChangeProposal } from "./family-change";

test("current document authority protects questions, copied maintenance and every file alias", async () => {
  const documents = [{ id: "family", filePath: "/uploads/family.wav", accessScope: "family", deletedAt: null }, { id: "board", filePath: "/uploads/board.wav", accessScope: "board", deletedAt: null }, { id: "vault", filePath: "/uploads/vault.wav", accessScope: "vault", deletedAt: null }];
  const db = { document: { findMany: async () => documents }, jarvisMemory: { findMany: async () => [] } } as unknown as NonNullable<Parameters<typeof filterScopedDerivedRows>[2]>;
  const rows = [{ id: "q-family", sourceType: "document", sourceId: "family" }, { id: "q-board", sourceType: "document", sourceId: "board" }, { id: "q-missing", sourceType: "document", sourceId: "missing" },
    { id: "copied-voice", sourceRecordings: [{ filePath: "/uploads/vault.wav", transcript: "synthetic private transcript" }] }, { id: "copied-receipt", sourceRecordings: [{ documentId: "board" }] }];
  assert.deepEqual((await filterScopedDerivedRows(rows, ["family"], db)).map(row => row.id), ["q-family"]);
  assert.deepEqual((await filterScopedDerivedRows(rows, ["family", "board"], db)).map(row => row.id), ["q-family", "q-board", "copied-receipt"]);
  assert.equal((await filterScopedDerivedRows([{ filePath: "/uploads/vault.wav" }], ["family"], db)).length, 0);
});
test("a privileged private-document upload cannot publish maintenance or photo questions to the family", async () => {
  const oldEnv = { FAMILY_PINS: process.env.FAMILY_PINS, FAMILY_EMAIL_SIGN_IN_ENABLED: process.env.FAMILY_EMAIL_SIGN_IN_ENABLED };
  const originals = { session: prisma.familySession.findUnique, category: prisma.category.findFirst, docCreate: prisma.document.create, docOne: prisma.document.findUnique,
    recordCreate: prisma.maintenanceRecord.create, questionCreate: prisma.buckyQuestion.create, chunkDelete: prisma.embedding.deleteMany };
  let maintenanceWrites = 0, questionWrites = 0;
  try {
    process.env.FAMILY_PINS = "Synthetic:9513"; process.env.FAMILY_EMAIL_SIGN_IN_ENABLED = "false";
    const token = await createAuthToken("Synthetic"), now = new Date();
    (prisma.familySession as unknown as { findUnique: unknown }).findUnique = async () => ({ revokedAt: null, expiresAt: new Date(Date.now() + 60000), lastUsedAt: now, verifiedAt: now, verifiedEmail: "synthetic@example.test", member: {
      id: "actor", name: "Synthetic Curator", displayName: "Synthetic", email: "synthetic@example.test", accessApproved: true, canClaim: true, isMinor: false, deceased: false, isCurator: true, isBoardMember: true,
    } });
    (prisma.category as unknown as { findFirst: unknown }).findFirst = async () => ({ id: "receipts", name: "Receipts" });
    (prisma.document as unknown as { create: unknown }).create = async ({ data }: { data: Record<string, unknown> }) => ({ ...data, id: "private-doc", category: { id: "receipts", name: "Receipts" } });
    (prisma.document as unknown as { findUnique: unknown }).findUnique = async () => ({ id: "private-doc", accessScope: "board" });
    (prisma.embedding as unknown as { deleteMany: unknown }).deleteMany = async () => ({ count: 0 });
    (prisma.maintenanceRecord as unknown as { create: unknown }).create = async () => { maintenanceWrites++; throw new Error("Must not publish private summary"); };
    (prisma.buckyQuestion as unknown as { create: unknown }).create = async () => { questionWrites++; throw new Error("Must not publish private question"); };
    const response = await createDocument(new NextRequest("https://breadloafhill.com/api/documents", { method: "POST", headers: { Cookie: `${getAuthCookieName()}=${token}; breadloaf_identity=synthetic-identity`, "Content-Type": "application/json" },
      body: JSON.stringify({ fileType: "link", filePath: "https://example.test/synthetic", title: "PRIVATE SYNTHETIC CANARY", accessScope: "board", categorySlug: "receipts", maintenanceVendor: "Synthetic Vendor", maintenanceCost: 1, intakeType: "historical_photo", historicalPhotoCandidateIds: [] }) }));
    assert.equal(response.status, 200); assert.equal((await response.json()).accessScope, "board"); assert.equal(maintenanceWrites, 0); assert.equal(questionWrites, 0);
  } finally {
    prisma.familySession.findUnique = originals.session; prisma.category.findFirst = originals.category; prisma.document.create = originals.docCreate; prisma.document.findUnique = originals.docOne;
    prisma.maintenanceRecord.create = originals.recordCreate; prisma.buckyQuestion.create = originals.questionCreate; prisma.embedding.deleteMany = originals.chunkDelete;
    for (const [key, value] of Object.entries(oldEnv)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  }
});
test("family proposal confirmation runs authority first and cannot disable approved access", async () => {
  const original = prisma.$transaction;
  let claimed = false, updated = false;
  const tx = { buckyQuestion: {
    updateMany: async () => { claimed = true; return { count: 1 }; }, findUnique: async () => ({ proposedAction: { version: 1, summary: "Synthetic correction", people: [], parentEdges: [], spouseEdges: [], corrections: [{ target: "Synthetic Curator", changes: { deceased: true } }] } }),
  }, familyMember: { findMany: async () => [{ id: "curator", name: "Synthetic Curator", displayName: "Synthetic", surname: "Curator", branch: null, isMinor: false, deceased: false, accessApproved: true }], update: async () => { updated = true; throw new Error("Must not disable approved access"); } }, familyRelationship: { findMany: async () => [] } };
  try {
    (prisma as unknown as { $transaction: unknown }).$transaction = async (callback: (client: unknown) => Promise<unknown>) => callback(tx);
    await assert.rejects(confirmFamilyChangeProposal({ questionId: "q", minorDecisions: {}, confirmedBy: "Synthetic", authorize: async () => { throw new Error("Synthetic revoked actor"); } }), /revoked actor/);
    assert.equal(claimed, false);
    await assert.rejects(confirmFamilyChangeProposal({ questionId: "q", minorDecisions: {}, confirmedBy: "Synthetic", authorize: async () => {} }), /Revoke approved access/);
    assert.equal(updated, false);
  } finally { prisma.$transaction = original; }
});

test("document filing keeps originals while maintenance requires an actual date and valid cents", async () => {
  const oldEnv = { FAMILY_PINS: process.env.FAMILY_PINS, FAMILY_EMAIL_SIGN_IN_ENABLED: process.env.FAMILY_EMAIL_SIGN_IN_ENABLED };
  const originals = { category: prisma.category.findFirst, docCreate: prisma.document.create, docOne: prisma.document.findUnique,
    recordCreate: prisma.maintenanceRecord.create, recordOne: prisma.maintenanceRecord.findUnique, embeddingDelete: prisma.embedding.deleteMany };
  const records: Array<Record<string, unknown>> = []; let documents = 0;
  try {
    process.env.FAMILY_PINS = "Synthetic:9513"; process.env.FAMILY_EMAIL_SIGN_IN_ENABLED = "false";
    const token = await createAuthToken("Synthetic"), headers = { Cookie: `${getAuthCookieName()}=${token}`, "Content-Type": "application/json" };
    (prisma.category as unknown as { findFirst: unknown }).findFirst = async () => ({ id: "receipts", name: "Receipts" });
    (prisma.document as unknown as { create: unknown }).create = async ({ data }: { data: Record<string, unknown> }) => ({ ...data, id: `synthetic-doc-${++documents}`, category: { id: "receipts", name: "Receipts" } });
    (prisma.document as unknown as { findUnique: unknown }).findUnique = async () => null;
    (prisma.maintenanceRecord as unknown as { create: unknown }).create = async ({ data }: { data: Record<string, unknown> }) => { records.push(data); return { ...data, id: "synthetic-maintenance" }; };
    (prisma.maintenanceRecord as unknown as { findUnique: unknown }).findUnique = async () => null;
    (prisma.embedding as unknown as { deleteMany: unknown }).deleteMany = async () => ({ count: 0 });
    const file = async (fields: Record<string, unknown>) => {
      const response = await createDocument(new NextRequest("https://breadloafhill.com/api/documents", { method: "POST", headers, body: JSON.stringify({
        fileType: "link", filePath: "https://example.test/synthetic-receipt", title: "Synthetic maintenance receipt", categorySlug: "receipts", maintenanceVendor: "Synthetic Vendor", ...fields,
      }) }));
      assert.equal(response.status, 200); assert.ok((await response.json()).id); // The archive survives every skipped side effect.
    };
    for (const fields of [{ maintenanceCost: 12.34 }, { maintenanceDate: "2020-02-31", maintenanceCost: 12.34 },
      { maintenanceDate: "not-a-date", maintenanceCost: 12.34 }, { maintenanceDate: "2020-02-03", maintenanceCost: 12.345 },
      { maintenanceDate: "2020-02-03", maintenanceCost: -1 }, { maintenanceDate: "2020-02-03", maintenanceCost: "12.34garbage" }]) {
      await file(fields); assert.equal(records.length, 0);
    }
    await file({ maintenanceDate: "2020-02-03", maintenanceCost: 12.34 });
    assert.equal(records.length, 1); assert.equal((records[0].performedAt as Date).toISOString(), "2020-02-03T00:00:00.000Z");
    assert.equal(records[0].cost, 12.34); assert.equal(records[0].category, "General");
    assert.deepEqual(records[0].sourceRecordings, [{ documentId: "synthetic-doc-7" }]);
    await file({ maintenanceDate: "2020-02-03", maintenanceCost: 0, maintenanceVendor: undefined }); assert.equal(records.length, 2); assert.equal(records[1].cost, 0);
  } finally {
    prisma.category.findFirst = originals.category; prisma.document.create = originals.docCreate; prisma.document.findUnique = originals.docOne;
    prisma.maintenanceRecord.create = originals.recordCreate; prisma.maintenanceRecord.findUnique = originals.recordOne; prisma.embedding.deleteMany = originals.embeddingDelete;
    for (const [key, value] of Object.entries(oldEnv)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  }
});
test("stale shared memories, dictation connections and proposals cannot preserve a later-private source", async () => {
  let scope = "family";
  const db = { document: { findMany: async () => [{ id: "document", filePath: "/uploads/source.wav", accessScope: scope, deletedAt: null }] },
    buckyQuestion: { findMany: async () => [{ id: "question", sourceType: "document", sourceId: "document" }] },
    jarvisMemory: { findMany: async (args: { where: { id?: unknown } }) => args.where.id ? [{ id: "answer", sourceType: "question", sourceId: "question", accessScope: "family" }] : [] },
  } as unknown as NonNullable<Parameters<typeof filterScopedDerivedRows>[2]>;
  const rows = [{ id: "answer", sourceType: "question", sourceId: "question", accessScope: "family" }, { id: "analysis", connections: [{ sourceKey: "document:document" }] }, { id: "proposal", proposedAction: { sourceMemoryIds: ["answer"] } }];
  assert.equal((await filterScopedDerivedRows(rows, ["family"], db)).length, 3);
  scope = "vault"; assert.equal((await filterScopedDerivedRows(rows, ["family"], db)).length, 0);
  assert.equal((await filterScopedDerivedRows(rows, ["family", "board"], db)).length, 0);
  assert.equal((await filterScopedDerivedRows(rows, ["family", "board", "vault"], db)).length, 3);
});
test("real family handlers hide private canaries, reject source injection and refuse face-only family confirmations", async () => {
  const oldEnv = { FAMILY_PINS: process.env.FAMILY_PINS, FAMILY_EMAIL_SIGN_IN_ENABLED: process.env.FAMILY_EMAIL_SIGN_IN_ENABLED };
  const originals = { document: prisma.document.findMany, memory: prisma.jarvisMemory.findMany, recordMany: prisma.maintenanceRecord.findMany, recordOne: prisma.maintenanceRecord.findUnique, questionMany: prisma.buckyQuestion.findMany, questionOne: prisma.buckyQuestion.findUnique };
  try {
    process.env.FAMILY_PINS = "Synthetic:9513"; process.env.FAMILY_EMAIL_SIGN_IN_ENABLED = "false";
    const token = await createAuthToken("Synthetic"), headers = { Cookie: `${getAuthCookieName()}=${token}`, "Content-Type": "application/json" };
    const record = { id: "record", title: "PRIVATE SYNTHETIC CANARY", category: "hvac", sourceRecordings: [{ filePath: "/uploads/private.wav", fileName: "private.wav", transcript: "PRIVATE SYNTHETIC CANARY" }] };
    (prisma.document as unknown as { findMany: unknown }).findMany = async () => [{ id: "doc", filePath: "/uploads/private.wav", accessScope: "vault", deletedAt: null }];
    (prisma.jarvisMemory as unknown as { findMany: unknown }).findMany = async () => [];
    (prisma.maintenanceRecord as unknown as { findMany: unknown }).findMany = async () => [record];
    (prisma.maintenanceRecord as unknown as { findUnique: unknown }).findUnique = async () => record;
    (prisma.buckyQuestion as unknown as { findMany: unknown }).findMany = async () => [{ id: "question", sourceType: "document", sourceId: "doc", question: "PRIVATE SYNTHETIC CANARY" }];
    (prisma.buckyQuestion as unknown as { findUnique: unknown }).findUnique = async () => ({ id: "question", sourceType: "document", sourceId: "doc", question: "PRIVATE SYNTHETIC CANARY" });
    for (const handler of [questions, maintenance]) { const response = await handler(new NextRequest("https://breadloafhill.com/api/synthetic", { headers })); assert.equal(response.status, 200); assert.deepEqual(await response.json(), []); }
    assert.equal((await recording(new NextRequest("https://breadloafhill.com/api/maintenance/record/recording", { headers }), { params: Promise.resolve({ id: "record" }) })).status, 403);
    assert.equal((await rawFile(new NextRequest("https://breadloafhill.com/uploads/private.wav", { headers }), { params: Promise.resolve({ path: ["private.wav"] }) })).status, 403);
    assert.equal((await answerQuestion(new NextRequest("https://breadloafhill.com/api/bucky/questions/question", { method: "PATCH", headers, body: JSON.stringify({ answer: "anything" }) }), { params: Promise.resolve({ id: "question" }) })).status, 403);
    assert.equal((await createMaintenance(new NextRequest("https://breadloafhill.com/api/maintenance", { method: "POST", headers, body: JSON.stringify({ title: "synthetic", performedAt: "2026-10-13", sourceRecordings: record.sourceRecordings }) }))).status, 400);
    (prisma.buckyQuestion as unknown as { findUnique: unknown }).findUnique = async () => ({ id: "question", questionType: "family_change_proposal", sourceType: "conversation", sourceId: null });
    assert.equal((await answerQuestion(new NextRequest("https://breadloafhill.com/api/bucky/questions/question", { method: "PATCH", headers, body: JSON.stringify({ action: "confirm_family_change", minorDecisions: {} }) }), { params: Promise.resolve({ id: "question" }) })).status, 403);
  } finally {
    prisma.document.findMany = originals.document; prisma.jarvisMemory.findMany = originals.memory; prisma.maintenanceRecord.findMany = originals.recordMany; prisma.maintenanceRecord.findUnique = originals.recordOne; prisma.buckyQuestion.findMany = originals.questionMany; prisma.buckyQuestion.findUnique = originals.questionOne;
    for (const [key, value] of Object.entries(oldEnv)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  }
});
