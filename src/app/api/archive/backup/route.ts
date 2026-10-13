import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { authorizedArchiveBackupRequest } from "@/lib/archive-backup-auth";
import { createArchiveBackupStore } from "@/lib/archive-backup-store";
import { backupStatus } from "@/lib/archive-backup-run";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store" };

export async function GET(request: NextRequest) {
  if (!authorizedArchiveBackupRequest(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers });
  try { return NextResponse.json(backupStatus(await createArchiveBackupStore(prisma).read()), { headers }); }
  catch { return NextResponse.json({ error: "Backup status is unavailable" }, { status: 503, headers }); }
}
export async function POST(request: NextRequest) {
  if (!authorizedArchiveBackupRequest(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers });
  if (process.env.ARCHIVE_BACKUP_ENABLED !== "true") return NextResponse.json({ error: "Archive backups are not activated" }, { status: 503, headers });
  if (!process.env.ARCHIVE_BACKUP_PASSPHRASE || process.env.ARCHIVE_BACKUP_PASSPHRASE.length < 20 ||
    !process.env.ARCHIVE_DRIVE_FOLDER_ID || !process.env.ARCHIVE_DRIVE_CLIENT_ID || !process.env.ARCHIVE_DRIVE_CLIENT_SECRET || !process.env.ARCHIVE_DRIVE_REFRESH_TOKEN) {
    return NextResponse.json({ error: "Archive backup configuration is incomplete" }, { status: 503, headers });
  }
  const store = createArchiveBackupStore(prisma), token = randomUUID();
  try {
    const claimed = await store.claim(token, new Date());
    if (claimed !== "claimed") return NextResponse.json({ accepted: false, reason: claimed, ...backupStatus(await store.read()) }, { status: claimed === "busy" ? 202 : 200, headers });
    const allowed = ["PATH", "SYSTEMROOT", "WINDIR", "TEMP", "TMP", "HOME", "USERPROFILE", "LANG", "NODE_ENV", "DATABASE_URL", "PG_DUMP_PATH", "PGSSLROOTCERT", "ARCHIVE_BACKUP_ENABLED", "ARCHIVE_BACKUP_PASSPHRASE", "ARCHIVE_DRIVE_FOLDER_ID", "ARCHIVE_DRIVE_CLIENT_ID", "ARCHIVE_DRIVE_CLIENT_SECRET", "ARCHIVE_DRIVE_REFRESH_TOKEN"];
    const env: NodeJS.ProcessEnv = { NODE_ENV: process.env.NODE_ENV || "production", ...Object.fromEntries(Object.entries(process.env).filter(([key]) => allowed.includes(key.toUpperCase()))) };
    env.ARCHIVE_BACKUP_LEASE_TOKEN = token;
    await new Promise<void>((resolve, reject) => {
      const child = spawn(process.execPath, [path.join(process.cwd(), "node_modules", "tsx", "dist", "cli.mjs"), path.join(process.cwd(), "scripts", "archive-backup-runner.ts")],
        { cwd: process.cwd(), env, stdio: "ignore", windowsHide: true });
      child.once("error", reject); child.once("spawn", () => { child.unref(); resolve(); });
    });
    return NextResponse.json({ accepted: true, state: "running", startedAt: new Date().toISOString(), restoreVerified: false }, { status: 202, headers });
  } catch {
    await store.fail(token, "launch", new Date()).catch(() => {});
    return NextResponse.json({ error: "Archive backup could not start. No verified success was recorded." }, { status: 503, headers });
  }
}
