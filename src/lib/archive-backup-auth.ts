import { timingSafeEqual } from "node:crypto";

export function authorizedArchiveBackupRequest(request: Request): boolean {
  const expected = process.env.ARCHIVE_BACKUP_TOKEN;
  if (!expected || !/^[A-Za-z0-9_-]{43,256}$/.test(expected)) return false;
  // This credential cannot be reused from the family, maintenance or worker
  // lanes, even if deployment settings accidentally assign the same value.
  if ([process.env.SITE_MAINTENANCE_TOKEN, process.env.BUCKY_WORKER_TOKEN, process.env.AUTH_SECRET].includes(expected)) return false;
  const actual = request.headers.get("authorization")?.match(/^Bearer ([A-Za-z0-9_-]{43,256})$/)?.[1];
  return Boolean(actual && actual.length === expected.length && timingSafeEqual(Buffer.from(actual), Buffer.from(expected)));
}
