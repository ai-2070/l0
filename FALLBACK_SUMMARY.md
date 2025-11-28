# Fall-Through Model Retries — Quick Reference

**TL;DR:** Automatic fallback to cheaper/alternative models when primary model fails. Critical for 99.9% uptime in production.

---

## ⚡ Quick Start

```typescript
import { l0, recommendedRetry } from 'l0';
import { openai } from '@ai-sdk/openai';

const result = await l0({
  stream: () => streamText({ model: openai('gpt-4o'), prompt }),
  fallbackStreams: [
    () => streamText({ model: openai('gpt-4o-mini'), prompt }),
    () => streamText({ model: openai('gpt-3.5-turbo'), prompt })
  ],
  retry: recommendedRetry
});

// Check which model succeeded
console.log(`Model index: ${result.state.fallbackIndex}`);
// 0 = primary, 1 = fallback 1, 2 = fallback 2
```

---

## 🎯 Key Concepts

### Execution Flow

```
Primary (gpt-4o)
  → Retry 1
  → Retry 2
  ✗ All retries exhausted
  
Fallback 1 (gpt-4o-mini)
  → Retry 1
  ✓ Success! (Return response)
```

### Cost vs. Availability

| Models | Uptime | Avg Cost | Use Case |
|--------|--------|----------|----------|
| 1 (no fallback) | 95% | $0.10 | Low priority |
| 2 (1 fallback) | 99.5% | $0.11 | Standard |
| 3 (2 fallbacks) | 99.9% | $0.12 | Critical |
| 4 (3 fallbacks) | 99.99% | $0.13 | Mission-critical |

---

## 🆚 Fall-Through vs. Race

### Fall-Through (Sequential) — This Feature

```typescript
// Try one at a time, fallback if fails
fallbackStreams: [model1, model2, model3]
```

- **Cost:** Low (1 model at a time)
- **Latency:** Higher (sequential)
- **Waste:** None
- **Best for:** High availability + cost optimization

### Race (Parallel) — Different Feature

```typescript
// Call all at once, take fastest
race([model1, model2, model3])
```

- **Cost:** High (all models)
- **Latency:** Lower (parallel)
- **Waste:** High (unused responses)
- **Best for:** Ultra-low latency

---

## 💡 Common Patterns

### Pattern 1: Cost Optimization (Same Provider)

```typescript
fallbackStreams: [
  () => streamText({ model: openai('gpt-4o'), prompt }),      // Best
  () => streamText({ model: openai('gpt-4o-mini'), prompt }), // Cheaper
  () => streamText({ model: openai('gpt-3.5-turbo'), prompt }) // Cheapest
]
```

**Use:** Try expensive model first, degrade to cheaper if unavailable

---

### Pattern 2: Multi-Provider High Availability

```typescript
fallbackStreams: [
  () => streamText({ model: openai('gpt-4o'), prompt }),       // OpenAI
  () => streamText({ model: anthropic('claude-3'), prompt }), // Anthropic
  () => streamText({ model: google('gemini-pro'), prompt })   // Google
]
```

**Use:** Survive entire provider outages

---

### Pattern 3: Quality + Availability

```typescript
fallbackStreams: [
  () => streamText({ model: openai('gpt-4o'), prompt }),         // Best quality
  () => streamText({ model: anthropic('claude-3-opus'), prompt }), // Alternative best
  () => streamText({ model: openai('gpt-4o-mini'), prompt }),    // Good enough
  () => streamText({ model: anthropic('claude-3-haiku'), prompt }) // Last resort
]
```

**Use:** Maximum quality with ultimate fallback safety

---

## 📊 Real-World Example: Financial App

```typescript
async function validateTransaction(txData: any) {
  const prompt = `Validate transaction: ${JSON.stringify(txData)}`;
  
  const result = await l0({
    stream: () => streamText({
      model: openai('gpt-4o'),
      prompt,
      response_format: { type: 'json' }
    }),
    fallbackStreams: [
      () => streamText({
        model: openai('gpt-4o-mini'),
        prompt,
        response_format: { type: 'json' }
      }),
      () => streamText({
        model: anthropic('claude-3-haiku'),
        prompt
      })
    ],
    retry: {
      attempts: 2,
      backoff: 'exponential',
      baseDelay: 500
    },
    monitoring: {
      enabled: true,
      metadata: {
        transaction_id: txData.id,
        amount: txData.amount,
        critical: true
      }
    }
  });
  
  let response = '';
  for await (const event of result.stream) {
    if (event.type === 'token' && event.value) {
      response += event.value;
    }
  }
  
  return {
    validation: JSON.parse(response),
    modelUsed: result.state.fallbackIndex === 0 ? 'primary' : `fallback-${result.state.fallbackIndex}`,
    retries: result.state.retryAttempts
  };
}
```

**Result:** 99.9% uptime, validates every transaction even during provider outages

---

## 🔍 Monitoring & Telemetry

### Check Which Model Was Used

```typescript
if (result.state.fallbackIndex === 0) {
  console.log('Primary model succeeded');
} else {
  console.log(`Fallback ${result.state.fallbackIndex} was used`);
}
```

### Track Fallback Events

```typescript
const fallbackEvents = result.telemetry?.metadata?.customEvents?.filter(
  e => e.type === 'fallback'
) || [];

console.log('Fallback events:', fallbackEvents);
```

### Alert on High Fallback Usage

```typescript
if (result.state.fallbackIndex > 0) {
  // Log to monitoring system
  logger.warn('Primary model failed', {
    fallbackIndex: result.state.fallbackIndex,
    retries: result.state.retryAttempts,
    request_id: requestId
  });
}

if (result.state.fallbackIndex >= 2) {
  // Critical alert: multiple fallbacks triggered
  alerts.critical('Multiple fallbacks used', { fallbackIndex: result.state.fallbackIndex });
}
```

---

## ✅ When to Use Fall-Through Retries

### Perfect For:

- ✅ **Financial applications** — Must never fail, cost-conscious
- ✅ **Healthcare systems** — Reliability critical, lives may depend on it
- ✅ **E-commerce** — Downtime = lost revenue
- ✅ **Batch processing** — Must complete, not latency-sensitive
- ✅ **Enterprise SaaS** — SLA requirements, 99.9% uptime

### Not Ideal For:

- ❌ **Real-time chat** — Use `race()` for lower latency
- ❌ **Cost-insensitive systems** — Use parallel redundancy
- ❌ **Simple prototypes** — Overkill for non-critical apps

---

## 🚨 Common Mistakes

### ❌ Mistake 1: Different Prompts for Each Model

```typescript
// BAD: Inconsistent behavior
fallbackStreams: [
  () => streamText({ model: modelA, prompt: 'Detailed analysis...' }),
  () => streamText({ model: modelB, prompt: 'Quick check...' })
]
```

```typescript
// GOOD: Same prompt for all
const prompt = 'Analyze this data';
fallbackStreams: [
  () => streamText({ model: modelA, prompt }),
  () => streamText({ model: modelB, prompt })
]
```

---

### ❌ Mistake 2: Too Many Retry Attempts

```typescript
// BAD: 5 attempts × 4 models = 20 total attempts (slow!)
retry: { attempts: 5 }
fallbackStreams: [model1, model2, model3]
```

```typescript
// GOOD: 2 attempts × 4 models = 8 total attempts
retry: { attempts: 2 }
fallbackStreams: [model1, model2, model3]
```

---

### ❌ Mistake 3: All Fallbacks Same Provider

```typescript
// BAD: If OpenAI is down, all fail
fallbackStreams: [
  () => streamText({ model: openai('gpt-4o-mini'), prompt }),
  () => streamText({ model: openai('gpt-3.5-turbo'), prompt })
]
```

```typescript
// GOOD: Multi-provider ensures true HA
fallbackStreams: [
  () => streamText({ model: openai('gpt-4o-mini'), prompt }),
  () => streamText({ model: anthropic('claude-3-haiku'), prompt }),
  () => streamText({ model: google('gemini-flash'), prompt })
]
```

---

## 📈 Performance Characteristics

### Latency

```
Success on primary:       1000ms (1 model attempt)
Success on fallback 1:    3000ms (primary fail + fallback 1)
Success on fallback 2:    5000ms (primary + fallback 1 fail + fallback 2)
All fail:                 7000ms (all models exhausted)
```

### Cost

```
95% success on primary:     $0.095 (0.95 × $0.10)
4% success on fallback 1:   $0.0048 (0.04 × ($0.10 + $0.02))
1% success on fallback 2:   $0.0014 (0.01 × ($0.10 + $0.02 + $0.02))

Average cost per request:   $0.101
```

### Reliability

```
Primary uptime:       95%
Fallback 1 uptime:    95%
Fallback 2 uptime:    95%

Combined uptime:      1 - (0.05 × 0.05 × 0.05) = 99.9875%
```

---

## 🔗 Related Documentation

- [FALLBACK_MODELS.md](./FALLBACK_MODELS.md) — Complete guide with examples
- [INTERCEPTORS_AND_PARALLEL.md](./INTERCEPTORS_AND_PARALLEL.md) — Parallel operations and race patterns
- [README.md](./README.md) — Main L0 documentation
- [NETWORK_ERRORS.md](./NETWORK_ERRORS.md) — Network error handling

---

## 💬 FAQ

**Q: Can I mix providers in fallbacks?**  
A: Yes! This is recommended for true high availability.

**Q: Do fallbacks increase cost?**  
A: Only if used. Unused fallbacks cost nothing.

**Q: How many fallbacks should I have?**  
A: 1-2 for standard apps, 3+ for mission-critical systems.

**Q: Can I use different prompts for fallbacks?**  
A: Technically yes, but not recommended. Keep prompts consistent.

**Q: What if all fallbacks fail?**  
A: Throws error: `"All streams exhausted (primary + N fallbacks)"`

**Q: Can I combine fall-through with race?**  
A: Yes! Use `race()` as your primary stream, fallbacks for safety.

---

## 🎓 Key Takeaways

1. **Fall-Through = Sequential Fallback** (one at a time)
2. **Each model gets full retry attempts** (2-3 retries per model)
3. **Only pay for models you use** (no wasted tokens)
4. **Perfect for high availability + cost optimization**
5. **Track usage with `state.fallbackIndex`** (0 = primary)
6. **Use different providers** for true reliability
7. **Keep prompts consistent** across all models

---

**Ready to implement?** See [FALLBACK_MODELS.md](./FALLBACK_MODELS.md) for complete examples and best practices.