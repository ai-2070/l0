/**
 * L0 Monitoring - OpenTelemetry and Sentry integrations
 *
 * Import from "@ai2070/l0/monitoring" to get monitoring features
 * without bundling them in your main application.
 *
 * @example
 * ```typescript
 * import { sentryInterceptor, openTelemetryInterceptor } from "@ai2070/l0/monitoring";
 * ```
 */

// Core monitoring
export {
  L0Monitor,
  createMonitor,
  TelemetryExporter,
} from "./runtime/monitoring.js";

export type { MonitoringConfig } from "./runtime/monitoring.js";

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
