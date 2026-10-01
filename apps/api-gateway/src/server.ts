import Fastify from 'fastify';
import cors from '@fastify/cors';
import { observeAndEvaluateDrift } from './engine/observation.js';
import {
  applyPatchIfActive,
  generateModuleFederationEntry,
  promotePatch,
} from './engine/canary.js';
import { prisma } from './db.js';

const fastify = Fastify({ logger: true });

await fastify.register(cors, { origin: true });

// Downstream service map
const SERVICES: Record<string, string> = {
  'user-service': process.env.USER_SERVICE_URL || 'http://localhost:3001',
  'order-service': process.env.ORDER_SERVICE_URL || 'http://localhost:3002',
};

// Virtual File System endpoint for Webpack Module Federation dynamic remote entry
fastify.get('/patches/:serviceName/remoteEntry.js', async (req, reply) => {
  const { serviceName } = req.params as { serviceName: string };
  const jsContent = generateModuleFederationEntry(serviceName);
  return reply.type('application/javascript').send(jsContent);
});

// Telemetry & Governance APIs for Dashboard
fastify.get('/api/governance/overview', async (_req, reply) => {
  const [services, driftEvents, patches, audits] = await Promise.all([
    prisma.serviceRegistry.findMany(),
    prisma.driftEvent.findMany({ take: 20, orderBy: { detectedAt: 'desc' } }),
    prisma.patchRegistry.findMany({ take: 10, orderBy: { createdAt: 'desc' } }),
    prisma.governanceAudit.findMany({ take: 10, orderBy: { createdAt: 'desc' } }),
  ]);

  return reply.status(200).send({
    services,
    driftEvents,
    patches,
    audits,
  });
});

// Manual Promotion / Canary control endpoint
fastify.post('/api/governance/patches/:patchId/promote', async (req, reply) => {
  const { patchId } = req.params as { patchId: string };
  const { serviceName } = req.body as { serviceName: string };
  await promotePatch(patchId, serviceName);
  return reply.status(200).send({ message: `Patch ${patchId} promoted to 100% production.` });
});

// Reverse Proxy & Observation Dispatcher
fastify.all('/api/v1/:service/*', async (req, reply) => {
  const { service } = req.params as { service: string };
  const targetHost = SERVICES[service];

  if (!targetHost) {
    return reply.status(404).send({ error: `Service '${service}' not registered in Gateway.` });
  }

  // Construct target downstream URL
  const subPath = (req.params as Record<string, string>)['*'] || '';
  const targetUrl = `${targetHost}/api/v1/${subPath}`;

  try {
    const upstreamRes = await fetch(targetUrl, {
      method: req.method,
      headers: {
        'content-type': 'application/json',
      },
    });

    const rawData = await upstreamRes.json();

    // 1. Observation & Asynchronous Drift Evaluation
    observeAndEvaluateDrift({
      serviceId: service,
      serviceName: service,
      endpointPath: `/api/v1/${subPath}`,
      httpMethod: req.method,
      observedPayload: rawData,
    }).catch((err) => console.error('[ObservationEngine] Intercept Error:', err));

    // 2. Canary Routing Decision (Canary header or 10% sampling)
    const isCanary = req.headers['x-mfe-canary'] === 'true' || Math.random() < 0.1;
    const { payload, isPatched } = applyPatchIfActive(service, rawData, isCanary);

    if (isPatched) {
      reply.header('x-orchestrator-healed', 'true');
    }

    return reply.status(upstreamRes.status).send(payload);
  } catch (err: unknown) {
    return reply.status(502).send({
      error: `Bad Gateway forwarding to ${service}`,
      details: (err as Error).message,
    });
  }
});

fastify.get('/health', async () => ({ status: 'UP', service: 'api-gateway' }));

const port = Number(process.env.GATEWAY_PORT) || 4000;
fastify.listen({ port, host: '0.0.0.0' }, (err, address) => {
  if (err) {
    fastify.log.error(err);
    process.exit(1);
  }
  console.log(`🛡️  Autonomous API Gateway running at ${address}`);
});
