# Unified Event System Implementation Plan

## Overview

Refactor L0 to use a unified event system where all lifecycle callbacks become wrappers around a single `onEvent(handler)` API. Events will be structured, timestamped, and include metadata for deterministic replay.

---

## Phase 1: Core Event Infrastructure

### 1.1 Add UUID v7 Dependency

**File**: `package.json`

Add `uuidv7` package for time-sortable unique IDs:
```json
"dependencies": {
  "uuidv7": "^1.0.0"
}
```

### 1.2 Create Event Types

**File**: `src/types/observability.ts` (NEW)

```typescript
// 15 Event Categories
export const EventCategory = {
  SESSION: 'SESSION',
  STREAM: 'STREAM',
  ADAPTER: 'ADAPTER',
  TIMEOUT: 'TIMEOUT',
  NETWORK: 'NETWORK',
  ABORT: 'ABORT',
  GUARDRAIL: 'GUARDRAIL',
  DRIFT: 'DRIFT',
  CHECKPOINT: 'CHECKPOINT',
  RETRY: 'RETRY',
  FALLBACK: 'FALLBACK',
  STRUCTURED: 'STRUCTURED',
  CONTINUATION: 'CONTINUATION',
  TOOL: 'TOOL',
  COMPLETION: 'COMPLETION',
} as const;

// All event types organized by category
export const EventType = {
  // Session
  SESSION_START: 'SESSION_START',
  SESSION_END: 'SESSION_END',
  SESSION_SUMMARY: 'SESSION_SUMMARY',
  
  // Stream
  STREAM_INIT: 'STREAM_INIT',
  STREAM_READY: 'STREAM_READY',
  
  // Adapter
  ADAPTER_DETECTED: 'ADAPTER_DETECTED',
  ADAPTER_WRAP_START: 'ADAPTER_WRAP_START',
  ADAPTER_WRAP_END: 'ADAPTER_WRAP_END',
  
  // Timeout
  TIMEOUT_START: 'TIMEOUT_START',
  TIMEOUT_RESET: 'TIMEOUT_RESET',
  TIMEOUT_TRIGGERED: 'TIMEOUT_TRIGGERED',
  
  // Network
  NETWORK_ERROR: 'NETWORK_ERROR',
  NETWORK_RECOVERY: 'NETWORK_RECOVERY',
  CONNECTION_DROPPED: 'CONNECTION_DROPPED',
  CONNECTION_RESTORED: 'CONNECTION_RESTORED',
  
  // Abort
  ABORT_REQUESTED: 'ABORT_REQUESTED',
  ABORT_COMPLETED: 'ABORT_COMPLETED',
  
  // Guardrail
  GUARDRAIL_PHASE_START: 'GUARDRAIL_PHASE_START',
  GUARDRAIL_RULE_START: 'GUARDRAIL_RULE_START',
  GUARDRAIL_RULE_RESULT: 'GUARDRAIL_RULE_RESULT',
  GUARDRAIL_RULE_END: 'GUARDRAIL_RULE_END',
  GUARDRAIL_PHASE_END: 'GUARDRAIL_PHASE_END',
  GUARDRAIL_CALLBACK_START: 'GUARDRAIL_CALLBACK_START',
  GUARDRAIL_CALLBACK_END: 'GUARDRAIL_CALLBACK_END',
  
  // Drift
  DRIFT_CHECK_START: 'DRIFT_CHECK_START',
  DRIFT_CHECK_RESULT: 'DRIFT_CHECK_RESULT',
  DRIFT_CHECK_END: 'DRIFT_CHECK_END',
  DRIFT_CHECK_SKIPPED: 'DRIFT_CHECK_SKIPPED',
  
  // Checkpoint
  CHECKPOINT_START: 'CHECKPOINT_START',
  CHECKPOINT_END: 'CHECKPOINT_END',
  CHECKPOINT_SAVED: 'CHECKPOINT_SAVED',
  CHECKPOINT_RESTORED: 'CHECKPOINT_RESTORED',
  
  // Retry
  RETRY_START: 'RETRY_START',
  RETRY_ATTEMPT: 'RETRY_ATTEMPT',
  RETRY_END: 'RETRY_END',
  RETRY_GIVE_UP: 'RETRY_GIVE_UP',
  
  // Fallback
  FALLBACK_START: 'FALLBACK_START',
  FALLBACK_MODEL_SELECTED: 'FALLBACK_MODEL_SELECTED',
  FALLBACK_END: 'FALLBACK_END',
  
  // Structured Output
  STRUCTURED_PARSE_START: 'STRUCTURED_PARSE_START',
  STRUCTURED_PARSE_END: 'STRUCTURED_PARSE_END',
  STRUCTURED_PARSE_ERROR: 'STRUCTURED_PARSE_ERROR',
  STRUCTURED_VALIDATION_START: 'STRUCTURED_VALIDATION_START',
  STRUCTURED_VALIDATION_END: 'STRUCTURED_VALIDATION_END',
  STRUCTURED_VALIDATION_ERROR: 'STRUCTURED_VALIDATION_ERROR',
  STRUCTURED_AUTO_CORRECT_START: 'STRUCTURED_AUTO_CORRECT_START',
  STRUCTURED_AUTO_CORRECT_END: 'STRUCTURED_AUTO_CORRECT_END',
  
  // Continuation
  CONTINUATION_START: 'CONTINUATION_START',
  CONTINUATION_END: 'CONTINUATION_END',
  CONTINUATION_DEDUPLICATION_START: 'CONTINUATION_DEDUPLICATION_START',
  CONTINUATION_DEDUPLICATION_END: 'CONTINUATION_DEDUPLICATION_END',
  
  // Tool
  TOOL_REQUESTED: 'TOOL_REQUESTED',
  TOOL_START: 'TOOL_START',
  TOOL_RESULT: 'TOOL_RESULT',
  TOOL_ERROR: 'TOOL_ERROR',
  TOOL_COMPLETED: 'TOOL_COMPLETED',
  
  // Completion
  TOKEN: 'TOKEN',
  COMPLETE: 'COMPLETE',
  ERROR: 'ERROR',
} as const;

export type EventType = typeof EventType[keyof typeof EventType];

/**
 * Base event structure - all events include these fields
 */
export interface L0ObservabilityEvent {
  /** Event type identifier */
  type: EventType;
  /** Unix epoch milliseconds */
  ts: number;
  /** UUID v7 stream identifier */
  streamId: string;
  /** User-provided metadata (immutable for session) */
  meta: Record<string, unknown>;
}

/**
 * Event handler type
 */
export type L0EventHandler = (event: L0ObservabilityEvent) => void;
```

### 1.3 Create Event Dispatcher

**File**: `src/runtime/event-dispatcher.ts` (NEW)

```typescript
import { uuidv7 } from 'uuidv7';
import type { L0ObservabilityEvent, L0EventHandler, EventType } from '../types/observability';

export class EventDispatcher {
  private handlers: L0EventHandler[] = [];
  private readonly streamId: string;
  private readonly meta: Record<string, unknown>;

  constructor(meta: Record<string, unknown> = {}) {
    this.streamId = uuidv7();
    this.meta = Object.freeze({ ...meta }); // Immutable
  }

  /**
   * Register an event handler
   */
  onEvent(handler: L0EventHandler): void {
    this.handlers.push(handler);
  }

  /**
   * Emit an event to all handlers
   * - Adds ts, streamId, meta automatically
   * - Calls handlers via microtasks (fire-and-forget)
   * - Never throws from handler failures
   */
  emit<T extends Partial<L0ObservabilityEvent>>(
    type: EventType,
    payload?: Omit<T, 'type' | 'ts' | 'streamId' | 'meta'>
  ): void {
    const event: L0ObservabilityEvent = {
      type,
      ts: Date.now(),
      streamId: this.streamId,
      meta: this.meta,
      ...payload,
    };

    // Fire handlers asynchronously via microtasks
    for (const handler of this.handlers) {
      queueMicrotask(() => {
        try {
          handler(event);
        } catch {
          // Silently ignore handler errors
        }
      });
    }
  }

  /**
   * Get the stream ID for this session
   */
  getStreamId(): string {
    return this.streamId;
  }
}
```

---

## Phase 2: Callback Wrappers (Sugar API)

### 2.1 Update L0Options

**File**: `src/types/l0.ts`

Add unified `onEvent` and keep legacy callbacks as optional sugar:

```typescript
export interface L0Options<TOutput = unknown> {
  // ... existing options ...
  
  /** User metadata attached to all events */
  meta?: Record<string, unknown>;
  
  /** Unified event handler - receives ALL events */
  onEvent?: L0EventHandler;
  
  // Legacy callbacks (implemented as onEvent wrappers)
  // These are optional convenience methods
  onStart?: (event: SessionStartEvent) => void;
  onToken?: (event: TokenEvent) => void;
  onComplete?: (event: CompleteEvent) => void;
  onError?: (event: ErrorEvent) => void;
  onViolation?: (event: GuardrailRuleResultEvent) => void;
  onRetry?: (event: RetryAttemptEvent) => void;
  onFallback?: (event: FallbackStartEvent) => void;
  onResume?: (event: CheckpointRestoredEvent) => void;
  onGuardrail?: (event: GuardrailRuleResultEvent) => void;
  onGuardrailEnd?: (event: GuardrailPhaseEndEvent) => void;
  onDriftCheckStart?: (event: DriftCheckStartEvent) => void;
  onDriftCheckEnd?: (event: DriftCheckEndEvent) => void;
  onCheckpoint?: (event: CheckpointSavedEvent) => void;
  onRetryStart?: (event: RetryStartEvent) => void;
  onRetryEnd?: (event: RetryEndEvent) => void;
  onFallbackStart?: (event: FallbackStartEvent) => void;
}
```

### 2.2 Create Callback Wrapper Factory

**File**: `src/runtime/callback-wrappers.ts` (NEW)

```typescript
import type { L0Options } from '../types/l0';
import type { EventDispatcher } from './event-dispatcher';
import { EventType } from '../types/observability';

/**
 * Register legacy callbacks as onEvent wrappers
 */
export function registerCallbackWrappers(
  dispatcher: EventDispatcher,
  options: L0Options
): void {
  // Main onEvent handler
  if (options.onEvent) {
    dispatcher.onEvent(options.onEvent);
  }

  // Sugar wrappers - filter events by type
  if (options.onStart) {
    dispatcher.onEvent((event) => {
      if (event.type === EventType.SESSION_START) {
        options.onStart!(event as any);
      }
    });
  }

  if (options.onToken) {
    dispatcher.onEvent((event) => {
      if (event.type === EventType.TOKEN) {
        options.onToken!(event as any);
      }
    });
  }

  if (options.onComplete) {
    dispatcher.onEvent((event) => {
      if (event.type === EventType.COMPLETE) {
        options.onComplete!(event as any);
      }
    });
  }

  if (options.onError) {
    dispatcher.onEvent((event) => {
      if (event.type === EventType.ERROR) {
        options.onError!(event as any);
      }
    });
  }

  if (options.onViolation || options.onGuardrail) {
    dispatcher.onEvent((event) => {
      if (event.type === EventType.GUARDRAIL_RULE_RESULT) {
        options.onViolation?.(event as any);
        options.onGuardrail?.(event as any);
      }
    });
  }

  if (options.onGuardrailEnd) {
    dispatcher.onEvent((event) => {
      if (event.type === EventType.GUARDRAIL_PHASE_END) {
        options.onGuardrailEnd!(event as any);
      }
    });
  }

  if (options.onRetry) {
    dispatcher.onEvent((event) => {
      if (event.type === EventType.RETRY_ATTEMPT) {
        options.onRetry!(event as any);
      }
    });
  }

  if (options.onRetryStart) {
    dispatcher.onEvent((event) => {
      if (event.type === EventType.RETRY_START) {
        options.onRetryStart!(event as any);
      }
    });
  }

  if (options.onRetryEnd) {
    dispatcher.onEvent((event) => {
      if (event.type === EventType.RETRY_END) {
        options.onRetryEnd!(event as any);
      }
    });
  }

  if (options.onFallback || options.onFallbackStart) {
    dispatcher.onEvent((event) => {
      if (event.type === EventType.FALLBACK_START) {
        options.onFallback?.(event as any);
        options.onFallbackStart?.(event as any);
      }
    });
  }

  if (options.onResume) {
    dispatcher.onEvent((event) => {
      if (event.type === EventType.CHECKPOINT_RESTORED) {
        options.onResume!(event as any);
      }
    });
  }

  if (options.onDriftCheckStart) {
    dispatcher.onEvent((event) => {
      if (event.type === EventType.DRIFT_CHECK_START) {
        options.onDriftCheckStart!(event as any);
      }
    });
  }

  if (options.onDriftCheckEnd) {
    dispatcher.onEvent((event) => {
      if (event.type === EventType.DRIFT_CHECK_END) {
        options.onDriftCheckEnd!(event as any);
      }
    });
  }

  if (options.onCheckpoint) {
    dispatcher.onEvent((event) => {
      if (event.type === EventType.CHECKPOINT_SAVED) {
        options.onCheckpoint!(event as any);
      }
    });
  }
}
```

---

## Phase 3: Refactor l0.ts to Use Event Dispatcher

### 3.1 Initialize Dispatcher

**File**: `src/runtime/l0.ts`

At the start of `l0()` function:

```typescript
import { EventDispatcher } from './event-dispatcher';
import { registerCallbackWrappers } from './callback-wrappers';
import { EventType } from '../types/observability';

async function l0<TOutput = unknown>(options: L0Options<TOutput>): Promise<L0Result<TOutput>> {
  // Initialize event dispatcher with user meta
  const dispatcher = new EventDispatcher(options.meta ?? {});
  
  // Register legacy callback wrappers
  registerCallbackWrappers(dispatcher, options);
  
  // Emit session start
  dispatcher.emit(EventType.SESSION_START, {
    options: serializeOptions(options),
  });
  
  // ... rest of function
}
```

### 3.2 Replace Direct Callback Calls

Replace all `safeInvokeCallback` calls and direct callback invocations with `dispatcher.emit()`:

| Current Code | New Code |
|--------------|----------|
| `processedOnStart?.(attempt, isRetry, isFallback)` | `dispatcher.emit(EventType.SESSION_START, { attempt, isRetry, isFallback })` |
| `processedOnEvent?.(tokenEvent)` | `dispatcher.emit(EventType.TOKEN, { value: token, index: tokenCount })` |
| `processedOnComplete?.(state)` | `dispatcher.emit(EventType.COMPLETE, { state })` |
| `processedOnError?.(err, willRetry, willFallback)` | `dispatcher.emit(EventType.ERROR, { error: err, willRetry, willFallback })` |
| `processedOnViolation?.(violation)` | `dispatcher.emit(EventType.GUARDRAIL_RULE_RESULT, { violation })` |
| `processedOnRetry?.(attempt, reason)` | `dispatcher.emit(EventType.RETRY_ATTEMPT, { attempt, reason })` |
| `processedOnFallback?.(index, reason)` | `dispatcher.emit(EventType.FALLBACK_START, { index, reason })` |
| `processedOnResume?.(checkpoint, tokenCount)` | `dispatcher.emit(EventType.CHECKPOINT_RESTORED, { checkpoint, tokenCount })` |

### 3.3 Add New Lifecycle Events

Add emissions at key points in l0.ts:

```typescript
// Stream initialization
dispatcher.emit(EventType.STREAM_INIT);

// Adapter detection
dispatcher.emit(EventType.ADAPTER_DETECTED, { adapterName: adapter.name });

// Timeout events
dispatcher.emit(EventType.TIMEOUT_START, { type: 'initial', timeoutMs: initialTimeout });
dispatcher.emit(EventType.TIMEOUT_RESET);
dispatcher.emit(EventType.TIMEOUT_TRIGGERED, { type: 'initial' | 'inter' });

// Network events
dispatcher.emit(EventType.NETWORK_ERROR, { error, category });
dispatcher.emit(EventType.NETWORK_RECOVERY, { attempt, delay });

// Guardrail phase events
dispatcher.emit(EventType.GUARDRAIL_PHASE_START, { ruleCount });
dispatcher.emit(EventType.GUARDRAIL_RULE_START, { index, ruleId });
dispatcher.emit(EventType.GUARDRAIL_RULE_RESULT, { index, ruleId, result, rule });
dispatcher.emit(EventType.GUARDRAIL_RULE_END, { index, ruleId, durationMs });
dispatcher.emit(EventType.GUARDRAIL_PHASE_END, { totalDurationMs, violations });

// Drift events
dispatcher.emit(EventType.DRIFT_CHECK_START, { tokenCount });
dispatcher.emit(EventType.DRIFT_CHECK_RESULT, { detected, types });
dispatcher.emit(EventType.DRIFT_CHECK_END, { durationMs });

// Checkpoint events
dispatcher.emit(EventType.CHECKPOINT_START);
dispatcher.emit(EventType.CHECKPOINT_SAVED, { checkpoint, tokenCount });
dispatcher.emit(EventType.CHECKPOINT_RESTORED, { checkpoint, tokenCount });

// Retry events
dispatcher.emit(EventType.RETRY_START, { maxAttempts });
dispatcher.emit(EventType.RETRY_ATTEMPT, { attempt, reason, delay });
dispatcher.emit(EventType.RETRY_END, { totalAttempts, success });
dispatcher.emit(EventType.RETRY_GIVE_UP, { reason, lastError });

// Fallback events
dispatcher.emit(EventType.FALLBACK_START, { fromIndex, toIndex, reason });
dispatcher.emit(EventType.FALLBACK_MODEL_SELECTED, { index, model });
dispatcher.emit(EventType.FALLBACK_END, { finalIndex, success });

// Session end
dispatcher.emit(EventType.SESSION_END, { durationMs, success });
```

### 3.4 Implement Abort Events

**File**: `src/runtime/l0.ts`

Update abort handling:

```typescript
const abortController = new AbortController();

// Track if abort was requested
let abortRequested = false;

const abort = () => {
  if (!abortRequested) {
    abortRequested = true;
    dispatcher.emit(EventType.ABORT_REQUESTED);
    abortController.abort();
  }
};

// In stream generator, when abort is detected:
if (signal?.aborted) {
  dispatcher.emit(EventType.ABORT_COMPLETED);
  throw new L0Error("Stream aborted by signal", { code: "ABORTED" });
}
```

---

## Phase 4: Tool Event Integration

### 4.1 Define Tool Event Types

**File**: `src/types/observability.ts`

```typescript
export interface ToolRequestedEvent extends L0ObservabilityEvent {
  type: 'TOOL_REQUESTED';
  toolName: string;
  arguments: Record<string, unknown>;
  toolCallId: string;
}

export interface ToolStartEvent extends L0ObservabilityEvent {
  type: 'TOOL_START';
  toolCallId: string;
  toolName: string;
}

export interface ToolResultEvent extends L0ObservabilityEvent {
  type: 'TOOL_RESULT';
  toolCallId: string;
  result: unknown;
  durationMs: number;
}

export interface ToolErrorEvent extends L0ObservabilityEvent {
  type: 'TOOL_ERROR';
  toolCallId: string;
  error: Error;
  errorType: 'NOT_FOUND' | 'TIMEOUT' | 'EXECUTION_ERROR' | 'VALIDATION_ERROR';
  durationMs: number;
}

export interface ToolCompletedEvent extends L0ObservabilityEvent {
  type: 'TOOL_COMPLETED';
  toolCallId: string;
  status: 'success' | 'error';
}
```

### 4.2 Emit Tool Events

Tool events are emitted when processing tool calls from the stream:

```typescript
// When model requests tool
dispatcher.emit(EventType.TOOL_REQUESTED, {
  toolName: toolCall.name,
  arguments: toolCall.arguments,
  toolCallId: toolCall.id,
});

// When L1 starts executing
dispatcher.emit(EventType.TOOL_START, {
  toolCallId: toolCall.id,
  toolName: toolCall.name,
});

// On success
dispatcher.emit(EventType.TOOL_RESULT, {
  toolCallId: toolCall.id,
  result: toolResult,
  durationMs: elapsed,
});

// On error (including tool not found)
dispatcher.emit(EventType.TOOL_ERROR, {
  toolCallId: toolCall.id,
  error: err,
  errorType: getToolErrorType(err), // 'NOT_FOUND' | 'TIMEOUT' | etc.
  durationMs: elapsed,
});

// Always at end
dispatcher.emit(EventType.TOOL_COMPLETED, {
  toolCallId: toolCall.id,
  status: success ? 'success' : 'error',
});
```

---

## Phase 5: Delete Prometheus

### 5.1 Files to Delete
- `src/runtime/prometheus.ts` ✅ (already deleted)
- `integration/prometheus.integration.ts` ✅ (already deleted)

### 5.2 Files to Update
- `vitest.config.ts` ✅ (already updated)
- All monitoring references ✅ (already updated)

---

## Phase 6: Ensure Replay Compatibility

### 6.1 Event Serialization

All events must be JSON-serializable for replay:

```typescript
export function serializeEvent(event: L0ObservabilityEvent): string {
  return JSON.stringify(event, (key, value) => {
    if (value instanceof Error) {
      return {
        __type: 'Error',
        name: value.name,
        message: value.message,
        stack: value.stack,
      };
    }
    return value;
  });
}

export function deserializeEvent(json: string): L0ObservabilityEvent {
  return JSON.parse(json, (key, value) => {
    if (value?.__type === 'Error') {
      const err = new Error(value.message);
      err.name = value.name;
      err.stack = value.stack;
      return err;
    }
    return value;
  });
}
```

### 6.2 Replay Guarantee

Events must be standalone - no implicit state:

```typescript
// BAD: Relies on counter not in event
let tokenIndex = 0;
dispatcher.emit(EventType.TOKEN, { value: token }); // Missing index!

// GOOD: All state in event
dispatcher.emit(EventType.TOKEN, { value: token, index: tokenIndex++ });
```

---

## Phase 7: Update Exports

### 7.1 Main Index

**File**: `src/index.ts`

```typescript
// Event System
export { EventDispatcher } from './runtime/event-dispatcher';
export { EventType, EventCategory } from './types/observability';
export type { 
  L0ObservabilityEvent,
  L0EventHandler,
  TokenEvent,
  // ... all event types
} from './types/observability';
```

---

## Implementation Order

1. **Phase 1**: Core infrastructure (types, dispatcher) - No breaking changes
2. **Phase 2**: Callback wrappers - Backwards compatible  
3. **Phase 3**: Refactor l0.ts - Replace internals, maintain API
4. **Phase 4**: Tool events - New functionality
5. **Phase 5**: Prometheus cleanup - ✅ Already done
6. **Phase 6**: Replay compatibility - Testing/validation
7. **Phase 7**: Exports - Public API

---

## Files Changed Summary

| File | Action |
|------|--------|
| `package.json` | Add `uuidv7` dependency |
| `src/types/observability.ts` | NEW - Event types |
| `src/runtime/event-dispatcher.ts` | NEW - Dispatcher class |
| `src/runtime/callback-wrappers.ts` | NEW - Sugar API |
| `src/types/l0.ts` | Update L0Options |
| `src/runtime/l0.ts` | Major refactor |
| `src/runtime/callbacks.ts` | May be deprecated |
| `src/index.ts` | Add exports |

---

## Testing Strategy

1. **Unit tests** for EventDispatcher
2. **Unit tests** for callback wrappers
3. **Integration tests** for full event flow
4. **Replay tests** - record and replay sessions
5. **Migration tests** - legacy callbacks still work

---

## Migration Notes

- All existing callbacks (`onStart`, `onToken`, etc.) continue to work
- New `onEvent` handler receives ALL events
- Legacy callbacks are sugar - they filter `onEvent`
- Breaking change: Event payloads have new structure (include `ts`, `streamId`, `meta`)
