import "dotenv/config";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { backupPassphrase, privateStagingDirectory, removeStagingDirectory } from "./archive-common";
import { createArchiveSnapshot } from "./archive-snapshot";
import { createUserDriveTransport, uploadVerifiedSnapshotToDrive } from "./archive-drive-common";
import { createArchiveBackupStore } from "../src/lib/archive-backup-store";
import { runClaimedArchiveBackup } from "../src/lib/archive-backup-run";

async function main() {
  const token = process.env.ARCHIVE_BACKUP_LEASE_TOKEN;
  if (!token || !/^[a-f0-9-]{36}$/.test(token) || !process.env.DATABASE_URL) throw new Error("An existing backup lease is required.");
  const db = new PrismaClient();
  const controller = new AbortController();
  const deadline = setTimeout(() => controller.abort(), 55 * 60 * 1000);
  deadline.unref();
  let stage: string | undefined;
  try {
    const result = await runClaimedArchiveBackup(token, {
      store: createArchiveBackupStore(db), cancel: () => controller.abort(),
      async snapshot() {
        if (process.env.ARCHIVE_BACKUP_ENABLED !== "true" || !process.env.ARCHIVE_DRIVE_FOLDER_ID) throw new Error("Backup is not configured.");
        const passphrase = backupPassphrase();
        stage = await privateStagingDirectory();
        const output = path.join(stage, "snapshot.blhbackup");
        // Fixed application mount only; HTTP callers cannot choose inputs/paths.
        await createArchiveSnapshot({ output, databaseUrl: process.env.DATABASE_URL!, originals: path.join(process.cwd(), "public", "uploads"), passphrase, signal: controller.signal });
        return output;
      },
      async upload(input) {
        controller.signal.throwIfAborted();
        const user = await createUserDriveTransport();
        return uploadVerifiedSnapshotToDrive({ input, passphrase: backupPassphrase(), folderId: process.env.ARCHIVE_DRIVE_FOLDER_ID!,
          transport: { async request(...args) { controller.signal.throwIfAborted(); const response = await user.request(...args); if (controller.signal.aborted) { await response.body?.cancel(); controller.signal.throwIfAborted(); } return response; } } });
      },
      async cleanup() { if (stage) await removeStagingDirectory(stage); },
    });
    console.log(`Archive backup result: ${result}. Document backup status was unchanged.`);
    if (result !== "verified") process.exitCode = 1;
  } finally { clearTimeout(deadline); await db.$disconnect(); }
}
void main().catch(() => { console.error("Archive backup runner stopped. Check its durable status; no restored-backup claim was made."); process.exitCode = 1; });
