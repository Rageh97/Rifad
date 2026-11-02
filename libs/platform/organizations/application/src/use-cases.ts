import { DomainError, newEntityId, type Clock } from '@rifad/kernel';
import type { MembershipStatus } from '@rifad/organizations-contract';
import {
  changeMembershipStatus, closeBranch, createOrganization, inviteMember, openBranch, reactivateOrganization, suspendOrganization,
  type Branch, type Membership, type Organization,
} from '@rifad/organizations-domain';

/** Persistence port; one instance is bound to one tenant transaction. Saves use optimistic versions. */
export interface OrganizationRepository {
  getOrganization(organizationId: string): Promise<Organization | undefined>;
  insertOrganization(organization: Organization): Promise<void>;
  updateOrganization(organization: Organization, expectedVersion: number): Promise<void>;
  getBranch(branchId: string): Promise<Branch | undefined>;
  insertBranch(branch: Branch): Promise<void>;
  updateBranch(branch: Branch, expectedVersion: number): Promise<void>;
  getMembership(membershipId: string): Promise<Membership | undefined>;
  findMembershipByUser(userId: string): Promise<Membership | undefined>;
  insertMembership(membership: Membership): Promise<void>;
  updateMembership(membership: Membership, expectedVersion: number): Promise<void>;
}

/** Runs work in one transaction scoped to the tenant (RLS context set by the adapter). */
export interface OrganizationsUnitOfWork {
  run<T>(organizationId: string, work: (repository: OrganizationRepository) => Promise<T>): Promise<T>;
}

const notFound = (code: string, message: string) => new DomainError(code, message, 'not_found');

async function requireOrganization(repository: OrganizationRepository, organizationId: string): Promise<Organization> {
  const organization = await repository.getOrganization(organizationId);
  if (!organization) throw notFound('ORGANIZATION_NOT_FOUND', 'Organization was not found.');
  return organization;
}

/**
 * Organizations application service (M0-010/011/012). Authorization of the caller is enforced by
 * the security pipeline (M0-016) before these commands run; tenant isolation is additionally
 * enforced by RLS in the adapter.
 */
export function organizationsService(unitOfWork: OrganizationsUnitOfWork, clock: Clock) {
  return Object.freeze({
    /** The new organization's ID is the tenant context of its own creating transaction, so RLS needs no bypass. */
    async createOrganization(input: { name: string; timezone: string }): Promise<Organization> {
      const organizationId = newEntityId<'organization'>();
      const organization = createOrganization({ organizationId, ...input }, clock);
      await unitOfWork.run(organizationId, repository => repository.insertOrganization(organization));
      return organization;
    },

    async suspendOrganization(organizationId: string): Promise<Organization> {
      return unitOfWork.run(organizationId, async repository => {
        const current = await requireOrganization(repository, organizationId);
        const next = suspendOrganization(current);
        await repository.updateOrganization(next, current.version);
        return next;
      });
    },

    async reactivateOrganization(organizationId: string): Promise<Organization> {
      return unitOfWork.run(organizationId, async repository => {
        const current = await requireOrganization(repository, organizationId);
        const next = reactivateOrganization(current);
        await repository.updateOrganization(next, current.version);
        return next;
      });
    },

    async openBranch(organizationId: string, input: { name: string; timezone?: string | null }): Promise<Branch> {
      return unitOfWork.run(organizationId, async repository => {
        const organization = await requireOrganization(repository, organizationId);
        const branch = openBranch(organization, { branchId: newEntityId<'branch'>(), ...input });
        await repository.insertBranch(branch);
        return branch;
      });
    },

    async closeBranch(organizationId: string, branchId: string): Promise<Branch> {
      return unitOfWork.run(organizationId, async repository => {
        const current = await repository.getBranch(branchId);
        if (!current) throw notFound('BRANCH_NOT_FOUND', 'Branch was not found.');
        const next = closeBranch(current);
        await repository.updateBranch(next, current.version);
        return next;
      });
    },

    /** One membership per user and organization; an existing non-ENDED membership is a conflict. */
    async inviteMember(organizationId: string, userId: string): Promise<Membership> {
      return unitOfWork.run(organizationId, async repository => {
        const organization = await requireOrganization(repository, organizationId);
        const existing = await repository.findMembershipByUser(userId);
        if (existing && existing.status !== 'ENDED') throw new DomainError('MEMBERSHIP_EXISTS', 'User already has a membership in this organization.', 'conflict');
        const membership = inviteMember(organization, { membershipId: newEntityId<'membership'>(), userId });
        await repository.insertMembership(membership);
        return membership;
      });
    },

    async changeMembershipStatus(organizationId: string, membershipId: string, status: MembershipStatus): Promise<Membership> {
      return unitOfWork.run(organizationId, async repository => {
        const current = await repository.getMembership(membershipId);
        if (!current) throw notFound('MEMBERSHIP_NOT_FOUND', 'Membership was not found.');
        const next = changeMembershipStatus(current, status);
        await repository.updateMembership(next, current.version);
        return next;
      });
    },
  });
}

export type OrganizationsService = ReturnType<typeof organizationsService>;
