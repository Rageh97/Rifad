import { createRequire } from 'node:module';

// Operator tool for outbox events that exhausted their publish attempts (B006d).
//   pnpm outbox:failed list [--limit 100]
//   pnpm outbox:failed retry --event-id <uuid> [--event-id <uuid> ...]
//   pnpm outbox:failed retry --all-queue-failures
// Runs as the scoped relay role. Local/test only: RIFAD_RELAY_DATABASE_URL must point to a loopback
// server. Run `pnpm build` first. Output is one JSON line; payloads are never printed.
const require = createRequire(import.meta.url);
const [command, ...rest] = process.argv.slice(2).filter(arg => arg !== '--');
const fail = (code, exit = 1) => { console.error(JSON.stringify({ event: 'outbox.failed.error', code })); process.exit(exit); };
const value = process.env.RIFAD_RELAY_DATABASE_URL;
let url;
try { url = new URL(value ?? ''); } catch { url = undefined; }
if (!url || !['postgres:', 'postgresql:'].includes(url.protocol) || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) fail('INVALID_RELAY_URL');
const values = name => rest.flatMap((arg, index) => (arg === name && rest[index + 1] ? [rest[index + 1]] : []));
if (command !== 'list' && command !== 'retry') fail('USAGE', 2);

const { createDatabase } = require('../libs/shared/database/dist/index.js');
const { listFailed, retryFailed } = require('../libs/shared/outbox-relay/dist/index.js');
const database = createDatabase(value, { applicationName: 'rifad-outbox-ops', maxConnections: 1 });
try {
  if (command === 'list') {
    const failed = await listFailed(database.db, Number(values('--limit')[0] ?? 100));
    console.log(JSON.stringify({ event: 'outbox.failed.listed', count: failed.length, failed }));
  } else {
    const eventIds = values('--event-id');
    const all = rest.includes('--all-queue-failures');
    if (eventIds.length && all) fail('USAGE', 2);
    if (!eventIds.length && !all) fail('USAGE', 2);
    const retried = await retryFailed(database.db, all ? { allQueueFailures: true } : { eventIds });
    console.log(JSON.stringify({ event: 'outbox.failed.retried', count: retried.length, eventIds: retried }));
  }
} catch (error) {
  console.error(JSON.stringify({ event: 'outbox.failed.error', code: error?.code ?? error?.name ?? 'FAILED' }));
  process.exitCode = 1;
} finally {
  await database.close();
}
