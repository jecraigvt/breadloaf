export const BUCKY_JOB_KINDS = ["document_analysis", "archive_review", "site_improvement"] as const;
export type BuckyJobKind = (typeof BUCKY_JOB_KINDS)[number];
export const LOCAL_QUOTA_RESERVE = 25;
export const LEASE_DURATION_MS = 5 * 60 * 1000;
export const FALLBACK_DELAY_MS = 24 * 60 * 60 * 1000;
export const MAX_JOB_ATTEMPTS = 5;
export const URGENT_JOB_PRIORITY = 100;

export function quotaAllowsLocalWork(remaining: unknown): remaining is number {
  return typeof remaining === "number" && Number.isFinite(remaining) && remaining > LOCAL_QUOTA_RESERVE && remaining <= 100;
}

export function apiFallbackEligible(job: { priority: number; fallbackAfter: Date }, now: Date): boolean {
  return job.priority >= URGENT_JOB_PRIORITY || job.fallbackAfter <= now;
}

export function configuredCents(value: string | undefined, fallback: number): number {
  if (value === undefined || value.trim() === "") return fallback;
  const amount = Number(value);
  // Invalid configuration must not silently re-enable spending.
  return Number.isSafeInteger(amount) && amount >= 0 ? amount : 0;
}

export function budgetCanReserve(budget: { spentCents: number; reservedCents: number }, amount: number, limit: number): boolean {
  return amount > 0 && budget.spentCents + budget.reservedCents + amount <= limit;
}

export function leaseIsCurrent(
  job: { status: string; generation: number },
  attempt: { status: string; generation: number; leaseExpiresAt: Date } | null,
  now: Date,
): boolean {
  return !!attempt && job.status === "running" && attempt.status === "running" &&
    job.generation === attempt.generation && attempt.leaseExpiresAt > now;
}

export function settlementCents(reservedCents: number, reported?: number): number {
  if (reservedCents === 0) return 0;
  // An interrupted or unmetered attempt may have spent its entire allocation.
  return reported !== undefined && Number.isSafeInteger(reported) && reported >= 0 ? reported : reservedCents;
}

export function authorizedJobSource(job: { sourceDocumentId: string | null; request: unknown }, sourceId?: string): string | undefined {
  if (!sourceId) return undefined; // No part selected: return the authorized job's manifest.
  const part = sourceId.match(/^([^:]+):(text|page):(\d+)$/);
  const documentId = part?.[1] ?? sourceId;
  if (documentId === job.sourceDocumentId) return sourceId;
  const request = job.request as { sourceDocumentIds?: unknown } | null;
  if (Array.isArray(request?.sourceDocumentIds) && request.sourceDocumentIds.includes(documentId)) return sourceId;
  throw new Error("Source is not attached to this job");
}
