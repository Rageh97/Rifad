import type { DomainError } from './domain-error';

export type Result<T, E = DomainError> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E };

export function ok<T>(value: T): Result<T, never> {
  return Object.freeze({ ok: true as const, value });
}

export function err<E>(error: E): Result<never, E> {
  return Object.freeze({ ok: false as const, error });
}
