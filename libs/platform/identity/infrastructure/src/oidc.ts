import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';
import { IdentityError, type TokenVerifier, type VerifiedToken } from '@rifad/identity-contract';

export interface OidcVerifierOptions {
  /** Expected `iss`, exactly as the provider publishes it. */
  readonly issuer: string;
  /** Expected `aud` (this API's client/resource ID). */
  readonly audience: string;
  /** JWKS endpoint; must be https except on loopback (local test providers). */
  readonly jwksUrl: string;
  /** Test seam: a local key set instead of fetching the JWKS. */
  readonly keys?: JWTVerifyGetKey;
}

const loopback = new Set(['127.0.0.1', 'localhost', '[::1]']);
const tokenShape = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;

/**
 * Standard OIDC access-token verification with `jose` (signature via JWKS, issuer, audience, expiry,
 * asymmetric algorithms only). No vendor SDK, so the provider can change without touching
 * authorization (M0-013 acceptance, G12).
 */
export function oidcTokenVerifier(options: OidcVerifierOptions): TokenVerifier {
  const url = new URL(options.jwksUrl);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback.has(url.hostname))) throw new TypeError('JWKS URL must use https');
  const keys = options.keys ?? createRemoteJWKSet(url, { timeoutDuration: 5_000, cooldownDuration: 30_000 });
  return Object.freeze({
    async verify(token: string): Promise<VerifiedToken> {
      if (typeof token !== 'string' || token.length > 8_192 || !tokenShape.test(token)) throw new IdentityError('UNAUTHENTICATED');
      try {
        const { payload } = await jwtVerify(token, keys, {
          issuer: options.issuer, audience: options.audience, algorithms: ['RS256', 'PS256', 'ES256', 'EdDSA'], clockTolerance: 30, requiredClaims: ['sub', 'exp', 'iat'],
        });
        const subject = payload.sub;
        if (!subject || subject.length > 255) throw new IdentityError('UNAUTHENTICATED');
        const sessionId = typeof payload['sid'] === 'string' && payload['sid'].length <= 255 ? payload['sid'] : null;
        return Object.freeze({ issuer: options.issuer, subject, sessionId, issuedAt: new Date((payload.iat ?? 0) * 1000).toISOString() });
      } catch {
        // Expired, wrong issuer/audience, bad signature or unreachable JWKS: all fail closed alike.
        throw new IdentityError('UNAUTHENTICATED');
      }
    },
  });
}
