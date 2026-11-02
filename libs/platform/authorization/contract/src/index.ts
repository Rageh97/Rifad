/**
 * Public contract of the Authorization context (M0-014): permissions, roles and role assignments.
 * Assignments are attached to an Organizations membership and scoped to the whole organization or
 * to one branch, so one employee can work in several branches (G13).
 */

/** `<area>.<action>`, e.g. `checks.submit_round`. */
export type Permission = string;

/** Permissions known to the platform today. Contexts add theirs as they ship. */
export const PERMISSIONS = Object.freeze([
  'organizations.read', 'organizations.manage', 'branches.manage', 'members.manage', 'roles.manage', 'entitlements.manage',
  'checks.create', 'checks.read', 'checks.submit_round',
] as const);

export type AccessScope = { readonly kind: 'ORGANIZATION' } | { readonly kind: 'BRANCH'; readonly branchId: string };

/** Read port used by the security pipeline; default deny when anything is missing. */
export interface AuthorizationQuery {
  isAllowed(input: { organizationId: string; membershipId: string; permission: Permission; branchId?: string }): Promise<boolean>;
}
