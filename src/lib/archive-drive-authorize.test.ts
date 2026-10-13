import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { mkdir, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { BACKUP_FOLDER_NAME, createDriveLoopbackCallback, prepareAuthorizedDriveFolder, preparePrivateOAuthOutput, type DriveAuthorizationReceipt } from "../../scripts/archive-drive-authorize-common";
import { BACKUP_DRIVE_ACCOUNT, DRIVE_FILE_SCOPE, type DriveTransport } from "../../scripts/archive-drive-common";

const folderId = "syntheticAuthFolder12345";
const validFolder = { id: folderId, name: BACKUP_FOLDER_NAME, mimeType: "application/vnd.google-apps.folder", trashed: false, ownedByMe: true, capabilities: { canAddChildren: true } };
function fakeSetup(options: { account?: string; existing?: typeof validFolder[]; created?: Record<string, unknown>; verified?: Record<string, unknown>; nextPage?: string } = {}) {
  const calls: Array<{ url: string; method: string; body?: string | Uint8Array }> = [];
  const transport: DriveTransport = { async request(url, method, _headers, body) {
    calls.push({ url, method, body });
    if (url.includes("/about?")) return Response.json({ user: { emailAddress: options.account || BACKUP_DRIVE_ACCOUNT } });
    if (method === "POST") return Response.json({ ...validFolder, ...options.created });
    if (url.includes("/files?q=")) return Response.json({ files: options.existing || [], ...(options.nextPage ? { nextPageToken: options.nextPage } : {}) });
    return Response.json({ ...validFolder, ...options.verified });
  } };
  return { calls, transport };
}

test("loopback callback rejects forged or malformed state, then accepts one matching response without echoing its code", async () => {
  const callback = await createDriveLoopbackCallback();
  try {
    assert.match(callback.redirectUri, /^http:\/\/127\.0\.0\.1:\d+\/oauth2\/callback$/);
    for (const state of ["wrong-state", "é".repeat(43), callback.state + "x"]) {
      const response = await fetch(`${callback.redirectUri}?state=${encodeURIComponent(state)}&code=synthetic-secret-code`);
      assert.equal(response.status, 400); assert.equal((await response.text()).includes("synthetic-secret-code"), false);
    }
    const duplicate = await fetch(`${callback.redirectUri}?state=${callback.state}&state=${callback.state}&code=synthetic-secret-code`);
    assert.equal(duplicate.status, 400);
    const response = await fetch(`${callback.redirectUri}?state=${callback.state}&code=synthetic-secret-code`);
    assert.equal(response.status, 200); assert.equal((await response.text()).includes("synthetic-secret-code"), false);
    assert.equal(await callback.code, "synthetic-secret-code");
    await assert.rejects(fetch(`${callback.redirectUri}?state=${callback.state}&code=second-code`));
  } finally { await callback.close(); }
});
test("loopback cancellation and expiration reject authorization instead of producing credentials", async () => {
  const cancelled = await createDriveLoopbackCallback();
  try {
    const response = await fetch(`${cancelled.redirectUri}?state=${cancelled.state}&error=access_denied`);
    assert.equal(response.status, 200); await assert.rejects(cancelled.code, /cancelled/);
  } finally { await cancelled.close(); }
  const expired = await createDriveLoopbackCallback(20);
  try { await assert.rejects(expired.code, /expired/); } finally { await expired.close(); }
});
test("wrong scope or wrong account cannot create a folder or proceed to credential persistence", async () => {
  const wrongScope = fakeSetup(); await assert.rejects(prepareAuthorizedDriveFolder(wrongScope.transport, [DRIVE_FILE_SCOPE, "https://www.googleapis.com/auth/drive"]), /scope only/);
  assert.equal(wrongScope.calls.length, 0);
  const wrongAccount = fakeSetup({ account: "other@example.test" }); await assert.rejects(prepareAuthorizedDriveFolder(wrongAccount.transport, [DRIVE_FILE_SCOPE]), /different account/);
  assert.equal(wrongAccount.calls.length, 1); assert.equal(wrongAccount.calls[0].method, "GET");
});
test("the property account creates one dedicated folder using the same client and validates it again", async () => {
  const fake = fakeSetup(); assert.equal(await prepareAuthorizedDriveFolder(fake.transport, [DRIVE_FILE_SCOPE]), folderId);
  const mutations = fake.calls.filter(call => call.method === "POST"); assert.equal(mutations.length, 1);
  const body = JSON.parse(String(mutations[0].body)); assert.equal(body.name, BACKUP_FOLDER_NAME); assert.equal(body.mimeType, validFolder.mimeType);
  assert.deepEqual(body.appProperties, { breadloafBackupFolder: "1" }); assert.ok(fake.calls.at(-1)?.url.includes(`/files/${folderId}?`));
});
test("a usable existing folder is reused, while ambiguous, trashed, wrong-owner or unwritable results are rejected", async () => {
  const reused = fakeSetup({ existing: [validFolder] }); assert.equal(await prepareAuthorizedDriveFolder(reused.transport, [DRIVE_FILE_SCOPE]), folderId);
  assert.ok(reused.calls.every(call => call.method === "GET"));
  for (const options of [{ existing: [validFolder, validFolder] }, { nextPage: "more" }, { created: { trashed: true } }, { verified: { ownedByMe: false } }, { verified: { capabilities: { canAddChildren: false } } }]) {
    await assert.rejects(prepareAuthorizedDriveFolder(fakeSetup(options).transport, [DRIVE_FILE_SCOPE]));
  }
});

let fixture: string;
before(async () => { fixture = await mkdtemp(path.join(tmpdir(), "breadloaf-oauth-test-")); });
after(async () => {
  if (path.dirname(path.resolve(fixture)) !== path.resolve(tmpdir()) || !path.basename(fixture).startsWith("breadloaf-oauth-test-")) throw new Error("Unsafe cleanup");
  await rm(fixture, { recursive: true, force: true });
});
test("credential persistence creates a protected dedicated directory, refuses reuse and never writes within the workspace", async () => {
  const outputPath = path.join(fixture, "private-credentials", "credentials.json");
  const output = await preparePrivateOAuthOutput(outputPath);
  const receipt: DriveAuthorizationReceipt = { version: 1, account: BACKUP_DRIVE_ACCOUNT, scope: DRIVE_FILE_SCOPE, authorizedAt: new Date().toISOString(),
    clientId: "synthetic-client", clientSecret: "synthetic-client-secret", refreshToken: "synthetic-refresh-token", folderId, folderName: BACKUP_FOLDER_NAME };
  await output.save(receipt); assert.deepEqual(JSON.parse(await readFile(output.path, "utf8")), receipt);
  await assert.rejects(preparePrivateOAuthOutput(outputPath)); await assert.rejects(output.save(receipt));
  await assert.rejects(preparePrivateOAuthOutput(path.join(process.cwd(), "synthetic-oauth-do-not-create", "credentials.json")), /outside/);
  if (process.platform !== "win32") { assert.equal((await stat(path.dirname(output.path))).mode & 0o777, 0o700); assert.equal((await stat(output.path)).mode & 0o777, 0o600); }
  await output.removeIfEmpty(); assert.ok(await stat(output.path));
  const cancelledPath = path.join(fixture, "cancelled-private", "credentials.json"), cancelled = await preparePrivateOAuthOutput(cancelledPath);
  await cancelled.removeIfEmpty(); await assert.rejects(stat(path.dirname(cancelledPath)));
});
