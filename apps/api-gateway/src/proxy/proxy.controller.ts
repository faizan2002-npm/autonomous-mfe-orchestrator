import {
  All,
  BadGatewayException,
  Controller,
  HttpException,
  Inject,
  Req,
  Res,
} from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import {
  ConsumerAuthService,
  KEY_HEADER,
} from '../consumers/consumer-auth.service.js';
import { ProxyService } from './proxy.service.js';

const CANARY_HEADER = 'x-mfe-canary';

/** Public entry point for consumer traffic, authenticated by consumer API key. */
@Controller()
export class ProxyController {
  constructor(
    @Inject(ProxyService) private readonly proxyService: ProxyService,
    @Inject(ConsumerAuthService) private readonly auth: ConsumerAuthService,
  ) {}

  @All('api/v1/:service/*')
  async handleProxy(@Req() req: FastifyRequest, @Res() res: FastifyReply) {
    const { service, '*': subPath = '' } = req.params as {
      service: string;
      '*': string;
    };
    const consumer = await this.auth.authenticate(
      header(req.headers[KEY_HEADER]),
      header(req.headers.origin),
    );
    const queryStart = req.url.indexOf('?');
    try {
      const result = await this.proxyService.forward({
        consumer,
        service,
        subPath,
        method: req.method,
        query: queryStart === -1 ? '' : req.url.slice(queryStart),
        body: req.body,
        headers: req.headers,
        canary: parseCanaryHeader(req.headers[CANARY_HEADER]),
      });
      if (result.isPatched) res.header('x-orchestrator-healed', 'true');
      return res.status(result.status).send(result.payload);
    } catch (error: unknown) {
      if (error instanceof HttpException) throw error;
      throw new BadGatewayException(`Bad Gateway forwarding to ${service}`, {
        description: describeUpstreamError(error),
      });
    }
  }
}

const header = (value: string | string[] | undefined) =>
  typeof value === 'string' ? value : undefined;

function parseCanaryHeader(
  value: string | string[] | undefined,
): boolean | undefined {
  if (value === 'true') return true;
  if (value === 'false') return false;
  return undefined;
}

/** fetch hides the useful part (e.g. ECONNREFUSED, blocked address) in `cause`. */
function describeUpstreamError(error: unknown): string {
  const cause = (error as { cause?: { message?: string; code?: string } })
    ?.cause;
  const base = error instanceof Error ? error.message : String(error);
  return cause?.message
    ? `${base}: ${cause.code ? `${cause.code} ` : ''}${cause.message}`
    : base;
}
