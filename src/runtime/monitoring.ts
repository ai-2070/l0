// Built-in monitoring and telemetry system for L0

import type { L0Telemetry } from "../types/l0";
import type { GuardrailViolation } from "../types/guardrails";
import { analyzeNetworkError } from "../utils/errors";

/**
 * Monitoring configuration
 */
export interface MonitoringConfig {
  enabled: boolean;
  sampleRate: number;
  includeNetworkDetails: boolean;
  includeTimings: boolean;
  metadata?: Record<string, any>;
}

/**
 * Built-in monitoring and telemetry collector for L0
 */
export class L0Monitor {
  private config: MonitoringConfig;
  private telemetry: L0Telemetry;
  private tokenTimestamps: number[] = [];

  constructor(config: Partial<MonitoringConfig> = {}) {
    this.config = {
      enabled: config.enabled ?? false,
      sampleRate: config.sampleRate ?? 1.0,
      includeNetworkDetails: config.includeNetworkDetails ?? true,
      includeTimings: config.includeTimings ?? true,
      metadata: config.metadata,
    };

    this.telemetry = this.createInitialTelemetry();
  }

  /**
   * Check if monitoring is enabled and should sample this execution
   */
  isEnabled(): boolean {
    if (!this.config.enabled) return false;
    return Math.random() < this.config.sampleRate;
  }

  /**
   * Create initial telemetry structure
   */
  private createInitialTelemetry(): L0Telemetry {
    return {
      sessionId: this.generateSessionId(),
      startTime: Date.now(),
      metrics: {
        totalTokens: 0,
        totalRetries: 0,
        networkRetries: 0,
        modelRetries: 0,
      },
      network: {
        errorCount: 0,
        errorsByType: {},
        errors: this.config.includeNetworkDetails ? [] : undefined,
      },
      metadata: this.config.metadata,
    };
  }

  /**
   * Generate unique session ID
   */
  private generateSessionId(): string {
    return `l0_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Record stream start
   */
  start(): void {
    if (!this.isEnabled()) return;
    this.telemetry.startTime = Date.now();
  }

  /**
   * Record stream completion
   */
  complete(): void {
    if (!this.isEnabled()) return;

    this.telemetry.endTime = Date.now();
    this.telemetry.duration = this.telemetry.endTime - this.telemetry.startTime;

    // Calculate timing metrics if enabled
    if (this.config.includeTimings && this.tokenTimestamps.length > 0) {
      this.calculateTimingMetrics();
    }
  }

  /**
   * Record a token received
   */
  recordToken(timestamp?: number): void {
    if (!this.isEnabled()) return;

    const ts = timestamp ?? Date.now();
    this.telemetry.metrics.totalTokens++;

    if (this.config.includeTimings) {
      this.tokenTimestamps.push(ts);

      // Calculate time to first token
      if (this.telemetry.metrics.totalTokens === 1) {
        this.telemetry.metrics.timeToFirstToken = ts - this.telemetry.startTime;
      }
    }
  }

  /**
   * Record a network error
   */
  recordNetworkError(error: Error, retried: boolean, delay?: number): void {
    if (!this.isEnabled()) return;

    const analysis = analyzeNetworkError(error);
    const errorType = analysis.type;

    // Increment counters
    this.telemetry.network.errorCount++;
    this.telemetry.network.errorsByType[errorType] =
      (this.telemetry.network.errorsByType[errorType] || 0) + 1;

    // Record detailed error if enabled
    if (this.config.includeNetworkDetails && this.telemetry.network.errors) {
      this.telemetry.network.errors.push({
        type: errorType,
        message: error.message,
        timestamp: Date.now(),
        retried,
        delay,
      });
    }
  }

  /**
   * Record a retry attempt
   */
  recordRetry(isNetworkError: boolean): void {
    if (!this.isEnabled()) return;

    this.telemetry.metrics.totalRetries++;

    if (isNetworkError) {
      this.telemetry.metrics.networkRetries++;
    } else {
      this.telemetry.metrics.modelRetries++;
    }
  }

  /**
   * Record guardrail violations
   */
  recordGuardrailViolations(violations: GuardrailViolation[]): void {
    if (!this.isEnabled()) return;

    if (!this.telemetry.guardrails) {
      this.telemetry.guardrails = {
        violationCount: 0,
        violationsByRule: {},
        violationsByRuleAndSeverity: {},
        violationsBySeverity: {
          warning: 0,
          error: 0,
          fatal: 0,
        },
      };
    }

    for (const violation of violations) {
      // Total count
      this.telemetry.guardrails.violationCount++;

      // By rule
      this.telemetry.guardrails.violationsByRule[violation.rule] =
        (this.telemetry.guardrails.violationsByRule[violation.rule] || 0) + 1;

      // By rule and severity
      if (
        !this.telemetry.guardrails.violationsByRuleAndSeverity[violation.rule]
      ) {
        this.telemetry.guardrails.violationsByRuleAndSeverity[violation.rule] =
          {
            warning: 0,
            error: 0,
            fatal: 0,
          };
      }
      const ruleSeverity =
        this.telemetry.guardrails.violationsByRuleAndSeverity[violation.rule];
      if (ruleSeverity) {
        ruleSeverity[violation.severity]++;
      }

      // By severity
      this.telemetry.guardrails.violationsBySeverity[violation.severity]++;
    }
  }

  /**
   * Record drift detection
   */
  recordDrift(detected: boolean, types: string[]): void {
    if (!this.isEnabled()) return;

    this.telemetry.drift = {
      detected,
      types,
    };
  }

  /**
   * Record continuation from checkpoint
   */
  recordContinuation(
    enabled: boolean,
    used: boolean,
    checkpointContent?: string,
  ): void {
    if (!this.isEnabled()) return;

    if (!this.telemetry.continuation) {
      this.telemetry.continuation = {
        enabled,
        used: false,
        continuationCount: 0,
      };
    }

    this.telemetry.continuation.enabled = enabled;

    if (used) {
      this.telemetry.continuation.used = true;
      this.telemetry.continuation.continuationCount =
        (this.telemetry.continuation.continuationCount || 0) + 1;

      // Update content details - clear previous values if no content provided
      if (checkpointContent) {
        this.telemetry.continuation.checkpointContent = checkpointContent;
        this.telemetry.continuation.checkpointLength = checkpointContent.length;
      } else {
        // Clear stale checkpoint data to avoid leaking previous values
        this.telemetry.continuation.checkpointContent = undefined;
        this.telemetry.continuation.checkpointLength = undefined;
      }
    }
  }

  /**
   * Log custom event (e.g., fallback, custom interceptor events)
   */
  logEvent(event: Record<string, any>): void {
    if (!this.isEnabled()) return;

    // Store custom events in metadata
    if (!this.telemetry.metadata) {
      this.telemetry.metadata = {};
    }
    if (!this.telemetry.metadata.customEvents) {
      this.telemetry.metadata.customEvents = [];
    }

    this.telemetry.metadata.customEvents.push({
      ...event,
      timestamp: Date.now(),
    });
  }

  /**
   * Calculate timing metrics
   */
  private calculateTimingMetrics(): void {
    if (this.tokenTimestamps.length < 2) return;

    // Calculate inter-token times
    const interTokenTimes: number[] = [];
    for (let i = 1; i < this.tokenTimestamps.length; i++) {
      interTokenTimes.push(
        this.tokenTimestamps[i]! - this.tokenTimestamps[i - 1]!,
      );
    }

    // Average inter-token time
    if (interTokenTimes.length > 0) {
      const sum = interTokenTimes.reduce((a, b) => a + b, 0);
      this.telemetry.metrics.avgInterTokenTime = sum / interTokenTimes.length;
    }

    // Tokens per second
    if (this.telemetry.duration && this.telemetry.duration > 0) {
      this.telemetry.metrics.tokensPerSecond =
        (this.telemetry.metrics.totalTokens / this.telemetry.duration) * 1000;
    }
  }

  /**
   * Get current telemetry data
   */
  getTelemetry(): L0Telemetry | undefined {
    if (!this.isEnabled()) return undefined;
    return { ...this.telemetry };
  }

  /**
   * Get telemetry summary as JSON
   */
  toJSON(): string {
    if (!this.isEnabled()) return "{}";
    return JSON.stringify(this.telemetry, null, 2);
  }

  /**
   * Export telemetry for external logging
   */
  export(): L0Telemetry | undefined {
    return this.getTelemetry();
  }

  /**
   * Get summary statistics
   */
  getSummary():
    | {
        sessionId: string;
        duration: number;
        tokens: number;
        tokensPerSecond: number;
        retries: number;
        networkErrors: number;
        violations: number;
      }
    | undefined {
    if (!this.isEnabled()) return undefined;

    return {
      sessionId: this.telemetry.sessionId,
      duration: this.telemetry.duration ?? 0,
      tokens: this.telemetry.metrics.totalTokens,
      tokensPerSecond: this.telemetry.metrics.tokensPerSecond ?? 0,
      retries: this.telemetry.metrics.totalRetries,
      networkErrors: this.telemetry.network.errorCount,
      violations: this.telemetry.guardrails?.violationCount ?? 0,
    };
  }

  /**
   * Get network error breakdown
   */
  getNetworkErrorBreakdown(): Record<string, number> {
    if (!this.isEnabled()) return {};
    return { ...this.telemetry.network.errorsByType };
  }

  /**
   * Check if any network errors occurred
   */
  hasNetworkErrors(): boolean {
    if (!this.isEnabled()) return false;
    return this.telemetry.network.errorCount > 0;
  }

  /**
   * Check if any guardrail violations occurred
   */
  hasViolations(): boolean {
    if (!this.isEnabled()) return false;
    return (this.telemetry.guardrails?.violationCount ?? 0) > 0;
  }

  /**
   * Get most common network error type
   */
  getMostCommonNetworkError(): string | null {
    if (!this.isEnabled() || this.telemetry.network.errorCount === 0) {
      return null;
    }

    let maxCount = 0;
    let mostCommon: string | null = null;

    for (const [type, count] of Object.entries(
      this.telemetry.network.errorsByType,
    )) {
      if (count > maxCount) {
        maxCount = count;
        mostCommon = type;
      }
    }

    return mostCommon;
  }

  /**
   * Reset telemetry (for new execution)
   */
  reset(): void {
    this.telemetry = this.createInitialTelemetry();
    this.tokenTimestamps = [];
  }
}

/**
 * Create a monitor instance
 */
export function createMonitor(config?: Partial<MonitoringConfig>): L0Monitor {
  return new L0Monitor(config);
}

/**
 * Export telemetry to common formats
 */
export class TelemetryExporter {
  /**
   * Export to JSON string
   */
  static toJSON(telemetry: L0Telemetry): string {
    return JSON.stringify(telemetry, null, 2);
  }

  /**
   * Export to CSV format (summary)
   */
  static toCSV(telemetry: L0Telemetry): string {
    const lines: string[] = [];

    // Header
    lines.push(
      "sessionId,duration,tokens,tokensPerSecond,retries,networkErrors,violations",
    );

    // Data
    const duration = telemetry.duration ?? 0;
    const tokens = telemetry.metrics.totalTokens;
    const tokensPerSecond = telemetry.metrics.tokensPerSecond ?? 0;
    const retries = telemetry.metrics.totalRetries;
    const networkErrors = telemetry.network.errorCount;
    const violations = telemetry.guardrails?.violationCount ?? 0;

    lines.push(
      `${telemetry.sessionId},${duration},${tokens},${tokensPerSecond.toFixed(2)},${retries},${networkErrors},${violations}`,
    );

    return lines.join("\n");
  }

  /**
   * Export to structured log format
   */
  static toLogFormat(telemetry: L0Telemetry): Record<string, any> {
    return {
      session_id: telemetry.sessionId,
      timestamp: telemetry.startTime,
      duration_ms: telemetry.duration,
      metrics: {
        tokens: telemetry.metrics.totalTokens,
        tokens_per_second: telemetry.metrics.tokensPerSecond,
        time_to_first_token_ms: telemetry.metrics.timeToFirstToken,
        avg_inter_token_time_ms: telemetry.metrics.avgInterTokenTime,
        total_retries: telemetry.metrics.totalRetries,
        network_retries: telemetry.metrics.networkRetries,
        model_retries: telemetry.metrics.modelRetries,
      },
      network: {
        error_count: telemetry.network.errorCount,
        errors_by_type: telemetry.network.errorsByType,
      },
      guardrails: telemetry.guardrails
        ? {
            violation_count: telemetry.guardrails.violationCount,
            violations_by_severity: telemetry.guardrails.violationsBySeverity,
          }
        : null,
      drift: telemetry.drift,
      metadata: telemetry.metadata,
    };
  }

  /**
   * Export to metrics format (for time-series databases)
   */
  static toMetrics(telemetry: L0Telemetry): Array<{
    name: string;
    value: number;
    timestamp: number;
    tags?: Record<string, string>;
  }> {
    const metrics: Array<{
      name: string;
      value: number;
      timestamp: number;
      tags?: Record<string, string>;
    }> = [];

    const timestamp = telemetry.endTime ?? telemetry.startTime;
    const tags = telemetry.metadata
      ? Object.fromEntries(
          Object.entries(telemetry.metadata).map(([k, v]) => [k, String(v)]),
        )
      : undefined;

    // Duration metric
    if (telemetry.duration !== undefined) {
      metrics.push({
        name: "l0.duration",
        value: telemetry.duration,
        timestamp,
        tags,
      });
    }

    // Token metrics
    metrics.push({
      name: "l0.tokens.total",
      value: telemetry.metrics.totalTokens,
      timestamp,
      tags,
    });

    if (telemetry.metrics.tokensPerSecond !== undefined) {
      metrics.push({
        name: "l0.tokens.per_second",
        value: telemetry.metrics.tokensPerSecond,
        timestamp,
        tags,
      });
    }

    if (telemetry.metrics.timeToFirstToken !== undefined) {
      metrics.push({
        name: "l0.time_to_first_token",
        value: telemetry.metrics.timeToFirstToken,
        timestamp,
        tags,
      });
    }

    // Retry metrics
    metrics.push({
      name: "l0.retries.total",
      value: telemetry.metrics.totalRetries,
      timestamp,
      tags,
    });

    metrics.push({
      name: "l0.retries.network",
      value: telemetry.metrics.networkRetries,
      timestamp,
      tags,
    });

    metrics.push({
      name: "l0.retries.model",
      value: telemetry.metrics.modelRetries,
      timestamp,
      tags,
    });

    // Network error metrics
    metrics.push({
      name: "l0.network.errors",
      value: telemetry.network.errorCount,
      timestamp,
      tags,
    });

    // Guardrail metrics
    if (telemetry.guardrails) {
      metrics.push({
        name: "l0.guardrails.violations",
        value: telemetry.guardrails.violationCount,
        timestamp,
        tags,
      });
    }

    return metrics;
  }
}
