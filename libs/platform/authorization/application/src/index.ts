import { DomainError, newEntityId } from '@rifad/kernel';
import type { AccessScope } from '@rifad/authorization-contract';
import { assignRole, changeRolePermissions, defineRole, type Role, type RoleAssignment } from '@rifad/authorization-domain';
import type { OrganizationDirectory } from '@rifad/organizations-contract';

/** Persistence port bound to one tenant transaction. */
export interface AuthorizationRepository {
  getRole(roleId: string): Promise<Role | undefined>;
  insertRole(role: Role): Promise<void>;
  updateRole(role: Role, expectedVersion: number): Promise<void>;
  insertAssignment(assignment: RoleAssignment): Promise<void>;
  deleteAssignment(assignmentId: string): Promise<boolean>;
  rolesFor(membershipId: string): Promise<{ roles: Role[]; assignments: RoleAssignment[] }>;
}

export interface AuthorizationUnitOfWork {
  run<T>(organizationId: string, work: (repository: AuthorizationRepository) => Promise<T>): Promise<T>;
}

/**
 * Authorization application service (M0-014). Membership and branch existence are checked through
 * the Organizations public directory, never its tables (ADR-002).
 */
export function authorizationService(unitOfWork: AuthorizationUnitOfWork, organizations: OrganizationDirectory) {
  return Object.freeze({
    defineRole: (organizationId: string, input: { name: string; permissions: readonly string[] }) =>
      unitOfWork.run(organizationId, async repository => {
        const role = defineRole({ roleId: newEntityId<'role'>(), organizationId, ...input });
        await repository.insertRole(role);
        return role;
      }),

    changeRolePermissions: (organizationId: string, roleId: string, permissions: readonly string[]) =>
      unitOfWork.run(organizationId, async repository => {
        const current = await repository.getRole(roleId);
        if (!current) throw new DomainError('ROLE_NOT_FOUND', 'Role was not found.', 'not_found');
        const next = changeRolePermissions(current, permissions);
        await repository.updateRole(next, current.version);
        return next;
      }),

    /** Branch-scoped assignments require an existing, ACTIVE branch of the same organization. */
    async assignRole(organizationId: string, input: { membershipId: string; roleId: string; scope: AccessScope }): Promise<RoleAssignment> {
      if (input.scope.kind === 'BRANCH') {
        const branch = await organizations.findBranch(organizationId, input.scope.branchId);
        if (!branch || branch.status !== 'ACTIVE') throw new DomainError('BRANCH_NOT_ACTIVE', 'Branch is not active in this organization.', 'rule_violation');
      }
      return unitOfWork.run(organizationId, async repository => {
        const role = await repository.getRole(input.roleId);
        if (!role) throw new DomainError('ROLE_NOT_FOUND', 'Role was not found.', 'not_found');
        const assignment = assignRole({ assignmentId: newEntityId<'role_assignment'>(), role, membershipId: input.membershipId, scope: input.scope });
        await repository.insertAssignment(assignment);
        return assignment;
      });
    },

    revokeAssignment: (organizationId: string, assignmentId: string) =>
      unitOfWork.run(organizationId, async repository => {
        if (!(await repository.deleteAssignment(assignmentId))) throw new DomainError('ASSIGNMENT_NOT_FOUND', 'Role assignment was not found.', 'not_found');
      }),
  });
}

export type AuthorizationService = ReturnType<typeof authorizationService>;
