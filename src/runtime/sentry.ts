// Sentry integration for L0 error tracking and performance monitoring

import type { L0Telemetry } from "../types/l0";
import type { GuardrailViolation } from "../types/guardrails";
import type { L0Monitor } from "./monitoring";

/**
 * Sentry-like hub interface (compatible with @sentry/node)
 */
export interface SentryHub {
  captureException(error: Error, context?: Record<string, any>): string;
  captureMessage(message: string, level?: SentrySeverity): string;
  addBreadcrumb(breadcrumb: SentryBreadcrumb): void;
  setTag(key: string, value: string): void;
  setExtra(key: string, value: any): void;
  setContext(name: string, context: Record<string, any>): void;
  startTransaction?(context: SentryTransactionContext): SentryTransaction;
}

/**
 * Sentry severity levels
 */
export type SentrySeverity = "fatal" | "error" | "warning" | "info" | "debug";

/**
 * Sentry breadcrumb
 */
export interface SentryBreadcrumb {
  type?: string;
  category?: string;
  message?: string;
  data?: Record<string, any>;
  level?: SentrySeverity;
  timestamp?: number;
}

/**
 * Sentry transaction context
 */
export interface SentryTransactionContext {
  name: string;
  op: string;
  description?: string;
  data?: Record<string, any>;
}

/**
 * Sentry transaction interface
 */
export interface SentryTransaction {
  setStatus(status: string): void;
  setData(key: string, value: any): void;
  startChild(context: { op: string; description?: string }): SentrySpan;
  finish(): void;
}

/**
 * Sentry span interface
 */
export interface SentrySpan {
  setStatus(status: string): void;
  setData(key: string, value: any): void;
  finish(): void;
}

/**
 * Sentry integration configuration
 */
export interface SentryConfig {
  /**
   * Sentry hub instance (from @sentry/node)
   */
  hub: SentryHub;

  /**
   * Whether to capture network errors
   * @default true
   */
  captureNetworkErrors?: boolean;

  /**
   * Whether to capture guardrail violations
   * @default true
   */
  captureGuardrailViolations?: boolean;

  /**
   * Minimum severity to capture for guardrails
   * @default 'error'
   */
  minGuardrailSeverity?: "warning" | "error" | "fatal";

  /**
   * Whether to add breadcrumbs for tokens
   * @default false (can be noisy)
   */
  breadcrumbsForTokens?: boolean;

  /**
   * Whether to enable performance monitoring (transactions)
   * @default true
   */
  enableTracing?: boolean;

  /**
   * Custom tags to add to all events
   */
  tags?: Record<string, string>;

  /**
   * Environment name
   */
  environment?: string;
}

/**
 * L0 Sentry integration for error tracking and performance monitoring
 */
export class L0Sentry {
  private hub: SentryHub;
  private config: Required<
    Omit<SentryConfig, "hub" | "tags" | "environment">
  > & {
    tags?: Record<string, string>;
    environment?: string;
  };
  private transaction?: SentryTransaction;
  private streamSpan?: SentrySpan;

  constructor(config: SentryConfig) {
    this.hub = config.hub;
    this.config = {
      captureNetworkErrors: config.captureNetworkErrors ?? true,
      captureGuardrailViolations: config.captureGuardrailViolations ?? true,
      minGuardrailSeverity: config.minGuardrailSeverity ?? "error",
      breadcrumbsForTokens: config.breadcrumbsForTokens ?? false,
      enableTracing: config.enableTracing ?? true,
      tags: config.tags,
      environment: config.environment,
    };

    // Set default tags
    if (this.config.tags) {
      for (const [key, value] of Object.entries(this.config.tags)) {
        this.hub.setTag(key, value);
      }
    }

    if (this.config.environment) {
      this.hub.setTag("environment", this.config.environment);
    }
  }

  /**
   * Start tracking an L0 execution
   */
  startExecution(
    name: string = "l0.execution",
    metadata?: Record<string, any>,
  ): void {
    // Add breadcrumb
    this.hub.addBreadcrumb({
      type: "info",
      category: "l0",
      message: "L0 execution started",
      data: metadata,
      level: "info",
      timestamp: Date.now() / 1000,
    });

    // Start transaction if tracing enabled
    if (this.config.enableTracing && this.hub.startTransaction) {
      this.transaction = this.hub.startTransaction({
        name,
        op: "l0.stream",
        data: metadata,
      });
    }
  }

  /**
   * Start tracking stream consumption
   */
  startStream(): void {
    if (this.transaction) {
      this.streamSpan = this.transaction.startChild({
        op: "l0.stream.consume",
        description: "Consuming LLM stream",
      });
    }

    this.hub.addBreadcrumb({
      type: "info",
      category: "l0.stream",
      message: "Stream started",
      level: "info",
      timestamp: Date.now() / 1000,
    });
  }

  /**
   * Record a token received
   */
  recordToken(token?: string): void {
    if (this.config.breadcrumbsForTokens) {
      this.hub.addBreadcrumb({
        type: "debug",
        category: "l0.token",
        message: token ? `Token: ${token.slice(0, 50)}` : "Token received",
        level: "debug",
        timestamp: Date.now() / 1000,
      });
    }
  }

  /**
   * Record first token (TTFT)
   */
  recordFirstToken(ttft: number): void {
    this.hub.addBreadcrumb({
      type: "info",
      category: "l0.stream",
      message: `First token received`,
      data: { ttft_ms: ttft },
      level: "info",
      timestamp: Date.now() / 1000,
    });

    if (this.streamSpan) {
      this.streamSpan.setData("ttft_ms", ttft);
    }
  }

  /**
   * Record a network error
   */
  recordNetworkError(error: Error, errorType: string, retried: boolean): void {
    this.hub.addBreadcrumb({
      type: "error",
      category: "l0.network",
      message: `Network error: ${errorType}`,
      data: {
        error_type: errorType,
        message: error.message,
        retried,
      },
      level: "error",
      timestamp: Date.now() / 1000,
    });

    if (this.config.captureNetworkErrors && !retried) {
      // Only capture if not retried (final failure)
      this.hub.captureException(error, {
        tags: {
          error_type: errorType,
          component: "l0.network",
        },
        extra: {
          retried,
        },
      });
    }
  }

  /**
   * Record a retry attempt
   */
  recordRetry(attempt: number, reason: string, isNetworkError: boolean): void {
    this.hub.addBreadcrumb({
      type: "info",
      category: "l0.retry",
      message: `Retry attempt ${attempt}`,
      data: {
        attempt,
        reason,
        is_network_error: isNetworkError,
      },
      level: "warning",
      timestamp: Date.now() / 1000,
    });
  }

  /**
   * Record guardrail violations
   */
  recordGuardrailViolations(violations: GuardrailViolation[]): void {
    for (const violation of violations) {
      // Add breadcrumb for all violations
      this.hub.addBreadcrumb({
        type: "error",
        category: "l0.guardrail",
        message: `Guardrail violation: ${violation.rule}`,
        data: {
          rule: violation.rule,
          severity: violation.severity,
          message: violation.message,
          recoverable: violation.recoverable,
        },
        level: this.mapSeverity(violation.severity),
        timestamp: Date.now() / 1000,
      });

      // Capture as error if meets threshold
      if (
        this.config.captureGuardrailViolations &&
        this.shouldCapture(violation.severity)
      ) {
        this.hub.captureMessage(
          `Guardrail violation: ${violation.message}`,
          this.mapSeverity(violation.severity),
        );
      }
    }
  }

  /**
   * Record drift detection
   */
  recordDrift(detected: boolean, types: string[]): void {
    if (detected) {
      this.hub.addBreadcrumb({
        type: "error",
        category: "l0.drift",
        message: `Drift detected: ${types.join(", ")}`,
        data: { types },
        level: "warning",
        timestamp: Date.now() / 1000,
      });
    }
  }

  /**
   * Complete stream tracking
   */
  completeStream(tokenCount: number): void {
    if (this.streamSpan) {
      this.streamSpan.setData("token_count", tokenCount);
      this.streamSpan.setStatus("ok");
      this.streamSpan.finish();
      this.streamSpan = undefined;
    }

    this.hub.addBreadcrumb({
      type: "info",
      category: "l0.stream",
      message: "Stream completed",
      data: { token_count: tokenCount },
      level: "info",
      timestamp: Date.now() / 1000,
    });
  }

  /**
   * Complete execution tracking
   */
  completeExecution(telemetry: L0Telemetry): void {
    // Set context with telemetry data
    this.hub.setContext("l0_telemetry", {
      session_id: telemetry.sessionId,
      duration_ms: telemetry.duration,
      tokens: telemetry.metrics.totalTokens,
      tokens_per_second: telemetry.metrics.tokensPerSecond,
      ttft_ms: telemetry.metrics.timeToFirstToken,
      retries: telemetry.metrics.totalRetries,
      network_errors: telemetry.network.errorCount,
      guardrail_violations: telemetry.guardrails?.violationCount ?? 0,
    });

    // Add final breadcrumb
    this.hub.addBreadcrumb({
      type: "info",
      category: "l0",
      message: "L0 execution completed",
      data: {
        duration_ms: telemetry.duration,
        tokens: telemetry.metrics.totalTokens,
        retries: telemetry.metrics.totalRetries,
      },
      level: "info",
      timestamp: Date.now() / 1000,
    });

    // Finish transaction
    if (this.transaction) {
      this.transaction.setData("tokens", telemetry.metrics.totalTokens);
      this.transaction.setData("duration_ms", telemetry.duration);
      this.transaction.setData("retries", telemetry.metrics.totalRetries);
      this.transaction.setStatus("ok");
      this.transaction.finish();
      this.transaction = undefined;
    }
  }

  /**
   * Record execution failure
   */
  recordFailure(error: Error, telemetry?: L0Telemetry): void {
    // Set context if telemetry available
    if (telemetry) {
      this.hub.setContext("l0_telemetry", {
        session_id: telemetry.sessionId,
        duration_ms: telemetry.duration,
        tokens: telemetry.metrics.totalTokens,
        retries: telemetry.metrics.totalRetries,
        network_errors: telemetry.network.errorCount,
      });
    }

    // Capture exception
    this.hub.captureException(error, {
      tags: {
        component: "l0",
      },
      extra: {
        telemetry: telemetry
          ? {
              session_id: telemetry.sessionId,
              duration_ms: telemetry.duration,
              tokens: telemetry.metrics.totalTokens,
            }
          : undefined,
      },
    });

    // Finish transaction with error status
    if (this.streamSpan) {
      this.streamSpan.setStatus("internal_error");
      this.streamSpan.finish();
      this.streamSpan = undefined;
    }

    if (this.transaction) {
      this.transaction.setStatus("internal_error");
      this.transaction.finish();
      this.transaction = undefined;
    }
  }

  /**
   * Record from L0Monitor
   */
  recordFromMonitor(monitor: L0Monitor): void {
    const telemetry = monitor.getTelemetry();
    if (telemetry) {
      this.completeExecution(telemetry);
    }
  }

  /**
   * Map guardrail severity to Sentry severity
   */
  private mapSeverity(severity: "warning" | "error" | "fatal"): SentrySeverity {
    switch (severity) {
      case "fatal":
        return "fatal";
      case "error":
        return "error";
      case "warning":
        return "warning";
      default:
        return "info";
    }
  }

  /**
   * Check if severity meets capture threshold
   */
  private shouldCapture(severity: "warning" | "error" | "fatal"): boolean {
    const levels = ["warning", "error", "fatal"];
    const minIndex = levels.indexOf(this.config.minGuardrailSeverity);
    const currentIndex = levels.indexOf(severity);
    return currentIndex >= minIndex;
  }
}

/**
 * Create Sentry integration
 */
export function createSentryIntegration(config: SentryConfig): L0Sentry {
  return new L0Sentry(config);
}

/**
 * Sentry interceptor for automatic tracking
 *
 * @example
 * ```typescript
 * import * as Sentry from '@sentry/node';
 * import { l0, sentryInterceptor } from 'l0';
 *
 * const result = await l0({
 *   stream: () => streamText({ model, prompt }),
 *   interceptors: [
 *     sentryInterceptor({ hub: Sentry })
 *   ]
 * });
 * ```
 */
export function sentryInterceptor(config: SentryConfig) {
  const sentry = createSentryIntegration(config);

  return {
    name: "sentry",

    before: async (options: any) => {
      sentry.startExecution("l0.execution", options.monitoring?.metadata);
      return options;
    },

    after: async (result: any) => {
      if (result.telemetry) {
        sentry.completeExecution(result.telemetry);
      }
      return result;
    },

    onError: async (error: Error, _options: any) => {
      sentry.recordFailure(error);
    },
  };
}

/**
 * Wrap L0 execution with Sentry tracking
 *
 * @example
 * ```typescript
 * import * as Sentry from '@sentry/node';
 * import { l0, withSentry } from 'l0';
 *
 * const result = await withSentry(
 *   { hub: Sentry },
 *   () => l0({
 *     stream: () => streamText({ model, prompt }),
 *     monitoring: { enabled: true }
 *   })
 * );
 * ```
 */
export async function withSentry<T>(
  config: SentryConfig,
  fn: () => Promise<T & { telemetry?: L0Telemetry }>,
): Promise<T> {
  const sentry = createSentryIntegration(config);
  sentry.startExecution();

  try {
    const result = await fn();

    if (result.telemetry) {
      sentry.completeExecution(result.telemetry);
    }

    return result;
  } catch (error) {
    sentry.recordFailure(
      error instanceof Error ? error : new Error(String(error)),
    );
    throw error;
  }
}
