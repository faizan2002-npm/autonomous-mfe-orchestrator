import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { AppModule } from './app.module.js';

async function bootstrap() {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({ logger: true })
  );

  app.enableCors({ origin: true });

  const port = Number(process.env.GATEWAY_PORT) || 4000;
  await app.listen(port, '0.0.0.0');
  console.log(`🛡️  NestJS (Fastify) Autonomous API Gateway running on http://localhost:${port}`);
}

bootstrap().catch((err) => {
  console.error('Fatal bootstrap error:', err);
  process.exit(1);
});
