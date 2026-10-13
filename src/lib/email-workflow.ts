import { createHash } from "node:crypto";
import type { EmailLog, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

export const EMAIL_LEASE_MS = 10 * 60 * 1000;
export const MAX_EMAIL_ATTEMPTS = 5;
export const TERMINAL_EMAIL_STATUSES = ["completed", "quarantined", "dismissed", "ignored"];

export class EmailLeaseError extends Error {}
export function assertEmailLease(row: Pick<EmailLog, "status" | "leaseToken" | "leaseExpiresAt"> | null, token: string, now = new Date()): void {
  if (!row || row.status !== "processing" || row.leaseToken !== token || !row.leaseExpiresAt || row.leaseExpiresAt <= now) {
    throw new EmailLeaseError("This Mail Room attempt no longer owns the message");
  }
}

export function emailActionKey(messageId: string, kind: string, identity: string): string {
  return createHash("sha256").update(JSON.stringify([messageId, kind, identity])).digest("hex");
}

export function emailRetryAt(attempts: number, now = new Date()): Date {
  return new Date(now.getTime() + Math.min(60, 2 ** Math.max(0, attempts - 1)) * 60 * 1000);
}

/** Native record + receipt commit together; a lost response or crash cannot repeat the action. */
export async function commitEmailAction<T extends { id: string }>(input: {
  messageId: string; leaseToken: string; kind: string; identity: string;
  create(tx: Prisma.TransactionClient): Promise<{ entity: T | null; kind?: string }>;
  find(tx: Prisma.TransactionClient, id: string): Promise<T | null>;
}, database: Pick<typeof prisma, "$transaction"> = prisma): Promise<{ entity: T | null; reused: boolean; kind: string }> {
  return database.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "EmailLog" WHERE "messageId" = ${input.messageId} FOR UPDATE`;
    const email = await tx.emailLog.findUnique({ where: { messageId: input.messageId } });
    assertEmailLease(email, input.leaseToken);
    const actionKey = emailActionKey(input.messageId, input.kind, input.identity);
    const existing = await tx.emailIntakeAction.findUnique({ where: { actionKey } });
    if (existing) return { entity: existing.entityId ? await input.find(tx, existing.entityId) : null, reused: true, kind: existing.kind };
    const result = await input.create(tx);
    const kind = result.kind || input.kind;
    await tx.emailIntakeAction.create({ data: { actionKey, messageId: input.messageId, kind, entityId: result.entity?.id || null } });
    return { entity: result.entity, reused: false, kind };
  });
}
