import assert from 'node:assert/strict';
import { test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { createRequestContext, runWithContext } from '@rifad/request-context';
import { REDACTED, createLogger, redact, type LogLevel } from './index';

const canary = ['synthetic', 'secret', 'canary'].join('-');
// Published test card number (Luhn-valid); never a real card.
const testPan = ['4111', '1111', '1111', '1111'].join('');

function capture(minLevel?: LogLevel) {
  const lines: { level: LogLevel; entry: Record<string, unknown>; raw: string }[] = [];
  const logger = createLogger({ runtime: 'test', ...(minLevel ? { minLevel } : {}), now: () => new Date('2026-11-02T00:00:00Z'), sink: (level, raw) => lines.push({ level, raw, entry: JSON.parse(raw) }) });
  return { logger, lines };
}

test('writes one JSON line with UTC time, level, runtime, event and caller fields', () => {
  const { logger, lines } = capture();
  logger.info('runtime.started', { port: 3001, ready: true });
  assert.equal(lines.length, 1);
  assert.deepEqual(lines[0]?.entry, { port: 3001, ready: true, time: '2026-11-02T00:00:00.000Z', level: 'info', runtime: 'test', event: 'runtime.started' });
  assert.ok(!lines[0]?.raw.includes('\n'));
});

test('attaches the active request context so one correlation ID finds the whole path', async () => {
  const { logger, lines } = capture();
  const context = createRequestContext({ correlationId: 'pos-7:42', organizationId: 'org-1', branchId: 'branch-1' });
  await runWithContext(context, async () => { await delay(1); logger.info('http.request.completed'); });
  logger.info('outside.context');
  assert.equal(lines[0]?.entry['correlationId'], 'pos-7:42');
  assert.equal(lines[0]?.entry['requestId'], context.requestId);
  assert.equal(lines[0]?.entry['branchId'], 'branch-1');
  assert.equal('correlationId' in (lines[1]?.entry ?? {}), false);
});

test('redacts credential, session and card-data keys at any depth', () => {
  const { logger, lines } = capture();
  logger.info('probe', {
    password: canary, apiKey: canary, Authorization: 'Bearer ' + canary, nested: { refreshToken: canary, list: [{ cardNumber: canary, cvv: canary }] },
    cashierPin: canary, pinCode: canary, cookie: canary, clientSecret: canary, ok: 'visible',
  });
  const raw = lines[0]?.raw ?? '';
  assert.ok(!raw.includes(canary), raw);
  assert.equal(lines[0]?.entry['ok'], 'visible');
  assert.equal(lines[0]?.entry['password'], REDACTED);
});

test('masks Luhn-valid card numbers inside free text but keeps ordinary numbers', () => {
  const { logger, lines } = capture();
  logger.info('probe', { note: 'paid with ' + testPan, spaced: '4111 1111 1111 1111', orderNumber: '1234567890123', amount: '12.50' });
  const entry = lines[0]?.entry ?? {};
  assert.equal(entry['note'], 'paid with ' + REDACTED);
  assert.equal(entry['spaced'], REDACTED);
  assert.equal(entry['orderNumber'], '1234567890123');
  assert.ok(!(lines[0]?.raw ?? '').includes(testPan));
});

test('errors log only name and code, never message, stack, SQL or values', () => {
  const { logger, lines } = capture();
  const error = Object.assign(new Error(`SELECT * FROM users WHERE token='${canary}'`), { code: 'DB_FAILED' });
  logger.error('db.failed', { error });
  assert.deepEqual(lines[0]?.entry['error'], { name: 'Error', code: 'DB_FAILED' });
  assert.ok(!/select|canary| at /i.test(lines[0]?.raw ?? ''));
  assert.equal(lines[0]?.level, 'error');
});

test('caller fields cannot overwrite reserved fields or forge context', () => {
  const { logger, lines } = capture();
  runWithContext(createRequestContext({ correlationId: 'real' }), () => logger.info('probe', { level: 'debug', event: 'forged', runtime: 'forged', correlationId: 'forged', time: 'forged' }));
  const entry = lines[0]?.entry ?? {};
  assert.deepEqual([entry['level'], entry['event'], entry['runtime'], entry['correlationId'], entry['time']], ['info', 'probe', 'test', 'real', '2026-11-02T00:00:00.000Z']);
});

test('output is bounded for large, deep and circular values', () => {
  const circular: Record<string, unknown> = { name: 'loop' };
  circular['self'] = circular;
  let deep: Record<string, unknown> = { leaf: true };
  for (let index = 0; index < 10; index++) deep = { child: deep };
  const sanitized = redact({ circular, deep, long: 'x'.repeat(5000), many: Array.from({ length: 80 }, (_, index) => index), wide: Object.fromEntries(Array.from({ length: 70 }, (_, index) => ['k' + index, index])), big: 10n, nan: Number.NaN, fn: () => 1, undef: undefined });
  const raw = JSON.stringify(sanitized);
  assert.ok(raw.includes('[circular]') && raw.includes('[depth-limit]') && raw.includes('[truncated]') && raw.includes('[+30 items]'));
  assert.ok(raw.length < 4000);
  assert.equal((sanitized['many'] as unknown[]).length, 51);
  assert.equal(sanitized['big'], '10');
  assert.equal(sanitized['nan'], 'NaN');
  assert.equal(sanitized['fn'], '[function]');
});

test('honors the minimum level and rejects malformed event names', () => {
  const { logger, lines } = capture('warn');
  logger.info('ignored');
  logger.debug('ignored');
  logger.warn('kept');
  assert.deepEqual(lines.map(line => line.entry['event']), ['kept']);
  for (const event of ['', 'Upper.case', 'with space', 'trailing.', '.leading', canary]) assert.throws(() => logger.warn(event), TypeError, event);
});
