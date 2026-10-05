import { Logger } from '@nestjs/common';
import { createGateway } from './application.js';
import { GATEWAY_CONFIG, type GatewayConfig } from './config/gateway-config.js';
import { GracefulShutdownHandler } from './shutdown/shutdown.handler.js';

async function bootstrap(): Promise<void> {
  const app = await createGateway();
  const config = app.get<GatewayConfig>(GATEWAY_CONFIG);
  const logger = new Logger('Bootstrap');

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

void bootstrap().catch((error: unknown) => {
  new Logger('Bootstrap').error(String(error));
  process.exitCode = 1;
});
