# L0 Built-In Monitoring & Telemetry

Complete guide to L0's built-in monitoring, telemetry, and network tracking capabilities.

## Overview

L0 includes a **built-in monitoring system** that tracks:

- Performance metrics (tokens/sec, latency, duration)
- Network errors (types, frequencies, retries)
- Guardrail violations (by rule and severity)
- Drift detection events
- Retry attempts (network vs model)
- Timing information (TTFT, inter-token times)

**No external services required** - all monitoring is built into L0.

## Quick Start

### Enable Monitoring

```typescript
import { l0 } from "l0";
import { streamText } from "ai";

const result = await l0({
  stream: () => streamText({ model, prompt }),
  monitoring: {
    enabled: true, // Enable built-in monitoring
  },
});

// Access telemetry data
console.log(result.telemetry);
```

### Basic Usage

```typescript
const result = await l0({
  stream: () => streamText({ model, prompt }),
  monitoring: {
    enabled: true,
    includeTimings: true,
    includeNetworkDetails: true,
  },
});

for await (const event of result.stream) {
  // Stream events...
}

// After completion, access telemetry
const telemetry = result.telemetry;
console.log("Session ID:", telemetry.sessionId);
console.log("Duration:", telemetry.duration, "ms");
console.log("Tokens:", telemetry.metrics.totalTokens);
console.log("Tokens/sec:", telemetry.metrics.tokensPerSecond);
console.log("Network errors:", telemetry.network.errorCount);
```

## Configuration

### Monitoring Options

```typescript
interface MonitoringConfig {
  /**
   * Enable telemetry collection (default: false)
   */
  enabled?: boolean;

  /**
   * Sample rate for telemetry (0-1, default: 1.0)
   * 0.5 = monitor 50% of requests
   */
  sampleRate?: number;

  /**
   * Include detailed network error information
   * (default: true)
   */
  includeNetworkDetails?: boolean;

  /**
   * Include timing metrics like TTFT, inter-token times
   * (default: true)
   */
  includeTimings?: boolean;

  /**
   * Custom metadata to attach to all events
   */
  metadata?: Record<string, any>;
}
```

### Full Example

```typescript
const result = await l0({
  stream: () => streamText({ model, prompt }),
  monitoring: {
    enabled: true,
    sampleRate: 1.0, // Monitor 100% of requests
    includeNetworkDetails: true, // Include error details
    includeTimings: true, // Include timing metrics
    metadata: {
      user_id: "user_123",
      model: "gpt-4",
      environment: "production",
    },
  },
});
```

### Sampling

Monitor a subset of requests to reduce overhead:

```typescript
monitoring: {
  enabled: true,
  sampleRate: 0.1  // Monitor 10% of requests
}
```

## Telemetry Data Structure

### Complete Structure

```typescript
interface L0Telemetry {
  // Session identification
  sessionId: string;
  startTime: number;
  endTime?: number;
  duration?: number;

  // Performance metrics
  metrics: {
    timeToFirstToken?: number; // TTFT in ms
    avgInterTokenTime?: number; // Average ms between tokens
    tokensPerSecond?: number; // Throughput
    totalTokens: number; // Total tokens received
    totalRetries: number; // All retries
    networkRetries: number; // Network retries (doesn't count)
    modelRetries: number; // Model retries (counts)
  };

  // Network tracking
  network: {
    errorCount: number; // Total network errors
    errorsByType: Record<string, number>; // Errors grouped by type
    errors?: Array<{
      // Detailed errors (if enabled)
      type: string;
      message: string;
      timestamp: number;
      retried: boolean;
      delay?: number;
    }>;
  };

  // Guardrail violations
  guardrails?: {
    violationCount: number;
    violationsByRule: Record<string, number>;
    violationsBySeverity: {
      warning: number;
      error: number;
      fatal: number;
    };
  };

  // Drift detection
  drift?: {
    detected: boolean;
    types: string[];
  };

  // Custom metadata
  metadata?: Record<string, any>;
}
```

## Accessing Telemetry

### After Stream Completion

```typescript
const result = await l0({
  stream: () => streamText({ model, prompt }),
  monitoring: { enabled: true },
});

// Consume stream
for await (const event of result.stream) {
  // ...
}

// Access telemetry
const telemetry = result.telemetry;
console.log(telemetry);
```

### Quick Summary

```typescript
// Get high-level summary
console.log("Summary:", {
  sessionId: telemetry.sessionId,
  duration: telemetry.duration,
  tokens: telemetry.metrics.totalTokens,
  tokensPerSecond: telemetry.metrics.tokensPerSecond,
  retries: telemetry.metrics.totalRetries,
  networkErrors: telemetry.network.errorCount,
  violations: telemetry.guardrails?.violationCount ?? 0,
});
```

### Network Error Analysis

```typescript
// Check for network errors
if (telemetry.network.errorCount > 0) {
  console.log("Network errors by type:");
  for (const [type, count] of Object.entries(telemetry.network.errorsByType)) {
    console.log(`  ${type}: ${count}`);
  }

  // Access detailed errors (if includeNetworkDetails: true)
  if (telemetry.network.errors) {
    for (const error of telemetry.network.errors) {
      console.log("Error:", error.type, error.message);
      console.log("  Retried:", error.retried);
      console.log("  Delay:", error.delay, "ms");
    }
  }
}
```

### Guardrail Analysis

```typescript
// Check guardrail violations
if (telemetry.guardrails) {
  console.log("Violations:", telemetry.guardrails.violationCount);
  console.log("By severity:", telemetry.guardrails.violationsBySeverity);
  console.log("By rule:", telemetry.guardrails.violationsByRule);
}
```

### Performance Analysis

```typescript
// Analyze performance
console.log("Performance metrics:");
console.log("  Time to first token:", telemetry.metrics.timeToFirstToken, "ms");
console.log(
  "  Avg inter-token time:",
  telemetry.metrics.avgInterTokenTime,
  "ms",
);
console.log("  Tokens per second:", telemetry.metrics.tokensPerSecond);
console.log("  Total duration:", telemetry.duration, "ms");
```

## Exporting Telemetry

### To JSON

```typescript
import { TelemetryExporter } from "l0";

// Export to JSON string
const json = TelemetryExporter.toJSON(telemetry);
console.log(json);

// Or write to file
fs.writeFileSync("telemetry.json", json);
```

### To CSV

```typescript
// Export to CSV format
const csv = TelemetryExporter.toCSV(telemetry);
console.log(csv);

// Append to CSV file
fs.appendFileSync("telemetry.csv", csv + "\n");
```

### To Structured Logs

```typescript
// Export to structured log format
const logEntry = TelemetryExporter.toLogFormat(telemetry);

// Log with your logger
logger.info("L0 execution completed", logEntry);

// Example output:
// {
//   session_id: "l0_1234567890_abc123",
//   timestamp: 1234567890,
//   duration_ms: 1500,
//   metrics: {
//     tokens: 150,
//     tokens_per_second: 100,
//     time_to_first_token_ms: 250,
//     total_retries: 1
//   },
//   network: {
//     error_count: 1,
//     errors_by_type: { "connection_dropped": 1 }
//   }
// }
```

### To Metrics (Time-Series)

```typescript
// Export to metrics format for Datadog, Prometheus, etc.
const metrics = TelemetryExporter.toMetrics(telemetry);

// Send to your metrics backend
for (const metric of metrics) {
  metricsClient.gauge(metric.name, metric.value, {
    timestamp: metric.timestamp,
    tags: metric.tags,
  });
}

// Example metrics:
// - l0.duration
// - l0.tokens.total
// - l0.tokens.per_second
// - l0.time_to_first_token
// - l0.retries.total
// - l0.retries.network
// - l0.retries.model
// - l0.network.errors
// - l0.guardrails.violations
```

## Integration Examples

### With Console Logging

```typescript
const result = await l0({
  stream: () => streamText({ model, prompt }),
  monitoring: { enabled: true },
  onEvent: (event) => {
    if (event.type === "token") {
      process.stdout.write(event.value || "");
    }
  },
});

for await (const event of result.stream) {
  // Stream handling...
}

// Log telemetry
console.log("\n--- Telemetry ---");
console.log("Duration:", result.telemetry.duration, "ms");
console.log("Tokens:", result.telemetry.metrics.totalTokens);
console.log(
  "Tokens/sec:",
  result.telemetry.metrics.tokensPerSecond?.toFixed(2),
);
console.log("Retries:", result.telemetry.metrics.totalRetries);
console.log("Network errors:", result.telemetry.network.errorCount);
```

### With File Logging

```typescript
import fs from "fs";

const result = await l0({
  stream: () => streamText({ model, prompt }),
  monitoring: { enabled: true },
});

for await (const event of result.stream) {
  // Stream handling...
}

// Append to log file
const logEntry = {
  timestamp: new Date().toISOString(),
  telemetry: result.telemetry,
};
fs.appendFileSync("l0.log", JSON.stringify(logEntry) + "\n");
```

### With Datadog

```typescript
import { StatsD } from "hot-shots";
const statsd = new StatsD();

const result = await l0({
  stream: () => streamText({ model, prompt }),
  monitoring: {
    enabled: true,
    metadata: {
      environment: process.env.NODE_ENV,
      model: "gpt-4",
    },
  },
});

for await (const event of result.stream) {
  // Stream handling...
}

// Send to Datadog
const telemetry = result.telemetry;
statsd.gauge("l0.duration", telemetry.duration);
statsd.gauge("l0.tokens", telemetry.metrics.totalTokens);
statsd.gauge("l0.tokens_per_second", telemetry.metrics.tokensPerSecond);
statsd.gauge("l0.network_errors", telemetry.network.errorCount);
statsd.gauge("l0.retries", telemetry.metrics.totalRetries);
```

### With Prometheus (Built-in)

L0 includes a native Prometheus exporter:

```typescript
import { l0, createPrometheusCollector, prometheusMiddleware } from "l0";
import express from "express";

// Create collector
const collector = createPrometheusCollector({
  prefix: "l0",
  defaultLabels: { service: "my-app" },
});

// After each L0 execution, record telemetry
const result = await l0({
  stream: () => streamText({ model, prompt }),
  monitoring: { enabled: true },
});

for await (const event of result.stream) {
  // Stream handling...
}

// Record to Prometheus
collector.record(result.telemetry, { model: "gpt-4", endpoint: "/chat" });

// Expose /metrics endpoint
const app = express();
app.get("/metrics", prometheusMiddleware(collector));
app.listen(9090);
```

See [Prometheus Integration](#prometheus-integration) for full details.

### With Custom Analytics

```typescript
class L0Analytics {
  private events: any[] = [];

  async track(result: L0Result) {
    const telemetry = result.telemetry;

    this.events.push({
      event: "l0_execution",
      session_id: telemetry.sessionId,
      duration: telemetry.duration,
      tokens: telemetry.metrics.totalTokens,
      tokens_per_second: telemetry.metrics.tokensPerSecond,
      retries: telemetry.metrics.totalRetries,
      network_errors: telemetry.network.errorCount,
      violations: telemetry.guardrails?.violationCount ?? 0,
      timestamp: new Date().toISOString(),
    });
  }

  async flush() {
    // Send to your analytics backend
    await fetch("https://analytics.example.com/events", {
      method: "POST",
      body: JSON.stringify(this.events),
    });
    this.events = [];
  }
}

const analytics = new L0Analytics();

const result = await l0({
  stream: () => streamText({ model, prompt }),
  monitoring: { enabled: true },
});

for await (const event of result.stream) {
  // Stream handling...
}

await analytics.track(result);
await analytics.flush();
```

## Monitoring Patterns

### Production Monitoring

```typescript
const result = await l0({
  stream: () => streamText({ model, prompt }),
  monitoring: {
    enabled: true,
    sampleRate: 0.1, // Monitor 10% to reduce overhead
    includeTimings: true,
    includeNetworkDetails: false, // Reduce data size
    metadata: {
      environment: "production",
      user_id: userId,
      model: modelName,
    },
  },
});

// Send to monitoring service
if (result.telemetry) {
  await sendToMonitoring(result.telemetry);
}
```

### Development Debugging

```typescript
const result = await l0({
  stream: () => streamText({ model, prompt }),
  monitoring: {
    enabled: true,
    sampleRate: 1.0, // Monitor everything
    includeTimings: true,
    includeNetworkDetails: true, // Full details
    metadata: {
      environment: "development",
      test_id: testId,
    },
  },
});

// Detailed logging
console.log("Full telemetry:", JSON.stringify(result.telemetry, null, 2));
```

### Performance Profiling

```typescript
const runs: L0Telemetry[] = [];

for (let i = 0; i < 100; i++) {
  const result = await l0({
    stream: () => streamText({ model, prompt }),
    monitoring: { enabled: true },
  });

  for await (const event of result.stream) {
    // Consume stream
  }

  runs.push(result.telemetry);
}

// Analyze performance
const avgDuration = runs.reduce((sum, t) => sum + t.duration, 0) / runs.length;
const avgTokensPerSec =
  runs.reduce((sum, t) => sum + t.metrics.tokensPerSecond, 0) / runs.length;
const totalNetworkErrors = runs.reduce(
  (sum, t) => sum + t.network.errorCount,
  0,
);

console.log("Performance profile:");
console.log("  Avg duration:", avgDuration, "ms");
console.log("  Avg tokens/sec:", avgTokensPerSec);
console.log("  Total network errors:", totalNetworkErrors);
```

### A/B Testing

```typescript
const configA = {
  /* ... */
};
const configB = {
  /* ... */
};

const config = Math.random() < 0.5 ? configA : configB;

const result = await l0({
  stream: () => streamText({ model, prompt }),
  monitoring: {
    enabled: true,
    metadata: {
      ab_test: config === configA ? "A" : "B",
    },
  },
  ...config,
});

// Track which config performed better
const performance = {
  config: config === configA ? "A" : "B",
  duration: result.telemetry.duration,
  tokens_per_second: result.telemetry.metrics.tokensPerSecond,
  retries: result.telemetry.metrics.totalRetries,
};

await trackABTest(performance);
```

## Advanced Usage

### L0Monitor Class

Use the `L0Monitor` class directly for fine-grained control:

```typescript
import { L0Monitor } from "l0";

const monitor = new L0Monitor({
  enabled: true,
  includeTimings: true,
});

monitor.start();

// Record events manually
monitor.recordToken();
monitor.recordToken();
monitor.recordNetworkError(error, true, 1000, 1);
monitor.recordRetry(true);

monitor.complete();

// Get telemetry
const telemetry = monitor.getTelemetry();
console.log(telemetry);

// Get summary
const summary = monitor.getSummary();
console.log(summary);

// Export
const json = monitor.toJSON();
console.log(json);
```

### Custom Metrics

```typescript
const result = await l0({
  stream: () => streamText({ model, prompt }),
  monitoring: {
    enabled: true,
    metadata: {
      custom_metric_1: calculateCustomMetric(),
      feature_flag: isFeatureEnabled(),
      user_tier: getUserTier(),
    },
  },
});

// Custom metadata is included in telemetry
console.log(result.telemetry.metadata);
```

### Conditional Monitoring

```typescript
const shouldMonitor =
  process.env.NODE_ENV === "production" || Math.random() < 0.1;

const result = await l0({
  stream: () => streamText({ model, prompt }),
  monitoring: {
    enabled: shouldMonitor,
    sampleRate: process.env.NODE_ENV === "production" ? 0.1 : 1.0,
  },
});
```

## Built-in Abort Handling

L0 includes built-in abort functionality:

```typescript
const result = await l0({
  stream: () => streamText({ model, prompt }),
  monitoring: { enabled: true },
});

// Abort anytime
setTimeout(() => {
  result.abort(); // Built-in abort method
}, 5000);

try {
  for await (const event of result.stream) {
    // Stream will abort after 5 seconds
  }
} catch (error) {
  console.log("Stream aborted:", error.message);
  // Telemetry is still available
  console.log("Partial telemetry:", result.telemetry);
}
```

### With External AbortSignal

```typescript
const controller = new AbortController();

const result = await l0({
  stream: () => streamText({ model, prompt }),
  signal: controller.signal, // External signal
  monitoring: { enabled: true },
});

// Use either built-in or external abort
setTimeout(() => {
  result.abort(); // Built-in method
  // OR
  controller.abort(); // External signal
}, 5000);
```

## Best Practices

### 1. Enable in Production with Sampling

```typescript
monitoring: {
  enabled: true,
  sampleRate: 0.1,  // 10% to reduce overhead
  includeNetworkDetails: false
}
```

### 2. Full Details in Development

```typescript
monitoring: {
  enabled: true,
  sampleRate: 1.0,
  includeNetworkDetails: true,
  includeTimings: true
}
```

### 3. Add Contextual Metadata

```typescript
monitoring: {
  enabled: true,
  metadata: {
    user_id: userId,
    model: modelName,
    environment: process.env.NODE_ENV,
    request_id: requestId
  }
}
```

### 4. Export Telemetry Async

```typescript
// Don't block the response
setImmediate(() => {
  sendToMonitoring(result.telemetry);
});
```

### 5. Monitor Key Metrics

Focus on:

- `tokensPerSecond` - Throughput
- `timeToFirstToken` - Latency
- `network.errorCount` - Reliability
- `metrics.networkRetries` - Network quality
- `duration` - Overall performance

## Performance Impact

Monitoring overhead is minimal:

- **Disabled**: 0ms (no overhead)
- **Enabled without details**: ~0.1ms per token
- **Enabled with full details**: ~0.2ms per token
- **Memory**: ~1KB per 1000 tokens

Sampling reduces overhead proportionally.

## Prometheus Integration

L0 includes native Prometheus support with automatic metric generation.

### Quick Start

```typescript
import { l0, createPrometheusCollector, prometheusMiddleware } from "l0";
import express from "express";

const collector = createPrometheusCollector();
const app = express();

// Parse JSON request bodies
app.use(express.json());

// Expose metrics endpoint
app.get("/metrics", prometheusMiddleware(collector));

// Record telemetry after each request
app.post("/chat", async (req, res) => {
  const result = await l0({
    stream: () => streamText({ model, prompt: req.body.prompt }),
    monitoring: { enabled: true },
  });

  let response = "";
  for await (const event of result.stream) {
    if (event.type === "token") response += event.value;
  }

  // Record to Prometheus
  collector.record(result.telemetry, {
    model: "gpt-4",
    endpoint: "/chat",
  });

  res.json({ response });
});

app.listen(3000);
```

### Configuration

```typescript
const collector = createPrometheusCollector({
  prefix: "l0", // Metric prefix (default: 'l0')
  defaultLabels: {
    // Labels added to all metrics
    service: "my-app",
    environment: "production",
  },
});
```

### Exported Metrics

| Metric                                      | Type      | Description            |
| ------------------------------------------- | --------- | ---------------------- |
| `l0_requests_total`                         | Counter   | Total L0 requests      |
| `l0_request_duration_seconds`               | Histogram | Request duration       |
| `l0_tokens_total`                           | Counter   | Total tokens generated |
| `l0_tokens_per_second`                      | Gauge     | Generation throughput  |
| `l0_time_to_first_token_seconds`            | Histogram | Time to first token    |
| `l0_retries_total`                          | Counter   | Total retry attempts   |
| `l0_retries_network_total`                  | Counter   | Network retries        |
| `l0_retries_model_total`                    | Counter   | Model retries          |
| `l0_network_errors_total`                   | Counter   | Total network errors   |
| `l0_network_errors_by_type_total`           | Counter   | Errors by type         |
| `l0_guardrail_violations_total`             | Counter   | Total violations       |
| `l0_guardrail_violations_by_severity_total` | Counter   | Violations by severity |
| `l0_guardrail_violations_by_rule_total`     | Counter   | Violations by rule     |
| `l0_drift_detected_total`                   | Counter   | Drift detection events |

### Labels

Add custom labels per request:

```typescript
collector.record(telemetry, {
  model: "gpt-4",
  endpoint: "/chat",
  user_tier: "premium",
  region: "us-east-1",
});
```

### Using the Registry Directly

For more control, use `PrometheusRegistry`:

```typescript
import { createPrometheusRegistry } from "l0";

const registry = createPrometheusRegistry({
  prefix: "myapp_l0",
  defaultLabels: { service: "api" },
});

// Record telemetry
registry.recordTelemetry(telemetry, { model: "gpt-4" });

// Or record custom metrics
registry.incCounter("custom_events_total", "Custom event count", 1, {
  type: "special",
});
registry.setGauge("active_streams", "Active streams", 5);
registry.observeHistogram("custom_latency_seconds", "Custom latency", 0.5);

// Export
console.log(registry.expose());
```

### Example Output

```
# HELP l0_requests_total Total L0 requests
# TYPE l0_requests_total counter
l0_requests_total{service="my-app",model="gpt-4"} 150

# HELP l0_request_duration_seconds L0 request duration in seconds
# TYPE l0_request_duration_seconds histogram
l0_request_duration_seconds_bucket{service="my-app",model="gpt-4",le="+Inf"} 1.5
l0_request_duration_seconds_sum{service="my-app",model="gpt-4"} 1.5
l0_request_duration_seconds_count{service="my-app",model="gpt-4"} 1

# HELP l0_tokens_total Total tokens generated
# TYPE l0_tokens_total counter
l0_tokens_total{service="my-app",model="gpt-4"} 1250

# HELP l0_time_to_first_token_seconds Time to first token in seconds
# TYPE l0_time_to_first_token_seconds histogram
l0_time_to_first_token_seconds_bucket{service="my-app",model="gpt-4",le="+Inf"} 0.25
l0_time_to_first_token_seconds_sum{service="my-app",model="gpt-4"} 0.25
l0_time_to_first_token_seconds_count{service="my-app",model="gpt-4"} 1

# HELP l0_network_errors_total Total network errors
# TYPE l0_network_errors_total counter
l0_network_errors_total{service="my-app",model="gpt-4"} 2

# HELP l0_network_errors_by_type_total Network errors by type
# TYPE l0_network_errors_by_type_total counter
l0_network_errors_by_type_total{service="my-app",model="gpt-4",error_type="connection_dropped"} 1
l0_network_errors_by_type_total{service="my-app",model="gpt-4",error_type="timeout"} 1
```

### Grafana Dashboard

Example PromQL queries for Grafana:

```promql
# Request rate
rate(l0_requests_total[5m])

# Average duration
rate(l0_request_duration_seconds_sum[5m]) / rate(l0_request_duration_seconds_count[5m])

# Tokens per second (average)
avg(l0_tokens_per_second)

# Error rate
rate(l0_network_errors_total[5m]) / rate(l0_requests_total[5m])

# P99 time to first token
histogram_quantile(0.99, rate(l0_time_to_first_token_seconds_bucket[5m]))

# Guardrail violations by severity
sum by (severity) (rate(l0_guardrail_violations_by_severity_total[5m]))
```

### With prom-client

If you're already using `prom-client`, you can still use L0's exporter alongside:

```typescript
import { Registry } from "prom-client";
import { createPrometheusCollector } from "l0";

const promRegistry = new Registry();
const l0Collector = createPrometheusCollector();

// Combine metrics in your endpoint
app.get("/metrics", async (req, res) => {
  const promMetrics = await promRegistry.metrics();
  const l0Metrics = l0Collector.expose();

  res.set("Content-Type", "text/plain");
  res.send(promMetrics + "\n" + l0Metrics);
});
```

---

## Sentry Integration

L0 includes native Sentry support for error tracking and performance monitoring.

### Quick Start

```typescript
import * as Sentry from "@sentry/node";
import { l0, sentryInterceptor } from "l0";

Sentry.init({ dsn: "your-sentry-dsn" });

const result = await l0({
  stream: () => streamText({ model, prompt }),
  monitoring: { enabled: true },
  interceptors: [sentryInterceptor({ hub: Sentry })],
});
```

### Using withSentry Wrapper

```typescript
import * as Sentry from "@sentry/node";
import { l0, withSentry } from "l0";

const result = await withSentry({ hub: Sentry }, () =>
  l0({
    stream: () => streamText({ model, prompt }),
    monitoring: { enabled: true },
  }),
);
```

### Configuration

```typescript
import { sentryInterceptor } from "l0";

sentryInterceptor({
  hub: Sentry, // Required: Sentry instance
  captureNetworkErrors: true, // Capture network failures (default: true)
  captureGuardrailViolations: true, // Capture guardrail violations (default: true)
  minGuardrailSeverity: "error", // Min severity to capture (default: 'error')
  breadcrumbsForTokens: false, // Add breadcrumb per token (default: false)
  enableTracing: true, // Enable performance tracing (default: true)
  tags: {
    // Custom tags for all events
    model: "gpt-4",
    environment: "production",
  },
});
```

### What Gets Tracked

**Breadcrumbs:**

- L0 execution start/complete
- Stream start/complete
- First token (TTFT)
- Network errors
- Retry attempts
- Guardrail violations
- Drift detection

**Errors Captured:**

- Network errors (final failures, not retried)
- Guardrail violations (error/fatal severity)
- Execution failures

**Performance Transactions:**

- `l0.execution` - Full execution span
- `l0.stream.consume` - Stream consumption span
- Token count, duration, TTFT as span data

### Manual Integration

For fine-grained control:

```typescript
import * as Sentry from "@sentry/node";
import { l0, createSentryIntegration } from "l0";

const sentry = createSentryIntegration({ hub: Sentry });

// Start tracking
sentry.startExecution("my-chat-request", { user_id: "123" });
sentry.startStream();

const result = await l0({
  stream: () => streamText({ model, prompt }),
  monitoring: { enabled: true },
});

let tokenCount = 0;
for await (const event of result.stream) {
  if (event.type === "token") {
    tokenCount++;
    if (tokenCount === 1) {
      sentry.recordFirstToken(result.telemetry?.metrics.timeToFirstToken ?? 0);
    }
    sentry.recordToken(event.value);
  }
}

// Complete tracking
sentry.completeStream(tokenCount);
sentry.completeExecution(result.telemetry);
```

### Error Handling

```typescript
const sentry = createSentryIntegration({ hub: Sentry });
sentry.startExecution();

let result;
try {
  result = await l0({ stream, monitoring: { enabled: true } });

  for await (const event of result.stream) {
    // ...
  }

  sentry.completeExecution(result.telemetry);
} catch (error) {
  sentry.recordFailure(error, result?.telemetry);
  throw error;
}
```

### Telemetry Context

L0 automatically sets Sentry context with telemetry data:

```typescript
// Automatically set on completion:
Sentry.setContext("l0_telemetry", {
  session_id: "l0_123...",
  duration_ms: 1500,
  tokens: 250,
  tokens_per_second: 166,
  ttft_ms: 280,
  retries: 1,
  network_errors: 0,
  guardrail_violations: 0,
});
```

### Example Sentry Dashboard

Events you'll see in Sentry:

```
[ERROR] Network error: connection_dropped
  Tags: error_type=connection_dropped, component=l0.network

[WARNING] Guardrail violation: json-structure
  Message: Unbalanced braces: 2 open, 1 close

[TRANSACTION] l0.execution (1.5s)
  └── l0.stream.consume (1.2s)
      Data: tokens=250, ttft_ms=280
```

---

## Summary

L0's built-in monitoring provides:

- ✅ **Native Prometheus support** - built-in exporter with all metrics
- ✅ **Native Sentry support** - error tracking and performance monitoring
- ✅ **No external dependencies** - everything built-in
- ✅ **Comprehensive metrics** - performance, errors, violations
- ✅ **Flexible sampling** - control overhead
- ✅ **Multiple export formats** - JSON, CSV, logs, metrics
- ✅ **Built-in abort handling** - cancel streams anytime
- ✅ **Production-ready** - minimal overhead
- ✅ **Easy integration** - works with any monitoring service

Use L0's monitoring to track reliability, performance, and quality of your LLM applications!
