// Simple metrics collection for L0 runtime
// Lightweight counters - OpenTelemetry is opt-in via adapter

/**
 * Simple metrics for L0 runtime.
 * Just counters - no histograms, no complex aggregations.
 * OpenTelemetry integration is separate and optional.
 */
export class Metrics {
  /** Total stream requests */
  requests = 0;

  /** Total tokens processed */
  tokens = 0;

  /** Total retry attempts */
  retries = 0;

  /** Network retries (subset of retries) */
  networkRetries = 0;

  /** Total errors encountered */
  errors = 0;

  /** Guardrail violations */
  violations = 0;

  /** Drift detections */
  driftDetections = 0;

  /** Fallback activations */
  fallbacks = 0;

  /** Successful completions */
  completions = 0;

  /** Timeouts (initial + inter-token) */
  timeouts = 0;

  /**
   * Reset all counters
   */
  reset(): void {
    this.requests = 0;
    this.tokens = 0;
    this.retries = 0;
    this.networkRetries = 0;
    this.errors = 0;
    this.violations = 0;
    this.driftDetections = 0;
    this.fallbacks = 0;
    this.completions = 0;
    this.timeouts = 0;
  }

  /**
   * Get snapshot of all metrics
   */
  snapshot(): MetricsSnapshot {
    return {
      requests: this.requests,
      tokens: this.tokens,
      retries: this.retries,
      networkRetries: this.networkRetries,
      errors: this.errors,
      violations: this.violations,
      driftDetections: this.driftDetections,
      fallbacks: this.fallbacks,
      completions: this.completions,
      timeouts: this.timeouts,
    };
  }

  /**
   * Serialize for logging
   */
  toJSON(): MetricsSnapshot {
    return this.snapshot();
  }
}

/**
 * Metrics snapshot type
 */
export interface MetricsSnapshot {
  requests: number;
  tokens: number;
  retries: number;
  networkRetries: number;
  errors: number;
  violations: number;
  driftDetections: number;
  fallbacks: number;
  completions: number;
  timeouts: number;
}

/**
 * Create a new metrics instance
 */
export function createMetrics(): Metrics {
  return new Metrics();
}

/**
 * Global metrics instance (optional singleton pattern)
 */
let globalMetrics: Metrics | null = null;

/**
 * Get or create global metrics instance
 */
export function getGlobalMetrics(): Metrics {
  if (!globalMetrics) {
    globalMetrics = new Metrics();
  }
  return globalMetrics;
}

/**
 * Reset global metrics
 */
export function resetGlobalMetrics(): void {
  if (globalMetrics) {
    globalMetrics.reset();
  }
}
