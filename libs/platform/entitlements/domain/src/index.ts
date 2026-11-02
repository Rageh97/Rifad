import { DomainError } from '@rifad/kernel';
import { FEATURES, type Feature } from '@rifad/entitlements-contract';

const known: ReadonlySet<string> = new Set(FEATURES);

export interface OrganizationEntitlement {
  readonly organizationId: string;
  readonly feature: Feature;
  readonly enabled: boolean;
}

export function parseFeature(value: string): Feature {
  if (!known.has(value)) throw new DomainError('UNKNOWN_FEATURE', 'Feature is not known.', 'validation');
  return value as Feature;
}

/**
 * `platform.core` is always on for an existing organization; every other module is off until
 * explicitly enabled (default deny).
 */
export function isEnabled(feature: Feature, stored: OrganizationEntitlement | undefined): boolean {
  return feature === 'platform.core' || stored?.enabled === true;
}

export function setEntitlement(organizationId: string, feature: string, enabled: boolean): OrganizationEntitlement {
  const parsed = parseFeature(feature);
  if (parsed === 'platform.core' && !enabled) throw new DomainError('CORE_FEATURE_REQUIRED', 'The core platform feature cannot be disabled.', 'rule_violation');
  return Object.freeze({ organizationId, feature: parsed, enabled });
}
