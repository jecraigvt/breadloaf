import "dotenv/config";
import { readFile, writeFile } from "node:fs/promises";
import { backupPassphrase, option } from "./archive-common";
import { uploadVerifiedSnapshotToDrive, type DriveBackupReceipt } from "./archive-drive-common";

async function main() {
  const input = option("--input");
  const folderId = process.env.ARCHIVE_DRIVE_FOLDER_ID;
  if (!input || !folderId) throw new Error("Provide --input <snapshot.blhbackup> and configure ARCHIVE_DRIVE_FOLDER_ID.");
  const receiptPath = option("--receipt") || `${input}.drive-receipt.json`;
  let existing: DriveBackupReceipt | undefined;
  try {
    existing = JSON.parse(await readFile(receiptPath, "utf8")) as DriveBackupReceipt;
    if (existing.version !== 1 || existing.provider !== "google-drive" || existing.folderId !== folderId || typeof existing.driveFileId !== "string") throw new Error("The existing Drive receipt is invalid or belongs to another folder.");
  } catch (error) {
    if (!(error && typeof error === "object" && "code" in error && error.code === "ENOENT")) throw new Error("Read the existing receipt before replacing it; it was not a valid Drive backup receipt.");
  }
  const receipt = await uploadVerifiedSnapshotToDrive({ input, folderId, passphrase: backupPassphrase(), existingFileId: existing?.driveFileId });
  if (!existing) await writeFile(receiptPath, JSON.stringify(receipt, null, 2) + "\n", { flag: "wx", mode: 0o600 });
  console.log(`Encrypted Drive copy verified by metadata and download checksum: ${receipt.originalCount} originals plus PostgreSQL dump. Restore drill and backup schedule activation are still required; document backup status was not changed.`);
}

void main().catch(error => { console.error(error instanceof Error ? error.message : "Drive backup failed."); console.error("No document backup status was changed."); process.exitCode = 1; });
