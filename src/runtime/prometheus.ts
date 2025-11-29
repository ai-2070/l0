// Prometheus metrics exporter for L0
// Uses prom-client types for compatibility

import type { L0Telemetry } from "../types/l0";
import type { L0Monitor } from "./monitoring";
import type {
  Counter,
  Gauge,
  Histogram,
  Registry,
  CounterConfiguration,
  GaugeConfiguration,
  HistogramConfiguration,
} from "prom-client";

/**
 * prom-client compatible interface
 * Users can pass the actual prom-client module or a compatible implementation
 */
export interface PromClient {
  Registry: new () => Registry;
  Counter: new <T extends string>(
    config: CounterConfiguration<T>,
  ) => Counter<T>;
  Gauge: new <T extends string>(config: GaugeConfiguration<T>) => Gauge<T>;
  Histogram: new <T extends string>(
    config: HistogramConfiguration<T>,
  ) => Histogram<T>;
  register: Registry;
}

/**
 * L0 Prometheus metrics configuration
 */
export interface PrometheusConfig {
  /**
   * prom-client module instance
   * Pass: `import * as promClient from 'prom-client'`
   */
  client: PromClient;

  /**
   * Metric name prefix
   * @default 'l0'
   */
  prefix?: string;

  /**
   * Default labels to add to all metrics
   */
  defaultLabels?: Record<string, string>;

  /**
   * Use a custom registry instead of the default
   */
  registry?: Registry;

  /**
   * Custom histogram buckets
   */
  buckets?: {
    duration?: number[];
    ttft?: number[];
    tokens?: number[];
  };
}

/**
 * L0 Prometheus metrics collector using prom-client
 */
export class L0PrometheusCollector {
  private registry: Registry;
  private prefix: string;

  // Counters
  private requestsTotal: Counter<"status">;
  private tokensTotal: Counter<"model">;
  private retriesTotal: Counter<"type">;
  private networkErrorsTotal: Counter<"error_type">;
  private guardrailViolationsTotal: Counter<"rule" | "severity">;
  private driftDetectedTotal: Counter<"type">;

  // Gauges
  private tokensPerSecond: Gauge<"model">;
  private activeStreams: Gauge<"model">;

  // Histograms
  private requestDuration: Histogram<"status">;
  private timeToFirstToken: Histogram<"model">;

  constructor(config: PrometheusConfig) {
    this.prefix = config.prefix ?? "l0";
    this.registry = config.registry ?? new config.client.Registry();

    // Set default labels if provided
    if (config.defaultLabels) {
      this.registry.setDefaultLabels(config.defaultLabels);
    }

    const durationBuckets = config.buckets?.duration ?? [
      0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30, 60, 120,
    ];
    const ttftBuckets = config.buckets?.ttft ?? [
      0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10,
    ];

    // Initialize counters
    this.requestsTotal = new config.client.Counter({
      name: `${this.prefix}_requests_total`,
      help: "Total number of L0 requests",
      labelNames: ["status"] as const,
      registers: [this.registry],
    });

    this.tokensTotal = new config.client.Counter({
      name: `${this.prefix}_tokens_total`,
      help: "Total tokens generated",
      labelNames: ["model"] as const,
      registers: [this.registry],
    });

    this.retriesTotal = new config.client.Counter({
      name: `${this.prefix}_retries_total`,
      help: "Total retry attempts",
      labelNames: ["type"] as const,
      registers: [this.registry],
    });

    this.networkErrorsTotal = new config.client.Counter({
      name: `${this.prefix}_network_errors_total`,
      help: "Total network errors",
      labelNames: ["error_type"] as const,
      registers: [this.registry],
    });

    this.guardrailViolationsTotal = new config.client.Counter({
      name: `${this.prefix}_guardrail_violations_total`,
      help: "Total guardrail violations",
      labelNames: ["rule", "severity"] as const,
      registers: [this.registry],
    });

    this.driftDetectedTotal = new config.client.Counter({
      name: `${this.prefix}_drift_detected_total`,
      help: "Total drift detection events",
      labelNames: ["type"] as const,
      registers: [this.registry],
    });

    // Initialize gauges
    this.tokensPerSecond = new config.client.Gauge({
      name: `${this.prefix}_tokens_per_second`,
      help: "Current tokens per second rate",
      labelNames: ["model"] as const,
      registers: [this.registry],
    });

    this.activeStreams = new config.client.Gauge({
      name: `${this.prefix}_active_streams`,
      help: "Number of active streams",
      labelNames: ["model"] as const,
      registers: [this.registry],
    });

    // Initialize histograms
    this.requestDuration = new config.client.Histogram({
      name: `${this.prefix}_request_duration_seconds`,
      help: "L0 request duration in seconds",
      labelNames: ["status"] as const,
      buckets: durationBuckets,
      registers: [this.registry],
    });

    this.timeToFirstToken = new config.client.Histogram({
      name: `${this.prefix}_time_to_first_token_seconds`,
      help: "Time to first token in seconds",
      labelNames: ["model"] as const,
      buckets: ttftBuckets,
      registers: [this.registry],
    });
  }

  /**
   * Record telemetry from L0 execution
   */
  record(telemetry: L0Telemetry, labels?: { model?: string }): void {
    const model = labels?.model ?? "unknown";
    const status = telemetry.metrics.totalTokens > 0 ? "success" : "empty";

    // Request count
    this.requestsTotal.inc({ status });

    // Duration
    if (telemetry.duration !== undefined) {
      this.requestDuration.observe({ status }, telemetry.duration / 1000);
    }

    // Tokens
    if (telemetry.metrics.totalTokens > 0) {
      this.tokensTotal.inc({ model }, telemetry.metrics.totalTokens);
    }

    if (telemetry.metrics.tokensPerSecond !== undefined) {
      this.tokensPerSecond.set({ model }, telemetry.metrics.tokensPerSecond);
    }

    // Time to first token
    if (telemetry.metrics.timeToFirstToken !== undefined) {
      this.timeToFirstToken.observe(
        { model },
        telemetry.metrics.timeToFirstToken / 1000,
      );
    }

    // Retries
    if (telemetry.metrics.networkRetries > 0) {
      this.retriesTotal.inc(
        { type: "network" },
        telemetry.metrics.networkRetries,
      );
    }
    if (telemetry.metrics.modelRetries > 0) {
      this.retriesTotal.inc({ type: "model" }, telemetry.metrics.modelRetries);
    }

    // Network errors
    if (telemetry.network.errorCount > 0) {
      for (const [errorType, count] of Object.entries(
        telemetry.network.errorsByType,
      )) {
        this.networkErrorsTotal.inc({ error_type: errorType }, count);
      }
    }

    // Guardrail violations
    if (telemetry.guardrails && telemetry.guardrails.violationCount > 0) {
      // Use violationsByRuleAndSeverity if available for accurate per-rule severity
      if (telemetry.guardrails.violationsByRuleAndSeverity) {
        for (const [rule, severityCounts] of Object.entries(
          telemetry.guardrails.violationsByRuleAndSeverity,
        )) {
          for (const [severity, count] of Object.entries(severityCounts)) {
            if (count > 0) {
              this.guardrailViolationsTotal.inc({ rule, severity }, count);
            }
          }
        }
      } else {
        // Fallback: emit with "unknown" severity if detailed breakdown not available
        for (const [rule, count] of Object.entries(
          telemetry.guardrails.violationsByRule,
        )) {
          this.guardrailViolationsTotal.inc(
            { rule, severity: "unknown" },
            count,
          );
        }
      }
    }

    // Drift detection
    if (telemetry.drift?.detected) {
      for (const type of telemetry.drift.types) {
        this.driftDetectedTotal.inc({ type });
      }
    }
  }

  /**
   * Record from L0Monitor directly
   */
  recordFromMonitor(monitor: L0Monitor, labels?: { model?: string }): void {
    const telemetry = monitor.getTelemetry();
    if (telemetry) {
      this.record(telemetry, labels);
    }
  }

  /**
   * Increment active streams
   */
  incActiveStreams(model: string = "unknown"): void {
    this.activeStreams.inc({ model });
  }

  /**
   * Decrement active streams
   */
  decActiveStreams(model: string = "unknown"): void {
    this.activeStreams.dec({ model });
  }

  /**
   * Get the registry
   */
  getRegistry(): Registry {
    return this.registry;
  }

  /**
   * Get metrics in Prometheus format
   */
  async getMetrics(): Promise<string> {
    return this.registry.metrics();
  }

  /**
   * Get content type for metrics endpoint
   */
  getContentType(): string {
    return this.registry.contentType;
  }

  /**
   * Clear all metrics
   */
  clear(): void {
    this.registry.clear();
  }
}

/**
 * Create L0 Prometheus collector
 *
 * @example
 * ```typescript
 * import * as promClient from 'prom-client';
 * import { createL0PrometheusCollector } from 'l0';
 *
 * const collector = createL0PrometheusCollector({
 *   client: promClient,
 *   prefix: 'myapp_l0'
 * });
 * ```
 */
export function createL0PrometheusCollector(
  config: PrometheusConfig,
): L0PrometheusCollector {
  return new L0PrometheusCollector(config);
}

/**
 * Express/HTTP middleware for Prometheus metrics endpoint
 *
 * @example
 * ```typescript
 * import express from 'express';
 * import * as promClient from 'prom-client';
 * import { createL0PrometheusCollector, l0PrometheusMiddleware } from 'l0';
 *
 * const collector = createL0PrometheusCollector({ client: promClient });
 * const app = express();
 *
 * app.get('/metrics', l0PrometheusMiddleware(collector));
 * ```
 */
export function l0PrometheusMiddleware(
  collector: L0PrometheusCollector,
): (req: any, res: any) => Promise<void> {
  return async (_req: any, res: any) => {
    res.set("Content-Type", collector.getContentType());
    res.send(await collector.getMetrics());
  };
}

// ============================================================================
// Legacy API (standalone implementation without prom-client dependency)
// ============================================================================

/**
 * Prometheus metric types
 */
export type PrometheusMetricType =
  | "counter"
  | "gauge"
  | "histogram"
  | "summary";

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
 * Standalone Prometheus registry for L0 metrics (no prom-client dependency)
 * Use L0PrometheusCollector with prom-client for production use
 */
export class PrometheusRegistry {
  private metrics: Map<string, PrometheusMetric[]> = new Map();
  private prefix: string;
  private defaultLabels: Record<string, string>;

  constructor(
    options: {
      prefix?: string;
      defaultLabels?: Record<string, string>;
    } = {},
  ) {
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
  incCounter(
    name: string,
    help: string,
    value: number = 1,
    labels?: Record<string, string>,
  ): void {
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
  setGauge(
    name: string,
    help: string,
    value: number,
    labels?: Record<string, string>,
  ): void {
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
    buckets?: number[],
  ): void {
    this.register({
      name: `${this.prefix}_${name}`,
      help,
      type: "histogram",
      value,
      labels,
      buckets: buckets ?? [
        0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10,
      ],
    });
  }

  /**
   * Record telemetry from L0Monitor
   */
  recordTelemetry(
    telemetry: L0Telemetry,
    labels?: Record<string, string>,
  ): void {
    const baseLabels = { ...labels };

    // Duration
    if (telemetry.duration !== undefined) {
      this.observeHistogram(
        "request_duration_seconds",
        "L0 request duration in seconds",
        telemetry.duration / 1000,
        baseLabels,
        [0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30, 60],
      );
    }

    // Tokens
    this.incCounter(
      "tokens_total",
      "Total tokens generated",
      telemetry.metrics.totalTokens,
      baseLabels,
    );

    if (telemetry.metrics.tokensPerSecond !== undefined) {
      this.setGauge(
        "tokens_per_second",
        "Tokens generated per second",
        telemetry.metrics.tokensPerSecond,
        baseLabels,
      );
    }

    // Time to first token
    if (telemetry.metrics.timeToFirstToken !== undefined) {
      this.observeHistogram(
        "time_to_first_token_seconds",
        "Time to first token in seconds",
        telemetry.metrics.timeToFirstToken / 1000,
        baseLabels,
        [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
      );
    }

    // Retries
    if (telemetry.metrics.totalRetries > 0) {
      this.incCounter(
        "retries_total",
        "Total retry attempts",
        telemetry.metrics.totalRetries,
        baseLabels,
      );

      this.incCounter(
        "retries_network_total",
        "Network-related retry attempts",
        telemetry.metrics.networkRetries,
        { ...baseLabels, retry_type: "network" },
      );

      this.incCounter(
        "retries_model_total",
        "Model-related retry attempts",
        telemetry.metrics.modelRetries,
        { ...baseLabels, retry_type: "model" },
      );
    }

    // Network errors
    if (telemetry.network.errorCount > 0) {
      this.incCounter(
        "network_errors_total",
        "Total network errors",
        telemetry.network.errorCount,
        baseLabels,
      );

      // Per error type
      for (const [errorType, count] of Object.entries(
        telemetry.network.errorsByType,
      )) {
        this.incCounter(
          "network_errors_by_type_total",
          "Network errors by type",
          count,
          { ...baseLabels, error_type: errorType },
        );
      }
    }

    // Guardrail violations
    if (telemetry.guardrails && telemetry.guardrails.violationCount > 0) {
      this.incCounter(
        "guardrail_violations_total",
        "Total guardrail violations",
        telemetry.guardrails.violationCount,
        baseLabels,
      );

      // Per severity
      for (const [severity, count] of Object.entries(
        telemetry.guardrails.violationsBySeverity,
      )) {
        if (count > 0) {
          this.incCounter(
            "guardrail_violations_by_severity_total",
            "Guardrail violations by severity",
            count,
            { ...baseLabels, severity },
          );
        }
      }

      // Per rule
      for (const [rule, count] of Object.entries(
        telemetry.guardrails.violationsByRule,
      )) {
        this.incCounter(
          "guardrail_violations_by_rule_total",
          "Guardrail violations by rule",
          count,
          { ...baseLabels, rule },
        );
      }
    }

    // Drift detection
    if (telemetry.drift?.detected) {
      this.incCounter(
        "drift_detected_total",
        "Drift detection events",
        1,
        baseLabels,
      );
    }

    // Request count (always 1 per telemetry record)
    this.incCounter("requests_total", "Total L0 requests", 1, baseLabels);
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
          lines.push(
            `${name}_bucket${labelStr.replace("}", `,le="+Inf"}`)} ${metric.value}`,
          );
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
 * Standalone Prometheus collector (no prom-client dependency)
 * @deprecated Use L0PrometheusCollector with prom-client for production
 */
export class PrometheusCollector {
  private registry: PrometheusRegistry;

  constructor(
    options: {
      prefix?: string;
      defaultLabels?: Record<string, string>;
    } = {},
  ) {
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
  }

  /**
   * Get the underlying registry
   */
  getRegistry(): PrometheusRegistry {
    return this.registry;
  }
}

/**
 * Create a standalone Prometheus registry (no prom-client dependency)
 * @deprecated Use createL0PrometheusCollector with prom-client for production
 */
export function createPrometheusRegistry(options?: {
  prefix?: string;
  defaultLabels?: Record<string, string>;
}): PrometheusRegistry {
  return new PrometheusRegistry(options);
}

/**
 * Create a standalone Prometheus collector (no prom-client dependency)
 * @deprecated Use createL0PrometheusCollector with prom-client for production
 */
export function createPrometheusCollector(options?: {
  prefix?: string;
  defaultLabels?: Record<string, string>;
}): PrometheusCollector {
  return new PrometheusCollector(options);
}

/**
 * Express/HTTP middleware for standalone Prometheus metrics endpoint
 * @deprecated Use l0PrometheusMiddleware with L0PrometheusCollector for production
 */
export function prometheusMiddleware(
  collector: PrometheusCollector,
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

// Re-export prom-client types for convenience
export type {
  Counter,
  Gauge,
  Histogram,
  Registry,
  CounterConfiguration,
  GaugeConfiguration,
  HistogramConfiguration,
};
