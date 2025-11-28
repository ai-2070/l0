# Custom Delay Configuration Guide

Complete guide for customizing retry delays per network error type in L0.

## Overview

L0 allows you to configure custom retry delays for each type of network error. This gives you fine-grained control over retry behavior based on your specific infrastructure and requirements.

## Quick Start

```typescript
import { l0 } from 'l0';

const result = await l0({
  stream: () => streamText({ model, prompt }),
  retry: {
    attempts: 3,
    backoff: 'exponential',
    errorTypeDelays: {
      connectionDropped: 2000,   // 2 seconds
      fetchError: 500,           // 0.5 seconds
      timeout: 1500              // 1.5 seconds
    }
  }
});
```

## Default Delays

If you don't specify custom delays, L0 uses these defaults:

| Error Type           | Default Delay | Rationale                              |
|---------------------|---------------|----------------------------------------|
| connectionDropped    | 1000ms        | Quick retry for temporary drops        |
| fetchError          | 500ms         | Immediate retry for fetch failures     |
| econnreset          | 1000ms        | Standard retry for reset connections   |
| econnrefused        | 2000ms        | Longer delay, server may be down       |
| sseAborted          | 500ms         | Quick retry for aborted streams        |
| noBytes             | 500ms         | Immediate retry for empty responses    |
| partialChunks       | 500ms         | Quick retry for incomplete data        |
| runtimeKilled       | 2000ms        | Longer delay for runtime timeouts      |
| backgroundThrottle  | 5000ms        | Wait for browser to resume             |
| dnsError            | 3000ms        | Allow time for DNS propagation         |
| timeout             | 1000ms        | Standard timeout retry                 |
| unknown             | 1000ms        | Conservative default                   |

## Configuration Options

### Full Configuration

```typescript
interface ErrorTypeDelays {
  connectionDropped?: number;    // Connection lost mid-stream
  fetchError?: number;           // fetch() failed to initiate
  econnreset?: number;          // Connection reset by peer
  econnrefused?: number;        // Server refused connection
  sseAborted?: number;          // SSE stream aborted
  noBytes?: number;             // No data received
  partialChunks?: number;       // Incomplete data received
  runtimeKilled?: number;       // Lambda/Edge timeout
  backgroundThrottle?: number;  // Mobile background suspension
  dnsError?: number;            // DNS lookup failed
  timeout?: number;             // Request timeout
  unknown?: number;             // Unknown network error
}
```

### Usage in L0

```typescript
const result = await l0({
  stream: () => streamText({ model, prompt }),
  retry: {
    attempts: 3,
    backoff: 'exponential',
    baseDelay: 1000,          // Base delay for non-network errors
    maxDelay: 30000,          // Maximum delay cap
    errorTypeDelays: {
      // Customize only the delays you want to override
      connectionDropped: 1500,
      runtimeKilled: 4000
    }
  }
});
```

## How It Works

### Backoff Application

Custom delays work with backoff strategies:

```typescript
// With exponential backoff
errorTypeDelays: { fetchError: 500 }

// Retry delays will be:
// Attempt 0: 500ms
// Attempt 1: 1000ms (500 * 2^1)
// Attempt 2: 2000ms (500 * 2^2)
// Attempt 3: 4000ms (500 * 2^3)
```

### Max Delay Cap

The `maxDelay` setting applies to custom delays:

```typescript
retry: {
  errorTypeDelays: { timeout: 5000 },
  maxDelay: 10000  // Caps all delays at 10 seconds
}

// Even with exponential backoff, delay won't exceed 10 seconds
```

### Backoff Strategy Interaction

```typescript
// Linear backoff
retry: {
  backoff: 'linear',
  errorTypeDelays: { connectionDropped: 1000 }
}
// Delays: 1000ms, 2000ms, 3000ms, 4000ms...

// Fixed backoff
retry: {
  backoff: 'fixed',
  errorTypeDelays: { connectionDropped: 1000 }
}
// Delays: 1000ms, 1000ms, 1000ms...

// Full jitter backoff
retry: {
  backoff: 'full-jitter',
  errorTypeDelays: { connectionDropped: 1000 }
}
// Delays: random(0, 1000), random(0, 2000), random(0, 4000)...
```

## Use Cases

### 1. Mobile Optimized

For mobile apps with unstable connections:

```typescript
const mobileRetryConfig = {
  attempts: 5,
  backoff: 'full-jitter',
  maxDelay: 15000,
  errorTypeDelays: {
    connectionDropped: 2500,      // Mobile networks drop frequently
    backgroundThrottle: 15000,    // Wait for app to come to foreground
    timeout: 3000,                // More lenient timeouts
    partialChunks: 1000,          // Common on mobile
    fetchError: 1000              // Network switching delay
  }
};

const result = await l0({
  stream: () => streamText({ model, prompt }),
  retry: mobileRetryConfig,
  timeout: {
    initialToken: 10000,
    interToken: 15000
  }
});
```

### 2. Edge Runtime Optimized

For Vercel Edge or Cloudflare Workers:

```typescript
const edgeRetryConfig = {
  attempts: 3,
  backoff: 'exponential',
  maxDelay: 5000,  // Keep short to fit within runtime limits
  errorTypeDelays: {
    runtimeKilled: 2000,     // Quick retry on timeout
    timeout: 1000,           // Fast timeout retries
    connectionDropped: 800,  // Quick reconnection
    econnreset: 800,         // Fast retry
    fetchError: 500          // Immediate retry
  }
};

const result = await l0({
  stream: () => streamText({ model, prompt }),
  retry: edgeRetryConfig,
  timeout: {
    initialToken: 3000,  // Must complete before runtime timeout
    interToken: 5000
  }
});
```

### 3. High Availability / Production

For production systems prioritizing reliability:

```typescript
const productionRetryConfig = {
  attempts: 5,
  backoff: 'exponential',
  maxDelay: 20000,
  retryOn: ['network_error', 'timeout', 'rate_limit'],
  errorTypeDelays: {
    connectionDropped: 1000,   // Fast recovery
    fetchError: 500,           // Immediate
    econnreset: 1000,          // Standard
    econnrefused: 3000,        // Server issue, wait longer
    sseAborted: 750,           // Quick retry
    noBytes: 500,              // Immediate
    partialChunks: 500,        // Quick recovery
    runtimeKilled: 3000,       // Infrastructure issue
    dnsError: 4000,            // DNS propagation time
    timeout: 1500,             // Balanced timeout
    backgroundThrottle: 8000   // Desktop tab suspension
  }
};

const result = await l0({
  stream: () => streamText({ model, prompt }),
  retry: productionRetryConfig
});
```

### 4. Development / Testing

For development with faster feedback:

```typescript
const devRetryConfig = {
  attempts: 2,
  backoff: 'fixed',
  errorTypeDelays: {
    // All quick retries for faster iteration
    connectionDropped: 300,
    fetchError: 200,
    timeout: 500,
    runtimeKilled: 1000
  }
};
```

### 5. Conservative / Low-Traffic

For low-traffic scenarios or rate-limited APIs:

```typescript
const conservativeRetryConfig = {
  attempts: 3,
  backoff: 'exponential',
  maxDelay: 60000,  // Allow long delays
  errorTypeDelays: {
    connectionDropped: 3000,    // Wait longer
    econnrefused: 5000,         // Server might be overloaded
    timeout: 4000,              // Patient retry
    runtimeKilled: 10000,       // Give infrastructure time
    dnsError: 8000              // DNS issues take time
  }
};
```

### 6. Microservices Internal

For service-to-service communication:

```typescript
const internalRetryConfig = {
  attempts: 4,
  backoff: 'linear',
  maxDelay: 10000,
  errorTypeDelays: {
    connectionDropped: 500,     // Internal network is fast
    econnreset: 500,            // Quick recovery
    econnrefused: 1000,         // Service might be restarting
    timeout: 2000,              // Internal timeout
    fetchError: 300             // Fast retry
  }
};
```

## Advanced Configuration

### Dynamic Delays Based on Time of Day

```typescript
function getTimeBasedDelays(): ErrorTypeDelays {
  const hour = new Date().getHours();
  const isPeakHours = hour >= 9 && hour <= 17;
  
  if (isPeakHours) {
    // Peak hours - more aggressive retries
    return {
      connectionDropped: 1000,
      timeout: 1500,
      econnrefused: 2000
    };
  } else {
    // Off-peak - more conservative
    return {
      connectionDropped: 2000,
      timeout: 3000,
      econnrefused: 4000
    };
  }
}

const result = await l0({
  stream: () => streamText({ model, prompt }),
  retry: {
    attempts: 3,
    errorTypeDelays: getTimeBasedDelays()
  }
});
```

### Environment-Specific Configuration

```typescript
const retryConfig = {
  attempts: 3,
  backoff: 'exponential',
  errorTypeDelays: process.env.NODE_ENV === 'production'
    ? {
        // Production - balanced
        connectionDropped: 1500,
        timeout: 2000,
        runtimeKilled: 3000
      }
    : {
        // Development - fast
        connectionDropped: 500,
        timeout: 800,
        runtimeKilled: 1000
      }
};
```

### Per-Model Configuration

```typescript
function getModelSpecificDelays(modelName: string): ErrorTypeDelays {
  switch (modelName) {
    case 'gpt-4':
      // GPT-4 is slower, more patient
      return {
        timeout: 3000,
        connectionDropped: 2000,
        runtimeKilled: 5000
      };
    case 'gpt-3.5-turbo':
      // GPT-3.5 is faster, quicker retries
      return {
        timeout: 1500,
        connectionDropped: 1000,
        runtimeKilled: 2000
      };
    default:
      return {};
  }
}

const result = await l0({
  stream: () => streamText({ model: 'gpt-4', prompt }),
  retry: {
    attempts: 3,
    errorTypeDelays: getModelSpecificDelays('gpt-4')
  }
});
```

### User Experience Based

```typescript
function getUXBasedDelays(userTier: 'free' | 'paid' | 'enterprise'): ErrorTypeDelays {
  switch (userTier) {
    case 'enterprise':
      // Premium users get aggressive retries
      return {
        connectionDropped: 500,
        timeout: 1000,
        fetchError: 300,
        partialChunks: 500
      };
    case 'paid':
      // Paid users get standard retries
      return {
        connectionDropped: 1000,
        timeout: 1500,
        fetchError: 500
      };
    case 'free':
      // Free users get conservative retries
      return {
        connectionDropped: 2000,
        timeout: 3000,
        fetchError: 1000
      };
  }
}
```

## Monitoring and Tuning

### Log Delay Usage

```typescript
const result = await l0({
  stream: () => streamText({ model, prompt }),
  retry: {
    attempts: 3,
    errorTypeDelays: {
      connectionDropped: 1500,
      timeout: 2000
    }
  },
  onRetry: (attempt, reason) => {
    console.log(`[Retry ${attempt}] ${reason}`);
    // Log to analytics to tune delays
    analytics.track('llm_retry', {
      attempt,
      reason,
      timestamp: Date.now()
    });
  }
});

// After completion, analyze
console.log('Network retries:', result.state.networkRetries);
```

### A/B Testing Delays

```typescript
const delayConfigA = {
  connectionDropped: 1000,
  timeout: 1500
};

const delayConfigB = {
  connectionDropped: 1500,
  timeout: 2000
};

// Random assignment
const selectedConfig = Math.random() < 0.5 ? delayConfigA : delayConfigB;

const result = await l0({
  stream: () => streamText({ model, prompt }),
  retry: {
    attempts: 3,
    errorTypeDelays: selectedConfig
  }
});

// Track which performed better
analytics.track('delay_config_performance', {
  config: selectedConfig === delayConfigA ? 'A' : 'B',
  retries: result.state.networkRetries,
  completed: result.state.completed
});
```

### Adaptive Delays

```typescript
class AdaptiveDelayManager {
  private successRates: Map<string, number> = new Map();
  
  getDelays(): ErrorTypeDelays {
    // Adjust based on recent success rates
    const connectionSuccess = this.successRates.get('connectionDropped') || 0.5;
    
    return {
      connectionDropped: connectionSuccess > 0.8 ? 800 : 1500,
      timeout: connectionSuccess > 0.8 ? 1000 : 2000
    };
  }
  
  recordSuccess(errorType: string, success: boolean) {
    const current = this.successRates.get(errorType) || 0.5;
    // Exponential moving average
    this.successRates.set(errorType, current * 0.9 + (success ? 1 : 0) * 0.1);
  }
}

const delayManager = new AdaptiveDelayManager();

const result = await l0({
  stream: () => streamText({ model, prompt }),
  retry: {
    attempts: 3,
    errorTypeDelays: delayManager.getDelays()
  }
});

// Record outcome
delayManager.recordSuccess('connectionDropped', result.state.completed);
```

## Best Practices

### 1. Start with Defaults

Don't customize unless you have a specific need:

```typescript
// Good - use defaults first
retry: {
  attempts: 3,
  backoff: 'exponential'
}

// Only customize after measuring
retry: {
  attempts: 3,
  backoff: 'exponential',
  errorTypeDelays: {
    // Only override what you need
    runtimeKilled: 4000  // Based on observed timeouts
  }
}
```

### 2. Measure Before Optimizing

```typescript
// Step 1: Run with defaults and measure
const result = await l0({
  stream: () => streamText({ model, prompt }),
  retry: recommendedRetry,
  onRetry: (attempt, reason) => {
    logger.info('Retry', { attempt, reason });
  }
});

// Step 2: Analyze logs to find patterns
// Step 3: Adjust specific delays based on data
```

### 3. Consider User Experience

```typescript
// Balance speed vs. reliability
errorTypeDelays: {
  fetchError: 500,          // Quick retry for better UX
  connectionDropped: 1500,  // Slightly longer but still responsive
  runtimeKilled: 5000       // Server issue, worth waiting
}
```

### 4. Environment-Aware Defaults

```typescript
const delays = {
  development: { timeout: 500, connectionDropped: 300 },
  staging: { timeout: 1000, connectionDropped: 800 },
  production: { timeout: 2000, connectionDropped: 1500 }
}[process.env.NODE_ENV || 'development'];
```

### 5. Document Your Choices

```typescript
retry: {
  attempts: 3,
  errorTypeDelays: {
    // Faster retry - our edge functions timeout at 10s
    runtimeKilled: 2000,
    
    // Longer retry - DNS propagation in our region is slow
    dnsError: 5000,
    
    // Standard retry - reliable network
    connectionDropped: 1000
  }
}
```

## Troubleshooting

### Retries Too Slow

```typescript
// Problem: Users waiting too long
// Solution: Reduce delays
errorTypeDelays: {
  connectionDropped: 500,  // Was 2000
  timeout: 800             // Was 2000
}
```

### Too Many Retries

```typescript
// Problem: Overwhelming server
// Solution: Increase delays
errorTypeDelays: {
  connectionDropped: 3000,  // Was 1000
  econnrefused: 5000        // Was 2000
}
```

### Inconsistent Performance

```typescript
// Problem: Sometimes fast, sometimes slow
// Solution: Use jitter
retry: {
  backoff: 'full-jitter',  // Randomize delays
  errorTypeDelays: {
    connectionDropped: 1500
  }
}
```

### Edge Runtime Timeouts

```typescript
// Problem: Lambda/Edge timing out
// Solution: Faster retries + shorter timeout
retry: {
  maxDelay: 3000,  // Keep under runtime limit
  errorTypeDelays: {
    runtimeKilled: 1000,  // Quick retry
    timeout: 800
  }
},
timeout: {
  initialToken: 2000,
  interToken: 3000
}
```

## API Reference

### suggestRetryDelay()

Get suggested delay for an error:

```typescript
import { suggestRetryDelay, analyzeNetworkError } from 'l0';

const delay = suggestRetryDelay(
  error,           // Error object
  attemptNumber,   // 0-based attempt number
  customDelays,    // Optional custom delay map
  maxDelay         // Optional max delay cap
);

console.log(`Retry in ${delay}ms`);
```

### analyzeNetworkError()

Analyze error to determine type:

```typescript
import { analyzeNetworkError } from 'l0';

const analysis = analyzeNetworkError(error);
console.log(analysis.type);         // NetworkErrorType
console.log(analysis.suggestion);   // Suggested action
```

## Summary

Custom delay configuration in L0:

- ✅ Per-error-type delay control
- ✅ Works with all backoff strategies
- ✅ Respects maxDelay cap
- ✅ Optional - defaults are sensible
- ✅ Environment-specific tuning
- ✅ A/B testable
- ✅ Fully typed with TypeScript

Start with defaults, measure performance, then tune specific delays based on your infrastructure and requirements.