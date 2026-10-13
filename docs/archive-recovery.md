# Archive recovery

The archive needs a recoverable PostgreSQL database **and** its retained original
files. A database-only backup cannot recover a recording or document stored on
the upload volume. Soft deletion and checksums do not protect against losing that
volume.

The snapshot and restore tools create encrypted recovery files and verify drills.
The separate [Drive uploader](archive-drive.md) verifies an encrypted independent
copy. [Weekly backups](archive-backup-schedule.md) are separately gated and need
operator activation. These tools do not change any document's `backupStatus`. Until an independent
destination and successful recovery drill are in operation, “Local copy only”
remains the honest status.

## Create a snapshot

Run `npm run archive:backup` on a machine that can read both the database and the
mounted originals. Running locally with production database credentials while
pointing at a laptop's unrelated `public/uploads` directory is not a backup.

Provide these environment settings through a private environment file, secret
manager, or secure input mechanism. Do not put a passphrase or database URL in a
shell command, chat, repository file, or log.

- `DATABASE_URL`: the source PostgreSQL database.
- `ARCHIVE_BACKUP_PASSPHRASE`: a strong, unique passphrase, at least 20 characters.
  A generated secret stored in a password manager is preferable. Keep a separate
  recovery copy; losing it makes encrypted snapshots unrecoverable.
- `PG_DUMP_PATH`: native `pg_dump` executable if it is not on PATH. Its major
  version must support the source database. Use the same compatible tool version
  for restore drills.

```sh
npm run archive:backup -- --originals /app/public/uploads --output /mnt/independent/breadloaf-2026-10-13.blhbackup
```

The destination must be outside the application and originals directories. This
path check cannot prove that storage is off-device or independent of Railway.
Choose a separate failure domain and verify access from another machine before
calling it an off-site backup. An encrypted snapshot in the same container or on
the same failing disk is not adequate protection.

The tool opens a read-only repeatable-read transaction and exports its PostgreSQL
snapshot to `pg_dump`. Database references and the dump therefore describe the
same database state. It retains every ordinary file in the upload directory,
including deleted-document originals and files retained before an AI failure.
Retained Mail Room source emails are included and checked against their stored
source checksums, including messages waiting for review or retry.
Missing referenced originals, unsafe paths, symlinks, or mismatched stored
checksums fail the snapshot explicitly. It never backfills or changes database
checksums.

The complete bundle—including database, filenames, and integrity manifest—is
encrypted with AES-256-GCM and a scrypt-derived key. A successful creation includes
authenticated decryption and a checksum verification of every bundled file.
Plaintext staging uses restricted directory permissions and is removed on normal
completion or error. A forced process kill can leave a protected staging directory
named `breadloaf-archive-*` in the operating-system temporary directory; inspect
and remove that exact directory after confirming no backup process owns it.

The initial tools support at most 512 MB of combined dump/original bytes and
10,000 originals. They fail rather than truncate a larger archive. A larger
archive should move to a streaming backup service and a separate restore test.
Verification decrypts the bounded ZIP bundle in memory, so run it on a recovery
machine with adequate memory (allow roughly three times the snapshot size plus
the largest original). The format limit is not a claim that a 512 MB Railway
container can verify a 512 MB archive while serving the website.

## Verify and rehearse recovery

Verification is read-only and is the default:

```sh
npm run archive:restore -- --input /mnt/independent/breadloaf-2026-10-13.blhbackup
```

Supply the same `ARCHIVE_BACKUP_PASSPHRASE`. Wrong passphrases, tampering, missing
manifest entries, unsafe paths, and file-size or checksum mismatches fail before
any database or destination-file changes. A dry run verifies the bundle, not the
application or PostgreSQL restoration.

For a real drill, create a new **empty** disposable database on loopback with
`test` in its name. Supply its connection as `ARCHIVE_RESTORE_DATABASE_URL` and
the compatible native `PG_RESTORE_PATH`. Create or choose a new empty absolute
originals directory. The tool refuses existing database tables and nonempty
originals directories; it never drops tables or overwrites original files.

```sh
npm run archive:restore -- --input /mnt/independent/breadloaf-2026-10-13.blhbackup --apply --target-originals /tmp/breadloaf-restore-test/uploads
```

`pg_restore` runs in one transaction. Restoring the original files is a separate
filesystem operation; if that operation fails after PostgreSQL commits, the
drill is incomplete. Start again with fresh empty disposable targets rather than
overwriting or resetting an existing database.

After a drill, compare source and restored record counts and original-file
checksums. Run the application at the backed-up code revision with the restored
database and upload directory, production integrations disabled, and test-only
authentication. Verify an actual document download and recording playback, then
exercise archive search, visits, and checklist history. A snapshot is a usable
backup only after that recovery succeeds.

Configure the empty restore database's connection timezone to UTC before the
drill, and reconnect after changing that default. The tool checks it before
restoring. Prisma stores the application's calendar and queue timestamps in UTC;
a local PostgreSQL server using a machine timezone can shift raw SQL comparisons
even when the stored values look correct. The embedded Windows test server needed
this adjustment; the CI PostgreSQL service uses UTC.

Encrypted corporation credentials also require the corporation's separate vault
passphrase. Deployment configuration and provider credentials are not included
in the database/files snapshot; keep their recovery instructions separately.

## Migration history and production recovery

Historical migration ordering cannot bootstrap a fresh empty database: one early
migration alters `Stay` before its creation. CI uses `prisma db push` only on
disposable databases, with focused tests checking actual SQL constraints. Do not
use `db push`, `migrate reset`, or invented migration-history edits to repair a
production database.

Restoring a complete PostgreSQL snapshot retains `_prisma_migrations` when it was
present in the source database. Restore and verify against the matching code
revision first. Review and apply only pending additive migrations through the
normal deployment path afterward.

These scripts deliberately apply only to loopback test databases. Production
recovery is a separate coordinated operation after a successful drill: preserve
the damaged state, select the verified snapshot, restore database and originals
from the same snapshot, confirm schema/application compatibility, and revoke
restored website sessions and worker credentials before reopening access. The
first operational milestone is a verified independent backup plus a successful
restore drill—not merely adding these scripts.

## Ongoing operation

The first October 13, 2026 tool drill used PostgreSQL 18.6 command-line tools,
synthetic records, three originals, and a TEXT stand-in for the vector column.
It verified checksums, wrong-key and tampering rejection, ZIP path boundaries,
and refusal to overwrite populated targets. That fixture alone did not prove
vector recovery.

The subsequent real pre-deployment snapshot was created read-only from
production PostgreSQL 18.6 over required TLS, with all 74 retained originals.
It was restored into a new private loopback PostgreSQL 18.6 cluster using
pgvector 0.8.2 built from the official tagged source. All 32 table counts matched
the authenticated dump, including 57 document rows, 27 memory rows, and 7 stays;
these counts include retained history. All 74 original-file SHA-256 checks
matched. The real `vector(1536)` column, 98 populated vectors, HNSW and text GIN
indexes, vector nearest-neighbor query, and application document/memory keyword
retrieval passed. Protected document and audio downloads returned the original
bytes, and the audio range request returned HTTP 206. Provider credentials were
blank throughout. The private restored cluster, WAL, originals, dump, and test
credentials were removed after verification; the encrypted recovery candidate
was preserved. This proves restoration of that snapshot and does not replace
periodic recovery drills or monitoring of subsequent cloud copies.

Choose an encrypted independent destination, recovery owner, retention period,
and schedule before activation. Record each successful snapshot and its tested
restore date outside the application. Alert on a failed or stale backup; inspect
capacity and periodically repeat the drill. Database and upload-volume backup
policies must cover the same recovery window.
