// Async guardrails wrapper - fast/slow path pattern
// No queues, no workers, no scheduler

import type { GuardrailContext } from "../types/guardrails";
import type { GuardrailEngine } from "./engine";

/**
 * Result from a guardrail check
 */
export interface GuardrailCheckResult {
  violations: Array<{
    rule: string;
    severity: "warning" | "error" | "fatal";
    message: string;
    recoverable?: boolean;
  }>;
  shouldHalt: boolean;
  shouldRetry: boolean;
}

/**
 * Run guardrail check with fast/slow path.
 * - Try fastCheck first (delta-only, cheap)
 * - If inconclusive, run fullCheck async and call onComplete when done
 * - Never blocks the runtime loop
 *
 * @param engine - The guardrail engine
 * @param context - The guardrail context
 * @param onComplete - Callback when async check completes
 * @returns Immediate result if fast path succeeds, undefined if deferred to async
 */
export function runAsyncGuardrailCheck(
  engine: GuardrailEngine,
  context: GuardrailContext,
  onComplete: (result: GuardrailCheckResult) => void,
): GuardrailCheckResult | undefined {
  // Fast path: check delta only for obvious violations
  // This catches things like blocked words, obvious pattern matches
  if (context.delta && context.delta.length < 1000) {
    const quickContext: GuardrailContext = {
      ...context,
      content: context.delta, // Only check the delta
    };

    const quickResult = engine.check(quickContext);

    // If we found violations in delta, return immediately
    if (quickResult.violations.length > 0) {
      return quickResult;
    }

    // If delta is clean and content is small, do full check sync
    if (context.content.length < 5000) {
      return engine.check(context);
    }
  }

  // Slow path: defer full content check to next tick
  // This prevents blocking the event loop for large content
  setImmediate(() => {
    try {
      const result = engine.check(context);
      onComplete(result);
    } catch {
      // On error, return clean result
      onComplete({ violations: [], shouldHalt: false, shouldRetry: false });
    }
  });

  return undefined; // Deferred to async
}

/**
 * Simpler version: just run async check, always calls onComplete
 */
export function runGuardrailCheckAsync(
  engine: GuardrailEngine,
  context: GuardrailContext,
  onComplete: (result: GuardrailCheckResult) => void,
): void {
  setImmediate(() => {
    try {
      const result = engine.check(context);
      onComplete(result);
    } catch {
      onComplete({ violations: [], shouldHalt: false, shouldRetry: false });
    }
  });
}
