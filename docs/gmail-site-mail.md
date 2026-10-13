# Property site mail

Sign-in links, caretaker access requests, and Bucky notifications use one shared
Gmail HTTPS sender from `breadloafhillsite@gmail.com`. Railway Hobby blocks outbound
SMTP; changing an app password cannot fix that network restriction. See
[Railway's email-delivery policy](https://docs.railway.com/networking/outbound-networking).
The runtime sends through Google's
[messages.send endpoint](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages/send).

Mail Room intake remains independent. `GMAIL_APP_PASSWORD` authenticates IMAP
polling and must be retained when replacing outbound SMTP. Gmail sending OAuth
does not grant mailbox-reading permission and does not replace that credential.
Drive backups and Calendar also retain their own separate credentials.

## Authorization and configuration

Use [mail authorization](gmail-send-authorization.md) to obtain a protected receipt
from a separate Desktop OAuth client. The only Gmail scope is `gmail.send`;
`openid` and `email` identify the authorizing account. The bootstrap verifies a
Google-signed ID token and the exact property account. At runtime the sender checks
the refreshed token's scopes and verified account again before sending. Reading,
editing, deleting mail, and accessing Drive are excluded. See
[Google's scope definitions](https://developers.google.com/workspace/gmail/api/auth/scopes).

Publish all three credentials together. A partial configuration fails closed and
does not fall back to SMTP on Railway. Read the protected receipt locally and pipe
each value to Railway's stdin setter so secrets do not appear in command arguments
or shell history. These commands print only the changed variable names; do not list
or echo credential values. Check the linked Railway project, environment, and
service before running them.

```powershell
$mailReceiptPath = Join-Path $env:USERPROFILE '.codex\breadloaf-mail-authorized\credentials.json'
$mailReceipt = Get-Content -Raw -LiteralPath $mailReceiptPath | ConvertFrom-Json
$mailReceipt.clientId | railway variable set GMAIL_SEND_CLIENT_ID --stdin --service breadloaf-app --skip-deploys
$mailReceipt.clientSecret | railway variable set GMAIL_SEND_CLIENT_SECRET --stdin --service breadloaf-app --skip-deploys
$mailReceipt.refreshToken | railway variable set GMAIL_SEND_REFRESH_TOKEN --stdin --service breadloaf-app --skip-deploys
railway variable set GMAIL_SEND_DAILY_BUDGET=100 --service breadloaf-app --skip-deploys
Remove-Variable mailReceipt
```

Apply the configuration with the planned production deployment after all values
are staged. Keep `FAMILY_EMAIL_TEST_SMTP_PORT` unset in production. Railway's
[variable CLI reference](https://docs.railway.com/cli/variable) documents stdin
and `--skip-deploys`. Never commit the client JSON, receipt, tokens, or a populated
environment file. Avoid secret-bearing screenshots and logs.

## Sending limit and failures

`GMAIL_SEND_DAILY_BUDGET` is an integer from 1 to 100 and defaults to 100. PostgreSQL
enforces this shared limit across app instances and all property outbound mail.
Each live send reserves one slot before contacting the provider. Authentication,
network, and provider failures still consume that slot. A rejected reservation
makes no provider request. The fixed 24-hour window begins with its first
reservation; it does not reset at local midnight. Local fake SMTP is excluded.

This is a site safeguard rather than a promise of Gmail capacity. Other mailbox
sending also uses Google's quota, and Google can apply lower limits or temporary
blocks. See [Gmail's sending limits](https://support.google.com/mail/answer/22839).

The runtime makes one send attempt and does not automatically retry an uncertain
HTTP result, because Gmail may have accepted the message before the connection
failed. Provider error bodies and credentials are kept out of API responses and
logs. Sign-in delivery errors return 503 and invalidate the newly issued link;
budget exhaustion returns 429. Family approval and remembered devices are
unaffected by a mail outage. Bucky's underlying saved work survives notification
failure.

## Verification and recovery

Successful OAuth authorization proves account permission, not delivered mail.
After the HTTPS code and configuration are deployed, request one explicitly
authorized sign-in email. Verify receipt, confirm **Open Breadloaf Hill**, and check
remembered navigation. Separately verify caretaker and Bucky notification behavior
when needed. Automated tests use mocked Google responses or a loopback fake SMTP
sink with a disposable local PostgreSQL database; they do not send real mail.

Keep the OAuth app **In production** for unattended operation. An External app in
Testing with Gmail scopes receives seven-day refresh tokens. Production removes
that Testing timer, but revocation, mailbox password changes, long token inactivity,
or other Google conditions can still invalidate the grant. See
[Google's refresh-token lifecycle](https://developers.google.com/identity/protocols/oauth2#expiration).

If the grant no longer works, check service configuration and the attempt budget
without printing secrets. For a revoked or invalid refresh token, rerun the mail
authorization bootstrap with the same separate mail client and a new protected
output directory, approve only send and identity permissions for the property
account, then publish the replacement receipt through stdin. Verify one authorized
delivery after deployment. Leave the Drive backup client, grant, and runtime
variables unchanged. If the mailbox password was changed, also check the separate
IMAP app password for Mail Room recovery.
