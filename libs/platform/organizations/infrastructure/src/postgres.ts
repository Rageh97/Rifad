import { sql, type Kysely, type QueryExecutorProvider } from 'kysely';
import type { AuditSink, AuditSinkFactory } from '@rifad/audit-contract';
import { withTransaction } from '@rifad/database';
import { DomainError } from '@rifad/kernel';
import type { OrganizationRepository, OrganizationsUnitOfWork } from '@rifad/organizations-application';
import type { BranchView, MembershipView, OrganizationDirectory, OrganizationView } from '@rifad/organizations-contract';
import type { Branch, Membership, Organization } from '@rifad/organizations-domain';

const concurrent = () => new DomainError('CONCURRENT_MODIFICATION', 'The record was changed by another request.', 'conflict');

interface OrganizationRow { organization_id: string; name: string; status: Organization['status']; timezone: string; version: number; created_at: Date }
interface BranchRow { organization_id: string; branch_id: string; name: string; status: Branch['status']; timezone: string | null; version: number }
interface MembershipRow { organization_id: string; membership_id: string; user_id: string; status: Membership['status']; version: number }

const toOrganization = (row: OrganizationRow): Organization => Object.freeze({
  organizationId: row.organization_id, name: row.name, status: row.status, timezone: row.timezone, version: row.version, createdAt: new Date(row.created_at).toISOString(),
});
const toBranch = (row: BranchRow): Branch => Object.freeze({
  branchId: row.branch_id, organizationId: row.organization_id, name: row.name, status: row.status, timezone: row.timezone, version: row.version,
});
const toMembership = (row: MembershipRow): Membership => Object.freeze({
  membershipId: row.membership_id, organizationId: row.organization_id, userId: row.user_id, status: row.status, version: row.version,
});

/** Repository bound to one tenant transaction; every statement is also filtered by RLS. */
function repository(trx: QueryExecutorProvider, organizationId: string, audit?: AuditSink): OrganizationRepository {
  const affected = (result: { numAffectedRows?: bigint }) => { if (result.numAffectedRows !== 1n) throw concurrent(); };
  return Object.freeze({
    async getOrganization(id: string) {
      const row = (await sql<OrganizationRow>`select * from organizations.organization where organization_id = ${id}`.execute(trx)).rows[0];
      return row && toOrganization(row);
    },
    async insertOrganization(o: Organization) {
      await sql`insert into organizations.organization (organization_id, name, status, timezone, version, created_at)
        values (${o.organizationId}, ${o.name}, ${o.status}, ${o.timezone}, ${o.version}, ${o.createdAt})`.execute(trx);
      await audit?.record({ action: 'organizations.organization_created', resourceType: 'organization', resourceId: o.organizationId, outcome: 'SUCCEEDED' });
    },
    async updateOrganization(o: Organization, expectedVersion: number) {
      affected(await sql`update organizations.organization set name = ${o.name}, status = ${o.status}, timezone = ${o.timezone}, version = ${o.version}
        where organization_id = ${o.organizationId} and version = ${expectedVersion}`.execute(trx));
      await audit?.record({ action: 'organizations.organization_changed', resourceType: 'organization', resourceId: o.organizationId, outcome: 'SUCCEEDED', details: { status: o.status, version: o.version } });
    },
    async getBranch(branchId: string) {
      const row = (await sql<BranchRow>`select * from organizations.branch where organization_id = ${organizationId} and branch_id = ${branchId}`.execute(trx)).rows[0];
      return row && toBranch(row);
    },
    async insertBranch(b: Branch) {
      await sql`insert into organizations.branch (organization_id, branch_id, name, status, timezone, version)
        values (${b.organizationId}, ${b.branchId}, ${b.name}, ${b.status}, ${b.timezone}, ${b.version})`.execute(trx);
      await audit?.record({ action: 'organizations.branch_opened', resourceType: 'branch', resourceId: b.branchId, outcome: 'SUCCEEDED' });
    },
    async updateBranch(b: Branch, expectedVersion: number) {
      affected(await sql`update organizations.branch set name = ${b.name}, status = ${b.status}, timezone = ${b.timezone}, version = ${b.version}
        where organization_id = ${b.organizationId} and branch_id = ${b.branchId} and version = ${expectedVersion}`.execute(trx));
      await audit?.record({ action: 'organizations.branch_changed', resourceType: 'branch', resourceId: b.branchId, outcome: 'SUCCEEDED', details: { status: b.status, version: b.version } });
    },
    async getMembership(membershipId: string) {
      const row = (await sql<MembershipRow>`select * from organizations.membership where organization_id = ${organizationId} and membership_id = ${membershipId}`.execute(trx)).rows[0];
      return row && toMembership(row);
    },
    async findMembershipByUser(userId: string) {
      const row = (await sql<MembershipRow>`select * from organizations.membership
        where organization_id = ${organizationId} and user_id = ${userId} and status <> 'ENDED'`.execute(trx)).rows[0];
      return row && toMembership(row);
    },
    async insertMembership(m: Membership) {
      try {
        await sql`insert into organizations.membership (organization_id, membership_id, user_id, status, version)
          values (${m.organizationId}, ${m.membershipId}, ${m.userId}, ${m.status}, ${m.version})`.execute(trx);
        await audit?.record({ action: 'organizations.member_invited', resourceType: 'membership', resourceId: m.membershipId, outcome: 'SUCCEEDED', details: { userId: m.userId } });
      } catch (error) {
        // A concurrent invite for the same user hits the partial unique index.
        if ((error as { constraint?: unknown }).constraint === 'membership_live_user') throw new DomainError('MEMBERSHIP_EXISTS', 'User already has a membership in this organization.', 'conflict');
        throw error;
      }
    },
    async updateMembership(m: Membership, expectedVersion: number) {
      affected(await sql`update organizations.membership set status = ${m.status}, version = ${m.version}
        where organization_id = ${m.organizationId} and membership_id = ${m.membershipId} and version = ${expectedVersion}`.execute(trx));
      await audit?.record({ action: 'organizations.membership_changed', resourceType: 'membership', resourceId: m.membershipId, outcome: 'SUCCEEDED', details: { status: m.status, version: m.version } });
    },
  });
}

/** Unit of work over the shared tenant-scoped transaction (M0-018); `audit` records every change in it (M0-017). */
export function postgresOrganizationsUnitOfWork<DB>(db: Kysely<DB>, audit?: AuditSinkFactory): OrganizationsUnitOfWork {
  return Object.freeze({
    run: <T>(organizationId: string, work: (repo: OrganizationRepository) => Promise<T>) =>
      withTransaction(db, { organizationId }, trx => work(repository(trx, organizationId, audit?.(trx, organizationId)))),
  });
}

/** Read-only directory for other contexts (security pipeline, admin views); tenant-scoped by RLS. */
export function postgresOrganizationDirectory<DB>(db: Kysely<DB>): OrganizationDirectory {
  const view = <T>(organizationId: string, read: (repo: OrganizationRepository) => Promise<T>) =>
    withTransaction(db, { organizationId }, trx => read(repository(trx, organizationId)));
  return Object.freeze({
    findOrganization: (organizationId: string) => view(organizationId, async repo => {
      const o = await repo.getOrganization(organizationId);
      return o && ({ organizationId: o.organizationId, name: o.name, status: o.status, timezone: o.timezone } satisfies OrganizationView);
    }),
    findBranch: (organizationId: string, branchId: string) => view(organizationId, async repo => {
      const b = await repo.getBranch(branchId);
      return b && ({ branchId: b.branchId, organizationId: b.organizationId, name: b.name, status: b.status, timezone: b.timezone } satisfies BranchView);
    }),
    findActiveMembership: (organizationId: string, userId: string) => view(organizationId, async repo => {
      const m = await repo.findMembershipByUser(userId);
      return m && m.status === 'ACTIVE'
        ? ({ membershipId: m.membershipId, organizationId: m.organizationId, userId: m.userId, status: m.status } satisfies MembershipView)
        : undefined;
    }),
  });
}
