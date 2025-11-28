# Interceptors & Parallel Operations

Complete guide to L0's interceptor system and parallel operations for advanced control over LLM workflows.

## Table of Contents

- [Interceptors](#interceptors)
  - [Overview](#overview)
  - [Basic Usage](#basic-usage)
  - [Built-In Interceptors](#built-in-interceptors)
  - [Custom Interceptors](#custom-interceptors)
  - [Use Cases](#interceptor-use-cases)
- [Parallel Operations](#parallel-operations)
  - [Overview](#parallel-overview)
  - [Basic Usage](#parallel-basic-usage)
  - [Concurrency Control](#concurrency-control)
  - [Advanced Patterns](#advanced-patterns)

---

## Interceptors

### Overview

Interceptors provide hooks into the L0 execution pipeline, similar to fetch interceptors. They allow you to:

**Before Execution:**
- Preprocess prompts
- Inject metadata
- Add authentication
- Rate limit requests
- Log requests
- Modify configuration

**After Execution:**
- Inspect final output
- Post-process content
- Transform results
- Validate output
- Log results
- Track analytics

**On Error:**
- Handle failures
- Log errors
- Send alerts
- Retry logic

### Basic Usage

```typescript
import { l0, loggingInterceptor } from 'l0';
import { streamText } from 'ai';

const result = await l0({
  stream: () => streamText({ model, prompt }),
  interceptors: [
    loggingInterceptor()
  ]
});

// Interceptor automatically logs before/after execution
```

### Interceptor Interface

```typescript
interface L0Interceptor {
  // Optional name for debugging
  name?: string;

  // Before hook - runs before stream starts
  before?: (options: L0Options) => L0Options | Promise<L0Options>;

  // After hook - runs after stream completes
  after?: (result: L0Result) => L0Result | Promise<L0Result>;

  // Error hook - runs if an error occurs
  onError?: (error: Error, options: L0Options) => void | Promise<void>;
}
```

### Built-In Interceptors

#### 1. Logging Interceptor

Logs all L0 operations with structured data.

```typescript
import { l0, loggingInterceptor } from 'l0';

const result = await l0({
  stream: () => streamText({ model, prompt }),
  interceptors: [
    loggingInterceptor(console) // Or your custom logger
  ]
});

// Logs:
// "L0 execution starting" { hasGuardrails: true, hasRetry: true, ... }
// "L0 execution completed" { completed: true, tokens: 150, retries: 0, ... }
```

#### 2. Metadata Interceptor

Injects metadata into monitoring automatically.

```typescript
import { metadataInterceptor } from 'l0';

const result = await l0({
  stream: () => streamText({ model, prompt }),
  monitoring: { enabled: true },
  interceptors: [
    metadataInterceptor({
      user_id: 'user_123',
      request_id: generateRequestId(),
      environment: 'production',
      model: 'gpt-4'
    })
  ]
});

// Metadata is automatically added to telemetry
console.log(result.telemetry.metadata);
```

#### 3. Authentication Interceptor

Adds authentication tokens or headers.

```typescript
import { authInterceptor } from 'l0';

const result = await l0({
  stream: () => streamText({ model, prompt }),
  interceptors: [
    authInterceptor(async () => {
      // Fetch auth token
      const token = await getAuthToken();
      return { token, user_id: userId };
    })
  ]
});
```

#### 4. Timing Interceptor

Adds detailed timing information.

```typescript
import { timingInterceptor } from 'l0';

const result = await l0({
  stream: () => streamText({ model, prompt }),
  interceptors: [
    timingInterceptor()
  ]
});

// Automatically tracks timing in telemetry
```

#### 5. Validation Interceptor

Validates output against custom rules.

```typescript
import { validationInterceptor } from 'l0';

const result = await l0({
  stream: () => streamText({ model, prompt }),
  interceptors: [
    validationInterceptor(
      (content) => content.length >= 100, // Must be at least 100 chars
      (content) => {
        console.error('Output too short:', content.length);
      }
    )
  ]
});
```

#### 6. Rate Limit Interceptor

Throttles requests to prevent overwhelming the API.

```typescript
import { rateLimitInterceptor } from 'l0';

const result = await l0({
  stream: () => streamText({ model, prompt }),
  interceptors: [
    rateLimitInterceptor(10, 60000) // Max 10 requests per 60 seconds
  ]
});
```

#### 7. Transform Interceptor

Post-processes output content.

```typescript
import { transformInterceptor } from 'l0';

const result = await l0({
  stream: () => streamText({ model, prompt }),
  interceptors: [
    transformInterceptor((content) => {
      // Remove markdown formatting
      return content.replace(/[*_`]/g, '');
    })
  ]
});

// result.state.content is transformed
```

#### 8. Analytics Interceptor

Sends execution data to analytics services.

```typescript
import { analyticsInterceptor } from 'l0';

const result = await l0({
  stream: () => streamText({ model, prompt }),
  interceptors: [
    analyticsInterceptor(async (event, data) => {
      await analytics.track(event, data);
    })
  ]
});

// Automatically tracks: l0_started, l0_completed, l0_failed
```

### Custom Interceptors

#### Simple Example

```typescript
const myInterceptor: L0Interceptor = {
  name: 'my-custom-interceptor',
  
  before: async (options) => {
    console.log('Starting execution...');
    return options;
  },
  
  after: async (result) => {
    console.log('Execution completed!');
    return result;
  },
  
  onError: async (error, options) => {
    console.error('Execution failed:', error.message);
  }
};

const result = await l0({
  stream: () => streamText({ model, prompt }),
  interceptors: [myInterceptor]
});
```

#### Preprocessing Prompts

```typescript
const promptPreprocessor: L0Interceptor = {
  name: 'prompt-preprocessor',
  before: async (options) => {
    // Modify the stream factory to preprocess the prompt
    const originalStream = options.stream;
    
    return {
      ...options,
      stream: () => {
        // Your preprocessing logic here
        const enhancedPrompt = `You are a helpful assistant. ${originalPrompt}`;
        return streamText({ model, prompt: enhancedPrompt });
      }
    };
  }
};
```

#### Output Validation

```typescript
const outputValidator: L0Interceptor = {
  name: 'output-validator',
  after: async (result) => {
    const content = result.state.content;
    
    // Validate JSON output
    if (!content.startsWith('{')) {
      throw new Error('Expected JSON output');
    }
    
    try {
      JSON.parse(content);
    } catch {
      throw new Error('Invalid JSON output');
    }
    
    return result;
  }
};
```

#### Caching

```typescript
const cache = new Map<string, L0Result>();

const cachingInterceptor: L0Interceptor = {
  name: 'caching',
  before: async (options) => {
    const cacheKey = JSON.stringify(options);
    
    if (cache.has(cacheKey)) {
      // Return cached result by throwing special error
      throw { cached: true, result: cache.get(cacheKey) };
    }
    
    return options;
  },
  after: async (result) => {
    const cacheKey = JSON.stringify(result.state);
    cache.set(cacheKey, result);
    return result;
  }
};
```

### Interceptor Use Cases

#### 1. Request Logging

```typescript
const requestLogger: L0Interceptor = {
  name: 'request-logger',
  before: async (options) => {
    logger.info('LLM Request', {
      timestamp: Date.now(),
      hasGuardrails: !!options.guardrails?.length,
      hasRetry: !!options.retry
    });
    return options;
  }
};
```

#### 2. Response Logging

```typescript
const responseLogger: L0Interceptor = {
  name: 'response-logger',
  after: async (result) => {
    logger.info('LLM Response', {
      tokens: result.state.tokenCount,
      duration: result.state.duration,
      completed: result.state.completed
    });
    return result;
  }
};
```

#### 3. Error Tracking

```typescript
const errorTracker: L0Interceptor = {
  name: 'error-tracker',
  onError: async (error, options) => {
    await errorTracking.captureException(error, {
      context: {
        hasGuardrails: !!options.guardrails?.length,
        hasRetry: !!options.retry
      }
    });
  }
};
```

#### 4. A/B Testing

```typescript
const abTestInterceptor: L0Interceptor = {
  name: 'ab-test',
  before: async (options) => {
    const variant = Math.random() < 0.5 ? 'A' : 'B';
    
    return {
      ...options,
      monitoring: {
        ...options.monitoring,
        enabled: true,
        metadata: {
          ...options.monitoring?.metadata,
          ab_variant: variant
        }
      }
    };
  }
};
```

#### 5. Content Moderation

```typescript
const moderationInterceptor: L0Interceptor = {
  name: 'moderation',
  after: async (result) => {
    const content = result.state.content;
    
    // Check for inappropriate content
    const isAppropriate = await moderationAPI.check(content);
    
    if (!isAppropriate) {
      throw new Error('Content moderation failed');
    }
    
    return result;
  }
};
```

### Chaining Interceptors

Interceptors execute in order:

```typescript
const result = await l0({
  stream: () => streamText({ model, prompt }),
  interceptors: [
    authInterceptor(getAuth),        // 1. Add auth
    rateLimitInterceptor(10, 60000), // 2. Check rate limit
    metadataInterceptor({ user_id }), // 3. Add metadata
    loggingInterceptor(),            // 4. Log request
    validationInterceptor(validate), // 5. Validate output (after)
    transformInterceptor(transform), // 6. Transform output (after)
    analyticsInterceptor(track)      // 7. Track analytics (after)
  ]
});

// Before hooks execute: 1 → 2 → 3 → 4
// After hooks execute: 5 → 6 → 7
```

---

## Parallel Operations

### Parallel Overview

L0 provides built-in support for running multiple LLM operations concurrently with:
- Concurrency control
- Progress tracking
- Error handling
- Result aggregation
- Telemetry aggregation

### Parallel Basic Usage

```typescript
import { parallel } from 'l0';
import { streamText } from 'ai';

const results = await parallel([
  { stream: () => streamText({ model, prompt: 'Translate to Spanish: Hello' }) },
  { stream: () => streamText({ model, prompt: 'Translate to French: Hello' }) },
  { stream: () => streamText({ model, prompt: 'Translate to German: Hello' }) }
], {
  concurrency: 2, // Run 2 at a time
  failFast: false // Continue even if one fails
});

console.log('Success:', results.successCount);
console.log('Failures:', results.failureCount);
console.log('Spanish:', results.results[0]?.state.content);
console.log('French:', results.results[1]?.state.content);
console.log('German:', results.results[2]?.state.content);
```

### Parallel Options

```typescript
interface ParallelOptions {
  // Maximum concurrent operations (default: 5)
  concurrency?: number;

  // Stop on first error (default: false)
  failFast?: boolean;

  // Shared retry config for all operations
  sharedRetry?: RetryOptions;

  // Shared monitoring config
  sharedMonitoring?: MonitoringConfig;

  // Progress callback
  onProgress?: (completed: number, total: number) => void;

  // Completion callback
  onComplete?: (result: L0Result, index: number) => void;

  // Error callback
  onError?: (error: Error, index: number) => void;
}
```

### Parallel Result

```typescript
interface ParallelResult {
  // Results (null for failed operations)
  results: Array<L0Result | null>;

  // Errors (null for successful operations)
  errors: Array<Error | null>;

  // Success count
  successCount: number;

  // Failure count
  failureCount: number;

  // Total duration
  duration: number;

  // Whether all succeeded
  allSucceeded: boolean;

  // Aggregated telemetry
  aggregatedTelemetry?: AggregatedTelemetry;
}
```

### Concurrency Control

#### Limited Concurrency

```typescript
// Run 3 operations at a time
const results = await parallel(operations, {
  concurrency: 3
});
```

#### Unlimited Concurrency

```typescript
import { parallelAll } from 'l0';

// Run all operations simultaneously
const results = await parallelAll(operations);
```

#### Sequential (One at a Time)

```typescript
import { sequential } from 'l0';

// Run operations one after another
const results = await sequential(operations);
```

### Advanced Patterns

#### Batched Execution

Process operations in batches:

```typescript
import { batched } from 'l0';

const results = await batched(
  operations,
  5, // Batch size
  {
    failFast: false,
    onProgress: (completed, total) => {
      console.log(`Progress: ${completed}/${total}`);
    }
  }
);
```

#### Race Operations

Return first successful result:

```typescript
import { race } from 'l0';

// Try multiple providers, use first to respond
const result = await race([
  { stream: () => streamText({ model: openai('gpt-4'), prompt }) },
  { stream: () => streamText({ model: anthropic('claude-3'), prompt }) },
  { stream: () => streamText({ model: google('gemini-pro'), prompt }) }
]);

console.log('Winner:', result.state.content);
```

#### Operation Pool

Reusable worker pool for processing many operations:

```typescript
import { createPool } from 'l0';

const pool = createPool(3, {
  sharedRetry: recommendedRetry,
  sharedMonitoring: { enabled: true }
});

// Add operations to pool
const results = await Promise.all([
  pool.execute({ stream: () => streamText({ model, prompt: 'Task 1' }) }),
  pool.execute({ stream: () => streamText({ model, prompt: 'Task 2' }) }),
  pool.execute({ stream: () => streamText({ model, prompt: 'Task 3' }) }),
  pool.execute({ stream: () => streamText({ model, prompt: 'Task 4' }) }),
  pool.execute({ stream: () => streamText({ model, prompt: 'Task 5' }) })
]);

// Wait for all operations
await pool.drain();

console.log('Queue length:', pool.getQueueLength());
console.log('Active workers:', pool.getActiveWorkers());
```

### Progress Tracking

```typescript
const results = await parallel(operations, {
  concurrency: 3,
  onProgress: (completed, total) => {
    const percent = ((completed / total) * 100).toFixed(1);
    console.log(`Progress: ${completed}/${total} (${percent}%)`);
  }
});
```

### Error Handling

```typescript
const results = await parallel(operations, {
  concurrency: 3,
  failFast: false, // Continue on errors
  onError: (error, index) => {
    console.error(`Operation ${index} failed:`, error.message);
  },
  onComplete: (result, index) => {
    console.log(`Operation ${index} completed: ${result.state.tokenCount} tokens`);
  }
});

// Check results
for (let i = 0; i < results.results.length; i++) {
  if (results.errors[i]) {
    console.error(`Error ${i}:`, results.errors[i].message);
  } else {
    console.log(`Result ${i}:`, results.results[i].state.content);
  }
}
```

### Shared Configuration

```typescript
const results = await parallel(operations, {
  concurrency: 3,
  sharedRetry: {
    attempts: 3,
    backoff: 'exponential'
  },
  sharedMonitoring: {
    enabled: true,
    sampleRate: 0.5
  }
});
```

### Aggregated Telemetry

```typescript
const results = await parallel(operations, {
  concurrency: 3,
  sharedMonitoring: { enabled: true }
});

// Access aggregated telemetry
const telemetry = results.aggregatedTelemetry;
console.log('Total tokens:', telemetry.totalTokens);
console.log('Total duration:', telemetry.totalDuration);
console.log('Avg tokens/sec:', telemetry.avgTokensPerSecond);
console.log('Avg TTFT:', telemetry.avgTimeToFirstToken);
console.log('Total retries:', telemetry.totalRetries);
console.log('Total network errors:', telemetry.totalNetworkErrors);
```

## Complete Examples

### Example 1: Authenticated Parallel Processing

```typescript
import { 
  parallel, 
  authInterceptor, 
  loggingInterceptor,
  metadataInterceptor 
} from 'l0';

const operations = prompts.map((prompt, index) => ({
  stream: () => streamText({ model, prompt }),
  interceptors: [
    authInterceptor(getAuthToken),
    metadataInterceptor({ prompt_id: index }),
    loggingInterceptor()
  ]
}));

const results = await parallel(operations, {
  concurrency: 5,
  sharedMonitoring: { enabled: true },
  onProgress: (completed, total) => {
    console.log(`${completed}/${total} completed`);
  }
});

console.log('All results:', results.aggregatedTelemetry);
```

### Example 2: Validation Pipeline

```typescript
import { l0, validationInterceptor, transformInterceptor } from 'l0';

const result = await l0({
  stream: () => streamText({ model, prompt: 'Generate JSON user data' }),
  interceptors: [
    // Validate it's JSON
    validationInterceptor(
      (content) => {
        try {
          JSON.parse(content);
          return true;
        } catch {
          return false;
        }
      }
    ),
    // Transform to add metadata
    transformInterceptor((content) => {
      const data = JSON.parse(content);
      return JSON.stringify({
        ...data,
        generated_at: new Date().toISOString(),
        version: '1.0'
      });
    })
  ]
});
```

### Example 3: Multi-Provider Fallback

```typescript
import { race } from 'l0';

const providers = [
  { name: 'OpenAI', stream: () => streamText({ model: openai('gpt-4'), prompt }) },
  { name: 'Anthropic', stream: () => streamText({ model: anthropic('claude-3'), prompt }) },
  { name: 'Google', stream: () => streamText({ model: google('gemini-pro'), prompt }) }
];

try {
  const result = await race(
    providers.map(p => p.stream),
    { sharedRetry: recommendedRetry }
  );
  console.log('Success with one of the providers');
} catch (error) {
  console.error('All providers failed');
}
```

### Example 4: Batch Translation

```typescript
import { batched } from 'l0';

const languages = ['Spanish', 'French', 'German', 'Italian', 'Portuguese'];
const texts = ['Hello', 'Goodbye', 'Thank you', 'Please', 'Yes'];

const operations = [];
for (const text of texts) {
  for (const lang of languages) {
    operations.push({
      stream: () => streamText({
        model,
        prompt: `Translate to ${lang}: ${text}`
      }),
      monitoring: {
        enabled: true,
        metadata: {
          source_text: text,
          target_language: lang,
          translation_batch: 'batch_001'
        }
      },
      guardrails: recommendedGuardrails,
      retry: recommendedRetry
    });
  }
}

// Process 5 translations at a time
const results = await batched(operations, {
  batchSize: 5,
  concurrency: 3,
  sharedRetry: recommendedRetry,
  sharedMonitoring: {
    enabled: true,
    metadata: {
      task: 'batch_translation',
      total_operations: operations.length
    }
  },
  onProgress: (completed, total, batch) => {
    console.log(`Batch ${batch}: ${completed}/${total} translations completed`);
  }
});

// Organize results by language
const translationsByLanguage = new Map<string, Map<string, string>>();

for (const result of results.results) {
  if (result.status === 'success') {
    const { source_text, target_language } = result.telemetry.metadata;
    
    if (!translationsByLanguage.has(target_language)) {
      translationsByLanguage.set(target_language, new Map());
    }
    
    const content = result.state.content;
    translationsByLanguage.get(target_language)!.set(source_text, content);
  } else {
    console.error(`Translation failed: ${result.error?.message}`);
  }
}

// Display results
console.log('\n=== Translation Results ===\n');
for (const [lang, translations] of translationsByLanguage) {
  console.log(`${lang}:`);
  for (const [source, translation] of translations) {
    console.log(`  ${source} → ${translation}`);
  }
  console.log();
}

// Summary statistics
const telemetry = results.aggregatedTelemetry;
console.log('Statistics:');
console.log(`  Total tokens: ${telemetry.totalTokens}`);
console.log(`  Average duration: ${telemetry.avgDuration}ms`);
console.log(`  Success rate: ${(results.successCount / results.total * 100).toFixed(1)}%`);
console.log(`  Total batches: ${results.results.length / 5}`);
```

This example demonstrates:
- Generating multiple translation operations programmatically
- Using `batched()` to process translations in controlled batches
- Adding metadata to track source text and target language
- Organizing results by language for easy consumption
- Computing statistics across all translations

---

### Example 5: Fall-Through Model Retries

**Automatic fallback to cheaper/alternative models for high availability.**

```typescript
import { l0, recommendedGuardrails, recommendedRetry } from 'l0';

// Financial transaction validation with high availability requirements
async function validateTransaction(transactionData: any) {
  const prompt = `Validate this transaction: ${JSON.stringify(transactionData)}`;
  
  const result = await l0({
    // Primary: Most accurate model
    stream: () => streamText({
      model: openai('gpt-4o'),
      prompt
    }),
    
    // Fallbacks: Progressively cheaper models
    fallbackStreams: [
      // Fallback 1: Cheaper but still capable
      () => streamText({
        model: openai('gpt-4o-mini'),
        prompt
      }),
      
      // Fallback 2: Budget option
      () => streamText({
        model: openai('gpt-3.5-turbo'),
        prompt
      }),
      
      // Fallback 3: Alternative provider
      () => streamText({
        model: anthropic('claude-3-haiku'),
        prompt
      })
    ],
    
    guardrails: recommendedGuardrails,
    retry: {
      attempts: 2,
      backoff: 'exponential',
      baseDelay: 500
    },
    
    monitoring: {
      enabled: true,
      metadata: {
        transaction_id: transactionData.id,
        amount: transactionData.amount,
        critical: true
      }
    },
    
    onRetry: (attempt, reason) => {
      console.log(`Retry attempt ${attempt}: ${reason}`);
    }
  });
  
  // Consume stream
  let response = '';
  for await (const event of result.stream) {
    if (event.type === 'token' && event.value) {
      response += event.value;
    }
  }
  
  // Check which model was used
  const modelUsed = result.state.fallbackIndex === 0 
    ? 'gpt-4o (primary)'
    : `fallback-${result.state.fallbackIndex}`;
  
  console.log(`Transaction validated using: ${modelUsed}`);
  console.log(`Total retries: ${result.state.retryAttempts}`);
  console.log(`Success: ${result.state.completed}`);
  
  return {
    response: JSON.parse(response),
    modelUsed,
    fallbackIndex: result.state.fallbackIndex,
    telemetry: result.telemetry
  };
}

// Example usage
const transaction = {
  id: 'txn_12345',
  amount: 1000,
  account: '123456',
  type: 'transfer'
};

const validationResult = await validateTransaction(transaction);
console.log('Validation Result:', validationResult.response);
console.log('Model Fallback Level:', validationResult.fallbackIndex);
```

### How It Works:

1. **Primary Attempt**: Tries `gpt-4o` with full retry logic (2 attempts)
2. **Fallback 1**: If primary exhausted → tries `gpt-4o-mini` (2 attempts)
3. **Fallback 2**: If fallback 1 exhausted → tries `gpt-3.5-turbo` (2 attempts)
4. **Fallback 3**: If all OpenAI models fail → tries Anthropic Claude (2 attempts)

### Benefits:

- **99.9% Uptime** — System continues even if primary model unavailable
- **Cost Optimization** — Only pays for expensive models when they work
- **Transparent Fallback** — Consuming code doesn't need to know about fallbacks
- **Telemetry Tracking** — `state.fallbackIndex` shows which model succeeded
- **Enterprise-Grade** — Critical for financial/healthcare applications

### Use Cases:

1. **Financial Apps** — Transaction validation must never fail
2. **Healthcare** — Patient data processing requires high availability
3. **E-commerce** — Order processing can't afford downtime
4. **Real-time Systems** — Live chat, support tickets, etc.

### Multi-Provider Fallback Pattern:

```typescript
const result = await l0({
  stream: () => streamText({ model: openai('gpt-4o'), prompt }),
  fallbackStreams: [
    () => streamText({ model: anthropic('claude-3-opus'), prompt }),
    () => streamText({ model: google('gemini-pro'), prompt }),
    () => streamText({ model: cohere('command-r'), prompt })
  ],
  retry: recommendedRetry
});
```

This ensures your app stays online even if an entire provider goes down.

---

## Pattern Comparison: Fall-Through vs. Multi-Model Redundancy

L0 provides **two distinct patterns** for model reliability. Understanding when to use each is critical for production systems.

---

### Pattern 1: Fall-Through Model Retries (Sequential Fallback)

**What it is:** Try one model at a time. Only move to the next if the current one exhausts all retries.

```typescript
import { l0, recommendedRetry } from 'l0';

const result = await l0({
  stream: () => streamText({ model: openai('gpt-4o'), prompt }),
  fallbackStreams: [
    () => streamText({ model: openai('gpt-4o-mini'), prompt }),
    () => streamText({ model: anthropic('claude-3-haiku'), prompt })
  ],
  retry: recommendedRetry
});

// Execution Flow:
// 1. Try GPT-4o (2 retry attempts)
// 2. If exhausted → Try GPT-4o-mini (2 retry attempts)
// 3. If exhausted → Try Claude Haiku (2 retry attempts)
// ✓ First success stops the chain
```

**Characteristics:**
- ⏱️ **Higher latency** — Sequential execution (sum of all attempts)
- 💰 **Lower cost** — Only pay for models actually used
- 🎯 **Predictable** — Defined order: primary → fallback1 → fallback2
- 🔄 **Full retries** — Each model gets complete retry logic
- 📊 **Transparent** — `state.fallbackIndex` shows which model succeeded
- ✅ **No waste** — Unused fallbacks cost nothing

**Best For:**
- **Financial applications** — Reliability matters more than latency
- **Batch processing** — Not user-facing, latency-insensitive
- **Cost-conscious systems** — Budget constraints, pay-per-token pricing
- **Graceful degradation** — Want best model first, cheaper fallbacks acceptable
- **High availability** — Must never fail, even if primary provider is down

**Example Use Case:**
```typescript
// Transaction validation - must succeed, cost-conscious
const result = await l0({
  stream: () => streamText({ 
    model: openai('gpt-4o'),  // Most accurate
    prompt: 'Validate transaction: $10,000'
  }),
  fallbackStreams: [
    () => streamText({ 
      model: openai('gpt-4o-mini'),  // Cheaper, still good
      prompt: 'Validate transaction: $10,000'
    }),
    () => streamText({ 
      model: anthropic('claude-3-haiku'),  // Alternative provider
      prompt: 'Validate transaction: $10,000'
    })
  ]
});
// ✓ System never fails, only pays for what it uses
```

---

### Pattern 2: Multi-Model Redundancy (Parallel Race)

**What it is:** Call multiple models simultaneously. Use the fastest response, cancel the rest.

```typescript
import { race } from 'l0';

const result = await race([
  () => streamText({ model: openai('gpt-4o'), prompt }),
  () => streamText({ model: anthropic('claude-3-opus'), prompt }),
  () => streamText({ model: google('gemini-pro'), prompt })
]);

// Execution Flow:
// 1. All 3 models called at the same time
// 2. First to complete wins
// 3. Other requests cancelled/ignored
// ⚡ Lowest latency possible
```

**Characteristics:**
- ⚡ **Lower latency** — Parallel execution, take fastest
- 💸 **Higher cost** — Pay for all parallel calls (even losers)
- 🎲 **Non-deterministic** — Fastest wins, not necessarily best quality
- ❌ **Token waste** — Unused responses still cost money
- 🏎️ **Speed-optimized** — Minimizes time-to-first-token
- 🔀 **Race condition** — No control over which model wins

**Best For:**
- **Real-time chat** — User waiting, every millisecond counts
- **High-value queries** — Cost doesn't matter, quality/speed does
- **Ultra-low latency** — Sub-second response requirements
- **A/B testing** — Compare outputs from multiple models
- **Redundancy testing** — Ensure at least one model responds

**Example Use Case:**
```typescript
// Live customer support - latency critical
const result = await race([
  () => streamText({ model: openai('gpt-4o'), prompt: userQuestion }),
  () => streamText({ model: anthropic('claude-3-opus'), prompt: userQuestion }),
  () => streamText({ model: google('gemini-pro'), prompt: userQuestion })
]);
// ⚡ User gets fastest response, unused calls are wasted but acceptable
```

---

### Side-by-Side Comparison

| Aspect | Fall-Through Retries | Multi-Model Redundancy |
|--------|---------------------|------------------------|
| **Execution Model** | Sequential (waterfall) | Parallel (race) |
| **Latency** | Higher (sum of attempts) | Lower (min of attempts) |
| **Cost** | Low (1 model at a time) | High (N models simultaneously) |
| **Token Waste** | Zero (unused fallbacks free) | High (losers still charged) |
| **Predictability** | High (ordered fallback) | Low (race condition) |
| **Retry Logic** | Full retries per model | Single attempt per model |
| **Use Case** | High availability | Low latency |
| **Cost Example** | $0.10 (only primary) | $0.30 (all 3 models) |
| **Latency Example** | 3000ms (3 sequential attempts) | 1000ms (fastest of 3) |
| **Failure Behavior** | Next fallback | All must fail |

---

### Decision Matrix

**Choose Fall-Through Retries if:**
- ✅ Cost optimization is important
- ✅ High availability is required
- ✅ Latency can be 1-3 seconds
- ✅ Predictable degradation path needed
- ✅ Batch/background processing
- ✅ Financial/enterprise requirements

**Choose Multi-Model Redundancy if:**
- ✅ Latency must be < 1 second
- ✅ Cost is not a constraint
- ✅ User is actively waiting
- ✅ Need fastest possible response
- ✅ A/B testing multiple models
- ✅ Real-time interactive systems

---

### Hybrid Pattern: Best of Both Worlds

You can combine both patterns for ultimate reliability AND speed:

```typescript
// Try fast models in parallel first, fallback to slower if all fail
const result = await l0({
  // Primary: Race between fast models
  stream: async () => {
    return race([
      () => streamText({ model: openai('gpt-4o-mini'), prompt }),
      () => streamText({ model: anthropic('claude-3-haiku'), prompt })
    ]);
  },
  // Fallback: Slower but more capable models
  fallbackStreams: [
    () => streamText({ model: openai('gpt-4o'), prompt }),
    () => streamText({ model: anthropic('claude-3-opus'), prompt })
  ]
});

// Result: Fast response if possible, fallback to quality if needed
```

This gives you:
- ⚡ Low latency when fast models work
- 🛡️ High availability via fallbacks
- 💰 Reasonable cost (only 2x on fast path)
- 🎯 Quality guarantee (fallback to premium models)

---

### Summary

Both patterns are production-ready and solve different problems:

- **Fall-Through** = Reliability + Cost Optimization
- **Multi-Model Redundancy** = Speed + Redundancy

Choose based on your constraints: latency, cost, and reliability requirements.

---