// Tests for Metrics class

import { describe, it, expect, beforeEach } from "vitest";
import {
  Metrics,
  createMetrics,
  getGlobalMetrics,
  resetGlobalMetrics,
  type MetricsSnapshot,
} from "../src/runtime/metrics";

describe("Metrics", () => {
  let metrics: Metrics;

  beforeEach(() => {
    metrics = new Metrics();
  });

  describe("initialization", () => {
    it("should initialize all counters to zero", () => {
      expect(metrics.requests).toBe(0);
      expect(metrics.tokens).toBe(0);
      expect(metrics.retries).toBe(0);
      expect(metrics.networkRetryCount).toBe(0);
      expect(metrics.errors).toBe(0);
      expect(metrics.violations).toBe(0);
      expect(metrics.driftDetections).toBe(0);
      expect(metrics.fallbacks).toBe(0);
      expect(metrics.completions).toBe(0);
      expect(metrics.timeouts).toBe(0);
    });
  });

  describe("counter increments", () => {
    it("should increment requests", () => {
      metrics.requests++;
      expect(metrics.requests).toBe(1);
      metrics.requests += 5;
      expect(metrics.requests).toBe(6);
    });

    it("should increment tokens", () => {
      metrics.tokens++;
      expect(metrics.tokens).toBe(1);
      metrics.tokens += 100;
      expect(metrics.tokens).toBe(101);
    });

    it("should increment retries", () => {
      metrics.retries++;
      expect(metrics.retries).toBe(1);
    });

    it("should increment networkRetryCount", () => {
      metrics.networkRetryCount++;
      expect(metrics.networkRetryCount).toBe(1);
    });

    it("should increment errors", () => {
      metrics.errors++;
      expect(metrics.errors).toBe(1);
    });

    it("should increment violations", () => {
      metrics.violations++;
      expect(metrics.violations).toBe(1);
    });

    it("should increment driftDetections", () => {
      metrics.driftDetections++;
      expect(metrics.driftDetections).toBe(1);
    });

    it("should increment fallbacks", () => {
      metrics.fallbacks++;
      expect(metrics.fallbacks).toBe(1);
    });

    it("should increment completions", () => {
      metrics.completions++;
      expect(metrics.completions).toBe(1);
    });

    it("should increment timeouts", () => {
      metrics.timeouts++;
      expect(metrics.timeouts).toBe(1);
    });
  });

  describe("reset()", () => {
    it("should reset all counters to zero", () => {
      // Set various counters
      metrics.requests = 10;
      metrics.tokens = 500;
      metrics.retries = 3;
      metrics.networkRetryCount = 2;
      metrics.errors = 1;
      metrics.violations = 5;
      metrics.driftDetections = 2;
      metrics.fallbacks = 1;
      metrics.completions = 8;
      metrics.timeouts = 1;

      metrics.reset();

      expect(metrics.requests).toBe(0);
      expect(metrics.tokens).toBe(0);
      expect(metrics.retries).toBe(0);
      expect(metrics.networkRetryCount).toBe(0);
      expect(metrics.errors).toBe(0);
      expect(metrics.violations).toBe(0);
      expect(metrics.driftDetections).toBe(0);
      expect(metrics.fallbacks).toBe(0);
      expect(metrics.completions).toBe(0);
      expect(metrics.timeouts).toBe(0);
    });
  });

  describe("snapshot()", () => {
    it("should return snapshot of all metrics", () => {
      metrics.requests = 5;
      metrics.tokens = 100;
      metrics.retries = 2;
      metrics.errors = 1;

      const snapshot = metrics.snapshot();

      expect(snapshot.requests).toBe(5);
      expect(snapshot.tokens).toBe(100);
      expect(snapshot.retries).toBe(2);
      expect(snapshot.errors).toBe(1);
    });

    it("should return a copy, not a reference", () => {
      metrics.requests = 5;
      const snapshot = metrics.snapshot();

      metrics.requests = 10;

      expect(snapshot.requests).toBe(5);
    });

    it("should include all metric fields", () => {
      const snapshot = metrics.snapshot();

      expect(snapshot).toHaveProperty("requests");
      expect(snapshot).toHaveProperty("tokens");
      expect(snapshot).toHaveProperty("retries");
      expect(snapshot).toHaveProperty("networkRetryCount");
      expect(snapshot).toHaveProperty("errors");
      expect(snapshot).toHaveProperty("violations");
      expect(snapshot).toHaveProperty("driftDetections");
      expect(snapshot).toHaveProperty("fallbacks");
      expect(snapshot).toHaveProperty("completions");
      expect(snapshot).toHaveProperty("timeouts");
    });
  });

  describe("toJSON()", () => {
    it("should return same data as snapshot()", () => {
      metrics.requests = 5;
      metrics.tokens = 100;

      const json = metrics.toJSON();
      const snapshot = metrics.snapshot();

      expect(json).toEqual(snapshot);
    });

    it("should be serializable to JSON string", () => {
      metrics.requests = 5;
      metrics.tokens = 100;

      const jsonString = JSON.stringify(metrics);
      const parsed = JSON.parse(jsonString);

      expect(parsed.requests).toBe(5);
      expect(parsed.tokens).toBe(100);
    });
  });
});

describe("createMetrics()", () => {
  it("should create a new Metrics instance", () => {
    const metrics = createMetrics();
    expect(metrics).toBeInstanceOf(Metrics);
    expect(metrics.requests).toBe(0);
  });

  it("should create independent instances", () => {
    const metrics1 = createMetrics();
    const metrics2 = createMetrics();

    metrics1.requests = 10;

    expect(metrics1.requests).toBe(10);
    expect(metrics2.requests).toBe(0);
  });
});

describe("global metrics", () => {
  beforeEach(() => {
    resetGlobalMetrics();
  });

  describe("getGlobalMetrics()", () => {
    it("should return a Metrics instance", () => {
      const metrics = getGlobalMetrics();
      expect(metrics).toBeInstanceOf(Metrics);
    });

    it("should return the same instance on multiple calls", () => {
      const metrics1 = getGlobalMetrics();
      const metrics2 = getGlobalMetrics();

      expect(metrics1).toBe(metrics2);
    });

    it("should share state across calls", () => {
      const metrics1 = getGlobalMetrics();
      metrics1.requests = 5;

      const metrics2 = getGlobalMetrics();
      expect(metrics2.requests).toBe(5);
    });
  });

  describe("resetGlobalMetrics()", () => {
    it("should reset global metrics counters", () => {
      const metrics = getGlobalMetrics();
      metrics.requests = 10;
      metrics.tokens = 500;

      resetGlobalMetrics();

      expect(metrics.requests).toBe(0);
      expect(metrics.tokens).toBe(0);
    });

    it("should work even if global metrics not initialized", () => {
      // Should not throw
      expect(() => resetGlobalMetrics()).not.toThrow();
    });
  });
});

describe("Metrics typical usage", () => {
  it("should track a successful stream", () => {
    const metrics = new Metrics();

    metrics.requests++;

    // Simulate receiving tokens
    for (let i = 0; i < 50; i++) {
      metrics.tokens++;
    }

    metrics.completions++;

    const snapshot = metrics.snapshot();
    expect(snapshot.requests).toBe(1);
    expect(snapshot.tokens).toBe(50);
    expect(snapshot.completions).toBe(1);
    expect(snapshot.errors).toBe(0);
  });

  it("should track a stream with retries", () => {
    const metrics = new Metrics();

    metrics.requests++;

    // First attempt fails
    metrics.retries++;

    // Second attempt succeeds
    for (let i = 0; i < 30; i++) {
      metrics.tokens++;
    }
    metrics.completions++;

    const snapshot = metrics.snapshot();
    expect(snapshot.requests).toBe(1);
    expect(snapshot.retries).toBe(1);
    expect(snapshot.tokens).toBe(30);
    expect(snapshot.completions).toBe(1);
  });

  it("should track a stream with network retry", () => {
    const metrics = new Metrics();

    metrics.requests++;
    metrics.retries++;
    metrics.networkRetryCount++;
    metrics.completions++;

    const snapshot = metrics.snapshot();
    expect(snapshot.retries).toBe(1);
    expect(snapshot.networkRetryCount).toBe(1);
  });

  it("should track a stream with fallback", () => {
    const metrics = new Metrics();

    metrics.requests++;
    metrics.fallbacks++;
    metrics.completions++;

    const snapshot = metrics.snapshot();
    expect(snapshot.fallbacks).toBe(1);
    expect(snapshot.completions).toBe(1);
  });

  it("should track a failed stream", () => {
    const metrics = new Metrics();

    metrics.requests++;
    metrics.retries += 3;
    metrics.errors++;

    const snapshot = metrics.snapshot();
    expect(snapshot.requests).toBe(1);
    expect(snapshot.retries).toBe(3);
    expect(snapshot.errors).toBe(1);
    expect(snapshot.completions).toBe(0);
  });

  it("should track guardrail violations", () => {
    const metrics = new Metrics();

    metrics.requests++;
    metrics.violations += 2;
    metrics.completions++;

    const snapshot = metrics.snapshot();
    expect(snapshot.violations).toBe(2);
  });

  it("should track drift detections", () => {
    const metrics = new Metrics();

    metrics.requests++;
    metrics.driftDetections++;
    metrics.completions++;

    const snapshot = metrics.snapshot();
    expect(snapshot.driftDetections).toBe(1);
  });

  it("should track timeouts", () => {
    const metrics = new Metrics();

    metrics.requests++;
    metrics.timeouts++;
    metrics.retries++;
    metrics.completions++;

    const snapshot = metrics.snapshot();
    expect(snapshot.timeouts).toBe(1);
  });
});
