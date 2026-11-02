import { DomainError } from '@rifad/kernel';

/** Data classes fixed by v1.4 (M0-045, §29.3). Which processor/region may receive each class is decision G07. */
export const DATA_CLASSES = ['public', 'internal', 'personal', 'sensitive', 'financial'] as const;
export type DataClass = (typeof DATA_CLASSES)[number];

/** Field name -> class for one outbound payload shape. Every transmitted field must be listed. */
export type ClassificationSchema = Readonly<Record<string, DataClass>>;

/** Approved transfer rule for one external processor (storage, AI, SMS, analytics, identity...). */
export interface ProcessorPolicy {
  readonly processor: string;
  readonly purpose: string;
  readonly allowedClasses: readonly DataClass[];
  readonly regions: readonly string[];
}

export interface OutboundRequest {
  readonly processor: string;
  readonly region: string;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly schema: ClassificationSchema;
}

const forbidden = (code: string, message: string) => new DomainError(code, message, 'forbidden');

/** Classes present in a payload. Unlisted fields fail closed instead of defaulting to a permissive class. */
export function classesIn(payload: Readonly<Record<string, unknown>>, schema: ClassificationSchema): ReadonlySet<DataClass> {
  const classes = new Set<DataClass>();
  for (const [field, value] of Object.entries(payload)) {
    if (value === undefined) continue;
    const dataClass = Object.hasOwn(schema, field) ? schema[field] : undefined;
    if (!dataClass || !DATA_CLASSES.includes(dataClass)) throw forbidden('DATA_UNCLASSIFIED', 'Outbound payload contains an unclassified field.');
    classes.add(dataClass);
  }
  return classes;
}

/**
 * Outbound processor guard used by provider adapters before any transfer. Default deny: an unknown
 * processor, a region outside its policy, or a data class it is not approved for is rejected.
 * The registry holds no real processors until G07 approves them.
 */
export function createOutboundGuard(policies: readonly ProcessorPolicy[]) {
  const registry = new Map<string, ProcessorPolicy>();
  for (const policy of policies) {
    if (!policy.processor || !policy.purpose || registry.has(policy.processor)) throw new TypeError('Processor policy requires a unique processor and a purpose');
    if (policy.allowedClasses.some(dataClass => !DATA_CLASSES.includes(dataClass))) throw new TypeError('Processor policy has an unknown data class');
    registry.set(policy.processor, Object.freeze({ ...policy, allowedClasses: [...policy.allowedClasses], regions: [...policy.regions] }));
  }
  return Object.freeze({
    assertAllowed(request: OutboundRequest): void {
      const policy = registry.get(request.processor);
      if (!policy) throw forbidden('PROCESSOR_NOT_APPROVED', 'Processor has no approved data policy.');
      if (!policy.regions.includes(request.region)) throw forbidden('PROCESSOR_REGION_FORBIDDEN', 'Processor region is not approved.');
      for (const dataClass of classesIn(request.payload, request.schema)) {
        if (!policy.allowedClasses.includes(dataClass)) throw forbidden('DATA_CLASS_FORBIDDEN', 'Data class is not approved for this processor.');
      }
    },
  });
}

export type OutboundGuard = ReturnType<typeof createOutboundGuard>;
