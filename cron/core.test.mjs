import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'node:http';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { schedulerSettings, latestWeeklyBoundary, backupDecision, runSchedulerTick } from './core.mjs';

const env = { SITE_HOUSEKEEPING_ENABLED: 'true', ARCHIVE_BACKUP_ENABLED: 'true', SITE_MAINTENANCE_TOKEN: 'm'.repeat(43), ARCHIVE_BACKUP_TOKEN: 'b'.repeat(43) };
const settings = schedulerSettings(env);
const now = new Date('2026-10-18T10:00:00Z');
const healthy = { mail: { configured: true, received: 0, processed: 0, waiting: 0, errors: 0 },
  calendar: { created: 0, updated: 0, deleted: 0, pushAttempted: 0, pushSynced: 0, pushFailed: 0, unavailable: false }, cleanupFailed: false };
const status = (changes = {}) => ({ state: 'verified', due: false, copyVerified: true, restoreVerified: false,
  startedAt: '2026-10-13T12:00:00Z', lastSuccessAt: '2026-10-13T12:01:00Z', lastFailureAt: null, ...changes });
const json = (value, code = 200) => Response.json(value, { status: code });
function provider({ operations = healthy, operationsStatus = 200, backup = status(), start = { accepted: true, state: 'running', restoreVerified: false }, startStatus = 202, lostStart = false } = {}) {
  const calls = [];
  const fetcher = async (url, init) => {
    calls.push({ url, init });
    assert.equal(new URL(url).origin, 'https://breadloafhill.com'); assert.equal(init.redirect, 'error'); assert.equal(init.cache, 'no-store'); assert.ok(init.signal);
    const housekeeping = url.endsWith('/api/operations/run');
    assert.equal(init.headers.Authorization, `Bearer ${housekeeping ? env.SITE_MAINTENANCE_TOKEN : env.ARCHIVE_BACKUP_TOKEN}`);
    if (housekeeping) { assert.equal(init.method, 'POST'); return json(operations, operationsStatus); }
    assert.ok(url.endsWith('/api/archive/backup'));
    if (init.method === 'GET') return json(backup);
    assert.equal(init.method, 'POST');
    if (lostStart) throw new Error('PRIVATE provider details and credential');
    return json(start, startStatus);
  };
  return { calls, fetcher };
}

test('weekly due boundaries use UTC and catch missed Sunday runs without relying on exact start minutes', () => {
  assert.equal(latestWeeklyBoundary(new Date('2026-10-18T09:59:59.999Z')).toISOString(), '2026-10-11T10:00:00.000Z');
  assert.equal(latestWeeklyBoundary(now).toISOString(), '2026-10-18T10:00:00.000Z');
  const old = status({ due: true, lastSuccessAt: '2026-10-11T10:30:00Z' });
  assert.equal(backupDecision(old, new Date('2026-10-18T09:59:00Z')).action, 'skip');
  assert.equal(backupDecision(old, now).action, 'start');
  assert.equal(backupDecision(old, new Date('2026-10-19T14:20:00Z')).action, 'start');
  assert.equal(backupDecision(status({ due: true, lastSuccessAt: '2026-10-18T10:20:00Z' }), new Date('2026-10-24T20:00:00Z')).action, 'skip');
  // The application's six-day floor remains authoritative during first setup.
  assert.equal(backupDecision(status(), now).action, 'skip');
});

test('running backup leases and recent failures prevent duplicate starts or rapid expensive retries', () => {
  const old = { due: true, lastSuccessAt: '2026-10-11T10:30:00Z' };
  assert.equal(backupDecision(status({ ...old, state: 'running' }), now).action, 'monitor');
  const failed = status({ ...old, state: 'failed', lastFailureAt: '2026-10-18T09:00:00Z' });
  assert.deepEqual(backupDecision(failed, now), { action: 'skip', state: 'failed' });
  assert.equal(backupDecision(failed, new Date('2026-10-18T15:00:00Z')).action, 'start');
  assert.equal(backupDecision(status({ ...old, state: 'interrupted', lastFailureAt: null, startedAt: '2026-10-18T09:00:00Z' }), now).action, 'skip');
});

test('only separate scoped tokens are accepted, and paused lanes have no credential or network requirement', async () => {
  assert.throws(() => schedulerSettings({ ...env, ARCHIVE_BACKUP_TOKEN: env.SITE_MAINTENANCE_TOKEN }));
  for (const key of ['SITE_MAINTENANCE_TOKEN', 'ARCHIVE_BACKUP_TOKEN']) assert.throws(() => schedulerSettings({ ...env, [key]: '' }));
  for (const key of ['DATABASE_URL', 'GMAIL_APP_PASSWORD', 'ARCHIVE_DRIVE_REFRESH_TOKEN', 'ARCHIVE_BACKUP_PASSPHRASE', 'AUTH_SECRET', 'OPENAI_API_KEY']) {
    assert.throws(() => schedulerSettings({ ...env, [key]: 'PRIVATE synthetic credential' }));
  }
  const result = await runSchedulerTick(schedulerSettings({}), { fetcher: async () => { throw new Error('Paused lanes must not call a provider'); }, now });
  assert.equal(result.failed, false); assert.equal(result.housekeeping.state, 'disabled'); assert.equal(result.backup.state, 'disabled');
});

test('an idle tick makes one housekeeping POST and one backup status GET with token isolation and scrubbed output', async () => {
  const fake = provider({ operations: { ...healthy, privateName: 'PRIVATE personal details' }, backup: status({ lastError: 'PRIVATE provider body' }) });
  const result = await runSchedulerTick(settings, { fetcher: fake.fetcher, now });
  assert.equal(result.failed, false); assert.equal(result.housekeeping.state, 'ok'); assert.equal(result.backup.state, 'current');
  assert.equal(fake.calls.length, 2); assert.equal(JSON.stringify(result).includes('PRIVATE'), false);
  assert.equal(JSON.stringify(result).includes(env.SITE_MAINTENANCE_TOKEN), false);
});

test('one due start exits as running, and the following tick monitors without issuing another POST', async () => {
  const fake = provider({ backup: status({ due: true, lastSuccessAt: '2026-10-11T10:30:00Z' }) });
  const result = await runSchedulerTick(settings, { fetcher: fake.fetcher, now });
  assert.deepEqual(result.backup, { state: 'running', started: true, restoreVerified: false });
  assert.equal(fake.calls.filter(call => call.init.method === 'POST' && call.url.endsWith('/api/archive/backup')).length, 1);
  const following = provider({ backup: status({ due: true, state: 'running' }) });
  assert.equal((await runSchedulerTick(settings, { fetcher: following.fetcher, now })).backup.state, 'running');
  assert.equal(following.calls.length, 2);
  const raced = provider({ backup: status({ due: true, lastSuccessAt: '2026-10-11T10:30:00Z' }), start: { accepted: false, reason: 'busy', state: 'running', restoreVerified: false } });
  assert.equal((await runSchedulerTick(settings, { fetcher: raced.fetcher, now })).backup.started, false);
});

test('housekeeping failure does not suppress backup monitoring, and HTTP200 cannot conceal reported failures', async () => {
  for (const changes of [{ cleanupFailed: true }, { mail: { ...healthy.mail, errors: 1 } }, { mail: { ...healthy.mail, configured: false } },
    { calendar: { ...healthy.calendar, pushFailed: 1 } }, { calendar: { ...healthy.calendar, unavailable: true } }]) {
    const fake = provider({ operations: { ...healthy, ...changes } });
    const result = await runSchedulerTick(settings, { fetcher: fake.fetcher, now });
    assert.equal(result.failed, true); assert.equal(result.housekeeping.state, 'failed'); assert.equal(fake.calls.length, 2);
  }
  const fake = provider({ operationsStatus: 503 });
  assert.equal((await runSchedulerTick(settings, { fetcher: fake.fetcher, now })).housekeeping.httpStatus, 503);
});

test('lost start responses, malformed status and failed backup state remain failures without another attempt', async () => {
  const due = status({ due: true, lastSuccessAt: '2026-10-11T10:30:00Z' });
  for (const changes of [{ lostStart: true }, { startStatus: 503 }, { start: { state: 'running' } }]) {
    const fake = provider({ backup: due, ...changes });
    const result = await runSchedulerTick(settings, { fetcher: fake.fetcher, now });
    assert.equal(result.failed, true); assert.equal(result.backup.state, 'failed');
    assert.equal(fake.calls.filter(call => call.init.method === 'POST' && call.url.endsWith('/api/archive/backup')).length, 1);
    assert.equal(JSON.stringify(result).includes('PRIVATE'), false);
  }
  for (const backup of [{ ...due, state: 'PRIVATE unknown state' }, status({ state: 'failed', lastFailureAt: '2026-10-18T09:00:00Z' })]) {
    const fake = provider({ backup });
    assert.equal((await runSchedulerTick(settings, { fetcher: fake.fetcher, now })).failed, true); assert.equal(fake.calls.length, 2);
  }
});

test('native redirects do not forward scoped credentials and oversized bodies are bounded', async () => {
  let redirects = 0;
  const server = createServer((request, response) => {
    if (request.url === '/other') { redirects++; response.end('unexpected'); }
    else { response.writeHead(302, { Location: '/other' }); response.end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  try {
    const result = await runSchedulerTick(settings, { now, fetcher: (_url, init) => fetch(`http://127.0.0.1:${address.port}/redirect`, init) });
    assert.equal(result.failed, true); assert.equal(redirects, 0);
  } finally { await new Promise(resolve => server.close(resolve)); }
  assert.equal((await runSchedulerTick(settings, { now, fetcher: async () => new Response('x'.repeat(32769)) })).failed, true);
});

test('the actual paused runner exits promptly without a server, database or open-resource loop', () => {
  const child = spawnSync(process.execPath, [fileURLToPath(new URL('./runner.mjs', import.meta.url))], {
    env: { SYSTEMROOT: process.env.SYSTEMROOT, PATH: process.env.PATH, SITE_HOUSEKEEPING_ENABLED: 'false', ARCHIVE_BACKUP_ENABLED: 'false' },
    encoding: 'utf8', timeout: 5000,
  });
  assert.equal(child.status, 0); assert.equal(child.error, undefined);
  const result = JSON.parse(child.stdout); assert.equal(result.failed, false); assert.equal(result.housekeeping.state, 'disabled');
});
