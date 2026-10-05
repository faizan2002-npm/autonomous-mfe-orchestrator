import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { AppModule } from './app.module.js';

const PORT = parseInt(process.env['PORT'] || '3005', 10);

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter(),
  );

  // CORS
  await app.register(require('@fastify/cors'), {
    origin: true,
    credentials: true,
  });

  await app.listen(PORT, '0.0.0.0');
  console.log(`Report service listening on http://localhost:${PORT}`);
}

bootstrap().catch((error: Error) => {
  console.error('Failed to start report service:', error);
  process.exit(1);
});
