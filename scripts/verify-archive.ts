import "dotenv/config";
import path from "path";
import { prisma } from "../src/lib/prisma";
import { fileDigest } from "./archive-common";
import { verifyDriveOriginal } from "./verify-drive-original";

async function main() {
  const documents = await prisma.document.findMany({
    where: { fileType: { not: "link" } },
    select: { id: true, title: true, filePath: true, fileSize: true, fileType: true, checksum: true,
      archiveImportFile: { select: { driveId: true, driveFolder: true, sizeBytes: true, fileType: true, sha256: true } } },
    orderBy: { createdAt: "asc" },
  });

  const uploadRoot = path.resolve(process.cwd(), "public", "uploads");
  let verified = 0;
  let backfilled = 0;
  let missing = 0;
  let mismatched = 0;
  let unverifiedDrive = 0;

  for (const document of documents) {
    if (document.filePath.startsWith("drive:") || document.archiveImportFile) {
      try {
        await verifyDriveOriginal(document);
        verified += 1;
      } catch (error) {
        console.error(`UNVERIFIED DRIVE ORIGINAL: ${document.title}`, error instanceof Error ? error.message : "");
        unverifiedDrive += 1;
      }
      continue;
    }
    const relativePath = document.filePath.replace(/^[/\\]*uploads[/\\]/, "");
    const fullPath = path.resolve(uploadRoot, relativePath);
    if (!fullPath.startsWith(`${uploadRoot}${path.sep}`)) {
      console.error(`UNSAFE PATH: ${document.title} (${document.filePath})`);
      mismatched += 1;
      continue;
    }

    try {
      const checksum = await fileDigest(fullPath);
      if (!document.checksum) {
        await prisma.document.update({ where: { id: document.id }, data: { checksum } });
        console.log(`FINGERPRINTED: ${document.title}`);
        backfilled += 1;
      } else if (document.checksum !== checksum) {
        console.error(`MISMATCH: ${document.title}`);
        mismatched += 1;
      } else {
        verified += 1;
      }
    } catch {
      console.error(`MISSING: ${document.title} (${document.filePath})`);
      missing += 1;
    }
  }

  console.log(
    `Archive check complete: ${verified} verified, ${backfilled} fingerprinted, ${missing} missing, ${mismatched} mismatched, ${unverifiedDrive} unverified Drive originals.`
  );
  if (missing > 0 || mismatched > 0 || unverifiedDrive > 0) process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
