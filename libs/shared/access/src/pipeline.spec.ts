import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { DomainError } from '@rifad/kernel';
import { IdentityError } from '@rifad/identity-contract';
import { createAccessPipeline, type AccessPorts } from './pipeline';

const organizationId: string = randomUUID();
const branchId: string = randomUUID();
const userId = randomUUID();
const membershipId = randomUUID();
const request = { authorization: 'Bearer synthetic-token', organizationId, branchId, permission: 'checks.read' };

function ports(): AccessPorts {
  return {
    tokens: { verify: async () => ({ issuer: 'https://issuer.example', subject: 'synthetic', sessionId: 'session-1', issuedAt: '2026-11-02T12:00:00.000Z' }) },
    users: { findUserId: async () => userId },
    organizations: {
      findOrganization: async () => ({ organizationId, name: 'Synthetic', status: 'ACTIVE', timezone: 'UTC' }),
      findActiveMembership: async () => ({ membershipId, organizationId, userId, status: 'ACTIVE' }),
      findBranch: async () => ({ organizationId, branchId, name: 'Synthetic', status: 'ACTIVE', timezone: null }),
    },
    entitlements: { isEnabled: async () => true },
    authorization: { isAllowed: async () => true },
  };
}

const denied = (code: string, category: string) => (error: unknown) => error instanceof DomainError && error.code === code && error.category === category;

test('authentication failures return 401 without exposing the token', async () => {
  const pipeline = createAccessPipeline(ports());
  for (const authorization of [undefined, 'Basic synthetic', 'Bearer ', 'Bearer two tokens']) {
    await assert.rejects(pipeline.authorize({ ...request, authorization }), denied('UNAUTHENTICATED', 'unauthenticated'));
  }
  const badToken = ports();
  badToken.tokens.verify = async () => { throw new IdentityError('UNAUTHENTICATED'); };
  await assert.rejects(createAccessPipeline(badToken).authorize(request), denied('UNAUTHENTICATED', 'unauthenticated'));
  const unknownUser = ports();
  unknownUser.users.findUserId = async () => undefined;
  await assert.rejects(createAccessPipeline(unknownUser).authorize(request), denied('UNAUTHENTICATED', 'unauthenticated'));
});

test('every tenant, membership, entitlement, branch and permission denial is uniform 403', async () => {
  const cases: { name: string; change: (value: AccessPorts) => void; request?: typeof request }[] = [
    { name: 'malformed organization', change: () => {}, request: { ...request, organizationId: 'bad' } },
    { name: 'missing organization', change: value => { value.organizations.findOrganization = async () => undefined; } },
    { name: 'suspended organization', change: value => { value.organizations.findOrganization = async () => ({ organizationId, name: 'Synthetic', status: 'SUSPENDED', timezone: 'UTC' }); } },
    { name: 'no active membership', change: value => { value.organizations.findActiveMembership = async () => undefined; } },
    { name: 'disabled module', change: value => { value.entitlements.isEnabled = async () => false; } },
    { name: 'malformed branch', change: () => {}, request: { ...request, branchId: 'bad' } },
    { name: 'missing branch', change: value => { value.organizations.findBranch = async () => undefined; } },
    { name: 'closed branch', change: value => { value.organizations.findBranch = async () => ({ organizationId, branchId, name: 'Synthetic', status: 'CLOSED', timezone: null }); } },
    { name: 'no permission', change: value => { value.authorization.isAllowed = async () => false; } },
  ];
  for (const sample of cases) {
    const value = ports();
    sample.change(value);
    await assert.rejects(createAccessPipeline(value).authorize(sample.request ?? request), denied('ACCESS_DENIED', 'forbidden'), sample.name);
  }
});

test('authorized branch and organization requests carry only verified identity and scope', async () => {
  const value = ports();
  const seen: unknown[] = [];
  value.authorization.isAllowed = async input => { seen.push(input); return true; };
  const pipeline = createAccessPipeline(value);
  const branchGrant = await pipeline.authorize(request);
  assert.deepEqual(branchGrant, { userId, sessionId: 'session-1', organizationId, membershipId, branchId });
  const organizationGrant = await pipeline.authorize({ ...request, branchId: undefined });
  assert.equal(organizationGrant.branchId, null);
  assert.deepEqual(seen, [
    { organizationId, membershipId, permission: 'checks.read', branchId },
    { organizationId, membershipId, permission: 'checks.read' },
  ]);
});
