/**
 * L0 Performance Benchmark Suite
 *
 * Tests L0 layer performance overhead with ms-level precision and tokens/s throughput metrics.
 * Designed to measure the cost of the reliability substrate, not LLM inference.
 *
 * Simulates high-throughput scenarios (1000+ tokens/s) expected from Nvidia Blackwell.
 *
 * Scenarios tested:
 * - Baseline: Raw streaming without L0
 * - L0 Core: Minimal L0 wrapper (no guardrails)
 * - L0 + Guardrails: With JSON/markdown validation
 * - L0 + Drift Detection: With drift analysis enabled
 * - L0 + Full Stack: All features enabled
 */

import { describe, it, expect, beforeEach } from "vitest";
import { l0 } from "../src/runtime/l0";
import { jsonRule, markdownRule, zeroOutputRule } from "../src/guardrails";
import { patternRule } from "../src/guardrails/patterns";
import type { L0Event, L0Options } from "../src/types/l0";

// ============================================================================
// High-Precision Timer
// ============================================================================

interface TimingResult {
  startTime: number;
  endTime: number;
  durationMs: number;
  durationNs: bigint;
}

function createTimer(): { stop: () => TimingResult } {
  const startHr = process.hrtime.bigint();
  const startTime = performance.now();

  return {
    stop(): TimingResult {
      const endTime = performance.now();
      const endHr = process.hrtime.bigint();
      const durationNs = endHr - startHr;
      const durationMs = Number(durationNs) / 1_000_000;

      return {
        startTime,
        endTime,
        durationMs,
        durationNs,
      };
    },
  };
}

// ============================================================================
// Mock Stream Generator
// ============================================================================

interface MockStreamConfig {
  /** Total number of tokens to generate */
  tokenCount: number;
  /** Average token size in characters */
  avgTokenSize?: number;
  /** Simulated delay between tokens in ms (0 = as fast as possible) */
  interTokenDelayMs?: number;
  /** Content type: "text" | "json" | "markdown" */
  contentType?: "text" | "json" | "markdown";
  /** Whether to include realistic LLM patterns */
  realistic?: boolean;
}

interface MockToken {
  type: "text-delta";
  textDelta: string;
}

/**
 * Generate realistic token content based on content type
 */
function generateTokenContent(index: number, config: MockStreamConfig): string {
  const { contentType = "text", avgTokenSize = 4, realistic = true } = config;

  if (!realistic) {
    // Simple repeated pattern for pure performance testing
    return "x".repeat(avgTokenSize);
  }

  switch (contentType) {
    case "json":
      return generateJsonToken(index, config.tokenCount);
    case "markdown":
      return generateMarkdownToken(index, config.tokenCount);
    default:
      return generateTextToken(index, avgTokenSize);
  }
}

function generateJsonToken(index: number, total: number): string {
  // Generate valid JSON structure progressively
  if (index === 0) return "{";
  if (index === total - 1) return "}";
  if (index === 1) return '"data": [';
  if (index === total - 2) return "]";

  const itemIndex = index - 2;
  if (itemIndex % 4 === 0) return '{"id": ';
  if (itemIndex % 4 === 1) return `${itemIndex}`;
  if (itemIndex % 4 === 2) return ', "value": "item"';
  return "}, ";
}

function generateMarkdownToken(index: number, total: number): string {
  const patterns = [
    "# ",
    "Heading\n\n",
    "This ",
    "is ",
    "a ",
    "paragraph ",
    "with ",
    "**bold** ",
    "and ",
    "_italic_ ",
    "text.\n\n",
    "- ",
    "List ",
    "item\n",
    "```\n",
    "code ",
    "block\n",
    "```\n",
  ];
  return patterns[index % patterns.length];
}

function generateTextToken(index: number, avgSize: number): string {
  const words = [
    "the ",
    "quick ",
    "brown ",
    "fox ",
    "jumps ",
    "over ",
    "lazy ",
    "dog ",
    "and ",
    "runs ",
    "through ",
    "forest ",
    "while ",
    "birds ",
    "sing ",
    "songs ",
  ];
  return words[index % words.length];
}

/**
 * Create a mock async iterable stream that simulates LLM token streaming
 */
function createMockTokenStream(
  config: MockStreamConfig,
): AsyncIterable<MockToken> {
  const { tokenCount, interTokenDelayMs = 0 } = config;

  return {
    async *[Symbol.asyncIterator]() {
      for (let i = 0; i < tokenCount; i++) {
        if (interTokenDelayMs > 0) {
          await new Promise((resolve) =>
            setTimeout(resolve, interTokenDelayMs),
          );
        }

        yield {
          type: "text-delta" as const,
          textDelta: generateTokenContent(i, config),
        };
      }
    },
  };
}

/**
 * Create a stream factory for l0() consumption
 */
function createMockStreamFactory(config: MockStreamConfig) {
  return () => ({
    textStream: createMockTokenStream(config),
  });
}

// ============================================================================
// Benchmark Metrics
// ============================================================================

interface BenchmarkMetrics {
  /** Scenario name */
  scenario: string;
  /** Number of tokens processed */
  tokenCount: number;
  /** Total duration in milliseconds */
  durationMs: number;
  /** Tokens per second throughput */
  tokensPerSecond: number;
  /** Average time per token in microseconds */
  avgTokenTimeUs: number;
  /** Time to first token in milliseconds */
  timeToFirstTokenMs: number;
  /** Memory usage delta in bytes */
  memoryDeltaBytes: number;
  /** L0 overhead percentage compared to baseline */
  overheadPercent?: number;
}

interface BenchmarkRun {
  metrics: BenchmarkMetrics;
  rawTiming: TimingResult;
  events: L0Event[];
  state: any;
}

/**
 * Run a single benchmark iteration
 */
async function runBenchmark(
  scenario: string,
  streamConfig: MockStreamConfig,
  l0Options?: Partial<L0Options>,
): Promise<BenchmarkRun> {
  const events: L0Event[] = [];
  let firstTokenTime: number | null = null;

  // Force GC if available for more accurate memory measurement
  if (global.gc) {
    global.gc();
  }

  const memBefore = process.memoryUsage().heapUsed;
  const timer = createTimer();

  const result = await l0({
    stream: createMockStreamFactory(streamConfig),
    detectZeroTokens: false, // Disable for benchmarks
    ...l0Options,
  });

  // Consume stream and collect events
  for await (const event of result.stream) {
    if (event.type === "token" && firstTokenTime === null) {
      firstTokenTime = performance.now();
    }
    events.push(event);
  }

  const timing = timer.stop();
  const memAfter = process.memoryUsage().heapUsed;

  const tokenEvents = events.filter((e) => e.type === "token");
  const tokensPerSecond =
    timing.durationMs > 0 ? (tokenEvents.length / timing.durationMs) * 1000 : 0;

  return {
    metrics: {
      scenario,
      tokenCount: tokenEvents.length,
      durationMs: timing.durationMs,
      tokensPerSecond,
      avgTokenTimeUs:
        tokenEvents.length > 0
          ? (timing.durationMs / tokenEvents.length) * 1000
          : 0,
      timeToFirstTokenMs:
        firstTokenTime !== null ? firstTokenTime - timing.startTime : 0,
      memoryDeltaBytes: memAfter - memBefore,
    },
    rawTiming: timing,
    events,
    state: result.state,
  };
}

/**
 * Run baseline benchmark (raw async iteration without L0)
 */
async function runBaselineBenchmark(
  scenario: string,
  streamConfig: MockStreamConfig,
): Promise<BenchmarkRun> {
  const events: L0Event[] = [];
  let firstTokenTime: number | null = null;

  if (global.gc) {
    global.gc();
  }

  const memBefore = process.memoryUsage().heapUsed;
  const timer = createTimer();

  const stream = createMockTokenStream(streamConfig);

  for await (const chunk of stream) {
    if (firstTokenTime === null) {
      firstTokenTime = performance.now();
    }
    // Simulate minimal processing
    events.push({
      type: "token",
      value: chunk.textDelta,
      timestamp: Date.now(),
    });
  }

  const timing = timer.stop();
  const memAfter = process.memoryUsage().heapUsed;

  const tokensPerSecond =
    timing.durationMs > 0 ? (events.length / timing.durationMs) * 1000 : 0;

  return {
    metrics: {
      scenario,
      tokenCount: events.length,
      durationMs: timing.durationMs,
      tokensPerSecond,
      avgTokenTimeUs:
        events.length > 0 ? (timing.durationMs / events.length) * 1000 : 0,
      timeToFirstTokenMs:
        firstTokenTime !== null ? firstTokenTime - timing.startTime : 0,
      memoryDeltaBytes: memAfter - memBefore,
    },
    rawTiming: timing,
    events,
    state: null,
  };
}

/**
 * Run multiple iterations and compute statistics
 */
async function runBenchmarkSuite(
  scenario: string,
  streamConfig: MockStreamConfig,
  l0Options?: Partial<L0Options>,
  iterations: number = 5,
  isBaseline: boolean = false,
): Promise<{
  runs: BenchmarkRun[];
  avg: BenchmarkMetrics;
  min: BenchmarkMetrics;
  max: BenchmarkMetrics;
  stdDev: number;
}> {
  const runs: BenchmarkRun[] = [];

  // Warm-up run (discarded)
  if (isBaseline) {
    await runBaselineBenchmark(scenario, streamConfig);
  } else {
    await runBenchmark(scenario, streamConfig, l0Options);
  }

  // Actual benchmark runs
  for (let i = 0; i < iterations; i++) {
    const run = isBaseline
      ? await runBaselineBenchmark(scenario, streamConfig)
      : await runBenchmark(scenario, streamConfig, l0Options);
    runs.push(run);
  }

  // Calculate statistics
  const durations = runs.map((r) => r.metrics.durationMs);
  const avgDuration = durations.reduce((a, b) => a + b, 0) / durations.length;
  const variance =
    durations.reduce((sum, d) => sum + Math.pow(d - avgDuration, 2), 0) /
    durations.length;
  const stdDev = Math.sqrt(variance);

  const avgTokensPerSecond =
    runs.reduce((a, b) => a + b.metrics.tokensPerSecond, 0) / runs.length;
  const avgTimeToFirstToken =
    runs.reduce((a, b) => a + b.metrics.timeToFirstTokenMs, 0) / runs.length;

  const sortedByDuration = [...runs].sort(
    (a, b) => a.metrics.durationMs - b.metrics.durationMs,
  );

  return {
    runs,
    avg: {
      scenario,
      tokenCount: streamConfig.tokenCount,
      durationMs: avgDuration,
      tokensPerSecond: avgTokensPerSecond,
      avgTokenTimeUs:
        avgDuration > 0 ? (avgDuration / streamConfig.tokenCount) * 1000 : 0,
      timeToFirstTokenMs: avgTimeToFirstToken,
      memoryDeltaBytes:
        runs.reduce((a, b) => a + b.metrics.memoryDeltaBytes, 0) / runs.length,
    },
    min: sortedByDuration[0].metrics,
    max: sortedByDuration[sortedByDuration.length - 1].metrics,
    stdDev,
  };
}

// ============================================================================
// Benchmark Report
// ============================================================================

interface BenchmarkReport {
  timestamp: string;
  scenarios: Map<
    string,
    {
      avg: BenchmarkMetrics;
      min: BenchmarkMetrics;
      max: BenchmarkMetrics;
      stdDev: number;
    }
  >;
  baseline: BenchmarkMetrics;
}

function formatReport(report: BenchmarkReport): string {
  const lines: string[] = [];

  lines.push("=".repeat(80));
  lines.push("L0 PERFORMANCE BENCHMARK REPORT");
  lines.push(`Timestamp: ${report.timestamp}`);
  lines.push("=".repeat(80));
  lines.push("");

  // Header
  lines.push(
    "| Scenario                    | Tokens/s   | Avg (ms)  | TTFT (ms) | Overhead |",
  );
  lines.push(
    "|-----------------------------|------------|-----------|-----------|----------|",
  );

  // Baseline first
  const baseline = report.baseline;
  lines.push(
    `| ${baseline.scenario.padEnd(27)} | ${baseline.tokensPerSecond.toFixed(0).padStart(10)} | ${baseline.durationMs.toFixed(2).padStart(9)} | ${baseline.timeToFirstTokenMs.toFixed(2).padStart(9)} | baseline |`,
  );

  // Other scenarios
  for (const [name, data] of report.scenarios) {
    if (name === "Baseline") continue;

    const overhead =
      baseline.durationMs > 0
        ? ((data.avg.durationMs - baseline.durationMs) / baseline.durationMs) *
          100
        : 0;

    lines.push(
      `| ${name.padEnd(27)} | ${data.avg.tokensPerSecond.toFixed(0).padStart(10)} | ${data.avg.durationMs.toFixed(2).padStart(9)} | ${data.avg.timeToFirstTokenMs.toFixed(2).padStart(9)} | ${overhead.toFixed(1).padStart(6)}% |`,
    );
  }

  lines.push("");
  lines.push("Legend:");
  lines.push("  Tokens/s  = Throughput (higher is better)");
  lines.push("  Avg (ms)  = Average total duration (lower is better)");
  lines.push("  TTFT (ms) = Time to first token (lower is better)");
  lines.push("  Overhead  = % slower than baseline (lower is better)");
  lines.push("");

  return lines.join("\n");
}

// ============================================================================
// Test Suites
// ============================================================================

describe("L0 Performance Benchmarks", () => {
  // Test configurations for different throughput scenarios
  const configs = {
    // Simulate current high-end models (~100-200 tokens/s)
    standard: {
      tokenCount: 500,
      avgTokenSize: 4,
      interTokenDelayMs: 0,
      contentType: "text" as const,
      realistic: true,
    },
    // Simulate Blackwell-class throughput (1000+ tokens/s)
    highThroughput: {
      tokenCount: 2000,
      avgTokenSize: 4,
      interTokenDelayMs: 0,
      contentType: "text" as const,
      realistic: true,
    },
    // Stress test with massive token count
    stress: {
      tokenCount: 10000,
      avgTokenSize: 4,
      interTokenDelayMs: 0,
      contentType: "text" as const,
      realistic: false,
    },
    // JSON structured output
    json: {
      tokenCount: 1000,
      avgTokenSize: 4,
      interTokenDelayMs: 0,
      contentType: "json" as const,
      realistic: true,
    },
    // Markdown content
    markdown: {
      tokenCount: 1000,
      avgTokenSize: 6,
      interTokenDelayMs: 0,
      contentType: "markdown" as const,
      realistic: true,
    },
  };

  describe("Baseline vs L0 Core", () => {
    it("should measure baseline raw streaming performance", async () => {
      const result = await runBenchmarkSuite(
        "Baseline",
        configs.highThroughput,
        undefined,
        3,
        true,
      );

      expect(result.avg.tokenCount).toBe(configs.highThroughput.tokenCount);
      expect(result.avg.tokensPerSecond).toBeGreaterThan(0);

      console.log(
        `\nBaseline: ${result.avg.tokensPerSecond.toFixed(0)} tokens/s`,
      );
      console.log(`  Duration: ${result.avg.durationMs.toFixed(2)} ms`);
      console.log(`  Std Dev: ${result.stdDev.toFixed(2)} ms`);
    });

    it("should measure L0 core overhead (no guardrails)", async () => {
      const baseline = await runBenchmarkSuite(
        "Baseline",
        configs.highThroughput,
        undefined,
        3,
        true,
      );

      const l0Core = await runBenchmarkSuite(
        "L0 Core",
        configs.highThroughput,
        {
          guardrails: [],
          detectDrift: false,
          detectZeroTokens: false,
        },
        3,
      );

      const overhead =
        ((l0Core.avg.durationMs - baseline.avg.durationMs) /
          baseline.avg.durationMs) *
        100;

      console.log(`\nL0 Core overhead: ${overhead.toFixed(1)}%`);
      console.log(
        `  Baseline: ${baseline.avg.tokensPerSecond.toFixed(0)} tokens/s`,
      );
      console.log(
        `  L0 Core: ${l0Core.avg.tokensPerSecond.toFixed(0)} tokens/s`,
      );

      // L0 core includes event dispatching, state management, and async generator wrapping
      // Overhead is expected but should still achieve high throughput
      // At 1000+ tokens/s from LLM, this overhead is negligible in real-world usage
      expect(l0Core.avg.tokensPerSecond).toBeGreaterThan(100000); // Still very fast
    });
  });

  describe("Guardrails Performance Impact", () => {
    it("should measure JSON guardrail overhead", async () => {
      const noGuardrails = await runBenchmarkSuite(
        "No Guardrails",
        configs.json,
        { guardrails: [], detectZeroTokens: false },
        3,
      );

      const withJson = await runBenchmarkSuite(
        "JSON Guardrail",
        configs.json,
        {
          guardrails: [jsonRule()],
          detectZeroTokens: false,
        },
        3,
      );

      const overhead =
        ((withJson.avg.durationMs - noGuardrails.avg.durationMs) /
          noGuardrails.avg.durationMs) *
        100;

      console.log(`\nJSON Guardrail overhead: ${overhead.toFixed(1)}%`);
      console.log(
        `  Without: ${noGuardrails.avg.tokensPerSecond.toFixed(0)} tokens/s`,
      );
      console.log(
        `  With JSON: ${withJson.avg.tokensPerSecond.toFixed(0)} tokens/s`,
      );

      expect(withJson.avg.tokenCount).toBe(configs.json.tokenCount);
    });

    it("should measure multiple guardrails overhead", async () => {
      const noGuardrails = await runBenchmarkSuite(
        "No Guardrails",
        configs.standard,
        { guardrails: [], detectZeroTokens: false },
        3,
      );

      const withMultiple = await runBenchmarkSuite(
        "Multiple Guardrails",
        configs.standard,
        {
          guardrails: [jsonRule(), markdownRule(), zeroOutputRule()],
          detectZeroTokens: false,
        },
        3,
      );

      const overhead =
        ((withMultiple.avg.durationMs - noGuardrails.avg.durationMs) /
          noGuardrails.avg.durationMs) *
        100;

      console.log(`\nMultiple Guardrails overhead: ${overhead.toFixed(1)}%`);
      console.log(
        `  Without: ${noGuardrails.avg.tokensPerSecond.toFixed(0)} tokens/s`,
      );
      console.log(
        `  With 3 rules: ${withMultiple.avg.tokensPerSecond.toFixed(0)} tokens/s`,
      );

      expect(withMultiple.avg.tokenCount).toBe(configs.standard.tokenCount);
    });

    it("should measure pattern guardrail overhead", async () => {
      const noGuardrails = await runBenchmarkSuite(
        "No Guardrails",
        configs.standard,
        { guardrails: [], detectZeroTokens: false },
        3,
      );

      const withPatterns = await runBenchmarkSuite(
        "Pattern Guardrail",
        configs.standard,
        {
          guardrails: [patternRule()],
          detectZeroTokens: false,
        },
        3,
      );

      const overhead =
        ((withPatterns.avg.durationMs - noGuardrails.avg.durationMs) /
          noGuardrails.avg.durationMs) *
        100;

      console.log(`\nPattern Guardrail overhead: ${overhead.toFixed(1)}%`);
      console.log(
        `  Without: ${noGuardrails.avg.tokensPerSecond.toFixed(0)} tokens/s`,
      );
      console.log(
        `  With patterns: ${withPatterns.avg.tokensPerSecond.toFixed(0)} tokens/s`,
      );

      expect(withPatterns.avg.tokenCount).toBe(configs.standard.tokenCount);
    });
  });

  describe("Drift Detection Performance Impact", () => {
    it("should measure drift detection overhead", async () => {
      const noDrift = await runBenchmarkSuite(
        "No Drift Detection",
        configs.highThroughput,
        {
          guardrails: [],
          detectDrift: false,
          detectZeroTokens: false,
        },
        3,
      );

      const withDrift = await runBenchmarkSuite(
        "With Drift Detection",
        configs.highThroughput,
        {
          guardrails: [],
          detectDrift: true,
          detectZeroTokens: false,
        },
        3,
      );

      const overhead =
        ((withDrift.avg.durationMs - noDrift.avg.durationMs) /
          noDrift.avg.durationMs) *
        100;

      console.log(`\nDrift Detection overhead: ${overhead.toFixed(1)}%`);
      console.log(
        `  Without: ${noDrift.avg.tokensPerSecond.toFixed(0)} tokens/s`,
      );
      console.log(
        `  With drift: ${withDrift.avg.tokensPerSecond.toFixed(0)} tokens/s`,
      );

      expect(withDrift.avg.tokenCount).toBe(configs.highThroughput.tokenCount);
    });
  });

  describe("Check Interval Impact", () => {
    it("should measure impact of guardrail check interval", async () => {
      const frequentChecks = await runBenchmarkSuite(
        "Check every 1 token",
        configs.standard,
        {
          guardrails: [jsonRule()],
          checkIntervals: { guardrails: 1 },
          detectZeroTokens: false,
        },
        3,
      );

      const normalChecks = await runBenchmarkSuite(
        "Check every 5 tokens",
        configs.standard,
        {
          guardrails: [jsonRule()],
          checkIntervals: { guardrails: 5 },
          detectZeroTokens: false,
        },
        3,
      );

      const infrequentChecks = await runBenchmarkSuite(
        "Check every 20 tokens",
        configs.standard,
        {
          guardrails: [jsonRule()],
          checkIntervals: { guardrails: 20 },
          detectZeroTokens: false,
        },
        3,
      );

      console.log("\nCheck Interval Impact:");
      console.log(
        `  Every 1 token: ${frequentChecks.avg.tokensPerSecond.toFixed(0)} tokens/s`,
      );
      console.log(
        `  Every 5 tokens: ${normalChecks.avg.tokensPerSecond.toFixed(0)} tokens/s`,
      );
      console.log(
        `  Every 20 tokens: ${infrequentChecks.avg.tokensPerSecond.toFixed(0)} tokens/s`,
      );

      // Less frequent checks should be faster
      expect(infrequentChecks.avg.tokensPerSecond).toBeGreaterThanOrEqual(
        frequentChecks.avg.tokensPerSecond * 0.9, // Allow 10% variance
      );
    });
  });

  describe("Full Stack Performance", () => {
    it("should measure full L0 stack overhead", async () => {
      const baseline = await runBenchmarkSuite(
        "Baseline",
        configs.highThroughput,
        undefined,
        3,
        true,
      );

      const fullStack = await runBenchmarkSuite(
        "Full L0 Stack",
        configs.highThroughput,
        {
          guardrails: [jsonRule(), markdownRule(), zeroOutputRule()],
          detectDrift: true,
          detectZeroTokens: true,
          checkIntervals: {
            guardrails: 5,
            drift: 10,
            checkpoint: 10,
          },
        },
        3,
      );

      const overhead =
        ((fullStack.avg.durationMs - baseline.avg.durationMs) /
          baseline.avg.durationMs) *
        100;

      console.log(`\n${"=".repeat(60)}`);
      console.log("FULL L0 STACK BENCHMARK");
      console.log("=".repeat(60));
      console.log(`Tokens processed: ${configs.highThroughput.tokenCount}`);
      console.log(
        `Baseline: ${baseline.avg.tokensPerSecond.toFixed(0)} tokens/s (${baseline.avg.durationMs.toFixed(2)} ms)`,
      );
      console.log(
        `Full Stack: ${fullStack.avg.tokensPerSecond.toFixed(0)} tokens/s (${fullStack.avg.durationMs.toFixed(2)} ms)`,
      );
      console.log(`Overhead: ${overhead.toFixed(1)}%`);
      console.log(
        `Time to First Token: ${fullStack.avg.timeToFirstTokenMs.toFixed(2)} ms`,
      );
      console.log("=".repeat(60));

      // Full stack should still achieve reasonable throughput
      expect(fullStack.avg.tokensPerSecond).toBeGreaterThan(1000);
    });
  });

  describe("Stress Tests", () => {
    it("should handle 10,000 tokens efficiently", async () => {
      const result = await runBenchmarkSuite(
        "Stress Test (10k tokens)",
        configs.stress,
        {
          guardrails: [jsonRule()],
          detectDrift: false,
          detectZeroTokens: false,
        },
        3,
      );

      console.log(`\nStress Test (10,000 tokens):`);
      console.log(
        `  Throughput: ${result.avg.tokensPerSecond.toFixed(0)} tokens/s`,
      );
      console.log(`  Duration: ${result.avg.durationMs.toFixed(2)} ms`);
      console.log(
        `  Memory delta: ${(result.avg.memoryDeltaBytes / 1024 / 1024).toFixed(2)} MB`,
      );

      expect(result.avg.tokenCount).toBe(10000);
      // Should process at least 5000 tokens/s even under stress
      expect(result.avg.tokensPerSecond).toBeGreaterThan(5000);
    });

    it("should maintain linear scaling", async () => {
      const small = await runBenchmarkSuite(
        "500 tokens",
        { ...configs.standard, tokenCount: 500 },
        { guardrails: [], detectZeroTokens: false },
        3,
      );

      const medium = await runBenchmarkSuite(
        "2000 tokens",
        { ...configs.standard, tokenCount: 2000 },
        { guardrails: [], detectZeroTokens: false },
        3,
      );

      const large = await runBenchmarkSuite(
        "5000 tokens",
        { ...configs.standard, tokenCount: 5000 },
        { guardrails: [], detectZeroTokens: false },
        3,
      );

      console.log("\nScaling Test:");
      console.log(
        `  500 tokens: ${small.avg.durationMs.toFixed(2)} ms (${small.avg.tokensPerSecond.toFixed(0)} t/s)`,
      );
      console.log(
        `  2000 tokens: ${medium.avg.durationMs.toFixed(2)} ms (${medium.avg.tokensPerSecond.toFixed(0)} t/s)`,
      );
      console.log(
        `  5000 tokens: ${large.avg.durationMs.toFixed(2)} ms (${large.avg.tokensPerSecond.toFixed(0)} t/s)`,
      );

      // Throughput should remain relatively stable (within 50% variance)
      const avgThroughput =
        (small.avg.tokensPerSecond +
          medium.avg.tokensPerSecond +
          large.avg.tokensPerSecond) /
        3;

      expect(small.avg.tokensPerSecond).toBeGreaterThan(avgThroughput * 0.5);
      expect(large.avg.tokensPerSecond).toBeGreaterThan(avgThroughput * 0.5);
    });
  });

  describe("Memory Efficiency", () => {
    it("should not leak memory across iterations", async () => {
      const iterations = 5;
      const memorySnapshots: number[] = [];

      for (let i = 0; i < iterations; i++) {
        if (global.gc) global.gc();
        const memBefore = process.memoryUsage().heapUsed;

        const result = await l0({
          stream: createMockStreamFactory(configs.highThroughput),
          guardrails: [jsonRule()],
          detectZeroTokens: false,
        });

        for await (const _ of result.stream) {
          // Consume
        }

        if (global.gc) global.gc();
        const memAfter = process.memoryUsage().heapUsed;
        memorySnapshots.push(memAfter - memBefore);
      }

      console.log("\nMemory per iteration:");
      memorySnapshots.forEach((mem, i) => {
        console.log(`  Run ${i + 1}: ${(mem / 1024).toFixed(2)} KB`);
      });

      // Memory should not grow significantly across iterations
      // Use absolute values since GC can cause negative deltas
      const firstHalf = memorySnapshots.slice(0, 2);
      const secondHalf = memorySnapshots.slice(-2);
      const avgFirst = Math.abs(
        firstHalf.reduce((a, b) => a + b, 0) / firstHalf.length,
      );
      const avgSecond = Math.abs(
        secondHalf.reduce((a, b) => a + b, 0) / secondHalf.length,
      );

      // Memory usage in later iterations should not be dramatically higher
      // than early iterations (allows 3x variance due to GC timing)
      // If avgFirst is very small (< 1KB), use a minimum threshold
      const threshold = Math.max(avgFirst * 3, 1024 * 1024); // At least 1MB tolerance
      expect(avgSecond).toBeLessThan(threshold);
    });
  });

  describe("Comprehensive Report", () => {
    it("should generate full benchmark report", async () => {
      const report: BenchmarkReport = {
        timestamp: new Date().toISOString(),
        scenarios: new Map(),
        baseline: {
          scenario: "Baseline",
          tokenCount: 0,
          durationMs: 0,
          tokensPerSecond: 0,
          avgTokenTimeUs: 0,
          timeToFirstTokenMs: 0,
          memoryDeltaBytes: 0,
        },
      };

      // Run all scenarios
      const scenarios: Array<{
        name: string;
        options?: Partial<L0Options>;
        isBaseline?: boolean;
      }> = [
        { name: "Baseline", isBaseline: true },
        {
          name: "L0 Core (no features)",
          options: {
            guardrails: [],
            detectDrift: false,
            detectZeroTokens: false,
          },
        },
        {
          name: "L0 + JSON Guardrail",
          options: { guardrails: [jsonRule()], detectZeroTokens: false },
        },
        {
          name: "L0 + All Guardrails",
          options: {
            guardrails: [jsonRule(), markdownRule(), zeroOutputRule()],
            detectZeroTokens: false,
          },
        },
        {
          name: "L0 + Drift Detection",
          options: {
            guardrails: [],
            detectDrift: true,
            detectZeroTokens: false,
          },
        },
        {
          name: "L0 Full Stack",
          options: {
            guardrails: [jsonRule(), markdownRule(), zeroOutputRule()],
            detectDrift: true,
            detectZeroTokens: true,
          },
        },
      ];

      for (const scenario of scenarios) {
        const result = await runBenchmarkSuite(
          scenario.name,
          configs.highThroughput,
          scenario.options,
          3,
          scenario.isBaseline,
        );

        if (scenario.isBaseline) {
          report.baseline = result.avg;
        }

        report.scenarios.set(scenario.name, {
          avg: result.avg,
          min: result.min,
          max: result.max,
          stdDev: result.stdDev,
        });
      }

      // Print report
      console.log("\n" + formatReport(report));

      // Validate all scenarios completed
      expect(report.scenarios.size).toBe(scenarios.length);
    });
  });
});

// ============================================================================
// Latency Percentile Tests
// ============================================================================

describe("Latency Distribution", () => {
  it("should measure token latency percentiles", async () => {
    const tokenLatencies: number[] = [];
    let lastTokenTime = performance.now();

    const result = await l0({
      stream: createMockStreamFactory({
        tokenCount: 1000,
        interTokenDelayMs: 0,
        contentType: "text",
        realistic: true,
      }),
      guardrails: [jsonRule()],
      detectZeroTokens: false,
      onEvent: (event) => {
        if (event.type === "token") {
          const now = performance.now();
          tokenLatencies.push(now - lastTokenTime);
          lastTokenTime = now;
        }
      },
    });

    for await (const _ of result.stream) {
      // Consume
    }

    // Calculate percentiles
    const sorted = [...tokenLatencies].sort((a, b) => a - b);
    const p50 = sorted[Math.floor(sorted.length * 0.5)];
    const p95 = sorted[Math.floor(sorted.length * 0.95)];
    const p99 = sorted[Math.floor(sorted.length * 0.99)];
    const max = sorted[sorted.length - 1];

    console.log("\nToken Latency Distribution:");
    console.log(`  p50: ${(p50 * 1000).toFixed(0)} µs`);
    console.log(`  p95: ${(p95 * 1000).toFixed(0)} µs`);
    console.log(`  p99: ${(p99 * 1000).toFixed(0)} µs`);
    console.log(`  max: ${(max * 1000).toFixed(0)} µs`);

    // p50 should be very low (< 1ms per token processing)
    expect(p50).toBeLessThan(1);
  });
});
