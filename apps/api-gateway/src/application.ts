import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { AppModule } from './app.module.js';

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
    app.enableCors({ origin: true });
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
