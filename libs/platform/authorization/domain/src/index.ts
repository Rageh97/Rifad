import { DomainError } from '@rifad/kernel';
import { PERMISSIONS, type AccessScope, type Permission } from '@rifad/authorization-contract';

const known: ReadonlySet<string> = new Set(PERMISSIONS);
const invalid = (code: string, message: string) => new DomainError(code, message, 'validation');

/** A named set of permissions defined per organization. */
export interface Role {
  readonly roleId: string;
  readonly organizationId: string;
  readonly name: string;
  readonly permissions: readonly Permission[];
  readonly version: number;
}

/** Grants one role to one membership, organization-wide or for a single branch. */
export interface RoleAssignment {
  readonly assignmentId: string;
  readonly organizationId: string;
  readonly membershipId: string;
  readonly roleId: string;
  readonly scope: AccessScope;
}

export function defineRole(input: { roleId: string; organizationId: string; name: string; permissions: readonly string[] }): Role {
  const name = input.name.trim();
  if (name.length < 1 || name.length > 100) throw invalid('INVALID_ROLE_NAME', 'Role name must be 1-100 characters.');
  const permissions = [...new Set(input.permissions)].sort();
  if (!permissions.length) throw invalid('ROLE_WITHOUT_PERMISSIONS', 'A role needs at least one permission.');
  if (permissions.some(permission => !known.has(permission))) throw invalid('UNKNOWN_PERMISSION', 'Role contains an unknown permission.');
  return Object.freeze({ roleId: input.roleId, organizationId: input.organizationId, name, permissions: Object.freeze(permissions), version: 1 });
}

export function changeRolePermissions(role: Role, permissions: readonly string[]): Role {
  const next = defineRole({ roleId: role.roleId, organizationId: role.organizationId, name: role.name, permissions });
  return Object.freeze({ ...next, version: role.version + 1 });
}

export function assignRole(input: { assignmentId: string; role: Role; membershipId: string; scope: AccessScope }): RoleAssignment {
  return Object.freeze({ assignmentId: input.assignmentId, organizationId: input.role.organizationId, membershipId: input.membershipId, roleId: input.role.roleId, scope: input.scope });
}

/**
 * Default-deny evaluation. A permission is allowed when some assignment's role in the same
 * organization grants it and the scope matches: organization-wide covers every branch; a branch
 * assignment covers only that branch and never organization-level actions (no branchId).
 */
export function isAllowed(input: { organizationId: string; permission: Permission; branchId?: string; roles: readonly Role[]; assignments: readonly RoleAssignment[] }): boolean {
  if (!known.has(input.permission)) return false;
  const roles = new Map(input.roles.filter(role => role.organizationId === input.organizationId).map(role => [role.roleId, role]));
  return input.assignments.some(assignment => {
    if (assignment.organizationId !== input.organizationId) return false;
    if (!roles.get(assignment.roleId)?.permissions.includes(input.permission)) return false;
    return assignment.scope.kind === 'ORGANIZATION' || (input.branchId !== undefined && assignment.scope.branchId === input.branchId);
  });
}
