import "dotenv/config";
import { Auth, google } from "googleapis";
import { option } from "./archive-common";
import { BACKUP_DRIVE_ACCOUNT, DRIVE_FILE_SCOPE, type DriveTransport } from "./archive-drive-common";
import { BACKUP_FOLDER_NAME, createDriveLoopbackCallback, prepareAuthorizedDriveFolder, preparePrivateOAuthOutput } from "./archive-drive-authorize-common";

async function main() {
  const clientId = process.env.ARCHIVE_DRIVE_CLIENT_ID, clientSecret = process.env.ARCHIVE_DRIVE_CLIENT_SECRET;
  const outputPath = option("--output");
  if (!clientId || !clientSecret || !outputPath) throw new Error("Configure your own Desktop OAuth client ID/secret privately and provide --output <new-private-directory/credentials.json>.");
  const output = await preparePrivateOAuthOutput(outputPath);
  let callback: Awaited<ReturnType<typeof createDriveLoopbackCallback>> | undefined;
  try {
    callback = await createDriveLoopbackCallback();
    const oauth = new google.auth.OAuth2({ clientId, clientSecret, redirectUri: callback.redirectUri, transporterOptions: { timeout: 30000 } });
    const pkce = await oauth.generateCodeVerifierAsync();
    const url = oauth.generateAuthUrl({ access_type: "offline", scope: [DRIVE_FILE_SCOPE], state: callback.state, prompt: "consent", login_hint: BACKUP_DRIVE_ACCOUNT,
      include_granted_scopes: false, code_challenge: pkce.codeChallenge, code_challenge_method: Auth.CodeChallengeMethod.S256 });
    console.log("Open this consent URL in the browser signed in to the property account. The script does not open a browser:");
    console.log(url);
    const code = await callback.code;
    let refreshToken: string, scopes: string[];
    try {
      const result = await oauth.getToken({ code, codeVerifier: pkce.codeVerifier, redirect_uri: callback.redirectUri });
      if (!result.tokens.access_token || !result.tokens.refresh_token) throw new Error("Missing offline credentials");
      oauth.setCredentials(result.tokens); refreshToken = result.tokens.refresh_token;
      scopes = (await oauth.getTokenInfo(result.tokens.access_token)).scopes;
    } catch { throw new Error("Google did not provide valid offline user authorization. Retry the consent flow; no credentials were saved."); }
    const transport: DriveTransport = { async request(destination, method, headers = {}, body) {
      try {
        const token = await oauth.getAccessToken(); if (!token.token) throw new Error("Missing authorization");
        return await fetch(destination, { method, headers: { ...headers, Authorization: `Bearer ${token.token}` }, body: body as BodyInit | undefined,
          redirect: "error", signal: AbortSignal.timeout(30000) });
      } catch { throw new Error("The authenticated Drive setup request failed. No credentials were saved."); }
    } };
    const folderId = await prepareAuthorizedDriveFolder(transport, scopes);
    await output.save({ version: 1, account: BACKUP_DRIVE_ACCOUNT, scope: DRIVE_FILE_SCOPE, authorizedAt: new Date().toISOString(),
      clientId, clientSecret, refreshToken, folderId, folderName: BACKUP_FOLDER_NAME });
    console.log("Property account and dedicated backup folder verified. Authorization saved only to the protected output file. No snapshot was uploaded and no backup status was changed.");
  } finally { await callback?.close(); await output.removeIfEmpty(); }
}

void main().catch(error => { console.error(error instanceof Error ? error.message : "Local Drive authorization failed."); process.exitCode = 1; });
