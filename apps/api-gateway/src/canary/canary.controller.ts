import { Controller, Get, Inject, Query, Req, Res } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { ConsumerAuthService } from '../consumers/consumer-auth.service.js';
import { CanaryService } from './canary.service.js';

@Controller('patches')
export class CanaryController {
  constructor(
    @Inject(CanaryService) private readonly canaryService: CanaryService,
    @Inject(ConsumerAuthService) private readonly auth: ConsumerAuthService,
  ) {}

  /**
   * Module Federation runtime patches for one consumer. `<script>` tags cannot send headers,
   * so the (publishable, origin-restricted) key travels in the query string.
   */
  @Get('remoteEntry.js')
  async getRemoteEntry(
    @Query('service') serviceName: string,
    @Query('key') key: string,
    @Req() req: FastifyRequest,
    @Res() res: FastifyReply,
  ) {
    const consumer = await this.auth.authenticate(
      key,
      typeof req.headers.origin === 'string'
        ? req.headers.origin
        : originOf(req.headers.referer),
    );
    const script = this.canaryService.getModuleFederationScript(
      consumer.orgId,
      consumer.consumerId,
      String(serviceName ?? ''),
    );
    return res.type('application/javascript').send(script);
  }
}

function originOf(referer: string | undefined): string | undefined {
  try {
    return referer ? new URL(referer).origin : undefined;
  } catch {
    return undefined;
  }
}
