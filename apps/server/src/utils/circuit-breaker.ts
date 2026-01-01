/**
 * Circuit Breaker Pattern Implementation
 *
 * Prevents cascading failures by temporarily blocking requests to a failing service.
 *
 * States:
 * - CLOSED: Normal operation, requests flow through
 * - OPEN: Service is failing, requests are blocked immediately
 * - HALF_OPEN: Testing if service has recovered
 *
 * Transitions:
 * - CLOSED -> OPEN: When failure count exceeds threshold
 * - OPEN -> HALF_OPEN: After cooldown period expires
 * - HALF_OPEN -> CLOSED: On successful request
 * - HALF_OPEN -> OPEN: On failed request
 */

export type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export interface CircuitBreakerConfig {
  // Number of failures before opening circuit
  failureThreshold: number;
  // Time in ms to wait before trying again (half-open state)
  cooldownMs: number;
  // Time window in ms for counting failures
  failureWindowMs: number;
  // Name for logging
  name: string;
}

export class CircuitBreaker {
  private state: CircuitState = 'CLOSED';
  private failureCount = 0;
  private lastFailureTime = 0;
  private openedAt = 0;
  private readonly config: CircuitBreakerConfig;

  constructor(config: Partial<CircuitBreakerConfig> & { name: string }) {
    this.config = {
      failureThreshold: config.failureThreshold ?? 5,
      cooldownMs: config.cooldownMs ?? 30000, // 30 seconds
      failureWindowMs: config.failureWindowMs ?? 60000, // 1 minute
      name: config.name,
    };
  }

  /**
   * Check if the circuit allows requests
   * Returns true if request should proceed, false if blocked
   */
  canRequest(): boolean {
    const now = Date.now();

    switch (this.state) {
      case 'CLOSED':
        return true;

      case 'OPEN':
        // Check if cooldown period has passed
        if (now - this.openedAt >= this.config.cooldownMs) {
          this.state = 'HALF_OPEN';
          console.log(`[CircuitBreaker:${this.config.name}] State: OPEN -> HALF_OPEN (testing recovery)`);
          return true;
        }
        return false;

      case 'HALF_OPEN':
        // Allow one request to test if service has recovered
        return true;
    }
  }

  /**
   * Record a successful request
   */
  recordSuccess(): void {
    if (this.state === 'HALF_OPEN') {
      // Service has recovered
      this.state = 'CLOSED';
      this.failureCount = 0;
      console.log(`[CircuitBreaker:${this.config.name}] State: HALF_OPEN -> CLOSED (service recovered)`);
    } else if (this.state === 'CLOSED') {
      // Reset failure count on success (sliding window effect)
      this.failureCount = 0;
    }
  }

  /**
   * Record a failed request
   */
  recordFailure(): void {
    const now = Date.now();

    if (this.state === 'HALF_OPEN') {
      // Service is still failing
      this.state = 'OPEN';
      this.openedAt = now;
      console.log(`[CircuitBreaker:${this.config.name}] State: HALF_OPEN -> OPEN (still failing)`);
      return;
    }

    // Reset failure count if outside the window
    if (now - this.lastFailureTime > this.config.failureWindowMs) {
      this.failureCount = 0;
    }

    this.failureCount++;
    this.lastFailureTime = now;

    if (this.failureCount >= this.config.failureThreshold) {
      this.state = 'OPEN';
      this.openedAt = now;
      console.log(
        `[CircuitBreaker:${this.config.name}] State: CLOSED -> OPEN ` +
        `(${this.failureCount} failures in ${this.config.failureWindowMs}ms)`
      );
    }
  }

  /**
   * Execute a function with circuit breaker protection
   * Returns null if circuit is open
   */
  async execute<T>(fn: () => Promise<T>): Promise<T | null> {
    if (!this.canRequest()) {
      const remainingCooldown = Math.max(0, this.config.cooldownMs - (Date.now() - this.openedAt));
      console.log(
        `[CircuitBreaker:${this.config.name}] Request blocked - circuit OPEN ` +
        `(${Math.round(remainingCooldown / 1000)}s until retry)`
      );
      return null;
    }

    try {
      const result = await fn();
      this.recordSuccess();
      return result;
    } catch (error) {
      this.recordFailure();
      throw error;
    }
  }

  /**
   * Get current circuit state for monitoring
   */
  getState(): { state: CircuitState; failureCount: number; lastFailure: number } {
    return {
      state: this.state,
      failureCount: this.failureCount,
      lastFailure: this.lastFailureTime,
    };
  }

  /**
   * Force reset the circuit breaker (useful for testing or manual recovery)
   */
  reset(): void {
    this.state = 'CLOSED';
    this.failureCount = 0;
    this.lastFailureTime = 0;
    this.openedAt = 0;
    console.log(`[CircuitBreaker:${this.config.name}] Manually reset to CLOSED`);
  }
}

// Pre-configured circuit breakers for common services
export const rpcCircuitBreaker = new CircuitBreaker({
  name: 'RPC',
  failureThreshold: 5,
  cooldownMs: 30000, // 30 seconds
  failureWindowMs: 60000, // 1 minute window
});

export const heliusApiCircuitBreaker = new CircuitBreaker({
  name: 'HeliusAPI',
  failureThreshold: 3,
  cooldownMs: 15000, // 15 seconds
  failureWindowMs: 30000, // 30 second window
});
