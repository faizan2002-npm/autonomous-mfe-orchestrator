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
import { ProxyService } from './proxy.service.js';

const CANARY_HEADER = 'x-mfe-canary';

@Controller()
export class ProxyController {
  constructor(
    @Inject(ProxyService) private readonly proxyService: ProxyService,
  ) {}

  @All('api/v1/:service/*')
  async handleProxy(@Req() req: FastifyRequest, @Res() res: FastifyReply) {
    const { service, '*': subPath = '' } = req.params as {
      service: string;
      '*': string;
    };
    const queryStart = req.url.indexOf('?');
    try {
      const result = await this.proxyService.forward({
        service,
        subPath,
        method: req.method,
        query: queryStart === -1 ? '' : req.url.slice(queryStart),
        body: req.body,
        canary: parseCanaryHeader(req.headers[CANARY_HEADER]),
      });
      if (result.isPatched) res.header('x-orchestrator-healed', 'true');
      return res.status(result.status).send(result.payload);
    } catch (error: unknown) {
      if (error instanceof HttpException) throw error;
      throw new BadGatewayException(`Bad Gateway forwarding to ${service}`, {
        description: String(error),
      });
    }
  }
}

function parseCanaryHeader(
  value: string | string[] | undefined,
): boolean | undefined {
  if (value === 'true') return true;
  if (value === 'false') return false;
  return undefined;
}
