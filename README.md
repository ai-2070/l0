# AI2070/L0 - The Missing Reliability Layer for AI

**Tiny. Predictable. Streaming-first.**

L0 adds guardrails, retry logic, and network protection to LLM streams, turning raw outputs into production-grade results. Works with **Vercel AI SDK**, **OpenAI SDK**, and **Mastra AI** directly.

```bash
npm install @ai2070/l0
```

## Features

| Feature                                   | Description                                                                                                                                         |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| **🔁 Smart Retries**                      | Model-aware retries with exponential backoff. Automatic retries for zero-token output, network stalls, SSE disconnects, and provider overloads.          |
| **🌐 Network Protection**                 | Automatic recovery from dropped streams, slow responses, backgrounding, 429/503 load shedding, DNS errors, and partial chunks.                      |
| **🔀 Model Fallbacks**                    | Automatically fallback to secondary models (e.g., 4o → 4o-mini → Claude/Gemini) with full retry logic.                                              |
| **💥 Zero-Token/Stall Protection**        | Detects when model produces nothing or stalls mid-stream. Automatically retries or switches to fallbacks.                                           |
| 📍 **Last-Known-Good Token Resumption**   | When a stream interrupts, L0 resumes generation from the last structurally valid token (Opt-in).                                                    |
| **🧠 Drift Detection**                    | Detects tone shifts, duplicated sentences, entropy spikes, markdown collapse, and meta-AI patterns before corruption.                               |
| **🧱 Structured Output**                  | Guaranteed-valid JSON with optional Zod/JSON-schema validation. Auto-corrects missing braces, commas, and markdown fences.                          |
| **🛡️ Guardrails**                         | JSON, Markdown, LaTeX, and tool-call validation. Catches malformed output, broken fences, drift, repetition, and hallucination patterns.            |
| **⚡ Race: Fastest-Model Wins**           | Run multiple models or providers in parallel and return the fastest valid stream. Ideal for ultra-low-latency chat and high-availability systems.   |
| **🌿 Parallel: Fan-Out / Fan-In**         | Start multiple streams simultaneously and collect structured or summarized results. Perfect for agent-style multi-model workflows.                  |
| **🔗 Pipe: Streaming Pipelines**          | Compose multiple streaming steps (e.g., summarize → refine → translate) with safe state passing and guardrails between each stage.                  |
| **🧩 Consensus: Agreement Across Models** | Combine multiple model outputs using unanimous, weighted, or best-match consensus. Guarantees high-confidence generation for safety-critical tasks. |
| **📄 Document Windows**                   | Built-in chunking (token, paragraph, sentence, character). Ideal for long documents, transcripts, or multi-page processing.                         |
| **📊 Monitoring Hooks**                   | `onToken`, `onViolation`, `onRetry`, `onFallback`, and more - integrates with Prometheus, OTel, Sentry.                                             |
| **📡 Streaming-First Runtime**            | Thin, deterministic wrapper over `streamText()` with unified event types (`token`, `error`, `done`) for easy UIs.                                   |
| **⛔ Safety-First Defaults**              | Continuation off by default. Structured objects never resumed. No silent corruption. Integrity always preserved.                                    |
| **⚡ Tiny & Explicit**                    | No frameworks, no heavy abstractions, zero hidden logic. Small, explicit functions for predictable behavior.                                        |

## Quick Start

### With Vercel AI SDK

```typescript
import { l0, recommendedGuardrails, recommendedRetry } from "@ai2070/l0";
import { streamText } from "ai";
import { openai } from "@ai-sdk/openai";

const result = await l0({
  // Primary model stream
  stream: () =>
    streamText({
      model: openai("gpt-4o"),
      prompt: "Generate a haiku about coding",
    }),

  // Optional: Fallback models
  fallbackStreams: [() => streamText({ model: openai("gpt-4o-mini"), prompt })],

  // Optional: Guardrails
  guardrails: recommendedGuardrails,
  // Other presets:
  // minimalGuardrails       // JSON + zero output
  // recommendedGuardrails   // + Markdown, patterns
  // strictGuardrails        // + LaTeX, structure
  // jsonOnlyGuardrails      // JSON only
  // markdownOnlyGuardrails  // Markdown only
  // latexOnlyGuardrails     // LaTeX only

  // Optional: Retry configuration
  retry: {
    attempts: 2,
    baseDelay: 1000,
    maxDelay: 10000,
    backoff: "exponential",
    retryOn: ["zero_output", "guardrail_violation"],
  },
  // Or simply:
  // retry: recommendedRetry,

  // Optional: Timeout configuration
  timeout: {
    initialToken: 5000, // 5s to first token
    interToken: 10000, // 10s between tokens
  },

  // Optional: Guardrail check intervals
  checkIntervals: {
    guardrails: 5, // Check every N tokens
    drift: 10,
    checkpoint: 10,
  },

  // Optional: Abort signal
  signal: abortController.signal,

  // Optional: Monitoring callbacks
  monitoring: {
    onToken: (token) => {},
    onViolation: (violation) => {},
    onRetry: (attempt, error) => {},
    onFallback: (index) => {},
  },
});

// Read the stream
for await (const event of result.stream) {
  if (event.type === "token") {
    process.stdout.write(event.value);
  }
}
```

**See Also: [API.md](./API.md) - Complete API reference**

### With OpenAI SDK

```typescript
import OpenAI from "openai";
import { l0, openaiStream, recommendedGuardrails } from "@ai2070/l0";

const openai = new OpenAI();

const result = await l0({
  stream: openaiStream(openai, {
    model: "gpt-4o",
    messages: [{ role: "user", content: "Generate a haiku about coding" }],
  }),
  guardrails: recommendedGuardrails,
});

for await (const event of result.stream) {
  if (event.type === "token") process.stdout.write(event.value);
}
```

### With Mastra AI

```typescript
import { Agent } from "@mastra/core/agent";
import { l0, mastraStream, recommendedGuardrails } from "@ai2070/l0";

const agent = new Agent({
  name: "haiku-writer",
  instructions: "You are a poet who writes haikus",
  model: "openai/gpt-4o",
});

const result = await l0({
  stream: mastraStream(agent, "Generate a haiku about coding"),
  guardrails: recommendedGuardrails,
});

for await (const event of result.stream) {
  if (event.type === "token") process.stdout.write(event.value);
}
```

## Core Features

| Feature                                     | Description                                                     |
| ------------------------------------------- | --------------------------------------------------------------- |
| [Streaming Runtime](#streaming-runtime)     | Token-by-token normalization, checkpoints, resumable generation |
| [Retry Logic](#retry-logic)                 | Smart retries with backoff, network vs model error distinction  |
| [Network Protection](#network-protection)   | Auto-recovery from 12+ network failure types                    |
| [Structured Output](#structured-output)     | Guaranteed valid JSON with Zod schema validation                |
| [Fallback Models](#fallback-models)         | Sequential fallback when primary model fails                    |
| [Document Windows](#document-windows)       | Automatic chunking for long documents                           |
| [Formatting Helpers](#formatting-helpers)   | Context, memory, tools, and output formatting utilities         |
| [Last-Known-Good Token Resumption](#last-known-good-token-resumption) | Resume from last checkpoint on retry/fallback (opt-in)          |
| [Guardrails](#guardrails)                   | JSON, Markdown, LaTeX validation, pattern detection             |
| [Consensus](#consensus)                     | Multi-model agreement with voting strategies                    |
| [Parallel Operations](#parallel-operations) | Race, batch, pool patterns for concurrent LLM calls             |
| [Monitoring](#monitoring)                   | Built-in Prometheus, OTel and Sentry integrations               |
| [Error Handling](#error-handling)           | Typed errors with categorization and recovery hints             |
| [Testing](#testing)                         | 1200+ tests covering all features and SDK adapters              |

---

## Streaming Runtime

L0 wraps `streamText()` with deterministic behavior:

```typescript
const result = await l0({
  stream: () => streamText({ model, prompt }),

  // Optional: Timeouts (ms)
  timeout: {
    initialToken: 5000, // 5s to first token
    interToken: 10000, // 10s between tokens
  },

  signal: abortController.signal,
});

// Unified event format
for await (const event of result.stream) {
  switch (event.type) {
    case "token":
      console.log(event.value);
      break;
    case "done":
      console.log("Complete");
      break;
    case "error":
      console.error(event.error);
      break;
  }
}

// Access final state
console.log(result.state.content); // Full accumulated content
console.log(result.state.tokenCount); // Total tokens received
console.log(result.state.checkpoint); // Last stable checkpoint
```

⚠️ Free and low-priority models may take **3–7 seconds** before emitting the first token and **10 seconds** between tokens.

---

## Retry Logic

Smart retry system that distinguishes network errors from model errors:

```typescript
const result = await l0({
  stream: () => streamText({ model, prompt }),
  retry: {
    attempts: 2, // Model errors only
    maxRetries: 10, // Absolute cap across all error types
    baseDelay: 1000,
    maxDelay: 10000,
    backoff: "exponential", // or "linear", "fixed", "full-jitter"
    retryOn: ["zero_output", "guardrail_violation", "drift", "network_error", "timeout", "rate_limit"],
    // Custom delays per error type (overrides baseDelay)
    errorTypeDelays: {
      connectionDropped: 2000,
      timeout: 1500,
      dnsError: 5000,
    },
  },
});
```

### Retry Behavior

| Error Type           | Retries | Counts Toward Limit |
| -------------------- | ------- | ------------------- |
| Network disconnect   | Yes     | No                  |
| Zero output          | Yes     | No                  |
| Timeout              | Yes     | No                  |
| 429 rate limit       | Yes     | No                  |
| 503 server error     | Yes     | No                  |
| Guardrail violation  | Yes     | **Yes**             |
| Malformed output     | Yes     | **Yes**             |
| Drift detected       | Yes     | **Yes**             |
| Auth error (401/403) | No      | -                   |

---

## Network Protection

Automatic detection and recovery from network failures:

```typescript
import { isNetworkError, analyzeNetworkError } from "@ai2070/l0";

try {
  await l0({ stream, retry: recommendedRetry });
} catch (error) {
  if (isNetworkError(error)) {
    const analysis = analyzeNetworkError(error);
    console.log(analysis.type); // "connection_dropped", "timeout", etc.
    console.log(analysis.retryable); // true/false
    console.log(analysis.suggestion); // Recovery suggestion
  }
}
```

Detected error types: connection dropped, fetch errors, ECONNRESET, ECONNREFUSED, SSE aborted, DNS errors, timeouts, mobile background throttle, and more.

---

## Structured Output

Guaranteed valid JSON matching your Zod schema:

```typescript
import { structured } from "@ai2070/l0";
import { z } from "zod";

const schema = z.object({
  name: z.string(),
  age: z.number(),
  email: z.string().email(),
});

const result = await structured({
  schema,
  stream: () => streamText({ model, prompt: "Generate user data as JSON" }),
  autoCorrect: true, // Fix trailing commas, missing braces, etc.
});

// Type-safe access
console.log(result.data.name); // string
console.log(result.data.age); // number
console.log(result.corrected); // true if auto-corrected
```

---

## Fallback Models

Sequential fallback when primary model fails:

```typescript
const result = await l0({
  stream: () => streamText({ model: openai("gpt-4o"), prompt }),
  fallbackStreams: [
    () => streamText({ model: openai("gpt-4o-mini"), prompt }),
    () => streamText({ model: anthropic("claude-3-haiku"), prompt }),
  ],
});

// Check which model succeeded
console.log(result.state.fallbackIndex); // 0 = primary, 1+ = fallback
```

---

## Document Windows

Process documents that exceed context limits:

```typescript
import { createWindow } from "@ai2070/l0";

const window = createWindow(longDocument, {
  size: 2000, // Tokens per chunk
  overlap: 200, // Overlap between chunks
  strategy: "paragraph", // or "token", "sentence", "char"
});

// Process all chunks
const results = await window.processAll((chunk) => ({
  stream: () =>
    streamText({
      model,
      prompt: `Summarize: ${chunk.content}`,
    }),
}));

// Or navigate manually
const first = window.current();
const next = window.next();
```

## Formatting Helpers

Utilities for context, memory, output instructions, and tool definitions:

```typescript
import { formatContext, formatMemory, formatTool, formatJsonOutput } from "@ai2070/l0";

// Wrap documents with XML/Markdown/bracket delimiters
const context = formatContext(document, { label: "Documentation", delimiter: "xml" });

// Format conversation history (conversational, structured, or compact)
const memory = formatMemory(messages, { style: "conversational", maxEntries: 10 });

// Define tools with JSON schema, TypeScript, or natural language
const tool = formatTool({ name: "search", description: "Search", parameters: [...] });

// Request strict JSON output
const instruction = formatJsonOutput({ strict: true, schema: "..." });
```

See [FORMATTING.md](./FORMATTING.md) for complete API reference.

---

## Last-Known-Good Token Resumption

When a stream fails mid-generation, L0 can resume from the last known good checkpoint instead of starting over. This preserves already-generated content and reduces latency on retries.

```typescript
const result = await l0({
  stream: () => streamText({ model, prompt }),
  retry: { attempts: 2 },
  
  // Enable continuation from last checkpoint (opt-in)
  continueFromLastKnownGoodToken: true,
});

// Check if continuation was used
console.log(result.state.continuedFromCheckpoint); // true if resumed
console.log(result.state.continuationCheckpoint);  // The checkpoint content
```

### How It Works

1. L0 maintains a checkpoint of successfully received tokens (every N tokens, configurable via `checkIntervals.checkpoint`)
2. When a retry or fallback is triggered, the checkpoint is validated against guardrails and drift detection
3. If validation passes, the checkpoint content is emitted first to the consumer
4. The `buildContinuationPrompt` callback (if provided) is called to allow updating the prompt for continuation
5. Telemetry tracks whether continuation was enabled, used, and the checkpoint details

### Using buildContinuationPrompt

To have the LLM actually continue from where it left off (rather than just replaying tokens locally), use `buildContinuationPrompt` to modify the prompt:

```typescript
let continuationPrompt = "";
const originalPrompt = "Write a detailed analysis of...";

const result = await l0({
  stream: () => streamText({ 
    model: openai("gpt-4o"), 
    prompt: continuationPrompt || originalPrompt,
  }),
  continueFromLastKnownGoodToken: true,
  buildContinuationPrompt: (checkpoint) => {
    // Update the prompt to tell the LLM to continue from checkpoint
    continuationPrompt = `${originalPrompt}\n\nContinue from where you left off:\n${checkpoint}`;
    return continuationPrompt;
  },
  retry: { attempts: 2 },
});
```

### Example: Resuming After Network Error

```typescript
const result = await l0({
  stream: () => streamText({ 
    model: openai("gpt-4o"), 
    prompt: "Write a detailed analysis of..." 
  }),
  fallbackStreams: [
    () => streamText({ model: openai("gpt-4o-mini"), prompt }),
  ],
  retry: { attempts: 2 },
  continueFromLastKnownGoodToken: true,
  checkIntervals: { checkpoint: 10 }, // Save checkpoint every 10 tokens
  monitoring: { enabled: true },
});

for await (const event of result.stream) {
  if (event.type === "token") {
    process.stdout.write(event.value);
  }
}

// Check telemetry for continuation usage
if (result.telemetry?.continuation?.used) {
  console.log("\nResumed from checkpoint of length:", 
    result.telemetry.continuation.checkpointLength);
}
```

### Checkpoint Validation

Before using a checkpoint for continuation, L0 validates it:

- **Guardrails**: All configured guardrails are run against the checkpoint content
- **Drift Detection**: If enabled, checks for format drift in the checkpoint
- **Fatal Violations**: If any guardrail returns a fatal violation, the checkpoint is discarded and retry starts fresh

### Important Limitations

> ⚠️ **Do NOT use `continueFromLastKnownGoodToken` with structured output or `streamObject()`.**
>
> Continuation works by prepending checkpoint content to the next generation. For JSON/structured output, this can corrupt the data structure because:
> - The model may not properly continue the JSON syntax
> - Partial objects could result in invalid JSON
> - Schema validation may fail on malformed output
>
> For structured output, let L0 retry from scratch to ensure valid JSON.

```typescript
// ✅ GOOD - Text generation with continuation
const result = await l0({
  stream: () => streamText({ model, prompt: "Write an essay..." }),
  continueFromLastKnownGoodToken: true,
});

// ❌ BAD - Do NOT use with structured output
const result = await structured({
  schema: mySchema,
  stream: () => streamText({ model, prompt }),
  continueFromLastKnownGoodToken: true, // DON'T DO THIS
});
```

---

## Guardrails

Pure functions that validate streaming output without rewriting it:

```typescript
import {
  jsonRule,
  markdownRule,
  zeroOutputRule,
  patternRule,
  customPatternRule,
} from "@ai2070/l0";

const result = await l0({
  stream: () => streamText({ model, prompt }),
  guardrails: [
    jsonRule(), // Validates JSON structure
    markdownRule(), // Validates Markdown fences/tables
    zeroOutputRule(), // Detects empty output
    patternRule(), // Detects "As an AI..." patterns
    customPatternRule([/forbidden/i], "Custom violation"),
  ],
});
```

### Presets

```typescript
import {
  minimalGuardrails,
  recommendedGuardrails,
  strictGuardrails,
} from "@ai2070/l0";

// Minimal: JSON + zero output detection
// Recommended: + Markdown, drift, patterns
// Strict: + function calls, schema validation
```

---

## Consensus

Multi-generation consensus for high-confidence results:

```typescript
import { consensus } from "@ai2070/l0";

const result = await consensus({
  streams: [
    () => streamText({ model, prompt }),
    () => streamText({ model, prompt }),
    () => streamText({ model, prompt }),
  ],
  strategy: "majority", // or "unanimous", "weighted", "best"
  threshold: 0.8,
});

console.log(result.consensus); // Agreed output
console.log(result.confidence); // 0-1 confidence score
console.log(result.agreements); // What they agreed on
console.log(result.disagreements); // Where they differed
```

---

## Parallel Operations

Run multiple LLM calls concurrently with different patterns:

### Race - First Response Wins

```typescript
import { race } from "@ai2070/l0";

const result = await race([
  { stream: () => streamText({ model: openai("gpt-4o"), prompt }) },
  { stream: () => streamText({ model: anthropic("claude-3-opus"), prompt }) },
  { stream: () => streamText({ model: google("gemini-pro"), prompt }) },
]);
// Returns first successful response, cancels others
```

### Parallel with Concurrency Control

```typescript
import { parallel } from "@ai2070/l0";

const results = await parallel(
  [
    { stream: () => streamText({ model, prompt: "Task 1" }) },
    { stream: () => streamText({ model, prompt: "Task 2" }) },
    { stream: () => streamText({ model, prompt: "Task 3" }) },
  ],
  {
    concurrency: 2, // Max 2 concurrent
    failFast: false, // Continue on errors
  },
);

console.log(results.successCount);
console.log(results.results[0]?.state.content);
```

### Fall-Through vs Race

| Pattern      | Execution                   | Cost               | Best For                          |
| ------------ | --------------------------- | ------------------ | --------------------------------- |
| Fall-through | Sequential, next on failure | Low (pay for 1)    | High availability, cost-sensitive |
| Race         | Parallel, first wins        | High (pay for all) | Low latency, speed-critical       |

```typescript
// Fall-through: Try models sequentially
const result = await l0({
  stream: () => streamText({ model: openai("gpt-4o"), prompt }),
  fallbackStreams: [
    () => streamText({ model: openai("gpt-4o-mini"), prompt }),
    () => streamText({ model: anthropic("claude-3-haiku"), prompt }),
  ],
});

// Race: All models simultaneously, first wins
const result = await race([
  { stream: () => streamText({ model: openai("gpt-4o"), prompt }) },
  { stream: () => streamText({ model: anthropic("claude-3-opus"), prompt }) },
]);
```

---

## Monitoring

Built-in telemetry with Prometheus, OTel and Sentry integrations.

### Prometheus

```typescript
import {
  l0,
  createPrometheusCollector,
  prometheusMiddleware,
} from "@ai2070/l0";
import express from "express";

const collector = createPrometheusCollector();
const app = express();

app.get("/metrics", prometheusMiddleware(collector));

app.post("/chat", async (req, res) => {
  const result = await l0({
    stream: () => streamText({ model, prompt: req.body.prompt }),
    monitoring: { enabled: true },
  });

  for await (const event of result.stream) {
    /* ... */
  }

  collector.record(result.telemetry, { model: "gpt-4" });
  res.json({ response: result.state.content });
});
```

**Exported metrics:** `l0_requests_total`, `l0_request_duration_seconds`, `l0_tokens_total`, `l0_time_to_first_token_seconds`, `l0_network_errors_total`, `l0_guardrail_violations_total`

### Sentry

```typescript
import * as Sentry from "@sentry/node";
import { l0, sentryInterceptor } from "@ai2070/l0";

const result = await l0({
  stream: () => streamText({ model, prompt }),
  monitoring: { enabled: true },
  interceptors: [sentryInterceptor({ hub: Sentry })],
});
```

**Tracks:** Breadcrumbs for all events, network errors, guardrail violations, performance transactions with TTFT and token count.

### OpenTelemetry

```typescript
import { trace, metrics } from "@opentelemetry/api";
import { l0, L0OpenTelemetry, openTelemetryInterceptor } from "@ai2070/l0";

const otel = new L0OpenTelemetry({
  tracer: trace.getTracer("my-app"),
  meter: metrics.getMeter("my-app"),
});

// Trace a stream operation
const result = await otel.traceStream("chat-completion", async (span) => {
  const res = await l0({
    stream: () => streamText({ model, prompt }),
    monitoring: { enabled: true },
  });

  for await (const event of res.stream) {
    otel.recordToken(span);
  }

  otel.recordTelemetry(res.telemetry, span);
  return res;
});

// Or use the interceptor for automatic tracing
const result = await l0({
  stream: () => streamText({ model, prompt }),
  interceptors: [
    openTelemetryInterceptor({
      tracer: trace.getTracer("my-app"),
      meter: metrics.getMeter("my-app"),
    }),
  ],
});
```

**Metrics:** `l0.requests`, `l0.tokens`, `l0.retries`, `l0.errors`, `l0.duration`, `l0.time_to_first_token`, `l0.active_streams`

**Span attributes:** Follows [OpenTelemetry GenAI semantic conventions](https://opentelemetry.io/docs/specs/semconv/gen-ai/) with `gen_ai.*` and `l0.*` attributes.

See [MONITORING.md](./MONITORING.md) for complete integration guides.

---

## Error Handling

L0 provides detailed error context for debugging and recovery:

```typescript
import { isL0Error, L0Error } from "@ai2070/l0";

try {
  await l0({ stream, guardrails });
} catch (error) {
  if (isL0Error(error)) {
    console.log(error.code); // "GUARDRAIL_VIOLATION", "ZERO_OUTPUT", etc.
    console.log(error.context.checkpoint); // Last good content
    console.log(error.context.tokenCount); // Tokens before failure
    console.log(error.isRecoverable()); // Can retry?
  }
}
```

Error codes: `STREAM_ABORTED`, `INITIAL_TOKEN_TIMEOUT`, `INTER_TOKEN_TIMEOUT`, `ZERO_OUTPUT`, `GUARDRAIL_VIOLATION`, `FATAL_GUARDRAIL_VIOLATION`, `INVALID_STREAM`, `ALL_STREAMS_EXHAUSTED`, `NETWORK_ERROR`, `DRIFT_DETECTED`

---

## Philosophy

- **No magic** - Everything is explicit and predictable
- **Streaming-first** - Built for real-time token delivery
- **Signals, not rewrites** - Guardrails detect issues, don't modify output
- **Model-agnostic** - Works with any Vercel AI SDK provider
- **Zero dependencies** - Only peer dependency is the AI SDK

---

## Testing

L0 has comprehensive test coverage with both unit and integration tests.

```bash
# Run unit tests (fast, no API keys needed)
npm test

# Run integration tests (requires API keys)
OPENAI_API_KEY=sk-... npm run test:integration
```

### Test Coverage

| Category          | Tests | Description                      |
| ----------------- | ----- | -------------------------------- |
| Unit Tests        | 1211  | Fast, mocked, no API calls       |
| Integration Tests | 40+   | Real API calls, all SDK adapters |

### SDK Adapter Matrix

| Adapter       | Unit Tests | Integration Tests | Version                        |
| ------------- | ---------- | ----------------- | ------------------------------ |
| Vercel AI SDK | ✓          | ✓                 | ^5.0.0                         |
| OpenAI SDK    | ✓          | ✓                 | ^4.0.0 \|\| ^5.0.0 \|\| ^6.0.0 |
| Mastra AI     | ✓          | ✓                 | >=0.24.0                       |

### Feature Test Matrix

| Feature           | Unit | Integration | Notes                     |
| ----------------- | ---- | ----------- | ------------------------- |
| Streaming         | ✓    | ✓           | Token events, completion  |
| Guardrails        | ✓    | ✓           | All rules, presets        |
| Structured Output | ✓    | ✓           | Zod schemas, auto-correct |
| Retry Logic       | ✓    | ✓           | Backoff strategies        |
| Network Errors    | ✓    | -           | 12+ error types           |
| Fallback Models   | ✓    | ✓           | Sequential fallback       |
| Parallel/Race     | ✓    | ✓           | Concurrency patterns      |
| Pipeline          | ✓    | -           | Multi-step workflows      |
| Consensus         | ✓    | ✓           | Voting strategies         |
| Document Windows  | ✓    | -           | Chunking strategies       |
| Monitoring        | ✓    | ✓           | Telemetry, Prometheus     |
| Interceptors      | ✓    | -           | All built-in interceptors |
| Drift Detection   | ✓    | -           | Pattern detection         |

---

## Documentation

| Guide                                                          | Description                |
| -------------------------------------------------------------- | -------------------------- |
| [QUICKSTART.md](./QUICKSTART.md)                               | 5-minute getting started   |
| [API.md](./API.md)                                             | Complete API reference     |
| [GUARDRAILS.md](./GUARDRAILS.md)                               | Guardrails and validation  |
| [STRUCTURED_OUTPUT.md](./STRUCTURED_OUTPUT.md)                 | Structured output guide    |
| [CONSENSUS.md](./CONSENSUS.md)                                 | Multi-generation consensus |
| [DOCUMENT_WINDOWS.md](./DOCUMENT_WINDOWS.md)                   | Document chunking guide    |
| [NETWORK_ERRORS.md](./NETWORK_ERRORS.md)                       | Network error handling     |
| [INTERCEPTORS_AND_PARALLEL.md](./INTERCEPTORS_AND_PARALLEL.md) | Parallel operations        |
| [MONITORING.md](./MONITORING.md)                               | Telemetry and metrics      |
| [FORMATTING.md](./FORMATTING.md)                               | Formatting helpers         |

---

## License

MIT
