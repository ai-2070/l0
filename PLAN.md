# L0 Runtime Architecture Refactor Plan

## Overview

This plan addresses the architectural critiques of the L0 runtime, transforming it from a monolithic streaming loop with implicit state transitions into a well-structured, maintainable system with:

1. **Formal state machine** - Explicit states and transitions
2. **Typed error taxonomy** - Serializable errors with clear semantics
3. **Non-blocking guardrails** - Async checks that don't block the event loop
4. **Structured instrumentation** - OpenTelemetry-native metrics with stable naming
5. **Composable pipeline** - Decoupled features as pipeline stages
6. **Fuzz testing** - Edge case coverage for deduplication

---

## 1. Formal State Machine

### Current Problem
The runtime uses ~15 boolean flags and manual conditional branches to track state:
- `firstTokenReceived`, `deduplicationComplete`, `isRetryAttempt`
- `state.continuedFromCheckpoint`, `state.completed`, `state.driftDetected`
- `initialTimeoutReached`, etc.

This makes correctness accidental and hard to verify.

### Solution: Explicit State Machine

Create `src/runtime/state-machine.ts`:

```typescript
// Explicit runtime states
export type L0RuntimeState =
  | "idle"
  | "initializing"
  | "awaiting_first_token"
  | "streaming"
  | "deduplicating"
  | "checking_guardrails"
  | "checking_drift"
  | "retrying"
  | "falling_back"
  | "completing"
  | "completed"
  | "failed";

// Valid transitions
export type L0Transition =
  | { type: "START" }
  | { type: "STREAM_CREATED" }
  | { type: "FIRST_TOKEN"; token: string }
  | { type: "TOKEN"; token: string }
  | { type: "DEDUP_COMPLETE" }
  | { type: "GUARDRAIL_PASS" }
  | { type: "GUARDRAIL_FAIL"; violation: GuardrailViolation }
  | { type: "DRIFT_DETECTED"; types: string[] }
  | { type: "STREAM_END" }
  | { type: "ERROR"; error: L0Error }
  | { type: "RETRY"; attempt: number }
  | { type: "FALLBACK"; index: number }
  | { type: "TIMEOUT"; timeoutType: "initial" | "inter_token" }
  | { type: "ABORT" }
  | { type: "COMPLETE" };

// State machine with validated transitions
export class L0StateMachine {
  private state: L0RuntimeState = "idle";
  private listeners: Set<(state: L0RuntimeState, transition: L0Transition) => void>;
  
  constructor(private readonly validTransitions: TransitionMap) {}
  
  transition(event: L0Transition): L0RuntimeState {
    const nextState = this.validTransitions[this.state]?.[event.type];
    if (!nextState) {
      throw new L0Error(`Invalid transition ${event.type} from state ${this.state}`, {
        code: "INVALID_STATE_TRANSITION",
        metadata: { currentState: this.state, event }
      });
    }
    this.state = nextState;
    this.notify(event);
    return this.state;
  }
  
  getState(): L0RuntimeState { return this.state; }
  
  // Observable for external monitoring
  subscribe(listener: (state: L0RuntimeState, transition: L0Transition) => void): () => void;
}

// Transition map defines valid state transitions
const L0_TRANSITIONS: TransitionMap = {
  idle: {
    START: "initializing",
  },
  initializing: {
    STREAM_CREATED: "awaiting_first_token",
    ERROR: "failed",
  },
  awaiting_first_token: {
    FIRST_TOKEN: "streaming",
    TIMEOUT: "retrying",
    ERROR: "retrying",
    ABORT: "failed",
  },
  streaming: {
    TOKEN: "streaming",
    STREAM_END: "completing",
    TIMEOUT: "retrying",
    ERROR: "retrying",
    ABORT: "failed",
    GUARDRAIL_FAIL: "retrying",
    DRIFT_DETECTED: "retrying",
  },
  retrying: {
    RETRY: "initializing",
    FALLBACK: "initializing",
    ERROR: "failed",
  },
  completing: {
    GUARDRAIL_PASS: "completed",
    GUARDRAIL_FAIL: "retrying",
    COMPLETE: "completed",
    ERROR: "failed",
  },
  completed: {},
  failed: {},
};
```

### Benefits
- **Verifiable correctness** - Invalid transitions throw immediately
- **Observable** - External systems can subscribe to state changes
- **Testable** - Can test all valid/invalid transition combinations
- **Debuggable** - State history can be logged for debugging

---

## 2. Typed Error Taxonomy with Serialization

### Current Problem
`L0Error` exists but:
- No formal error hierarchy
- No guaranteed serialization format
- No mapping to user-facing semantics
- Inconsistent error → state mutation ordering

### Solution: Error Taxonomy

Create `src/types/errors.ts`:

```typescript
// Error categories for routing and handling
export enum L0ErrorCategory {
  NETWORK = "network",       // Transient, retry without limit
  TIMEOUT = "timeout",       // Transient, retry with backoff
  GUARDRAIL = "guardrail",   // Content issue, may retry
  DRIFT = "drift",           // Content divergence, may retry
  PROVIDER = "provider",     // API/model error, may retry
  VALIDATION = "validation", // Input error, don't retry
  INTERNAL = "internal",     // Bug, don't retry
  FATAL = "fatal",           // Unrecoverable, stop immediately
}

// Base error interface for serialization
export interface SerializedL0Error {
  name: "L0Error";
  code: L0ErrorCode;
  category: L0ErrorCategory;
  message: string;
  timestamp: number;
  
  // Recovery context
  recoverable: boolean;
  checkpoint?: string;
  checkpointLength?: number;
  tokenCount: number;
  
  // Execution context
  retryAttempts: number;
  networkRetries: number;
  fallbackIndex: number;
  
  // Causal chain
  cause?: SerializedL0Error | SerializedError;
  
  // Provider-specific details (if any)
  provider?: {
    name: string;
    errorCode?: string;
    statusCode?: number;
  };
}

// Enhanced L0Error with serialization
export class L0Error extends Error {
  readonly code: L0ErrorCode;
  readonly category: L0ErrorCategory;
  readonly context: L0ErrorContext;
  readonly timestamp: number;
  readonly cause?: Error;
  
  constructor(message: string, context: L0ErrorContext, cause?: Error) {
    super(message);
    this.cause = cause;
    // ... existing constructor logic
  }
  
  // Serialize for logging/transport
  toJSON(): SerializedL0Error {
    return {
      name: "L0Error",
      code: this.code,
      category: this.category,
      message: this.message,
      timestamp: this.timestamp,
      recoverable: this.isRecoverable,
      checkpoint: this.context.checkpoint,
      checkpointLength: this.context.checkpoint?.length,
      tokenCount: this.context.tokenCount ?? 0,
      retryAttempts: this.context.retryAttempts ?? 0,
      networkRetries: this.context.networkRetries ?? 0,
      fallbackIndex: this.context.fallbackIndex ?? 0,
      cause: this.cause ? serializeError(this.cause) : undefined,
      provider: this.context.metadata?.provider,
    };
  }
  
  // Deserialize from JSON (for error reconstruction)
  static fromJSON(json: SerializedL0Error): L0Error {
    return new L0Error(json.message, {
      code: json.code,
      checkpoint: json.checkpoint,
      tokenCount: json.tokenCount,
      retryAttempts: json.retryAttempts,
      networkRetries: json.networkRetries,
      fallbackIndex: json.fallbackIndex,
      recoverable: json.recoverable,
    });
  }
  
  // User-facing message (sanitized, no internal details)
  toUserMessage(): string {
    const messages: Record<L0ErrorCode, string> = {
      NETWORK_ERROR: "Connection issue. Please try again.",
      INITIAL_TOKEN_TIMEOUT: "The service is taking too long to respond.",
      INTER_TOKEN_TIMEOUT: "Response was interrupted. Please try again.",
      GUARDRAIL_VIOLATION: "Content policy violation detected.",
      // ... etc
    };
    return messages[this.code] ?? "An unexpected error occurred.";
  }
}

// Helper to serialize any error
function serializeError(error: Error): SerializedError {
  if (error instanceof L0Error) {
    return error.toJSON();
  }
  return {
    name: error.name,
    message: error.message,
    stack: error.stack,
  };
}
```

### Error Event Ordering

Establish deterministic ordering for error events:
1. Error detected
2. State mutation (checkpoint update, etc.)
3. Error event emitted
4. Retry/fallback decision made
5. New state entered

---

## 3. Non-Blocking Guardrails & Drift Detection

### Current Problem
Guardrails and drift detection run synchronously in the streaming loop:
- O(n) content scanning blocks event loop
- Slow rules cause token delays
- Token delays can trigger timeouts → false retries

### Solution: Async Check Pipeline

Create `src/runtime/async-checks.ts`:

```typescript
// Check result that can be awaited or polled
export interface AsyncCheckResult<T> {
  // Immediate result if available
  immediate?: T;
  // Promise for async result
  pending?: Promise<T>;
  // Cancel the check
  cancel: () => void;
}

// Async guardrail engine wrapper
export class AsyncGuardrailEngine {
  private pendingChecks: Map<string, AbortController> = new Map();
  private checkQueue: Array<{
    id: string;
    context: GuardrailContext;
    resolve: (result: GuardrailResult) => void;
  }> = [];
  private processing = false;
  
  constructor(
    private engine: GuardrailEngine,
    private options: {
      // Max time for synchronous check before deferring
      syncBudgetMs: number;
      // Whether to use worker threads for heavy checks
      useWorker: boolean;
      // Max queued checks before dropping oldest
      maxQueueSize: number;
    } = { syncBudgetMs: 5, useWorker: false, maxQueueSize: 100 }
  ) {}
  
  // Check with budget - returns immediately if fast enough
  check(context: GuardrailContext): AsyncCheckResult<GuardrailResult> {
    const checkId = `check-${Date.now()}-${Math.random()}`;
    const abortController = new AbortController();
    
    // Try fast path first (delta-only rules)
    const fastResult = this.engine.checkDeltaOnly(context);
    if (fastResult.complete) {
      return { immediate: fastResult.result, cancel: () => {} };
    }
    
    // Queue full content check for async processing
    const pending = new Promise<GuardrailResult>((resolve) => {
      this.checkQueue.push({ id: checkId, context, resolve });
      this.pendingChecks.set(checkId, abortController);
      this.processQueue();
    });
    
    return {
      pending,
      cancel: () => {
        abortController.abort();
        this.pendingChecks.delete(checkId);
      },
    };
  }
  
  // Process queue without blocking
  private async processQueue(): Promise<void> {
    if (this.processing) return;
    this.processing = true;
    
    while (this.checkQueue.length > 0) {
      const item = this.checkQueue.shift()!;
      const controller = this.pendingChecks.get(item.id);
      
      if (controller?.signal.aborted) continue;
      
      // Use setImmediate to yield to event loop between checks
      await new Promise(resolve => setImmediate(resolve));
      
      try {
        const result = this.engine.check(item.context);
        item.resolve(result);
      } catch (error) {
        item.resolve({ violations: [], shouldHalt: false, shouldRetry: false });
      } finally {
        this.pendingChecks.delete(item.id);
      }
    }
    
    this.processing = false;
  }
}

// Async drift detector wrapper
export class AsyncDriftDetector {
  constructor(
    private detector: DriftDetector,
    private options: { syncBudgetMs: number } = { syncBudgetMs: 5 }
  ) {}
  
  check(content: string, delta?: string): AsyncCheckResult<DriftResult> {
    // Fast path: check delta only for obvious drift patterns
    if (delta && delta.length < 1000) {
      const quickResult = this.detector.checkDelta(delta);
      if (quickResult.detected) {
        return { immediate: quickResult, cancel: () => {} };
      }
    }
    
    // For large content, defer to next tick
    if (content.length > 10000) {
      const pending = new Promise<DriftResult>((resolve) => {
        setImmediate(() => {
          resolve(this.detector.check(content, delta));
        });
      });
      return { pending, cancel: () => {} };
    }
    
    // Small enough for sync check
    return { immediate: this.detector.check(content, delta), cancel: () => {} };
  }
}
```

### Integration with Stream Loop

```typescript
// In the streaming loop, checks no longer block:
const checkResult = asyncGuardrails.check(context);

if (checkResult.immediate) {
  // Fast path - handle immediately
  handleGuardrailResult(checkResult.immediate);
} else if (checkResult.pending) {
  // Slow path - handle when ready, don't block token emission
  checkResult.pending.then(result => {
    handleGuardrailResult(result);
  });
}

// Token emission continues without waiting
yield tokenEvent;
```

---

## 4. Structured Instrumentation

### Current Problem
- Ad-hoc metric naming
- No consistent tags/labels
- No high-cardinality support
- Sampling is per-session, not per-metric

### Solution: OpenTelemetry-Native Metrics

Update `src/runtime/opentelemetry.ts`:

```typescript
// Stable metric names following OpenTelemetry semantic conventions
export const L0Metrics = {
  // Counters
  REQUESTS_TOTAL: "l0.requests.total",
  TOKENS_TOTAL: "l0.tokens.total",
  RETRIES_TOTAL: "l0.retries.total",
  ERRORS_TOTAL: "l0.errors.total",
  GUARDRAIL_CHECKS_TOTAL: "l0.guardrails.checks.total",
  GUARDRAIL_VIOLATIONS_TOTAL: "l0.guardrails.violations.total",
  
  // Histograms
  REQUEST_DURATION: "l0.request.duration",
  TIME_TO_FIRST_TOKEN: "l0.time_to_first_token",
  INTER_TOKEN_LATENCY: "l0.inter_token_latency",
  GUARDRAIL_CHECK_DURATION: "l0.guardrails.check.duration",
  
  // Gauges
  ACTIVE_STREAMS: "l0.streams.active",
  PENDING_GUARDRAIL_CHECKS: "l0.guardrails.checks.pending",
} as const;

// Standard attribute names
export const L0Attributes = {
  // Request context
  SESSION_ID: "l0.session.id",
  PROVIDER: "l0.provider",
  MODEL: "l0.model",
  
  // Error context
  ERROR_CODE: "l0.error.code",
  ERROR_CATEGORY: "l0.error.category",
  ERROR_RECOVERABLE: "l0.error.recoverable",
  
  // Guardrail context
  GUARDRAIL_RULE: "l0.guardrail.rule",
  GUARDRAIL_SEVERITY: "l0.guardrail.severity",
  
  // Retry context
  RETRY_TYPE: "l0.retry.type",        // "network" | "model"
  RETRY_REASON: "l0.retry.reason",
  FALLBACK_INDEX: "l0.fallback.index",
  
  // Performance context
  CONTENT_LENGTH: "l0.content.length",
  TOKEN_COUNT: "l0.token.count",
} as const;

// Structured metric recorder
export class L0MetricsRecorder {
  private meters: Map<string, Meter> = new Map();
  private counters: Map<string, Counter> = new Map();
  private histograms: Map<string, Histogram> = new Map();
  
  constructor(private meter: Meter) {
    this.initializeMetrics();
  }
  
  private initializeMetrics(): void {
    // Initialize all metrics with proper descriptions and units
    this.counters.set(L0Metrics.REQUESTS_TOTAL, 
      this.meter.createCounter(L0Metrics.REQUESTS_TOTAL, {
        description: "Total number of L0 stream requests",
        unit: "{request}",
      })
    );
    
    this.histograms.set(L0Metrics.REQUEST_DURATION,
      this.meter.createHistogram(L0Metrics.REQUEST_DURATION, {
        description: "Duration of L0 stream requests",
        unit: "ms",
        advice: {
          explicitBucketBoundaries: [10, 50, 100, 250, 500, 1000, 2500, 5000, 10000],
        },
      })
    );
    
    // ... other metrics
  }
  
  // Type-safe metric recording
  recordRequest(attributes: {
    provider: string;
    model?: string;
    status: "success" | "error";
  }): void {
    this.counters.get(L0Metrics.REQUESTS_TOTAL)?.add(1, {
      [L0Attributes.PROVIDER]: attributes.provider,
      [L0Attributes.MODEL]: attributes.model ?? "unknown",
      status: attributes.status,
    });
  }
  
  recordError(error: L0Error): void {
    this.counters.get(L0Metrics.ERRORS_TOTAL)?.add(1, {
      [L0Attributes.ERROR_CODE]: error.code,
      [L0Attributes.ERROR_CATEGORY]: error.category,
      [L0Attributes.ERROR_RECOVERABLE]: String(error.isRecoverable),
    });
  }
  
  recordGuardrailCheck(result: {
    rule: string;
    duration: number;
    passed: boolean;
    severity?: string;
  }): void {
    this.counters.get(L0Metrics.GUARDRAIL_CHECKS_TOTAL)?.add(1, {
      [L0Attributes.GUARDRAIL_RULE]: result.rule,
      passed: String(result.passed),
    });
    
    this.histograms.get(L0Metrics.GUARDRAIL_CHECK_DURATION)?.record(result.duration, {
      [L0Attributes.GUARDRAIL_RULE]: result.rule,
    });
    
    if (!result.passed) {
      this.counters.get(L0Metrics.GUARDRAIL_VIOLATIONS_TOTAL)?.add(1, {
        [L0Attributes.GUARDRAIL_RULE]: result.rule,
        [L0Attributes.GUARDRAIL_SEVERITY]: result.severity ?? "unknown",
      });
    }
  }
}
```

---

## 5. Composable Pipeline Architecture

### Current Problem
All features (guardrails, drift, dedup, retry, fallback) are interleaved in one giant streaming loop, making them:
- Hard to test in isolation
- Hard to enable/disable individually
- Hard to reorder or compose

### Solution: Pipeline Stages

Create `src/runtime/pipeline.ts`:

```typescript
// A pipeline stage processes events and may emit transformed events
export interface PipelineStage<TIn = L0Event, TOut = L0Event> {
  name: string;
  
  // Process an event, may emit 0 or more output events
  process(event: TIn, context: PipelineContext): AsyncGenerator<TOut>;
  
  // Called when stream starts
  onStart?(context: PipelineContext): void | Promise<void>;
  
  // Called when stream ends (even on error)
  onEnd?(context: PipelineContext): void | Promise<void>;
  
  // Called on error (can transform or suppress)
  onError?(error: Error, context: PipelineContext): Error | null;
}

// Shared context passed through pipeline
export interface PipelineContext {
  state: L0State;
  stateMachine: L0StateMachine;
  monitor: L0Monitor;
  signal?: AbortSignal;
  
  // Mutable scratch space for stages
  scratch: Map<string, unknown>;
}

// Built-in stages
export const stages = {
  // Normalizes raw SDK events to L0Events
  normalize: (): PipelineStage => ({ /* ... */ }),
  
  // Handles deduplication for continuation
  deduplicate: (options: DeduplicationOptions): PipelineStage => ({ /* ... */ }),
  
  // Runs guardrails (async)
  guardrails: (engine: AsyncGuardrailEngine): PipelineStage => ({ /* ... */ }),
  
  // Detects drift (async)
  driftDetection: (detector: AsyncDriftDetector): PipelineStage => ({ /* ... */ }),
  
  // Handles timeouts
  timeout: (options: TimeoutOptions): PipelineStage => ({ /* ... */ }),
  
  // Zero-token detection
  zeroToken: (): PipelineStage => ({ /* ... */ }),
  
  // Checkpointing
  checkpoint: (interval: number): PipelineStage => ({ /* ... */ }),
  
  // Metrics collection
  metrics: (recorder: L0MetricsRecorder): PipelineStage => ({ /* ... */ }),
};

// Pipeline builder with type-safe composition
export class PipelineBuilder {
  private stages: PipelineStage[] = [];
  
  add(stage: PipelineStage): this {
    this.stages.push(stage);
    return this;
  }
  
  // Conditional stage addition
  addIf(condition: boolean, stage: PipelineStage): this {
    if (condition) this.stages.push(stage);
    return this;
  }
  
  build(): Pipeline {
    return new Pipeline(this.stages);
  }
}

// Example usage in l0():
const pipeline = new PipelineBuilder()
  .add(stages.normalize())
  .add(stages.timeout(processedTimeout))
  .addIf(shouldDeduplicateContinuation, stages.deduplicate(deduplicationOptions))
  .addIf(guardrailEngine !== null, stages.guardrails(asyncGuardrails))
  .addIf(driftDetector !== null, stages.driftDetection(asyncDrift))
  .add(stages.zeroToken())
  .add(stages.checkpoint(checkpointInterval))
  .add(stages.metrics(metricsRecorder))
  .build();

// Process stream through pipeline
for await (const event of pipeline.process(sourceStream, context)) {
  yield event;
}
```

### Retry/Fallback as Outer Loop

The retry and fallback logic stays as the outer orchestrator:

```typescript
async function* l0Stream(options: L0Options): AsyncGenerator<L0Event> {
  const stateMachine = new L0StateMachine(L0_TRANSITIONS);
  const pipeline = buildPipeline(options);
  
  for (let fallbackIndex = 0; fallbackIndex < allStreams.length; fallbackIndex++) {
    for (let retry = 0; retry <= maxRetries; retry++) {
      stateMachine.transition({ type: "START" });
      
      try {
        const sourceStream = await createStream(allStreams[fallbackIndex]);
        stateMachine.transition({ type: "STREAM_CREATED" });
        
        for await (const event of pipeline.process(sourceStream, context)) {
          yield event;
        }
        
        stateMachine.transition({ type: "COMPLETE" });
        return; // Success
        
      } catch (error) {
        const decision = retryManager.shouldRetry(error);
        if (decision.shouldRetry && retry < maxRetries) {
          stateMachine.transition({ type: "RETRY", attempt: retry + 1 });
          await sleep(decision.delay);
          continue;
        }
        // Fall through to try next fallback
        break;
      }
    }
    
    stateMachine.transition({ type: "FALLBACK", index: fallbackIndex + 1 });
  }
  
  stateMachine.transition({ type: "ERROR", error: exhaustedError });
  throw exhaustedError;
}
```

---

## 6. Fuzz Testing for Deduplication

### Current Problem
Deduplication handles overlap detection but lacks tests for:
- Minimum vs maximum overlap boundaries
- Whitespace normalization edge cases
- Unicode/encoding differences
- Partial token boundaries

### Solution: Property-Based Testing

Create `tests/deduplication.fuzz.test.ts`:

```typescript
import { fc } from "@fast-check/vitest";
import { detectOverlap } from "../src/utils/tokens";

describe("Deduplication Fuzz Tests", () => {
  // Property: deduplication should never lose content
  it("should preserve all unique content", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 1000 }),
        fc.string({ minLength: 1, maxLength: 1000 }),
        (checkpoint, continuation) => {
          const result = detectOverlap(checkpoint, continuation);
          
          // Combined output should contain all unique content
          const combined = checkpoint + result.deduplicatedContinuation;
          
          // If there was overlap, combined should be shorter than naive concat
          if (result.hasOverlap) {
            expect(combined.length).toBeLessThan(checkpoint.length + continuation.length);
          }
          
          // But should never lose the ending
          expect(combined.endsWith(continuation.slice(-Math.min(10, continuation.length)))).toBe(true);
        }
      )
    );
  });
  
  // Property: overlap detection should be deterministic
  it("should be deterministic", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 500 }),
        fc.string({ minLength: 1, maxLength: 500 }),
        (checkpoint, continuation) => {
          const result1 = detectOverlap(checkpoint, continuation);
          const result2 = detectOverlap(checkpoint, continuation);
          
          expect(result1.hasOverlap).toBe(result2.hasOverlap);
          expect(result1.overlapLength).toBe(result2.overlapLength);
          expect(result1.deduplicatedContinuation).toBe(result2.deduplicatedContinuation);
        }
      )
    );
  });
  
  // Property: known overlap should always be detected
  it("should detect intentional overlap", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 5, maxLength: 100 }),
        fc.integer({ min: 2, max: 50 }),
        fc.string({ minLength: 1, maxLength: 100 }),
        (base, overlapLen, suffix) => {
          const actualOverlapLen = Math.min(overlapLen, base.length);
          const overlap = base.slice(-actualOverlapLen);
          const checkpoint = base;
          const continuation = overlap + suffix;
          
          const result = detectOverlap(checkpoint, continuation, {
            minOverlap: 2,
            maxOverlap: 500,
          });
          
          // Should detect the overlap we created
          if (actualOverlapLen >= 2) {
            expect(result.hasOverlap).toBe(true);
            expect(result.overlapLength).toBeGreaterThanOrEqual(actualOverlapLen);
          }
        }
      )
    );
  });
  
  // Edge case: whitespace normalization
  it("should handle whitespace variations when normalized", () => {
    fc.assert(
      fc.property(
        fc.array(fc.string({ minLength: 1, maxLength: 20 }), { minLength: 2, maxLength: 10 }),
        (words) => {
          const checkpoint = words.join(" ");
          const continuation = words.slice(-2).join("  ") + " more"; // Double space
          
          const resultNormalized = detectOverlap(checkpoint, continuation, {
            normalizeWhitespace: true,
          });
          
          const resultExact = detectOverlap(checkpoint, continuation, {
            normalizeWhitespace: false,
          });
          
          // Normalized should find overlap, exact might not
          if (words.length >= 2) {
            expect(resultNormalized.hasOverlap).toBe(true);
          }
        }
      )
    );
  });
  
  // Edge case: Unicode
  it("should handle unicode correctly", () => {
    fc.assert(
      fc.property(
        fc.unicodeString({ minLength: 5, maxLength: 100 }),
        fc.integer({ min: 2, max: 20 }),
        (base, overlapLen) => {
          const actualOverlapLen = Math.min(overlapLen, base.length);
          const overlap = base.slice(-actualOverlapLen);
          const continuation = overlap + "续";
          
          const result = detectOverlap(base, continuation);
          
          // Should not corrupt unicode
          expect(() => {
            const combined = base + result.deduplicatedContinuation;
            // This will throw if we have invalid unicode
            new TextEncoder().encode(combined);
          }).not.toThrow();
        }
      )
    );
  });
  
  // Edge case: boundary conditions
  describe("boundary conditions", () => {
    it("minOverlap boundary", () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 1, max: 10 }),
          (minOverlap) => {
            const checkpoint = "a".repeat(minOverlap);
            const continuation = "a".repeat(minOverlap - 1) + "b";
            
            const result = detectOverlap(checkpoint, continuation, { minOverlap });
            
            // Overlap of exactly minOverlap-1 should not be detected
            if (minOverlap > 1) {
              expect(result.hasOverlap).toBe(false);
            }
          }
        )
      );
    });
    
    it("maxOverlap boundary", () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 10, max: 50 }),
          (maxOverlap) => {
            const checkpoint = "a".repeat(maxOverlap + 10);
            const continuation = "a".repeat(maxOverlap + 5) + "b";
            
            const result = detectOverlap(checkpoint, continuation, { maxOverlap });
            
            // Should cap at maxOverlap
            expect(result.overlapLength).toBeLessThanOrEqual(maxOverlap);
          }
        )
      );
    });
  });
});
```

---

## Implementation Order

1. **Error taxonomy** (1-2 days)
   - Update `src/types/errors.ts` with new types
   - Update `src/utils/errors.ts` with serialization
   - Update existing error creation sites

2. **State machine** (2-3 days)
   - Create `src/runtime/state-machine.ts`
   - Add state machine to l0.ts
   - Map existing conditional logic to transitions
   - Add transition validation

3. **Async checks** (2-3 days)
   - Create `src/runtime/async-checks.ts`
   - Update GuardrailEngine with delta-only fast path
   - Update DriftDetector with delta-only fast path
   - Integrate into streaming loop

4. **Structured metrics** (1-2 days)
   - Update `src/runtime/opentelemetry.ts` with new metric names
   - Create `L0MetricsRecorder` class
   - Update monitoring integration

5. **Pipeline architecture** (3-4 days)
   - Create `src/runtime/pipeline.ts`
   - Extract stages from l0.ts
   - Wire up pipeline in l0()
   - Ensure backward compatibility

6. **Fuzz testing** (1 day)
   - Add fast-check dependency
   - Create fuzz test file
   - Run and fix any discovered bugs

7. **Integration testing** (1-2 days)
   - Update existing tests for new architecture
   - Add state machine transition tests
   - Add pipeline stage unit tests
   - Verify all 1641 tests still pass

---

## Backward Compatibility

All changes maintain backward compatibility:
- `l0()` function signature unchanged
- `L0Options` interface extended, not changed
- `L0Result` interface extended, not changed
- `L0Error` extended with new methods, existing methods unchanged
- Existing tests remain valid

## Migration Path

For users:
1. No required changes - existing code works as-is
2. Optional: Use new error serialization for logging
3. Optional: Subscribe to state machine for debugging
4. Optional: Use pipeline stages for custom processing
5. Optional: Enable async guardrails for better performance
