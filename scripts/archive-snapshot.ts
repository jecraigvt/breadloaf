import { copyFile, mkdir, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { Prisma, PrismaClient } from "@prisma/client";
import { encryptSnapshot, fileDigest, independentOutput, MAX_ARCHIVE_BYTES, originalsInventory, postgresEnvironment, privateStagingDirectory, removeStagingDirectory, runProgram, safeArchivePath, verifySnapshot, type SnapshotManifest } from "./archive-common";

export async function createArchiveSnapshot(options: { output: string; originals?: string; databaseUrl: string; passphrase: string; signal?: AbortSignal }): Promise<SnapshotManifest> {
  if (options.passphrase.length < 20) throw new Error("Use a backup passphrase of at least 20 characters.");
  options.signal?.throwIfAborted();
  const originals = await realpath(options.originals || path.join(process.cwd(), "public", "uploads"));
  const output = await independentOutput(options.output, originals);
  const stage = await privateStagingDirectory();
  const db = new PrismaClient({ datasourceUrl: options.databaseUrl });
  try {
    const manifest = await db.$transaction(async tx => {
      await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY");
      const [snapshot] = await tx.$queryRaw<Array<{ snapshot: string }>>`SELECT pg_export_snapshot() AS snapshot`;
      // Pre-migration safety snapshots must also work against the deployed
      // baseline, before durable Mail Room originals were introduced.
      const [{ available: emailSourceAvailable }] = await tx.$queryRaw<Array<{ available: boolean }>>`SELECT EXISTS (
        SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema()
          AND table_name = 'EmailLog' AND column_name = 'sourceChecksum'
      ) AS available`;
      const [documents, memories, maintenance, analyses, emails] = await Promise.all([
        tx.document.findMany({ where: { fileType: { not: "link" } }, select: { filePath: true, checksum: true } }),
        tx.jarvisMemory.findMany({ where: { filePath: { not: null } }, select: { filePath: true } }),
        tx.maintenanceRecord.findMany({ select: { sourceRecordings: true } }),
        tx.dictationAnalysis.findMany({ select: { filePath: true } }),
        emailSourceAvailable ? tx.emailLog.findMany({ where: { sourceChecksum: { not: null } }, select: { sourceChecksum: true } }) : Promise.resolve([]),
      ]);
      const references = new Set<string>();
      const originalPath = (value: string) => {
        if (!value.startsWith("/uploads/") || !safeArchivePath(value.slice(9))) throw new Error("Database contains an unsupported original-file path.");
        return value.slice(9);
      };
      for (const value of [...documents.map(row => row.filePath), ...memories.map(row => row.filePath!), ...analyses.map(row => row.filePath)]) references.add(originalPath(value));
      for (const email of emails) {
        if (!/^[a-f0-9]{64}$/.test(email.sourceChecksum!)) throw new Error("A retained email has an invalid original-source checksum.");
        references.add(`.mail-room-source/${email.sourceChecksum}.eml`);
      }
      for (const record of maintenance) {
        const sources = Array.isArray(record.sourceRecordings) ? record.sourceRecordings : [];
        for (const source of sources) if (source && typeof source === "object" && "filePath" in source && typeof source.filePath === "string") references.add(originalPath(source.filePath));
      }
      const inventory = await originalsInventory(originals);
      if (inventory.reduce((sum, file) => sum + file.size, 0) > MAX_ARCHIVE_BYTES) throw new Error("Originals exceed the 512 MB tooling limit.");
      const byPath = new Map(inventory.map(file => [file.path.slice(10), file]));
      if (Array.from(references).some(reference => !byPath.has(reference))) throw new Error("Referenced originals are missing. Repair archive integrity before creating a recovery snapshot.");
      for (const document of documents) if (document.checksum && byPath.get(originalPath(document.filePath))?.sha256 !== document.checksum) throw new Error("A retained original does not match its stored checksum.");
      for (const email of emails) if (byPath.get(`.mail-room-source/${email.sourceChecksum}.eml`)?.sha256 !== email.sourceChecksum) throw new Error("A retained email original does not match its checksum.");
      await mkdir(path.join(stage, "originals"));
      for (const file of inventory) {
        options.signal?.throwIfAborted();
        const target = path.join(stage, file.path);
        await mkdir(path.dirname(target), { recursive: true });
        await copyFile(path.join(originals, file.path.slice(10)), target);
        if (await fileDigest(target) !== file.sha256) throw new Error("An original changed during the snapshot. Retry while intake is quiet.");
      }
      const dumpPath = path.join(stage, "database.dump");
      await runProgram(process.env.PG_DUMP_PATH || "pg_dump", ["--format=custom", "--no-owner", "--no-acl", "--snapshot=" + snapshot.snapshot, "--file=" + dumpPath], postgresEnvironment(options.databaseUrl), { signal: options.signal, timeoutMs: 30 * 60 * 1000 });
      const dump = { path: "database.dump", size: (await stat(dumpPath)).size, sha256: await fileDigest(dumpPath) };
      return { version: 1, createdAt: new Date().toISOString(), files: [dump, ...inventory], references: Array.from(references) } satisfies SnapshotManifest;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 30 * 60 * 1000, maxWait: 10000 });
    options.signal?.throwIfAborted();
    await encryptSnapshot(stage, output, manifest, options.passphrase, options.signal);
    await verifySnapshot(output, options.passphrase);
    options.signal?.throwIfAborted();
    return manifest;
  } finally { await db.$disconnect(); await removeStagingDirectory(stage); }
}
