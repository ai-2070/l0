# Performance Tuning Guide

This guide covers performance optimization for L0 in production environments.

## Table of Contents

- [Timeout Configuration](#timeout-configuration)
- [Retry Optimization](#retry-optimization)
- [Guardrail Performance](#guardrail-performance)
- [Memory Management](#memory-management)
- [Streaming Best Practices](#streaming-best-practices)
- [Document Window Tuning](#document-window-tuning)
- [Consensus Optimization](#consensus-optimization)

---

## Timeout Configuration

### Initial Token Timeout

The time to wait for the first token. Set based on your model and network conditions:

```typescript
const result = await l0({
  stream: () => streamText({ model, prompt }),
  initialTokenTimeout: 3000,  // 3 seconds for first token
});
```

**Recommendations:**
- **Fast models (GPT-4o-mini, Claude Haiku):** 1500-2000ms
- **Standard models (GPT-4o, Claude Sonnet):** 2000-3000ms
- **Large models (GPT-4, Claude Opus):** 3000-5000ms
- **Edge/mobile networks:** Add 1000-2000ms buffer

### Inter-Token Timeout

Maximum gap between tokens during streaming:

```typescript
const result = await l0({
  stream: () => streamText({ model, prompt }),
  interTokenTimeout: 1000,  // 1 second max gap
});
```

**Recommendations:**
- **Most use cases:** 1000ms
- **Long-form generation:** 2000ms (models may pause to "think")
- **Code generation:** 1500ms (complex reasoning)

---

## Retry Optimization

### Backoff Strategies

Choose based on your use case:

```typescript
import { RETRY_DEFAULTS } from "l0";

// Exponential (default) - doubles delay each retry
// Good for: Most production workloads
retry: { backoff: "exponential", baseDelay: 1000, maxDelay: 10000 }

// Full jitter - random delay up to exponential max
// Good for: High-concurrency systems (prevents thundering herd)
retry: { backoff: "full-jitter", baseDelay: 1000, maxDelay: 10000 }

// Linear - adds baseDelay each retry
// Good for: Predictable delay requirements
retry: { backoff: "linear", baseDelay: 500, maxDelay: 5000 }

// Fixed - same delay every time
// Good for: Simple retry logic, testing
retry: { backoff: "fixed", baseDelay: 1000 }
```

### Retry Limits

Balance reliability vs. latency:

```typescript
// Conservative (fast failure)
retry: { maxAttempts: 1 }

// Balanced (recommended)
retry: { maxAttempts: 2 }

// Aggressive (high reliability)
retry: { maxAttempts: 3 }

// With absolute cap (prevents runaway retries)
retry: { maxAttempts: 3, maxRetries: 10 }
```

### Selective Retry Reasons

Only retry on specific error types:

```typescript
// Minimal - only retry network issues
retry: { retryOn: ["network_error", "timeout"] }

// Standard - add output quality issues
retry: { retryOn: ["network_error", "timeout", "zero_output", "guardrail_violation"] }

// Comprehensive
retry: { retryOn: ["network_error", "timeout", "zero_output", "guardrail_violation", "drift", "malformed"] }
```

---

## Guardrail Performance

### Check Intervals

Control how often guardrails run during streaming:

```typescript
const result = await l0({
  stream: () => streamText({ model, prompt }),
  guardrails: recommendedGuardrails,
  checkIntervals: {
    guardrails: 10,   // Check every 10 tokens (default: 5)
    drift: 20,        // Check drift every 20 tokens (default: 10)
    checkpoint: 15    // Save checkpoint every 15 tokens (default: 10)
  }
});
```

**Trade-offs:**
- Lower intervals = faster detection, higher CPU
- Higher intervals = lower CPU, delayed detection

### Guardrail Selection

Only include guardrails you need:

```typescript
// Minimal overhead
guardrails: [zeroOutputRule()]

// Balanced
guardrails: [jsonRule(), zeroOutputRule()]

// Full validation (higher overhead)
guardrails: recommendedGuardrails
```

### Pattern Matching

For custom patterns, pre-compile regexes:

```typescript
// Pre-compile patterns at module level
const FORBIDDEN_PATTERNS = [
  /sensitive_keyword/i,
  /another_pattern/
];

// Reuse in guardrails
guardrails: [customPatternRule(FORBIDDEN_PATTERNS, "Forbidden content")]
```

---

## Memory Management

### Error History Limits

Prevent memory leaks in long-running processes:

```typescript
retry: {
  maxAttempts: 2,
  maxErrorHistory: 100  // Keep last 100 errors only
}
```

### Stream Consumption

Always consume streams to prevent memory buildup:

```typescript
// Good - fully consume stream
for await (const event of result.stream) {
  // Process events
}

// Bad - abandoned stream may leak
const result = await l0({ stream });
// Never consuming result.stream
```

### Checkpoint Pruning

Checkpoints grow with content. For long generations:

```typescript
// Access checkpoint for recovery
const checkpoint = result.state.checkpoint;

// Clear after use if not needed
result.state.checkpoint = "";
```

---

## Streaming Best Practices

### Token Buffering

L0 uses O(n) token accumulation internally. For custom processing:

```typescript
// Good - efficient accumulation
const tokens: string[] = [];
for await (const event of result.stream) {
  if (event.type === "token") tokens.push(event.value);
}
const content = tokens.join("");

// Avoid - O(n^2) string concatenation
let content = "";
for await (const event of result.stream) {
  if (event.type === "token") content += event.value;  // Slow for large outputs
}
```

### Concurrent Streams

Use `AbortController` to cancel unused streams:

```typescript
const controller = new AbortController();

// Race multiple streams
const result = await Promise.race([
  l0({ stream: stream1, signal: controller.signal }),
  l0({ stream: stream2, signal: controller.signal })
]);

// Cancel losers
controller.abort();
```

---

## Document Window Tuning

### Chunk Size

Balance context vs. token limits:

```typescript
// Small chunks - more API calls, better context per chunk
createWindow(doc, { size: 1000, overlap: 100 })

// Large chunks - fewer calls, may exceed limits
createWindow(doc, { size: 4000, overlap: 400 })
```

**Recommendations by model:**
- **GPT-4o (128K context):** 4000-8000 tokens/chunk
- **GPT-4o-mini (128K context):** 4000-8000 tokens/chunk  
- **Claude 3.5 (200K context):** 8000-16000 tokens/chunk
- **Gemini 1.5 (1M context):** 16000+ tokens/chunk

### Overlap Strategy

Maintain context between chunks:

```typescript
// 10% overlap (standard)
createWindow(doc, { size: 2000, overlap: 200 })

// 20% overlap (better continuity)
createWindow(doc, { size: 2000, overlap: 400 })

// No overlap (independent chunks)
createWindow(doc, { size: 2000, overlap: 0 })
```

### Parallel Processing

Process chunks concurrently:

```typescript
const results = await window.processAll(
  (chunk) => ({ stream: () => streamText({ model, prompt: chunk.content }) }),
  { concurrency: 3 }  // Process 3 chunks at a time
);
```

---

## Consensus Optimization

### Stream Count

Balance confidence vs. cost:

```typescript
// Minimum (low confidence)
consensus({ streams: [s1, s2] })

// Recommended (good confidence)
consensus({ streams: [s1, s2, s3] })

// High confidence (expensive)
consensus({ streams: [s1, s2, s3, s4, s5] })
```

### Strategy Selection

Choose based on requirements:

```typescript
// Majority - fastest, good for most cases
consensus({ strategy: "majority", threshold: 0.6 })

// Unanimous - strict, may fail more often
consensus({ strategy: "unanimous", threshold: 1.0 })

// Weighted - when some sources are more reliable
consensus({ strategy: "weighted", weights: [1.0, 0.8, 0.6] })
```

### Early Termination

For structured output comparison, L0 uses early termination in deep equality checks. This means consensus returns faster when outputs obviously differ.

---

## Benchmarks

Typical performance characteristics (measured on Node.js 20):

| Operation | Latency | Notes |
|-----------|---------|-------|
| Guardrail check (JSON) | <0.1ms | Per check interval |
| Guardrail check (Markdown) | <0.2ms | Per check interval |
| Pattern detection | <0.5ms | Depends on pattern count |
| Deep equality check | <1ms | With early termination |
| Structural similarity | 1-5ms | Depends on object depth |
| Token accumulation | O(n) | Linear with token count |

---

## Production Checklist

- [ ] Set appropriate timeouts for your model
- [ ] Configure retry limits to balance reliability vs. latency
- [ ] Select only needed guardrails
- [ ] Set `maxErrorHistory` for long-running processes
- [ ] Use appropriate chunk sizes for document windows
- [ ] Pre-compile regex patterns for custom guardrails
- [ ] Consume all streams to prevent memory leaks
- [ ] Use `AbortController` for cancellation
