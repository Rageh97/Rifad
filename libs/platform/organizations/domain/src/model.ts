import { DomainError, type Clock } from '@rifad/kernel';
import type { BranchStatus, MembershipStatus, OrganizationStatus } from '@rifad/organizations-contract';

const invalid = (code: string, message: string) => new DomainError(code, message, 'validation');
const conflict = (code: string, message: string) => new DomainError(code, message, 'conflict');

function name(value: string, code: string): string {
  const trimmed = value.trim();
  if (trimmed.length < 1 || trimmed.length > 200 || /[\u0000-\u001f]/.test(trimmed)) throw invalid(code, 'Name must be 1-200 printable characters.');
  return trimmed;
}

function timezone(value: string): string {
  try { new Intl.DateTimeFormat('en', { timeZone: value }); return value; }
  catch { throw invalid('INVALID_TIMEZONE', 'Timezone must be an IANA zone name.'); }
}

/** Organization (tenant) aggregate. Its ID is the tenant boundary for every business row (§14). */
export interface Organization {
  readonly organizationId: string;
  readonly name: string;
  readonly status: OrganizationStatus;
  readonly timezone: string;
  readonly version: number;
  readonly createdAt: string;
}

export function createOrganization(input: { organizationId: string; name: string; timezone: string }, clock: Clock): Organization {
  return Object.freeze({
    organizationId: input.organizationId, name: name(input.name, 'INVALID_ORGANIZATION_NAME'), status: 'ACTIVE' as const,
    timezone: timezone(input.timezone), version: 1, createdAt: clock.now().toISOString(),
  });
}

export function suspendOrganization(organization: Organization): Organization {
  if (organization.status === 'SUSPENDED') throw conflict('ORGANIZATION_ALREADY_SUSPENDED', 'Organization is already suspended.');
  return Object.freeze({ ...organization, status: 'SUSPENDED' as const, version: organization.version + 1 });
}

export function reactivateOrganization(organization: Organization): Organization {
  if (organization.status === 'ACTIVE') throw conflict('ORGANIZATION_ALREADY_ACTIVE', 'Organization is already active.');
  return Object.freeze({ ...organization, status: 'ACTIVE' as const, version: organization.version + 1 });
}

/** A branch always belongs to exactly one organization; its organization never changes. */
export interface Branch {
  readonly branchId: string;
  readonly organizationId: string;
  readonly name: string;
  readonly status: BranchStatus;
  readonly timezone: string | null;
  readonly version: number;
}

export function openBranch(organization: Organization, input: { branchId: string; name: string; timezone?: string | null }): Branch {
  if (organization.status !== 'ACTIVE') throw new DomainError('ORGANIZATION_NOT_ACTIVE', 'Organization is not active.', 'rule_violation');
  return Object.freeze({
    branchId: input.branchId, organizationId: organization.organizationId, name: name(input.name, 'INVALID_BRANCH_NAME'),
    status: 'ACTIVE' as const, timezone: input.timezone ? timezone(input.timezone) : null, version: 1,
  });
}

export function closeBranch(branch: Branch): Branch {
  if (branch.status === 'CLOSED') throw conflict('BRANCH_ALREADY_CLOSED', 'Branch is already closed.');
  return Object.freeze({ ...branch, status: 'CLOSED' as const, version: branch.version + 1 });
}

/** Effective timezone for reports and display (ADR-016): branch override, else organization. */
export function branchTimezone(organization: Organization, branch: Branch): string {
  return branch.timezone ?? organization.timezone;
}

/** One membership per user and organization (G13); branch access comes from Authorization role assignments. */
export interface Membership {
  readonly membershipId: string;
  readonly organizationId: string;
  readonly userId: string;
  readonly status: MembershipStatus;
  readonly version: number;
}

const transitions: Readonly<Record<MembershipStatus, readonly MembershipStatus[]>> = {
  INVITED: ['ACTIVE', 'ENDED'],
  ACTIVE: ['SUSPENDED', 'ENDED'],
  SUSPENDED: ['ACTIVE', 'ENDED'],
  ENDED: [],
};

export function inviteMember(organization: Organization, input: { membershipId: string; userId: string }): Membership {
  if (organization.status !== 'ACTIVE') throw new DomainError('ORGANIZATION_NOT_ACTIVE', 'Organization is not active.', 'rule_violation');
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(input.userId)) throw invalid('INVALID_USER_ID', 'User ID must be a platform UUID.');
  return Object.freeze({ membershipId: input.membershipId, organizationId: organization.organizationId, userId: input.userId, status: 'INVITED' as const, version: 1 });
}

/** Status changes follow the transition table; an ENDED membership is final (re-invite creates a new one). */
export function changeMembershipStatus(membership: Membership, next: MembershipStatus): Membership {
  if (!transitions[membership.status].includes(next)) {
    throw new DomainError('MEMBERSHIP_TRANSITION_NOT_ALLOWED', 'Membership status change is not allowed.', 'rule_violation');
  }
  return Object.freeze({ ...membership, status: next, version: membership.version + 1 });
}

/** Only an ACTIVE membership in an ACTIVE organization may act (default deny otherwise). */
export function canAct(organization: Organization, membership: Membership | undefined): boolean {
  return organization.status === 'ACTIVE' && membership?.status === 'ACTIVE' && membership.organizationId === organization.organizationId;
}
