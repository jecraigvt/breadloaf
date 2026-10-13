const ORIGIN = 'https://breadloafhill.com';
const MAX_RESPONSE_BYTES = 32 * 1024;
const BACKUP_RETRY_MS = 6 * 60 * 60 * 1000;
const BACKUP_STATES = new Set(['never-run', 'idle', 'running', 'verified', 'failed', 'interrupted']);

class RequestFailure extends Error {
  constructor(reason, status) { super('Scheduler request failed'); this.reason = reason; this.status = status; }
}

export function schedulerSettings(env) {
  // This service must never receive application/provider credentials.
  if (Object.entries(env).some(([key, value]) => value && /^(?:DATABASE_|ARCHIVE_DRIVE_|GMAIL_|GOOGLE_|OPENAI_|BUCKY_|AUTH_SECRET$|FAMILY_PINS$|ARCHIVE_BACKUP_PASSPHRASE$)/.test(key))) {
    throw new Error('Invalid scheduler credential configuration');
  }
  const enabled = name => {
    if (env[name] && !['true', 'false'].includes(env[name])) throw new Error('Invalid scheduler activation configuration');
    return env[name] === 'true';
  };
  const housekeeping = enabled('SITE_HOUSEKEEPING_ENABLED'), backup = enabled('ARCHIVE_BACKUP_ENABLED');
  const token = (name, required) => {
    if (required && !/^[A-Za-z0-9_-]{43,256}$/.test(env[name] || '')) throw new Error('Invalid scheduler credential configuration');
    return env[name];
  };
  const maintenanceToken = token('SITE_MAINTENANCE_TOKEN', housekeeping), backupToken = token('ARCHIVE_BACKUP_TOKEN', backup);
  if (housekeeping && backup && maintenanceToken === backupToken) throw new Error('Scheduler credentials must be separate');
  return { housekeeping, backup, maintenanceToken, backupToken };
}

export function latestWeeklyBoundary(now) {
  const boundary = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - now.getUTCDay(), 10));
  if (boundary > now) boundary.setUTCDate(boundary.getUTCDate() - 7);
  return boundary;
}

function date(value) {
  if (value === null) return null;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(value)) throw new RequestFailure('invalid-response');
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) throw new RequestFailure('invalid-response');
  return parsed;
}

function backupStatus(value) {
  if (!value || !BACKUP_STATES.has(value.state) || typeof value.due !== 'boolean' || typeof value.copyVerified !== 'boolean' || value.restoreVerified !== false) throw new RequestFailure('invalid-response');
  const lastSuccessAt = date(value.lastSuccessAt), lastFailureAt = date(value.lastFailureAt), startedAt = date(value.startedAt);
  if (value.copyVerified !== Boolean(lastSuccessAt) || value.state === 'verified' && !value.copyVerified) throw new RequestFailure('invalid-response');
  return { state: value.state, due: value.due, copyVerified: value.copyVerified, lastSuccessAt, lastFailureAt, startedAt };
}

export function backupDecision(value, now) {
  const status = backupStatus(value);
  if (status.state === 'running') return { action: 'monitor', state: 'running' };
  const failed = ['failed', 'interrupted'].includes(status.state);
  const weeklyDue = !status.lastSuccessAt || status.lastSuccessAt < latestWeeklyBoundary(now);
  if (!weeklyDue || !status.due) return { action: 'skip', state: failed ? status.state : 'current' };
  if (failed) {
    const failureAt = status.lastFailureAt || status.startedAt;
    if (!failureAt) throw new RequestFailure('invalid-response');
    if (failureAt.getTime() + BACKUP_RETRY_MS > now.getTime()) return { action: 'skip', state: status.state };
  }
  return { action: 'start', state: 'due' };
}

async function jsonRequest(fetcher, path, token, method, timeoutMs) {
  let response;
  try {
    response = await fetcher(`${ORIGIN}${path}`, { method, headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(timeoutMs) });
    if (![200, 202].includes(response.status)) {
      await response.body?.cancel().catch(() => {});
      throw new RequestFailure('http', response.status);
    }
    if (!response.body || Number(response.headers.get('content-length') || 0) > MAX_RESPONSE_BYTES) {
      await response.body?.cancel().catch(() => {}); throw new RequestFailure('invalid-response');
    }
    const reader = response.body.getReader(), chunks = []; let length = 0;
    try {
      for (;;) {
        const next = await reader.read(); if (next.done) break;
        length += next.value.length; if (length > MAX_RESPONSE_BYTES) throw new RequestFailure('invalid-response');
        chunks.push(Buffer.from(next.value));
      }
    } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
    const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new RequestFailure('invalid-response');
    return { value, status: response.status };
  } catch (error) {
    if (error instanceof RequestFailure) throw error;
    throw new RequestFailure('network-or-response');
  }
}

function count(value) {
  if (!Number.isSafeInteger(value) || value < 0 || value > 10000000) throw new RequestFailure('invalid-response');
  return value;
}
function failure(error) {
  return { state: 'failed', reason: error instanceof RequestFailure ? error.reason : 'invalid-response',
    ...(error instanceof RequestFailure && Number.isInteger(error.status) ? { httpStatus: error.status } : {}) };
}

async function housekeepingTick(settings, fetcher) {
  if (!settings.housekeeping) return { state: 'disabled' };
  try {
    const { value, status } = await jsonRequest(fetcher, '/api/operations/run', settings.maintenanceToken, 'POST', 240000);
    if (status !== 200 || value.mail?.configured !== true || value.calendar?.unavailable !== false || value.cleanupFailed !== false) throw new RequestFailure('reported-failure');
    const mail = { received: count(value.mail.received), processed: count(value.mail.processed), waiting: count(value.mail.waiting), errors: count(value.mail.errors) };
    const calendar = { created: count(value.calendar.created), updated: count(value.calendar.updated), deleted: count(value.calendar.deleted),
      pushAttempted: count(value.calendar.pushAttempted), pushSynced: count(value.calendar.pushSynced), pushFailed: count(value.calendar.pushFailed) };
    return { state: mail.errors || calendar.pushFailed ? 'failed' : 'ok', mail, calendar };
  } catch (error) { return failure(error); }
}

async function backupTick(settings, fetcher, now) {
  if (!settings.backup) return { state: 'disabled' };
  try {
    const { value, status } = await jsonRequest(fetcher, '/api/archive/backup', settings.backupToken, 'GET', 45000);
    if (status !== 200) throw new RequestFailure('invalid-response');
    const decision = backupDecision(value, now);
    if (decision.action !== 'start') return { state: decision.state, copyVerified: value.copyVerified, restoreVerified: false };
    // At most one POST per tick; the application's durable lease fences races.
    const started = await jsonRequest(fetcher, '/api/archive/backup', settings.backupToken, 'POST', 45000);
    if (started.status === 202 && started.value.state === 'running' && typeof started.value.accepted === 'boolean' && started.value.restoreVerified === false) return { state: 'running', started: started.value.accepted, restoreVerified: false };
    if (started.status === 200 && started.value.accepted === false && started.value.reason === 'current') {
      const current = backupStatus(started.value);
      if (current.copyVerified && !current.due) return { state: 'current', copyVerified: true, restoreVerified: false };
    }
    throw new RequestFailure('invalid-response');
  } catch (error) { return failure(error); }
}

/** One process handles one tick and emits only validated counts/status. */
export async function runSchedulerTick(settings, { fetcher = globalThis.fetch, now = new Date() } = {}) {
  const [housekeeping, backup] = await Promise.all([housekeepingTick(settings, fetcher), backupTick(settings, fetcher, now)]);
  return { atUTC: now.toISOString(), housekeeping, backup,
    failed: [housekeeping, backup].some(result => ['failed', 'interrupted'].includes(result.state)) };
}
