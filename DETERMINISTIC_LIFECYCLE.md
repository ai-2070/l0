# L0 Deterministic Lifecycle Specification

This document specifies the **deterministic lifecycle behavior** of the L0 runtime. It serves as a reference for porting L0 to other languages (e.g., Python) and ensures consistent behavior across implementations.

## Deterministic Lifecycle Flow

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                            L0 LIFECYCLE FLOW                                │
└─────────────────────────────────────────────────────────────────────────────┘

                                ┌──────────┐
                                │  START   │
                                └────┬─────┘
                                     │
                                     ▼
                      ┌──────────────────────────────┐
                      │ onStart(attempt, false, false) │
                      └──────────────┬───────────────┘
                                     │
                                     ▼
┌────────────────────────────────────────────────────────────────────────────┐
│                              STREAMING PHASE                               │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                         onEvent(event)                              │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                            │
│  During streaming, these callbacks fire as conditions occur:               │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐   │
│  │ onCheckpoint │  │  onToolCall  │  │   onDrift    │  │  onTimeout   │   │
│  │ (checkpoint, │  │ (toolName,   │  │ (types,      │  │ (type,       │   │
│  │  tokenCount) │  │  id, args)   │  │  confidence) │  │  elapsedMs)  │   │
│  └──────────────┘  └──────────────┘  └──────┬───────┘  └──────┬───────┘   │
│                                             │                  │           │
│                                             └────────┬─────────┘           │
│                                                      │ triggers retry      │
└──────────────────────────────────────────────────────┼─────────────────────┘
                                                       │
              ┌────────────────────────────────────────┼────────────────┐
              │                    │                   │                │
              ▼                    ▼                   ▼                ▼
        ┌─────────┐          ┌───────────┐      ┌──────────┐      ┌─────────┐
        │ SUCCESS │          │   ERROR   │      │VIOLATION │      │  ABORT  │
        └────┬────┘          └─────┬─────┘      └────┬─────┘      └────┬────┘
             │                     │                 │                 │
             │                     │                 ▼                 ▼
             │                     │          ┌─────────────┐   ┌───────────┐
             │                     │          │ onViolation │   │  onAbort  │
             │                     │          └──────┬──────┘   │(tokenCount│
             │                     │                 │          │ contentLen)│
             │                     ▼                 ▼          └───────────┘
             │              ┌────────────────────────────────┐
             │              │ onError(error, willRetry,      │
             │              │         willFallback)          │
             │              └──────────────┬─────────────────┘
             │                             │
             │                 ┌───────────┼───────────┐
             │                 │           │           │
             │                 ▼           ▼           ▼
             │           ┌──────────┐ ┌──────────┐ ┌──────────┐
             │           │  RETRY   │ │ FALLBACK │ │  FATAL   │
             │           └────┬─────┘ └────┬─────┘ └────┬─────┘
             │                │            │            │
             │                ▼            ▼            │
             │          ┌───────────┐ ┌───────────┐     │
             │          │ onRetry() │ │onFallback │     │
             │          └─────┬─────┘ └─────┬─────┘     │
             │                │             │           │
             │                │    ┌────────┘           │
             │                │    │                    │
             │                ▼    ▼                    │
             │          ┌─────────────────────┐         │
             │          │  Has checkpoint?    │         │
             │          └──────────┬──────────┘         │
             │                YES  │  NO                │
             │                ┌────┴────┐               │
             │                ▼         ▼               │
             │          ┌──────────┐    │               │
             │          │ onResume │    │               │
             │          └────┬─────┘    │               │
             │               │          │               │
             │               ▼          ▼               │
             │          ┌─────────────────────────┐     │
             │          │onStart(attempt, isRetry,│     │
             │          │        isFallback)      │─────┼──► Back to STREAMING
             │          └─────────────────────────┘     │
             │                                          │
             ▼                                          ▼
      ┌─────────────┐                            ┌──────────┐
      │ onComplete  │                            │  THROW   │
      │   (state)   │                            │  ERROR   │
      └─────────────┘                            └──────────┘
```

## Event Ordering Specifications

**Important:** 
- `SESSION_START` is emitted exactly ONCE at the beginning of the session (anchor for entire session).
- `ATTEMPT_START` is emitted for each retry attempt.
- `FALLBACK_START` is emitted when switching to a fallback stream.
- The `onStart` callback fires for `SESSION_START` (initial), `ATTEMPT_START` (retries), and `FALLBACK_START` (fallbacks).

### Normal Successful Flow

```
1. SESSION_START (attempt=1, isRetry=false, isFallback=false) → onStart(1, false, false)
2. [tokens stream...]
3. CHECKPOINT_SAVED (if continuation enabled, every N tokens)
4. COMPLETE (with full L0State)
```

### Retry Flow (guardrail violation, drift, network error)

```
1. SESSION_START (attempt=1, isRetry=false, isFallback=false) → onStart(1, false, false)
2. [tokens stream...]
3. ERROR (with recoveryStrategy="retry")
4. RETRY_ATTEMPT (attempt=N, reason)
5. ATTEMPT_START (attempt=2, isRetry=true, isFallback=false) → onStart(2, true, false)
6. [tokens stream...]
7. COMPLETE
```

### Fallback Flow (retries exhausted)

```
1. SESSION_START (attempt=1, isRetry=false, isFallback=false) → onStart(1, false, false)
2. [error occurs, retries exhausted]
3. ERROR (with recoveryStrategy="fallback")
4. FALLBACK_START (fromIndex=0, toIndex=1) → onStart(1, false, true)
5. [tokens stream...]
6. COMPLETE
```

### Continuation/Resume Flow

```
1. SESSION_START (attempt=1) → onStart(1, false, false)
2. [tokens stream...]
3. CHECKPOINT_SAVED
4. [error occurs]
5. ERROR (with recoveryStrategy="retry" or "fallback")
6. RETRY_ATTEMPT + ATTEMPT_START → onStart(N, true, false)
   or FALLBACK_START → onStart(1, false, true)
7. RESUME_START (checkpoint content, tokenCount)
8. [continuation tokens...]
9. COMPLETE
```

### Abort Flow

```
1. SESSION_START
2. [tokens stream...]
3. [abort() called]
4. ABORT_COMPLETED (tokenCount, contentLength)
5. [throws L0Error with code STREAM_ABORTED]
```

### Timeout Flow

```
1. SESSION_START
2. [waiting for token...]
3. TIMEOUT_TRIGGERED (timeoutType="initial" or "inter", elapsedMs)
4. ERROR
5. [retry or fallback...]
```

## Callback Signatures

| Callback       | Signature                                                          | When Called                            |
| -------------- | ------------------------------------------------------------------ | -------------------------------------- |
| `onStart`      | `(attempt: number, isRetry: boolean, isFallback: boolean) => void` | New execution attempt begins           |
| `onComplete`   | `(state: L0State) => void`                                         | Stream finished successfully           |
| `onError`      | `(error: Error, willRetry: boolean, willFallback: boolean) => void`| Error occurred (before retry decision) |
| `onEvent`      | `(event: L0Event) => void`                                         | Any streaming event emitted            |
| `onViolation`  | `(violation: GuardrailViolation) => void`                          | Guardrail violation detected           |
| `onRetry`      | `(attempt: number, reason: string) => void`                        | Retry triggered (same model)           |
| `onFallback`   | `(index: number, reason: string) => void`                          | Switching to fallback model            |
| `onResume`     | `(checkpoint: string, tokenCount: number) => void`                 | Continuing from checkpoint             |
| `onCheckpoint` | `(checkpoint: string, tokenCount: number) => void`                 | Checkpoint saved                       |
| `onTimeout`    | `(type: "initial" \| "inter", elapsedMs: number) => void`          | Timeout occurred                       |
| `onAbort`      | `(tokenCount: number, contentLength: number) => void`              | Stream was aborted                     |
| `onDrift`      | `(types: DriftType[], confidence: number) => void`                 | Semantic drift detected                |
| `onToolCall`   | `(toolName: string, id: string, args: unknown) => void`            | Tool call detected in stream           |

## Parameter Indexing

### 1-Based Parameters (Human-Friendly)

These parameters use 1-based indexing for human readability:

- **`onStart` → `attempt`**: First attempt is `1`, second is `2`, etc.
- **`onRetry` → `attempt`**: The retry attempt number (1-based)

### 0-Based Parameters (Programmer-Friendly)

These parameters use 0-based indexing for array/iteration compatibility:

- **`onFallback` → `index`**: First fallback is `0`, second is `1`, etc.
- **`shouldRetry` → `attempt`**: Current attempt (0-based) for retry veto decisions
- **`calculateDelay` context → `attempt`**: Used for delay calculations

## Observability Events

The following `EventType` values are emitted during the lifecycle:

| Event Type              | Description                              |
| ----------------------- | ---------------------------------------- |
| `SESSION_START`         | Session started (once per session)       |
| `ATTEMPT_START`         | New attempt started (retry)              |
| `COMPLETE`              | Stream completed successfully            |
| `ERROR`                 | Error occurred                           |
| `RETRY_ATTEMPT`         | Retry is being attempted                 |
| `FALLBACK_START`        | Switching to fallback stream             |
| `RESUME_START`          | Resuming from checkpoint                 |
| `CHECKPOINT_SAVED`      | Checkpoint was saved                     |
| `ABORT_COMPLETED`       | Stream was aborted                       |
| `TIMEOUT_TRIGGERED`     | Timeout occurred                         |
| `GUARDRAIL_RULE_RESULT` | Guardrail check completed                |

## Implementation Notes

### Event Dispatcher

All lifecycle events are emitted through a centralized `EventDispatcher`. The dispatcher:
- Assigns monotonically increasing timestamps to all events
- Attaches a consistent `streamId` across all events in a session
- Includes user-provided `meta` object in all observability events

### Callback Wrappers

Legacy callbacks (e.g., `onStart`, `onRetry`) are mapped to observability events via callback wrappers in `src/runtime/callback-wrappers.ts`. This ensures:
- Callbacks fire at the correct time relative to events
- Parameter transformations are applied (e.g., `toIndex - 1` for 0-based fallback index)
- `onStart` fires for `SESSION_START` (initial), `ATTEMPT_START` (retries), and `FALLBACK_START` (fallbacks)

### State Machine

The runtime uses a state machine with these states:
- `INIT` → `STREAMING` → `COMPLETE`
- `STREAMING` → `RETRYING` → `STREAMING`
- `STREAMING` → `FALLBACK` → `STREAMING`
- `STREAMING` → `ERROR` (terminal)

### Test Coverage

Comprehensive lifecycle tests are in `tests/lifecycle.test.ts` with 44 passing tests covering:
- Normal successful flow (6 tests)
- Retry flow (5 tests)
- Fallback flow (5 tests)
- Error flow (6 tests)
- Checkpoint and continuation flow (8 tests)
- Abort flow (4 tests)
- Timeout flow (1 test + 3 skipped for timing sensitivity)
- Guardrail violation flow (3 tests)
- Combined complex flows (3 tests)
- Event timestamp ordering (3 tests)
