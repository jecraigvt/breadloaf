# Encrypted Google Drive recovery copies

The selected independent destination is the personal Google Drive owned by
`breadloafhillsite@gmail.com`. An encrypted file in that Drive is independent of
Railway's upload volume. Upload code being present does not mean a backup has run,
and successful byte verification does not prove PostgreSQL can be restored.
Until a real independent copy and a successful restore drill are verified, keep
the site's document `backupStatus` as **Local copy only**.

## Authorize the backup account

Use a **user OAuth client** and the `https://www.googleapis.com/auth/drive.file`
scope. The existing Calendar service account must not own personal Drive backup
files: Google documents that service accounts have no personal storage quota.
See [Google's service-account storage guidance](https://developers.google.com/workspace/drive/api/guides/handle-errors#storagequotaexceeded).

The OAuth client, consent configuration, and account sign-in are operator setup.
Neither the upload script nor its tests creates Google Cloud credentials. Obtain
offline user authorization as the backup account, then store the client ID,
client secret, and refresh token in the deployment secret manager. Never put
them in commands, source control, screenshots, or logs. The helper checks the
granted Drive scope and rejects broad Drive scopes.

Choose one private backup folder owned by the same account. With `drive.file`,
the app must create that folder or the user must explicitly select it for the
app through Google Picker; copying the ID of an arbitrary pre-existing folder
does not grant access. Fix its ID in `ARCHIVE_DRIVE_FOLDER_ID`. See
[Google's per-file authorization guidance](https://developers.google.com/workspace/drive/api/guides/api-specific-auth).
The uploader does not create folders, change sharing, overwrite existing files,
or delete older backups.

For unattended use, check OAuth publishing status before activation. External
apps left in **Testing** receive refresh tokens that expire after seven days
when requesting Drive access. A testing authorization is therefore insufficient
for a reliable ongoing schedule. See [Google's refresh-token expiration rules](https://developers.google.com/identity/protocols/oauth2#expiration).

Configure these values privately:

- `ARCHIVE_DRIVE_CLIENT_ID`, `ARCHIVE_DRIVE_CLIENT_SECRET`,
  `ARCHIVE_DRIVE_REFRESH_TOKEN`: the approved user's OAuth credentials.
- `ARCHIVE_DRIVE_FOLDER_ID`: the fixed app-accessible backup folder.
- `ARCHIVE_BACKUP_PASSPHRASE`: the same strong secret used when creating the
  encrypted snapshot. Keep a separate recovery copy outside Railway and Drive.

### Local consent bootstrap

After the operator configures a **Desktop app** OAuth client and appropriate
production consent state, set its client ID and secret privately in the local
process. The bootstrap uses only those own-client credentials; it creates no
Google Cloud project or OAuth client and changes no billing or terms settings.

```powershell
npx tsx scripts/archive-drive-authorize.ts --output "C:\Users\Jeremy\Breadloaf-private-oauth\credentials.json"
```

The output directory must be new, its parent must already exist, and it must lie
outside the repository. The script creates a directory readable only by the
current user (and Windows SYSTEM), then refuses to overwrite an existing receipt.
Choose a new dedicated directory for a later authorization. A cancelled flow
removes its empty output directory; it never deletes a saved credentials file.

The script prints an authorization URL without opening a browser. Open it in the
browser signed in as `breadloafhillsite@gmail.com`. The local listener binds only
to `127.0.0.1` on a random port, checks a random state, accepts one response, and
expires after ten minutes. Authorization uses PKCE with SHA256, requests offline
access with explicit consent, and requests exactly the Drive per-file scope.
Neither the callback page nor script output prints the authorization code,
access token, refresh token, or client secret. See
[Google's installed-app loopback and PKCE flow](https://developers.google.com/identity/protocols/oauth2/native-app).

Before creating anything in Drive, the script verifies the granted scope and
property account using Drive `about.user.emailAddress`. It searches for a unique
app-accessible `Breadloaf Hill Backups` folder, validates an existing match or
creates it with this same client, then reads it again to verify ownership, folder
type, trash state, and write permission. Ambiguous matches fail rather than
choosing or deleting a folder. No snapshots are uploaded during consent setup.

The protected JSON file contains the client ID/secret, refresh token, and folder
receipt. Transfer those values to the deployment secret manager without printing
them. Keep the private file for authorized recovery or remove that exact file
after confirming the deployment and recovery secret copies. Successful consent
alone is not evidence of an independent backup, a restore drill, or an active
backup schedule.

## Create and verify a Drive copy

First follow [Archive recovery](archive-recovery.md) to make a coherent encrypted
snapshot from the actual database and mounted originals. Include private Mail
Room RFC822 originals in the snapshot; a dump or laptop upload directory alone
is incomplete. The upload helper uses the existing bounded `BLHBACK1` encrypted
format and supports the same 512 MB tooling limit.

```sh
npx tsx scripts/archive-drive.ts --input /mnt/independent/breadloaf-2026-10-13.blhbackup --receipt /mnt/independent/breadloaf-2026-10-13.drive-receipt.json
```

No plaintext snapshot entries are uploaded. The helper first copies the encrypted
bundle to a protected temporary directory, authenticates its encryption, and
checks every manifest entry's size and SHA256. Only then does it contact Drive.
It checks the authorized account, available storage, and the configured folder's
ownership, type, trash state, and write permission before creating any cloud file.

Uploads use Google's resumable protocol in 4 MiB chunks. After an interruption,
the helper queries the session's acknowledged byte range before continuing;
it does not assume that a lost response means a lost chunk. A resumable session
expires after a week and this helper keeps session state only during the current
bounded run. If a process dies before writing a receipt, inspect Drive before
rerunning: an uploaded or incomplete copy may remain. No automatic cleanup or
retention pruning runs. See [Google's resumable upload protocol](https://developers.google.com/workspace/drive/api/guides/manage-uploads#resumable).

Success requires the returned file to remain in the configured folder, owned by
the backup account, with the exact encrypted size and Drive MD5 checksum. The
helper also compares Drive's SHA256 if returned, then independently streams a
download and checks its exact byte count and SHA256 against the authenticated
local bundle. Metadata success alone is not accepted. See
[Google's file checksum fields](https://developers.google.com/workspace/drive/api/reference/rest/v3/files).

The private receipt contains the Drive file/folder IDs, encrypted checksum, size,
snapshot date, and verification time. It contains no original filenames or
contents. `restoreVerified` deliberately remains `false`. If that receipt already
exists, the command rechecks its existing Drive file and downloads its bytes again
instead of replacing it or uploading another file. Do not overwrite a receipt
for a different snapshot. A quota, authorization, folder, upload, or verification
failure exits unsuccessfully and changes no document backup status.

## Activation and recovery evidence

Download the verified encrypted copy from the backup account on a recovery
machine separate from Railway. Run the full restore drill described in
[Archive recovery](archive-recovery.md) into an explicitly disposable PostgreSQL
database with the required extensions, including pgvector. Confirm database
records, retained original bytes, Mail Room sources, and searchable memory before
reporting recovery readiness.

Only after that evidence exists should an operator activate the backup schedule
and its truthful health reporting. Each scheduled run must create a fresh coherent
snapshot and produce a new byte-verified Drive receipt. Preserve the last verified
success time when a later run fails, and show that failure as a failure. A scheduler
configuration, credentials, or a local-only snapshot is not a completed backup.
This uploader intentionally makes no `backupStatus` database writes.
