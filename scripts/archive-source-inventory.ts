import type { Prisma } from "@prisma/client";
import { archiveDriveId } from "../src/lib/archive-import-format";
import { originalsInventory, safeArchivePath } from "./archive-common";

export async function archiveSourceInventory(tx: Prisma.TransactionClient, originals: string) {
  const [{ emailSourceAvailable, externalSourceAvailable }] = await tx.$queryRaw<Array<{ emailSourceAvailable: boolean; externalSourceAvailable: boolean }>>`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema()
        AND table_name = 'EmailLog' AND column_name = 'sourceChecksum'
    ) AS "emailSourceAvailable", EXISTS (
      SELECT 1 FROM information_schema.tables WHERE table_schema = current_schema()
        AND table_name = 'ArchiveImportFile'
    ) AS "externalSourceAvailable"`;
  const [documents, memories, maintenance, analyses, emails, externalRows, inventory] = await Promise.all([
    tx.document.findMany({ where: { fileType: { not: "link" } }, select: { id: true, filePath: true, checksum: true } }),
    tx.jarvisMemory.findMany({ where: { filePath: { not: null } }, select: { filePath: true } }),
    tx.maintenanceRecord.findMany({ select: { sourceRecordings: true } }),
    tx.dictationAnalysis.findMany({ select: { filePath: true } }),
    emailSourceAvailable ? tx.emailLog.findMany({ where: { sourceChecksum: { not: null } }, select: { sourceChecksum: true } }) : [],
    externalSourceAvailable ? tx.archiveImportFile.findMany({
      where: { documentId: { not: null } }, select: {
        driveId: true, driveFolder: true, sha256: true, fileType: true, sizeBytes: true, relativePath: true, documentId: true,
        batch: { select: { folderName: true } },
      },
    }) : [],
    originalsInventory(originals),
  ]);
  const externalById = new Map(externalRows.map(row => [row.driveId, row]));
  const external = [];
  const references = new Set<string>();
  const originalPath = (value: string) => {
    if (!value.startsWith("/uploads/") || !safeArchivePath(value.slice(9))) throw new Error("Database contains an unsupported original-file path.");
    return value.slice(9);
  };
  const localByPath = new Map(inventory.map(file => [file.path.slice(10), file]));
  for (const document of documents) {
    const driveId = archiveDriveId(document.filePath);
    if (driveId) {
      const original = externalById.get(driveId);
      if (!original || original.documentId !== document.id || original.sha256 !== document.checksum) {
        throw new Error("The archive catalog contains an unverified Drive original.");
      }
      external.push(original);
      continue;
    }
    const relativePath = originalPath(document.filePath);
    references.add(relativePath);
    if (document.checksum && localByPath.get(relativePath)?.sha256 !== document.checksum) {
      throw new Error("A retained original does not match its stored checksum.");
    }
  }
  for (const value of [...memories.map(row => row.filePath!), ...analyses.map(row => row.filePath)]) {
    if (archiveDriveId(value) && externalById.has(archiveDriveId(value)!)) continue;
    references.add(originalPath(value));
  }
  for (const record of maintenance) {
    const sources = Array.isArray(record.sourceRecordings) ? record.sourceRecordings : [];
    for (const source of sources) if (source && typeof source === "object" && "filePath" in source && typeof source.filePath === "string") {
      references.add(originalPath(source.filePath));
    }
  }
  for (const email of emails) {
    if (!/^[a-f0-9]{64}$/.test(email.sourceChecksum!)) throw new Error("A retained email has an invalid original-source checksum.");
    const relativePath = ".mail-room-source/" + email.sourceChecksum + ".eml";
    references.add(relativePath);
    if (localByPath.get(relativePath)?.sha256 !== email.sourceChecksum) throw new Error("A retained email original does not match its checksum.");
  }
  if (Array.from(references).some(reference => !localByPath.has(reference))) {
    throw new Error("Referenced originals are missing. Repair archive integrity before creating a recovery snapshot.");
  }
  return { inventory, references: Array.from(references), external };
}
