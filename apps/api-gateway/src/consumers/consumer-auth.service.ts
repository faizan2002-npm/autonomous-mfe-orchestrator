import {
  ForbiddenException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { apiKeyKind } from '@orchestrator/crypto';
import { Redis } from 'ioredis';
import {
  GATEWAY_CONFIG,
  type GatewayConfig,
} from '../config/gateway-config.js';
import {
  ConsumersService,
  type ResolvedConsumer,
} from './consumers.service.js';
import { REDIS_CLIENT } from '../redis/redis.tokens.js';

export const KEY_HEADER = 'x-orchestrator-key';

/** Authenticates proxied traffic: which organization and consumer is calling, and may it? */
@Injectable()
export class ConsumerAuthService {
  constructor(
    @Inject(ConsumersService) private readonly consumers: ConsumersService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    @Inject(GATEWAY_CONFIG) private readonly config: GatewayConfig,
  ) {}

  async authenticate(
    rawKey: string | undefined,
    origin: string | undefined,
  ): Promise<ResolvedConsumer> {
    if (!rawKey || !apiKeyKind(rawKey))
      throw new UnauthorizedException(
        `Send a consumer API key in the ${KEY_HEADER} header`,
      );
    const consumer = await this.consumers.resolveKey(rawKey);
    if (!consumer)
      throw new UnauthorizedException('Unknown or revoked API key');
    if (
      consumer.keyType === 'publishable' &&
      (!origin || !consumer.allowedOrigins.includes(origin))
    )
      throw new ForbiddenException(
        'This publishable key is not allowed from this origin',
      );
    await this.enforceRateLimit(consumer.keyId);
    void this.consumers.touchKey(consumer.keyId).catch(() => undefined);
    return consumer;
  }

  private async enforceRateLimit(keyId: string): Promise<void> {
    const window = Math.floor(Date.now() / 60_000);
    const key = `rate:${keyId}:${window}`;
    const [[, count]] = (await this.redis
      .multi()
      .incr(key)
      .expire(key, 70)
      .exec()) as [[unknown, number], unknown];
    if (count > this.config.rateLimitPerMinute)
      throw new HttpException(
        {
          statusCode: 429,
          message: `Rate limit of ${this.config.rateLimitPerMinute} requests/minute exceeded`,
          retryAfterSeconds: 60 - (Math.floor(Date.now() / 1000) % 60),
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
  }
}
