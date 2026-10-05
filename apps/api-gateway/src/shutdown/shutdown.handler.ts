import { INestApplication, Logger } from '@nestjs/common';

/**
 * Handles graceful shutdown: stops accepting new connections, drains in-flight requests,
 * closes background workers, and exits cleanly within a timeout.
 * Implements SIGTERM/SIGINT signal handling for Kubernetes and Docker.
 */
export class GracefulShutdownHandler {
  private readonly logger = new Logger(GracefulShutdownHandler.name);
  private isShuttingDown = false;
  private timeoutHandle?: NodeJS.Timeout;

  constructor(
    private readonly app: INestApplication,
    private readonly timeoutMs: number = 30_000,
  ) {}

  register(): void {
    // Listen for termination signals (Kubernetes sends SIGTERM)
    process.on('SIGTERM', () => this.handleShutdown('SIGTERM'));
    process.on('SIGINT', () => this.handleShutdown('SIGINT'));
  }

  private async handleShutdown(signal: string): Promise<void> {
    if (this.isShuttingDown) {
      this.logger.warn(
        `Shutdown already in progress, ignoring ${signal}`,
      );
      return;
    }

    this.isShuttingDown = true;
    const shutdownStart = Date.now();
    this.logger.log(
      `Received ${signal}, starting graceful shutdown (timeout: ${this.timeoutMs}ms)`,
    );

    // Set a hard timeout to force exit if shutdown takes too long
    this.timeoutHandle = setTimeout(() => {
      const elapsed = Date.now() - shutdownStart;
      this.logger.error(
        `Graceful shutdown exceeded timeout (${elapsed}ms), forcing exit`,
      );
      process.exit(1);
    }, this.timeoutMs);

    try {
      // Step 1: Mark as shutting down (health probes will return 503)
      this.app.get('HealthService').markShuttingDown();
      this.logger.log('Health probes now returning 503 (draining traffic)');

      // Step 2: Close HTTP server (stop accepting new connections)
      this.logger.log('Closing HTTP server...');
      await this.app.getHttpServer().close();

      // Step 3: Close application (triggers onModuleDestroy hooks)
      this.logger.log('Shutting down application modules...');
      await this.app.close();

      const elapsed = Date.now() - shutdownStart;
      this.logger.log(`Graceful shutdown completed in ${elapsed}ms`);

      // Clear timeout and exit cleanly
      if (this.timeoutHandle) clearTimeout(this.timeoutHandle);
      process.exit(0);
    } catch (error) {
      const elapsed = Date.now() - shutdownStart;
      this.logger.error(
        `Error during shutdown after ${elapsed}ms: ${String(error)}`,
      );
      if (this.timeoutHandle) clearTimeout(this.timeoutHandle);
      process.exit(1);
    }
  }

  isShuttingDown_(): boolean {
    return this.isShuttingDown;
  }
}
