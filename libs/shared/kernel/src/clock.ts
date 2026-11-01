/** Source of UTC instants (ADR-016). Business timezones are applied by owning contexts, not by the clock. */
export interface Clock {
  now(): Date;
}

export const systemClock: Clock = Object.freeze({ now: () => new Date() });

/** Deterministic clock for tests and replay. */
export function fixedClock(instant: string | Date): Clock {
  const time = new Date(instant).getTime();
  if (!Number.isFinite(time)) throw new TypeError('fixedClock requires a valid instant');
  return Object.freeze({ now: () => new Date(time) });
}
