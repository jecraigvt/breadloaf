import { copyFile, mkdir, realpath, rm, stat } from "node:fs/promises";
import path from "node:path";
import { Prisma, PrismaClient } from "@prisma/client";
import { fileDigest, independentOutput, postgresEnvironment, privateStagingDirectory, removeStagingDirectory, runProgram, type SnapshotManifest } from "./archive-common";
import { encryptSnapshot, verifySnapshot } from "./archive-format";
import { archiveSourceInventory } from "./archive-source-inventory";

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
      const { inventory, references, external } = await archiveSourceInventory(tx, originals);
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
      return { version: 1, createdAt: new Date().toISOString(), files: [dump, ...inventory], references,
        ...(external.length ? { externalOriginalCount: external.length } : {}),
      } satisfies SnapshotManifest;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 30 * 60 * 1000, maxWait: 10000 });
    options.signal?.throwIfAborted();
    await encryptSnapshot(stage, output, manifest, options.passphrase, options.signal);
    try {
      await verifySnapshot(output, options.passphrase, { signal: options.signal });
    } catch (error) {
      // The writer created this output exclusively. Keep only verified snapshots.
      await rm(output, { force: true });
      throw error;
    }
    return manifest;
  } finally { await db.$disconnect(); await removeStagingDirectory(stage); }
}
