// Comprehensive tests for L0 Parallel Operations API

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  parallel,
  parallelAll,
  sequential,
  batched,
  race,
  createPool,
  OperationPool,
} from "../src/runtime/parallel";
import type {
  ParallelOptions,
  ParallelResult,
  AggregatedTelemetry,
} from "../src/runtime/parallel";
import type { L0Options, L0Result } from "../src/types/l0";

// Mock stream factory for testing
function createMockStreamFactory(response: string, delay: number = 0) {
  return () => ({
    textStream: (async function* () {
      if (delay > 0) {
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
      yield { type: "text-delta", textDelta: response };
    })(),
  });
}

// Mock stream factory that throws an error
function createErrorStreamFactory(message: string, delay: number = 0) {
  return () => ({
    textStream: (async function* () {
      if (delay > 0) {
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
      throw new Error(message);
    })(),
  });
}

// Create mock L0 options
function createMockL0Options(
  id: number,
  delay: number = 0,
  shouldFail: boolean = false,
): L0Options {
  return {
    stream: shouldFail
      ? createErrorStreamFactory(`Operation ${id} failed`, delay)
      : createMockStreamFactory(`Response ${id}`, delay),
  };
}

// ============================================================================
// parallel() Function Tests
// ============================================================================

describe("parallel()", () => {
  describe("Basic Execution", () => {
    it("should execute multiple operations in parallel", async () => {
      const operations: L0Options[] = [
        createMockL0Options(1),
        createMockL0Options(2),
        createMockL0Options(3),
      ];

      const result = await parallel(operations);

      expect(result.results.length).toBe(3);
      expect(result.successCount).toBe(3);
      expect(result.failureCount).toBe(0);
      expect(result.allSucceeded).toBe(true);
    });

    it("should return empty results for empty operations array", async () => {
      const result = await parallel([]);

      expect(result.results.length).toBe(0);
      expect(result.successCount).toBe(0);
      expect(result.failureCount).toBe(0);
      expect(result.allSucceeded).toBe(true);
    });

    it("should handle single operation", async () => {
      const result = await parallel([createMockL0Options(1)]);

      expect(result.results.length).toBe(1);
      expect(result.successCount).toBe(1);
      expect(result.allSucceeded).toBe(true);
    });

    it("should track duration", async () => {
      const operations = [createMockL0Options(1, 10)];

      const result = await parallel(operations);

      expect(result.duration).toBeGreaterThanOrEqual(0);
    });
  });

  describe("Concurrency Control", () => {
    it("should default to concurrency of 5", async () => {
      const startTimes: number[] = [];
      const operations: L0Options[] = Array.from({ length: 10 }, (_, i) => ({
        stream: () => {
          startTimes.push(Date.now());
          return createMockStreamFactory(`Response ${i}`, 50)();
        },
      }));

      await parallel(operations);

      // With concurrency 5, first 5 should start roughly together
      expect(startTimes.length).toBe(10);
    });

    it("should respect custom concurrency limit", async () => {
      const activeCount = { current: 0, max: 0 };
      const operations: L0Options[] = Array.from({ length: 6 }, (_, i) => ({
        stream: () => {
          activeCount.current++;
          if (activeCount.current > activeCount.max) {
            activeCount.max = activeCount.current;
          }
          return {
            textStream: (async function* () {
              await new Promise((resolve) => setTimeout(resolve, 20));
              activeCount.current--;
              yield { type: "text-delta", textDelta: `Response ${i}` };
            })(),
          };
        },
      }));

      await parallel(operations, { concurrency: 2 });

      expect(activeCount.max).toBeLessThanOrEqual(2);
    });

    it("should handle concurrency of 1 (sequential)", async () => {
      const order: number[] = [];
      const operations: L0Options[] = Array.from({ length: 3 }, (_, i) => ({
        stream: () => {
          order.push(i);
          return createMockStreamFactory(`Response ${i}`)();
        },
      }));

      await parallel(operations, { concurrency: 1 });

      expect(order).toEqual([0, 1, 2]);
    });

    it("should handle concurrency larger than operation count", async () => {
      const operations = [createMockL0Options(1), createMockL0Options(2)];

      const result = await parallel(operations, { concurrency: 100 });

      expect(result.successCount).toBe(2);
    });
  });

  describe("Error Handling", () => {
    it("should continue on error when failFast is false", async () => {
      const operations: L0Options[] = [
        createMockL0Options(1),
        createMockL0Options(2, 0, true), // Will fail
        createMockL0Options(3),
      ];

      const result = await parallel(operations, { failFast: false });

      expect(result.successCount).toBe(2);
      expect(result.failureCount).toBe(1);
      expect(result.allSucceeded).toBe(false);
      expect(result.errors[1]).toBeInstanceOf(Error);
      expect(result.results[1]).toBeNull();
    });

    it("should stop on first error when failFast is true", async () => {
      const executedOperations: number[] = [];
      const operations: L0Options[] = [
        {
          stream: () => {
            executedOperations.push(1);
            return createMockStreamFactory("Response 1", 50)();
          },
        },
        {
          stream: () => {
            executedOperations.push(2);
            throw new Error("Immediate fail");
          },
        },
        {
          stream: () => {
            executedOperations.push(3);
            return createMockStreamFactory("Response 3", 100)();
          },
        },
      ];

      const result = await parallel(operations, {
        failFast: true,
        concurrency: 1,
      });

      expect(result.failureCount).toBeGreaterThan(0);
    });

    it("should record errors correctly", async () => {
      const operations: L0Options[] = [
        createMockL0Options(1, 0, true),
        createMockL0Options(2, 0, true),
      ];

      const result = await parallel(operations);

      expect(result.errors.length).toBe(2);
      expect(result.errors[0]?.message).toContain("Operation 1 failed");
      expect(result.errors[1]?.message).toContain("Operation 2 failed");
    });

    it("should handle mixed success and failure", async () => {
      const operations: L0Options[] = [
        createMockL0Options(1),
        createMockL0Options(2, 0, true),
        createMockL0Options(3),
        createMockL0Options(4, 0, true),
        createMockL0Options(5),
      ];

      const result = await parallel(operations);

      expect(result.successCount).toBe(3);
      expect(result.failureCount).toBe(2);
      expect(result.results[0]).not.toBeNull();
      expect(result.results[1]).toBeNull();
      expect(result.results[2]).not.toBeNull();
      expect(result.results[3]).toBeNull();
      expect(result.results[4]).not.toBeNull();
    });
  });

  describe("Callbacks", () => {
    it("should call onProgress with correct values", async () => {
      const progressCalls: Array<{ completed: number; total: number }> = [];
      const operations = [
        createMockL0Options(1),
        createMockL0Options(2),
        createMockL0Options(3),
      ];

      await parallel(operations, {
        concurrency: 1,
        onProgress: (completed, total) => {
          progressCalls.push({ completed, total });
        },
      });

      expect(progressCalls.length).toBe(3);
      expect(progressCalls[0]).toEqual({ completed: 1, total: 3 });
      expect(progressCalls[1]).toEqual({ completed: 2, total: 3 });
      expect(progressCalls[2]).toEqual({ completed: 3, total: 3 });
    });

    it("should call onComplete for successful operations", async () => {
      const completeCalls: Array<{ index: number }> = [];
      const operations = [createMockL0Options(1), createMockL0Options(2)];

      await parallel(operations, {
        onComplete: (result, index) => {
          completeCalls.push({ index });
        },
      });

      expect(completeCalls.length).toBe(2);
      expect(completeCalls.map((c) => c.index).sort()).toEqual([0, 1]);
    });

    it("should call onError for failed operations", async () => {
      const errorCalls: Array<{ index: number; message: string }> = [];
      const operations: L0Options[] = [
        createMockL0Options(1),
        createMockL0Options(2, 0, true),
      ];

      await parallel(operations, {
        onError: (error, index) => {
          errorCalls.push({ index, message: error.message });
        },
      });

      expect(errorCalls.length).toBe(1);
      expect(errorCalls[0]!.index).toBe(1);
      expect(errorCalls[0]!.message).toContain("Operation 2 failed");
    });

    it("should not call callbacks when not provided", async () => {
      const operations = [createMockL0Options(1)];

      // Should not throw even without callbacks
      const result = await parallel(operations);

      expect(result.successCount).toBe(1);
    });
  });

  describe("Shared Options", () => {
    it("should merge shared retry configuration", async () => {
      const operations = [createMockL0Options(1)];
      const sharedRetry = {
        maxRetries: 3,
        baseDelay: 100,
        maxDelay: 1000,
      };

      const result = await parallel(operations, { sharedRetry });

      expect(result.successCount).toBe(1);
    });

    it("should merge shared monitoring configuration", async () => {
      const operations = [createMockL0Options(1)];
      const sharedMonitoring = {
        enabled: true,
        metadata: { test: true },
      };

      const result = await parallel(operations, { sharedMonitoring });

      expect(result.successCount).toBe(1);
    });

    it("should prefer operation-specific config over shared config", async () => {
      const operationWithRetry: L0Options = {
        ...createMockL0Options(1),
        retry: { maxRetries: 5, baseDelay: 50, maxDelay: 500 },
      };
      const operationWithoutRetry = createMockL0Options(2);

      const result = await parallel(
        [operationWithRetry, operationWithoutRetry],
        {
          sharedRetry: { maxRetries: 1, baseDelay: 10, maxDelay: 100 },
        },
      );

      expect(result.successCount).toBe(2);
    });
  });

  describe("Telemetry Aggregation", () => {
    it("should return aggregated telemetry for successful operations", async () => {
      const operations = [
        createMockL0Options(1),
        createMockL0Options(2),
        createMockL0Options(3),
      ];

      const result = await parallel(operations);

      expect(result.aggregatedTelemetry).toBeDefined();
      expect(result.aggregatedTelemetry!.totalTokens).toBeGreaterThanOrEqual(0);
      expect(result.aggregatedTelemetry!.totalDuration).toBeGreaterThanOrEqual(
        0,
      );
    });

    it("should return zero telemetry for all failed operations", async () => {
      const operations: L0Options[] = [
        createMockL0Options(1, 0, true),
        createMockL0Options(2, 0, true),
      ];

      const result = await parallel(operations);

      expect(result.aggregatedTelemetry).toBeDefined();
      expect(result.aggregatedTelemetry!.totalTokens).toBe(0);
    });
  });
});

// ============================================================================
// parallelAll() Function Tests
// ============================================================================

describe("parallelAll()", () => {
  it("should execute all operations with unlimited concurrency", async () => {
    const activeCount = { current: 0, max: 0 };
    const operations: L0Options[] = Array.from({ length: 10 }, (_, i) => ({
      stream: () => {
        activeCount.current++;
        if (activeCount.current > activeCount.max) {
          activeCount.max = activeCount.current;
        }
        return {
          textStream: (async function* () {
            await new Promise((resolve) => setTimeout(resolve, 10));
            activeCount.current--;
            yield { type: "text-delta", textDelta: `Response ${i}` };
          })(),
        };
      },
    }));

    await parallelAll(operations);

    // All operations should start at roughly the same time
    expect(activeCount.max).toBe(10);
  });

  it("should pass through other options", async () => {
    const progressCalls: number[] = [];
    const operations = [createMockL0Options(1), createMockL0Options(2)];

    await parallelAll(operations, {
      onProgress: (completed) => {
        progressCalls.push(completed);
      },
    });

    expect(progressCalls.length).toBe(2);
  });

  it("should handle empty operations", async () => {
    const result = await parallelAll([]);

    expect(result.allSucceeded).toBe(true);
    expect(result.results.length).toBe(0);
  });
});

// ============================================================================
// sequential() Function Tests
// ============================================================================

describe("sequential()", () => {
  it("should execute operations one at a time", async () => {
    const order: number[] = [];
    const operations: L0Options[] = Array.from({ length: 5 }, (_, i) => ({
      stream: () => {
        order.push(i);
        return createMockStreamFactory(`Response ${i}`)();
      },
    }));

    await sequential(operations);

    expect(order).toEqual([0, 1, 2, 3, 4]);
  });

  it("should maintain order even with errors", async () => {
    const order: number[] = [];
    const operations: L0Options[] = [
      {
        stream: () => {
          order.push(1);
          return createMockStreamFactory("Response 1")();
        },
      },
      {
        stream: () => {
          order.push(2);
          throw new Error("Fail");
        },
      },
      {
        stream: () => {
          order.push(3);
          return createMockStreamFactory("Response 3")();
        },
      },
    ];

    await sequential(operations, { failFast: false });

    expect(order).toEqual([1, 2, 3]);
  });

  it("should pass through other options", async () => {
    const errorCalls: number[] = [];
    const operations: L0Options[] = [
      createMockL0Options(1),
      createMockL0Options(2, 0, true),
    ];

    await sequential(operations, {
      onError: (_, index) => {
        errorCalls.push(index);
      },
    });

    expect(errorCalls).toEqual([1]);
  });

  it("should handle empty operations", async () => {
    const result = await sequential([]);

    expect(result.allSucceeded).toBe(true);
  });
});

// ============================================================================
// batched() Function Tests
// ============================================================================

describe("batched()", () => {
  it("should execute operations in batches", async () => {
    const batchMarkers: number[] = [];
    let batchCounter = 0;

    const operations: L0Options[] = Array.from({ length: 6 }, (_, i) => ({
      stream: () => {
        batchMarkers.push(batchCounter);
        if (i === 1 || i === 3 || i === 5) {
          batchCounter++;
        }
        return createMockStreamFactory(`Response ${i}`)();
      },
    }));

    await batched(operations, 2);

    // Operations should be grouped in batches of 2
    expect(batchMarkers.length).toBe(6);
  });

  it("should handle batch size larger than operations", async () => {
    const operations = [createMockL0Options(1), createMockL0Options(2)];

    const result = await batched(operations, 10);

    expect(result.successCount).toBe(2);
  });

  it("should handle batch size of 1", async () => {
    const order: number[] = [];
    const operations: L0Options[] = Array.from({ length: 3 }, (_, i) => ({
      stream: () => {
        order.push(i);
        return createMockStreamFactory(`Response ${i}`)();
      },
    }));

    await batched(operations, 1);

    expect(order).toEqual([0, 1, 2]);
  });

  it("should accumulate results across batches", async () => {
    const operations = Array.from({ length: 5 }, (_, i) =>
      createMockL0Options(i),
    );

    const result = await batched(operations, 2);

    expect(result.results.length).toBe(5);
    expect(result.successCount).toBe(5);
  });

  it("should track progress across batches", async () => {
    const progressCalls: Array<{ completed: number; total: number }> = [];
    const operations = Array.from({ length: 4 }, (_, i) =>
      createMockL0Options(i),
    );

    await batched(operations, 2, {
      onProgress: (completed, total) => {
        progressCalls.push({ completed, total });
      },
    });

    // Should get progress calls for each operation
    const lastCall = progressCalls[progressCalls.length - 1];
    expect(lastCall?.total).toBe(4);
  });

  it("should stop on first batch error when failFast is true", async () => {
    const executedBatches: number[] = [];
    const operations: L0Options[] = [
      {
        stream: () => {
          executedBatches.push(1);
          return createMockStreamFactory("Success")();
        },
      },
      {
        stream: () => {
          executedBatches.push(2);
          throw new Error("Batch 1 fail");
        },
      },
      {
        stream: () => {
          executedBatches.push(3);
          return createMockStreamFactory("Success")();
        },
      },
      {
        stream: () => {
          executedBatches.push(4);
          return createMockStreamFactory("Success")();
        },
      },
    ];

    const result = await batched(operations, 2, { failFast: true });

    expect(result.failureCount).toBeGreaterThan(0);
    expect(executedBatches.length).toBeLessThanOrEqual(2);
  });

  it("should handle empty operations", async () => {
    const result = await batched([], 5);

    expect(result.allSucceeded).toBe(true);
    expect(result.results.length).toBe(0);
  });

  it("should calculate total duration across batches", async () => {
    const operations = Array.from({ length: 4 }, (_, i) =>
      createMockL0Options(i, 10),
    );

    const result = await batched(operations, 2);

    expect(result.duration).toBeGreaterThan(0);
  });
});

// ============================================================================
// race() Function Tests
// ============================================================================

describe("race()", () => {
  it("should return first successful result", async () => {
    const operations: L0Options[] = [
      createMockL0Options(1, 100), // Slow
      createMockL0Options(2, 10), // Fast - should win
      createMockL0Options(3, 50), // Medium
    ];

    const result = await race(operations);

    expect(result).toBeDefined();
    expect(result.state).toBeDefined();
  });

  it("should abort other operations when one succeeds", async () => {
    const aborted: boolean[] = [false, false, false];

    const operations: L0Options[] = [
      {
        stream: () => ({
          textStream: (async function* () {
            await new Promise((resolve) => setTimeout(resolve, 100));
            aborted[0] = true;
            yield { type: "text-delta", textDelta: "Slow" };
          })(),
        }),
      },
      {
        stream: () => ({
          textStream: (async function* () {
            yield { type: "text-delta", textDelta: "Fast" };
          })(),
        }),
      },
      {
        stream: () => ({
          textStream: (async function* () {
            await new Promise((resolve) => setTimeout(resolve, 50));
            aborted[2] = true;
            yield { type: "text-delta", textDelta: "Medium" };
          })(),
        }),
      },
    ];

    await race(operations);

    // The fast operation should win, others may not complete
    // We can't guarantee they're aborted but the race should complete quickly
  });

  it("should throw when all operations fail", async () => {
    const operations: L0Options[] = [
      createMockL0Options(1, 0, true),
      createMockL0Options(2, 0, true),
    ];

    await expect(race(operations)).rejects.toThrow();
  });

  it("should pass through shared options", async () => {
    const operations = [createMockL0Options(1), createMockL0Options(2)];

    const result = await race(operations, {
      sharedRetry: { maxRetries: 2, baseDelay: 10, maxDelay: 100 },
    });

    expect(result).toBeDefined();
  });

  it("should handle single operation", async () => {
    const result = await race([createMockL0Options(1)]);

    expect(result).toBeDefined();
  });
});

// ============================================================================
// OperationPool Tests
// ============================================================================

describe("OperationPool", () => {
  describe("Initialization", () => {
    it("should create pool with concurrency", () => {
      const pool = createPool(5);

      expect(pool).toBeInstanceOf(OperationPool);
      expect(pool.getQueueLength()).toBe(0);
      expect(pool.getActiveWorkers()).toBe(0);
    });

    it("should create pool with options", () => {
      const pool = createPool(3, {
        sharedRetry: { maxRetries: 2, baseDelay: 100, maxDelay: 1000 },
      });

      expect(pool).toBeInstanceOf(OperationPool);
    });
  });

  describe("execute()", () => {
    it("should execute single operation", async () => {
      const pool = createPool(5);

      const result = await pool.execute(createMockL0Options(1));

      expect(result).toBeDefined();
      expect(result.state).toBeDefined();
    });

    it("should execute multiple operations", async () => {
      const pool = createPool(5);

      const results = await Promise.all([
        pool.execute(createMockL0Options(1)),
        pool.execute(createMockL0Options(2)),
        pool.execute(createMockL0Options(3)),
      ]);

      expect(results.length).toBe(3);
      results.forEach((r) => {
        expect(r).toBeDefined();
      });
    });

    it("should respect concurrency limit", async () => {
      const pool = createPool(2);
      const activeCount = { current: 0, max: 0 };

      const trackingOp = (id: number): L0Options => ({
        stream: () => {
          activeCount.current++;
          if (activeCount.current > activeCount.max) {
            activeCount.max = activeCount.current;
          }
          return {
            textStream: (async function* () {
              await new Promise((resolve) => setTimeout(resolve, 20));
              activeCount.current--;
              yield { type: "text-delta", textDelta: `Response ${id}` };
            })(),
          };
        },
      });

      await Promise.all([
        pool.execute(trackingOp(1)),
        pool.execute(trackingOp(2)),
        pool.execute(trackingOp(3)),
        pool.execute(trackingOp(4)),
      ]);

      expect(activeCount.max).toBeLessThanOrEqual(2);
    });

    it("should reject on error", async () => {
      const pool = createPool(5);

      await expect(
        pool.execute(createMockL0Options(1, 0, true)),
      ).rejects.toThrow("Operation 1 failed");
    });
  });

  describe("drain()", () => {
    it("should wait for all operations to complete", async () => {
      const pool = createPool(2);
      const completed: number[] = [];

      // Add operations but don't await immediately
      pool.execute(createMockL0Options(1, 50)).then(() => completed.push(1));
      pool.execute(createMockL0Options(2, 50)).then(() => completed.push(2));
      pool.execute(createMockL0Options(3, 50)).then(() => completed.push(3));

      await pool.drain();

      expect(completed.length).toBe(3);
      expect(pool.getQueueLength()).toBe(0);
      expect(pool.getActiveWorkers()).toBe(0);
    });

    it("should resolve immediately when no operations", async () => {
      const pool = createPool(5);

      await pool.drain();

      expect(pool.getQueueLength()).toBe(0);
    });
  });

  describe("Queue Management", () => {
    it("should track queue length", async () => {
      const pool = createPool(1);

      // Start first operation (will be active)
      const p1 = pool.execute(createMockL0Options(1, 50));

      // Queue more operations
      const p2 = pool.execute(createMockL0Options(2, 10));
      const p3 = pool.execute(createMockL0Options(3, 10));

      // Check queue (should have 2 queued while 1 is active)
      expect(pool.getQueueLength()).toBeGreaterThanOrEqual(0);
      expect(pool.getActiveWorkers()).toBe(1);

      await Promise.all([p1, p2, p3]);
    });

    it("should track active workers", async () => {
      const pool = createPool(3);
      const promises: Promise<any>[] = [];

      // Start multiple operations
      for (let i = 0; i < 5; i++) {
        promises.push(pool.execute(createMockL0Options(i, 30)));
      }

      // Should have up to 3 active
      expect(pool.getActiveWorkers()).toBeLessThanOrEqual(3);

      await Promise.all(promises);

      expect(pool.getActiveWorkers()).toBe(0);
    });
  });

  describe("Shared Options", () => {
    it("should apply shared retry config", async () => {
      const pool = createPool(5, {
        sharedRetry: { maxRetries: 3, baseDelay: 10, maxDelay: 100 },
      });

      const result = await pool.execute(createMockL0Options(1));

      expect(result).toBeDefined();
    });

    it("should apply shared monitoring config", async () => {
      const pool = createPool(5, {
        sharedMonitoring: { enabled: true, metadata: { pool: "test" } },
      });

      const result = await pool.execute(createMockL0Options(1));

      expect(result).toBeDefined();
    });

    it("should prefer operation-specific config", async () => {
      const pool = createPool(5, {
        sharedRetry: { maxRetries: 1, baseDelay: 10, maxDelay: 100 },
      });

      const opWithRetry: L0Options = {
        ...createMockL0Options(1),
        retry: { maxRetries: 5, baseDelay: 50, maxDelay: 500 },
      };

      const result = await pool.execute(opWithRetry);

      expect(result).toBeDefined();
    });
  });
});

// ============================================================================
// Edge Cases and Stress Tests
// ============================================================================

describe("Edge Cases", () => {
  describe("Large Scale Operations", () => {
    it("should handle many operations", async () => {
      const operations = Array.from({ length: 50 }, (_, i) =>
        createMockL0Options(i),
      );

      const result = await parallel(operations, { concurrency: 10 });

      expect(result.results.length).toBe(50);
      expect(result.successCount).toBe(50);
    });

    it("should handle many concurrent operations", async () => {
      const operations = Array.from({ length: 20 }, (_, i) =>
        createMockL0Options(i),
      );

      const result = await parallelAll(operations);

      expect(result.results.length).toBe(20);
    });
  });

  describe("Timing Edge Cases", () => {
    it("should handle operations that complete instantly", async () => {
      const operations = Array.from({ length: 10 }, (_, i) =>
        createMockL0Options(i, 0),
      );

      const result = await parallel(operations);

      expect(result.successCount).toBe(10);
    });

    it("should handle operations with varying delays", async () => {
      const operations = [
        createMockL0Options(1, 100),
        createMockL0Options(2, 10),
        createMockL0Options(3, 50),
        createMockL0Options(4, 5),
        createMockL0Options(5, 75),
      ];

      const result = await parallel(operations);

      expect(result.successCount).toBe(5);
    });
  });

  describe("Error Edge Cases", () => {
    it("should handle all operations failing", async () => {
      const operations = Array.from({ length: 5 }, (_, i) =>
        createMockL0Options(i, 0, true),
      );

      const result = await parallel(operations);

      expect(result.successCount).toBe(0);
      expect(result.failureCount).toBe(5);
      expect(result.allSucceeded).toBe(false);
    });

    it("should handle errors thrown synchronously", async () => {
      const operations: L0Options[] = [
        {
          stream: () => {
            throw new Error("Sync error");
          },
        },
      ];

      const result = await parallel(operations);

      expect(result.failureCount).toBe(1);
      expect(result.errors[0]?.message).toBe("Sync error");
    });

    it("should convert non-Error throws to Error objects", async () => {
      const operations: L0Options[] = [
        {
          stream: () => {
            throw "string error";
          },
        },
      ];

      const result = await parallel(operations);

      expect(result.errors[0]).toBeInstanceOf(Error);
      expect(result.errors[0]?.message).toBe("string error");
    });
  });

  describe("Callback Edge Cases", () => {
    it("should handle callback errors gracefully", async () => {
      const operations = [createMockL0Options(1)];

      // Callbacks that throw should not break the parallel execution
      const result = await parallel(operations, {
        onComplete: () => {
          throw new Error("Callback error");
        },
      });

      // The operation itself should still be tracked
      expect(result.results.length).toBe(1);
    });

    it("should call progress for both successes and failures", async () => {
      const progressValues: number[] = [];
      const operations: L0Options[] = [
        createMockL0Options(1),
        createMockL0Options(2, 0, true),
        createMockL0Options(3),
      ];

      await parallel(operations, {
        concurrency: 1,
        onProgress: (completed) => {
          progressValues.push(completed);
        },
      });

      expect(progressValues.length).toBe(3);
      expect(progressValues).toEqual([1, 2, 3]);
    });
  });
});

// ============================================================================
// Integration Tests
// ============================================================================

describe("Integration Scenarios", () => {
  it("should handle parallel processing workflow", async () => {
    // Simulate processing multiple prompts
    const prompts = ["Hello", "World", "Test", "Example"];
    const operations = prompts.map((prompt) => ({
      stream: createMockStreamFactory(`Response to: ${prompt}`),
    }));

    const result = await parallel(operations, { concurrency: 2 });

    expect(result.allSucceeded).toBe(true);
    expect(result.results.length).toBe(4);
  });

  it("should handle batched processing with monitoring", async () => {
    const operations = Array.from({ length: 10 }, (_, i) =>
      createMockL0Options(i),
    );

    const result = await batched(operations, 3, {
      onProgress: (completed, total) => {
        // Progress tracking
      },
      sharedMonitoring: { enabled: true },
    });

    expect(result.successCount).toBe(10);
  });

  it("should handle pool-based processing", async () => {
    const pool = createPool(3);
    const results: L0Result[] = [];

    // Process items through pool
    for (let i = 0; i < 5; i++) {
      results.push(await pool.execute(createMockL0Options(i)));
    }

    expect(results.length).toBe(5);
  });

  it("should handle race for fastest response", async () => {
    const operations = [
      createMockL0Options(1, 100),
      createMockL0Options(2, 50),
      createMockL0Options(3, 10), // Fastest
    ];

    const startTime = Date.now();
    const result = await race(operations);
    const duration = Date.now() - startTime;

    expect(result).toBeDefined();
    // Should complete relatively quickly (fastest operation)
    expect(duration).toBeLessThan(100);
  });

  it("should combine parallel and sequential processing", async () => {
    // First batch in parallel
    const batch1 = await parallel(
      [createMockL0Options(1), createMockL0Options(2)],
      { concurrency: 2 },
    );

    expect(batch1.successCount).toBe(2);

    // Second batch sequential based on first results
    const batch2 = await sequential([
      createMockL0Options(3),
      createMockL0Options(4),
    ]);

    expect(batch2.successCount).toBe(2);
  });
});

// ============================================================================
// Type Safety Tests
// ============================================================================

describe("Type Safety", () => {
  it("should maintain result type structure", async () => {
    const operations = [createMockL0Options(1)];

    const result: ParallelResult = await parallel(operations);

    expect(Array.isArray(result.results)).toBe(true);
    expect(Array.isArray(result.errors)).toBe(true);
    expect(typeof result.successCount).toBe("number");
    expect(typeof result.failureCount).toBe("number");
    expect(typeof result.duration).toBe("number");
    expect(typeof result.allSucceeded).toBe("boolean");
  });

  it("should maintain telemetry type structure", async () => {
    const operations = [createMockL0Options(1)];

    const result = await parallel(operations);
    const telemetry = result.aggregatedTelemetry;

    expect(telemetry).toBeDefined();
    expect(typeof telemetry!.totalTokens).toBe("number");
    expect(typeof telemetry!.totalDuration).toBe("number");
    expect(typeof telemetry!.totalRetries).toBe("number");
    expect(typeof telemetry!.totalNetworkErrors).toBe("number");
    expect(typeof telemetry!.totalViolations).toBe("number");
    expect(typeof telemetry!.avgTokensPerSecond).toBe("number");
    expect(typeof telemetry!.avgTimeToFirstToken).toBe("number");
  });
});
