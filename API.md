# L0 API Reference

Complete API reference for L0.

## Table of Contents

- [Core Functions](#core-functions)
- [Structured Output](#structured-output)
- [Document Windows](#document-windows)
- [Consensus](#consensus)
- [Guardrails](#guardrails)
- [Retry Configuration](#retry-configuration)
- [Error Handling](#error-handling)
- [Formatting Helpers](#formatting-helpers)
- [Utility Functions](#utility-functions)
- [OpenAI SDK Adapter](#openai-sdk-adapter)
- [Types](#types)

---

## Core Functions

### l0(options)

Main streaming runtime with guardrails and retry logic.

```typescript
import { l0 } from "l0";

const result = await l0({
  // Required: Stream factory
  stream: () => streamText({ model, prompt }),
  
  // Optional: Fallback streams
  fallbackStreams: [
    () => streamText({ model: fallbackModel, prompt })
  ],
  
  // Optional: Guardrails
  guardrails: recommendedGuardrails,
  
  // Optional: Retry configuration
  retry: {
    maxAttempts: 2,
    baseDelay: 1000,
    maxDelay: 10000,
    backoff: "exponential",
    retryOn: ["zero_output", "guardrail_violation"]
  },
  
  // Optional: Timeouts (ms)
  initialTokenTimeout: 3000,
  interTokenTimeout: 1000,
  
  // Optional: Check intervals
  checkIntervals: {
    guardrails: 5,   // Check every N tokens
    drift: 10,
    checkpoint: 10
  },
  
  // Optional: Abort signal
  signal: abortController.signal,
  
  // Optional: Monitoring callbacks
  monitoring: {
    onToken: (token) => {},
    onViolation: (violation) => {},
    onRetry: (attempt, error) => {},
    onFallback: (index) => {}
  }
});

// Consume stream
for await (const event of result.stream) {
  switch (event.type) {
    case "token": console.log(event.value); break;
    case "done": console.log("Complete"); break;
    case "error": console.error(event.error); break;
  }
}

// Access final state
console.log(result.state.content);
console.log(result.state.tokenCount);
```

**Returns:** `L0Result`

| Property | Type | Description |
|----------|------|-------------|
| `stream` | `AsyncIterable<L0Event>` | Event stream |
| `state` | `L0State` | Runtime state |

---

## Structured Output

### structured(options)

Guaranteed valid JSON matching a Zod schema.

```typescript
import { structured } from "l0";
import { z } from "zod";

const schema = z.object({
  name: z.string(),
  age: z.number(),
  tags: z.array(z.string())
});

const result = await structured({
  schema,
  stream: () => streamText({ model, prompt }),
  
  // Optional: Fallbacks
  fallbackStreams: [...],
  
  // Optional: Auto-correction
  autoCorrect: true,
  
  // Optional: Validation retries
  retry: { attempts: 2 }
});

// Type-safe access
console.log(result.data.name);    // string
console.log(result.data.age);     // number
console.log(result.corrected);    // boolean - was auto-corrected
console.log(result.corrections);  // string[] - corrections made
console.log(result.raw);          // string - raw output
```

---

## Document Windows

### createWindow(document, options)

Create a window for processing long documents.

```typescript
import { createWindow } from "l0";

const window = createWindow(longDocument, {
  size: 2000,           // Tokens per chunk
  overlap: 200,         // Overlap between chunks
  strategy: "paragraph" // "token" | "char" | "paragraph" | "sentence"
});

// Navigation
const current = window.current();    // Current chunk
const next = window.next();          // Move to next
const prev = window.prev();          // Move to previous
window.jump(5);                      // Jump to chunk 5

// Process all chunks
const results = await window.processAll(
  (chunk) => ({
    stream: () => streamText({ model, prompt: chunk.content })
  }),
  { concurrency: 3 }  // Parallel processing
);

// Stats
console.log(window.stats());
// { totalChunks, currentIndex, processedCount, ... }
```

---

## Consensus

### consensus(options)

Multi-generation consensus for high-confidence results.

```typescript
import { consensus } from "l0";

const result = await consensus({
  streams: [
    () => streamText({ model, prompt }),
    () => streamText({ model, prompt }),
    () => streamText({ model, prompt })
  ],
  
  // Optional: Schema for structured consensus
  schema: z.object({ answer: z.string() }),
  
  // Optional: Strategy
  strategy: "majority",  // "majority" | "unanimous" | "weighted" | "best"
  threshold: 0.8,
  
  // Optional: Conflict resolution
  resolveConflicts: "vote",  // "vote" | "merge" | "best" | "fail"
  
  // Optional: Weights (for "weighted" strategy)
  weights: [1.0, 0.8, 0.6]
});

console.log(result.consensus);      // Agreed output
console.log(result.confidence);     // 0-1 confidence score
console.log(result.agreements);     // Agreement details
console.log(result.disagreements);  // Disagreement details
```

### quickConsensus(outputs, threshold?)

Quick check if outputs agree.

```typescript
import { quickConsensus } from "l0";

const hasConsensus = quickConsensus(["A", "A", "B"], 0.6);  // true
```

### getConsensusValue(outputs)

Get most common value from outputs.

```typescript
import { getConsensusValue } from "l0";

const value = getConsensusValue(["A", "A", "B"]);  // "A"
```

---

## Guardrails

### Built-in Rules

```typescript
import {
  jsonRule,           // JSON structure validation
  strictJsonRule,     // Strict JSON (complete only)
  markdownRule,       // Markdown validation
  latexRule,          // LaTeX environment validation
  zeroOutputRule,     // Zero/empty output detection
  patternRule,        // Known bad patterns
  customPatternRule   // Custom regex patterns
} from "l0";
```

### Presets

```typescript
import {
  minimalGuardrails,      // JSON + zero output
  recommendedGuardrails,  // + Markdown, drift, patterns
  strictGuardrails,       // All rules
  jsonOnlyGuardrails,
  markdownOnlyGuardrails,
  latexOnlyGuardrails
} from "l0";
```

### Custom Guardrails

```typescript
const customRule: GuardrailRule = {
  name: "min-length",
  streaming: false,  // Only check complete output
  severity: "error",
  recoverable: true,
  check: (context) => {
    if (context.completed && context.content.length < 100) {
      return [{
        rule: "min-length",
        message: "Output too short",
        severity: "error",
        recoverable: true
      }];
    }
    return [];
  }
};
```

### GuardrailEngine

```typescript
import { GuardrailEngine } from "l0";

const engine = new GuardrailEngine({
  rules: [jsonRule(), markdownRule()],
  stopOnFatal: true,
  enableStreaming: true
});

const result = engine.check({
  content: "...",
  completed: true,
  tokenCount: 100
});
```

---

## Retry Configuration

### Presets

```typescript
import {
  minimalRetry,      // { maxAttempts: 1 }
  recommendedRetry,  // { maxAttempts: 2, backoff: "exponential" }
  strictRetry        // { maxAttempts: 3, backoff: "full-jitter" }
} from "l0";
```

### Centralized Defaults

```typescript
import { RETRY_DEFAULTS, ERROR_TYPE_DELAY_DEFAULTS } from "l0";

// RETRY_DEFAULTS
// { maxAttempts: 2, baseDelay: 1000, maxDelay: 10000, ... }

// ERROR_TYPE_DELAY_DEFAULTS
// { connectionDropped: 1000, fetchError: 500, timeout: 1000, ... }
```

### Custom Configuration

```typescript
const result = await l0({
  stream,
  retry: {
    maxAttempts: 3,
    maxRetries: 10,  // Absolute cap (all error types)
    baseDelay: 1000,
    maxDelay: 10000,
    backoff: "exponential",  // "exponential" | "linear" | "fixed" | "full-jitter"
    retryOn: ["zero_output", "guardrail_violation", "network_error"],
    maxErrorHistory: 100,  // Prevent memory leaks
    errorTypeDelays: {
      connectionDropped: 2000,
      timeout: 1500,
      dnsError: 5000
    }
  }
});
```

### RetryManager

```typescript
import { RetryManager } from "l0";

const manager = new RetryManager({
  maxAttempts: 3,
  backoff: "exponential"
});

const result = await manager.execute(async () => {
  return await riskyOperation();
});
```

---

## Error Handling

### L0Error

```typescript
import { isL0Error, L0Error } from "l0";

try {
  await l0({ stream, guardrails });
} catch (error) {
  if (isL0Error(error)) {
    console.log(error.code);              // L0ErrorCode
    console.log(error.context.checkpoint); // Last good content
    console.log(error.context.tokenCount);
    console.log(error.isRecoverable());
    console.log(error.getCheckpoint());
    console.log(error.toDetailedString());
  }
}
```

### Error Codes

| Code | Description |
|------|-------------|
| `STREAM_ABORTED` | Stream aborted |
| `INITIAL_TOKEN_TIMEOUT` | First token timeout |
| `INTER_TOKEN_TIMEOUT` | Token gap timeout |
| `ZERO_OUTPUT` | No meaningful output |
| `GUARDRAIL_VIOLATION` | Guardrail failed |
| `FATAL_GUARDRAIL_VIOLATION` | Fatal guardrail |
| `INVALID_STREAM` | Invalid stream factory |
| `ALL_STREAMS_EXHAUSTED` | All fallbacks failed |
| `NETWORK_ERROR` | Network failure |
| `DRIFT_DETECTED` | Output drift |

### Network Errors

```typescript
import { isNetworkError, analyzeNetworkError, NetworkErrorType } from "l0";

if (isNetworkError(error)) {
  const analysis = analyzeNetworkError(error);
  console.log(analysis.type);       // NetworkErrorType
  console.log(analysis.retryable);  // boolean
  console.log(analysis.suggestion); // string
}
```

### Error Categories

```typescript
import { ErrorCategory, getErrorCategory } from "l0";

const category = getErrorCategory(error);
// ErrorCategory.NETWORK    - Retry forever
// ErrorCategory.TRANSIENT  - Retry forever (429, 503)
// ErrorCategory.MODEL      - Counts toward limit
// ErrorCategory.FATAL      - No retry
```

---

## Formatting Helpers

### Context

```typescript
import { formatContext, formatDocument, formatInstructions } from "l0";

formatContext(content, { role: "user" });
formatDocument(content, { title: "Doc", author: "Me" });
formatInstructions("Generate JSON only");
```

### Memory

```typescript
import { formatMemory, createMemoryEntry } from "l0";

const memory = [
  createMemoryEntry("user", "Hello"),
  createMemoryEntry("assistant", "Hi!")
];

formatMemory(memory, { maxEntries: 10 });
```

### Output

```typescript
import { formatJsonOutput, formatStructuredOutput, cleanOutput } from "l0";

formatJsonOutput({ strict: true });
formatStructuredOutput("json", { schema: "..." });
cleanOutput("Sure! Here's the JSON: {...}");  // "{...}"
```

### Tools

```typescript
import { formatTool, formatTools, createTool, createParameter } from "l0";

const tool = createTool("search", "Search the web", [
  createParameter("query", "string", "Search query", true)
]);

formatTool(tool);
formatTools([tool1, tool2]);
```

---

## Utility Functions

### Text Normalization

```typescript
import {
  normalizeNewlines,
  normalizeWhitespace,
  normalizeForModel,
  dedent,
  indent,
  trimText
} from "l0";
```

### JSON Repair

```typescript
import {
  repairJson,
  isValidJson,
  parseOrRepairJson,
  extractJson,
  balanceBraces,
  balanceBrackets
} from "l0";
```

### Token Utilities

```typescript
import {
  isMeaningfulToken,
  hasMeaningfulContent,
  countMeaningfulTokens,
  estimateTokenCount,
  detectRepeatedTokens
} from "l0";
```

### Timer Utilities

```typescript
import {
  sleep,
  withTimeout,
  exponentialBackoff,
  linearBackoff,
  fullJitterBackoff,
  calculateBackoff
} from "l0";
```

### Comparison

```typescript
import {
  deepEqual,
  compareStrings,
  levenshteinSimilarity,
  cosineSimilarity
} from "l0";
```

---

## OpenAI SDK Adapter

L0 provides an adapter for using the OpenAI SDK directly instead of the Vercel AI SDK.

### wrapOpenAIStream(stream, options?)

Wrap an OpenAI SDK stream for use with L0.

```typescript
import OpenAI from "openai";
import { l0, wrapOpenAIStream } from "l0";

const openai = new OpenAI();

const result = await l0({
  stream: async () => {
    const stream = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [{ role: "user", content: "Hello!" }],
      stream: true
    });
    return wrapOpenAIStream(stream);
  }
});
```

**Options:**

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `includeUsage` | `boolean` | `true` | Include usage info in done event |
| `includeToolCalls` | `boolean` | `true` | Include tool calls as events |
| `emitFunctionCallsAsTokens` | `boolean` | `false` | Emit function call args as tokens |

### openaiStream(client, params, options?)

Create a stream factory from OpenAI client and params.

```typescript
import OpenAI from "openai";
import { l0, openaiStream } from "l0";

const openai = new OpenAI();

const result = await l0({
  stream: openaiStream(openai, {
    model: "gpt-4o",
    messages: [{ role: "user", content: "Hello!" }]
  })
});
```

### openaiText(client, model, prompt, options?)

Simple text generation helper.

```typescript
import OpenAI from "openai";
import { l0, openaiText } from "l0";

const openai = new OpenAI();

const result = await l0({
  stream: openaiText(openai, "gpt-4o", "Write a haiku about coding")
});

// Or with messages array
const result2 = await l0({
  stream: openaiText(openai, "gpt-4o", [
    { role: "system", content: "You are a poet." },
    { role: "user", content: "Write a haiku." }
  ])
});
```

### openaiJSON(client, model, prompt, options?)

JSON output with `response_format: { type: "json_object" }`.

```typescript
import OpenAI from "openai";
import { structured, openaiJSON } from "l0";
import { z } from "zod";

const openai = new OpenAI();

const result = await structured({
  schema: z.object({ name: z.string(), age: z.number() }),
  stream: openaiJSON(openai, "gpt-4o", "Generate user data as JSON")
});
```

### openaiWithTools(client, model, messages, tools, options?)

Tool/function calling support.

```typescript
import OpenAI from "openai";
import { l0, openaiWithTools } from "l0";

const openai = new OpenAI();

const result = await l0({
  stream: openaiWithTools(
    openai,
    "gpt-4o",
    [{ role: "user", content: "What's the weather in Tokyo?" }],
    [{
      type: "function",
      function: {
        name: "get_weather",
        description: "Get weather for a location",
        parameters: {
          type: "object",
          properties: { location: { type: "string" } },
          required: ["location"]
        }
      }
    }]
  )
});

// Tool calls appear as message events
for await (const event of result.stream) {
  if (event.type === "message") {
    const data = JSON.parse(event.value);
    if (data.type === "tool_calls") {
      console.log(data.tool_calls);
      // [{ id: "...", name: "get_weather", arguments: '{"location":"Tokyo"}' }]
    }
  }
}
```

### Utility Functions

```typescript
import { isOpenAIChunk, extractOpenAIText } from "l0";

// Type guard for OpenAI chunks
if (isOpenAIChunk(chunk)) {
  // chunk has choices[].delta structure
}

// Extract all text from a stream
const text = await extractOpenAIText(stream);
```

---

## Types

### L0Options

```typescript
interface L0Options {
  stream: () => Promise<StreamTextResult>;
  fallbackStreams?: Array<() => Promise<StreamTextResult>>;
  guardrails?: GuardrailRule[];
  retry?: Partial<RetryConfig>;
  initialTokenTimeout?: number;
  interTokenTimeout?: number;
  checkIntervals?: {
    guardrails?: number;
    drift?: number;
    checkpoint?: number;
  };
  signal?: AbortSignal;
  monitoring?: MonitoringCallbacks;
}
```

### L0State

```typescript
interface L0State {
  content: string;
  checkpoint: string;
  tokenCount: number;
  completed: boolean;
  retryAttempts: number;
  networkRetries: number;
  fallbackIndex: number;
  violations: GuardrailViolation[];
  firstTokenAt?: number;
  lastTokenAt?: number;
}
```

### L0Event

```typescript
interface L0Event {
  type: "token" | "message" | "error" | "done";
  value?: string;
  role?: string;
  error?: Error;
}
```

### GuardrailRule

```typescript
interface GuardrailRule {
  name: string;
  description?: string;
  streaming?: boolean;
  severity?: "warning" | "error" | "fatal";
  recoverable?: boolean;
  check: (context: GuardrailContext) => GuardrailViolation[];
}
```

### RetryConfig

```typescript
interface RetryConfig {
  maxAttempts: number;
  maxRetries?: number;
  baseDelay: number;
  maxDelay?: number;
  backoff: "exponential" | "linear" | "fixed" | "full-jitter";
  retryOn: RetryReason[];
  errorTypeDelays?: ErrorTypeDelays;
  maxErrorHistory?: number;
}
```

### ConsensusResult

```typescript
interface ConsensusResult<T> {
  consensus: T;
  confidence: number;
  outputs: ConsensusOutput[];
  agreements: Agreement[];
  disagreements: Disagreement[];
  analysis: ConsensusAnalysis;
  status: "success" | "partial" | "failed";
}
```

---

## See Also

- [QUICKSTART.md](./QUICKSTART.md) - Getting started
- [STRUCTURED_OUTPUT.md](./STRUCTURED_OUTPUT.md) - Structured output guide
- [DOCUMENT_WINDOWS.md](./DOCUMENT_WINDOWS.md) - Document processing
- [NETWORK_ERRORS.md](./NETWORK_ERRORS.md) - Network error handling
- [PERFORMANCE.md](./PERFORMANCE.md) - Performance tuning
- [ERROR_HANDLING.md](./ERROR_HANDLING.md) - Error handling guide
