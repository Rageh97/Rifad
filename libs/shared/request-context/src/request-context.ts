import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';

/**
 * Per-request/per-job execution context (M0-005). Identity and tenant fields are set only by the
 * authenticated security pipeline (M0-016) after verification; they are never read from
 * caller-supplied headers.
 */
export interface RequestContext {
  readonly requestId: string;
  readonly correlationId: string;
  readonly userId?: string;
  readonly sessionId?: string;
  readonly deviceId?: string;
  readonly organizationId?: string;
  readonly branchId?: string;
  readonly timezone?: string;
}

export type ContextInput = Partial<RequestContext>;

export class RequestContextError extends Error {
  constructor(readonly field: string) {
    super(`Invalid request context: ${field}`);
    this.name = 'RequestContextError';
  }
}

export const CORRELATION_HEADER = 'x-correlation-id';
export const REQUEST_ID_HEADER = 'x-request-id';

const tracePattern = /^[A-Za-z0-9._:-]{1,128}$/;
const storage = new AsyncLocalStorage<RequestContext>();

function validTimezone(value: string): boolean {
  try { new Intl.DateTimeFormat('en', { timeZone: value }); return true; } catch { return false; }
}

/** Builds an immutable context; requestId is generated when absent and correlationId defaults to it. */
export function createRequestContext(input: ContextInput = {}): RequestContext {
  const requestId = input.requestId ?? randomUUID();
  const context: Record<string, string> = { requestId, correlationId: input.correlationId ?? requestId };
  for (const field of ['userId', 'sessionId', 'deviceId', 'organizationId', 'branchId', 'timezone'] as const) {
    const value = input[field];
    if (value !== undefined) context[field] = value;
  }
  for (const [field, value] of Object.entries(context)) {
    const valid = field === 'timezone' ? validTimezone(value) : tracePattern.test(value);
    if (!valid) throw new RequestContextError(field);
  }
  return Object.freeze(context) as unknown as RequestContext;
}

/**
 * Context for an inbound HTTP request: a fresh server-side requestId, and the caller's correlation ID
 * only when it is a single well-formed value. Malformed correlation IDs are replaced, not echoed.
 */
export function contextFromHeaders(headers: Record<string, string | string[] | undefined>): RequestContext {
  const supplied = headers[CORRELATION_HEADER];
  const requestId = randomUUID();
  const correlationId = typeof supplied === 'string' && tracePattern.test(supplied) ? supplied : requestId;
  return createRequestContext({ requestId, correlationId });
}

export function runWithContext<T>(context: RequestContext, fn: () => T): T {
  return storage.run(context, fn);
}

export function currentContext(): RequestContext | undefined {
  return storage.getStore();
}

/** Fails closed where code requires a context, e.g. tenant-scoped work (default deny). */
export function requireContext(): RequestContext {
  const context = storage.getStore();
  if (!context) throw new RequestContextError('missing');
  return context;
}

/** Correlation ID to stamp on a new event: the active request's, or a fresh one outside any request. */
export function currentCorrelationId(): string {
  return storage.getStore()?.correlationId ?? createRequestContext().correlationId;
}

/**
 * Adds identity and tenant scope proven by the security pipeline (M0-016) to the current request.
 * Only the pipeline calls this, after authentication, membership and permission checks; caller
 * headers never reach it. It replaces the store for the rest of this request's async execution and
 * keeps the request and correlation IDs.
 */
export function bindVerifiedIdentity(fields: Pick<ContextInput, 'userId' | 'sessionId' | 'organizationId' | 'branchId'>): RequestContext {
  const current = requireContext();
  const next = createRequestContext({ ...current, ...fields });
  storage.enterWith(next);
  return next;
}
