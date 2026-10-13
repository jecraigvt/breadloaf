import assert from "node:assert/strict";
import test from "node:test";
import { randomBytes } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Auth, google } from "googleapis";
import { GMAIL_SEND_ACCOUNT, GMAIL_SEND_SCOPE, GMAIL_SEND_IDENTITY_SCOPES, validateGmailSendAuthorization, type GmailSendAuthorizationReceipt } from "../../scripts/gmail-send-authorize-common";
import { preparePrivateOAuthOutput } from "../../scripts/archive-drive-authorize-common";

const nonce = randomBytes(32).toString("base64url");
const grant = { scopes: [GMAIL_SEND_SCOPE, "openid", "https://www.googleapis.com/auth/userinfo.email"], refreshToken: "synthetic-refresh-token-for-local-tests",
  identity: { email: GMAIL_SEND_ACCOUNT, email_verified: true, sub: "synthetic-property-subject", nonce }, nonce };
test("the separate consent URL requests only Gmail sending and identity proof with offline PKCE", async () => {
  const oauth = new google.auth.OAuth2({ clientId: "synthetic-mail-client", clientSecret: "synthetic-mail-secret", redirectUri: "http://127.0.0.1:23456/oauth2/callback" });
  const pkce = await oauth.generateCodeVerifierAsync();
  const url = new URL(oauth.generateAuthUrl({ scope: [...GMAIL_SEND_IDENTITY_SCOPES], access_type: "offline", prompt: "consent", include_granted_scopes: false,
    state: nonce, nonce, code_challenge: pkce.codeChallenge, code_challenge_method: Auth.CodeChallengeMethod.S256 }));
  assert.deepEqual(url.searchParams.get("scope")?.split(" "), [...GMAIL_SEND_IDENTITY_SCOPES]);
  assert.equal(url.searchParams.get("access_type"), "offline"); assert.equal(url.searchParams.get("include_granted_scopes"), "false");
  assert.equal(url.searchParams.get("code_challenge_method"), "S256"); assert.equal(url.searchParams.get("nonce"), nonce);
  assert.equal(url.href.includes("synthetic-mail-secret"), false); assert.equal(url.href.includes(pkce.codeVerifier), false);
});
test("only the verified property account and exact send/identity scopes authorize persistence", () => {
  assert.equal(validateGmailSendAuthorization(grant).account, GMAIL_SEND_ACCOUNT);
  assert.equal(validateGmailSendAuthorization({ ...grant, scopes: [...GMAIL_SEND_IDENTITY_SCOPES] }).account, GMAIL_SEND_ACCOUNT);
  for (const identity of [{ ...grant.identity, email: "other@example.test" }, { ...grant.identity, email_verified: false }, { ...grant.identity, sub: "" }, { ...grant.identity, nonce: "é".repeat(43) }, { ...grant.identity, nonce: randomBytes(32).toString("base64url") }]) {
    assert.throws(() => validateGmailSendAuthorization({ ...grant, identity }));
  }
  for (const scope of ["https://www.googleapis.com/auth/gmail.readonly", "https://www.googleapis.com/auth/gmail.modify", "https://mail.google.com/", "https://www.googleapis.com/auth/drive.file", "profile"]) {
    assert.throws(() => validateGmailSendAuthorization({ ...grant, scopes: [...grant.scopes, scope] }));
  }
  assert.throws(() => validateGmailSendAuthorization({ ...grant, scopes: [GMAIL_SEND_SCOPE] }));
  assert.throws(() => validateGmailSendAuthorization({ ...grant, refreshToken: "" }));
});
test("mail authorization writes only its separate protected receipt and refuses overwrite", async () => {
  const fixture = await mkdtemp(path.join(tmpdir(), "breadloaf-mail-auth-test-"));
  try {
    const output = await preparePrivateOAuthOutput<GmailSendAuthorizationReceipt>(path.join(fixture, "mail-only", "credentials.json"));
    const receipt: GmailSendAuthorizationReceipt = { version: 1, ...validateGmailSendAuthorization(grant), clientId: "synthetic-mail-client", clientSecret: "synthetic-mail-secret", refreshToken: grant.refreshToken, authorizedAt: new Date().toISOString() };
    await output.save(receipt); assert.deepEqual(JSON.parse(await readFile(output.path, "utf8")), receipt); await assert.rejects(output.save(receipt));
    assert.equal("folderId" in receipt, false); assert.equal("driveFileId" in receipt, false);
  } finally {
    if (path.dirname(path.resolve(fixture)) !== path.resolve(tmpdir()) || !path.basename(fixture).startsWith("breadloaf-mail-auth-test-")) throw new Error("Unsafe test cleanup");
    await rm(fixture, { recursive: true, force: true });
  }
});
