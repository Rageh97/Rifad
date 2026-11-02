/**
 * Public contract of the Identity context (M0-013). Identity proves who a person is; it never decides
 * what they may do (Authorization) or which organizations they belong to (Organizations, G10).
 * The identity provider vendor is not chosen yet (G12); everything here is provider-neutral OIDC.
 */

/** A verified login, independent of any provider SDK. */
export interface AuthenticatedPrincipal {
  /** Platform user ID (UUID) resolved from the external identity. */
  readonly userId: string;
  readonly issuer: string;
  readonly subject: string;
  /** Provider session ID when the token carries one (`sid`). */
  readonly sessionId: string | null;
  readonly authenticatedAt: string;
}

export interface VerifiedToken {
  readonly issuer: string;
  readonly subject: string;
  readonly sessionId: string | null;
  readonly issuedAt: string;
}

/** Verifies a bearer token; rejects with `IdentityError` and never echoes token contents. */
export interface TokenVerifier {
  verify(token: string): Promise<VerifiedToken>;
}

/** Maps an external (issuer, subject) to the platform user ID; undefined when not provisioned. */
export interface UserDirectory {
  findUserId(issuer: string, subject: string): Promise<string | undefined>;
}

export class IdentityError extends Error {
  constructor(readonly code: 'UNAUTHENTICATED' | 'IDENTITY_NOT_PROVISIONED') {
    super(code);
    this.name = 'IdentityError';
  }
}

/** Token verification followed by user resolution: the only way a request becomes a principal. */
export async function authenticate(token: string, verifier: TokenVerifier, users: UserDirectory, now: Date = new Date()): Promise<AuthenticatedPrincipal> {
  const verified = await verifier.verify(token);
  const userId = await users.findUserId(verified.issuer, verified.subject);
  if (!userId) throw new IdentityError('IDENTITY_NOT_PROVISIONED');
  return Object.freeze({ userId, issuer: verified.issuer, subject: verified.subject, sessionId: verified.sessionId, authenticatedAt: now.toISOString() });
}
