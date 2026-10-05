/**
 * Exponential backoff retry policy for upstream service calls.
 * Retries transient errors (5xx, timeouts) but gives up on permanent errors (4xx).
 */
export class RetryPolicy {
  private readonly maxAttempts: number;
  private readonly initialDelayMs: number;
  private readonly maxDelayMs: number;
  private readonly jitterPercent: number = 10;

  constructor(options?: {
    maxAttempts?: number;
    initialDelayMs?: number;
    maxDelayMs?: number;
  }) {
    this.maxAttempts = options?.maxAttempts ?? 3;
    this.initialDelayMs = options?.initialDelayMs ?? 100;
    this.maxDelayMs = options?.maxDelayMs ?? 1000;
  }

  /**
   * Execute a task with exponential backoff retry.
   * @param task The async task to retry
   * @param name For logging (e.g., "fetch user-service")
   * @returns The task result or throws the final error
   */
  async execute<T>(
    task: () => Promise<T>,
    name: string = 'task',
  ): Promise<T> {
    let lastError: Error | undefined;

    for (let attempt = 1; attempt <= this.maxAttempts; attempt++) {
      try {
        return await task();
      } catch (error) {
        lastError = this.normalizeError(error);

        // Check if this error is retryable
        if (!this.isRetryable(lastError)) {
          throw lastError; // Give up immediately on permanent errors
        }

        // If this is the last attempt, throw the error
        if (attempt === this.maxAttempts) {
          throw lastError;
        }

        // Wait before retrying
        const delayMs = this.calculateBackoff(attempt);
        console.warn(
          `[${name}] Attempt ${attempt} failed (retryable), retrying in ${delayMs}ms: ${lastError.message}`,
        );
        await this.sleep(delayMs);
      }
    }

    // Should not reach here, but throw last error if we do
    throw lastError || new Error('Unknown error during retry loop');
  }

  /**
   * Determines if an error is transient and should be retried.
   * Retries: 5xx, 503/504 specifically, timeouts, connection reset
   * Permanent: 4xx (except 408/429), specific error types
   */
  private isRetryable(error: Error): boolean {
    const message = error.message.toLowerCase();

    // Timeout errors are retryable
    if (
      message.includes('timeout') ||
      message.includes('timed out') ||
      message.includes('deadline')
    ) {
      return true;
    }

    // Connection errors are retryable
    if (
      message.includes('econnrefused') ||
      message.includes('econnreset') ||
      message.includes('connection reset') ||
      message.includes('connect econnrefused') ||
      message.includes('socket hang up')
    ) {
      return true;
    }

    // Check HTTP status codes if available
    if ('status' in error && typeof error.status === 'number') {
      const status = error.status;

      // 5xx errors are retryable (server errors)
      if (status >= 500 && status < 600) {
        return true;
      }

      // 408 (Request Timeout) and 429 (Too Many Requests) are retryable
      if (status === 408 || status === 429) {
        return true;
      }

      // 4xx errors (except 408/429) are not retryable
      if (status >= 400 && status < 500) {
        return false;
      }
    }

    // DNS lookup failures are retryable
    if (message.includes('enotfound') || message.includes('getaddrinfo')) {
      return true;
    }

    // Default: assume retryable (conservative approach for unknown errors)
    return true;
  }

  /**
   * Calculate exponential backoff with jitter.
   * Avoids thundering herd when multiple clients retry simultaneously.
   * Formula: min(initialDelay * 2^(attempt-1) * (1 ± jitter%), maxDelay)
   */
  private calculateBackoff(attempt: number): number {
    // Exponential: 100ms, 200ms, 400ms, 800ms, ...
    const exponential = this.initialDelayMs * Math.pow(2, attempt - 1);

    // Cap at max delay
    const capped = Math.min(exponential, this.maxDelayMs);

    // Add jitter: ± 10% of the delay
    const jitterAmount = capped * (this.jitterPercent / 100);
    const jitterMultiplier = 1 + (Math.random() - 0.5) * 2 * (this.jitterPercent / 100);
    const withJitter = capped * jitterMultiplier;

    // Ensure result is positive
    return Math.max(1, Math.round(withJitter));
  }

  private normalizeError(error: unknown): Error {
    if (error instanceof Error) {
      return error;
    }
    if (typeof error === 'string') {
      return new Error(error);
    }
    return new Error(String(error));
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

/**
 * Global default retry policy (3 retries, 100-1000ms exponential backoff).
 * Can be customized per call via RetryPolicy constructor.
 */
export const defaultRetryPolicy = new RetryPolicy({
  maxAttempts: 3,
  initialDelayMs: 100,
  maxDelayMs: 1000,
});
