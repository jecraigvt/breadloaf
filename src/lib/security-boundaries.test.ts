import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { accessibleDocumentScopes, assertDocumentAccess, isPrivilegedActor } from "./access-policy";
import type { ActorContext } from "./actor";
import { FamilyProfilePatchSchema } from "./family-profile-input";
import { containedRetainedPath, readTrustedRetainedFile, retainedExtension, retainedPathName, retainedResponseType } from "./retained-file-security";
import { isPublicAddress, safeExternalFetch, safeLinkUrl, type SafeExternalFetchDependencies } from "./safe-external-fetch";

const officer: ActorContext = { memberId: "officer", displayName: "Officer", fullName: "Officer", branch: "Craig", boardRole: "Treasurer", isBoardMember: true, isCurator: false, verified: true };

test("a face claim cannot authorize board work, and a verified role does not unlock vault documents", () => {
  const tap = { ...officer, verified: false };
  assert.equal(isPrivilegedActor(tap), false);
  assert.deepEqual(accessibleDocumentScopes({ actor: tap, vaultUnlocked: true }), ["family"]);
  assert.deepEqual(accessibleDocumentScopes({ actor: officer, vaultUnlocked: false }), ["family", "board"]);
  assert.throws(() => assertDocumentAccess("vault", { actor: officer, vaultUnlocked: false }));
  assert.doesNotThrow(() => assertDocumentAccess("vault", { actor: officer, vaultUnlocked: true }));
  assert.throws(() => assertDocumentAccess("unknown", { actor: officer, vaultUnlocked: true }));
});

test("family edits accept profile fields and reject nested Prisma credentials, sessions and IDs", () => {
  assert.equal(FamilyProfilePatchSchema.parse({ name: "  Family member  ", phone: "802" }).name, "Family member");
  for (const value of [{ credential: { delete: true } }, { sessions: { create: { tokenHash: "bad" } } }, { id: "other" }, { name: "" }, { isCurator: "true" }]) {
    assert.throws(() => FamilyProfilePatchSchema.parse(value));
  }
});

test("retained reads reject traversal and active MIME changes before returning outside bytes", async () => {
  const folder = await mkdtemp(path.join(os.tmpdir(), "breadloaf-file-security-"));
  try {
    await writeFile(path.join(folder, "safe.txt"), "SYNTHETIC CANARY");
    const retained = await readTrustedRetainedFile({ filePath: "/uploads/safe.txt", fileType: "text/plain" }, folder);
    assert.equal(retained.buffer.toString(), "SYNTHETIC CANARY");
    for (const filePath of ["../secret.txt", "/uploads/../secret.txt", "/uploads/%2e%2e%2fsecret.txt", "/uploads/folder/secret.txt", "/uploads/..\\secret.txt"]) {
      assert.throws(() => retainedPathName(filePath));
      await assert.rejects(containedRetainedPath(filePath, folder));
    }
    await assert.rejects(readTrustedRetainedFile({ filePath: "/uploads/safe.txt", fileType: "text/html" }, folder));
    assert.deepEqual(retainedResponseType("text/html"), { fileType: "application/octet-stream", inline: false });
    assert.deepEqual(retainedResponseType("image/svg+xml"), { fileType: "application/octet-stream", inline: false });
    assert.equal(retainedExtension("uploaded.html", "text/plain"), "txt");
    assert.equal(retainedExtension("voice", "audio/mp4"), "m4a");
  } finally { await rm(folder, { recursive: true, force: true }); }
});

test("external links reject alternate loopback encodings, credentials, internal names and service ports", () => {
  for (const url of ["http://127.0.0.1", "http://2130706433", "http://0x7f000001", "http://[::1]", "http://[::ffff:127.0.0.1]", "http://169.254.169.254", "http://postgres.railway.internal", "http://localhost", "http://user:password@example.com", "https://example.com:5432", "file:///etc/passwd"]) {
    assert.throws(() => safeLinkUrl(url), url);
  }
  assert.equal(safeLinkUrl("https://example.com/document").hostname, "example.com");
  assert.equal(isPublicAddress("8.8.8.8"), true);
  assert.equal(isPublicAddress("2606:4700:4700::1111"), true);
  for (const ip of ["10.0.0.1", "100.64.0.1", "172.16.0.1", "192.168.1.1", "192.0.2.1", "198.18.0.1", "224.0.0.1", "fc00::1", "fe80::1", "2001:db8::1", "2002:7f00:1::"]) assert.equal(isPublicAddress(ip), false, ip);
});

test("DNS is checked before connecting, the connection receives the validated address, and redirects are revalidated", async () => {
  let calls = 0;
  const services: SafeExternalFetchDependencies = {
    resolve: async () => [{ address: "8.8.8.8", family: 4 }],
    request: async (_url, address) => { calls++; assert.equal(address.address, "8.8.8.8"); return new Response(null, { status: 302, headers: { Location: "http://127.0.0.1/secret" } }); },
  };
  await assert.rejects(safeExternalFetch("https://example.com", {}, services), /public website/);
  assert.equal(calls, 1);
  calls = 0;
  await assert.rejects(safeExternalFetch("https://example.com", {}, { ...services, resolve: async () => [{ address: "8.8.8.8", family: 4 }, { address: "127.0.0.1", family: 4 }] }), /private or reserved/);
  assert.equal(calls, 0);
  const response = await safeExternalFetch("https://example.com", {}, { ...services, request: async (_url, address) => { assert.equal(address.address, "8.8.8.8"); return new Response("Public document"); } });
  assert.equal(await response.text(), "Public document");
});
