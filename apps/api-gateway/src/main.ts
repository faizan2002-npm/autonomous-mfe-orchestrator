import { Logger } from '@nestjs/common';
import { createGateway } from './application.js';
import { GATEWAY_CONFIG, type GatewayConfig } from './config/gateway-config.js';
import { GracefulShutdownHandler } from './shutdown/shutdown.handler.js';

const logger = new Logger('Bootstrap');

/**
 * Validate that all required environment variables are set.
 * Fails fast with a clear message listing which variables are missing.
 */
function validateEnvironment(): void {
  const requiredVars = [
    'SUPABASE_PROJECT_REF',
    'SUPABASE_DB_PASSWORD',
    'SUPABASE_POOLER_HOST',
    'ENCRYPTION_KEY',
    'KEY_PEPPER',
    'GATEWAY_PORT',
    'ALLOWED_ORIGINS',
    'USER_SERVICE_URL',
    'ORDER_SERVICE_URL',
    'GEMINI_API_KEY',
  ];

  const missing = requiredVars.filter(
    (variable) => !process.env[variable],
  );

  if (missing.length > 0) {
    logger.error(
      `Missing required environment variables: ${missing.join(', ')}`,
    );
    process.exit(1);
  }

  logger.log('All required environment variables are set');
}

// Catch uncaught exceptions (synchronous errors in async handlers)
process.on('uncaughtException', (error: Error) => {
  logger.error(`Uncaught exception: ${error.message}`, error.stack);
  process.exitCode = 1;
});

// Catch unhandled promise rejections
process.on('unhandledRejection', (reason: unknown) => {
  const message = reason instanceof Error ? reason.message : String(reason);
  logger.error(`Unhandled promise rejection: ${message}`, reason instanceof Error ? reason.stack : String(reason));
  process.exitCode = 1;
});

async function bootstrap(): Promise<void> {
  const app = await createGateway();
  const config = app.get<GatewayConfig>(GATEWAY_CONFIG);

  try {
    // Enable graceful shutdown handling
    app.enableShutdownHooks();
    const shutdownHandler = new GracefulShutdownHandler(app, 30_000); // 30s timeout
    shutdownHandler.register();

    await app.listen(config.port, '0.0.0.0');
    logger.log(`API gateway listening on port ${config.port}`);
    logger.log('Graceful shutdown enabled (SIGTERM/SIGINT will trigger 30s drain)');
  } catch (error) {
    await app.close();
    throw error;
  }
}

validateEnvironment();
void bootstrap().catch((error: unknown) => {
  new Logger('Bootstrap').error(String(error));
  process.exitCode = 1;
});
