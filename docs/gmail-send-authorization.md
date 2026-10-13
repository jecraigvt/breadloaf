# Property mail through Gmail HTTPS

The property mailbox uses a separate Desktop user OAuth client for HTTPS mail
delivery. Railway Hobby disables outbound SMTP, so the site sends sign-in,
caretaker, and Bucky mail through the Gmail API. See
[Railway's outbound networking policy](https://docs.railway.com/networking/outbound-networking)
and [site mail operation](gmail-site-mail.md). Its only Gmail permission is
`https://www.googleapis.com/auth/gmail.send`.
The additional `openid` and `email` scopes prove which account authorized sending;
they grant no mailbox reading, editing, or deletion. See
[Google's Gmail scopes](https://developers.google.com/workspace/gmail/api/auth/scopes).

Configure the operator-created mail client ID and secret privately in the local
process as `GMAIL_SEND_CLIENT_ID` and `GMAIL_SEND_CLIENT_SECRET`. Keep this client
separate from the Drive backup client. Before unattended activation, the operator
must verify appropriate Production OAuth consent state rather than an expiring
External Testing grant. Because this grant includes Gmail access, an External app
in Testing receives a refresh token that expires after seven days. **In production**
avoids that Testing expiry; it does not make the token permanent. Revoking access,
changing the mailbox password, or other Google token-expiration conditions can
require another grant. See
[Google's refresh-token lifecycle](https://developers.google.com/identity/protocols/oauth2#expiration).

Enable the Gmail API for the mail client's project. Use the separate mail Desktop
client, not the Drive backup client or Calendar service account. Load its downloaded
JSON privately without pasting client secrets into command arguments or history:

```powershell
$mailClient = Get-Content -Raw -LiteralPath "$env:USERPROFILE\.codex\breadloaf-mail-client\client.json" | ConvertFrom-Json
$env:GMAIL_SEND_CLIENT_ID = $mailClient.installed.client_id
$env:GMAIL_SEND_CLIENT_SECRET = $mailClient.installed.client_secret
```

```powershell
npx tsx scripts/gmail-send-authorize.ts --output "$env:USERPROFILE\.codex\breadloaf-mail-authorized\credentials.json"
```

The output directory must be new and its parent must already exist. Store the
downloaded Desktop client configuration in a different private directory so the
authorization script can safely create this dedicated output directory.

The script prints a consent URL without opening a browser. Open it in the browser
signed in as `breadloafhillsite@gmail.com`. It uses a random loopback callback,
state, PKCE SHA256 challenge, and OpenID nonce. The code exchange requires a refresh
token and a Google-signed ID token whose audience is this new client. The script
then verifies the exact property account, verified email, matching nonce, and
the exact send/identity scope set before saving anything. See
[Google's ID-token verification guidance](https://developers.google.com/identity/openid-connect/openid-connect).

The receipt contains this separate client ID/secret, refresh token, verified account,
and granted scopes. Windows permissions restrict its directory to the current user
and SYSTEM; Unix permissions are 0700/0600. Existing receipts are never overwritten.
No secret or authorization code is printed, no Drive operation occurs, and no email
is sent by this bootstrap.

An extension may block the callback page after the code reaches the local listener.
Use the script's completion result and protected receipt as evidence of completed
authorization; do not infer failure or rerun solely from the browser error. For
recovery, use a new private output directory because receipts are immutable.

Transfer the receipt values to the deployment secret manager as:

- `GMAIL_SEND_CLIENT_ID`
- `GMAIL_SEND_CLIENT_SECRET`
- `GMAIL_SEND_REFRESH_TOKEN`

The property sender remains fixed. Successful authorization alone does not prove
delivery; separately verify one explicitly authorized sign-in email through the
deployed HTTPS transport before reporting mail as operational. Keep the existing
Drive grant unchanged and retain its independent backup configuration.

Publish the receipt through the secret-safe stdin method in
[site mail operation](gmail-site-mail.md). The runtime also accepts
`GMAIL_SEND_DAILY_BUDGET` (integer 1–100, default 100); it is not an OAuth credential.
