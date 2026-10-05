import { timingSafeEqual } from 'node:crypto';
import { Inject, Injectable, type ExecutionContext } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { AuthGuard } from '../auth/auth.guard.js';
import { TOKEN_VERIFIER, type TokenVerifier } from '../auth/token-verifier.js';
import { GATEWAY_CONFIG, type GatewayConfig } from '../config/gateway-config.js';

/**
 * Lets a metrics scraper in with `Authorization: Bearer <METRICS_TOKEN>`;
 * everyone else needs a signed-in session, as before.
 */
@Injectable()
export class MetricsGuard extends AuthGuard {
  constructor(
    @Inject(TOKEN_VERIFIER) verifier: TokenVerifier,
    @Inject(GATEWAY_CONFIG) private readonly config: Pick<GatewayConfig, 'metricsToken'>,
  ) {
    super(verifier);
  }

  override async canActivate(context: ExecutionContext): Promise<boolean> {
    const { metricsToken } = this.config;
    const header = context.switchToHttp().getRequest<FastifyRequest>().headers.authorization;
    if (metricsToken && header && safeEqual(header, `Bearer ${metricsToken}`)) return true;
    return super.canActivate(context);
  }
}

function safeEqual(actual: string, expected: string): boolean {
  const a = Buffer.from(actual);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
