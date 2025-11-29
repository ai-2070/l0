// Prometheus metrics exporter for L0

import type { L0Telemetry } from "../types/l0";
import type { L0Monitor } from "./monitoring";

/**
 * Prometheus metric types
 */
export type PrometheusMetricType = "counter" | "gauge" | "histogram" | "summary";

/**
 * Prometheus metric definition
 */
export interface PrometheusMetric {
  name: string;
  help: string;
  type: PrometheusMetricType;
  value: number;
  labels?: Record<string, string>;
  buckets?: number[]; // For histograms
  quantiles?: number[]; // For summaries
}

/**
 * Prometheus registry for L0 metrics
 */
export class PrometheusRegistry {
  private metrics: Map<string, PrometheusMetric[]> = new Map();
  private prefix: string;
  private defaultLabels: Record<string, string>;

  constructor(options: {
    prefix?: string;
    defaultLabels?: Record<string, string>;
  } = {}) {
    this.prefix = options.prefix ?? "l0";
    this.defaultLabels = options.defaultLabels ?? {};
  }

  /**
   * Register a metric
   */
  private register(metric: PrometheusMetric): void {
    const key = metric.name;
    const existing = this.metrics.get(key) || [];
    existing.push({
      ...metric,
      labels: { ...this.defaultLabels, ...metric.labels },
    });
    this.metrics.set(key, existing);
  }

  /**
   * Increment a counter
   */
  incCounter(name: string, help: string, value: number = 1, labels?: Record<string, string>): void {
    this.register({
      name: `${this.prefix}_${name}`,
      help,
      type: "counter",
      value,
      labels,
    });
  }

  /**
   * Set a gauge value
   */
  setGauge(name: string, help: string, value: number, labels?: Record<string, string>): void {
    this.register({
      name: `${this.prefix}_${name}`,
      help,
      type: "gauge",
      value,
      labels,
    });
  }

  /**
   * Observe a histogram value
   */
  observeHistogram(
    name: string,
    help: string,
    value: number,
    labels?: Record<string, string>,
    buckets?: number[]
  ): void {
    this.register({
      name: `${this.prefix}_${name}`,
      help,
      type: "histogram",
      value,
      labels,
      buckets: buckets ?? [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
    });
  }

  /**
   * Record telemetry from L0Monitor
   */
  recordTelemetry(telemetry: L0Telemetry, labels?: Record<string, string>): void {
    const baseLabels = { ...labels };

    // Duration
    if (telemetry.duration !== undefined) {
      this.observeHistogram(
        "request_duration_seconds",
        "L0 request duration in seconds",
        telemetry.duration / 1000,
        baseLabels,
        [0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30, 60]
      );
    }

    // Tokens
    this.incCounter(
      "tokens_total",
      "Total tokens generated",
      telemetry.metrics.totalTokens,
      baseLabels
    );

    if (telemetry.metrics.tokensPerSecond !== undefined) {
      this.setGauge(
        "tokens_per_second",
        "Tokens generated per second",
        telemetry.metrics.tokensPerSecond,
        baseLabels
      );
    }

    // Time to first token
    if (telemetry.metrics.timeToFirstToken !== undefined) {
      this.observeHistogram(
        "time_to_first_token_seconds",
        "Time to first token in seconds",
        telemetry.metrics.timeToFirstToken / 1000,
        baseLabels,
        [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10]
      );
    }

    // Retries
    if (telemetry.metrics.totalRetries > 0) {
      this.incCounter(
        "retries_total",
        "Total retry attempts",
        telemetry.metrics.totalRetries,
        baseLabels
      );

      this.incCounter(
        "retries_network_total",
        "Network-related retry attempts",
        telemetry.metrics.networkRetries,
        { ...baseLabels, retry_type: "network" }
      );

      this.incCounter(
        "retries_model_total",
        "Model-related retry attempts",
        telemetry.metrics.modelRetries,
        { ...baseLabels, retry_type: "model" }
      );
    }

    // Network errors
    if (telemetry.network.errorCount > 0) {
      this.incCounter(
        "network_errors_total",
        "Total network errors",
        telemetry.network.errorCount,
        baseLabels
      );

      // Per error type
      for (const [errorType, count] of Object.entries(telemetry.network.errorsByType)) {
        this.incCounter(
          "network_errors_by_type_total",
          "Network errors by type",
          count,
          { ...baseLabels, error_type: errorType }
        );
      }
    }

    // Guardrail violations
    if (telemetry.guardrails && telemetry.guardrails.violationCount > 0) {
      this.incCounter(
        "guardrail_violations_total",
        "Total guardrail violations",
        telemetry.guardrails.violationCount,
        baseLabels
      );

      // Per severity
      for (const [severity, count] of Object.entries(telemetry.guardrails.violationsBySeverity)) {
        if (count > 0) {
          this.incCounter(
            "guardrail_violations_by_severity_total",
            "Guardrail violations by severity",
            count,
            { ...baseLabels, severity }
          );
        }
      }

      // Per rule
      for (const [rule, count] of Object.entries(telemetry.guardrails.violationsByRule)) {
        this.incCounter(
          "guardrail_violations_by_rule_total",
          "Guardrail violations by rule",
          count,
          { ...baseLabels, rule }
        );
      }
    }

    // Drift detection
    if (telemetry.drift?.detected) {
      this.incCounter(
        "drift_detected_total",
        "Drift detection events",
        1,
        baseLabels
      );
    }

    // Request count (always 1 per telemetry record)
    this.incCounter(
      "requests_total",
      "Total L0 requests",
      1,
      baseLabels
    );
  }

  /**
   * Record from L0Monitor directly
   */
  recordFromMonitor(monitor: L0Monitor, labels?: Record<string, string>): void {
    const telemetry = monitor.getTelemetry();
    if (telemetry) {
      this.recordTelemetry(telemetry, labels);
    }
  }

  /**
   * Export metrics in Prometheus text format
   */
  expose(): string {
    const lines: string[] = [];
    const processed = new Set<string>();

    for (const [name, metricList] of this.metrics.entries()) {
      if (metricList.length === 0) continue;

      const first = metricList[0]!;

      // Only output HELP and TYPE once per metric name
      if (!processed.has(name)) {
        lines.push(`# HELP ${name} ${first.help}`);
        lines.push(`# TYPE ${name} ${first.type}`);
        processed.add(name);
      }

      // Output all values with labels
      for (const metric of metricList) {
        const labelStr = this.formatLabels(metric.labels);

        if (metric.type === "histogram") {
          // For histograms, we accumulate into buckets
          lines.push(`${name}_bucket${labelStr.replace("}", `,le="+Inf"}`)} ${metric.value}`);
          lines.push(`${name}_sum${labelStr} ${metric.value}`);
          lines.push(`${name}_count${labelStr} 1`);
        } else {
          lines.push(`${name}${labelStr} ${metric.value}`);
        }
      }
    }

    return lines.join("\n");
  }

  /**
   * Format labels for Prometheus output
   */
  private formatLabels(labels?: Record<string, string>): string {
    if (!labels || Object.keys(labels).length === 0) {
      return "";
    }

    const pairs = Object.entries(labels)
      .map(([k, v]) => `${k}="${this.escapeLabel(v)}"`)
      .join(",");

    return `{${pairs}}`;
  }

  /**
   * Escape label value for Prometheus
   */
  private escapeLabel(value: string): string {
    return value
      .replace(/\\/g, "\\\\")
      .replace(/"/g, '\\"')
      .replace(/\n/g, "\\n");
  }

  /**
   * Clear all metrics
   */
  clear(): void {
    this.metrics.clear();
  }

  /**
   * Get metrics as JSON (for debugging)
   */
  toJSON(): Record<string, PrometheusMetric[]> {
    return Object.fromEntries(this.metrics.entries());
  }
}

/**
 * Aggregating Prometheus collector for multiple L0 requests
 */
export class PrometheusCollector {
  private registry: PrometheusRegistry;
  private histogramBuckets: Map<string, number[]> = new Map();
  private histogramValues: Map<string, { sum: number; count: number; buckets: Map<number, number> }> = new Map();
  private counters: Map<string, number> = new Map();
  private gauges: Map<string, number> = new Map();

  constructor(options: {
    prefix?: string;
    defaultLabels?: Record<string, string>;
  } = {}) {
    this.registry = new PrometheusRegistry(options);
  }

  /**
   * Record telemetry, aggregating with previous values
   */
  record(telemetry: L0Telemetry, labels?: Record<string, string>): void {
    this.registry.recordTelemetry(telemetry, labels);
  }

  /**
   * Record from L0Monitor
   */
  recordFromMonitor(monitor: L0Monitor, labels?: Record<string, string>): void {
    this.registry.recordFromMonitor(monitor, labels);
  }

  /**
   * Expose metrics in Prometheus format
   */
  expose(): string {
    return this.registry.expose();
  }

  /**
   * Clear all collected metrics
   */
  clear(): void {
    this.registry.clear();
    this.histogramBuckets.clear();
    this.histogramValues.clear();
    this.counters.clear();
    this.gauges.clear();
  }

  /**
   * Get the underlying registry
   */
  getRegistry(): PrometheusRegistry {
    return this.registry;
  }
}

/**
 * Create a Prometheus registry
 */
export function createPrometheusRegistry(options?: {
  prefix?: string;
  defaultLabels?: Record<string, string>;
}): PrometheusRegistry {
  return new PrometheusRegistry(options);
}

/**
 * Create a Prometheus collector
 */
export function createPrometheusCollector(options?: {
  prefix?: string;
  defaultLabels?: Record<string, string>;
}): PrometheusCollector {
  return new PrometheusCollector(options);
}

/**
 * Express/HTTP middleware for Prometheus metrics endpoint
 *
 * @example
 * ```typescript
 * import express from 'express';
 * import { createPrometheusCollector, prometheusMiddleware } from 'l0';
 *
 * const collector = createPrometheusCollector();
 * const app = express();
 *
 * app.get('/metrics', prometheusMiddleware(collector));
 * ```
 */
export function prometheusMiddleware(
  collector: PrometheusCollector
): (req: any, res: any) => void {
  return (_req: any, res: any) => {
    res.set("Content-Type", "text/plain; version=0.0.4; charset=utf-8");
    res.send(collector.expose());
  };
}

/**
 * Default histogram buckets for common metrics
 */
export const DEFAULT_BUCKETS = {
  duration: [0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30, 60, 120],
  ttft: [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  tokens: [10, 50, 100, 250, 500, 1000, 2500, 5000, 10000],
  retries: [0, 1, 2, 3, 5, 10],
};

/**
 * Metric names exported by L0
 */
export const METRIC_NAMES = {
  requestsTotal: "l0_requests_total",
  requestDuration: "l0_request_duration_seconds",
  tokensTotal: "l0_tokens_total",
  tokensPerSecond: "l0_tokens_per_second",
  timeToFirstToken: "l0_time_to_first_token_seconds",
  retriesTotal: "l0_retries_total",
  networkErrorsTotal: "l0_network_errors_total",
  guardrailViolationsTotal: "l0_guardrail_violations_total",
  driftDetectedTotal: "l0_drift_detected_total",
} as const;
