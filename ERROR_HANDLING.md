# Error Handling Guide

This guide covers error handling patterns and error codes in L0.

## Table of Contents

- [Error Types](#error-types)
- [L0Error Class](#l0error-class)
- [Error Codes](#error-codes)
- [Error Categories](#error-categories)
- [Network Error Detection](#network-error-detection)
- [Recovery Patterns](#recovery-patterns)
- [Best Practices](#best-practices)

---

## Error Types

L0 distinguishes between different error types for appropriate handling:

### L0 Errors

Errors thrown by L0 itself, with rich context for debugging and recovery:

```typescript
import { isL0Error, L0Error } from "@ai2070/l0";

try {
  await l0({ stream, guardrails });
} catch (error) {
  if (isL0Error(error)) {
    // L0-specific error with context
    console.log(error.code);
    console.log(error.context);
    console.log(error.isRecoverable());
  }
}
```

### Network Errors

Transient failures from network issues:

```typescript
import { isNetworkError, analyzeNetworkError } from "@ai2070/l0";

try {
  await l0({ stream });
} catch (error) {
  if (isNetworkError(error)) {
    const analysis = analyzeNetworkError(error);
    console.log(analysis.type); // NetworkErrorType
    console.log(analysis.retryable); // boolean
    console.log(analysis.suggestion); // string
  }
}
```

### Standard Errors

Regular JavaScript errors from invalid configuration or usage:

```typescript
try {
  await l0({ stream: null }); // Invalid
} catch (error) {
  // Standard Error
  console.log(error.message);
}
```

---

## L0Error Class

The `L0Error` class provides structured error information:

```typescript
class L0Error extends Error {
  readonly code: L0ErrorCode;
  readonly context: L0ErrorContext;
  readonly timestamp: number;

  isRecoverable(): boolean;
  getCheckpoint(): string | undefined;
  toDetailedString(): string;
}
```

### L0ErrorContext

```typescript
interface L0ErrorContext {
  code: L0ErrorCode;
  checkpoint?: string; // Last good content
  tokenCount?: number; // Tokens before failure
  contentLength?: number; // Content length before failure
  retryAttempts?: number; // Retry attempts made
  networkRetries?: number; // Network retries made
  fallbackIndex?: number; // Which fallback was tried
  recoverable?: boolean; // Can be retried
  metadata?: Record<string, unknown>;
}
```

### Usage Example

```typescript
import { isL0Error } from "@ai2070/l0";

try {
  const result = await l0({
    stream: () => streamText({ model, prompt }),
    guardrails: strictGuardrails,
  });
} catch (error) {
  if (isL0Error(error)) {
    // Log detailed error info
    console.error(error.toDetailedString());

    // Check if recovery is possible
    if (error.isRecoverable()) {
      const checkpoint = error.getCheckpoint();
      // Retry with checkpoint context
    }

    // Access specific context
    console.log(`Failed after ${error.context.tokenCount} tokens`);
    console.log(`Retry attempts: ${error.context.retryAttempts}`);
  }
}
```

---

## Error Codes

L0 uses specific error codes for programmatic handling:

| Code                        | Description                                       | Recoverable |
| --------------------------- | ------------------------------------------------- | ----------- |
| `STREAM_ABORTED`            | Stream was aborted (user cancellation or timeout) | Sometimes   |
| `INITIAL_TOKEN_TIMEOUT`     | First token didn't arrive in time                 | Yes         |
| `INTER_TOKEN_TIMEOUT`       | Gap between tokens exceeded limit                 | Yes         |
| `ZERO_OUTPUT`               | Stream produced no meaningful output              | Yes         |
| `GUARDRAIL_VIOLATION`       | Content violated a guardrail rule                 | Yes         |
| `FATAL_GUARDRAIL_VIOLATION` | Content violated a fatal guardrail                | No          |
| `INVALID_STREAM`            | Stream factory returned invalid stream            | No          |
| `ALL_STREAMS_EXHAUSTED`     | All streams (primary + fallbacks) failed          | No          |
| `NETWORK_ERROR`             | Network-level failure                             | Yes         |
| `DRIFT_DETECTED`            | Output drifted from expected behavior             | Yes         |

### Handling Specific Codes

```typescript
import { isL0Error } from "@ai2070/l0";

try {
  await l0({ stream, guardrails });
} catch (error) {
  if (!isL0Error(error)) throw error;

  switch (error.code) {
    case "ZERO_OUTPUT":
      // Model produced nothing - maybe adjust prompt
      console.log("Empty response, adjusting prompt...");
      break;

    case "GUARDRAIL_VIOLATION":
      // Content failed validation - log for review
      console.log("Content violated:", error.context.metadata);
      break;

    case "INITIAL_TOKEN_TIMEOUT":
      // First token slow - network or model overloaded
      console.log("Model slow to respond");
      break;

    case "ALL_STREAMS_EXHAUSTED":
      // All models failed - critical failure
      console.error("All models unavailable");
      break;

    default:
      throw error;
  }
}
```

---

## Error Categories

L0's retry system categorizes errors for appropriate handling:

```typescript
import { ErrorCategory, getErrorCategory } from "@ai2070/l0";

const category = getErrorCategory(error);

switch (category) {
  case ErrorCategory.NETWORK:
    // Retry forever with backoff, doesn't count toward limit
    break;

  case ErrorCategory.TRANSIENT:
    // Rate limits, server errors - retry forever
    break;

  case ErrorCategory.MODEL:
    // Model-caused errors - counts toward retry limit
    break;

  case ErrorCategory.FATAL:
    // Don't retry (auth errors, invalid requests)
    break;
}
```

### Category Breakdown

**NETWORK (retry forever, no count)**

- Connection dropped
- fetch() TypeError
- ECONNRESET / ECONNREFUSED
- SSE aborted
- DNS errors

**TRANSIENT (retry forever, no count)**

- 429 rate limit
- 503 server overload
- Timeouts

**MODEL (retry with limit)**

- Guardrail violations
- Malformed output
- Drift detected
- Incomplete structure

**FATAL (no retry)**

- 401/403 auth errors
- Invalid request
- SSL errors
- Fatal guardrail violations

---

## Network Error Detection

L0 provides detailed network error analysis:

```typescript
import {
  isNetworkError,
  analyzeNetworkError,
  NetworkErrorType,
} from "@ai2070/l0";

if (isNetworkError(error)) {
  const analysis = analyzeNetworkError(error);

  console.log(analysis.type); // NetworkErrorType enum
  console.log(analysis.retryable); // boolean
  console.log(analysis.suggestion); // Human-readable suggestion
}
```

### Network Error Types

| Type                  | Description                        | Retryable |
| --------------------- | ---------------------------------- | --------- |
| `CONNECTION_DROPPED`  | Connection closed unexpectedly     | Yes       |
| `FETCH_ERROR`         | fetch() failed                     | Yes       |
| `ECONNRESET`          | Connection reset by peer           | Yes       |
| `ECONNREFUSED`        | Connection refused                 | Yes       |
| `SSE_ABORTED`         | Server-sent events aborted         | Yes       |
| `NO_BYTES`            | No data received                   | Yes       |
| `PARTIAL_CHUNKS`      | Incomplete data received           | Yes       |
| `RUNTIME_KILLED`      | Runtime terminated (Lambda/Vercel) | Yes       |
| `BACKGROUND_THROTTLE` | Mobile tab backgrounded            | Yes       |
| `DNS_ERROR`           | DNS resolution failed              | Yes       |
| `SSL_ERROR`           | SSL/TLS error                      | No        |
| `TIMEOUT`             | Request timed out                  | Yes       |
| `UNKNOWN`             | Unknown network error              | Yes       |

### Custom Delay by Error Type

```typescript
import { RETRY_DEFAULTS, ERROR_TYPE_DELAY_DEFAULTS } from "@ai2070/l0";

const result = await l0({
  stream: () => streamText({ model, prompt }),
  retry: {
    ...RETRY_DEFAULTS,
    errorTypeDelays: {
      connectionDropped: 2000, // Wait longer for connection issues
      timeout: 500, // Retry faster on timeouts
      dnsError: 5000, // DNS needs more time
    },
  },
});
```

---

## Recovery Patterns

### Checkpoint Recovery

Use checkpoints to resume from last good state:

```typescript
let checkpoint = "";

try {
  const result = await l0({ stream, guardrails });
  for await (const event of result.stream) {
    // Process events
  }
} catch (error) {
  if (isL0Error(error)) {
    checkpoint = error.getCheckpoint() ?? "";

    // Retry with checkpoint context
    const result = await l0({
      stream: () =>
        streamText({
          model,
          prompt: `Continue from: ${checkpoint}\n\nOriginal prompt: ${prompt}`,
        }),
    });
  }
}
```

### Fallback Models

Automatically try cheaper models on failure:

```typescript
const result = await l0({
  stream: () => streamText({ model: openai("gpt-5.1"), prompt }),
  fallbackStreams: [
    () => streamText({ model: openai("gpt-5-mini"), prompt }),
    () => streamText({ model: anthropic("claude-3-haiku"), prompt }),
  ],
});

// Check which model succeeded
if (result.state.fallbackIndex > 0) {
  console.log(`Used fallback model ${result.state.fallbackIndex}`);
}
```

### Graceful Degradation

Handle errors at the application level:

```typescript
async function generateWithFallback(prompt: string) {
  try {
    // Try L0 with full guardrails
    return await l0({
      stream: () => streamText({ model, prompt }),
      guardrails: strictGuardrails,
      retry: recommendedRetry,
    });
  } catch (error) {
    if (isL0Error(error) && error.code === "ALL_STREAMS_EXHAUSTED") {
      // All models failed - return cached/default response
      return getCachedResponse(prompt);
    }
    throw error;
  }
}
```

---

## Best Practices

### 1. Always Check Error Type

```typescript
try {
  await l0({ stream, guardrails });
} catch (error) {
  if (isL0Error(error)) {
    // Handle L0-specific errors
  } else if (isNetworkError(error)) {
    // Handle network errors
  } else {
    // Handle other errors
    throw error;
  }
}
```

### 2. Log Error Context

```typescript
catch (error) {
  if (isL0Error(error)) {
    logger.error({
      code: error.code,
      tokenCount: error.context.tokenCount,
      retryAttempts: error.context.retryAttempts,
      checkpoint: error.getCheckpoint()?.slice(0, 100),
      timestamp: error.timestamp
    });
  }
}
```

### 3. Set Appropriate Retry Limits

```typescript
// Production: balance reliability vs latency
retry: {
  maxAttempts: 2,        // Model errors
  maxRetries: 10,        // Absolute cap (all errors)
  maxErrorHistory: 50    // Prevent memory leaks
}
```

### 4. Use Error Codes for Metrics

```typescript
catch (error) {
  if (isL0Error(error)) {
    metrics.increment(`l0.error.${error.code}`);
    metrics.increment(`l0.error.recoverable.${error.isRecoverable()}`);
  }
}
```

### 5. Handle Cancellation

```typescript
const controller = new AbortController();

// Cancel on user action
button.onclick = () => controller.abort();

try {
  await l0({
    stream: () => streamText({ model, prompt }),
    signal: controller.signal,
  });
} catch (error) {
  if (isL0Error(error) && error.code === "STREAM_ABORTED") {
    // User cancelled - not an error
    return;
  }
  throw error;
}
```

### 6. Test Error Scenarios

```typescript
import { describe, it, expect } from "vitest";

describe("Error handling", () => {
  it("handles zero output", async () => {
    const mockStream = async function* () {
      // Emit nothing
    };

    await expect(l0({ stream: () => mockStream() })).rejects.toThrow(
      "ZERO_OUTPUT",
    );
  });

  it("handles network errors", async () => {
    const mockStream = async function* () {
      throw new TypeError("NetworkError");
    };

    // Should retry automatically
    await expect(
      l0({
        stream: () => mockStream(),
        retry: { maxRetries: 1 },
      }),
    ).rejects.toThrow();
  });
});
```

---

## Error Reference

### Complete Error Flow

```
Stream starts
    |
    v
[First token received?]--No--> INITIAL_TOKEN_TIMEOUT (retry)
    |
    Yes
    v
[Token gap OK?]--No--> INTER_TOKEN_TIMEOUT (retry)
    |
    Yes
    v
[Guardrail check]--Fail--> GUARDRAIL_VIOLATION (retry if not fatal)
    |
    Pass
    v
[Content accumulates...]
    |
    v
[Stream complete?]--Error--> Check error type
    |                              |
    Yes                    [Network?]--Yes--> Retry (no count)
    |                              |
    v                      [Model?]--Yes--> Retry (counts)
[Final validation]                 |
    |                      [Fatal?]--Yes--> Throw immediately
    v
[Zero output?]--Yes--> ZERO_OUTPUT (retry, no count)
    |
    No
    v
Success!
```
