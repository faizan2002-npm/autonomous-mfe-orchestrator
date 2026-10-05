import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { AppModule } from './app.module.js';
import { GATEWAY_CONFIG, type GatewayConfig } from './config/gateway-config.js';
import { HttpMetricsInterceptor } from './observability/http-metrics.interceptor.js';
import { MetricsService } from './observability/metrics.service.js';

export async function createGateway(
  options: { logger?: false; shutdownHooks?: boolean } = {},
): Promise<NestFastifyApplication> {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter(),
    {
      logger: options.logger,
      abortOnError: false,
    },
  );
  try {
    const { allowedOrigins } = app.get<GatewayConfig>(GATEWAY_CONFIG);
    // Consumer traffic may come from any origin a publishable key allows; that check needs the
    // key, which preflights don't carry, so it happens on the real request. The management API
    // is limited to the dashboard origins.
    type CorsCallback = (
      error: Error | null,
      options: Record<string, unknown>,
    ) => void;
    // @fastify/cors takes per-request options as a factory returning a delegator.
    const perRequestCors =
      () => (request: { url?: string }, callback: CorsCallback) => {
        const consumerRoute = /^\/(api\/v1|patches)\//.test(request.url ?? '');
        callback(null, {
          origin: consumerRoute ? true : allowedOrigins,
          // Lets the micro-frontends read whether a response was healed.
          exposedHeaders: ['x-orchestrator-healed'],
        });
      };
    app.enableCors(perRequestCors as never);

    // Security headers: prevent common web vulnerabilities
    // Using a Fastify hook instead of helmet plugin for better compatibility
    const fastifyInstance = app.getHttpAdapter().getInstance();
    fastifyInstance.addHook('onSend', async (_request, reply) => {
      // Strict-Transport-Security: enforce HTTPS
      reply.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');

      // X-Content-Type-Options: prevent MIME type sniffing
      reply.header('X-Content-Type-Options', 'nosniff');

      // X-Frame-Options: prevent clickjacking
      reply.header('X-Frame-Options', 'DENY');

      // X-XSS-Protection: legacy XSS protection
      reply.header('X-XSS-Protection', '1; mode=block');

      // Referrer-Policy: control referrer information
      reply.header('Referrer-Policy', 'strict-origin-when-cross-origin');

      // Permissions-Policy: restrict browser features
      reply.header(
        'Permissions-Policy',
        'camera=(), microphone=(), geolocation=(), usb=(), magnetometer=(), gyroscope=(), accelerometer=()'
      );

      // Content-Security-Policy: restrict resource loading
      reply.header(
        'Content-Security-Policy',
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; connect-src 'self'; frame-src 'none'; object-src 'none'"
      );
    });

    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );

    // Register global HTTP metrics interceptor
    const metricsService = app.get(MetricsService);
    app.useGlobalInterceptors(new HttpMetricsInterceptor(metricsService));

    // Setup Swagger/OpenAPI documentation
    const config = new DocumentBuilder()
      .setTitle('Autonomous MFE Orchestrator API')
      .setDescription(
        'Multi-tenant API gateway for detecting and healing API contract drift between upstream services and micro-frontend consumers.',
      )
      .setVersion('1.0.0')
      .addBearerAuth(
        { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
        'bearer',
      )
      .addApiKey(
        { type: 'apiKey', name: 'x-api-key', in: 'header' },
        'api-key',
      )
      .addServer(
        `http://localhost:${app.get<GatewayConfig>(GATEWAY_CONFIG).port}`,
        'Local development',
      )
      .addTag('auth', 'Authentication and authorization')
      .addTag('orgs', 'Organization management')
      .addTag('consumers', 'API consumer (micro-frontend) management')
      .addTag('services', 'Upstream service registry')
      .addTag('contracts', 'API contract observation and drift detection')
      .addTag('healing', 'Contract healing and patch generation')
      .addTag('health', 'Service health checks')
      .addTag('metrics', 'Prometheus metrics')
      .build();

    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup('docs', app, document, {
      swaggerOptions: {
        defaultModelsExpandDepth: 1,
        deepLinking: true,
      },
    });

    if (options.shutdownHooks !== false) app.enableShutdownHooks();
    await app.init();
    return app;
  } catch (error) {
    await app.close();
    throw error;
  }
}
