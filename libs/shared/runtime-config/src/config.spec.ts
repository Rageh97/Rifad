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
