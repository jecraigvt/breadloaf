import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { createArchiveBackupStore } from "./archive-backup-store";
import type { DriveBackupReceipt } from "../../scripts/archive-drive-common";

const url = process.env.FAMILY_AUTH_TEST_DATABASE_URL;
test("durable archive lease admits one runner, fences stale attempts, and preserves the last verified copy on failure", { skip: !url }, async () => {
  const location = new URL(url!); assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(location.hostname) && /test/i.test(location.pathname));
  const db = new PrismaClient({ datasourceUrl: url }), id = `archive-backup-test-${randomUUID()}`, store = createArchiveBackupStore(db, id);
  const receipt: DriveBackupReceipt = { version: 1, provider: "google-drive", driveFileId: "synthetic-file", folderId: "synthetic-folder", encryptedSha256: "a".repeat(64), size: 100, verifiedAt: new Date().toISOString(), snapshotCreatedAt: new Date().toISOString(), originalCount: 4, restoreVerified: false };
  try {
    const tokens = [randomUUID(), randomUUID()], now = new Date();
    const claims = await Promise.all(tokens.map(token => store.claim(token, now)));
    assert.equal(claims.filter(value => value === "claimed").length, 1);
    assert.equal(claims.filter(value => value === "busy").length, 1);
    const winner = tokens[claims.indexOf("claimed")], loser = tokens[claims.indexOf("busy")];
    assert.equal(await store.succeed(loser, receipt, new Date()), false);
    assert.equal(await store.succeed(winner, receipt, new Date()), true);
    assert.equal(await store.claim(randomUUID(), new Date()), "current");
    const previous = await store.read();
    await db.archiveBackupState.update({ where: { id }, data: { lastSuccessAt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) } });
    const stale = randomUUID(); assert.equal(await store.claim(stale, new Date()), "claimed");
    await db.archiveBackupState.update({ where: { id }, data: { leaseExpiresAt: new Date(0) } });
    const replacement = randomUUID(); assert.equal(await store.claim(replacement, new Date()), "claimed");
    assert.equal(await store.heartbeat(stale, new Date()), false);
    assert.equal(await store.succeed(stale, receipt, new Date()), false);
    assert.equal(await store.fail(stale, "drive-copy", new Date()), false);
    assert.equal(await store.fail(replacement, "drive-copy", new Date()), true);
    const failed = await store.read(); assert.equal(failed?.state, "failed");
    assert.deepEqual(failed?.latestReceipt, previous?.latestReceipt);
    assert.ok(failed?.lastSuccessAt); assert.ok(failed?.lastFailureAt);

    const waiting = randomUUID(); assert.equal(await store.claim(waiting, new Date(0)), "claimed");
    const fresh = await store.read(); assert.ok(fresh?.leaseExpiresAt && fresh.leaseExpiresAt > new Date(), "claim timestamps come from the database after obtaining the lock");
    await db.archiveBackupState.update({ where: { id }, data: { leaseExpiresAt: new Date(Date.now() + 50) } });
    let locked!: () => void, release!: () => void;
    const ready = new Promise<void>(resolve => { locked = resolve; }), gate = new Promise<void>(resolve => { release = resolve; });
    const blocker = db.$transaction(async tx => { await tx.$queryRaw`SELECT "id" FROM "ArchiveBackupState" WHERE "id" = ${id} FOR UPDATE`; locked(); await gate; });
    await ready;
    const heartbeat = store.heartbeat(waiting, new Date(0));
    await new Promise(resolve => setTimeout(resolve, 110)); release(); await blocker;
    assert.equal(await heartbeat, false, "a heartbeat queued before expiry cannot revive the lease after expiry");
  } finally { await db.archiveBackupState.deleteMany({ where: { id } }); await db.$disconnect(); }
});
