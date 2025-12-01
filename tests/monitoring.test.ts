// Tests for src/runtime/monitoring.ts

import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import {
  L0Monitor,
  createMonitor,
  TelemetryExporter,
  MonitoringConfig,
} from "../src/runtime/monitoring";
import type { GuardrailViolation } from "../src/types/guardrails";

describe("L0Monitor", () => {
  describe("constructor and isEnabled", () => {
    it("should be disabled by default", () => {
      const monitor = new L0Monitor();
      // isEnabled uses random sampling, but when disabled it should always return false
      // Check 10 times to be sure
      for (let i = 0; i < 10; i++) {
        expect(monitor.isEnabled()).toBe(false);
      }
    });

    it("should be enabled when configured", () => {
      const monitor = new L0Monitor({ enabled: true, sampleRate: 1.0 });
      expect(monitor.isEnabled()).toBe(true);
    });

    it("should respect sampleRate", () => {
      const monitor = new L0Monitor({ enabled: true, sampleRate: 0 });
      // With sampleRate 0, should never be enabled
      for (let i = 0; i < 10; i++) {
        expect(monitor.isEnabled()).toBe(false);
      }
    });

    it("should use default config values", () => {
      const monitor = new L0Monitor({ enabled: true });
      const telemetry = monitor.getTelemetry();
      expect(telemetry).toBeDefined();
      expect(telemetry?.sessionId).toMatch(/^l0_\d+_[a-z0-9]+$/);
    });

    it("should accept custom metadata", () => {
      const monitor = new L0Monitor({
        enabled: true,
        metadata: { app: "test", version: "1.0" },
      });
      const telemetry = monitor.getTelemetry();
      expect(telemetry?.metadata).toEqual({ app: "test", version: "1.0" });
    });
  });

  describe("start and complete", () => {
    it("should record start time", () => {
      const monitor = new L0Monitor({ enabled: true });
      const before = Date.now();
      monitor.start();
      const telemetry = monitor.getTelemetry();
      expect(telemetry?.startTime).toBeGreaterThanOrEqual(before);
    });

    it("should calculate duration on complete", async () => {
      const monitor = new L0Monitor({ enabled: true });
      monitor.start();
      await new Promise((resolve) => setTimeout(resolve, 15));
      monitor.complete();
      const telemetry = monitor.getTelemetry();
      expect(telemetry?.endTime).toBeDefined();
      expect(telemetry?.duration).toBeGreaterThanOrEqual(10);
    });

    it("should not record when disabled", () => {
      const monitor = new L0Monitor({ enabled: false });
      monitor.start();
      monitor.complete();
      const telemetry = monitor.getTelemetry();
      expect(telemetry).toBeUndefined();
    });
  });

  describe("recordToken", () => {
    it("should increment token count", () => {
      const monitor = new L0Monitor({ enabled: true });
      monitor.recordToken();
      monitor.recordToken();
      monitor.recordToken();
      const telemetry = monitor.getTelemetry();
      expect(telemetry?.metrics.totalTokens).toBe(3);
    });

    it("should calculate time to first token", () => {
      const monitor = new L0Monitor({ enabled: true, includeTimings: true });
      monitor.start();
      const startTime = monitor.getTelemetry()?.startTime ?? Date.now();
      monitor.recordToken(startTime + 100);
      const telemetry = monitor.getTelemetry();
      expect(telemetry?.metrics.timeToFirstToken).toBe(100);
    });

    it("should accept custom timestamp", () => {
      const monitor = new L0Monitor({ enabled: true, includeTimings: true });
      monitor.start();
      const customTime = Date.now() + 500;
      monitor.recordToken(customTime);
      // Token should be recorded at the custom timestamp
      expect(monitor.getTelemetry()?.metrics.totalTokens).toBe(1);
    });

    it("should not record when disabled", () => {
      const monitor = new L0Monitor({ enabled: false });
      monitor.recordToken();
      // getTelemetry returns undefined when disabled
      expect(monitor.getTelemetry()).toBeUndefined();
    });
  });

  describe("recordNetworkError", () => {
    it("should increment error count", () => {
      const monitor = new L0Monitor({ enabled: true });
      monitor.recordNetworkError(new Error("ECONNRESET"), false);
      const telemetry = monitor.getTelemetry();
      expect(telemetry?.network.errorCount).toBe(1);
    });

    it("should categorize errors by type", () => {
      const monitor = new L0Monitor({ enabled: true });
      // ECONNRESET gets classified as connection_dropped by analyzeNetworkError
      monitor.recordNetworkError(new Error("ECONNRESET"), false);
      monitor.recordNetworkError(new Error("ECONNRESET"), true);
      monitor.recordNetworkError(new Error("ETIMEDOUT"), false);
      const telemetry = monitor.getTelemetry();
      expect(telemetry?.network.errorsByType["connection_dropped"]).toBe(2);
      expect(telemetry?.network.errorsByType["timeout"]).toBe(1);
    });

    it("should record detailed errors when includeNetworkDetails is true", () => {
      const monitor = new L0Monitor({
        enabled: true,
        includeNetworkDetails: true,
      });
      monitor.recordNetworkError(new Error("Connection dropped"), true, 1000);
      const telemetry = monitor.getTelemetry();
      expect(telemetry?.network.errors).toHaveLength(1);
      expect(telemetry?.network.errors?.[0]).toMatchObject({
        message: "Connection dropped",
        retried: true,
        delay: 1000,
      });
    });

    it("should not record detailed errors when includeNetworkDetails is false", () => {
      const monitor = new L0Monitor({
        enabled: true,
        includeNetworkDetails: false,
      });
      monitor.recordNetworkError(new Error("Connection dropped"), true);
      const telemetry = monitor.getTelemetry();
      expect(telemetry?.network.errors).toBeUndefined();
    });
  });

  describe("recordRetry", () => {
    it("should increment total retries", () => {
      const monitor = new L0Monitor({ enabled: true });
      monitor.recordRetry(true);
      monitor.recordRetry(false);
      const telemetry = monitor.getTelemetry();
      expect(telemetry?.metrics.totalRetries).toBe(2);
    });

    it("should track network vs model retries", () => {
      const monitor = new L0Monitor({ enabled: true });
      monitor.recordRetry(true); // network
      monitor.recordRetry(true); // network
      monitor.recordRetry(false); // model
      const telemetry = monitor.getTelemetry();
      expect(telemetry?.metrics.networkRetryCount).toBe(2);
      expect(telemetry?.metrics.modelRetryCount).toBe(1);
    });
  });

  describe("recordGuardrailViolations", () => {
    it("should initialize guardrails section", () => {
      const monitor = new L0Monitor({ enabled: true });
      const violations: GuardrailViolation[] = [
        {
          rule: "test-rule",
          severity: "warning",
          message: "Test violation",
          context: { position: 0 },
          recoverable: true,
        },
      ];
      monitor.recordGuardrailViolations(violations);
      const telemetry = monitor.getTelemetry();
      expect(telemetry?.guardrails).toBeDefined();
      expect(telemetry?.guardrails?.violationCount).toBe(1);
    });

    it("should track violations by rule", () => {
      const monitor = new L0Monitor({ enabled: true });
      const violations: GuardrailViolation[] = [
        {
          rule: "rule-a",
          severity: "warning",
          message: "Violation A1",
          context: { position: 0 },
          recoverable: true,
        },
        {
          rule: "rule-a",
          severity: "error",
          message: "Violation A2",
          context: { position: 10 },
          recoverable: true,
        },
        {
          rule: "rule-b",
          severity: "fatal",
          message: "Violation B",
          context: { position: 20 },
          recoverable: false,
        },
      ];
      monitor.recordGuardrailViolations(violations);
      const telemetry = monitor.getTelemetry();
      expect(telemetry?.guardrails?.violationsByRule["rule-a"]).toBe(2);
      expect(telemetry?.guardrails?.violationsByRule["rule-b"]).toBe(1);
    });

    it("should track violations by severity", () => {
      const monitor = new L0Monitor({ enabled: true });
      const violations: GuardrailViolation[] = [
        {
          rule: "rule",
          severity: "warning",
          message: "W",
          context: { position: 0 },
          recoverable: true,
        },
        {
          rule: "rule",
          severity: "error",
          message: "E",
          context: { position: 10 },
          recoverable: true,
        },
        {
          rule: "rule",
          severity: "fatal",
          message: "F",
          context: { position: 20 },
          recoverable: false,
        },
      ];
      monitor.recordGuardrailViolations(violations);
      const telemetry = monitor.getTelemetry();
      expect(telemetry?.guardrails?.violationsBySeverity).toEqual({
        warning: 1,
        error: 1,
        fatal: 1,
      });
    });

    it("should track violations by rule and severity", () => {
      const monitor = new L0Monitor({ enabled: true });
      const violations: GuardrailViolation[] = [
        {
          rule: "rule-x",
          severity: "warning",
          message: "W1",
          context: { position: 0 },
          recoverable: true,
        },
        {
          rule: "rule-x",
          severity: "warning",
          message: "W2",
          context: { position: 5 },
          recoverable: true,
        },
        {
          rule: "rule-x",
          severity: "error",
          message: "E",
          context: { position: 10 },
          recoverable: true,
        },
      ];
      monitor.recordGuardrailViolations(violations);
      const telemetry = monitor.getTelemetry();
      expect(
        telemetry?.guardrails?.violationsByRuleAndSeverity["rule-x"],
      ).toEqual({
        warning: 2,
        error: 1,
        fatal: 0,
      });
    });
  });

  describe("recordDrift", () => {
    it("should record drift detection", () => {
      const monitor = new L0Monitor({ enabled: true });
      monitor.recordDrift(true, ["semantic", "format"]);
      const telemetry = monitor.getTelemetry();
      expect(telemetry?.drift).toEqual({
        detected: true,
        types: ["semantic", "format"],
      });
    });

    it("should record no drift", () => {
      const monitor = new L0Monitor({ enabled: true });
      monitor.recordDrift(false, []);
      const telemetry = monitor.getTelemetry();
      expect(telemetry?.drift).toEqual({
        detected: false,
        types: [],
      });
    });
  });

  describe("recordContinuation", () => {
    it("should record continuation enabled but not used", () => {
      const monitor = new L0Monitor({ enabled: true });
      monitor.recordContinuation(true, false);
      const telemetry = monitor.getTelemetry();
      expect(telemetry?.continuation).toEqual({
        enabled: true,
        used: false,
        continuationCount: 0,
      });
    });

    it("should record continuation used with checkpoint content", () => {
      const monitor = new L0Monitor({ enabled: true });
      monitor.recordContinuation(true, true, "checkpoint content here");
      const telemetry = monitor.getTelemetry();
      expect(telemetry?.continuation?.used).toBe(true);
      expect(telemetry?.continuation?.continuationCount).toBe(1);
      expect(telemetry?.continuation?.checkpointContent).toBe(
        "checkpoint content here",
      );
      expect(telemetry?.continuation?.checkpointLength).toBe(23);
    });

    it("should increment continuation count on multiple uses", () => {
      const monitor = new L0Monitor({ enabled: true });
      monitor.recordContinuation(true, true, "first");
      monitor.recordContinuation(true, true, "second");
      const telemetry = monitor.getTelemetry();
      expect(telemetry?.continuation?.continuationCount).toBe(2);
      expect(telemetry?.continuation?.checkpointContent).toBe("second");
    });

    it("should clear checkpoint data when used without content", () => {
      const monitor = new L0Monitor({ enabled: true });
      monitor.recordContinuation(true, true, "initial content");
      monitor.recordContinuation(true, true); // No content
      const telemetry = monitor.getTelemetry();
      expect(telemetry?.continuation?.checkpointContent).toBeUndefined();
      expect(telemetry?.continuation?.checkpointLength).toBeUndefined();
    });
  });

  describe("logEvent", () => {
    it("should log custom events in metadata", () => {
      const monitor = new L0Monitor({ enabled: true });
      monitor.logEvent({ type: "fallback", model: "gpt-4" });
      const telemetry = monitor.getTelemetry();
      expect(telemetry?.metadata?.customEvents).toHaveLength(1);
      expect(telemetry?.metadata?.customEvents[0]).toMatchObject({
        type: "fallback",
        model: "gpt-4",
      });
      expect(telemetry?.metadata?.customEvents[0].timestamp).toBeDefined();
    });

    it("should append multiple events", () => {
      const monitor = new L0Monitor({ enabled: true });
      monitor.logEvent({ type: "event1" });
      monitor.logEvent({ type: "event2" });
      const telemetry = monitor.getTelemetry();
      expect(telemetry?.metadata?.customEvents).toHaveLength(2);
    });
  });

  describe("timing metrics", () => {
    it("should calculate average inter-token time", () => {
      const monitor = new L0Monitor({ enabled: true, includeTimings: true });
      monitor.start();
      const startTime = monitor.getTelemetry()?.startTime ?? Date.now();
      // Record tokens at specific intervals
      monitor.recordToken(startTime + 100);
      monitor.recordToken(startTime + 200);
      monitor.recordToken(startTime + 300);
      monitor.complete();
      const telemetry = monitor.getTelemetry();
      expect(telemetry?.metrics.avgInterTokenTime).toBe(100);
    });

    it("should calculate tokens per second", async () => {
      const monitor = new L0Monitor({ enabled: true, includeTimings: true });
      monitor.start();
      const startTime = monitor.getTelemetry()?.startTime ?? Date.now();
      // Record 10 tokens at specific times
      for (let i = 0; i < 10; i++) {
        monitor.recordToken(startTime + i * 10);
      }
      // Need actual elapsed time for duration calculation
      await new Promise((resolve) => setTimeout(resolve, 50));
      monitor.complete();
      const telemetry = monitor.getTelemetry();
      // Should have some tokens per second value (duration > 0 needed)
      expect(telemetry?.duration).toBeGreaterThan(0);
      expect(telemetry?.metrics.tokensPerSecond).toBeDefined();
    });

    it("should not calculate timing metrics when includeTimings is false", () => {
      const monitor = new L0Monitor({ enabled: true, includeTimings: false });
      monitor.start();
      monitor.recordToken();
      monitor.recordToken();
      monitor.complete();
      const telemetry = monitor.getTelemetry();
      expect(telemetry?.metrics.avgInterTokenTime).toBeUndefined();
    });

    it("should not calculate timing metrics with less than 2 tokens", () => {
      const monitor = new L0Monitor({ enabled: true, includeTimings: true });
      monitor.start();
      monitor.recordToken();
      monitor.complete();
      const telemetry = monitor.getTelemetry();
      expect(telemetry?.metrics.avgInterTokenTime).toBeUndefined();
    });
  });

  describe("getTelemetry and toJSON", () => {
    it("should return undefined when disabled", () => {
      const monitor = new L0Monitor({ enabled: false });
      expect(monitor.getTelemetry()).toBeUndefined();
    });

    it("should return telemetry when enabled", () => {
      const monitor = new L0Monitor({ enabled: true });
      expect(monitor.getTelemetry()).toBeDefined();
    });

    it("should return empty object JSON when disabled", () => {
      const monitor = new L0Monitor({ enabled: false });
      expect(monitor.toJSON()).toBe("{}");
    });

    it("should return valid JSON when enabled", () => {
      const monitor = new L0Monitor({ enabled: true });
      const json = monitor.toJSON();
      const parsed = JSON.parse(json);
      expect(parsed.sessionId).toBeDefined();
    });
  });

  describe("export and getSummary", () => {
    it("should export telemetry", () => {
      const monitor = new L0Monitor({ enabled: true });
      const exported = monitor.export();
      expect(exported).toBeDefined();
      expect(exported?.sessionId).toBeDefined();
    });

    it("should return undefined export when disabled", () => {
      const monitor = new L0Monitor({ enabled: false });
      expect(monitor.export()).toBeUndefined();
    });

    it("should return summary with all fields", () => {
      const monitor = new L0Monitor({ enabled: true });
      monitor.start();
      monitor.recordToken();
      monitor.recordRetry(true);
      monitor.recordNetworkError(new Error("test"), false);
      monitor.recordGuardrailViolations([
        {
          rule: "r",
          severity: "warning",
          message: "m",
          context: { position: 0 },
          recoverable: true,
        },
      ]);
      monitor.complete();
      const summary = monitor.getSummary();
      expect(summary).toBeDefined();
      expect(summary?.tokens).toBe(1);
      expect(summary?.retries).toBe(1);
      expect(summary?.networkErrors).toBe(1);
      expect(summary?.violations).toBe(1);
    });

    it("should return undefined summary when disabled", () => {
      const monitor = new L0Monitor({ enabled: false });
      expect(monitor.getSummary()).toBeUndefined();
    });
  });

  describe("getNetworkErrorBreakdown", () => {
    it("should return error breakdown", () => {
      const monitor = new L0Monitor({ enabled: true });
      // ECONNRESET gets classified as connection_dropped
      monitor.recordNetworkError(new Error("ECONNRESET"), false);
      monitor.recordNetworkError(new Error("ETIMEDOUT"), false);
      const breakdown = monitor.getNetworkErrorBreakdown();
      expect(breakdown["connection_dropped"]).toBe(1);
      expect(breakdown["timeout"]).toBe(1);
    });

    it("should return empty object when disabled", () => {
      const monitor = new L0Monitor({ enabled: false });
      expect(monitor.getNetworkErrorBreakdown()).toEqual({});
    });
  });

  describe("hasNetworkErrors and hasViolations", () => {
    it("should detect network errors", () => {
      const monitor = new L0Monitor({ enabled: true });
      expect(monitor.hasNetworkErrors()).toBe(false);
      monitor.recordNetworkError(new Error("test"), false);
      expect(monitor.hasNetworkErrors()).toBe(true);
    });

    it("should detect violations", () => {
      const monitor = new L0Monitor({ enabled: true });
      expect(monitor.hasViolations()).toBe(false);
      monitor.recordGuardrailViolations([
        {
          rule: "r",
          severity: "warning",
          message: "m",
          context: { position: 0 },
          recoverable: true,
        },
      ]);
      expect(monitor.hasViolations()).toBe(true);
    });

    it("should return false when disabled", () => {
      const monitor = new L0Monitor({ enabled: false });
      expect(monitor.hasNetworkErrors()).toBe(false);
      expect(monitor.hasViolations()).toBe(false);
    });
  });

  describe("getMostCommonNetworkError", () => {
    it("should return most common error type", () => {
      const monitor = new L0Monitor({ enabled: true });
      // ECONNRESET gets classified as connection_dropped
      monitor.recordNetworkError(new Error("ECONNRESET"), false);
      monitor.recordNetworkError(new Error("ECONNRESET"), false);
      monitor.recordNetworkError(new Error("ETIMEDOUT"), false);
      expect(monitor.getMostCommonNetworkError()).toBe("connection_dropped");
    });

    it("should return null when no errors", () => {
      const monitor = new L0Monitor({ enabled: true });
      expect(monitor.getMostCommonNetworkError()).toBeNull();
    });

    it("should return null when disabled", () => {
      const monitor = new L0Monitor({ enabled: false });
      expect(monitor.getMostCommonNetworkError()).toBeNull();
    });
  });

  describe("reset", () => {
    it("should reset all telemetry data", () => {
      const monitor = new L0Monitor({ enabled: true });
      monitor.recordToken();
      monitor.recordRetry(true);
      monitor.recordNetworkError(new Error("test"), false);

      monitor.reset();

      const telemetry = monitor.getTelemetry();
      expect(telemetry?.metrics.totalTokens).toBe(0);
      expect(telemetry?.metrics.totalRetries).toBe(0);
      expect(telemetry?.network.errorCount).toBe(0);
    });

    it("should generate new session ID on reset", () => {
      const monitor = new L0Monitor({ enabled: true });
      const originalSessionId = monitor.getTelemetry()?.sessionId;
      monitor.reset();
      const newSessionId = monitor.getTelemetry()?.sessionId;
      expect(newSessionId).not.toBe(originalSessionId);
    });
  });
});

describe("createMonitor", () => {
  it("should create a monitor with config", () => {
    const monitor = createMonitor({ enabled: true });
    expect(monitor).toBeInstanceOf(L0Monitor);
    expect(monitor.isEnabled()).toBe(true);
  });

  it("should create a disabled monitor by default", () => {
    const monitor = createMonitor();
    expect(monitor.isEnabled()).toBe(false);
  });
});

describe("TelemetryExporter", () => {
  const createTestTelemetry = () => ({
    sessionId: "l0_123_abc",
    startTime: 1000,
    endTime: 2000,
    duration: 1000,
    metrics: {
      totalTokens: 100,
      totalRetries: 2,
      networkRetryCount: 1,
      modelRetryCount: 1,
      tokensPerSecond: 100,
      timeToFirstToken: 50,
      avgInterTokenTime: 10,
    },
    network: {
      errorCount: 1,
      errorsByType: { econnreset: 1 },
    },
    guardrails: {
      violationCount: 2,
      violationsByRule: { "rule-a": 2 },
      violationsByRuleAndSeverity: {
        "rule-a": { warning: 1, error: 1, fatal: 0 },
      },
      violationsBySeverity: { warning: 1, error: 1, fatal: 0 },
    },
    drift: { detected: false, types: [] },
    metadata: { app: "test" },
  });

  describe("toJSON", () => {
    it("should export to JSON string", () => {
      const telemetry = createTestTelemetry();
      const json = TelemetryExporter.toJSON(telemetry);
      const parsed = JSON.parse(json);
      expect(parsed.sessionId).toBe("l0_123_abc");
      expect(parsed.metrics.totalTokens).toBe(100);
    });
  });

  describe("toCSV", () => {
    it("should export to CSV format", () => {
      const telemetry = createTestTelemetry();
      const csv = TelemetryExporter.toCSV(telemetry);
      const lines = csv.split("\n");
      expect(lines[0]).toBe(
        "sessionId,duration,tokens,tokensPerSecond,retries,networkErrors,violations",
      );
      expect(lines[1]).toContain("l0_123_abc");
      expect(lines[1]).toContain("1000");
      expect(lines[1]).toContain("100");
    });

    it("should handle missing optional fields", () => {
      const telemetry = {
        sessionId: "l0_test",
        startTime: 1000,
        metrics: {
          totalTokens: 50,
          totalRetries: 0,
          networkRetryCount: 0,
          modelRetryCount: 0,
        },
        network: {
          errorCount: 0,
          errorsByType: {},
        },
      };
      const csv = TelemetryExporter.toCSV(telemetry);
      expect(csv).toContain("l0_test");
    });
  });

  describe("toLogFormat", () => {
    it("should export to structured log format", () => {
      const telemetry = createTestTelemetry();
      const log = TelemetryExporter.toLogFormat(telemetry);
      expect(log.session_id).toBe("l0_123_abc");
      expect(log.duration_ms).toBe(1000);
      expect(log.metrics.tokens).toBe(100);
      expect(log.network.error_count).toBe(1);
      expect(log.guardrails.violation_count).toBe(2);
    });

    it("should handle null guardrails", () => {
      const telemetry = {
        sessionId: "l0_test",
        startTime: 1000,
        metrics: {
          totalTokens: 0,
          totalRetries: 0,
          networkRetryCount: 0,
          modelRetryCount: 0,
        },
        network: { errorCount: 0, errorsByType: {} },
      };
      const log = TelemetryExporter.toLogFormat(telemetry);
      expect(log.guardrails).toBeNull();
    });
  });

  describe("toMetrics", () => {
    it("should export to metrics format", () => {
      const telemetry = createTestTelemetry();
      const metrics = TelemetryExporter.toMetrics(telemetry);

      expect(metrics.length).toBeGreaterThan(0);

      const durationMetric = metrics.find((m) => m.name === "l0.duration");
      expect(durationMetric).toBeDefined();
      expect(durationMetric?.value).toBe(1000);

      const tokenMetric = metrics.find((m) => m.name === "l0.tokens.total");
      expect(tokenMetric).toBeDefined();
      expect(tokenMetric?.value).toBe(100);

      const violationsMetric = metrics.find(
        (m) => m.name === "l0.guardrails.violations",
      );
      expect(violationsMetric).toBeDefined();
      expect(violationsMetric?.value).toBe(2);
    });

    it("should include tags from metadata", () => {
      const telemetry = createTestTelemetry();
      const metrics = TelemetryExporter.toMetrics(telemetry);

      const metric = metrics.find((m) => m.name === "l0.tokens.total");
      expect(metric?.tags).toEqual({ app: "test" });
    });

    it("should handle missing optional metrics", () => {
      const telemetry = {
        sessionId: "l0_test",
        startTime: 1000,
        metrics: {
          totalTokens: 10,
          totalRetries: 0,
          networkRetryCount: 0,
          modelRetryCount: 0,
        },
        network: { errorCount: 0, errorsByType: {} },
      };
      const metrics = TelemetryExporter.toMetrics(telemetry);

      // Should not include optional metrics that are undefined
      const tokensPerSecond = metrics.find(
        (m) => m.name === "l0.tokens.per_second",
      );
      expect(tokensPerSecond).toBeUndefined();

      const timeToFirstToken = metrics.find(
        (m) => m.name === "l0.time_to_first_token",
      );
      expect(timeToFirstToken).toBeUndefined();
    });

    it("should use startTime when endTime is undefined", () => {
      const telemetry = {
        sessionId: "l0_test",
        startTime: 1000,
        metrics: {
          totalTokens: 10,
          totalRetries: 0,
          networkRetryCount: 0,
          modelRetryCount: 0,
        },
        network: { errorCount: 0, errorsByType: {} },
      };
      const metrics = TelemetryExporter.toMetrics(telemetry);
      expect(metrics[0]?.timestamp).toBe(1000);
    });

    it("should not include guardrails metrics when guardrails is undefined", () => {
      const telemetry = {
        sessionId: "l0_test",
        startTime: 1000,
        metrics: {
          totalTokens: 10,
          totalRetries: 0,
          networkRetryCount: 0,
          modelRetryCount: 0,
        },
        network: { errorCount: 0, errorsByType: {} },
      };
      const metrics = TelemetryExporter.toMetrics(telemetry);
      const violationsMetric = metrics.find(
        (m) => m.name === "l0.guardrails.violations",
      );
      expect(violationsMetric).toBeUndefined();
    });
  });
});
