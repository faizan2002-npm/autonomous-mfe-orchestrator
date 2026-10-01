import { Controller, All, Req, Res, Logger } from '@nestjs/common';
import type { FastifyRequest, FastifyReply } from 'fastify';
import { ObservationService } from '../observation/observation.service.js';
import { CanaryService } from '../canary/canary.service.js';

const SERVICES: Record<string, string> = {
  'user-service': process.env.USER_SERVICE_URL || 'http://localhost:3001',
  'order-service': process.env.ORDER_SERVICE_URL || 'http://localhost:3002',
};

@Controller()
export class ProxyController {
  private readonly logger = new Logger(ProxyController.name);

  constructor(
    private readonly observationService: ObservationService,
    private readonly canaryService: CanaryService
  ) {}

  @All('api/v1/:service/*')
  async handleProxy(@Req() req: FastifyRequest, @Res() res: FastifyReply) {
    const params = req.params as { service: string; '*': string };
    const { service } = params;
    const subPath = params['*'] || '';
    const targetHost = SERVICES[service];

    if (!targetHost) {
      return res.status(404).send({ error: `Service '${service}' not registered in Gateway.` });
    }

    const targetUrl = `${targetHost}/api/v1/${subPath}`;

    try {
      const upstreamRes = await fetch(targetUrl, {
        method: req.method,
        headers: { 'content-type': 'application/json' },
      });

      const rawData = await upstreamRes.json();

      // Async observation telemetry
      this.observationService
        .observe({
          serviceName: service,
          endpointPath: `/api/v1/${subPath}`,
          httpMethod: req.method,
          observedPayload: rawData,
        })
        .catch((err) => this.logger.error(`Observation error: ${(err as Error).message}`));

      // Canary evaluation and runtime patching
      const isCanary = req.headers['x-mfe-canary'] === 'true' || Math.random() < 0.1;
      const { payload, isPatched } = this.canaryService.applyPatchIfActive(service, rawData, isCanary);

      if (isPatched) {
        res.header('x-orchestrator-healed', 'true');
      }

      return res.status(upstreamRes.status).send(payload);
    } catch (err: unknown) {
      return res.status(502).send({
        error: `Bad Gateway forwarding to ${service}`,
        details: (err as Error).message,
      });
    }
  }
}
