import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";
import { prisma } from "./prisma";
import { createAuthToken, getAuthCookieName } from "./auth";
import { createAccountsVaultToken, validateAccountsVaultToken } from "./accounts-vault-auth";
import { GET as listDocuments, POST as createDocument } from "../app/api/documents/route";
import { GET as documentDetails } from "../app/api/documents/[id]/route";
import { GET as documentFile } from "../app/api/documents/[id]/file/route";
import { POST as categorize } from "../app/api/categorize/route";
import { PATCH as updateMember } from "../app/api/family/[id]/route";
import { GET as rawFile } from "../app/api/retained-files/[...path]/route";
import { POST as undoLedger } from "../app/api/bucky/ledger/[id]/undo/route";
import { GET as readLedger } from "../app/api/bucky/ledger/route";

test("actual handlers reject anonymous requests, private document reads, privilege escalation and traversal", async () => {
  const env = { FAMILY_PINS: process.env.FAMILY_PINS, FAMILY_EMAIL_SIGN_IN_ENABLED: process.env.FAMILY_EMAIL_SIGN_IN_ENABLED };
  const oldFindMany = prisma.document.findMany;
  const oldCount = prisma.document.count;
  const oldFindUnique = prisma.document.findUnique;
  const oldUpdate = prisma.familyMember.update;
  const oldLedgerFind = prisma.buckyLedgerEntry.findUnique;
  const oldLedgerList = prisma.buckyLedgerEntry.findMany;
  const oldMemoryList = prisma.jarvisMemory.findMany;
  try {
    process.env.FAMILY_PINS = "Synthetic:9231";
    process.env.FAMILY_EMAIL_SIGN_IN_ENABLED = "false";
    const token = await createAuthToken("Synthetic");
    const headers = { Cookie: `${getAuthCookieName()}=${token}`, "Content-Type": "application/json" };
    const privateDoc = { id: "synthetic", accessScope: "vault", filePath: "/uploads/synthetic.txt", fileType: "text/plain", fileName: "synthetic.txt", deletedAt: null };
    let reachedUpdate = false;
    (prisma.document as unknown as { findUnique: unknown }).findUnique = async () => privateDoc;
    (prisma.familyMember as unknown as { update: unknown }).update = async () => { reachedUpdate = true; throw new Error("Must not mutate"); };
    (prisma.buckyLedgerEntry as unknown as { findUnique: unknown }).findUnique = async () => ({ id: "synthetic", actionType: "update_position", entityType: "position", entityId: "position", sourceType: "conversation", sourceId: null });
    (prisma.buckyLedgerEntry as unknown as { findMany: unknown }).findMany = async () => [{ id: "synthetic", actionType: "set_document_category", entityType: "document", entityId: "synthetic", sourceType: "document", sourceId: "synthetic", beforeState: { documentId: "synthetic", title: "PRIVATE SYNTHETIC TITLE" }, afterState: { documentId: "synthetic" }, summary: "PRIVATE SYNTHETIC TITLE", reversible: true }];
    (prisma.document as unknown as { findMany: unknown }).findMany = async (args: { where: { accessScope?: { in: string[] }; filePath?: string } }) => {
      if (args.where.filePath?.includes("..")) return [];
      if (args.where.accessScope) {
        assert.deepEqual(args.where.accessScope.in, ["family"]);
        return [];
      }
      return [privateDoc];
    };
    (prisma.document as unknown as { count: unknown }).count = async () => 0;
    (prisma.jarvisMemory as unknown as { findMany: unknown }).findMany = async () => [];
    assert.equal((await listDocuments(new NextRequest("https://breadloafhill.com/api/documents"))).status, 401);
    assert.equal((await listDocuments(new NextRequest("https://breadloafhill.com/api/documents", { headers }))).status, 200);
    const params = { params: Promise.resolve({ id: "synthetic" }) };
    assert.equal((await documentDetails(new NextRequest("https://breadloafhill.com/api/documents/synthetic", { headers }), params)).status, 403);
    assert.equal((await documentFile(new NextRequest("https://breadloafhill.com/api/documents/synthetic/file", { headers }), params)).status, 403);
    assert.equal((await rawFile(new NextRequest("https://breadloafhill.com/uploads/synthetic.txt", { headers }), { params: Promise.resolve({ path: ["synthetic.txt"] }) })).status, 403);
    assert.equal((await updateMember(new NextRequest("https://breadloafhill.com/api/family/synthetic", { method: "PATCH", headers, body: JSON.stringify({ isCurator: true, credential: { delete: true } }) }), params)).status, 403);
    assert.equal(reachedUpdate, false);
    assert.equal((await undoLedger(new NextRequest("https://breadloafhill.com/api/bucky/ledger/synthetic/undo", { method: "POST", headers }), params)).status, 403);
    const ledger = await readLedger(new NextRequest("https://breadloafhill.com/api/bucky/ledger", { headers }));
    assert.equal(ledger.status, 200);
    assert.deepEqual(await ledger.json(), []);
    (prisma.buckyLedgerEntry as unknown as { findUnique: unknown }).findUnique = async () => ({ id: "synthetic", actionType: "set_document_category", entityType: "document", entityId: "synthetic", sourceType: "document", sourceId: "synthetic", afterState: { documentId: "synthetic" } });
    assert.equal((await undoLedger(new NextRequest("https://breadloafhill.com/api/bucky/ledger/synthetic/undo", { method: "POST", headers }), params)).status, 403);
    assert.equal((await categorize(new NextRequest("https://breadloafhill.com/api/categorize", { method: "POST", headers, body: JSON.stringify({ filePath: "/uploads/../synthetic-secret.txt", fileType: "text/plain" }) }))).status, 400);
    assert.equal((await createDocument(new NextRequest("https://breadloafhill.com/api/documents", { method: "POST", headers, body: JSON.stringify({ filePath: "http://127.0.0.1/private", fileType: "link" }) }))).status, 400);
  } finally {
    prisma.document.findMany = oldFindMany;
    prisma.document.count = oldCount;
    prisma.document.findUnique = oldFindUnique;
    prisma.familyMember.update = oldUpdate;
    prisma.buckyLedgerEntry.findUnique = oldLedgerFind;
    prisma.buckyLedgerEntry.findMany = oldLedgerList;
    prisma.jarvisMemory.findMany = oldMemoryList;
    for (const [name, value] of Object.entries(env)) { if (value === undefined) delete process.env[name]; else process.env[name] = value; }
  }
});

test("changing a vault passphrase verifier invalidates previously issued vault cookies", async () => {
  const oldFindUnique = prisma.vaultConfiguration.findUnique;
  const oldSecret = process.env.AUTH_SECRET;
  let passwordHash = "synthetic-password-verifier-v1";
  try {
    process.env.AUTH_SECRET = "synthetic-fixed-site-secret";
    (prisma.vaultConfiguration as unknown as { findUnique: unknown }).findUnique = async () => ({ passwordHash });
    const first = await createAccountsVaultToken();
    assert.equal(await validateAccountsVaultToken(first), true);
    passwordHash = "synthetic-password-verifier-v2";
    assert.equal(await validateAccountsVaultToken(first), false);
    const second = await createAccountsVaultToken();
    assert.equal(await validateAccountsVaultToken(second), true);
  } finally {
    prisma.vaultConfiguration.findUnique = oldFindUnique;
    if (oldSecret === undefined) delete process.env.AUTH_SECRET; else process.env.AUTH_SECRET = oldSecret;
  }
});
