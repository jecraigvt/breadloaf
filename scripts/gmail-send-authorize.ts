import "dotenv/config";
import { randomBytes } from "node:crypto";
import { Auth, google } from "googleapis";
import { option } from "./archive-common";
import { createDriveLoopbackCallback, preparePrivateOAuthOutput } from "./archive-drive-authorize-common";
import { GMAIL_SEND_ACCOUNT, GMAIL_SEND_IDENTITY_SCOPES, validateGmailSendAuthorization, type GmailSendAuthorizationReceipt, type VerifiedMailIdentity } from "./gmail-send-authorize-common";

async function main() {
  const clientId = process.env.GMAIL_SEND_CLIENT_ID, clientSecret = process.env.GMAIL_SEND_CLIENT_SECRET;
  const outputPath = option("--output");
  if (!clientId || !clientSecret || !outputPath) throw new Error("Configure the separate mail Desktop OAuth client privately and provide --output <new-private-directory/credentials.json>.");
  if (clientId === process.env.ARCHIVE_DRIVE_CLIENT_ID) throw new Error("Mail authorization must use its own Desktop client, separate from Drive backups.");
  const output = await preparePrivateOAuthOutput<GmailSendAuthorizationReceipt>(outputPath);
  let callback: Awaited<ReturnType<typeof createDriveLoopbackCallback>> | undefined;
  try {
    callback = await createDriveLoopbackCallback();
    const nonce = randomBytes(32).toString("base64url");
    const oauth = new google.auth.OAuth2({ clientId, clientSecret, redirectUri: callback.redirectUri, transporterOptions: { timeout: 30000 } });
    const pkce = await oauth.generateCodeVerifierAsync();
    const url = oauth.generateAuthUrl({ access_type: "offline", scope: [...GMAIL_SEND_IDENTITY_SCOPES], state: callback.state, nonce,
      prompt: "consent", login_hint: GMAIL_SEND_ACCOUNT, include_granted_scopes: false,
      code_challenge: pkce.codeChallenge, code_challenge_method: Auth.CodeChallengeMethod.S256 });
    console.log("Open this consent URL in the browser signed in to the property mailbox. The script does not open a browser:");
    console.log(url);
    const code = await callback.code;
    let refreshToken: string, scopes: string[], identity: VerifiedMailIdentity;
    try {
      const result = await oauth.getToken({ code, codeVerifier: pkce.codeVerifier, redirect_uri: callback.redirectUri });
      if (!result.tokens.access_token || !result.tokens.refresh_token || !result.tokens.id_token) throw new Error("Missing offline identity authorization");
      oauth.setCredentials(result.tokens);
      refreshToken = result.tokens.refresh_token;
      const ticket = await oauth.verifyIdToken({ idToken: result.tokens.id_token, audience: clientId });
      const payload = ticket.getPayload();
      if (!payload) throw new Error("Missing verified identity");
      identity = payload as VerifiedMailIdentity;
      scopes = (await oauth.getTokenInfo(result.tokens.access_token)).scopes;
    } catch { throw new Error("Google did not provide valid offline mail authorization and verified identity. Retry consent; no mail credentials were saved."); }
    const authorized = validateGmailSendAuthorization({ scopes, refreshToken, identity, nonce });
    await output.save({ version: 1, ...authorized, clientId, clientSecret, refreshToken, authorizedAt: new Date().toISOString() });
    console.log("Property mailbox and send-only Gmail permission verified. Mail authorization saved only to the protected output file. No email was sent and Drive authorization was unchanged.");
  } finally { await callback?.close(); await output.removeIfEmpty(); }
}

void main().catch(error => { console.error(error instanceof Error ? error.message : "Local mail authorization failed."); process.exitCode = 1; });
