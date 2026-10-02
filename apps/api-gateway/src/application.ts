import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { AppModule } from './app.module.js';
import { GATEWAY_CONFIG, type GatewayConfig } from './config/gateway-config.js';

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
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    if (options.shutdownHooks !== false) app.enableShutdownHooks();
    await app.init();
    return app;
  } catch (error) {
    await app.close();
    throw error;
  }
}
