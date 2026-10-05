import { Injectable, Logger } from '@nestjs/common';

/**
 * Circuit breaker for external service calls: CLOSED (working) → OPEN (failing) → HALF_OPEN (testing).
 * Prevents cascading failures and gives services time to recover.
 */
@Injectable()
export class CircuitBreakerService {
  private readonly logger = new Logger(CircuitBreakerService.name);
  private readonly breakers = new Map<string, CircuitBreaker>();

  get(key: string, opts?: CircuitBreakerOptions): CircuitBreaker {
    if (!this.breakers.has(key)) {
      this.breakers.set(key, new CircuitBreaker(key, opts, this.logger));
    }
    return this.breakers.get(key)!;
  }
}

export interface CircuitBreakerOptions {
  /** Consecutive failures before opening (default: 5). */
  failureThreshold?: number;
  /** Time in ms to wait before attempting recovery (default: 30s). */
  resetTimeoutMs?: number;
  /** Maximum attempts during HALF_OPEN state before opening again (default: 1). */
  halfOpenRequests?: number;
}

export enum CircuitState {
  CLOSED = 'CLOSED',
  OPEN = 'OPEN',
  HALF_OPEN = 'HALF_OPEN',
}

class CircuitBreaker {
  private state = CircuitState.CLOSED;
  private failureCount = 0;
  private successCount = 0;
  private nextAttemptAt = 0;

  private readonly failureThreshold: number;
  private readonly resetTimeoutMs: number;
  private readonly halfOpenRequests: number;

  constructor(
    private readonly key: string,
    opts: CircuitBreakerOptions | undefined,
    private readonly logger: Logger,
  ) {
    this.failureThreshold = opts?.failureThreshold ?? 5;
    this.resetTimeoutMs = opts?.resetTimeoutMs ?? 30_000;
    this.halfOpenRequests = opts?.halfOpenRequests ?? 1;
  }

  /**
   * Attempts to execute the task if the circuit is not open.
   * Returns undefined if the circuit is open (fail-fast).
   */
  async execute<T>(task: () => Promise<T>): Promise<T | undefined> {
    if (this.state === CircuitState.OPEN) {
      const now = Date.now();
      if (now < this.nextAttemptAt) {
        return undefined; // Still open, fail fast
      }
      // Attempt recovery
      this.state = CircuitState.HALF_OPEN;
      this.successCount = 0;
      this.logger.log(
        `Circuit breaker [${this.key}] -> HALF_OPEN, attempting recovery`,
      );
    }

    try {
      const result = await task();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }

  private onSuccess(): void {
    if (this.state === CircuitState.HALF_OPEN) {
      this.successCount++;
      if (this.successCount >= this.halfOpenRequests) {
        this.state = CircuitState.CLOSED;
        this.failureCount = 0;
        this.logger.log(`Circuit breaker [${this.key}] -> CLOSED`);
      }
    } else if (this.state === CircuitState.CLOSED) {
      this.failureCount = 0;
    }
  }

  private onFailure(): void {
    if (this.state === CircuitState.HALF_OPEN) {
      this.state = CircuitState.OPEN;
      this.nextAttemptAt = Date.now() + this.resetTimeoutMs;
      this.logger.warn(
        `Circuit breaker [${this.key}] -> OPEN (recovery failed, retry at ${new Date(this.nextAttemptAt).toISOString()})`,
      );
    } else if (this.state === CircuitState.CLOSED) {
      this.failureCount++;
      if (this.failureCount >= this.failureThreshold) {
        this.state = CircuitState.OPEN;
        this.nextAttemptAt = Date.now() + this.resetTimeoutMs;
        this.logger.warn(
          `Circuit breaker [${this.key}] -> OPEN (${this.failureCount} failures, retry at ${new Date(this.nextAttemptAt).toISOString()})`,
        );
      }
    }
  }

  getState(): CircuitState {
    return this.state;
  }
}
