# Custom Delay Feature Summary

## Overview

L0 now supports **per-error-type custom retry delays**, giving you fine-grained control over retry behavior for each type of network error.

## What's New

### Before (v0.1.0)
```typescript
retry: {
  attempts: 3,
  baseDelay: 1000,  // Same delay for ALL errors
  backoff: "exponential"
}
```

### After (v0.1.1+)
```typescript
retry: {
  attempts: 3,
  baseDelay: 1000,  // Base delay for non-network errors
  backoff: "exponential",
  // NEW: Custom delays per error type
  errorTypeDelays: {
    connectionDropped: 2000,      // 2s for connection drops
    fetchError: 500,              // 0.5s for fetch errors
    runtimeKilled: 5000,          // 5s for runtime timeouts
    timeout: 1500,                // 1.5s for timeouts
    backgroundThrottle: 10000     // 10s for mobile background
  }
}
```

## Benefits

✅ **Optimized retry behavior** - Different errors need different delays
✅ **Better user experience** - Fast retries for transient errors, patient retries for infrastructure issues
✅ **Environment-specific tuning** - Mobile, edge, production can use different configs
✅ **Cost optimization** - Reduce unnecessary server load with smarter delays
✅ **Fully optional** - Sensible defaults if you don't configure
✅ **Type-safe** - Full TypeScript support with IntelliSense

## All Configurable Error Types

| Error Type           | Default | Description                    |
|---------------------|---------|--------------------------------|
| connectionDropped    | 1000ms  | Connection lost mid-stream     |
| fetchError          | 500ms   | fetch() failed to initiate     |
| econnreset          | 1000ms  | Connection reset by peer       |
| econnrefused        | 2000ms  | Server refused connection      |
| sseAborted          | 500ms   | SSE stream aborted             |
| noBytes             | 500ms   | No data received               |
| partialChunks       | 500ms   | Incomplete data received       |
| runtimeKilled       | 2000ms  | Lambda/Edge timeout            |
| backgroundThrottle  | 5000ms  | Mobile background suspension   |
| dnsError            | 3000ms  | DNS lookup failed              |
| timeout             | 1000ms  | Request timeout                |
| unknown             | 1000ms  | Unknown network error          |

## Quick Examples

### Mobile Optimized
```typescript
errorTypeDelays: {
  backgroundThrottle: 15000,    // Wait longer for app resume
  connectionDropped: 2500,      // Mobile networks unstable
  timeout: 3000                 // More lenient
}
```

### Edge Runtime Optimized
```typescript
errorTypeDelays: {
  runtimeKilled: 2000,    // Quick retry on timeout
  timeout: 1000,          // Fast retries
  connectionDropped: 800  // Edge is fast
}
```

### Production High-Availability
```typescript
errorTypeDelays: {
  connectionDropped: 1000,
  econnrefused: 3000,     // Server down, wait longer
  runtimeKilled: 3000,
  dnsError: 4000,         // DNS propagation time
  timeout: 1500
}
```

## Implementation Details

### Files Modified
- `src/types/retry.ts` - Added `ErrorTypeDelays` interface
- `src/types/l0.ts` - Added `errorTypeDelays` to `RetryOptions`
- `src/runtime/retry.ts` - Integrated custom delays in `RetryManager`
- `src/utils/errors.ts` - Enhanced `suggestRetryDelay()` with custom delays support
- `src/index.ts` - Exported new types

### Files Created
- `CUSTOM_DELAYS.md` (683 lines) - Comprehensive configuration guide
- `CUSTOM_DELAYS_SUMMARY.md` (this file) - Quick reference

### Documentation Updated
- `API.md` - Added custom delays to API reference
- `QUICKSTART.md` - Added custom delays example
- `NETWORK_ERRORS.md` - Added configuration examples with custom delays

## How It Works

1. **Default Behavior**: If you don't specify `errorTypeDelays`, L0 uses sensible defaults
2. **Custom Delays**: Specify only the delays you want to override
3. **Backoff Applied**: Custom delays work with all backoff strategies (exponential, linear, fixed, jitter)
4. **Max Delay Cap**: The `maxDelay` setting applies to custom delays
5. **Type Safety**: TypeScript provides IntelliSense for all error types

### With Exponential Backoff
```typescript
errorTypeDelays: { fetchError: 500 }

// Retry delays:
// Attempt 0: 500ms
// Attempt 1: 1000ms (500 * 2^1)
// Attempt 2: 2000ms (500 * 2^2)
// Attempt 3: 4000ms (500 * 2^3)
```

### With Max Delay Cap
```typescript
errorTypeDelays: { timeout: 5000 },
maxDelay: 10000

// Even with exponential backoff, won't exceed 10 seconds
```

## Usage Patterns

### Override Specific Delays Only
```typescript
retry: {
  attempts: 3,
  backoff: "exponential",
  errorTypeDelays: {
    // Only override what you need
    runtimeKilled: 4000  // Based on observed Lambda timeouts
  }
  // All other errors use defaults
}
```

### Environment-Specific
```typescript
const delays = process.env.NODE_ENV === 'production'
  ? { connectionDropped: 1500, timeout: 2000 }
  : { connectionDropped: 500, timeout: 800 };

retry: {
  attempts: 3,
  errorTypeDelays: delays
}
```

### Dynamic Configuration
```typescript
function getDelays(userTier: string) {
  return {
    connectionDropped: userTier === 'premium' ? 500 : 2000,
    timeout: userTier === 'premium' ? 1000 : 3000
  };
}

retry: {
  attempts: 3,
  errorTypeDelays: getDelays(user.tier)
}
```

## API Reference

### Type Definition
```typescript
interface ErrorTypeDelays {
  connectionDropped?: number;
  fetchError?: number;
  econnreset?: number;
  econnrefused?: number;
  sseAborted?: number;
  noBytes?: number;
  partialChunks?: number;
  runtimeKilled?: number;
  backgroundThrottle?: number;
  dnsError?: number;
  timeout?: number;
  unknown?: number;
}

interface RetryOptions {
  attempts?: number;
  backoff?: "exponential" | "linear" | "fixed" | "full-jitter";
  baseDelay?: number;
  maxDelay?: number;
  retryOn?: RetryReason[];
  errorTypeDelays?: ErrorTypeDelays;  // NEW
}
```

### Helper Function
```typescript
import { suggestRetryDelay } from 'l0';

// Get suggested delay for an error
const delay = suggestRetryDelay(
  error,              // Error object
  attemptNumber,      // 0-based attempt
  customDelays,       // Optional custom delay map
  maxDelay            // Optional max cap
);
```

## Best Practices

1. **Start with defaults** - Don't customize unless needed
2. **Measure first** - Use `onRetry` callback to track patterns
3. **Override selectively** - Only customize problematic error types
4. **Consider users** - Mobile users need different delays than desktop
5. **Document choices** - Comment why you chose specific delays
6. **Test thoroughly** - A/B test different configurations
7. **Monitor impact** - Track `result.state.networkRetries`

## Migration Guide

### No Changes Required
If you're using defaults, no code changes needed. Everything works as before.

### To Enable Custom Delays
```typescript
// Old code (still works)
const result = await l0({
  stream: () => streamText({ model, prompt }),
  retry: recommendedRetry
});

// New code (with custom delays)
const result = await l0({
  stream: () => streamText({ model, prompt }),
  retry: {
    ...recommendedRetry,
    errorTypeDelays: {
      runtimeKilled: 4000,
      timeout: 1500
    }
  }
});
```

## Testing

### Unit Tests
- Custom delays are applied correctly
- Backoff strategies work with custom delays
- Max delay cap is respected
- Defaults used when not specified

### Integration Tests
- Real network errors use custom delays
- Retry behavior is measurable
- State tracking is accurate

## Performance Impact

✅ **Minimal overhead** - Simple object lookup
✅ **No breaking changes** - Fully backward compatible
✅ **Type-safe** - Compile-time checking
✅ **Lazy evaluation** - Only calculated when needed

## Documentation

Complete documentation available:
- **[CUSTOM_DELAYS.md](./CUSTOM_DELAYS.md)** - 683 lines, comprehensive guide
- **[API.md](./API.md)** - API reference with examples
- **[NETWORK_ERRORS.md](./NETWORK_ERRORS.md)** - Network error handling guide
- **[QUICKSTART.md](./QUICKSTART.md)** - Quick start examples

## Summary

The custom delay feature gives you:
- ✅ **12 configurable error types**
- ✅ **Full TypeScript support**
- ✅ **Backward compatible**
- ✅ **Environment-aware**
- ✅ **User experience optimized**
- ✅ **Production-ready**
- ✅ **Fully documented**

You can now fine-tune L0's retry behavior to match your exact infrastructure and requirements!