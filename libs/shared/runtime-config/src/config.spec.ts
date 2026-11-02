import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ConfigError, loadConfig } from './index';

test('separate immutable local runtime defaults', () => {
  assert.equal(loadConfig('api', {}).port, 3000);
  assert.equal(loadConfig('edge', {}).port, 3001);
  assert.equal(loadConfig('worker', {}).port, 3002);
  assert.ok(Object.isFrozen(loadConfig('edge', {})));
});

test('accepts explicit synthetic configuration and unrelated OS variables', () => {
  assert.deepEqual(loadConfig('edge', { RIFAD_ENV: 'test', RIFAD_RUNTIME: 'edge', RIFAD_PORT: '65535', PATH: 'ignored' }),
    { runtime: 'edge', environment: 'test', host: '127.0.0.1', port: 65535 });
});

test('rejects malformed ports and unsupported environments without values', () => {
  for (const value of ['0', '-1', '65536', '1.5', ' 3000', '3000abc', '', '03000', '1e3']) {
    assert.throws(() => loadConfig('edge', { RIFAD_PORT: value }), ConfigError);
  }
  for (const env of [{ RIFAD_ENV: 'production' }, { RIFAD_ENV: 'staging' }, { NODE_ENV: 'production' }, { RIFAD_RUNTIME: 'api' }, { RIFAD_HOST: '0.0.0.0' }]) {
    assert.throws(() => loadConfig('edge', env), ConfigError);
  }
});

test('rejects unknown owned settings and does not echo secrets or keys', () => {
  const canary = ['synthetic', 'sensitive', 'value'].join('-');
  for (const env of [{ RIFAD_PORT: canary }, { [`RIFAD_${canary}`]: canary }]) {
    try { loadConfig('edge', env); assert.fail('must reject'); }
    catch (error) { assert.ok(error instanceof ConfigError); assert.ok(!String(error).includes(canary)); }
  }
});

test('Cloud runtimes accept only loopback local database URLs; Edge never accepts one', () => {
  // Assembled so secret scanning does not treat the synthetic fixture as a credential.
  const url = ['postgres://rifad_app', 'synthetic@127.0.0.1:55432/rifad'].join(':');
  assert.equal(loadConfig('api', { RIFAD_DATABASE_URL: url }).databaseUrl, url);
  assert.equal(loadConfig('worker', { RIFAD_DATABASE_URL: url.replace('postgres:', 'postgresql:') }).databaseUrl?.startsWith('postgresql:'), true);
  assert.equal('databaseUrl' in loadConfig('api', {}), false);
  assert.throws(() => loadConfig('edge', { RIFAD_DATABASE_URL: url }), ConfigError);
  const canary = ['synthetic', 'db', 'secret'].join('-');
  for (const value of [
    `postgres://rifad_app:${canary}@db.example.com:5432/rifad`, `postgres://rifad_app:${canary}@10.0.0.5:5432/rifad`,
    `postgres://rifad_app:${canary}@127.0.0.1/rifad`, `postgres://rifad_app:${canary}@127.0.0.1:5432/`, `postgres://rifad_app:${canary}@127.0.0.1:5432/rifad?sslmode=disable`,
    `mysql://rifad_app:${canary}@127.0.0.1:3306/rifad`, `postgres://:${canary}@127.0.0.1:5432/rifad`, canary,
  ]) {
    try { loadConfig('api', { RIFAD_DATABASE_URL: value }); assert.fail('must reject ' + value.split('@')[1]); }
    catch (error) { assert.ok(error instanceof ConfigError); assert.equal(error.field, 'RIFAD_DATABASE_URL'); assert.ok(!String(error).includes(canary)); }
  }
});

test('only the worker accepts relay database and queue Redis URLs, loopback only', () => {
  const relay = ['postgres://rifad_relay', 'synthetic@127.0.0.1:55432/rifad'].join(':');
  const redis = ['redis://', 'synthetic@127.0.0.1:56379/0'].join(':');
  const worker = loadConfig('worker', { RIFAD_RELAY_DATABASE_URL: relay, RIFAD_QUEUE_REDIS_URL: redis });
  assert.equal(worker.relayDatabaseUrl, relay);
  assert.equal(worker.queueRedisUrl, redis);
  for (const runtime of ['api', 'edge'] as const) {
    assert.throws(() => loadConfig(runtime, { RIFAD_QUEUE_REDIS_URL: redis }), ConfigError);
    assert.throws(() => loadConfig(runtime, { RIFAD_RELAY_DATABASE_URL: relay }), ConfigError);
  }
  const canary = ['synthetic', 'redis', 'secret'].join('-');
  for (const value of [`redis://:${canary}@cache.example.com:6379`, `redis://:${canary}@127.0.0.1`, `rediss://:${canary}@127.0.0.1:6379`, `redis://:${canary}@127.0.0.1:6379/16`, `redis://:${canary}@127.0.0.1:6379/?db=1`]) {
    try { loadConfig('worker', { RIFAD_QUEUE_REDIS_URL: value }); assert.fail('must reject'); }
    catch (error) { assert.ok(error instanceof ConfigError); assert.equal(error.field, 'RIFAD_QUEUE_REDIS_URL'); assert.ok(!String(error).includes(canary)); }
  }
  assert.throws(() => loadConfig('worker', { RIFAD_RELAY_DATABASE_URL: relay.replace('127.0.0.1', '10.1.2.3') }), (error: ConfigError) => error.field === 'RIFAD_RELAY_DATABASE_URL');
});
