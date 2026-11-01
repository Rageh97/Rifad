import { HttpException } from '@nestjs/common';
import { DomainError, type DomainErrorCategory } from '@rifad/kernel';

/** Stable error contract (M0-034): `{ error: { code, message, requestId } }`; never a stack, SQL or provider text. */
export interface ApiErrorBody {
  readonly error: { readonly code: string; readonly message: string; readonly requestId: string };
}

const categoryStatus: Record<DomainErrorCategory, number> = {
  validation: 400, forbidden: 403, not_found: 404, conflict: 409, rule_violation: 422,
};

const transportErrors: Record<number, readonly [string, string]> = {
  400: ['BAD_REQUEST', 'Request is invalid.'],
  401: ['UNAUTHENTICATED', 'Authentication is required.'],
  403: ['FORBIDDEN', 'Access is denied.'],
  404: ['NOT_FOUND', 'Resource was not found.'],
  405: ['METHOD_NOT_ALLOWED', 'Method is not allowed.'],
  409: ['CONFLICT', 'Request conflicts with the current state.'],
  413: ['PAYLOAD_TOO_LARGE', 'Request body is too large.'],
  415: ['UNSUPPORTED_MEDIA_TYPE', 'Media type is not supported.'],
  422: ['UNPROCESSABLE', 'Request cannot be processed.'],
  429: ['RATE_LIMITED', 'Too many requests.'],
  503: ['SERVICE_UNAVAILABLE', 'Service is unavailable.'],
};
const rejected = ['REQUEST_REJECTED', 'Request was rejected.'] as const;
const internal = ['INTERNAL_ERROR', 'Internal error.'] as const;

function transportStatus(exception: unknown): number | undefined {
  if (exception instanceof HttpException) return exception.getStatus();
  // Fastify transport errors (body parsing, size limits) expose a numeric statusCode.
  const status = (exception as { statusCode?: unknown } | null)?.statusCode;
  return typeof status === 'number' && Number.isInteger(status) && status >= 400 && status < 600 ? status : undefined;
}

/** Maps any thrown value to a status and stable public body; unknown failures become INTERNAL_ERROR. */
export function toApiError(exception: unknown, requestId: string): { status: number; body: ApiErrorBody } {
  if (exception instanceof DomainError) {
    return { status: categoryStatus[exception.category], body: { error: { code: exception.code, message: exception.message, requestId } } };
  }
  const status = transportStatus(exception);
  if (status === undefined || (status >= 500 && status !== 503)) return { status: 500, body: { error: { code: internal[0], message: internal[1], requestId } } };
  const [code, message] = transportErrors[status] ?? rejected;
  return { status, body: { error: { code, message, requestId } } };
}
