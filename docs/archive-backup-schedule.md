# Weekly encrypted archive backups

The weekly lane snapshots the running app's own PostgreSQL database and mounted
`/app/public/uploads`, then uploads only the encrypted bundle to the fixed property
Drive folder. An independent download must match the entire encrypted SHA256
before the durable state becomes `verified`. The receipt still says
`restoreVerified: false`; no document `backupStatus` is updated.

The [Drive runbook](archive-drive.md) describes account authorization and the
[recovery runbook](archive-recovery.md) describes full restoration. Keep the
encryption passphrase in a separate recoverable location.

## Runtime and activation

The Dockerfile uses official `node:22.23.3-trixie-slim` and
`postgres:18.6-trixie` images, retaining PostgreSQL's complete native library set.
It runs the Node application; it does not start a PostgreSQL server. `npm start`
retains migration and seed behavior. `PORT` defaults to 3000 and Railway's explicit
runtime `PORT` wins. Confirm the application listener when deploying because the
PostgreSQL base also carries port metadata. The runtime sets absolute
`PG_DUMP_PATH`/`PG_RESTORE_PATH` and checks their versions plus native Prisma/canvas
loads during image construction. CI builds and checks the same image. Local
Windows source tests do not prove this Linux image has built successfully.

Railpack documents runtime Apt additions, but a generic distro PostgreSQL client
does not guarantee major 18; the official PostgreSQL 18 runtime is explicit and
avoids copying a client without all its dependent libraries. Sources:
[Railpack deploy configuration](https://railpack.com/config/file/#deploy),
[official PostgreSQL image](https://hub.docker.com/_/postgres),
[official Node image](https://hub.docker.com/_/node).

Before activation, configure the user OAuth values and fixed folder from the Drive
runbook, `ARCHIVE_BACKUP_PASSPHRASE`, and an independently generated
`ARCHIVE_BACKUP_TOKEN` of at least 43 URL-safe characters. The token must differ
from family authentication, worker and housekeeping credentials. Store the same
token in the GitHub secret and Railway variable; do not put it in commands/logs.

Set Railway `ARCHIVE_BACKUP_ENABLED=true` only after OAuth is ready. For the first
manual workflow run, temporarily enable the GitHub repository variable
`ARCHIVE_BACKUP_ENABLED=true`. Keep that weekly gate enabled only after the run
has produced a verified independent copy and an operator has completed the full
restore drill; turn it off again while recovery evidence is incomplete. Both
gates default to off when absent. The workflow schedules
Sunday 10:00 UTC and may also be started manually once gated on. It receives only
the scoped backup token, not database, Drive or encryption credentials.

## Lease and honest status

`POST /api/archive/backup` accepts only the separate bearer token. Family cookies
and worker/maintenance tokens do not grant this endpoint. The handler ignores
caller-selected paths and options, claims one global `ArchiveBackupState` row,
starts a local bounded Node runner, and promptly returns 202. `GET` on the same
endpoint requires the same token and returns scrubbed status; the scheduler polls
it without holding one long HTTP connection.

The runner renews a three-minute lease every 30 seconds. Concurrent requests receive
the existing status. Successful copies less than six days old suppress duplicate
runs. Expired leases can be replaced; lease tokens fence old success/failure writes.
Lost renewal cancels snapshot processing and stops Drive requests at their next
bounded request boundary. Native dumps have a 30-minute limit, Drive work is bounded
by its upload helper, and the runner has a 55-minute cancellation deadline.

A hard process/container stop leaves an expired lease that status reports as
`interrupted`, never `verified`. Later failure preserves the previous verified
receipt and success time. No secrets, filenames or provider error bodies enter
the durable error field or scheduler output. An interrupted upload may leave a
partial/unrecorded encrypted Drive file; inspect Drive before cleanup. No retention
deletion or automated production restoration runs.
