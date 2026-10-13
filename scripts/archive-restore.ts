import "dotenv/config";
import { mkdir, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { backupPassphrase, option, postgresEnvironment, privateStagingDirectory, removeStagingDirectory, runProgram, verifySnapshot } from "./archive-common";

async function main() {
  const input = option("--input");
  if (!input) throw new Error("Provide --input <file.blhbackup>. Verification is a dry run unless --apply is supplied.");
  const verified = await verifySnapshot(path.resolve(input), backupPassphrase());
  console.log(`Snapshot verified: ${verified.manifest.files.length - 1} originals plus database dump, created ${verified.manifest.createdAt}.`);
  if (!process.argv.includes("--apply")) { console.log("Dry run complete. No database or original files were changed."); return; }
  const target = process.env.ARCHIVE_RESTORE_DATABASE_URL;
  const targetOriginals = option("--target-originals");
  if (!target || !targetOriginals || !path.isAbsolute(targetOriginals)) throw new Error("Apply requires ARCHIVE_RESTORE_DATABASE_URL and an absolute --target-originals directory.");
  const url = new URL(target);
  if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) || !/test/i.test(url.pathname)) throw new Error("Restore drills require a disposable loopback database whose name includes test.");
  const directory = path.resolve(targetOriginals);
  const existing = await readdir(directory).catch((error: NodeJS.ErrnoException) => { if (error.code === "ENOENT") return []; throw error; });
  if (existing.length) throw new Error("Target originals directory must be empty; existing files are never overwritten.");
  const db = new PrismaClient({ datasourceUrl: target });
  const stage = await privateStagingDirectory();
  try {
    const [{ timezone }] = await db.$queryRaw<Array<{ timezone: string }>>`SELECT current_setting('TimeZone') AS timezone`;
    if (!["UTC", "Etc/UTC", "GMT", "Etc/GMT"].includes(timezone)) throw new Error("Restore target connections must use UTC. Configure the empty disposable database timezone to UTC, then reconnect and retry.");
    const [{ count }] = await db.$queryRaw<Array<{ count: bigint }>>`SELECT count(*) AS count FROM information_schema.tables WHERE table_schema NOT IN ('pg_catalog','information_schema')`;
    if (Number(count)) throw new Error("Target database must be empty. Existing tables are never dropped.");
    const dumpPath = path.join(stage, "database.dump");
    await writeFile(dumpPath, await verified.zip.file("database.dump")!.async("nodebuffer"), { mode: 0o600 });
    await runProgram(process.env.PG_RESTORE_PATH || "pg_restore", ["--single-transaction", "--exit-on-error", "--no-owner", "--no-acl", "--dbname=" + url.pathname.slice(1), dumpPath], postgresEnvironment(target));
    await mkdir(directory, { recursive: true });
    for (const file of verified.manifest.files.filter(file => file.path.startsWith("originals/"))) {
      const destination = path.join(directory, file.path.slice(10));
      await mkdir(path.dirname(destination), { recursive: true });
      await writeFile(destination, await verified.zip.file(file.path)!.async("nodebuffer"), { flag: "wx", mode: 0o600 });
    }
    console.log(`Restore drill applied to empty disposable targets: ${verified.manifest.files.length - 1} originals restored. Verify record counts and application retrieval before approving production recovery.`);
  } finally { await db.$disconnect(); await removeStagingDirectory(stage); }
}

void main().catch(error => { console.error(error instanceof Error ? error.message : "Archive restore failed."); process.exitCode = 1; });
