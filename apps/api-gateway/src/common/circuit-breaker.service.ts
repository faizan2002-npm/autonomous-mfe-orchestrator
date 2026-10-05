import { Injectable, Logger } from '@nestjs/common';
import type { Redis } from 'ioredis';

/**
 * Circuit breaker for external service calls: CLOSED (working) → OPEN (failing) → HALF_OPEN (testing).
 * Prevents cascading failures and gives services time to recover.
 * Supports both in-memory (single-instance) and Redis-backed (multi-instance) storage.
 */
@Injectable()
export class CircuitBreakerService {
  private readonly logger = new Logger(CircuitBreakerService.name);
  private readonly breakers = new Map<string, CircuitBreaker>();

  constructor(private readonly redis?: Redis) {
    if (redis) {
      this.logger.log('CircuitBreakerService using Redis backend (multi-instance safe)');
    } else {
      this.logger.log('CircuitBreakerService using in-memory backend (single-instance only)');
    }
  }

  get(key: string, opts?: CircuitBreakerOptions): CircuitBreaker {
    if (!this.breakers.has(key)) {
      const breaker = this.redis
        ? new RedisCircuitBreaker(key, opts, this.redis, this.logger)
        : new CircuitBreaker(key, opts, this.logger);
      this.breakers.set(key, breaker);
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

/**
 * Redis-backed circuit breaker for multi-instance deployments.
 * State is stored in Redis with TTL matching reset timeout, enabling cross-instance coordination.
 */
class RedisCircuitBreaker {
  private readonly failureThreshold: number;
  private readonly resetTimeoutMs: number;
  private readonly halfOpenRequests: number;

  constructor(
    private readonly key: string,
    opts: CircuitBreakerOptions | undefined,
    private readonly redis: Redis,
    private readonly logger: Logger,
  ) {
    this.failureThreshold = opts?.failureThreshold ?? 5;
    this.resetTimeoutMs = opts?.resetTimeoutMs ?? 30_000;
    this.halfOpenRequests = opts?.halfOpenRequests ?? 1;
  }

  async execute<T>(task: () => Promise<T>): Promise<T | undefined> {
    const state = await this.getState();

    if (state.state === CircuitState.OPEN) {
      const now = Date.now();
      if (now < state.nextAttemptAt) {
        return undefined; // Still open, fail fast
      }
      // Attempt recovery
      await this.setState({ ...state, state: CircuitState.HALF_OPEN, successCount: 0 });
      this.logger.log(
        `Circuit breaker [${this.key}] -> HALF_OPEN, attempting recovery (Redis)`,
      );
    }

    try {
      const result = await task();
      await this.onSuccess(state);
      return result;
    } catch (error) {
      await this.onFailure(state);
      throw error;
    }
  }

  private async onSuccess(previousState: CircuitBreakerState): void {
    if (previousState.state === CircuitState.HALF_OPEN) {
      const newSuccessCount = previousState.successCount + 1;
      if (newSuccessCount >= this.halfOpenRequests) {
        await this.setState({
          state: CircuitState.CLOSED,
          failureCount: 0,
          successCount: 0,
          nextAttemptAt: 0,
        });
        this.logger.log(`Circuit breaker [${this.key}] -> CLOSED (Redis)`);
      } else {
        await this.setState({
          ...previousState,
          successCount: newSuccessCount,
        });
      }
    } else if (previousState.state === CircuitState.CLOSED) {
      await this.setState({ ...previousState, failureCount: 0 });
    }
  }

  private async onFailure(previousState: CircuitBreakerState): void {
    if (previousState.state === CircuitState.HALF_OPEN) {
      const nextAttemptAt = Date.now() + this.resetTimeoutMs;
      await this.setState({
        state: CircuitState.OPEN,
        failureCount: previousState.failureCount,
        successCount: 0,
        nextAttemptAt,
      });
      this.logger.warn(
        `Circuit breaker [${this.key}] -> OPEN (recovery failed, Redis, retry at ${new Date(nextAttemptAt).toISOString()})`,
      );
    } else if (previousState.state === CircuitState.CLOSED) {
      const newFailureCount = previousState.failureCount + 1;
      if (newFailureCount >= this.failureThreshold) {
        const nextAttemptAt = Date.now() + this.resetTimeoutMs;
        await this.setState({
          state: CircuitState.OPEN,
          failureCount: newFailureCount,
          successCount: 0,
          nextAttemptAt,
        });
        this.logger.warn(
          `Circuit breaker [${this.key}] -> OPEN (${newFailureCount} failures, Redis, retry at ${new Date(nextAttemptAt).toISOString()})`,
        );
      } else {
        await this.setState({
          ...previousState,
          failureCount: newFailureCount,
        });
      }
    }
  }

  private async getState(): Promise<CircuitBreakerState> {
    const stored = await this.redis.get(`circuit-breaker:${this.key}`);
    if (stored) {
      try {
        return JSON.parse(stored) as CircuitBreakerState;
      } catch {
        this.logger.error(`Failed to parse circuit breaker state from Redis: ${stored}`);
      }
    }
    // Default: closed state
    return {
      state: CircuitState.CLOSED,
      failureCount: 0,
      successCount: 0,
      nextAttemptAt: 0,
    };
  }

  private async setState(state: CircuitBreakerState): Promise<void> {
    // TTL: max time any state persists is the reset timeout
    const ttl = Math.max(Math.ceil(this.resetTimeoutMs / 1000), 60);
    await this.redis.setex(
      `circuit-breaker:${this.key}`,
      ttl,
      JSON.stringify(state),
    );
  }

  async getStateValue(): Promise<CircuitState> {
    const state = await this.getState();
    return state.state;
  }
}

interface CircuitBreakerState {
  state: CircuitState;
  failureCount: number;
  successCount: number;
  nextAttemptAt: number;
}
