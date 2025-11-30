// Prometheus Integration Tests
// Run: OPENAI_API_KEY=sk-... npm run test:integration

import { describe, it, expect, beforeEach } from "vitest";
import { describeIf, hasOpenAI, LLM_TIMEOUT } from "./setup";
import {
  PrometheusRegistry,
  PrometheusCollector,
  createPrometheusRegistry,
  createPrometheusCollector,
  DEFAULT_BUCKETS,
  METRIC_NAMES,
} from "../src/runtime/prometheus";
import { l0 } from "../src/runtime/l0";
import { streamText } from "ai";
import { openai } from "@ai-sdk/openai";

describe("Prometheus Integration", () => {
  describe("PrometheusRegistry", () => {
    let registry: PrometheusRegistry;

    beforeEach(() => {
      registry = new PrometheusRegistry({ prefix: "test_l0" });
    });

    it("should create a registry with default options", () => {
      const defaultRegistry = new PrometheusRegistry();
      expect(defaultRegistry).toBeInstanceOf(PrometheusRegistry);
    });

    it("should create a registry with custom prefix", () => {
      expect(registry).toBeInstanceOf(PrometheusRegistry);
    });

    it("should create a registry with default labels", () => {
      const labeledRegistry = new PrometheusRegistry({
        prefix: "test",
        defaultLabels: { service: "test-service", env: "test" },
      });
      expect(labeledRegistry).toBeInstanceOf(PrometheusRegistry);
    });

    it("should increment counter", () => {
      registry.incCounter("requests_total", "Total requests", 1, {
        status: "success",
      });
      registry.incCounter("requests_total", "Total requests", 1, {
        status: "success",
      });
      registry.incCounter("requests_total", "Total requests", 1, {
        status: "error",
      });

      const metrics = registry.expose();
      expect(metrics).toContain("test_l0_requests_total");
      expect(metrics).toContain('status="success"');
      expect(metrics).toContain('status="error"');
    });

    it("should set gauge value", () => {
      registry.setGauge("active_streams", "Active streams", 5, {
        model: "gpt-5-micro",
      });
      registry.setGauge("active_streams", "Active streams", 3, {
        model: "gpt-3.5",
      });

      const metrics = registry.expose();
      expect(metrics).toContain("test_l0_active_streams");
      expect(metrics).toContain('model="gpt-5-micro"');
    });

    it("should observe histogram values", () => {
      registry.observeHistogram(
        "request_duration_seconds",
        "Request duration",
        0.5,
        { endpoint: "/chat" },
      );
      registry.observeHistogram(
        "request_duration_seconds",
        "Request duration",
        1.2,
        { endpoint: "/chat" },
      );
      registry.observeHistogram(
        "request_duration_seconds",
        "Request duration",
        0.3,
        { endpoint: "/chat" },
      );

      const metrics = registry.expose();
      expect(metrics).toContain("test_l0_request_duration_seconds");
      expect(metrics).toContain("_bucket");
      expect(metrics).toContain("_count");
      expect(metrics).toContain("_sum");
    });

    it("should expose metrics as text", () => {
      registry.incCounter("test_counter", "Test counter", 1, {});

      const text = registry.expose();
      expect(typeof text).toBe("string");
      expect(text.length).toBeGreaterThan(0);
    });

    it("should clear metrics", () => {
      registry.incCounter("test_counter", "Test counter", 5, {});
      registry.clear();

      const metrics = registry.expose();
      // After clear, should be empty
      expect(metrics).toBe("");
    });

    it("should record telemetry from L0", () => {
      registry.recordTelemetry({
        sessionId: "test-session",
        startTime: Date.now() - 1000,
        endTime: Date.now(),
        duration: 1000,
        metrics: {
          totalTokens: 50,
          tokensPerSecond: 50,
          timeToFirstToken: 200,
          totalRetries: 0,
          networkRetryCount: 0,
          modelRetryCount: 0,
        },
        network: {
          errorCount: 0,
          errorsByType: {},
        },
        guardrails: {
          violationCount: 0,
          violationsByRule: {},
          violationsByRuleAndSeverity: {},
          violationsBySeverity: { warning: 0, error: 0, fatal: 0 },
        },
      });

      const metrics = registry.expose();
      expect(metrics).toContain("test_l0_requests_total");
      expect(metrics).toContain("test_l0_tokens_total");
    });
  });

  describe("PrometheusCollector", () => {
    let collector: PrometheusCollector;

    beforeEach(() => {
      collector = new PrometheusCollector({ prefix: "test_l0" });
    });

    it("should create a collector with default options", () => {
      const defaultCollector = new PrometheusCollector();
      expect(defaultCollector).toBeInstanceOf(PrometheusCollector);
    });

    it("should record telemetry", () => {
      collector.record({
        sessionId: "test-session",
        startTime: Date.now() - 1000,
        endTime: Date.now(),
        duration: 1000,
        metrics: {
          totalTokens: 50,
          tokensPerSecond: 50,
          timeToFirstToken: 200,
          totalRetries: 1,
          networkRetryCount: 0,
          modelRetryCount: 1,
        },
        network: {
          errorCount: 0,
          errorsByType: {},
        },
        guardrails: {
          violationCount: 0,
          violationsByRule: {},
          violationsByRuleAndSeverity: {},
          violationsBySeverity: { warning: 0, error: 0, fatal: 0 },
        },
      });

      const metrics = collector.expose();
      expect(metrics).toContain("test_l0_requests_total");
      expect(metrics).toContain("test_l0_tokens_total");
    });

    it("should expose metrics", () => {
      collector.record({
        sessionId: "test",
        startTime: Date.now(),
        endTime: Date.now(),
        duration: 500,
        metrics: {
          totalTokens: 10,
          totalRetries: 0,
          networkRetryCount: 0,
          modelRetryCount: 0,
        },
        network: { errorCount: 0, errorsByType: {} },
        guardrails: {
          violationCount: 0,
          violationsByRule: {},
          violationsByRuleAndSeverity: {},
          violationsBySeverity: { warning: 0, error: 0, fatal: 0 },
        },
      });

      const metrics = collector.expose();
      expect(typeof metrics).toBe("string");
      expect(metrics.length).toBeGreaterThan(0);
    });

    it("should clear metrics", () => {
      collector.record({
        sessionId: "test",
        startTime: Date.now(),
        endTime: Date.now(),
        duration: 500,
        metrics: {
          totalTokens: 10,
          totalRetries: 0,
          networkRetryCount: 0,
          modelRetryCount: 0,
        },
        network: { errorCount: 0, errorsByType: {} },
        guardrails: {
          violationCount: 0,
          violationsByRule: {},
          violationsByRuleAndSeverity: {},
          violationsBySeverity: { warning: 0, error: 0, fatal: 0 },
        },
      });

      collector.clear();
      const metrics = collector.expose();
      expect(metrics).toBe("");
    });

    it("should get underlying registry", () => {
      const registry = collector.getRegistry();
      expect(registry).toBeInstanceOf(PrometheusRegistry);
    });
  });

  describe("Factory Functions", () => {
    it("should create registry via factory", () => {
      const registry = createPrometheusRegistry({ prefix: "factory_test" });
      expect(registry).toBeInstanceOf(PrometheusRegistry);
    });

    it("should create collector via factory", () => {
      const collector = createPrometheusCollector({ prefix: "factory_test" });
      expect(collector).toBeInstanceOf(PrometheusCollector);
    });
  });

  describe("Constants", () => {
    it("should export default buckets", () => {
      expect(DEFAULT_BUCKETS).toBeDefined();
      expect(DEFAULT_BUCKETS.duration).toBeInstanceOf(Array);
      expect(DEFAULT_BUCKETS.ttft).toBeInstanceOf(Array);
      expect(DEFAULT_BUCKETS.tokens).toBeInstanceOf(Array);
    });

    it("should export metric names", () => {
      expect(METRIC_NAMES).toBeDefined();
      expect(METRIC_NAMES.requestsTotal).toBeDefined();
      expect(METRIC_NAMES.tokensTotal).toBeDefined();
      expect(METRIC_NAMES.requestDuration).toBeDefined();
    });
  });

  describe("Metrics Format", () => {
    it("should output valid Prometheus text format", () => {
      const registry = new PrometheusRegistry({ prefix: "format_test" });

      registry.incCounter("http_requests_total", "Total HTTP requests", 1, {
        method: "GET",
        status: "200",
      });
      registry.setGauge("temperature", "Temperature", 23.5, {
        location: "office",
      });
      registry.observeHistogram(
        "request_latency_seconds",
        "Request latency",
        0.5,
        {
          path: "/api",
        },
      );

      const metrics = registry.expose();

      // Check for HELP comments
      expect(metrics).toMatch(/# HELP/);
      // Check for TYPE comments
      expect(metrics).toMatch(/# TYPE/);
      // Check label format
      expect(metrics).toMatch(/\{[^}]+\}/);
    });

    it("should handle metrics with labels", () => {
      const registry = new PrometheusRegistry({ prefix: "labeled" });

      registry.incCounter("test", "Test metric", 1, {
        path: "/api/v1",
        env: "prod",
      });

      const metrics = registry.expose();
      expect(metrics).toContain("labeled_test");
      expect(metrics).toContain('path="/api/v1"');
      expect(metrics).toContain('env="prod"');
    });
  });

  describeIf(hasOpenAI)("Live Prometheus Integration with LLM", () => {
    it(
      "should collect metrics from L0 execution",
      async () => {
        const collector = new PrometheusCollector({ prefix: "live_test" });

        const result = await l0({
          stream: () =>
            streamText({
              model: openai("gpt-5-nano"),
              prompt: "Say: Hello",
            }),
          detectZeroTokens: false,
          monitoring: { enabled: true },
        });

        for await (const _event of result.stream) {
          // consume
        }

        // Record telemetry if available
        if (result.telemetry) {
          collector.record(result.telemetry);
        }

        const metrics = collector.expose();

        // Verify metrics were collected
        expect(metrics).toContain("live_test_requests_total");
        expect(metrics.length).toBeGreaterThan(100);
      },
      LLM_TIMEOUT,
    );

    it(
      "should aggregate metrics from multiple requests",
      async () => {
        const collector = new PrometheusCollector({ prefix: "aggregate" });

        // Run multiple requests
        for (let i = 0; i < 2; i++) {
          const result = await l0({
            stream: () =>
              streamText({
                model: openai("gpt-5-nano"),
                prompt: `Say: Test ${i}`,
              }),
            detectZeroTokens: false,
            monitoring: { enabled: true },
          });

          for await (const _event of result.stream) {
            // consume
          }

          if (result.telemetry) {
            collector.record(result.telemetry);
          }
        }

        const metrics = collector.expose();

        // Should have aggregated request count
        expect(metrics).toContain("aggregate_requests_total");
        // The counter should show 2 requests (may or may not have labels)
        expect(metrics).toMatch(
          /aggregate_requests_total\s+2|aggregate_requests_total\{[^}]*\}\s+2/,
        );
      },
      LLM_TIMEOUT * 3,
    );
  });

  describe("Default Labels", () => {
    it("should apply default labels to all metrics", () => {
      const collector = new PrometheusCollector({
        prefix: "labeled",
        defaultLabels: {
          service: "my-service",
          environment: "test",
        },
      });

      collector.record({
        sessionId: "test",
        startTime: Date.now(),
        endTime: Date.now(),
        duration: 500,
        metrics: {
          totalTokens: 10,
          totalRetries: 0,
          networkRetryCount: 0,
          modelRetryCount: 0,
        },
        network: { errorCount: 0, errorsByType: {} },
        guardrails: {
          violationCount: 0,
          violationsByRule: {},
          violationsByRuleAndSeverity: {},
          violationsBySeverity: { warning: 0, error: 0, fatal: 0 },
        },
      });

      const metrics = collector.expose();
      expect(metrics).toContain('service="my-service"');
      expect(metrics).toContain('environment="test"');
    });
  });
});
