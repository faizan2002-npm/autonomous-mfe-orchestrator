import pino from 'pino';

/** Structured JSON logger for Kubernetes and cloud environments. */
export function createLogger(name: string) {
  const level = process.env.LOG_LEVEL || 'info';

  return pino(
    {
      level,
      transport: {
        target: 'pino/file',
        options: {
          destination: process.stdout.fd,
        },
      },
    },
    pino.destination({ minLength: 4096 }),
  ).child({ component: name });
}

/**
 * Global request logger with context (request ID, org ID, user ID).
 * Used by HTTP interceptor and services.
 */
export class ContextualLogger {
  private requestId = '';
  private orgId = '';
  private userId = '';

  private logger = pino();

  setContext(ctx: { requestId?: string; orgId?: string; userId?: string }) {
    this.requestId = ctx.requestId || '';
    this.orgId = ctx.orgId || '';
    this.userId = ctx.userId || '';
  }

  info(msg: string, extra?: Record<string, unknown>) {
    this.logger.info(
      { ...this.context(), ...extra },
      msg,
    );
  }

  warn(msg: string, extra?: Record<string, unknown>) {
    this.logger.warn(
      { ...this.context(), ...extra },
      msg,
    );
  }

  error(msg: string, error?: unknown, extra?: Record<string, unknown>) {
    this.logger.error(
      { ...this.context(), ...extra, error },
      msg,
    );
  }

  debug(msg: string, extra?: Record<string, unknown>) {
    this.logger.debug(
      { ...this.context(), ...extra },
      msg,
    );
  }

  private context() {
    return {
      ...(this.requestId && { request_id: this.requestId }),
      ...(this.orgId && { org_id: this.orgId }),
      ...(this.userId && { user_id: this.userId }),
    };
  }
}

export const contextualLogger = new ContextualLogger();
