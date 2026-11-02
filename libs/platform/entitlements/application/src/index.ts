import type { Feature } from '@rifad/entitlements-contract';
import { setEntitlement, type OrganizationEntitlement } from '@rifad/entitlements-domain';

export interface EntitlementRepository {
  get(feature: Feature): Promise<OrganizationEntitlement | undefined>;
  upsert(entitlement: OrganizationEntitlement): Promise<void>;
}

export interface EntitlementsUnitOfWork {
  run<T>(organizationId: string, work: (repository: EntitlementRepository) => Promise<T>): Promise<T>;
}

/** Enables or disables a module for one organization (M0-015); commercial approval is outside RIFAD. */
export function entitlementsService(unitOfWork: EntitlementsUnitOfWork) {
  return Object.freeze({
    set: (organizationId: string, feature: string, enabled: boolean) =>
      unitOfWork.run(organizationId, async repository => {
        const entitlement = setEntitlement(organizationId, feature, enabled);
        await repository.upsert(entitlement);
        return entitlement;
      }),
  });
}

export type EntitlementsService = ReturnType<typeof entitlementsService>;
