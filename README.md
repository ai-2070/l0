# L0 - The Missing Reliability Substrate for AI

![L0: The Missing AI Reliability Substrate](img/l0-banner.jpg)

<p align="center">
  <a href="https://www.npmjs.com/package/@ai2070/l0">
    <img src="https://img.shields.io/npm/v/@ai2070/l0?color=brightgreen&label=npm" alt="npm version">
  </a>
  <a href="https://bundlephobia.com/package/@ai2070/l0">
    <img src="https://img.shields.io/bundlephobia/minzip/@ai2070/l0?label=minzipped" alt="minzipped size">
  </a>
  <a href="https://packagephobia.com/result?p=@ai2070/l0">
    <img src="https://packagephobia.com/badge?p=@ai2070/l0" alt="install size">
  </a>
  <img src="https://img.shields.io/badge/types-included-blue?logo=typescript&logoColor=white" alt="Types Included">
  <a href="https://github.com/ai-2070/l0/actions">
    <img src="https://img.shields.io/github/actions/workflow/status/ai-2070/l0/ci.yml?label=tests" alt="CI status">
  </a>
  <img src="https://img.shields.io/badge/license-MIT-green" alt="MIT License">
</p>

**L0 is a tiny reliability, streaming-first substrate that wraps any LLM stream with retries, guardrails, fallbacks, drift detection, and deterministic playback.**

> _LLMs are extraordinary minds wrapped in fragile interfaces._
> _The reasoning is brilliant._
> _The capability is vast._
> _The potential is limitless._
>
> _Yet the surface - the streaming layer -_
> _can flicker, stall, or fracture without warning._
>
> _L0 is the missing foundation._
> _A reliability layer that stabilizes the interface so the model's intelligence can actually reach you._

L0 adds guardrails, retry logic, and network protection to LLM streams, turning raw outputs into production-grade results. Works with **Vercel AI SDK**, **OpenAI SDK**, and **Mastra AI** directly. Supports **custom adapters** (BYOA) and **multimodal AI streams**.

```bash
npm install @ai2070/l0
```

_Production-grade reliability. Just pass your stream. L0'll take it from here._

L0 includes 2,000+ tests covering all major reliability features.

**Upcoming versions:**

- **1.0.0** - API freeze + Website docs + Python version

```
 AI SDK Stream                       L0 Layer                       Your App
 ─────────────       ┌────────────────────────────────────────┐      ─────────
   Vercel AI/        │ Timeouts ──▶ Guardrails ──▶ Checkpoints│
    OpenAI/  ──────▶ │     │            │              │      │ ──────▶ Output
    Mastra           │     └─────▶ Retry ◀──▶ Fallbacks ◀─────│
 ─────────────       └────────────────────────────────────────┘
```

**Bundle sizes (minified):**

| Import                  | Size  | Gzipped | Description              |
| ----------------------- | ----- | ------- | ------------------------ |
| `@ai2070/l0` (full)     | 181KB | 52KB    | Everything               |
| `@ai2070/l0/core`       | 52KB  | 15KB    | Runtime + retry + errors |
| `@ai2070/l0/structured` | 43KB  | 12KB    | Structured output        |
| `@ai2070/l0/consensus`  | 54KB  | 16KB    | Multi-model consensus    |
| `@ai2070/l0/parallel`   | 39KB  | 11KB    | Parallel/race operations |
| `@ai2070/l0/window`     | 44KB  | 13KB    | Document chunking        |
| `@ai2070/l0/guardrails` | 18KB  | 6KB     | Validation rules         |
| `@ai2070/l0/monitoring` | 33KB  | 9KB     | Prometheus/OTel/Sentry   |
| `@ai2070/l0/drift`      | 5KB   | 2KB     | Drift detection          |

Dependency-free. Tree-shakeable subpath exports for minimal bundles.

> Most applications should simply use `import { l0 } from "@ai2070/l0"`.
> Only optimize imports if you're targeting edge runtimes or strict bundle constraints.

## Features

| Feature                                          | Description                                                                                                                                                                                           |
| ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **🔁 Smart Retries**                             | Model-aware retries with fixed-jitter backoff. Automatic retries for zero-token output, network stalls, SSE disconnects, and provider overloads.                                                      |
| **🌐 Network Protection**                        | Automatic recovery from dropped streams, slow responses, backgrounding, 429/503 load shedding, DNS errors, and partial chunks.                                                                        |
| **🔀 Model Fallbacks**                           | Automatically fallback to secondary models (e.g., 4o → 4o-mini → Claude/Gemini) with full retry logic.                                                                                                |
| **💥 Zero-Token/Stall Protection**               | Detects when model produces nothing or stalls mid-stream. Automatically retries or switches to fallbacks.                                                                                             |
| 📍 **Last-Known-Good Token Resumption**          | When a stream interrupts, L0 resumes generation from the last structurally valid token (Opt-in).                                                                                                      |
| **🧠 Drift Detection**                           | Detects tone shifts, duplicated sentences, entropy spikes, markdown collapse, and meta-AI patterns before corruption.                                                                                 |
| **🧱 Structured Output**                         | Guaranteed-valid JSON with Zod (v3/v4), Effect Schema, or JSON Schema. Auto-corrects missing braces, commas, and markdown fences.                                                                     |
| **🩹 JSON Auto-Healing + Markdown Fence Repair** | Automatic correction of truncated or malformed JSON (missing braces, brackets, quotes), and repair of broken Markdown code fences. Ensures clean extraction of structured data from noisy LLM output. |
| **🛡️ Guardrails**                                | JSON, Markdown, LaTeX, and pattern validation with fast/slow path execution. Delta-only checks run sync; full-content scans defer to async to never block streaming.                                  |
| **⚡ Race: Fastest-Model Wins**                  | Run multiple models or providers in parallel and return the fastest valid stream. Ideal for ultra-low-latency chat and high-availability systems.                                                     |
| **🌿 Parallel: Fan-Out / Fan-In**                | Start multiple streams simultaneously and collect structured or summarized results. Perfect for agent-style multi-model workflows.                                                                    |
| **🔗 Pipe: Streaming Pipelines**                 | Compose multiple streaming steps (e.g., summarize → refine → translate) with safe state passing and guardrails between each stage.                                                                    |
| **🧩 Consensus: Agreement Across Models**        | Combine multiple model outputs using unanimous, weighted, or best-match consensus. Guarantees high-confidence generation for safety-critical tasks.                                                   |
| **📄 Document Windows**                          | Built-in chunking (token, paragraph, sentence, character). Ideal for long documents, transcripts, or multi-page processing.                                                                           |
| **🎨 Formatting Helpers**                        | Extract JSON/code from markdown fences, strip thinking tags, normalize whitespace, and clean LLM output for downstream processing.                                                                    |
| **📊 Monitoring**                                | Built-in integrations with Prometheus, OpenTelemetry, and Sentry for metrics, tracing, and error tracking.                                                                                            |
| **🔔 Lifecycle Callbacks**                       | `onStart`, `onComplete`, `onError`, `onEvent`, `onToken`, `onViolation`, `onRetry`, `onFallback` - full observability into every stream phase.                                                        |
| **📡 Streaming-First Runtime**                   | Thin, deterministic wrapper over `streamText()` with unified event types (`token`, `error`, `complete`) for easy UIs.                                                                                 |
| **📼 Atomic Event Logs**                         | Record every token, retry, fallback, and guardrail check as immutable events. Full audit trail for debugging and compliance.                                                                          |
| **🔄 Byte-for-Byte Replays**                     | Deterministically replay any recorded stream to reproduce exact output. Perfect for testing, and time-travel debugging.                                                                               |
| **⛔ Safety-First Defaults**                     | Continuation off by default. Structured objects never resumed. No silent corruption. Integrity always preserved.                                                                                      |
| **⚡ Tiny & Explicit**                           | 15KB gzipped core. Tree-shakeable with subpath exports (`/core`, `/structured`, `/consensus`, `/parallel`, `/window`). No frameworks, no heavy abstractions.                                          |
| **🔌 Custom Adapters (BYOA)**                    | Bring your own adapter for any LLM provider. Built-in adapters for Vercel AI SDK, OpenAI, and Mastra.                                                                                                 |
| **🖼️ Multimodal Support**                        | Build adapters for image/audio/video generation (FLUX.2, Stable Diffusion, Veo 3, CSM). Progress tracking, data events, and state management for non-text outputs.                                    |
| **🧪 Battle-Tested**                             | 2,000+ unit tests and 250+ integration tests validating real streaming, retries, and advanced behavior.                                                                                               |

## Quick Start

### With Vercel AI SDK: Minimal Usage

```typescript
import { l0, recommendedGuardrails, recommendedRetry } from "@ai2070/l0";
import { streamText } from "ai";
import { openai } from "@ai-sdk/openai";

const result = await l0({
  // Primary model stream
  stream: () =>
    streamText({
      model: openai("gpt-5-mini"),
      prompt,
    }),
});

// Read the stream
for await (const event of result.stream) {
```

### Vercel AI SDK: Expanded

```typescript
import { l0, recommendedGuardrails, recommendedRetry } from "@ai2070/l0";
import { streamText } from "ai";
import { openai } from "@ai-sdk/openai";

const result = await l0({
  // Primary model stream
  stream: () =>
    streamText({
      model: openai("gpt-5-mini"),
      prompt,
    }),

  // Optional: Fallback models
  fallbackStreams: [() => streamText({ model: openai("gpt-5-mini"), prompt })],

  // Optional: Guardrails, default: none
  guardrails: recommendedGuardrails,
  // Other presets:
  // minimalGuardrails       // JSON + zero output
  // recommendedGuardrails   // + Markdown, patterns
  // strictGuardrails        // + LaTeX
  // jsonOnlyGuardrails      // JSON only
  // markdownOnlyGuardrails  // Markdown only
  // latexOnlyGuardrails     // LaTeX only

  // Optional: Retry configuration, default as follows
  retry: {
    attempts: 3, // LLM errors only
    maxRetries: 6, // Total (LLM + network)
    baseDelay: 1000,
    maxDelay: 10000,
    backoff: "fixed-jitter", // "exponential" | "linear" | "fixed" | "full-jitter"
  },
  // Or simply:
  // retry: recommendedRetry (3/6/fixed-jitter) | minimalRetry (2/4/linear) | strictRetry (3/6/full-jitter) | exponentialRetry (4/8/exponential)

  // Optional: Timeout configuration, default as follows
  timeout: {
    initialToken: 5000, // 5s to first token
    interToken: 10000, // 10s between tokens
  },

  // Optional: Guardrail check intervals, default as follows
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

| Feature                                                               | Description                                                     |
| --------------------------------------------------------------------- | --------------------------------------------------------------- |
| [Streaming Runtime](#streaming-runtime)                               | Token-by-token normalization, checkpoints, resumable generation |
| [Retry Logic](#retry-logic)                                           | Smart retries with backoff, network vs model error distinction  |
| [Network Protection](#network-protection)                             | Auto-recovery from 12+ network failure types                    |
| [Structured Output](#structured-output)                               | Guaranteed valid JSON with Zod, Effect Schema, or JSON Schema   |
| [Fallback Models](#fallback-models)                                   | Sequential fallback when primary model fails                    |
| [Document Windows](#document-windows)                                 | Automatic chunking for long documents                           |
| [Formatting Helpers](#formatting-helpers)                             | Context, memory, tools, and output formatting utilities         |
| [Last-Known-Good Token Resumption](#last-known-good-token-resumption) | Resume from last checkpoint on retry/fallback (opt-in)          |
| [Guardrails](#guardrails)                                             | JSON, Markdown, LaTeX validation, pattern detection             |
| [Consensus](#consensus)                                               | Multi-model agreement with voting strategies                    |
| [Parallel Operations](#parallel-operations)                           | Race, batch, pool patterns for concurrent LLM calls             |
| [Type-Safe Generics](#type-safe-generics)                             | Forward output types through all L0 functions                   |
| [Custom Adapters (BYOA)](#custom-adapters-byoa)                       | Bring your own adapter for any LLM provider                     |
| [Multimodal Support](#multimodal-support)                             | Image, audio, video generation with progress tracking           |
| [Lifecycle Callbacks](#lifecycle-callbacks)                           | Full observability into every stream phase                      |
| [Event Sourcing](#event-sourcing)                                     | Record/replay streams for testing and audit trails              |
| [Error Handling](#error-handling)                                     | Typed errors with categorization and recovery hints             |
| [Monitoring](#monitoring)                                             | Built-in Prometheus, OTel and Sentry integrations               |
| [Testing](#testing)                                                   | 2,000+ tests covering all features and SDK adapters             |

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
    case "complete":
      console.log("Complete");
      break;
    case "error":
      console.error(event.error, event.reason); // reason: ErrorCategory
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
    attempts: 3, // Model errors only (default: 3)
    maxRetries: 6, // Absolute cap across all error types (default: 6)
    baseDelay: 1000,
    maxDelay: 10000,
    backoff: "fixed-jitter", // or "exponential", "linear", "fixed", "full-jitter"

    // Optional: specify which error types to retry on, defaults to all recoverable errors
    retryOn: [
      "zero_output",
      "guardrail_violation",
      "drift",
      "incomplete",
      "network_error",
      "timeout",
      "rate_limit",
      "server_error",
    ],

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

| Error Type           | Retries | Counts Toward `attempts` | Counts Toward `maxRetries` |
| -------------------- | ------- | ------------------------ | -------------------------- |
| Network disconnect   | Yes     | No                       | Yes                        |
| Zero output          | Yes     | No                       | Yes                        |
| Timeout              | Yes     | No                       | Yes                        |
| 429 rate limit       | Yes     | No                       | Yes                        |
| 503 server error     | Yes     | No                       | Yes                        |
| Guardrail violation  | Yes     | **Yes**                  | Yes                        |
| Drift detected       | Yes     | **Yes**                  | Yes                        |
| Auth error (401/403) | No      | -                        | -                          |

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

Guaranteed valid JSON matching your schema. Supports **Zod** (v3/v4), **Effect Schema**, and **JSON Schema**:

### With Zod

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

### With Effect Schema

```typescript
import {
  structured,
  registerEffectSchemaAdapter,
  wrapEffectSchema,
} from "@ai2070/l0";
import { Schema } from "effect";

// Register the adapter once at app startup
registerEffectSchemaAdapter({
  decodeUnknownSync: (schema, data) => Schema.decodeUnknownSync(schema)(data),
  decodeUnknownEither: (schema, data) => {
    try {
      return { _tag: "Right", right: Schema.decodeUnknownSync(schema)(data) };
    } catch (error) {
      return {
        _tag: "Left",
        left: { _tag: "ParseError", issue: error, message: error.message },
      };
    }
  },
  formatError: (error) => error.message,
});

// Define schema with Effect
const schema = Schema.Struct({
  name: Schema.String,
  age: Schema.Number,
  email: Schema.String,
});

// Use with structured()
const result = await structured({
  schema: wrapEffectSchema(schema),
  stream: () => streamText({ model, prompt: "Generate user data as JSON" }),
  autoCorrect: true,
});

console.log(result.data.name); // string - fully typed
```

### With JSON Schema

```typescript
import {
  structured,
  registerJSONSchemaAdapter,
  wrapJSONSchema,
} from "@ai2070/l0";
import Ajv from "ajv"; // Or any JSON Schema validator

// Register adapter once at app startup (example with Ajv)
const ajv = new Ajv({ allErrors: true });
registerJSONSchemaAdapter({
  validate: (schema, data) => {
    const validate = ajv.compile(schema);
    const valid = validate(data);
    if (valid) return { valid: true, data };
    return {
      valid: false,
      errors: (validate.errors || []).map((e) => ({
        path: e.instancePath || "/",
        message: e.message || "Validation failed",
        keyword: e.keyword,
        params: e.params,
      })),
    };
  },
  formatErrors: (errors) =>
    errors.map((e) => `${e.path}: ${e.message}`).join(", "),
});

// Define schema with JSON Schema
const schema = {
  type: "object",
  properties: {
    name: { type: "string" },
    age: { type: "number" },
    email: { type: "string", format: "email" },
  },
  required: ["name", "age", "email"],
};

// Use with structured()
const result = await structured({
  schema: wrapJSONSchema<{ name: string; age: number; email: string }>(schema),
  stream: () => streamText({ model, prompt: "Generate user data as JSON" }),
  autoCorrect: true,
});

console.log(result.data.name); // string - typed via generic
```

---

## Fallback Models

Sequential fallback when primary model fails:

```typescript
const result = await l0({
  stream: () => streamText({ model: openai("gpt-4o"), prompt }),
  fallbackStreams: [
    () => streamText({ model: openai("gpt-5-nano"), prompt }),
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

---

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
  retry: { attempts: 3 },

  // Enable continuation from last checkpoint (opt-in)
  continueFromLastKnownGoodToken: true,
});

// Check if continuation was used
console.log(result.state.resumed); // true if resumed from checkpoint
console.log(result.state.resumePoint); // The checkpoint content
console.log(result.state.resumeFrom); // Character offset where resume occurred
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
  stream: () =>
    streamText({
      model: openai("gpt-4o"),
      prompt: continuationPrompt || originalPrompt,
    }),
  continueFromLastKnownGoodToken: true,
  buildContinuationPrompt: (checkpoint) => {
    // Update the prompt to tell the LLM to continue from checkpoint
    continuationPrompt = `${originalPrompt}\n\nContinue from where you left off:\n${checkpoint}`;
    return continuationPrompt;
  },
  retry: { attempts: 3 },
});
```

When LLMs continue from a checkpoint, they often repeat words from the end. L0 automatically detects and removes this overlap (enabled by default). See [API Reference](./API.md#smart-continuation-deduplication) for configuration options.

### Example: Resuming After Network Error

```typescript
const result = await l0({
  stream: () =>
    streamText({
      model: openai("gpt-4o"),
      prompt: "Write a detailed analysis of...",
    }),
  fallbackStreams: [() => streamText({ model: openai("gpt-5-nano"), prompt })],
  retry: { attempts: 3 },
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
  console.log(
    "\nResumed from checkpoint of length:",
    result.telemetry.continuation.checkpointLength,
  );
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
>
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

### Fast/Slow Path Execution

L0 uses a two-path strategy to avoid blocking the streaming loop:

| Path | When | Behavior |
|------|------|----------|
| **Fast** | Delta < 1KB, total < 5KB | Synchronous check, immediate result |
| **Slow** | Large content | Deferred via `setImmediate()`, non-blocking |

For long outputs, tune the check frequency:

```typescript
await l0({
  stream,
  guardrails: recommendedGuardrails,
  checkIntervals: {
    guardrails: 50, // Check every 50 tokens (default: 5)
  },
});
```

See [GUARDRAILS.md](./GUARDRAILS.md) for full documentation.

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
    () => streamText({ model: openai("gpt-5-nano"), prompt }),
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

## Type-Safe Generics

All L0 functions support generic type parameters to forward your output types:

```typescript
import { l0, parallel, race, consensus } from "@ai2070/l0";

// Typed output (compile-time type annotation)
interface UserProfile {
  name: string;
  age: number;
  email: string;
}

const result = await l0<UserProfile>({
  stream: () => streamText({ model, prompt }),
});
// result is L0Result<UserProfile> - generic enables type inference in callbacks

// Works with all parallel operations
const raceResult = await race<UserProfile>([
  { stream: () => streamText({ model: openai("gpt-4o"), prompt }) },
  { stream: () => streamText({ model: anthropic("claude-3-opus"), prompt }) },
]);

const parallelResults = await parallel<UserProfile>(operations);
// parallelResults.results[0]?.state is typed

// Consensus with type inference
const consensusResult = await consensus<typeof schema>({
  streams: [stream1, stream2, stream3],
  schema,
});
```

---

## Custom Adapters (BYOA)

L0 supports custom adapters for integrating any LLM provider. Built-in adapters include `openaiAdapter`, `mastraAdapter`, and `anthropicAdapter` (reference implementation).

### Explicit Adapter Usage

```typescript
import { l0, openaiAdapter } from "@ai2070/l0";
import OpenAI from "openai";

const openai = new OpenAI();

const result = await l0({
  stream: () =>
    openai.chat.completions.create({
      model: "gpt-4",
      messages: [{ role: "user", content: "Hello!" }],
      stream: true,
    }),
  adapter: openaiAdapter,
});
```

### Building Custom Adapters

```typescript
import { toL0Events, type L0Adapter } from "@ai2070/l0";

interface MyChunk {
  text?: string;
}

const myAdapter: L0Adapter<AsyncIterable<MyChunk>> = {
  name: "myai",

  // Optional: Enable auto-detection
  detect(input): input is AsyncIterable<MyChunk> {
    return !!input && typeof input === "object" && "__myMarker" in input;
  },

  // Convert provider stream to L0 events
  wrap(stream) {
    return toL0Events(stream, (chunk) => chunk.text ?? null);
  },
};
```

### Adapter Invariants

Adapters MUST:

- Preserve text exactly (no trimming, no modification)
- Include timestamps on every event
- Convert errors to error events (never throw)
- Emit complete event exactly once at end

See [CUSTOM_ADAPTERS.md](./CUSTOM_ADAPTERS.md) for complete guide including helper functions, registry API, and testing patterns.

---

## Multimodal Support

L0 supports image, audio, and video generation with progress tracking and data events:

```typescript
import { l0, toMultimodalL0Events, type L0Adapter } from "@ai2070/l0";

const fluxAdapter: L0Adapter<FluxStream> = {
  name: "flux",
  wrap: (stream) =>
    toMultimodalL0Events(stream, {
      extractProgress: (chunk) =>
        chunk.type === "progress" ? { percent: chunk.percent } : null,
      extractData: (chunk) =>
        chunk.type === "image"
          ? {
              contentType: "image",
              mimeType: "image/png",
              base64: chunk.image,
              metadata: {
                width: chunk.width,
                height: chunk.height,
                seed: chunk.seed,
              },
            }
          : null,
    }),
};

const result = await l0({
  stream: () => fluxGenerate({ prompt: "A cat in space" }),
  adapter: fluxAdapter,
});

for await (const event of result.stream) {
  if (event.type === "progress") console.log(`${event.progress?.percent}%`);
  if (event.type === "data") saveImage(event.data?.base64);
}

// All generated images available in state
console.log(result.state.dataOutputs);
```

See [MULTIMODAL.md](./MULTIMODAL.md) for complete guide.

---

## Lifecycle Callbacks

L0 provides callbacks for every phase of stream execution, giving you full observability into the streaming lifecycle:

```typescript
const result = await l0({
  stream: () => streamText({ model, prompt }),

  monitoring: {
    // Called when streaming begins
    onStart: (context) => {
      console.log("Stream started:", context.streamId);
      console.log("Attempt:", context.attempt);
    },

    // Called for every token received
    onToken: (token, context) => {
      process.stdout.write(token);
      // context includes: tokenIndex, timestamp, checkpoint
    },

    // Called for every L0 event (token, error, complete, etc.)
    onEvent: (event) => {
      if (event.type === "progress") {
        console.log("Progress:", event.progress?.percent);
      }
    },

    // Called when a guardrail violation is detected
    onViolation: (violation) => {
      console.warn("Violation:", violation.rule, violation.message);
      // violation.fatal indicates if stream will be aborted
    },

    // Called before each retry attempt
    onRetry: (attempt, error, context) => {
      console.log(`Retry ${attempt}/${context.maxRetries}:`, error.code);
      // context includes: delay, errorType, checkpoint
    },

    // Called when switching to a fallback model
    onFallback: (index, error, context) => {
      console.log(`Fallback to model ${index}:`, error.message);
      // context includes: previousModel, checkpoint
    },

    // Called when stream completes successfully
    onComplete: (content, context) => {
      console.log("Completed:", content.length, "chars");
      console.log("Tokens:", context.tokenCount);
      console.log("Duration:", context.duration, "ms");
    },

    // Called when stream fails after all retries
    onError: (error, context) => {
      console.error("Failed:", error.code);
      console.log("Checkpoint:", context.checkpoint);
      // context includes: attempts, lastError, partial content
    },
  },
});
```

### Callback Reference

| Callback      | When Called                              | Parameters                                      |
| ------------- | ---------------------------------------- | ----------------------------------------------- |
| `onStart`     | Stream begins (including retries)        | `(context: StartContext)`                       |
| `onToken`     | Each token received                      | `(token: string, context: TokenContext)`        |
| `onEvent`     | Every L0 event (token, progress, data)   | `(event: L0Event)`                              |
| `onViolation` | Guardrail violation detected             | `(violation: Violation)`                        |
| `onRetry`     | Before retry attempt                     | `(attempt: number, error: L0Error, context)`    |
| `onFallback`  | Switching to fallback model              | `(index: number, error: L0Error, context)`      |
| `onComplete`  | Stream finished successfully             | `(content: string, context: CompleteContext)`   |
| `onError`     | Stream failed after all retries/fallback | `(error: L0Error, context: ErrorContext)`       |

### Use Cases

```typescript
// Logging and debugging
monitoring: {
  onStart: (ctx) => logger.info("stream.start", { id: ctx.streamId }),
  onComplete: (_, ctx) => logger.info("stream.complete", { tokens: ctx.tokenCount }),
  onError: (err, ctx) => logger.error("stream.failed", { error: err.code }),
}

// Real-time UI updates
monitoring: {
  onToken: (token) => appendToChat(token),
  onRetry: () => showRetryingIndicator(),
  onFallback: () => showFallbackNotice(),
}

// Custom metrics collection
monitoring: {
  onComplete: (_, ctx) => {
    metrics.recordHistogram("ttft", ctx.timeToFirstToken);
    metrics.incrementCounter("tokens", ctx.tokenCount);
  },
  onViolation: (v) => metrics.incrementCounter("violations", { rule: v.rule }),
}
```

See [API.md#lifecycle-callbacks](./API.md#lifecycle-callbacks) for complete callback type definitions.

---

## Event Sourcing

Every L0 stream operation can be recorded and replayed deterministically. This enables testing, debugging, and audit trails.

```typescript
import {
  createInMemoryEventStore,
  createEventRecorder,
  replay,
} from "@ai2070/l0";

// Record a stream
const store = createInMemoryEventStore();
const recorder = createEventRecorder(store, "my-stream");

await recorder.recordStart({ prompt: "test", model: "gpt-4" });
await recorder.recordToken("Hello", 0);
await recorder.recordToken(" World", 1);
await recorder.recordComplete("Hello World", 2);

// Replay it - exact same output, no API calls
const result = await replay({
  streamId: "my-stream",
  eventStore: store,
  fireCallbacks: true, // onToken still fires!
});

for await (const event of result.stream) {
  console.log(event); // Same events as original
}
```

**Key insight:** Replay is pure stream rehydration. No network, no retries, no guardrail evaluation - derived computations are stored as events.

**Use cases:**

- Deterministic testing - record once, replay in tests
- Production failure reproduction
- Time-travel debugging
- Complete audit trails
- Response caching

See [EVENT_SOURCING.md](./EVENT_SOURCING.md) for complete guide.

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
    console.log(error.isRecoverable); // Can retry?
  }
}
```

Error codes: `STREAM_ABORTED`, `INITIAL_TOKEN_TIMEOUT`, `INTER_TOKEN_TIMEOUT`, `ZERO_OUTPUT`, `GUARDRAIL_VIOLATION`, `FATAL_GUARDRAIL_VIOLATION`, `INVALID_STREAM`, `ALL_STREAMS_EXHAUSTED`, `NETWORK_ERROR`, `DRIFT_DETECTED`

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

## Testing

L0 ships with **comprehensive test coverage** across all core reliability systems - including streaming, guardrails, structured output, retry logic, fallbacks, pipelines, consensus, observability, and distributed tracing.

### Test Coverage

| Category          | Tests  | Description                      |
| ----------------- | ------ | -------------------------------- |
| Unit Tests        | 2,000+ | Fast, mocked, no API calls       |
| Integration Tests | 250+   | Real API calls, all SDK adapters |

```bash
# Run unit tests (fast, no API keys needed)
npm test

# Run integration tests (requires API keys)
OPENAI_API_KEY=sk-... ANTHROPIC_API_KEY=sk-... npm run test:integration
```

### SDK Adapter Matrix

L0 supports all major provider SDKs with full end-to-end testing:

| Adapter           | Integration | Version Range                           |
| ----------------- | ----------- | --------------------------------------- |
| **Vercel AI SDK** | ✓           | `^5.0.0` · (`^6.0.0` as soon as stable) |
| **OpenAI SDK**    | ✓           | `^4.0.0` · `^5.0.0` · `^6.0.0`          |
| **Mastra AI**     | ✓           | `>= 0.24.0`                             |

### Feature Test Matrix

Every major reliability feature in L0 has dedicated test suites:

| Feature               | Unit | Integration | Notes                                    |
| --------------------- | ---- | ----------- | ---------------------------------------- |
| **Streaming**         | ✓    | ✓           | Token events, completion                 |
| **Guardrails**        | ✓    | ✓           | JSON/Markdown/LaTeX, patterns, drift     |
| **Structured Output** | ✓    | ✓           | Zod schemas, auto-correction             |
| **Retry Logic**       | ✓    | ✓           | Backoff, error classification            |
| **Network Errors**    | ✓    | –           | 12+ simulated error types                |
| **Fallback Models**   | ✓    | ✓           | Sequential fallthrough                   |
| **Parallel / Race**   | ✓    | ✓           | Concurrency, cancellation                |
| **Pipeline**          | ✓    | ✓           | Multi-step streaming workflows           |
| **Consensus**         | ✓    | ✓           | Unanimous, weighted, best-match          |
| **Document Windows**  | ✓    | ✓           | Token, paragraph, sentence chunking      |
| **Continuation**      | ✓    | ✓           | Last-known-good token resumption         |
| **Monitoring**        | ✓    | ✓           | Prometheus, metrics, tokens, retries     |
| **Sentry**            | ✓    | ✓           | Error tagging, breadcrumbs, performance  |
| **OpenTelemetry**     | ✓    | ✓           | GenAI semantic conventions, spans, TTFT  |
| **Event Sourcing**    | ✓    | ✓           | Record/replay, deterministic testing     |
| **Interceptors**      | ✓    | –           | All built-in interceptors validated      |
| **Drift Detection**   | ✓    | –           | Pattern detection, entropy, format drift |
| **Custom Adapters**   | ✓    | ✓           | OpenAI, Anthropic, Mastra adapters       |
| **Multimodal**        | ✓    | ✓           | Data/progress events, state tracking     |

---

## Philosophy

- **No magic** - Everything is explicit and predictable
- **Streaming-first** - Built for real-time token delivery
- **Signals, not rewrites** - Guardrails detect issues, don't modify output
- **Model-agnostic** - Works with any model
- **Zero dependencies** - Only peer dependency is the Vercel AI SDK, the OpenAI SDK, or Mastra AI

---

## Documentation

| Guide                                                          | Description                 |
| -------------------------------------------------------------- | --------------------------- |
| [QUICKSTART.md](./QUICKSTART.md)                               | 5-minute getting started    |
| [API.md](./API.md)                                             | Complete API reference      |
| [GUARDRAILS.md](./GUARDRAILS.md)                               | Guardrails and validation   |
| [STRUCTURED_OUTPUT.md](./STRUCTURED_OUTPUT.md)                 | Structured output guide     |
| [CONSENSUS.md](./CONSENSUS.md)                                 | Multi-generation consensus  |
| [DOCUMENT_WINDOWS.md](./DOCUMENT_WINDOWS.md)                   | Document chunking guide     |
| [NETWORK_ERRORS.md](./NETWORK_ERRORS.md)                       | Network error handling      |
| [INTERCEPTORS_AND_PARALLEL.md](./INTERCEPTORS_AND_PARALLEL.md) | Parallel operations         |
| [MONITORING.md](./MONITORING.md)                               | Telemetry and metrics       |
| [EVENT_SOURCING.md](./EVENT_SOURCING.md)                       | Record/replay, audit trails |
| [FORMATTING.md](./FORMATTING.md)                               | Formatting helpers          |
| [CUSTOM_ADAPTERS.md](./CUSTOM_ADAPTERS.md)                     | Build your own adapters     |
| [MULTIMODAL.md](./MULTIMODAL.md)                               | Image/audio/video support   |

---

## Support

L0 is developed and maintained independently. If your company depends on L0 or wants to support ongoing development (including the Python version, website docs, and future tooling), feel free to reach out:

**makerseven7@gmail.com**

---

## License

MIT
