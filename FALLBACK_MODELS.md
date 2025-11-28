# Fall-Through Model Retries

**Automatic fallback to cheaper/alternative models when primary model fails.**

L0 supports automatic model fallback when the primary model exhausts all retry attempts. This is **critical for financial/enterprise apps** where reliability is more important than using a specific model.

---

## Table of Contents

- [Overview](#overview)
- [Basic Usage](#basic-usage)
- [How It Works](#how-it-works)
- [Configuration](#configuration)
- [Real-World Examples](#real-world-examples)
- [Benefits](#benefits)
- [Use Cases](#use-cases)
- [vs. Multi-Model Redundancy](#vs-multi-model-redundancy)
- [Best Practices](#best-practices)
- [Telemetry & Monitoring](#telemetry--monitoring)

---

## Overview

Fall-Through Model Retries enable automatic, sequential fallback to alternative models when the primary model fails. Each model in the chain gets its own full retry attempts, ensuring maximum reliability without wasting tokens on unused models.

### Key Characteristics

- ✅ **Sequential execution** — One model at a time
- ✅ **Cost-efficient** — Only pay for models actually used
- ✅ **Full retry logic** — Each model gets complete retry attempts
- ✅ **Transparent** — Consuming code doesn't need to know about fallbacks
- ✅ **Telemetry** — Track which model succeeded via `state.fallbackIndex`
- ✅ **Enterprise-grade** — 99.9%+ uptime possible

---

## Basic Usage

```typescript
import { l0, recommendedRetry } from 'l0';
import { openai } from '@ai-sdk/openai';

const result = await l0({
  // Primary model
  stream: () => streamText({ 
    model: openai('gpt-4o'), 
    prompt: 'Analyze this transaction' 
  }),
  
  // Fallback models (tried in order if primary fails)
  fallbackStreams: [
    () => streamText({ 
      model: openai('gpt-4o-mini'), 
      prompt: 'Analyze this transaction' 
    }),
    () => streamText({ 
      model: openai('gpt-3.5-turbo'), 
      prompt: 'Analyze this transaction' 
    })
  ],
  
  retry: recommendedRetry
});

// Consume stream normally
for await (const event of result.stream) {
  if (event.type === 'token') {
    process.stdout.write(event.value || '');
  }
}

// Check which model was used
console.log(`Model used: ${result.state.fallbackIndex === 0 ? 'primary' : `fallback ${result.state.fallbackIndex}`}`);
```

---

## How It Works

### Execution Flow

1. **Primary Model (Index 0)**
   - Attempts with full retry logic (e.g., 2 retries)
   - If successful → done, return response
   - If all retries exhausted → proceed to fallback 1

2. **Fallback 1 (Index 1)**
   - Attempts with full retry logic (e.g., 2 retries)
   - If successful → done, return response
   - If all retries exhausted → proceed to fallback 2

3. **Fallback 2 (Index 2)**
   - Attempts with full retry logic (e.g., 2 retries)
   - If successful → done, return response
   - If all retries exhausted → throw error

4. **All Models Exhausted**
   - Throws: `"All streams exhausted (primary + N fallbacks)"`

### State Tracking

```typescript
result.state.fallbackIndex  // 0 = primary, 1+ = fallback number
result.state.retryAttempts  // Retry count for current model
result.state.completed      // Whether any model succeeded
```

---

## Configuration

### With Custom Retry Logic

```typescript
const result = await l0({
  stream: () => streamText({ model: openai('gpt-4o'), prompt }),
  fallbackStreams: [
    () => streamText({ model: openai('gpt-4o-mini'), prompt })
  ],
  retry: {
    attempts: 3,              // Each model gets 3 retry attempts
    backoff: 'exponential',   // Exponential backoff
    baseDelay: 1000,          // 1 second base delay
    maxDelay: 10000           // 10 second max delay
  }
});
```

### With Monitoring

```typescript
const result = await l0({
  stream: () => streamText({ model: openai('gpt-4o'), prompt }),
  fallbackStreams: [
    () => streamText({ model: openai('gpt-4o-mini'), prompt })
  ],
  monitoring: {
    enabled: true,
    metadata: {
      transaction_id: 'txn_12345',
      critical: true
    }
  },
  onRetry: (attempt, reason) => {
    console.log(`Retry ${attempt}: ${reason}`);
  }
});

// Check telemetry
if (result.telemetry?.metadata?.customEvents) {
  const fallbackEvents = result.telemetry.metadata.customEvents.filter(
    e => e.type === 'fallback'
  );
  console.log('Fallback events:', fallbackEvents);
}
```

### With Guardrails

```typescript
import { recommendedGuardrails } from 'l0';

const result = await l0({
  stream: () => streamText({ model: openai('gpt-4o'), prompt }),
  fallbackStreams: [
    () => streamText({ model: openai('gpt-4o-mini'), prompt })
  ],
  guardrails: recommendedGuardrails,  // Applied to all models
  retry: recommendedRetry
});
```

---

## Real-World Examples

### Example 1: Financial Transaction Validation

```typescript
async function validateTransaction(txData: TransactionData) {
  const prompt = `Validate this transaction: ${JSON.stringify(txData)}`;
  
  const result = await l0({
    stream: () => streamText({
      model: openai('gpt-4o'),
      prompt,
      response_format: { type: 'json' }
    }),
    fallbackStreams: [
      // Fallback 1: Cheaper OpenAI model
      () => streamText({
        model: openai('gpt-4o-mini'),
        prompt,
        response_format: { type: 'json' }
      }),
      // Fallback 2: Alternative provider
      () => streamText({
        model: anthropic('claude-3-haiku'),
        prompt,
        response_format: { type: 'json' }
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
  
  let jsonResponse = '';
  for await (const event of result.stream) {
    if (event.type === 'token' && event.value) {
      jsonResponse += event.value;
    }
  }
  
  const validation = JSON.parse(jsonResponse);
  
  return {
    validation,
    modelUsed: result.state.fallbackIndex === 0 ? 'gpt-4o' : `fallback-${result.state.fallbackIndex}`,
    retries: result.state.retryAttempts,
    success: result.state.completed
  };
}
```

### Example 2: Multi-Provider High Availability

```typescript
import { openai } from '@ai-sdk/openai';
import { anthropic } from '@ai-sdk/anthropic';
import { google } from '@ai-sdk/google';

const result = await l0({
  // Primary: OpenAI GPT-4o
  stream: () => streamText({
    model: openai('gpt-4o'),
    prompt: 'Critical query requiring high availability'
  }),
  
  fallbackStreams: [
    // Fallback 1: Anthropic Claude
    () => streamText({
      model: anthropic('claude-3-opus'),
      prompt: 'Critical query requiring high availability'
    }),
    
    // Fallback 2: Google Gemini
    () => streamText({
      model: google('gemini-pro'),
      prompt: 'Critical query requiring high availability'
    }),
    
    // Fallback 3: OpenAI budget model (last resort)
    () => streamText({
      model: openai('gpt-3.5-turbo'),
      prompt: 'Critical query requiring high availability'
    })
  ],
  
  retry: recommendedRetry
});

// System stays online even if entire provider goes down
```

### Example 3: Batch Processing with Cost Optimization

```typescript
async function processBatch(items: string[]) {
  const results = [];
  
  for (const item of items) {
    const result = await l0({
      stream: () => streamText({
        model: openai('gpt-4o'),
        prompt: `Process: ${item}`
      }),
      fallbackStreams: [
        // Try cheaper model if primary unavailable
        () => streamText({
          model: openai('gpt-4o-mini'),
          prompt: `Process: ${item}`
        })
      ],
      retry: {
        attempts: 1,  // Fast failure per model
        backoff: 'fixed',
        baseDelay: 500
      }
    });
    
    let content = '';
    for await (const event of result.stream) {
      if (event.type === 'token' && event.value) {
        content += event.value;
      }
    }
    
    results.push({
      item,
      content,
      modelUsed: result.state.fallbackIndex === 0 ? 'primary' : 'fallback',
      cost: result.state.fallbackIndex === 0 ? 'high' : 'low'
    });
  }
  
  return results;
}
```

---

## Benefits

### 1. **High Availability (99.9%+ Uptime)**

With multiple fallbacks, your system continues operating even if:
- Primary model is unavailable
- Provider has an outage
- Rate limits are hit
- Model is deprecated/removed

### 2. **Cost Optimization**

Only pay for models you actually use:
- Primary model succeeds → Pay for 1 model
- Fallback 1 succeeds → Pay for 2 models (primary attempts + fallback)
- No wasted tokens on unused fallbacks

**Cost Example:**
```
Primary (GPT-4o): $0.10/request
Fallback (GPT-4o-mini): $0.02/request

Success rate: 95% on primary, 4% on fallback, 1% on second fallback

Average cost = (0.95 × $0.10) + (0.04 × $0.12) + (0.01 × $0.14)
            = $0.095 + $0.0048 + $0.0014
            = $0.101 per request

vs. Always using GPT-4o: $0.10/request
vs. Always using mini: $0.02/request (lower quality)
```

### 3. **Graceful Degradation**

Maintain quality when possible, degrade gracefully when necessary:
- Try best model first (highest quality)
- Fallback to good-enough models if needed
- Better than complete failure

### 4. **Transparent to Application Code**

```typescript
// Application code doesn't need to know about fallbacks
const result = await validateTransaction(txData);
// Just works, regardless of which model succeeded
```

### 5. **Production-Ready Telemetry**

Track which models are used, when fallbacks trigger, etc:
```typescript
console.log(`Model index: ${result.state.fallbackIndex}`);
console.log(`Retries: ${result.state.retryAttempts}`);
console.log(`Telemetry:`, result.telemetry);
```

---

## Use Cases

### ✅ **Financial Applications**
- Transaction validation
- Fraud detection
- Risk assessment
- Compliance checks

**Why:** Must never fail, but cost matters. Fallbacks ensure 99.9% uptime.

---

### ✅ **Healthcare Systems**
- Patient data processing
- Medical record analysis
- Treatment recommendations
- Diagnostic assistance

**Why:** Reliability is critical, lives may depend on it.

---

### ✅ **E-commerce Platforms**
- Order processing
- Inventory analysis
- Customer support
- Recommendation engines

**Why:** Downtime = lost revenue. Fallbacks ensure continuous operation.

---

### ✅ **Batch Processing**
- Document analysis
- Data extraction
- Content moderation
- Report generation

**Why:** Not latency-sensitive, but must complete successfully.

---

### ✅ **Enterprise SaaS**
- Workflow automation
- Data validation
- Business intelligence
- Integration pipelines

**Why:** Enterprise customers demand reliability, SLAs require high uptime.

---

## vs. Multi-Model Redundancy

Fall-Through Retries and Multi-Model Redundancy are **different patterns** that solve different problems.

### Fall-Through Model Retries (This Feature)

**Sequential fallback** — Try one at a time:

```typescript
const result = await l0({
  stream: () => streamText({ model: openai('gpt-4o'), prompt }),
  fallbackStreams: [
    () => streamText({ model: openai('gpt-4o-mini'), prompt })
  ]
});
// Execution: GPT-4o → (fails) → GPT-4o-mini
```

- ⏱️ Higher latency (sequential)
- 💰 Lower cost (pay for 1 at a time)
- 🎯 Predictable order
- ✅ No token waste

**Best for:** High availability, cost optimization, batch processing

---

### Multi-Model Redundancy (Race Pattern)

**Parallel race** — Call all at once:

```typescript
import { race } from 'l0';

const result = await race([
  () => streamText({ model: openai('gpt-4o'), prompt }),
  () => streamText({ model: anthropic('claude'), prompt })
]);
// Execution: Both called simultaneously → fastest wins
```

- ⚡ Lower latency (parallel)
- 💸 Higher cost (pay for all)
- 🎲 Non-deterministic
- ❌ Wastes tokens

**Best for:** Real-time chat, ultra-low latency, cost-insensitive

---

### Comparison Table

| Aspect | Fall-Through | Multi-Model Redundancy |
|--------|--------------|------------------------|
| **Execution** | Sequential | Parallel |
| **Latency** | Higher (sum) | Lower (min) |
| **Cost** | Low (1 at a time) | High (all at once) |
| **Waste** | None | High |
| **Predictability** | High | Low |
| **Use Case** | Availability + Cost | Speed + Redundancy |

---

## Best Practices

### 1. **Order Models by Quality, Then Cost**

```typescript
fallbackStreams: [
  () => streamText({ model: openai('gpt-4o'), prompt }),      // Best quality
  () => streamText({ model: openai('gpt-4o-mini'), prompt }), // Good quality, cheaper
  () => streamText({ model: openai('gpt-3.5-turbo'), prompt }) // Acceptable, cheapest
]
```

### 2. **Use Different Providers for True High Availability**

```typescript
fallbackStreams: [
  () => streamText({ model: openai('gpt-4o-mini'), prompt }),    // OpenAI
  () => streamText({ model: anthropic('claude-3-haiku'), prompt }), // Anthropic
  () => streamText({ model: google('gemini-flash'), prompt })     // Google
]
// If one provider is down, others work
```

### 3. **Adjust Retry Attempts Based on Urgency**

```typescript
// High availability, willing to wait
retry: { attempts: 3 }  // 3 attempts × 3 models = 9 total attempts

// Fast failure preferred
retry: { attempts: 1 }  // 1 attempt × 3 models = 3 total attempts
```

### 4. **Monitor Fallback Usage**

```typescript
const result = await l0({ /* config */ });

if (result.state.fallbackIndex > 0) {
  // Log to your monitoring system
  logger.warn('Primary model failed, used fallback', {
    fallbackIndex: result.state.fallbackIndex,
    retries: result.state.retryAttempts
  });
}
```

### 5. **Keep Prompts Consistent Across Models**

```typescript
const prompt = 'Analyze transaction for fraud';

// ✅ Good: Same prompt for all models
fallbackStreams: [
  () => streamText({ model: modelA, prompt }),
  () => streamText({ model: modelB, prompt })
]

// ❌ Bad: Different prompts (inconsistent behavior)
fallbackStreams: [
  () => streamText({ model: modelA, prompt: 'Detailed analysis...' }),
  () => streamText({ model: modelB, prompt: 'Quick check...' })
]
```

### 6. **Use Guardrails to Ensure Quality Across Fallbacks**

```typescript
import { recommendedGuardrails } from 'l0';

const result = await l0({
  stream: () => streamText({ model: primary, prompt }),
  fallbackStreams: [fallback1, fallback2],
  guardrails: recommendedGuardrails  // Ensures all models meet quality bar
});
```

---

## Telemetry & Monitoring

### Tracking Fallback Usage

```typescript
const result = await l0({
  stream: () => streamText({ model: openai('gpt-4o'), prompt }),
  fallbackStreams: [
    () => streamText({ model: openai('gpt-4o-mini'), prompt })
  ],
  monitoring: {
    enabled: true,
    metadata: {
      request_id: 'req_123',
      user_id: 'user_456'
    }
  }
});

// Check which model was used
const modelIndex = result.state.fallbackIndex;
console.log(`Model used: ${modelIndex === 0 ? 'primary' : `fallback ${modelIndex}`}`);

// Check telemetry
if (result.telemetry) {
  console.log('Total tokens:', result.telemetry.metrics.totalTokens);
  console.log('Total retries:', result.telemetry.metrics.totalRetries);
  console.log('Duration:', result.telemetry.duration);
  
  // Fallback events
  const customEvents = result.telemetry.metadata?.customEvents || [];
  const fallbackEvents = customEvents.filter(e => e.type === 'fallback');
  console.log('Fallback events:', fallbackEvents);
}
```

### Aggregate Metrics

Track fallback usage across your application:

```typescript
// In your monitoring/logging system
function trackModelUsage(result: L0Result) {
  metrics.increment('llm.requests.total');
  
  if (result.state.fallbackIndex === 0) {
    metrics.increment('llm.model.primary.success');
  } else {
    metrics.increment(`llm.model.fallback${result.state.fallbackIndex}.success`);
  }
  
  metrics.gauge('llm.retries', result.state.retryAttempts);
  metrics.gauge('llm.tokens', result.state.tokenCount);
}
```

### Alerting

Set up alerts for high fallback usage:

```typescript
if (result.state.fallbackIndex > 0) {
  // Alert if primary model is failing frequently
  if (result.state.fallbackIndex >= 2) {
    alerts.critical('Multiple fallbacks triggered', {
      fallbackIndex: result.state.fallbackIndex,
      request_id: requestId
    });
  } else {
    alerts.warning('Primary model failed, using fallback', {
      fallbackIndex: result.state.fallbackIndex
    });
  }
}
```

---

## Summary

Fall-Through Model Retries provide:

✅ **High Availability** — 99.9%+ uptime with multiple fallbacks  
✅ **Cost Optimization** — Only pay for models actually used  
✅ **Graceful Degradation** — Try best model first, fallback if needed  
✅ **Production-Ready** — Full retry logic, monitoring, telemetry  
✅ **Transparent** — No code changes required in application logic  
✅ **Enterprise-Grade** — Perfect for financial, healthcare, and critical systems  

**When to use:**
- Financial/enterprise applications requiring high reliability
- Cost-conscious systems that still need quality
- Batch processing that must complete successfully
- Any system where downtime is unacceptable

**When NOT to use:**
- Real-time chat requiring sub-second latency (use `race()` instead)
- Systems where cost doesn't matter (use parallel redundancy)
- Simple applications with no reliability requirements

---

## See Also

- [README.md](./README.md) — Main L0 documentation
- [INTERCEPTORS_AND_PARALLEL.md](./INTERCEPTORS_AND_PARALLEL.md) — Parallel operations and race patterns
- [NETWORK_ERRORS.md](./NETWORK_ERRORS.md) — Network error handling
- [MONITORING.md](./MONITORING.md) — Built-in telemetry system