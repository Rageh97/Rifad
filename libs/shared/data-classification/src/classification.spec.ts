import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DomainError } from '@rifad/kernel';
import { classesIn, createOutboundGuard, type ClassificationSchema } from './index';

// Synthetic processors and regions only; real processors/regions await decision G07.
const guard = createOutboundGuard([
  { processor: 'synthetic-media-cdn', purpose: 'public product media', allowedClasses: ['public'], regions: ['region-a', 'region-b'] },
  { processor: 'synthetic-ai', purpose: 'menu text drafting', allowedClasses: ['public', 'internal'], regions: ['region-a'] },
]);
const schema: ClassificationSchema = { productName: 'public', costNote: 'internal', customerPhone: 'personal', healthNote: 'sensitive', tenderTotal: 'financial' };

const rejection = (fn: () => void) => {
  try { fn(); } catch (error) { return error instanceof DomainError ? [error.code, error.category] : ['OTHER']; }
  return ['ALLOWED'];
};

test('allowed class and region combinations pass', () => {
  assert.deepEqual(rejection(() => guard.assertAllowed({ processor: 'synthetic-media-cdn', region: 'region-b', payload: { productName: 'Kabsa' }, schema })), ['ALLOWED']);
  assert.deepEqual(rejection(() => guard.assertAllowed({ processor: 'synthetic-ai', region: 'region-a', payload: { productName: 'Kabsa', costNote: 'x', customerPhone: undefined }, schema })), ['ALLOWED']);
});

test('AI/storage adapters reject forbidden data class or region combinations', () => {
  for (const field of ['customerPhone', 'healthNote', 'tenderTotal']) {
    assert.deepEqual(rejection(() => guard.assertAllowed({ processor: 'synthetic-ai', region: 'region-a', payload: { productName: 'Kabsa', [field]: 'synthetic' }, schema })), ['DATA_CLASS_FORBIDDEN', 'forbidden'], field);
  }
  assert.deepEqual(rejection(() => guard.assertAllowed({ processor: 'synthetic-media-cdn', region: 'region-a', payload: { costNote: 'x' }, schema })), ['DATA_CLASS_FORBIDDEN', 'forbidden']);
  assert.deepEqual(rejection(() => guard.assertAllowed({ processor: 'synthetic-ai', region: 'region-b', payload: { productName: 'Kabsa' }, schema })), ['PROCESSOR_REGION_FORBIDDEN', 'forbidden']);
});

test('default deny for unknown processors and unclassified fields', () => {
  assert.deepEqual(rejection(() => guard.assertAllowed({ processor: 'unregistered', region: 'region-a', payload: {}, schema })), ['PROCESSOR_NOT_APPROVED', 'forbidden']);
  assert.deepEqual(rejection(() => guard.assertAllowed({ processor: 'synthetic-media-cdn', region: 'region-a', payload: { productName: 'Kabsa', email: 'x' }, schema })), ['DATA_UNCLASSIFIED', 'forbidden']);
  assert.deepEqual(rejection(() => classesIn({ toString: 'x' }, schema)), ['DATA_UNCLASSIFIED', 'forbidden']);
  assert.deepEqual(rejection(() => createOutboundGuard([]).assertAllowed({ processor: 'synthetic-ai', region: 'region-a', payload: {}, schema })), ['PROCESSOR_NOT_APPROVED', 'forbidden']);
});

test('rejection messages do not echo payload values', () => {
  const canary = ['synthetic', 'personal', 'value'].join('-');
  try { guard.assertAllowed({ processor: 'synthetic-ai', region: 'region-a', payload: { customerPhone: canary }, schema }); assert.fail('must reject'); }
  catch (error) { assert.ok(!String(error).includes(canary)); }
});

test('policies are validated and immutable after registration', () => {
  assert.throws(() => createOutboundGuard([{ processor: '', purpose: 'x', allowedClasses: [], regions: [] }]), TypeError);
  assert.throws(() => createOutboundGuard([{ processor: 'a', purpose: 'x', allowedClasses: [], regions: [] }, { processor: 'a', purpose: 'y', allowedClasses: [], regions: [] }]), TypeError);
  assert.throws(() => createOutboundGuard([{ processor: 'a', purpose: 'x', allowedClasses: ['secret' as never], regions: [] }]), TypeError);
  const regions = ['region-a'];
  const mutable = createOutboundGuard([{ processor: 'a', purpose: 'x', allowedClasses: ['public'], regions }]);
  regions.push('region-z');
  assert.deepEqual(rejection(() => mutable.assertAllowed({ processor: 'a', region: 'region-z', payload: {}, schema })), ['PROCESSOR_REGION_FORBIDDEN', 'forbidden']);
});
