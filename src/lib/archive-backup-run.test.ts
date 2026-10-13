import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";
import { authorizedArchiveBackupRequest } from "./archive-backup-auth";
import { backupStatus, runClaimedArchiveBackup, type BackupStore } from "./archive-backup-run";
import type { DriveBackupReceipt } from "../../scripts/archive-drive-common";
import { GET, POST } from "../app/api/archive/backup/route";
import { runProgram } from "../../scripts/archive-common";

const receipt: DriveBackupReceipt = { version: 1, provider: "google-drive", driveFileId: "synthetic-file", folderId: "synthetic-folder", encryptedSha256: "a".repeat(64), size: 100, verifiedAt: "2026-10-13T00:00:00Z", snapshotCreatedAt: "2026-10-13T00:00:00Z", originalCount: 4, restoreVerified: false };
function fixture() {
  const calls: string[] = [];
  const store: BackupStore = { async claim() { return "claimed"; }, async heartbeat() { calls.push("heartbeat"); return true; }, async succeed(_token, actual) { assert.deepEqual(actual, receipt); calls.push("success"); return true; }, async fail(_token, phase) { calls.push(`failure:${phase}`); return true; }, async read() { return null; } };
  return { calls, store, async snapshot() { calls.push("snapshot"); return "protected-synthetic-snapshot"; }, async upload() { calls.push("upload-and-download-verify"); return receipt; }, async cleanup() { calls.push("cleanup"); }, cancel() { calls.push("cancel"); } };
}
test("backup success follows independent verification and never claims a full restore", async () => {
  const dependencies = fixture();
  assert.equal(await runClaimedArchiveBackup("lease", dependencies), "verified");
  assert.deepEqual(dependencies.calls, ["heartbeat", "snapshot", "heartbeat", "upload-and-download-verify", "heartbeat", "success", "cleanup"]);
  assert.equal(backupStatus({ state: "verified", leaseExpiresAt: null, startedAt: new Date(), lastSuccessAt: new Date(), lastFailureAt: null, lastError: null, latestReceipt: receipt }).restoreVerified, false);
});
test("failed snapshot or independent verification cannot write success or private provider errors", async () => {
  for (const phase of ["snapshot", "upload"] as const) {
    const dependencies = fixture();
    dependencies[phase] = async () => { throw new Error("private provider token and source details"); };
    assert.equal(await runClaimedArchiveBackup("lease", dependencies), "failed");
    assert.ok(!dependencies.calls.includes("success"));
    assert.ok(dependencies.calls.includes(`failure:${phase === "snapshot" ? "snapshot" : "drive-copy"}`));
    assert.ok(dependencies.calls.includes("cleanup"));
    assert.ok(!dependencies.calls.join().includes("private"));
  }
});
test("lost lease cancels work before upload and fences status updates", async () => {
  const dependencies = fixture(); let renewals = 0;
  dependencies.store.heartbeat = async () => ++renewals === 1;
  assert.equal(await runClaimedArchiveBackup("lease", dependencies), "fenced");
  assert.ok(dependencies.calls.includes("cancel"));
  assert.ok(!dependencies.calls.includes("upload-and-download-verify"));
  assert.ok(!dependencies.calls.some(call => call.startsWith("failure:") || call === "success"));
  assert.equal(backupStatus({ state: "running", leaseExpiresAt: new Date(0), startedAt: new Date(0), lastSuccessAt: new Date(0), lastFailureAt: null, lastError: null, latestReceipt: receipt }).state, "interrupted");
});
test("backup credential rejects ordinary family cookies, weak values and credential reuse; disabled runs never start", async () => {
  const keys = ["ARCHIVE_BACKUP_TOKEN", "ARCHIVE_BACKUP_ENABLED", "SITE_MAINTENANCE_TOKEN", "BUCKY_WORKER_TOKEN", "AUTH_SECRET"] as const;
  const old = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  try {
    process.env.ARCHIVE_BACKUP_TOKEN = "a".repeat(43);
    process.env.ARCHIVE_BACKUP_ENABLED = "false";
    const plain = new NextRequest("https://breadloafhill.com/api/archive/backup", { headers: { Cookie: "breadloaf-auth=family" } });
    assert.equal((await GET(plain)).status, 401);
    assert.equal((await POST(plain)).status, 401);
    const authorized = new NextRequest(plain.url, { headers: { Authorization: `Bearer ${process.env.ARCHIVE_BACKUP_TOKEN}` } });
    assert.equal(authorizedArchiveBackupRequest(authorized), true);
    assert.equal((await POST(authorized)).status, 503);
    process.env.SITE_MAINTENANCE_TOKEN = process.env.ARCHIVE_BACKUP_TOKEN;
    assert.equal(authorizedArchiveBackupRequest(authorized), false);
    process.env.SITE_MAINTENANCE_TOKEN = "different";
    process.env.ARCHIVE_BACKUP_TOKEN = "weak";
    assert.equal(authorizedArchiveBackupRequest(authorized), false);
  } finally { for (const [key, value] of Object.entries(old)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } }
});

test("native snapshot processing stops on cancellation before staging cleanup", async () => {
  const controller = new AbortController();
  const started = Date.now();
  const timer = setTimeout(() => controller.abort(), 60);
  try {
    await assert.rejects(runProgram(process.execPath, ["-e", "setTimeout(() => process.exit(0), 60000)"], process.env, { signal: controller.signal, timeoutMs: 2000 }), /could not complete/);
    assert.ok(Date.now() - started < 3000);
  } finally { clearTimeout(timer); }
});

test("cleanup waits for an already queued lease renewal to finish", async () => {
  const dependencies = fixture(); let renewals = 0, started!: () => void, release!: (value: boolean) => void;
  const renewing = new Promise<void>(resolve => { started = resolve; });
  const pending = new Promise<boolean>(resolve => { release = resolve; });
  dependencies.store.heartbeat = async () => { if (++renewals === 1) return true; started(); return pending; };
  dependencies.snapshot = async () => { await renewing; throw new Error("Snapshot failed while renewal was queued"); };
  const keepAlive = setTimeout(() => release(false), 1000);
  try {
    const result = runClaimedArchiveBackup("lease", { ...dependencies, heartbeatMs: 1 });
    await renewing;
    assert.ok(!dependencies.calls.includes("cleanup"));
    release(false); await result;
    assert.equal(dependencies.calls.at(-1), "cleanup");
  } finally { clearTimeout(keepAlive); }
});

test("native deadline escalates if a process ignores graceful termination", async () => {
  const started = Date.now();
  await assert.rejects(runProgram(process.execPath, ["-e", "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000)"], process.env, { timeoutMs: 300 }), /could not complete/);
  assert.ok(Date.now() - started < 5000, "a native process cannot hold the backup indefinitely");
});
