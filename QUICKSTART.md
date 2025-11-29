# L0 Quick Start Guide

Get started with L0 in 5 minutes.

## Installation

```bash
npm install l0
```

**Peer dependency:** Requires `ai` package (Vercel AI SDK)

```bash
npm install ai @ai-sdk/openai
```

## Basic Usage

```typescript
import { l0, recommendedGuardrails, recommendedRetry } from "l0";
import { streamText } from "ai";
import { openai } from "@ai-sdk/openai";

const result = await l0({
  stream: () => streamText({
    model: openai("gpt-4o"),
    prompt: "Write a haiku about coding"
  }),
  guardrails: recommendedGuardrails,
  retry: recommendedRetry
});

for await (const event of result.stream) {
  if (event.type === "token") {
    process.stdout.write(event.value);
  }
}

console.log("\n\nTokens:", result.state.tokenCount);
```

You now have:
- Automatic retry on network failures
- Guardrails detecting malformed output
- Zero-token detection
- Unified event format

---

## Common Patterns

### Structured Output (Guaranteed JSON)

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
  stream: () => streamText({
    model: openai("gpt-4o"),
    prompt: "Generate a user profile as JSON"
  })
});

// Type-safe access
console.log(result.data.name);  // string
console.log(result.data.age);   // number
```

### Timeout Protection

```typescript
const result = await l0({
  stream: () => streamText({ model, prompt }),
  initialTokenTimeout: 3000,  // 3s for first token
  interTokenTimeout: 1000,    // 1s max gap between tokens
  guardrails: recommendedGuardrails
});
```

### Fallback Models

```typescript
const result = await l0({
  stream: () => streamText({ model: openai("gpt-4o"), prompt }),
  fallbackStreams: [
    () => streamText({ model: openai("gpt-4o-mini"), prompt }),
    () => streamText({ model: anthropic("claude-3-haiku"), prompt })
  ]
});

if (result.state.fallbackIndex > 0) {
  console.log("Used fallback model");
}
```

### Custom Guardrails

```typescript
import { customPatternRule, zeroOutputRule } from "l0";

const result = await l0({
  stream: () => streamText({ model, prompt }),
  guardrails: [
    zeroOutputRule(),
    customPatternRule([/forbidden/i], "Contains forbidden word")
  ]
});
```

### Document Processing

```typescript
import { createWindow } from "l0";

const window = createWindow(longDocument, {
  size: 2000,
  overlap: 200,
  strategy: "paragraph"
});

const results = await window.processAll((chunk) => ({
  stream: () => streamText({
    model,
    prompt: `Summarize: ${chunk.content}`
  })
}));
```

### Error Handling

```typescript
import { isL0Error, isNetworkError } from "l0";

try {
  const result = await l0({ stream, guardrails });
  for await (const event of result.stream) {
    // Process events
  }
} catch (error) {
  if (isL0Error(error)) {
    console.log("Error code:", error.code);
    console.log("Checkpoint:", error.getCheckpoint());
  } else if (isNetworkError(error)) {
    console.log("Network issue - will auto-retry");
  }
}
```

---

## Presets

### Guardrails

```typescript
import {
  minimalGuardrails,      // JSON + zero output
  recommendedGuardrails,  // + Markdown, drift, patterns
  strictGuardrails        // + function calls, schema
} from "l0";
```

### Retry

```typescript
import {
  minimalRetry,      // 1 attempt
  recommendedRetry,  // 2 attempts, exponential backoff
  strictRetry        // 3 attempts, full-jitter
} from "l0";
```

---

## Result State

After consuming the stream:

```typescript
console.log({
  content: result.state.content,        // Full output
  tokenCount: result.state.tokenCount,  // Token count
  completed: result.state.completed,    // Stream finished
  retryAttempts: result.state.retryAttempts,
  fallbackIndex: result.state.fallbackIndex
});
```

---

## Next Steps

| Guide | Description |
|-------|-------------|
| [API.md](./API.md) | Complete API reference |
| [STRUCTURED_OUTPUT.md](./STRUCTURED_OUTPUT.md) | Guaranteed JSON with schemas |
| [DOCUMENT_WINDOWS.md](./DOCUMENT_WINDOWS.md) | Processing long documents |
| [NETWORK_ERRORS.md](./NETWORK_ERRORS.md) | Network error handling |
| [PERFORMANCE.md](./PERFORMANCE.md) | Performance tuning |
| [ERROR_HANDLING.md](./ERROR_HANDLING.md) | Error codes and recovery |
