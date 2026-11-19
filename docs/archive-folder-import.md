# Import and recover family scan folders

The folder importer uses the property Google Drive for originals and PostgreSQL for upload progress, the catalog, and Bucky’s page results. The app can resume a partially saved folder after the organizer selects it again. The original is available when Drive confirms its checksum. Reading and indexing can finish later.

## Set up Drive

Use the property account’s existing per-file Drive OAuth client from [Archive Drive](archive-drive.md). The dedicated **Breadloaf Hill Scan Archive** folder is shared with Jeremy’s personal Google account as a Viewer. To find the folder or grant Viewer access during setup, use the same credentials.

~~~sh
npm run archive:import:drive -- --viewer YOUR_PERSONAL_GOOGLE_ADDRESS
~~~

Keep the folder private. A Viewer on this whole folder can reach all originals in Drive, so use it for materials meant for the family archive. The script reports the folder ID. Set it on the web service as `ARCHIVE_IMPORT_DRIVE_FOLDER_ID` when starting the family pilot. The existing `ARCHIVE_DRIVE_FOLDER_ID` identifies the weekly backup folder. Folder imports become available when the new folder ID is configured. The importer uses the existing `ARCHIVE_DRIVE_CLIENT_ID`, `ARCHIVE_DRIVE_CLIENT_SECRET`, and `ARCHIVE_DRIVE_REFRESH_TOKEN`.

Measure the folder before import. Keep the property Drive on its free plan for the under-10-GB collection discussed in the [archive plan](archive-15gb-plan.md), subject to available space. The importer accepts up to 15 GiB and 25,000 scans in a batch and checks that Drive has room for the batch and ongoing backups. Larger uploads require an appropriate storage allowance. Cloudflare R2 remains a separate storage option if needed.

## Import a folder

Sign in with your family account and open **Archive → Import folder**. If each image subfolder contains pages of one letter or record, select the grouping option. You can pause or reselect the same folder to resume. The app tries resumable transfers directly to Drive and can relay individual bounded chunks if the browser cannot complete the direct transfer. Drive’s session expiry can require restarting one unfinished file. Completed originals and their catalog entries are reused.

Each verified scan queues a Bucky job. The worker stages the original on private temporary disk and renders one bounded page at a time. The Railway runtime image includes Poppler and libvips. For a local app instance, make Poppler available on PATH or set `ARCHIVE_PDFINFO_PATH`, `ARCHIVE_PDFTOTEXT_PATH`, and `ARCHIVE_PDFTOPPM_PATH`. Update local Bucky workers to this release before the pilot. An older worker can still run its original jobs and will skip the new page jobs.

Keep enough temporary disk for the largest original plus working space. PDFs and supported image files with up to 10,000 pages can enter page analysis. An unsupported original can still be downloaded. Bucky flags uncertain pages and the task list reports progress. File access always uses the signed-in person’s Breadloaf permissions.

## Optional independent recovery copy

The scheduled weekly Drive job retains the site’s database and existing uploads. Its receipt reports Drive scan originals separately because their bytes live outside that snapshot. If the family chooses to keep a separate copy of the scans, the collection backup preserves both sets of originals and the database together.

Run the collection command from a recovery host or maintenance environment that can reach the live database, the mounted legacy originals, and the property Drive API. Mount a separately controlled disk or backup destination outside the source checkout and originals directory. The command writes authenticated encrypted objects to that independent directory. It reuses unchanged bytes after checking their integrity and writes a new catalog for each successful snapshot. Keep older catalogs and the repository’s key header with the encrypted objects. Store the passphrase independently of the property Google account.

~~~sh
npm run archive:collection -- backup --originals /app/public/uploads --repository /mnt/recovery/breadloaf
npm run archive:collection -- verify --repository /mnt/recovery/breadloaf --catalog CATALOG_FROM_BACKUP
npm run archive:collection -- restore --repository /mnt/recovery/breadloaf --catalog CATALOG_FROM_BACKUP --target /tmp/breadloaf-restore-test --apply-db
~~~

The third command requires `ARCHIVE_RESTORE_DATABASE_URL` to point to a new empty loopback PostgreSQL database with `test` in its name and UTC connections. Use PostgreSQL tools compatible with the source server and install pgvector on the recovery server. Omit `--apply-db` to export files and the portable JSON catalog without applying a database. The recovery target must be a new directory with a parent that already exists. Keep this decrypted output private.

For a site restore drill, mount the extracted `originals` directory as `public/uploads`. Point `ARCHIVE_RECOVERED_ORIGINALS_DIR` to the extracted `drive` directory and leave production integrations off. The site streams those verified originals locally without using Google. Open and download a scan, compare bytes with the catalog, and ask Bucky to find the scan and link to its page. Record the test date and latest verified catalog outside the property account.

## Pilot checks

Test the sign-in, folder picker, interruption and resume, page citation, and protected download with representative synthetic scans. Include a PDF over 512 MB and check both website and reader memory. Then run the real collection pilot and measure space and reading throughput before importing the full collection.

~~~powershell
$env:ARCHIVE_LARGE_FILE_TEST = '1'
npx tsx --test src/lib/archive-collection-streaming.test.ts
~~~

The large-file check uses a synthetic PDF and a simulated Drive source. It never uploads files to the property account.
