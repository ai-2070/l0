# Interceptors & Parallel Operations

> **Bundle size tip:** For smaller bundles, use subpath imports:
>
> ```typescript
> import { parallel, race } from "@ai2070/l0/parallel";
> ```

## Interceptors

Interceptors provide hooks into the L0 execution pipeline for **request/response transformation**: auth injection, validation, rate limiting, and content transforms.

> **Note:** For **observability** (tracing, metrics, error tracking), use the `onEvent` callback instead of interceptors. See the [Monitoring section in README.md](./README.md#monitoring) for OpenTelemetry and Sentry integration patterns.

### Interface

```typescript
interface L0Interceptor {
  name?: string;
  before?: (options: L0Options) => L0Options | Promise<L0Options>;
  after?: (result: L0Result) => L0Result | Promise<L0Result>;
  onError?: (error: Error, options: L0Options) => void | Promise<void>;
}
```

### Built-In Interceptors

```typescript
import {
  loggingInterceptor, // Log execution start/complete
  metadataInterceptor, // Inject metadata into telemetry
  authInterceptor, // Add authentication tokens
  timingInterceptor, // Track detailed timing
  validationInterceptor, // Validate output
  rateLimitInterceptor, // Throttle requests
  transformInterceptor, // Post-process content
  analyticsInterceptor, // Send to analytics services
} from "@ai2070/l0";

const result = await l0({
  stream: () => streamText({ model, prompt }),
  interceptors: [
    loggingInterceptor(console),
    metadataInterceptor({ user_id: "user_123" }),
    rateLimitInterceptor(10, 60000), // 10 requests per minute
    validationInterceptor((content) => content.length >= 100),
    transformInterceptor((content) => content.replace(/[*_`]/g, "")),
  ],
});
```

### Custom Interceptor

```typescript
const myInterceptor: L0Interceptor = {
  name: "my-interceptor",
  before: async (options) => {
    console.log("Starting...");
    return options;
  },
  after: async (result) => {
    console.log("Completed!");
    return result;
  },
  onError: async (error) => {
    console.error("Failed:", error.message);
  },
};
```

### Execution Order

```typescript
const result = await l0({
  stream: () => streamText({ model, prompt }),
  interceptors: [
    authInterceptor(getAuth), // before: 1st
    rateLimitInterceptor(10, 60000), // before: 2nd
    loggingInterceptor(), // before: 3rd
    validationInterceptor(validate), // after: 1st
    transformInterceptor(transform), // after: 2nd
  ],
});
// Before hooks: 1 → 2 → 3
// After hooks: 4 → 5
```

---

## Parallel Operations

### Basic Usage

```typescript
import { parallel } from "@ai2070/l0";

const results = await parallel(
  [
    {
      stream: () =>
        streamText({ model, prompt: "Translate to Spanish: Hello" }),
    },
    {
      stream: () => streamText({ model, prompt: "Translate to French: Hello" }),
    },
    {
      stream: () => streamText({ model, prompt: "Translate to German: Hello" }),
    },
  ],
  {
    concurrency: 2,
    failFast: false,
  },
);

console.log("Success:", results.successCount);
console.log("Spanish:", results.results[0]?.state.content);
```

### Options

```typescript
interface ParallelOptions {
  concurrency?: number; // Max concurrent (default: 5)
  failFast?: boolean; // Stop on first error (default: false)
  sharedRetry?: RetryOptions;
  sharedMonitoring?: MonitoringConfig;
  onProgress?: (completed: number, total: number) => void;
  onComplete?: (result: L0Result, index: number) => void;
  onError?: (error: Error, index: number) => void;
}
```

### Result

```typescript
interface ParallelResult {
  results: Array<L0Result | null>;
  errors: Array<Error | null>;
  successCount: number;
  failureCount: number;
  duration: number;
  allSucceeded: boolean;
  aggregatedTelemetry?: AggregatedTelemetry;
}
```

### Helper Functions

```typescript
import { parallel, parallelAll, sequential, batched, race } from "@ai2070/l0";

// Limited concurrency
await parallel(operations, { concurrency: 3 });

// Unlimited concurrency
await parallelAll(operations);

// One at a time
await sequential(operations);

// Process in batches
await batched(operations, { batchSize: 5, concurrency: 3 });

// First to succeed wins
await race(operations);
```

### Race - Multi-Provider

```typescript
import { race } from "@ai2070/l0";

const result = await race([
  { stream: () => streamText({ model: openai("gpt-4"), prompt }) },
  { stream: () => streamText({ model: anthropic("claude-3"), prompt }) },
  { stream: () => streamText({ model: google("gemini-pro"), prompt }) },
]);
// Uses first successful response
```

### Pool - Reusable Workers

```typescript
import { createPool } from "@ai2070/l0";

const pool = createPool(3, {
  sharedRetry: recommendedRetry,
  sharedMonitoring: { enabled: true },
});

const results = await Promise.all([
  pool.execute({ stream: () => streamText({ model, prompt: "Task 1" }) }),
  pool.execute({ stream: () => streamText({ model, prompt: "Task 2" }) }),
  pool.execute({ stream: () => streamText({ model, prompt: "Task 3" }) }),
]);

await pool.drain();
```

---

## Fall-Through vs Race

### Fall-Through (Sequential Fallback)

Try models one at a time, moving to next only if current exhausts retries:

```typescript
const result = await l0({
  stream: () => streamText({ model: openai("gpt-4o"), prompt }),
  fallbackStreams: [
    () => streamText({ model: openai("gpt-5-mini"), prompt }),
    () => streamText({ model: anthropic("claude-3-haiku"), prompt }),
  ],
  retry: recommendedRetry,
});
// 1. GPT-4o (2 retries) → 2. gpt-5-mini (2 retries) → 3. Claude Haiku (2 retries)
```

**Use when:** Cost matters, latency acceptable, high availability required.

### Race (Parallel)

Call all models simultaneously, use fastest response:

```typescript
const result = await race([
  () => streamText({ model: openai("gpt-4o"), prompt }),
  () => streamText({ model: anthropic("claude-3-opus"), prompt }),
  () => streamText({ model: google("gemini-pro"), prompt }),
]);
// All called at once, first to complete wins
```

**Use when:** Latency critical, cost not a constraint.

### Comparison

| Aspect    | Fall-Through      | Race               |
| --------- | ----------------- | ------------------ |
| Execution | Sequential        | Parallel           |
| Latency   | Higher            | Lower              |
| Cost      | Low               | High (pay for all) |
| Best For  | High availability | Low latency        |

### Hybrid Pattern

```typescript
const result = await l0({
  stream: async () =>
    race([
      () => streamText({ model: openai("gpt-5-mini"), prompt }),
      () => streamText({ model: anthropic("claude-3-haiku"), prompt }),
    ]),
  fallbackStreams: [
    () => streamText({ model: openai("gpt-5-mini"), prompt }),
    () => streamText({ model: anthropic("claude-3-opus"), prompt }),
  ],
});
// Fast models race first, fallback to quality if both fail
```
