# Network Error Handling in L0

This document details how L0 handles all network error cases to ensure reliable LLM streaming.

## Overview

L0 provides comprehensive network error detection and recovery for all common failure modes in LLM streaming applications. All network errors are automatically retried without counting toward the retry limit.

## Supported Network Error Cases

### 1. Connection Dropped

**Symptoms:**
- Connection lost mid-stream
- "Connection dropped" error
- "Connection closed" error
- "Connection lost" error

**Detection:**
```typescript
import { isConnectionDropped } from 'l0';

if (isConnectionDropped(error)) {
  console.log('Connection was dropped mid-stream');
}
```

**L0 Behavior:**
- ✅ Automatically detected
- ✅ Retries with exponential backoff
- ❌ Does NOT count toward retry limit
- Suggested delay: 1000ms base

**Example:**
```typescript
const result = await l0({
  stream: () => streamText({ model, prompt }),
  retry: recommendedRetry
});
// Will automatically retry on connection drops
```

---

### 2. fetch() TypeError

**Symptoms:**
- `TypeError: Failed to fetch`
- `TypeError: Network request failed`
- Fetch API initialization failure

**Detection:**
```typescript
import { isFetchTypeError } from 'l0';

if (isFetchTypeError(error)) {
  console.log('Fetch failed to initiate');
}
```

**L0 Behavior:**
- ✅ Automatically detected
- ✅ Retries immediately
- ❌ Does NOT count toward retry limit
- Suggested delay: 500ms base

**Common Causes:**
- Network interface down
- Browser offline mode
- CORS issues
- Invalid URL

---

### 3. ECONNRESET

**Symptoms:**
- "ECONNRESET" error code
- "Connection reset by peer"
- TCP connection forcibly closed

**Detection:**
```typescript
import { isECONNRESET } from 'l0';

if (isECONNRESET(error)) {
  console.log('Connection was reset by peer');
}
```

**L0 Behavior:**
- ✅ Automatically detected
- ✅ Retries with backoff
- ❌ Does NOT count toward retry limit
- Suggested delay: 1000ms base

**Common Causes:**
- Server restart
- Load balancer timeout
- Network middlebox interference
- Firewall rules

---

### 4. ECONNREFUSED

**Symptoms:**
- "ECONNREFUSED" error code
- "Connection refused"
- Server not accepting connections

**Detection:**
```typescript
import { isECONNREFUSED } from 'l0';

if (isECONNREFUSED(error)) {
  console.log('Server refused connection');
}
```

**L0 Behavior:**
- ✅ Automatically detected
- ✅ Retries with longer delay
- ❌ Does NOT count toward retry limit
- Suggested delay: 2000ms base

**Common Causes:**
- Server is down
- Port not listening
- Firewall blocking connection
- Wrong host/port

---

### 5. SSE Aborted

**Symptoms:**
- "Stream aborted" error
- "SSE connection closed"
- "EventStream error"
- AbortError

**Detection:**
```typescript
import { isSSEAborted } from 'l0';

if (isSSEAborted(error)) {
  console.log('Server-Sent Events stream was aborted');
}
```

**L0 Behavior:**
- ✅ Automatically detected
- ✅ Retries immediately
- ❌ Does NOT count toward retry limit
- Suggested delay: 500ms base

**Common Causes:**
- User navigation
- AbortController triggered
- Server closed connection
- Network interruption

**Example with AbortSignal:**
```typescript
const controller = new AbortController();

const result = await l0({
  stream: () => streamText({ model, prompt }),
  signal: controller.signal
});

// Later: controller.abort() - will be detected as SSE aborted
```

---

### 6. No Bytes Arrived

**Symptoms:**
- "No bytes received"
- "Empty response"
- "Content-Length: 0"
- "No data received"

**Detection:**
```typescript
import { isNoBytes } from 'l0';

if (isNoBytes(error)) {
  console.log('Server sent no data');
}
```

**L0 Behavior:**
- ✅ Automatically detected
- ✅ Retries immediately
- ❌ Does NOT count toward retry limit
- Suggested delay: 500ms base

**Common Causes:**
- Connection closed before data sent
- Server internal error
- Premature connection termination

---

### 7. Partial Chunks

**Symptoms:**
- "Partial chunk received"
- "Incomplete chunk"
- "Truncated response"
- "Premature close"
- "Unexpected end of data"

**Detection:**
```typescript
import { isPartialChunks } from 'l0';

if (isPartialChunks(error)) {
  console.log('Received incomplete data');
}
```

**L0 Behavior:**
- ✅ Automatically detected
- ✅ Retries immediately
- ❌ Does NOT count toward retry limit
- Suggested delay: 500ms base
- 📝 Last known good checkpoint is preserved

**Common Causes:**
- Connection interrupted mid-stream
- Network instability
- Server crash during response

**Recovery:**
```typescript
const result = await l0({
  stream: () => streamText({ model, prompt }),
  retry: recommendedRetry
});

// L0 maintains checkpoints - partial progress is not lost
console.log('Checkpoint:', result.state.checkpoint);
```

---

### 8. Node/Edge Runtime Killed

**Symptoms:**
- "Worker terminated"
- "Runtime killed"
- "Lambda timeout"
- "Function timeout"
- "Execution timeout"
- "Edge runtime error"

**Detection:**
```typescript
import { isRuntimeKilled } from 'l0';

if (isRuntimeKilled(error)) {
  console.log('Runtime was terminated (likely timeout)');
}
```

**L0 Behavior:**
- ✅ Automatically detected
- ✅ Retries with backoff
- ❌ Does NOT count toward retry limit
- Suggested delay: 2000ms base

**Common Causes:**
- Vercel Edge function timeout (30s default)
- Cloudflare Worker timeout (varies by plan)
- AWS Lambda timeout
- Azure Functions timeout

**Mitigation:**
```typescript
const result = await l0({
  stream: () => streamText({ model, prompt }),
  retry: recommendedRetry,
  timeout: {
    initialToken: 5000,  // Be more lenient
    interToken: 10000    // Allow for slow streaming
  }
});
```

---

### 9. Mobile Background Throttle

**Symptoms:**
- "Background suspended"
- "Background throttle"
- "Tab suspended"
- "Page hidden"
- "Inactive tab"

**Detection:**
```typescript
import { isBackgroundThrottle } from 'l0';

if (isBackgroundThrottle(error)) {
  console.log('Browser throttled network in background');
}
```

**L0 Behavior:**
- ✅ Automatically detected
- ✅ Retries when page becomes visible
- ❌ Does NOT count toward retry limit
- Suggested delay: 5000ms base

**Common Causes:**
- Mobile Safari background tab throttling
- Chrome background tab network suspension
- iOS power saving mode
- Mobile browser battery optimization

**Best Practice:**
```typescript
// Listen for visibility changes
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    // L0 will automatically resume if it detected background throttle
    console.log('Page visible - retrying if needed');
  }
});

const result = await l0({
  stream: () => streamText({ model, prompt }),
  retry: {
    ...recommendedRetry,
    retryOn: [...recommendedRetry.retryOn!, 'network_error']
  }
});
```

---

### 10. DNS Errors

**Symptoms:**
- "ENOTFOUND" error code
- "DNS lookup failed"
- "Name resolution failed"
- "Host not found"

**Detection:**
```typescript
import { isDNSError } from 'l0';

if (isDNSError(error)) {
  console.log('DNS lookup failed');
}
```

**L0 Behavior:**
- ✅ Automatically detected
- ✅ Retries with longer delay
- ❌ Does NOT count toward retry limit
- Suggested delay: 3000ms base

**Common Causes:**
- Network connectivity issues
- Invalid hostname
- DNS server unavailable
- VPN/proxy DNS issues

---

### 11. SSL/TLS Errors

**Symptoms:**
- "SSL handshake failed"
- "Certificate error"
- "TLS error"
- "Self-signed certificate"

**Detection:**
```typescript
import { isSSLError } from 'l0';

if (isSSLError(error)) {
  console.log('SSL/TLS error - configuration issue');
}
```

**L0 Behavior:**
- ✅ Automatically detected
- ❌ Does NOT retry (fatal error)
- Configuration issue, not transient

**Common Causes:**
- Invalid server certificate
- Certificate expired
- Certificate validation failure
- SSL configuration mismatch

**Resolution:**
- Check server SSL certificate
- Verify certificate chain
- Check date/time on client
- Update root certificates

---

### 12. Timeout Errors

**Symptoms:**
- "ETIMEDOUT" error code
- "Request timeout"
- "Deadline exceeded"

**Detection:**
```typescript
import { isTimeoutError } from 'l0';

if (isTimeoutError(error)) {
  console.log('Request timed out');
}
```

**L0 Behavior:**
- ✅ Automatically detected
- ✅ Retries with longer timeout
- ❌ Does NOT count toward retry limit
- Suggested delay: 1000ms base

**Types:**
- Initial token timeout (first token not received)
- Inter-token timeout (delay between tokens)
- Overall request timeout

**Configuration:**
```typescript
const result = await l0({
  stream: () => streamText({ model, prompt }),
  timeout: {
    initialToken: 5000,   // 5 seconds for first token
    interToken: 10000     // 10 seconds between tokens
  },
  retry: recommendedRetry
});
```

---

## Error Analysis API

### Analyze Network Errors

```typescript
import { analyzeNetworkError } from 'l0';

try {
  // ... streaming code
} catch (error) {
  const analysis = analyzeNetworkError(error as Error);
  
  console.log('Error type:', analysis.type);
  console.log('Retryable:', analysis.retryable);
  console.log('Counts toward limit:', analysis.countsTowardLimit);
  console.log('Suggestion:', analysis.suggestion);
  
  if (analysis.context) {
    console.log('Cause:', analysis.context.possibleCause);
  }
}
```

### Check if Stream Was Interrupted

```typescript
import { isStreamInterrupted } from 'l0';

if (isStreamInterrupted(error, tokenCount)) {
  console.log('Stream was interrupted mid-flight');
  console.log('Partial content may be available in checkpoint');
}
```

### Get Suggested Retry Delay

```typescript
import { suggestRetryDelay } from 'l0';

const delay = suggestRetryDelay(error, attemptNumber);
console.log(`Retrying in ${delay}ms`);
```

### Describe Network Error

```typescript
import { describeNetworkError } from 'l0';

const description = describeNetworkError(error);
console.error(description);
// "Network error: econnreset (Connection was reset by peer)"
```

---

## Retry Matrix

| Error Type              | Auto-Retry | Counts? | Base Delay | Notes                          |
|------------------------|-----------|---------|------------|--------------------------------|
| Connection Dropped      | ✅        | ❌      | 1000ms     | Exponential backoff            |
| fetch() TypeError       | ✅        | ❌      | 500ms      | Immediate retry                |
| ECONNRESET             | ✅        | ❌      | 1000ms     | Common in production           |
| ECONNREFUSED           | ✅        | ❌      | 2000ms     | Longer delay for server issues |
| SSE Aborted            | ✅        | ❌      | 500ms      | Quick retry                    |
| No Bytes               | ✅        | ❌      | 500ms      | Quick retry                    |
| Partial Chunks         | ✅        | ❌      | 500ms      | Preserves checkpoint           |
| Runtime Killed         | ✅        | ❌      | 2000ms     | Adjust timeouts                |
| Background Throttle    | ✅        | ❌      | 5000ms     | Wait for visibility            |
| DNS Error              | ✅        | ❌      | 3000ms     | Network connectivity issue     |
| SSL Error              | ❌        | ❌      | -          | Fatal, configuration issue     |
| Timeout                | ✅        | ❌      | 1000ms     | Increase timeout if repeated   |

---

## Usage Examples

### Basic Network Error Handling

```typescript
import { l0, recommendedGuardrails, recommendedRetry } from 'l0';

const result = await l0({
  stream: () => streamText({ model, prompt }),
  guardrails: recommendedGuardrails,
  retry: recommendedRetry,
  
  onRetry: (attempt, reason) => {
    console.log(`Retry ${attempt}: ${reason}`);
  }
});

// All network errors are handled automatically
```

### With Custom Network Error Handling

```typescript
import { 
  l0, 
  analyzeNetworkError,
  isNetworkError 
} from 'l0';

try {
  const result = await l0({
    stream: () => streamText({ model, prompt }),
    retry: {
      attempts: 5,
      backoff: 'exponential',
      retryOn: ['network_error', 'timeout']
    },
    
    onRetry: (attempt, reason) => {
      console.log(`[Network] Retry ${attempt}: ${reason}`);
    }
  });
  
  for await (const event of result.stream) {
    if (event.type === 'token') {
      process.stdout.write(event.value || '');
    }
  }
  
} catch (error) {
  if (isNetworkError(error as Error)) {
    const analysis = analyzeNetworkError(error as Error);
    console.error('Network failure:', analysis.suggestion);
  } else {
    console.error('Non-network error:', error);
  }
}
```

### Mobile-Friendly Configuration

```typescript
const result = await l0({
  stream: () => streamText({ model, prompt }),
  retry: {
    attempts: 3,
    backoff: 'full-jitter',
    retryOn: ['network_error', 'timeout']
  },
  timeout: {
    initialToken: 10000,  // Longer for mobile
    interToken: 15000     // Account for throttling
  }
});
```

### Edge Runtime Configuration

```typescript
const result = await l0({
  stream: () => streamText({ model, prompt }),
  retry: {
    attempts: 3,
    backoff: 'exponential',
    maxDelay: 5000  // Keep delays short for edge
  },
  timeout: {
    initialToken: 3000,
    interToken: 5000
  }
});
```

---

## Monitoring and Debugging

### Log Network Errors

```typescript
const result = await l0({
  stream: () => streamText({ model, prompt }),
  retry: recommendedRetry,
  
  onRetry: (attempt, reason) => {
    logger.warn('Retry', { attempt, reason, timestamp: Date.now() });
  }
});

// After completion
console.log('Network retries:', result.state.networkRetries);
console.log('Model retries:', result.state.retryAttempts);
```

### Detailed Error Analysis

```typescript
import { analyzeNetworkError, describeNetworkError } from 'l0';

try {
  // ... streaming
} catch (error) {
  const analysis = analyzeNetworkError(error as Error);
  
  // Log to monitoring service
  monitoring.trackError({
    type: 'network_error',
    subtype: analysis.type,
    retryable: analysis.retryable,
    description: describeNetworkError(error as Error),
    context: analysis.context
  });
}
```

---

## Best Practices

1. **Use Recommended Presets**
   - `recommendedRetry` handles all network errors automatically
   - No configuration needed for most cases

2. **Set Appropriate Timeouts**
   - Lower timeouts for fast models
   - Higher timeouts for mobile/edge environments
   - Adjust based on observed latency

3. **Monitor Network Retries**
   - Check `result.state.networkRetries` after completion
   - Alert if network retries are consistently high
   - Investigate infrastructure issues

4. **Handle Checkpoints**
   - Partial content is preserved in `result.state.checkpoint`
   - Can be used to resume or show partial results
   - Useful for long-running streams

5. **Mobile Considerations**
   - Longer timeouts for mobile
   - Handle visibility changes
   - Account for background throttling

6. **Edge Runtime Considerations**
   - Set appropriate timeouts under runtime limit
   - Use shorter backoff delays
   - Monitor runtime timeout errors

---

## Summary

L0 provides comprehensive network error handling for all common failure modes:

- ✅ **11 specific error types** detected and handled
- ✅ **Automatic retry** without counting toward limit
- ✅ **Smart backoff** based on error type
- ✅ **Checkpoint preservation** for partial progress
- ✅ **Detailed error analysis** for debugging
- ✅ **Mobile and edge runtime** support

All network errors are handled transparently - just use L0 and forget about network reliability issues!