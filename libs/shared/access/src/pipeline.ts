import { DomainError } from '@rifad/kernel';
import type { AuthorizationQuery, Permission } from '@rifad/authorization-contract';
import { featureForPermission, type EntitlementQuery } from '@rifad/entitlements-contract';
import { IdentityError, authenticate, type TokenVerifier, type UserDirectory } from '@rifad/identity-contract';
import type { OrganizationDirectory } from '@rifad/organizations-contract';

export interface AccessPorts {
  readonly tokens: TokenVerifier;
  readonly users: UserDirectory;
  readonly organizations: OrganizationDirectory;
  readonly entitlements: EntitlementQuery;
  readonly authorization: AuthorizationQuery;
}

export interface AccessRequest {
  /** Raw `Authorization` header value. */
  readonly authorization: string | undefined;
  /** Tenant the caller asks to act in; verified below, never trusted on its own. */
  readonly organizationId: string | undefined;
  /** Branch the action targets, when it is branch-scoped. */
  readonly branchId?: string | undefined;
  readonly permission: Permission;
}

export interface AccessGrant {
  readonly userId: string;
  readonly sessionId: string | null;
  readonly organizationId: string;
  readonly membershipId: string;
  readonly branchId: string | null;
}

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const unauthenticated = () => new DomainError('UNAUTHENTICATED', 'Authentication is required.', 'unauthenticated');
/** One code for every tenant/permission failure, so a denial never reveals whether an organization exists. */
const denied = () => new DomainError('ACCESS_DENIED', 'Access is denied.', 'forbidden');

/**
 * Security pipeline (M0-016): authentication → user → organization → membership → entitlement →
 * permission → branch scope. Every step fails closed; the first failure stops the request.
 */
export function createAccessPipeline(ports: AccessPorts) {
  return Object.freeze({
    async authorize(request: AccessRequest): Promise<AccessGrant> {
      const header = request.authorization;
      const token = typeof header === 'string' && /^Bearer [^\s]+$/.test(header) ? header.slice(7) : undefined;
      if (!token) throw unauthenticated();
      let principal;
      try { principal = await authenticate(token, ports.tokens, ports.users); }
      catch (error) { if (error instanceof IdentityError) throw unauthenticated(); throw error; }

      const organizationId = request.organizationId;
      if (!organizationId || !uuid.test(organizationId)) throw denied();
      const organization = await ports.organizations.findOrganization(organizationId);
      if (!organization || organization.status !== 'ACTIVE') throw denied();
      const membership = await ports.organizations.findActiveMembership(organizationId, principal.userId);
      if (!membership) throw denied();

      if (!(await ports.entitlements.isEnabled(organizationId, featureForPermission(request.permission)))) throw denied();

      const branchId = request.branchId ?? undefined;
      if (branchId !== undefined) {
        if (!uuid.test(branchId)) throw denied();
        const branch = await ports.organizations.findBranch(organizationId, branchId);
        if (!branch || branch.status !== 'ACTIVE') throw denied();
      }
      const allowed = await ports.authorization.isAllowed({
        organizationId, membershipId: membership.membershipId, permission: request.permission, ...(branchId ? { branchId } : {}),
      });
      if (!allowed) throw denied();
      return Object.freeze({ userId: principal.userId, sessionId: principal.sessionId, organizationId, membershipId: membership.membershipId, branchId: branchId ?? null });
    },
  });
}

export type AccessPipeline = ReturnType<typeof createAccessPipeline>;
