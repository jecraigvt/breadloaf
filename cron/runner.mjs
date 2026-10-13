import { schedulerSettings, runSchedulerTick } from './core.mjs';

// Railway skips overlapping cron jobs. Always exit well before the next tick.
const deadline = setTimeout(() => {
  console.error(JSON.stringify({ scheduler: 'failed', reason: 'deadline' })); process.exit(1);
}, 300000);
let exitCode = 1;
try {
  const result = await runSchedulerTick(schedulerSettings(process.env));
  console.log(JSON.stringify(result)); exitCode = result.failed ? 1 : 0;
} catch {
  console.error(JSON.stringify({ scheduler: 'failed', reason: 'configuration' }));
} finally {
  clearTimeout(deadline);
  // Close any HTTP keepalive resources; never leave a cron deployment active.
  process.exit(exitCode);
}
