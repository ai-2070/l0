// Async drift detection wrapper - fast/slow path pattern
// No queues, no workers, no scheduler

import type { DriftDetector } from "./drift";

/**
 * Result from drift detection
 */
export interface DriftCheckResult {
  detected: boolean;
  types: string[];
  confidence?: number;
}

/**
 * Run drift check with fast/slow path.
 * - Try fast delta check first
 * - If content is large, defer to async
 * - Never blocks the runtime loop
 *
 * @param detector - The drift detector
 * @param content - Full accumulated content
 * @param delta - Latest token/chunk (optional)
 * @param onComplete - Callback when async check completes
 * @returns Immediate result if fast path succeeds, undefined if deferred to async
 */
export function runAsyncDriftCheck(
  detector: DriftDetector,
  content: string,
  delta: string | undefined,
  onComplete: (result: DriftCheckResult) => void,
): DriftCheckResult | undefined {
  // Fast path: check delta only for obvious drift patterns
  if (delta && delta.length < 1000) {
    const quickResult = detector.check(delta);
    if (quickResult.detected) {
      return quickResult;
    }

    // If delta is clean and content is small, do full check sync
    if (content.length < 10000) {
      return detector.check(content, delta);
    }
  }

  // Small content: run synchronously
  if (content.length < 10000) {
    return detector.check(content, delta);
  }

  // Large content: defer to next tick
  setImmediate(() => {
    try {
      const result = detector.check(content, delta);
      onComplete(result);
    } catch {
      onComplete({ detected: false, types: [] });
    }
  });

  return undefined; // Deferred to async
}

/**
 * Simpler version: just run async check, always calls onComplete
 */
export function runDriftCheckAsync(
  detector: DriftDetector,
  content: string,
  delta: string | undefined,
  onComplete: (result: DriftCheckResult) => void,
): void {
  setImmediate(() => {
    try {
      const result = detector.check(content, delta);
      onComplete(result);
    } catch {
      onComplete({ detected: false, types: [] });
    }
  });
}
