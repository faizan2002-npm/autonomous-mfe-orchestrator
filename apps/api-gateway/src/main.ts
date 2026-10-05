import { Logger } from '@nestjs/common';
import { createGateway } from './application.js';
import { GATEWAY_CONFIG, type GatewayConfig } from './config/gateway-config.js';

async function bootstrap(): Promise<void> {
  const app = await createGateway();
  const { port } = app.get<GatewayConfig>(GATEWAY_CONFIG);
  try {
    await app.listen(port, '0.0.0.0');
    Logger.log(`API gateway listening on port ${port}`, 'Bootstrap');
  } catch (error) {
    await app.close();
    throw error;
  }
}

void bootstrap().catch((error: unknown) => {
  Logger.error(String(error), undefined, 'Bootstrap');
  process.exitCode = 1;
});
