import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { before, after, test } from "node:test";

const databaseUrl = process.env.EMAIL_WORKFLOW_TEST_DATABASE_URL;
const enabled = Boolean(databaseUrl);
const prefix = `mail-action-test-${Date.now()}`;
const messages: string[] = [];
const boardIds = new Set<string>();
let db: (typeof import("./prisma"))["prisma"];
let workflow: typeof import("./email-workflow");
let schemaReady = false;

before(async () => {
  if (!databaseUrl) return;
  let url: URL;
  try { url = new URL(databaseUrl); } catch { throw new Error("Mail action tests require a valid disposable loopback database URL"); }
  assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) && /test/i.test(url.pathname), "Mail action tests require a disposable loopback database named test");
  process.env.DATABASE_URL = databaseUrl;
  process.env.GMAIL_APP_PASSWORD = "";
  process.env.GOOGLE_SERVICE_ACCOUNT_KEY = "";
  process.env.GOOGLE_CALENDAR_ID = "";
  workflow = await import("./email-workflow");
  db = (await import("./prisma")).prisma;
  try {
    await db.emailLog.findFirst({ where: { id: "no-mail-fixture" }, select: { leaseToken: true, leaseExpiresAt: true } });
    await db.emailIntakeAction.count({ where: { id: "no-mail-fixture" } });
    schemaReady = true;
  } catch { throw new Error("Disposable database is missing durable Mail Room tables; apply the local test schema first"); }
});

after(async () => {
  if (!db) return;
  if (!schemaReady) { await db.$disconnect(); return; }
  await db.emailIntakeAction.deleteMany({ where: { messageId: { in: messages } } });
  await db.emailLog.deleteMany({ where: { messageId: { in: messages } } });
  await db.bulletinMessage.deleteMany({ where: { id: { in: Array.from(boardIds) } } });
  await db.$disconnect();
});

async function message(tag: string) {
  const messageId = `${prefix}-${tag}`;
  const leaseToken = randomUUID();
  await db.emailLog.create({ data: { messageId, fromEmail: `${prefix}@example.test`, receivedAt: new Date(),
    status: "processing", leaseToken, leaseExpiresAt: new Date(Date.now() + 600000) } });
  messages.push(messageId);
  return { messageId, leaseToken };
}

function action(input: { messageId: string; leaseToken: string }, createCount: { value: number }) {
  return { ...input, kind: "bulletin", identity: "fixture-note",
    create: async (tx: import("@prisma/client").Prisma.TransactionClient) => {
      createCount.value++;
      const entity = await tx.bulletinMessage.create({ data: { author: prefix, content: input.messageId } });
      boardIds.add(entity.id);
      return { entity };
    },
    find: (tx: import("@prisma/client").Prisma.TransactionClient, id: string) => tx.bulletinMessage.findUnique({ where: { id } }),
  };
}

test("a lost response reuses the committed native record and receipt", { skip: !enabled }, async () => {
  const input = await message("lost-response"), count = { value: 0 };
  const first = await workflow.commitEmailAction(action(input, count));
  const replay = await workflow.commitEmailAction(action(input, count));
  assert.equal(first.reused, false); assert.equal(replay.reused, true);
  assert.ok(first.entity && replay.entity && first.entity.id === replay.entity.id);
  assert.equal(count.value, 1);
  assert.equal(await db.emailIntakeAction.count({ where: { messageId: input.messageId } }), 1);
  assert.equal(await db.bulletinMessage.count({ where: { author: prefix, content: input.messageId } }), 1);
});

test("native record and action receipt roll back together on interrupted creation", { skip: !enabled }, async () => {
  const input = await message("interrupted"), count = { value: 0 };
  const create = action(input, count);
  await assert.rejects(workflow.commitEmailAction({ ...create, create: async (tx) => {
    await create.create(tx);
    throw new Error("Simulated interruption inside the transaction");
  } }));
  assert.equal(await db.bulletinMessage.count({ where: { author: prefix, content: input.messageId } }), 0);
  assert.equal(await db.emailIntakeAction.count({ where: { messageId: input.messageId } }), 0);
  const retry = await workflow.commitEmailAction(create);
  assert.ok(retry.entity); assert.equal(retry.reused, false);
  assert.equal(await db.emailIntakeAction.count({ where: { messageId: input.messageId } }), 1);
});

test("concurrent attempts with the same lease and action cannot duplicate records", { skip: !enabled }, async () => {
  const input = await message("concurrent"), count = { value: 0 };
  const results = await Promise.all(Array.from({ length: 5 }, () => workflow.commitEmailAction(action(input, count))));
  assert.equal(results.filter((result) => !result.reused).length, 1);
  assert.equal(count.value, 1);
  assert.equal(new Set(results.map((result) => result.entity?.id)).size, 1);
});

test("expired and replaced leases cannot write, while a new lease can resume the receipt", { skip: !enabled }, async () => {
  const input = await message("lease-replaced"), count = { value: 0 };
  const first = await workflow.commitEmailAction(action(input, count));
  await db.emailLog.update({ where: { messageId: input.messageId }, data: { leaseExpiresAt: new Date(Date.now() - 1000) } });
  await assert.rejects(workflow.commitEmailAction(action(input, count)), workflow.EmailLeaseError);
  const replacement = { ...input, leaseToken: randomUUID() };
  await db.emailLog.update({ where: { messageId: input.messageId }, data: { leaseToken: replacement.leaseToken, leaseExpiresAt: new Date(Date.now() + 600000) } });
  await assert.rejects(workflow.commitEmailAction(action(input, count)), workflow.EmailLeaseError);
  const resumed = await workflow.commitEmailAction(action(replacement, count));
  assert.equal(resumed.reused, true); assert.ok(resumed.entity && first.entity && resumed.entity.id === first.entity.id);
  assert.equal(count.value, 1);
});

test("a family-deleted record is not resurrected when an email attempt resumes", { skip: !enabled }, async () => {
  const input = await message("family-deleted"), count = { value: 0 };
  const saved = await workflow.commitEmailAction(action(input, count));
  assert.ok(saved.entity);
  await db.bulletinMessage.delete({ where: { id: saved.entity!.id } });
  const resumed = await workflow.commitEmailAction(action(input, count));
  assert.equal(resumed.reused, true); assert.equal(resumed.entity, null); assert.equal(count.value, 1);
  assert.equal(await db.emailIntakeAction.count({ where: { messageId: input.messageId } }), 1);
});

test("a no-op duplicate outcome is durable and never turns into a later creation", { skip: !enabled }, async () => {
  const input = await message("no-op"), count = { value: 0 };
  const base = action(input, count);
  const first = await workflow.commitEmailAction({ ...base, create: async () => ({ entity: null, kind: "known_duplicate" }) });
  const resumed = await workflow.commitEmailAction(base);
  assert.equal(first.kind, "known_duplicate"); assert.equal(resumed.kind, "known_duplicate");
  assert.equal(resumed.reused, true); assert.equal(resumed.entity, null); assert.equal(count.value, 0);
});
