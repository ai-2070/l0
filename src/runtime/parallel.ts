// Parallel operations system for L0 - run multiple LLM operations concurrently

import type { L0Options, L0Result } from "../types/l0";
import { l0 } from "./l0";

/**
 * Configuration for parallel operations
 */
export interface ParallelOptions {
  /**
   * Maximum number of concurrent operations (default: 5)
   */
  concurrency?: number;

  /**
   * Whether to fail fast on first error (default: false)
   */
  failFast?: boolean;

  /**
   * Shared retry configuration for all operations
   */
  sharedRetry?: L0Options["retry"];

  /**
   * Shared monitoring configuration for all operations
   */
  sharedMonitoring?: L0Options["monitoring"];

  /**
   * Callback for progress updates
   */
  onProgress?: (completed: number, total: number) => void;

  /**
   * Callback when an operation completes
   */
  onComplete?: (result: L0Result, index: number) => void;

  /**
   * Callback when an operation fails
   */
  onError?: (error: Error, index: number) => void;
}

/**
 * Result from race operation - includes winner index
 */
export interface RaceResult extends L0Result {
  /**
   * Index of the winning operation (0-based)
   */
  winnerIndex: number;
}

/**
 * Result from parallel operations
 */
export interface ParallelResult {
  /**
   * Results from all operations (null for failed operations if failFast: false)
   */
  results: Array<L0Result | null>;

  /**
   * Errors encountered (null for successful operations)
   */
  errors: Array<Error | null>;

  /**
   * Number of successful operations
   */
  successCount: number;

  /**
   * Number of failed operations
   */
  failureCount: number;

  /**
   * Total duration in milliseconds
   */
  duration: number;

  /**
   * Whether all operations succeeded
   */
  allSucceeded: boolean;

  /**
   * Aggregated telemetry from all operations
   */
  aggregatedTelemetry?: AggregatedTelemetry;
}

/**
 * Aggregated telemetry from parallel operations
 */
export interface AggregatedTelemetry {
  totalTokens: number;
  totalDuration: number;
  totalRetries: number;
  totalNetworkErrors: number;
  totalViolations: number;
  avgTokensPerSecond: number;
  avgTimeToFirstToken: number;
}

/**
 * Execute multiple L0 operations in parallel with concurrency control
 *
 * @param operations - Array of L0 options for each operation
 * @param options - Parallel execution options
 * @returns Promise that resolves with all results
 *
 * @example
 * ```typescript
 * const results = await parallel([
 *   { stream: () => streamText({ model, prompt: "Hello" }) },
 *   { stream: () => streamText({ model, prompt: "World" }) },
 *   { stream: () => streamText({ model, prompt: "!" }) }
 * ], {
 *   concurrency: 2,
 *   failFast: false
 * });
 *
 * console.log(results.successCount); // 3
 * console.log(results.results[0].state.content); // "Hello response"
 * ```
 */
export async function parallel(
  operations: L0Options[],
  options: ParallelOptions = {},
): Promise<ParallelResult> {
  const {
    concurrency = 5,
    failFast = false,
    sharedRetry,
    sharedMonitoring,
    onProgress,
    onComplete,
    onError,
  } = options;

  const startTime = Date.now();
  const results: Array<L0Result | null> = new Array(operations.length).fill(
    null,
  );
  const errors: Array<Error | null> = new Array(operations.length).fill(null);
  let completed = 0;
  let successCount = 0;
  let failureCount = 0;

  // Merge shared options with individual operation options
  const mergedOperations = operations.map((op) => ({
    ...op,
    retry: op.retry || sharedRetry,
    monitoring: op.monitoring || sharedMonitoring,
  }));

  // Create a queue of operations with their indices
  const queue = mergedOperations.map((op, index) => ({ op, index }));
  const executing: Promise<void>[] = [];

  // Worker function to process operations
  const processOperation = async (item: {
    op: L0Options;
    index: number;
  }): Promise<void> => {
    try {
      // Execute the L0 operation
      const result = await l0(item.op);

      // Consume the stream to completion
      for await (const _event of result.stream) {
        // Stream is being consumed
      }

      results[item.index] = result;
      successCount++;

      if (onComplete) {
        onComplete(result, item.index);
      }
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      errors[item.index] = err;
      failureCount++;

      if (onError) {
        onError(err, item.index);
      }

      if (failFast) {
        throw err;
      }
    } finally {
      completed++;
      if (onProgress) {
        onProgress(completed, operations.length);
      }
    }
  };

  // Process operations with concurrency control
  try {
    for (const item of queue) {
      // Create a promise for this operation
      const promise = processOperation(item).then(() => {
        // Remove from executing when done
        executing.splice(executing.indexOf(promise), 1);
      });

      executing.push(promise);

      // If we've reached concurrency limit, wait for one to finish
      if (executing.length >= concurrency) {
        await Promise.race(executing);
      }
    }

    // Wait for all remaining operations to complete
    await Promise.all(executing);
  } catch (error) {
    if (failFast) {
      // Wait for all executing operations to finish (or fail)
      await Promise.allSettled(executing);
    }
    // Error already recorded, continue to return results
  }

  const duration = Date.now() - startTime;
  const allSucceeded = failureCount === 0;

  // Aggregate telemetry from successful operations
  const aggregatedTelemetry = aggregateTelemetry(
    results.filter((r) => r !== null) as L0Result[],
  );

  return {
    results,
    errors,
    successCount,
    failureCount,
    duration,
    allSucceeded,
    aggregatedTelemetry,
  };
}

/**
 * Execute multiple L0 operations in parallel with no concurrency limit
 * Convenience wrapper around parallel() with unlimited concurrency
 *
 * @param operations - Array of L0 options
 * @returns Promise that resolves with all results
 */
export async function parallelAll(
  operations: L0Options[],
  options: Omit<ParallelOptions, "concurrency"> = {},
): Promise<ParallelResult> {
  return parallel(operations, { ...options, concurrency: operations.length });
}

/**
 * Execute multiple L0 operations sequentially (concurrency: 1)
 * Convenience wrapper around parallel() with sequential execution
 *
 * @param operations - Array of L0 options
 * @returns Promise that resolves with all results
 */
export async function sequential(
  operations: L0Options[],
  options: Omit<ParallelOptions, "concurrency"> = {},
): Promise<ParallelResult> {
  return parallel(operations, { ...options, concurrency: 1 });
}

/**
 * Execute operations in batches
 * Runs all operations in a batch in parallel, then moves to the next batch
 *
 * @param operations - Array of L0 options
 * @param batchSize - Size of each batch
 * @param options - Parallel options
 * @returns Promise that resolves with all results
 */
export async function batched(
  operations: L0Options[],
  batchSize: number,
  options: Omit<ParallelOptions, "concurrency"> = {},
): Promise<ParallelResult> {
  const allResults: Array<L0Result | null> = [];
  const allErrors: Array<Error | null> = [];
  let totalSuccess = 0;
  let totalFailure = 0;
  let totalDuration = 0;

  // Split operations into batches
  const batches: L0Options[][] = [];
  for (let i = 0; i < operations.length; i += batchSize) {
    batches.push(operations.slice(i, i + batchSize));
  }

  // Process each batch
  for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
    const batch = batches[batchIndex]!;

    const result = await parallel(batch, {
      ...options,
      concurrency: batchSize,
      onProgress: options.onProgress
        ? (completed, _total) => {
            const overallCompleted = batchIndex * batchSize + completed;
            options.onProgress!(overallCompleted, operations.length);
          }
        : undefined,
    });

    allResults.push(...result.results);
    allErrors.push(...result.errors);
    totalSuccess += result.successCount;
    totalFailure += result.failureCount;
    totalDuration += result.duration;

    if (options.failFast && !result.allSucceeded) {
      break;
    }
  }

  const aggregatedTelemetry = aggregateTelemetry(
    allResults.filter((r) => r !== null) as L0Result[],
  );

  return {
    results: allResults,
    errors: allErrors,
    successCount: totalSuccess,
    failureCount: totalFailure,
    duration: totalDuration,
    allSucceeded: totalFailure === 0,
    aggregatedTelemetry,
  };
}

/**
 * Race multiple L0 operations - returns first successful result
 * Cancels other operations when one succeeds
 *
 * @param operations - Array of L0 options
 * @returns Promise that resolves with first successful result including winnerIndex
 */
export async function race(
  operations: L0Options[],
  options: Pick<ParallelOptions, "sharedRetry" | "sharedMonitoring"> = {},
): Promise<RaceResult> {
  const { sharedRetry, sharedMonitoring } = options;

  // Add abort controllers to each operation
  const controllers = operations.map(() => new AbortController());
  const mergedOperations = operations.map((op, index) => ({
    ...op,
    retry: op.retry || sharedRetry,
    monitoring: op.monitoring || sharedMonitoring,
    signal: controllers[index]!.signal,
  }));

  const promises = mergedOperations.map(async (op, index) => {
    const result = await l0(op);
    // Consume stream
    for await (const _event of result.stream) {
      // Stream consumption
    }
    return { result, index };
  });

  try {
    // Use Promise.any to get the first successful result
    // Promise.race would reject on first failure, but we want first success
    const { result, index } = await Promise.any(promises);

    // Abort all other operations
    controllers.forEach((controller) => controller.abort());

    return { ...result, winnerIndex: index };
  } catch (error) {
    // All operations failed (AggregateError from Promise.any)
    controllers.forEach((controller) => controller.abort());
    if (error instanceof AggregateError) {
      // Throw the first error from the aggregate
      throw error.errors[0] || new Error("All operations failed");
    }
    throw error;
  }
}

/**
 * Aggregate telemetry from multiple results
 */
function aggregateTelemetry(results: L0Result[]): AggregatedTelemetry {
  if (results.length === 0) {
    return {
      totalTokens: 0,
      totalDuration: 0,
      totalRetries: 0,
      totalNetworkErrors: 0,
      totalViolations: 0,
      avgTokensPerSecond: 0,
      avgTimeToFirstToken: 0,
    };
  }

  let totalTokens = 0;
  let totalDuration = 0;
  let totalRetries = 0;
  let totalNetworkErrors = 0;
  let totalViolations = 0;
  let sumTokensPerSecond = 0;
  let sumTimeToFirstToken = 0;
  let countWithTTFT = 0;
  let countWithTPS = 0;

  for (const result of results) {
    if (result.telemetry) {
      totalTokens += result.telemetry.metrics.totalTokens;
      totalDuration += result.telemetry.duration || 0;
      totalRetries += result.telemetry.metrics.totalRetries;
      totalNetworkErrors += result.telemetry.network.errorCount;
      totalViolations += result.telemetry.guardrails?.violationCount || 0;

      if (result.telemetry.metrics.tokensPerSecond !== undefined) {
        sumTokensPerSecond += result.telemetry.metrics.tokensPerSecond;
        countWithTPS++;
      }

      if (result.telemetry.metrics.timeToFirstToken !== undefined) {
        sumTimeToFirstToken += result.telemetry.metrics.timeToFirstToken;
        countWithTTFT++;
      }
    }
  }

  return {
    totalTokens,
    totalDuration,
    totalRetries,
    totalNetworkErrors,
    totalViolations,
    avgTokensPerSecond:
      countWithTPS > 0 ? sumTokensPerSecond / countWithTPS : 0,
    avgTimeToFirstToken:
      countWithTTFT > 0 ? sumTimeToFirstToken / countWithTTFT : 0,
  };
}

/**
 * Create a pool of workers for processing operations
 */
export class OperationPool {
  private queue: Array<{
    op: L0Options;
    resolve: (result: L0Result) => void;
    reject: (error: Error) => void;
  }> = [];
  private activeWorkers = 0;

  constructor(
    private concurrency: number,
    private options: Pick<
      ParallelOptions,
      "sharedRetry" | "sharedMonitoring"
    > = {},
  ) {}

  /**
   * Add an operation to the pool
   */
  async execute(operation: L0Options): Promise<L0Result> {
    return new Promise((resolve, reject) => {
      this.queue.push({ op: operation, resolve, reject });
      this.processQueue();
    });
  }

  /**
   * Process queued operations
   */
  private async processQueue(): Promise<void> {
    if (this.activeWorkers >= this.concurrency || this.queue.length === 0) {
      return;
    }

    const item = this.queue.shift();
    if (!item) return;

    this.activeWorkers++;

    try {
      const mergedOp = {
        ...item.op,
        retry: item.op.retry || this.options.sharedRetry,
        monitoring: item.op.monitoring || this.options.sharedMonitoring,
      };

      const result = await l0(mergedOp);

      // Consume stream
      for await (const _event of result.stream) {
        // Stream consumption
      }

      item.resolve(result);
    } catch (error) {
      item.reject(error instanceof Error ? error : new Error(String(error)));
    } finally {
      this.activeWorkers--;
      this.processQueue();
    }
  }

  /**
   * Wait for all operations to complete
   */
  async drain(): Promise<void> {
    while (this.queue.length > 0 || this.activeWorkers > 0) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }

  /**
   * Get current queue length
   */
  getQueueLength(): number {
    return this.queue.length;
  }

  /**
   * Get number of active workers
   */
  getActiveWorkers(): number {
    return this.activeWorkers;
  }
}

/**
 * Create an operation pool
 */
export function createPool(
  concurrency: number,
  options: Pick<ParallelOptions, "sharedRetry" | "sharedMonitoring"> = {},
): OperationPool {
  return new OperationPool(concurrency, options);
}
