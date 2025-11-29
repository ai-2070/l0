# Network Error Handling Guide

L0 provides comprehensive network error detection and automatic recovery.

## Quick Start

```typescript
import { l0, recommendedRetry } from "l0";

const result = await l0({
  stream: () => streamText({ model, prompt }),
  retry: recommendedRetry  // Handles all network errors automatically
});

console.log("Network retries:", result.state.networkRetries);
```

---

## Supported Error Types

| Error Type | Description | Retries | Base Delay |
|------------|-------------|---------|------------|
| Connection Dropped | Connection lost mid-stream | Yes | 1000ms |
| fetch() TypeError | Fetch API failure | Yes | 500ms |
| ECONNRESET | Connection reset by peer | Yes | 1000ms |
| ECONNREFUSED | Server refused connection | Yes | 2000ms |
| SSE Aborted | Server-sent events aborted | Yes | 500ms |
| No Bytes | Server sent no data | Yes | 500ms |
| Partial Chunks | Incomplete data received | Yes | 500ms |
| Runtime Killed | Lambda/Edge timeout | Yes | 2000ms |
| Background Throttle | Mobile tab backgrounded | Yes | 5000ms |
| DNS Error | Host not found | Yes | 3000ms |
| SSL Error | Certificate/TLS error | **No** | - |
| Timeout | Request timed out | Yes | 1000ms |

**Key:** Network errors do NOT count toward the retry limit.

---

## Error Detection

```typescript
import { 
  isNetworkError, 
  analyzeNetworkError,
  NetworkErrorType 
} from "l0";

try {
  await l0({ stream, retry: recommendedRetry });
} catch (error) {
  if (isNetworkError(error)) {
    const analysis = analyzeNetworkError(error);
    console.log("Type:", analysis.type);         // NetworkErrorType
    console.log("Retryable:", analysis.retryable);
    console.log("Suggestion:", analysis.suggestion);
  }
}
```

### Specific Error Checks

```typescript
import {
  isConnectionDropped,
  isECONNRESET,
  isECONNREFUSED,
  isSSEAborted,
  isTimeoutError,
  isDNSError,
  isSSLError
} from "l0";

if (isConnectionDropped(error)) {
  // Connection was dropped mid-stream
}

if (isTimeoutError(error)) {
  // Request timed out
}
```

---

## Custom Delay Configuration

Configure different delays for each error type:

```typescript
const result = await l0({
  stream: () => streamText({ model, prompt }),
  retry: {
    maxAttempts: 3,
    backoff: "exponential",
    errorTypeDelays: {
      connectionDropped: 2000,     // 2s for connection drops
      fetchError: 500,             // 0.5s for fetch errors
      econnreset: 1500,            // 1.5s for ECONNRESET
      econnrefused: 3000,          // 3s for ECONNREFUSED
      sseAborted: 1000,            // 1s for SSE aborted
      noBytes: 500,                // 0.5s for no bytes
      partialChunks: 750,          // 0.75s for partial chunks
      runtimeKilled: 5000,         // 5s for runtime kills
      backgroundThrottle: 10000,   // 10s for background throttle
      dnsError: 4000,              // 4s for DNS errors
      timeout: 2000                // 2s for timeouts
    }
  }
});
```

---

## Environment-Specific Configuration

### Mobile

```typescript
const result = await l0({
  stream: () => streamText({ model, prompt }),
  retry: {
    maxAttempts: 3,
    backoff: "full-jitter",
    errorTypeDelays: {
      backgroundThrottle: 15000,   // Wait longer for mobile
      timeout: 3000,               // More lenient timeouts
      connectionDropped: 2500      // Mobile networks unstable
    }
  },

  // Optional: Timeouts (ms)
  timeout: {
    initialToken: 5000,  // 5s to first token
    interToken: 10000,    // 10s between tokens
  },
});
```

⚠️ Free and low-priority models may take **3–7 seconds** before emitting the first token and **10 seconds** between tokens.

### Edge Runtime

```typescript
const result = await l0({
  stream: () => streamText({ model, prompt }),
  retry: {
    maxAttempts: 3,
    backoff: "exponential",
    maxDelay: 5000,                // Keep delays short
    errorTypeDelays: {
      runtimeKilled: 2000,         // Quick retry on timeout
      timeout: 1500
    }
  },

  // Optional: Timeouts (ms)
  timeout: {
    initialToken: 5000,  // 5s to first token
    interToken: 10000,    // 10s between tokens
  },
});
```

⚠️ Free and low-priority models may take **3–7 seconds** before emitting the first token and **10 seconds** between tokens.

---

## Monitoring

```typescript
const result = await l0({
  stream: () => streamText({ model, prompt }),
  retry: recommendedRetry,
  monitoring: {
    onRetry: (attempt, error) => {
      if (isNetworkError(error)) {
        logger.warn("Network retry", {
          attempt,
          type: analyzeNetworkError(error).type
        });
      }
    }
  }
});

// After completion
console.log("Network retries:", result.state.networkRetries);
console.log("Model retries:", result.state.retryAttempts);
```

---

## Utility Functions

```typescript
import {
  suggestRetryDelay,    // Get recommended delay for error
  describeNetworkError, // Human-readable description
  isStreamInterrupted   // Check if stream was interrupted
} from "l0";

// Get suggested delay
const delay = suggestRetryDelay(error, attemptNumber);

// Get description
const description = describeNetworkError(error);
// "Network error: econnreset (Connection was reset by peer)"

// Check if stream was interrupted mid-flight
if (isStreamInterrupted(error, tokenCount)) {
  console.log("Partial content in checkpoint");
}
```

---

## Best Practices

1. **Use `recommendedRetry`** - Handles all network errors automatically
2. **Set appropriate timeouts** - Higher for mobile/edge, lower for fast models
3. **Customize delays per error type** - Tune for your infrastructure
4. **Monitor network retries** - Alert if consistently high
5. **Handle checkpoints** - Partial content preserved in `result.state.checkpoint`

```typescript
// Production configuration
const result = await l0({
  stream: () => streamText({ model, prompt }),
  retry: {
    maxAttempts: 3,
    backoff: "full-jitter",
    maxDelay: 10000,
    errorTypeDelays: {
      connectionDropped: 1000,
      runtimeKilled: 3000,
      backgroundThrottle: 10000
    }
  },
  
  // Optional: Timeouts (ms)
  timeout: {
    initialToken: 5000,  // 5s to first token
    interToken: 10000,    // 10s between tokens
  },
});
```

⚠️ Free and low-priority models may take **3–7 seconds** before emitting the first token and **10 seconds** between tokens.

---

## See Also

- [API.md](./API.md) - Complete API reference
- [ERROR_HANDLING.md](./ERROR_HANDLING.md) - Error codes and L0Error
- [PERFORMANCE.md](./PERFORMANCE.md) - Performance tuning
