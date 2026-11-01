import assert from 'node:assert/strict';
import { test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { RequestContextError, contextFromHeaders, createRequestContext, currentContext, requireContext, runWithContext } from './index';

test('creates immutable contexts with generated request IDs and inherited correlation', () => {
  const context = createRequestContext();
  assert.match(context.requestId, /^[0-9a-f-]{36}$/);
  assert.equal(context.correlationId, context.requestId);
  assert.ok(Object.isFrozen(context));
  const scoped = createRequestContext({ correlationId: 'corr-1', organizationId: 'org-1', branchId: 'branch-1', deviceId: 'pos-1', timezone: 'Asia/Riyadh' });
  assert.equal(scoped.correlationId, 'corr-1');
  assert.equal(scoped.timezone, 'Asia/Riyadh');
  assert.equal('userId' in scoped, false);
});

test('rejects malformed fields without echoing them', () => {
  const canary = ['synthetic', 'secret', 'value'].join('-') + ' \n';
  for (const input of [{ correlationId: canary }, { organizationId: '' }, { branchId: 'a'.repeat(129) }, { timezone: 'Mars/Olympus' }, { userId: 'a/b' }]) {
    try { createRequestContext(input); assert.fail('must reject'); }
    catch (error) { assert.ok(error instanceof RequestContextError); assert.ok(!String(error).includes('synthetic')); }
  }
});

test('HTTP headers supply only a well-formed correlation ID, never identity or tenant scope', () => {
  const accepted = contextFromHeaders({ 'x-correlation-id': 'edge-42:abc', 'x-request-id': 'caller-chosen' });
  assert.equal(accepted.correlationId, 'edge-42:abc');
  assert.notEqual(accepted.requestId, 'caller-chosen');
  const tenantHeaders = contextFromHeaders({ 'x-organization-id': 'org-evil', 'x-branch-id': 'b', 'x-user-id': 'u' });
  assert.deepEqual(Object.keys(tenantHeaders).sort(), ['correlationId', 'requestId']);
  for (const supplied of ['<script>', 'a'.repeat(200), ['one', 'two'], '']) {
    const context = contextFromHeaders({ 'x-correlation-id': supplied });
    assert.equal(context.correlationId, context.requestId);
  }
});

test('context propagates across async boundaries and stays isolated between concurrent runs', async () => {
  assert.equal(currentContext(), undefined);
  assert.throws(() => requireContext(), RequestContextError);
  const seen = await Promise.all(['a', 'b', 'c'].map(id => runWithContext(createRequestContext({ correlationId: id }), async () => {
    await delay(5);
    await Promise.resolve();
    return requireContext().correlationId;
  })));
  assert.deepEqual(seen, ['a', 'b', 'c']);
  assert.equal(currentContext(), undefined);
});
