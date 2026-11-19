import { createReadStream } from "node:fs";
import { mkdir, realpath, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import type { ReadableStream as NodeWebStream } from "node:stream/web";
import { Prisma, PrismaClient } from "@prisma/client";
import {
  fileDigest, independentOutput, postgresEnvironment, privateStagingDirectory, removeStagingDirectory, runProgram,
} from "./archive-common";
import { ArchiveCollectionStore, type ArchiveCollectionCatalog, type ArchiveCollectionEntry } from "./archive-collection-store";
import { archiveSourceInventory } from "./archive-source-inventory";
import { readArchiveOriginal } from "../src/lib/archive-original-response";

export async function saveArchiveCollection(options: {
  repository: string; originals: string; databaseUrl: string; passphrase: string;
}) {
  const originals = await realpath(options.originals);
  const root = path.dirname(await independentOutput(path.join(options.repository, "catalog"), originals));
  const store = await ArchiveCollectionStore.open(root, options.passphrase, true);
  const stage = await privateStagingDirectory();
  const db = new PrismaClient({ datasourceUrl: options.databaseUrl });
  try {
    return await store.withWriter(async () => {
      const dump = path.join(stage, "database.dump");
      const sources = await db.$transaction(async tx => {
        await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY");
        const [snapshot] = await tx.$queryRaw<Array<{ id: string }>>`SELECT pg_export_snapshot() AS id`;
        const inventory = await archiveSourceInventory(tx, originals);
        await runProgram(process.env.PG_DUMP_PATH || "pg_dump", [
          "--format=custom", "--no-owner", "--no-acl", "--snapshot=" + snapshot.id, "--file=" + dump,
        ], postgresEnvironment(options.databaseUrl), { timeoutMs: 30 * 60_000 });
        return inventory;
      }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 30 * 60_000, maxWait: 10_000 });

      const database = { path: "database.dump", size: (await stat(dump)).size, sha256: await fileDigest(dump) };
      const files: ArchiveCollectionEntry[] = [database, ...sources.inventory];
      let copied = 0;
      await store.retain(database, async () => createReadStream(dump));
      for (const source of sources.inventory) {
        if (await store.retain(source, async () => createReadStream(path.join(originals, source.path.slice(10))))) copied++;
      }
      for (const source of sources.external) {
        const entry = {
          path: "drive/" + source.driveId, size: Number(source.sizeBytes), sha256: source.sha256,
          sourcePath: source.batch.folderName + "/" + source.relativePath, documentId: source.documentId ?? undefined,
        };
        if (await store.retain(entry, async () => {
          const response = await readArchiveOriginal(source);
          if (!response.body || response.status !== 200) throw new Error("The independent copy could not open an original.");
          return Readable.fromWeb(response.body as NodeWebStream<Uint8Array>);
        })) copied++;
        files.push(entry);
      }
      const catalog = await store.publish({ version: 1, createdAt: new Date().toISOString(), files });
      return { catalog, originals: files.length - 1, copied };
    });
  } finally {
    await db.$disconnect();
    store.close();
    await removeStagingDirectory(stage);
  }
}

function testDatabaseUrl(value: string): URL {
  const url = new URL(value);
  if (!["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) || !/test/i.test(url.pathname)) {
    throw new Error("A database restore drill requires a disposable loopback database with test in its name.");
  }
  return url;
}

export async function readArchiveCollection(options: {
  repository: string; catalog: string; passphrase: string; extractTo?: string; databaseUrl?: string;
}): Promise<ArchiveCollectionCatalog> {
  const store = await ArchiveCollectionStore.open(options.repository, options.passphrase);
  const dbUrl = options.databaseUrl ? testDatabaseUrl(options.databaseUrl) : null;
  const target = options.extractTo;
  const db = dbUrl ? new PrismaClient({ datasourceUrl: options.databaseUrl }) : null;
  try {
    if (db && !target) throw new Error("Choose a new directory for extraction before applying a database restore.");
    if (db) {
      const [{ count, timezone }] = await db.$queryRaw<Array<{ count: bigint; timezone: string }>>`
        SELECT count(*) AS count, current_setting('TimeZone') AS timezone FROM information_schema.tables
        WHERE table_schema NOT IN ('pg_catalog', 'information_schema')`;
      if (Number(count) || !["UTC", "Etc/UTC", "GMT", "Etc/GMT"].includes(timezone)) {
        throw new Error("The test database must be empty and use UTC.");
      }
    }
    const catalog = await store.catalog(options.catalog);
    if (target) {
      if (!path.isAbsolute(target)) throw new Error("Choose a new absolute recovery directory.");
      const parent = await realpath(path.dirname(target));
      const destination = path.join(parent, path.basename(target));
      if (destination === store.root || destination.startsWith(store.root + path.sep)) {
        throw new Error("Extract into a directory outside the encrypted repository.");
      }
      await mkdir(destination, { mode: 0o700 });
      for (const entry of catalog.files) {
        const file = path.join(destination, entry.path);
        await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
        await store.extract(entry, file);
      }
      await writeFile(path.join(destination, "catalog.json"), JSON.stringify(catalog, null, 2), { mode: 0o600, flag: "wx" });
      if (dbUrl) {
        await runProgram(process.env.PG_RESTORE_PATH || "pg_restore", [
          "--single-transaction", "--exit-on-error", "--no-owner", "--no-acl",
          "--dbname=" + decodeURIComponent(dbUrl.pathname.slice(1)), path.join(destination, "database.dump"),
        ], postgresEnvironment(options.databaseUrl!), { timeoutMs: 30 * 60_000 });
      }
    } else {
      const verified = new Set<string>();
      for (const entry of catalog.files) {
        if (verified.has(entry.sha256)) continue;
        await store.verify(entry);
        verified.add(entry.sha256);
      }
    }
    return catalog;
  } finally {
    await db?.$disconnect();
    store.close();
  }
}
