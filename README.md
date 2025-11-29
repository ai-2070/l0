# L0 - Reliable LLM Streaming Runtime

**Tiny. Predictable. Streaming-first.**

L0 adds guardrails, retry logic, and network protection on top of the Vercel AI SDK, turning raw LLM streams into production-grade outputs.

```bash
npm install l0
```

## Quick Start

```typescript
import { l0, recommendedGuardrails, recommendedRetry } from "l0";
import { streamText } from "ai";
import { openai } from "@ai-sdk/openai";

const result = await l0({
  stream: () => streamText({
    model: openai("gpt-4o"),
    prompt: "Generate a haiku about coding"
  }),
  guardrails: recommendedGuardrails,
  retry: recommendedRetry
});

for await (const event of result.stream) {
  if (event.type === "token") process.stdout.write(event.value);
}
```

## Core Features

| Feature | Description |
|---------|-------------|
| [Streaming Runtime](#streaming-runtime) | Token-by-token normalization, checkpoints, resumable generation |
| [Guardrails](#guardrails) | JSON, Markdown, LaTeX validation, pattern detection |
| [Structured Output](#structured-output) | Guaranteed valid JSON with Zod schema validation |
| [Retry Logic](#retry-logic) | Smart retries with backoff, network vs model error distinction |
| [Network Protection](#network-protection) | Auto-recovery from 12+ network failure types |
| [Document Windows](#document-windows) | Automatic chunking for long documents |
| [Fallback Models](#fallback-models) | Sequential fallback when primary model fails |

---

## Streaming Runtime

L0 wraps `streamText()` with deterministic behavior:

```typescript
const result = await l0({
  stream: () => streamText({ model, prompt }),
  initialTokenTimeout: 2000,  // Timeout before first token
  interTokenTimeout: 1000,    // Timeout between tokens
  signal: abortController.signal
});

// Unified event format
for await (const event of result.stream) {
  switch (event.type) {
    case "token": console.log(event.value); break;
    case "done": console.log("Complete"); break;
    case "error": console.error(event.error); break;
  }
}

// Access final state
console.log(result.state.content);      // Full accumulated content
console.log(result.state.tokenCount);   // Total tokens received
console.log(result.state.checkpoint);   // Last stable checkpoint
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
  customPatternRule 
} from "l0";

const result = await l0({
  stream: () => streamText({ model, prompt }),
  guardrails: [
    jsonRule(),           // Validates JSON structure
    markdownRule(),       // Validates Markdown fences/tables
    zeroOutputRule(),     // Detects empty output
    patternRule(),        // Detects "As an AI..." patterns
    customPatternRule([/forbidden/i], "Custom violation")
  ]
});
```

### Presets

```typescript
import { minimalGuardrails, recommendedGuardrails, strictGuardrails } from "l0";

// Minimal: JSON + zero output detection
// Recommended: + Markdown, drift, patterns
// Strict: + function calls, schema validation
```

---

## Structured Output

Guaranteed valid JSON matching your Zod schema:

```typescript
import { structured } from "l0";
import { z } from "zod";

const schema = z.object({
  name: z.string(),
  age: z.number(),
  email: z.string().email()
});

const result = await structured({
  schema,
  stream: () => streamText({ model, prompt: "Generate user data as JSON" }),
  autoCorrect: true  // Fix trailing commas, missing braces, etc.
});

// Type-safe access
console.log(result.data.name);   // string
console.log(result.data.age);    // number
console.log(result.corrected);   // true if auto-corrected
```

---

## Retry Logic

Smart retry system that distinguishes network errors from model errors:

```typescript
const result = await l0({
  stream: () => streamText({ model, prompt }),
  retry: {
    maxAttempts: 2,           // Model errors only
    baseDelay: 1000,
    maxDelay: 10000,
    backoff: "exponential",   // or "linear", "fixed", "full-jitter"
    retryOn: ["zero_output", "guardrail_violation", "drift"]
  }
});
```

### Retry Behavior

| Error Type | Retries | Counts Toward Limit |
|------------|---------|---------------------|
| Network disconnect | Yes | No |
| Zero output | Yes | No |
| Timeout | Yes | No |
| 429 rate limit | Yes | No |
| 503 server error | Yes | No |
| Guardrail violation | Yes | **Yes** |
| Malformed output | Yes | **Yes** |
| Drift detected | Yes | **Yes** |
| Auth error (401/403) | No | - |

---

## Network Protection

Automatic detection and recovery from network failures:

```typescript
import { isNetworkError, analyzeNetworkError } from "l0";

try {
  await l0({ stream, retry: recommendedRetry });
} catch (error) {
  if (isNetworkError(error)) {
    const analysis = analyzeNetworkError(error);
    console.log(analysis.type);       // "connection_dropped", "timeout", etc.
    console.log(analysis.retryable);  // true/false
    console.log(analysis.suggestion); // Recovery suggestion
  }
}
```

Detected error types: connection dropped, fetch errors, ECONNRESET, ECONNREFUSED, SSE aborted, DNS errors, timeouts, mobile background throttle, and more.

---

## Document Windows

Process documents that exceed context limits:

```typescript
import { createWindow } from "l0";

const window = createWindow(longDocument, {
  size: 2000,           // Tokens per chunk
  overlap: 200,         // Overlap between chunks
  strategy: "paragraph" // or "token", "sentence", "char"
});

// Process all chunks
const results = await window.processAll((chunk) => ({
  stream: () => streamText({
    model,
    prompt: `Summarize: ${chunk.content}`
  })
}));

// Or navigate manually
const first = window.current();
const next = window.next();
```

---

## Fallback Models

Sequential fallback when primary model fails:

```typescript
const result = await l0({
  stream: () => streamText({ model: openai("gpt-4o"), prompt }),
  fallbackStreams: [
    () => streamText({ model: openai("gpt-4o-mini"), prompt }),
    () => streamText({ model: anthropic("claude-3-haiku"), prompt })
  ]
});

// Check which model succeeded
console.log(result.state.fallbackIndex); // 0 = primary, 1+ = fallback
```

---

## Consensus

Multi-generation consensus for high-confidence results:

```typescript
import { consensus } from "l0";

const result = await consensus({
  streams: [
    () => streamText({ model, prompt }),
    () => streamText({ model, prompt }),
    () => streamText({ model, prompt })
  ],
  strategy: "majority",  // or "unanimous", "weighted", "best"
  threshold: 0.8
});

console.log(result.consensus);    // Agreed output
console.log(result.confidence);   // 0-1 confidence score
console.log(result.agreements);   // What they agreed on
console.log(result.disagreements); // Where they differed
```

---

## Error Handling

L0 provides detailed error context for debugging and recovery:

```typescript
import { isL0Error, L0Error } from "l0";

try {
  await l0({ stream, guardrails });
} catch (error) {
  if (isL0Error(error)) {
    console.log(error.code);              // "GUARDRAIL_VIOLATION", "ZERO_OUTPUT", etc.
    console.log(error.context.checkpoint); // Last good content
    console.log(error.context.tokenCount); // Tokens before failure
    console.log(error.isRecoverable());   // Can retry?
  }
}
```

Error codes: `STREAM_ABORTED`, `INITIAL_TOKEN_TIMEOUT`, `INTER_TOKEN_TIMEOUT`, `ZERO_OUTPUT`, `GUARDRAIL_VIOLATION`, `FATAL_GUARDRAIL_VIOLATION`, `INVALID_STREAM`, `ALL_STREAMS_EXHAUSTED`, `NETWORK_ERROR`, `DRIFT_DETECTED`

---

## Formatting Helpers

Normalize prompts and structure output:

```typescript
import { formatContext, formatMemory, formatTool, formatJsonOutput } from "l0";

// Wrap documents safely
const context = formatContext(document, { role: "user" });

// Format conversation memory
const memory = formatMemory(messages);

// Define tools with JSON schema
const tool = formatTool({
  name: "search",
  description: "Search the web",
  parameters: { query: { type: "string" } }
});

// Request JSON output
const instruction = formatJsonOutput(schema);
```

---

## Philosophy

- **No magic** - Everything is explicit and predictable
- **Streaming-first** - Built for real-time token delivery
- **Signals, not rewrites** - Guardrails detect issues, don't modify output
- **Model-agnostic** - Works with any Vercel AI SDK provider
- **Zero dependencies** - Only peer dependency is the AI SDK

---

## Documentation

| Guide | Description |
|-------|-------------|
| [QUICKSTART.md](./QUICKSTART.md) | 5-minute getting started |
| [API.md](./API.md) | Complete API reference |
| [STRUCTURED_OUTPUT.md](./STRUCTURED_OUTPUT.md) | Structured output guide |
| [DOCUMENT_WINDOWS.md](./DOCUMENT_WINDOWS.md) | Document chunking guide |
| [NETWORK_ERRORS.md](./NETWORK_ERRORS.md) | Network error handling |
| [INTERCEPTORS_AND_PARALLEL.md](./INTERCEPTORS_AND_PARALLEL.md) | Parallel operations |

---

## License

MIT
