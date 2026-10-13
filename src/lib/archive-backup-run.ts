import type { DriveBackupReceipt } from "../../scripts/archive-drive-common";

export const BACKUP_LEASE_MS = 3 * 60 * 1000;
export const BACKUP_INTERVAL_MS = 6 * 24 * 60 * 60 * 1000;
export interface BackupState {
  state: string; leaseExpiresAt: Date | null; startedAt: Date | null;
  lastSuccessAt: Date | null; lastFailureAt: Date | null; lastError: string | null; latestReceipt: unknown;
}
export interface BackupStore {
  claim(token: string, now: Date): Promise<"claimed" | "busy" | "current">;
  heartbeat(token: string, now: Date): Promise<boolean>;
  succeed(token: string, receipt: DriveBackupReceipt, now: Date): Promise<boolean>;
  fail(token: string, phase: string, now: Date): Promise<boolean>;
  read(): Promise<BackupState | null>;
}
export interface BackupRunDependencies {
  store: BackupStore;
  snapshot(): Promise<string>;
  upload(input: string): Promise<DriveBackupReceipt>;
  cleanup(): Promise<void>;
  cancel?(): void;
  now?: () => Date;
  heartbeatMs?: number;
}

/** Durable success is written only after the independent encrypted download
 * matches. A replacement lease fences an old process's status writes. */
export async function runClaimedArchiveBackup(token: string, dependencies: BackupRunDependencies): Promise<"verified" | "failed" | "fenced"> {
  const now = dependencies.now || (() => new Date());
  let fenced = false, phase = "snapshot", renewal: Promise<void> | null = null;
  const renew = (): Promise<void> => {
    if (fenced) return Promise.resolve();
    if (renewal) return renewal;
    renewal = (async () => {
      try { if (!await dependencies.store.heartbeat(token, now())) { fenced = true; dependencies.cancel?.(); } }
      catch { fenced = true; dependencies.cancel?.(); }
    })().finally(() => { renewal = null; });
    return renewal;
  };
  await renew();
  const timer = setInterval(() => void renew(), dependencies.heartbeatMs || 30_000);
  timer.unref();
  try {
    if (fenced) return "fenced";
    const input = await dependencies.snapshot();
    await renew(); if (fenced) return "fenced";
    phase = "drive-copy";
    const receipt = await dependencies.upload(input);
    await renew(); if (fenced) return "fenced";
    if (receipt.restoreVerified !== false || receipt.provider !== "google-drive" || !/^[a-f0-9]{64}$/.test(receipt.encryptedSha256)) throw new Error("Unverified receipt");
    return await dependencies.store.succeed(token, receipt, now()) ? "verified" : "fenced";
  } catch {
    if (fenced) return "fenced";
    // Persist only the phase, never provider error bodies, paths or credentials.
    return await dependencies.store.fail(token, phase, now()) ? "failed" : "fenced";
  } finally { clearInterval(timer); if (renewal) await renewal; await dependencies.cleanup(); }
}

export function backupStatus(state: BackupState | null, now = new Date()) {
  return { state: state?.state === "running" && (!state.leaseExpiresAt || state.leaseExpiresAt <= now) ? "interrupted" : state?.state || "never-run",
    startedAt: state?.startedAt || null, lastSuccessAt: state?.lastSuccessAt || null,
    lastFailureAt: state?.lastFailureAt || null, lastError: state?.lastError || null,
    copyVerified: Boolean(state?.latestReceipt), restoreVerified: false,
    due: !state?.lastSuccessAt || state.lastSuccessAt.getTime() <= now.getTime() - BACKUP_INTERVAL_MS };
}
