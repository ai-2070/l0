/**
 * L0 Monitoring - Prometheus, OpenTelemetry, and Sentry integrations
 *
 * Import from "@ai2070/l0/monitoring" to get monitoring features
 * without bundling them in your main application.
 *
 * @example
 * ```typescript
 * import { createPrometheusCollector, sentryInterceptor } from "@ai2070/l0/monitoring";
 * ```
 */

// Core monitoring
export {
  L0Monitor,
  createMonitor,
  TelemetryExporter,
} from "./runtime/monitoring.js";

export type { MonitoringConfig } from "./runtime/monitoring.js";

// Prometheus metrics
export {
  // prom-client based (recommended)
  L0PrometheusCollector,
  createL0PrometheusCollector,
  l0PrometheusMiddleware,
  // Standalone (no dependency)
  PrometheusRegistry,
  PrometheusCollector,
  createPrometheusRegistry,
  createPrometheusCollector,
  prometheusMiddleware,
  // Constants
  DEFAULT_BUCKETS,
  METRIC_NAMES,
} from "./runtime/prometheus.js";

export type {
  PromClient,
  PrometheusConfig,
  PrometheusMetricType,
  PrometheusMetric,
} from "./runtime/prometheus.js";

// Sentry integration
export {
  L0Sentry,
  createSentryIntegration,
  sentryInterceptor,
  withSentry,
} from "./runtime/sentry.js";

export type { SentryClient, SentryConfig } from "./runtime/sentry.js";

// OpenTelemetry integration
export {
  L0OpenTelemetry,
  createOpenTelemetry,
  openTelemetryInterceptor,
  SemanticAttributes,
  SpanStatusCode,
  SpanKind,
} from "./runtime/opentelemetry.js";

export type { OpenTelemetryConfig } from "./runtime/opentelemetry.js";
