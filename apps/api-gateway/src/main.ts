import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createGateway } from './application.js';

async function bootstrap(): Promise<void> {
  const app = await createGateway();
  const port = app.get(ConfigService).getOrThrow<number>('GATEWAY_PORT');
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
