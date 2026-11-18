import "dotenv/config";
import { createReadStream, createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import { mkdir, readdir } from "node:fs/promises";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { backupPassphrase, option, postgresEnvironment, runProgram, type SnapshotManifest } from "./archive-common";
import { verifySnapshot } from "./archive-format";

async function applyVerified(stage: string, manifest: SnapshotManifest) {
  const target = process.env.ARCHIVE_RESTORE_DATABASE_URL;
  const targetOriginals = option("--target-originals");
  if (!target || !targetOriginals || !path.isAbsolute(targetOriginals)) throw new Error("Apply requires ARCHIVE_RESTORE_DATABASE_URL and an absolute --target-originals directory.");
  const url = new URL(target);
  if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) || !/test/i.test(url.pathname)) throw new Error("Restore drills require a disposable loopback database whose name includes test.");
  const directory = path.resolve(targetOriginals);
  const existing = await readdir(directory).catch((error: NodeJS.ErrnoException) => { if (error.code === "ENOENT") return []; throw error; });
  if (existing.length) throw new Error("Target originals directory must be empty; existing files are never overwritten.");
  const db = new PrismaClient({ datasourceUrl: target });
  try {
    const [{ timezone }] = await db.$queryRaw<Array<{ timezone: string }>>`SELECT current_setting('TimeZone') AS timezone`;
    if (!["UTC", "Etc/UTC", "GMT", "Etc/GMT"].includes(timezone)) throw new Error("Restore target connections must use UTC. Configure the empty disposable database timezone to UTC, then reconnect and retry.");
    const [{ count }] = await db.$queryRaw<Array<{ count: bigint }>>`SELECT count(*) AS count FROM information_schema.tables WHERE table_schema NOT IN ('pg_catalog','information_schema')`;
    if (Number(count)) throw new Error("Target database must be empty. Existing tables are never dropped.");
    const dumpPath = path.join(stage, "database.dump");
    await runProgram(process.env.PG_RESTORE_PATH || "pg_restore", ["--single-transaction", "--exit-on-error", "--no-owner", "--no-acl", "--dbname=" + url.pathname.slice(1), dumpPath], postgresEnvironment(target));
    await mkdir(directory, { recursive: true });
    for (const file of manifest.files.filter(file => file.path.startsWith("originals/"))) {
      const destination = path.join(directory, file.path.slice(10));
      await mkdir(path.dirname(destination), { recursive: true });
      await pipeline(createReadStream(path.join(stage, file.path)), createWriteStream(destination, { flags: "wx", mode: 0o600 }));
    }
    console.log(`Restore drill applied to empty disposable targets: ${manifest.files.length - 1} originals restored. Verify record counts and application retrieval before approving production recovery.`);
  } finally { await db.$disconnect(); }
}

async function main() {
  const input = option("--input");
  if (!input) throw new Error("Provide --input <file.blhbackup>. Verification is a dry run unless --apply is supplied.");
  const apply = process.argv.includes("--apply");
  const { manifest } = await verifySnapshot(path.resolve(input), backupPassphrase(), { onVerifiedFiles: apply ? applyVerified : undefined });
  if (!apply) console.log(`Snapshot verified: ${manifest.files.length - 1} originals plus database dump, created ${manifest.createdAt}. Dry run complete. No database or original files were changed.`);
}

void main().catch(error => { console.error(error instanceof Error ? error.message : "Archive restore failed."); process.exitCode = 1; });
