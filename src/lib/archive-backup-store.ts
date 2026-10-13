import type { PrismaClient, Prisma } from "@prisma/client";
import type { DriveBackupReceipt } from "../../scripts/archive-drive-common";
import { BACKUP_INTERVAL_MS, BACKUP_LEASE_MS, type BackupStore } from "./archive-backup-run";

export function createArchiveBackupStore(db: PrismaClient, id = "weekly-drive"): BackupStore {
  const currentLease = (token: string, now: Date) => ({ id, state: "running", leaseToken: token, leaseExpiresAt: { gt: now } });
  const databaseClock = async (tx: Prisma.TransactionClient) => (await tx.$queryRaw<Array<{ now: Date }>>`SELECT clock_timestamp() AT TIME ZONE 'UTC' AS now`)[0].now;
  const updateLease = (token: string, change: (now: Date) => Prisma.ArchiveBackupStateUpdateManyMutationInput) => db.$transaction(async tx => {
    // Obtain the lock before reading time. A queued heartbeat cannot revive a
    // lease that expired while another transaction held this row.
    const rows = await tx.$queryRaw<Array<{ id: string }>>`SELECT "id" FROM "ArchiveBackupState" WHERE "id" = ${id} FOR UPDATE`;
    if (!rows.length) return false;
    const now = await databaseClock(tx);
    return (await tx.archiveBackupState.updateMany({ where: currentLease(token, now), data: { ...change(now), updatedAt: now } })).count === 1;
  }, { timeout: 10_000 });
  return {
    async claim(token) {
      return db.$transaction(async tx => {
        await tx.$executeRaw`INSERT INTO "ArchiveBackupState" ("id", "state", "updatedAt")
          VALUES (${id}, 'idle', clock_timestamp() AT TIME ZONE 'UTC') ON CONFLICT ("id") DO NOTHING`;
        await tx.$queryRaw`SELECT "id" FROM "ArchiveBackupState" WHERE "id" = ${id} FOR UPDATE`;
        const now = await databaseClock(tx);
        const state = await tx.archiveBackupState.findUniqueOrThrow({ where: { id } });
        if (state.leaseExpiresAt && state.leaseExpiresAt > now) return "busy";
        if (state.lastSuccessAt && state.lastSuccessAt.getTime() > now.getTime() - BACKUP_INTERVAL_MS) return "current";
        await tx.archiveBackupState.update({ where: { id }, data: { state: "running", leaseToken: token,
          leaseExpiresAt: new Date(now.getTime() + BACKUP_LEASE_MS), startedAt: now, updatedAt: now, lastError: null } });
        return "claimed";
      }, { timeout: 10_000 });
    },
    async heartbeat(token) {
      return updateLease(token, now => ({ leaseExpiresAt: new Date(now.getTime() + BACKUP_LEASE_MS) }));
    },
    async succeed(token: string, receipt: DriveBackupReceipt) {
      return updateLease(token, now => ({ state: "verified", leaseToken: null,
        leaseExpiresAt: null, lastSuccessAt: now, lastError: null, latestReceipt: receipt as unknown as Prisma.InputJsonValue }));
    },
    async fail(token, phase) {
      return updateLease(token, now => ({ state: "failed", leaseToken: null,
        leaseExpiresAt: null, lastFailureAt: now, lastError: `Archive backup failed during ${phase === "launch" ? "launch" : phase === "drive-copy" ? "Drive verification" : "snapshot creation"}. Previous verified copy was retained.` }));
    },
    read() { return db.archiveBackupState.findUnique({ where: { id } }); },
  };
}
