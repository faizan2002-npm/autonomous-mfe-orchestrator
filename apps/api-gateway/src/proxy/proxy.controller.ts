import {
  Inject,
  Controller,
  All,
  Req,
  Res,
  NotFoundException,
} from '@nestjs/common';
import type { FastifyRequest, FastifyReply } from 'fastify';
import { ProxyService } from './proxy.service.js';

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
    const query = queryStart === -1 ? '' : req.url.slice(queryStart);
    try {
      const isCanary =
        req.headers['x-mfe-canary'] === 'true' || Math.random() < 0.1;
      const result = await this.proxyService.forward({
        service,
        subPath,
        method: req.method,
        query,
        body: req.body,
        isCanary,
      });
      if (result.isPatched) res.header('x-orchestrator-healed', 'true');
      return res.status(result.status).send(result.payload);
    } catch (error: unknown) {
      if (error instanceof NotFoundException)
        return res.status(404).send({ error: error.message });
      return res.status(502).send({
        error: `Bad Gateway forwarding to ${service}`,
        details: String(error),
      });
    }
  }
}
