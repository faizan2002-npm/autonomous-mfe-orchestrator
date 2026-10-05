import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import type { FastifyInstance } from 'fastify';

/** Create a test app with mocked dependencies. */
export async function createTestApp(imports: any[] = [], providers: any[] = [], controllers: any[] = []): Promise<INestApplication> {
  const module: TestingModule = await Test.createTestingModule({
    imports,
    providers,
    controllers,
  }).compile();

  return module.createNestApplication();
}

/** Extract org ID from bearer token payload (test helper). */
export function extractOrgFromToken(token: string): string | null {
  try {
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString());
    return payload.org_id ?? null;
  } catch {
    return null;
  }
}

/** Mock Supabase JWT for tests. */
export function createMockToken(
  userId: string,
  email: string,
  issuer: string = 'http://localhost:54399/auth/v1',
  audience: string = 'authenticated',
): string {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(
    JSON.stringify({
      iss: issuer,
      aud: audience,
      sub: userId,
      email,
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 3600,
    }),
  ).toString('base64url');
  return `${header}.${payload}.signature`;
}

/** Inject a request with auth headers. */
export function withAuth(method: string, url: string, token: string) {
  return {
    method,
    url,
    headers: { authorization: `Bearer ${token}` },
  };
}
