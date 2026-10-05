import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';

export const TOKEN_VERIFIER = Symbol('TOKEN_VERIFIER');

export interface AuthenticatedUser {
  id: string;
  email: string | null;
}

export interface TokenVerifier {
  /** Resolves the user for a valid access token; rejects otherwise. */
  verify(token: string): Promise<AuthenticatedUser>;
}

/**
 * Verifies Supabase Auth access tokens against the project's published signing keys
 * (asymmetric JWT signing keys; the JWKS is fetched once and cached by jose).
 */
export class SupabaseJwtVerifier implements TokenVerifier {
  private readonly keys: JWTVerifyGetKey;
  private readonly issuer: string;

  constructor(supabaseUrl: string) {
    this.issuer = `${supabaseUrl}/auth/v1`;
    this.keys = createRemoteJWKSet(
      new URL(`${this.issuer}/.well-known/jwks.json`),
    );
  }

  async verify(token: string): Promise<AuthenticatedUser> {
    const { payload } = await jwtVerify(token, this.keys, {
      issuer: this.issuer,
      audience: 'authenticated',
    });
    if (!payload.sub) throw new Error('Token has no subject');
    return {
      id: payload.sub,
      email: typeof payload.email === 'string' ? payload.email : null,
    };
  }
}

/** Used when SUPABASE_URL is not configured: every request is refused. */
export class DisabledTokenVerifier implements TokenVerifier {
  async verify(): Promise<AuthenticatedUser> {
    throw new Error('Authentication is not configured (set SUPABASE_URL)');
  }
}
