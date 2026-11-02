/**
 * Public contract of the Organizations context (owner of organizations, branches and memberships;
 * decisions G10/G13, 2026-11-02). Other contexts use only these types, never its tables.
 */

export type OrganizationStatus = 'ACTIVE' | 'SUSPENDED';
export type BranchStatus = 'ACTIVE' | 'CLOSED';
/** INVITED until the user accepts; only ACTIVE memberships may act in the organization. */
export type MembershipStatus = 'INVITED' | 'ACTIVE' | 'SUSPENDED' | 'ENDED';

export interface OrganizationView {
  readonly organizationId: string;
  readonly name: string;
  readonly status: OrganizationStatus;
  readonly timezone: string;
}

export interface BranchView {
  readonly branchId: string;
  readonly organizationId: string;
  readonly name: string;
  readonly status: BranchStatus;
  /** Branch override of the organization timezone; null means inherit. */
  readonly timezone: string | null;
}

/**
 * One membership per user and organization. Branch access is not stored here: it comes from
 * branch-scoped role assignments owned by Authorization (G13), so one employee can work in several branches.
 */
export interface MembershipView {
  readonly membershipId: string;
  readonly organizationId: string;
  /** Platform user ID issued by the Identity context; Organizations never stores credentials. */
  readonly userId: string;
  readonly status: MembershipStatus;
}

/** Read port other contexts (e.g. the security pipeline) depend on. */
export interface OrganizationDirectory {
  findOrganization(organizationId: string): Promise<OrganizationView | undefined>;
  findBranch(organizationId: string, branchId: string): Promise<BranchView | undefined>;
  findActiveMembership(organizationId: string, userId: string): Promise<MembershipView | undefined>;
}
