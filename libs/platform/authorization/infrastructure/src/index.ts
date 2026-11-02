import { sql, type Kysely, type QueryExecutorProvider } from 'kysely';
import { RUNTIME_ROLE, withTransaction, type Migration } from '@rifad/database';
import { DomainError } from '@rifad/kernel';
import type { AuthorizationRepository, AuthorizationUnitOfWork } from '@rifad/authorization-application';
import type { AccessScope, AuthorizationQuery } from '@rifad/authorization-contract';
import { isAllowed, type Role, type RoleAssignment } from '@rifad/authorization-domain';

export const AUTHORIZATION_MIGRATIONS: readonly Migration[] = Object.freeze([
  {
    id: '0009_authorization_core',
    owner: 'authorization',
    sql: `
      CREATE SCHEMA authorization_ctx;
      REVOKE ALL ON SCHEMA authorization_ctx FROM PUBLIC;
      GRANT USAGE ON SCHEMA authorization_ctx TO ${RUNTIME_ROLE};
      CREATE TABLE authorization_ctx.role (
        organization_id uuid NOT NULL,
        role_id uuid NOT NULL,
        name text NOT NULL CHECK (length(name) BETWEEN 1 AND 100),
        permissions text[] NOT NULL CHECK (cardinality(permissions) > 0),
        version integer NOT NULL CHECK (version > 0),
        PRIMARY KEY (organization_id, role_id),
        CONSTRAINT role_name_unique UNIQUE (organization_id, name)
      );
      -- membership_id and branch_id reference Organizations by ID only (ADR-002: no cross-context FKs).
      CREATE TABLE authorization_ctx.role_assignment (
        organization_id uuid NOT NULL,
        assignment_id uuid NOT NULL,
        membership_id uuid NOT NULL,
        role_id uuid NOT NULL,
        branch_id uuid,
        PRIMARY KEY (organization_id, assignment_id),
        FOREIGN KEY (organization_id, role_id) REFERENCES authorization_ctx.role (organization_id, role_id)
      );
      CREATE UNIQUE INDEX role_assignment_unique ON authorization_ctx.role_assignment
        (organization_id, membership_id, role_id, coalesce(branch_id, '00000000-0000-0000-0000-000000000000'::uuid));
      CREATE INDEX role_assignment_membership ON authorization_ctx.role_assignment (organization_id, membership_id);
      ALTER TABLE authorization_ctx.role ENABLE ROW LEVEL SECURITY;
      ALTER TABLE authorization_ctx.role FORCE ROW LEVEL SECURITY;
      ALTER TABLE authorization_ctx.role_assignment ENABLE ROW LEVEL SECURITY;
      ALTER TABLE authorization_ctx.role_assignment FORCE ROW LEVEL SECURITY;
      CREATE POLICY role_tenant ON authorization_ctx.role
        USING (organization_id = rifad.current_organization_id()) WITH CHECK (organization_id = rifad.current_organization_id());
      CREATE POLICY role_assignment_tenant ON authorization_ctx.role_assignment
        USING (organization_id = rifad.current_organization_id()) WITH CHECK (organization_id = rifad.current_organization_id());
      GRANT SELECT, INSERT ON authorization_ctx.role, authorization_ctx.role_assignment TO ${RUNTIME_ROLE};
      GRANT UPDATE (name, permissions, version) ON authorization_ctx.role TO ${RUNTIME_ROLE};
      -- Revoking access deletes the assignment; the audit trail (M0-017) records who revoked it.
      GRANT DELETE ON authorization_ctx.role_assignment TO ${RUNTIME_ROLE};
    `,
  },
]);

interface RoleRow { organization_id: string; role_id: string; name: string; permissions: string[]; version: number }
interface AssignmentRow { organization_id: string; assignment_id: string; membership_id: string; role_id: string; branch_id: string | null }

const toRole = (row: RoleRow): Role => Object.freeze({ roleId: row.role_id, organizationId: row.organization_id, name: row.name, permissions: Object.freeze([...row.permissions]), version: row.version });
const toAssignment = (row: AssignmentRow): RoleAssignment => Object.freeze({
  assignmentId: row.assignment_id, organizationId: row.organization_id, membershipId: row.membership_id, roleId: row.role_id,
  scope: (row.branch_id ? { kind: 'BRANCH', branchId: row.branch_id } : { kind: 'ORGANIZATION' }) as AccessScope,
});

function repository(trx: QueryExecutorProvider, organizationId: string): AuthorizationRepository {
  return Object.freeze({
    async getRole(roleId: string) {
      const row = (await sql<RoleRow>`select * from authorization_ctx.role where organization_id = ${organizationId} and role_id = ${roleId}`.execute(trx)).rows[0];
      return row && toRole(row);
    },
    async insertRole(role: Role) {
      try {
        await sql`insert into authorization_ctx.role (organization_id, role_id, name, permissions, version)
          values (${role.organizationId}, ${role.roleId}, ${role.name}, ${[...role.permissions]}::text[], ${role.version})`.execute(trx);
      } catch (error) {
        if ((error as { constraint?: unknown }).constraint === 'role_name_unique') throw new DomainError('ROLE_NAME_EXISTS', 'A role with this name already exists.', 'conflict');
        throw error;
      }
    },
    async updateRole(role: Role, expectedVersion: number) {
      const result = await sql`update authorization_ctx.role set name = ${role.name}, permissions = ${[...role.permissions]}::text[], version = ${role.version}
        where organization_id = ${role.organizationId} and role_id = ${role.roleId} and version = ${expectedVersion}`.execute(trx);
      if (result.numAffectedRows !== 1n) throw new DomainError('CONCURRENT_MODIFICATION', 'The record was changed by another request.', 'conflict');
    },
    async insertAssignment(a: RoleAssignment) {
      try {
        await sql`insert into authorization_ctx.role_assignment (organization_id, assignment_id, membership_id, role_id, branch_id)
          values (${a.organizationId}, ${a.assignmentId}, ${a.membershipId}, ${a.roleId}, ${a.scope.kind === 'BRANCH' ? a.scope.branchId : null})`.execute(trx);
      } catch (error) {
        if ((error as { constraint?: unknown }).constraint === 'role_assignment_unique') throw new DomainError('ASSIGNMENT_EXISTS', 'This role is already assigned with this scope.', 'conflict');
        throw error;
      }
    },
    async deleteAssignment(assignmentId: string) {
      const result = await sql`delete from authorization_ctx.role_assignment where organization_id = ${organizationId} and assignment_id = ${assignmentId}`.execute(trx);
      return result.numAffectedRows === 1n;
    },
    async rolesFor(membershipId: string) {
      const assignments = (await sql<AssignmentRow>`select * from authorization_ctx.role_assignment
        where organization_id = ${organizationId} and membership_id = ${membershipId}`.execute(trx)).rows.map(toAssignment);
      const roleIds = [...new Set(assignments.map(a => a.roleId))];
      const roles = roleIds.length ? (await sql<RoleRow>`select * from authorization_ctx.role
        where organization_id = ${organizationId} and role_id = any(${roleIds}::uuid[])`.execute(trx)).rows.map(toRole) : [];
      return { roles, assignments };
    },
  });
}

export function postgresAuthorizationUnitOfWork<DB>(db: Kysely<DB>): AuthorizationUnitOfWork {
  return Object.freeze({
    run: <T>(organizationId: string, work: (repo: AuthorizationRepository) => Promise<T>) =>
      withTransaction(db, { organizationId }, trx => work(repository(trx, organizationId))),
  });
}

/** Evaluates a permission from stored roles/assignments; any failure to load denies. */
export function postgresAuthorizationQuery<DB>(db: Kysely<DB>): AuthorizationQuery {
  return Object.freeze({
    async isAllowed(input: { organizationId: string; membershipId: string; permission: string; branchId?: string }) {
      const { roles, assignments } = await withTransaction(db, { organizationId: input.organizationId }, trx => repository(trx, input.organizationId).rolesFor(input.membershipId));
      return isAllowed({ organizationId: input.organizationId, permission: input.permission, roles, assignments, ...(input.branchId ? { branchId: input.branchId } : {}) });
    },
  });
}
