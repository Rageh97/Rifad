/**
 * Public contract of the Entitlements context (M0-015): which product modules an organization may
 * use. A permission can never grant access to a disabled module.
 */

export const FEATURES = Object.freeze(['platform.core', 'restaurant.ordering', 'restaurant.kitchen', 'finance.payments', 'finance.billing'] as const);
export type Feature = (typeof FEATURES)[number];

/** Module each permission area belongs to; areas not listed belong to `platform.core`. */
export const FEATURE_BY_PERMISSION_AREA: Readonly<Record<string, Feature>> = Object.freeze({
  checks: 'restaurant.ordering',
});

export function featureForPermission(permission: string): Feature {
  return FEATURE_BY_PERMISSION_AREA[permission.split('.')[0] ?? ''] ?? 'platform.core';
}

export interface EntitlementQuery {
  isEnabled(organizationId: string, feature: Feature): Promise<boolean>;
}
