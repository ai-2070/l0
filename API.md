# L0 API Reference

Complete API reference for L0.

## Table of Contents

- [Core Functions](#core-functions)
- [Type-Safe Generics](#type-safe-generics)
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
import { l0 } from "@ai2070/l0";

const result = await l0({
  // Required: Stream factory
  stream: () => streamText({ model, prompt }),

  // Optional: Fallback streams
  fallbackStreams: [() => streamText({ model: fallbackModel, prompt })],

  // Optional: Guardrails
  guardrails: recommendedGuardrails,

  // Optional: Retry configuration
  retry: {
    attempts: 3,
    baseDelay: 1000,
    maxDelay: 10000,
    backoff: "fixed-jitter",

    // Optional: specify which error types to retry on, defaults to all recoverable errors
    retryOn: [
      "zero_output",
      "guardrail_violation",
      "drift",
      "malformed",
      "incomplete",
      "network_error",
      "timeout",
      "rate_limit",
      "server_error",
    ],
  },

  // Optional: Timeouts (ms)
  timeout: {
    initialToken: 5000, // 5s to first token
    interToken: 10000, // 10s between tokens
  },

  // Optional: Check intervals
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

// Consume stream
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
console.log(result.state.content);
console.log(result.state.tokenCount);
```

**Returns:** `L0Result`

| Property | Type                     | Description   |
| -------- | ------------------------ | ------------- |
| `stream` | `AsyncIterable<L0Event>` | Event stream  |
| `state`  | `L0State`                | Runtime state |

---

## Type-Safe Generics

All L0 functions support generic type parameters to forward your output types through the entire call chain. This enables full type inference without manual casting.

### l0\<TOutput\>()

The core `l0()` function accepts a generic type parameter:

```typescript
import { l0 } from "@ai2070/l0";

interface UserProfile {
  name: string;
  age: number;
  email: string;
}

const result = await l0<UserProfile>({
  stream: () => streamText({ model, prompt }),
});

// result is L0Result<UserProfile>
// result.state includes the typed output
```

### parallel\<TOutput\>()

Run multiple operations with typed results:

```typescript
import { parallel } from "@ai2070/l0";

interface TaskResult {
  summary: string;
  score: number;
}

const results = await parallel<TaskResult>([
  { stream: () => streamText({ model, prompt: "Task 1" }) },
  { stream: () => streamText({ model, prompt: "Task 2" }) },
  { stream: () => streamText({ model, prompt: "Task 3" }) },
]);

// results is ParallelResult<TaskResult>
// results.results is Array<L0Result<TaskResult> | null>
for (const result of results.results) {
  if (result) {
    console.log(result.state.content); // typed access
  }
}
```

### parallelAll\<TOutput\>()

Unlimited concurrency variant:

```typescript
import { parallelAll } from "@ai2070/l0";

const results = await parallelAll<TaskResult>(operations);
// Same typing as parallel<TOutput>()
```

### sequential\<TOutput\>()

Sequential execution with typed results:

```typescript
import { sequential } from "@ai2070/l0";

const results = await sequential<TaskResult>(operations);
// Executes one at a time, same result type
```

### batched\<TOutput\>()

Batch processing with typed results:

```typescript
import { batched } from "@ai2070/l0";

const results = await batched<TaskResult>(operations, 3);
// Processes in batches of 3
```

### race\<TOutput\>()

First successful result wins:

```typescript
import { race } from "@ai2070/l0";

interface FastResponse {
  answer: string;
  confidence: number;
}

const result = await race<FastResponse>([
  { stream: () => streamText({ model: openai("gpt-4o"), prompt }) },
  { stream: () => streamText({ model: anthropic("claude-3-opus"), prompt }) },
  { stream: () => streamText({ model: google("gemini-pro"), prompt }) },
]);

// result is RaceResult<FastResponse>
// result.winnerIndex tells you which model won
console.log(`Model ${result.winnerIndex} won`);
```

### consensus\<TSchema\>()

Multi-model agreement with schema inference:

```typescript
import { consensus } from "@ai2070/l0";
import { z } from "zod";

const schema = z.object({
  answer: z.string(),
  confidence: z.number(),
});

const result = await consensus<typeof schema>({
  streams: [
    () => streamText({ model: openai("gpt-4o"), prompt }),
    () => streamText({ model: anthropic("claude-3-opus"), prompt }),
    () => streamText({ model: google("gemini-pro"), prompt }),
  ],
  schema,
  strategy: "majority",
  threshold: 0.6,
});

// result.consensus is z.infer<typeof schema>
console.log(result.consensus.answer);
console.log(result.confidence);
```

### pipe\<TInput, TOutput\>()

Pipelines with typed input and output:

```typescript
import { pipe } from "@ai2070/l0";

interface DocumentInput {
  text: string;
  language: string;
}

interface AnalysisOutput {
  sentiment: string;
  keywords: string[];
  summary: string;
}

const result = await pipe<DocumentInput, AnalysisOutput>({
  input: { text: "Long document...", language: "en" },
  stages: [
    { name: "extract", stream: (input) => streamText({ model, prompt: `Extract from: ${input.text}` }) },
    { name: "analyze", stream: (prev) => streamText({ model, prompt: `Analyze: ${prev}` }) },
    { name: "summarize", stream: (prev) => streamText({ model, prompt: `Summarize: ${prev}` }) },
  ],
});
```

### Type Inference Table

| Function | Generic | Result Type |
| --- | --- | --- |
| `l0<T>()` | `TOutput` | `L0Result<TOutput>` |
| `parallel<T>()` | `TOutput` | `ParallelResult<TOutput>` |
| `parallelAll<T>()` | `TOutput` | `ParallelResult<TOutput>` |
| `sequential<T>()` | `TOutput` | `ParallelResult<TOutput>` |
| `batched<T>()` | `TOutput` | `ParallelResult<TOutput>` |
| `race<T>()` | `TOutput` | `RaceResult<TOutput>` |
| `consensus<T>()` | `TSchema` | `ConsensusResult<T>` |
| `pipe<I, O>()` | `TInput, TOutput` | `PipeResult<TOutput>` |

### Best Practices

1. **Define interfaces for your outputs** - Create explicit interfaces for structured data:

```typescript
interface ChatResponse {
  message: string;
  tokens: number;
  model: string;
}

const result = await l0<ChatResponse>({ stream });
```

2. **Use Zod inference with structured()** - The `structured()` function already infers types from your schema:

```typescript
const schema = z.object({ name: z.string(), age: z.number() });
const result = await structured({ schema, stream });
// result.data is automatically typed as { name: string; age: number }
```

3. **Combine with const assertions** - For literal types:

```typescript
const result = await l0<{ status: "success" | "error"; code: number }>({
  stream,
});
```

---

## Structured Output

### structured(options)

Guaranteed valid JSON matching a Zod schema.

```typescript
import { structured } from "@ai2070/l0";
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
  retry: { attempts: 3 }
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
import { createWindow } from "@ai2070/l0";

const window = createWindow(longDocument, {
  size: 2000, // Tokens per chunk
  overlap: 200, // Overlap between chunks
  strategy: "paragraph", // "token" | "char" | "paragraph" | "sentence"
});

// Navigation
const current = window.current(); // Current chunk
const next = window.next(); // Move to next
const prev = window.prev(); // Move to previous
window.jump(5); // Jump to chunk 5

// Process all chunks
const results = await window.processAll(
  (chunk) => ({
    stream: () => streamText({ model, prompt: chunk.content }),
  }),
  { concurrency: 3 }, // Parallel processing
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
import { consensus } from "@ai2070/l0";

const result = await consensus({
  streams: [
    () => streamText({ model, prompt }),
    () => streamText({ model, prompt }),
    () => streamText({ model, prompt }),
  ],

  // Optional: Schema for structured consensus
  schema: z.object({ answer: z.string() }),

  // Optional: Strategy
  strategy: "majority", // "majority" | "unanimous" | "weighted" | "best"
  threshold: 0.8,

  // Optional: Conflict resolution
  resolveConflicts: "vote", // "vote" | "merge" | "best" | "fail"

  // Optional: Weights (for "weighted" strategy)
  weights: [1.0, 0.8, 0.6],
});

console.log(result.consensus); // Agreed output
console.log(result.confidence); // 0-1 confidence score
console.log(result.agreements); // Agreement details
console.log(result.disagreements); // Disagreement details
```

### quickConsensus(outputs, threshold?)

Quick check if outputs agree.

```typescript
import { quickConsensus } from "@ai2070/l0";

const hasConsensus = quickConsensus(["A", "A", "B"], 0.6); // true
```

### getConsensusValue(outputs)

Get most common value from outputs.

```typescript
import { getConsensusValue } from "@ai2070/l0";

const value = getConsensusValue(["A", "A", "B"]); // "A"
```

---

## Guardrails

### Built-in Rules

```typescript
import {
  jsonRule, // JSON structure validation
  strictJsonRule, // Strict JSON (complete only)
  markdownRule, // Markdown validation
  latexRule, // LaTeX environment validation
  zeroOutputRule, // Zero/empty output detection
  patternRule, // Known bad patterns
  customPatternRule, // Custom regex patterns
} from "@ai2070/l0";
```

### Presets

```typescript
import {
  minimalGuardrails, // JSON + zero output
  recommendedGuardrails, // + Markdown, drift, patterns
  strictGuardrails, // All rules
  jsonOnlyGuardrails,
  markdownOnlyGuardrails,
  latexOnlyGuardrails,
} from "@ai2070/l0";
```

### Custom Guardrails

```typescript
const customRule: GuardrailRule = {
  name: "min-length",
  streaming: false, // Only check complete output
  severity: "error",
  recoverable: true,
  check: (context) => {
    if (context.completed && context.content.length < 100) {
      return [
        {
          rule: "min-length",
          message: "Output too short",
          severity: "error",
          recoverable: true,
        },
      ];
    }
    return [];
  },
};
```

### GuardrailEngine

```typescript
import { GuardrailEngine } from "@ai2070/l0";

const engine = new GuardrailEngine({
  rules: [jsonRule(), markdownRule()],
  stopOnFatal: true,
  enableStreaming: true,
});

const result = engine.check({
  content: "...",
  completed: true,
  tokenCount: 100,
});
```

---

## Retry Configuration

### Presets

```typescript
import {
  minimalRetry, // { attempts: 1 }
  recommendedRetry, // { attempts: 3, backoff: "fixed-jitter" }
  strictRetry, // { attempts: 3, backoff: "full-jitter" }
} from "@ai2070/l0";
```

### Centralized Defaults

```typescript
import { RETRY_DEFAULTS, ERROR_TYPE_DELAY_DEFAULTS } from "@ai2070/l0";

// RETRY_DEFAULTS
// { attempts: 3, maxRetries: 6, baseDelay: 1000, maxDelay: 10000, backoff: "fixed-jitter", ... }

// ERROR_TYPE_DELAY_DEFAULTS
// { connectionDropped: 1000, fetchError: 500, timeout: 1000, ... }
```

### Custom Configuration

```typescript
const result = await l0({
  stream,
  retry: {
    attempts: 3,
    maxRetries: 6, // Absolute cap (all error types)
    baseDelay: 1000,
    maxDelay: 10000,
    backoff: "fixed-jitter", // "exponential" | "linear" | "fixed" | "full-jitter" | "fixed-jitter"

    // Optional: specify which error types to retry on, defaults to all recoverable errors
    retryOn: [
      "zero_output",
      "guardrail_violation",
      "drift",
      "malformed",
      "incomplete",
      "network_error",
      "timeout",
      "rate_limit",
      "server_error",
    ],

    maxErrorHistory: 100, // Prevent memory leaks
    errorTypeDelays: {
      connectionDropped: 2000,
      timeout: 1500,
      dnsError: 5000,
    },
  },
});
```

### Custom Retry Logic

Override default retry behavior with custom functions:

```typescript
const result = await l0({
  stream,
  retry: {
    attempts: 3,
    // Custom function to control whether to retry
    shouldRetry: (error, context) => {
      // context: { attempt, totalAttempts, category, reason, content, tokenCount }
      
      // Never retry after 5 total attempts
      if (context.totalAttempts >= 5) return false;
      
      // Always retry rate limits
      if (context.reason === "rate_limit") return true;
      
      // Don't retry if we already have significant content
      if (context.tokenCount > 100) return false;
      
      // Return undefined to use default behavior
      return undefined;
    },
    
    // Custom function to calculate retry delay
    calculateDelay: (context) => {
      // context: { attempt, totalAttempts, category, reason, error, defaultDelay }
      
      // Different delays based on error category
      if (context.category === "network") return 500;
      if (context.reason === "rate_limit") return 5000;
      
      // Custom exponential backoff with decorrelated jitter
      const base = 1000;
      const cap = 30000;
      const temp = Math.min(cap, base * Math.pow(2, context.attempt));
      return Math.random() * temp;
    },
  },
});
```

#### shouldRetry Context

| Property        | Type   | Description                          |
| --------------- | ------ | ------------------------------------ |
| `attempt`       | number | Current retry attempt (0-based)      |
| `totalAttempts` | number | Total attempts including network     |
| `category`      | string | Error category (network/model/fatal) |
| `reason`        | string | Error reason code                    |
| `content`       | string | Accumulated content so far           |
| `tokenCount`    | number | Token count so far                   |

#### calculateDelay Context

| Property       | Type   | Description                          |
| -------------- | ------ | ------------------------------------ |
| `attempt`      | number | Current retry attempt (0-based)      |
| `totalAttempts`| number | Total attempts including network     |
| `category`     | string | Error category (network/model/fatal) |
| `reason`       | string | Error reason code                    |
| `error`        | Error  | The error that occurred              |
| `defaultDelay` | number | Default delay that would be used     |

### Error Type Delays

Custom delays for specific network error types. Overrides `baseDelay` for fine-grained control.

```typescript
errorTypeDelays: {
  // Connection errors
  connectionDropped: 2000,  // Connection dropped mid-stream
  econnreset: 1500,         // Connection reset by peer
  econnrefused: 3000,       // Connection refused

  // Fetch/network errors
  fetchError: 500,          // Generic fetch failure
  dnsError: 5000,           // DNS resolution failed
  timeout: 1500,            // Request timeout

  // Streaming errors
  sseAborted: 1000,         // Server-sent events aborted
  noBytes: 500,             // No bytes received
  partialChunks: 1000,      // Incomplete chunks received

  // Runtime errors
  runtimeKilled: 5000,      // Runtime process killed
  backgroundThrottle: 2000, // Background tab throttling

  // Fallback
  unknown: 1000,            // Unknown error type
}
```

### RetryManager

```typescript
import { RetryManager } from "@ai2070/l0";

const manager = new RetryManager({
  attempts: 3,
  backoff: "fixed-jitter",
});

const result = await manager.execute(async () => {
  return await riskyOperation();
});
```

---

## Error Handling

### L0Error

```typescript
import { isL0Error, L0Error } from "@ai2070/l0";

try {
  await l0({ stream, guardrails });
} catch (error) {
  if (isL0Error(error)) {
    console.log(error.code); // L0ErrorCode
    console.log(error.context.checkpoint); // Last good content
    console.log(error.context.tokenCount);
    console.log(error.isRecoverable());
    console.log(error.getCheckpoint());
    console.log(error.toDetailedString());
  }
}
```

### Error Codes

| Code                        | Description            |
| --------------------------- | ---------------------- |
| `STREAM_ABORTED`            | Stream aborted         |
| `INITIAL_TOKEN_TIMEOUT`     | First token timeout    |
| `INTER_TOKEN_TIMEOUT`       | Token gap timeout      |
| `ZERO_OUTPUT`               | No meaningful output   |
| `GUARDRAIL_VIOLATION`       | Guardrail failed       |
| `FATAL_GUARDRAIL_VIOLATION` | Fatal guardrail        |
| `INVALID_STREAM`            | Invalid stream factory |
| `ALL_STREAMS_EXHAUSTED`     | All fallbacks failed   |
| `NETWORK_ERROR`             | Network failure        |
| `DRIFT_DETECTED`            | Output drift           |

### Network Errors

```typescript
import {
  isNetworkError,
  analyzeNetworkError,
  NetworkErrorType,
} from "@ai2070/l0";

if (isNetworkError(error)) {
  const analysis = analyzeNetworkError(error);
  console.log(analysis.type); // NetworkErrorType
  console.log(analysis.retryable); // boolean
  console.log(analysis.suggestion); // string
}
```

### Error Categories

```typescript
import { ErrorCategory, getErrorCategory } from "@ai2070/l0";

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
import { formatContext, formatDocument, formatInstructions } from "@ai2070/l0";

formatContext(content, { role: "user" });
formatDocument(content, { title: "Doc", author: "Me" });
formatInstructions("Generate JSON only");
```

### Memory

```typescript
import { formatMemory, createMemoryEntry } from "@ai2070/l0";

const memory = [
  createMemoryEntry("user", "Hello"),
  createMemoryEntry("assistant", "Hi!"),
];

formatMemory(memory, { maxEntries: 10 });
```

### Output

```typescript
import {
  formatJsonOutput,
  formatStructuredOutput,
  cleanOutput,
} from "@ai2070/l0";

formatJsonOutput({ strict: true });
formatStructuredOutput("json", { schema: "..." });
cleanOutput("Sure! Here's the JSON: {...}"); // "{...}"
```

### Tools

```typescript
import {
  formatTool,
  formatTools,
  createTool,
  createParameter,
} from "@ai2070/l0";

const tool = createTool("search", "Search the web", [
  createParameter("query", "string", "Search query", true),
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
  trimText,
} from "@ai2070/l0";
```

### JSON Repair

```typescript
import {
  repairJson,
  isValidJson,
  parseOrRepairJson,
  extractJson,
  balanceBraces,
  balanceBrackets,
} from "@ai2070/l0";
```

### Token Utilities

```typescript
import {
  isMeaningfulToken,
  hasMeaningfulContent,
  countMeaningfulTokens,
  estimateTokenCount,
  detectRepeatedTokens,
} from "@ai2070/l0";
```

### Timer Utilities

```typescript
import {
  sleep,
  withTimeout,
  exponentialBackoff,
  linearBackoff,
  fullJitterBackoff,
  calculateBackoff,
} from "@ai2070/l0";
```

### Comparison

```typescript
import {
  deepEqual,
  compareStrings,
  levenshteinSimilarity,
  cosineSimilarity,
} from "@ai2070/l0";
```

---

## OpenAI SDK Adapter

L0 provides an adapter for using the OpenAI SDK directly instead of the Vercel AI SDK.

### wrapOpenAIStream(stream, options?)

Wrap an OpenAI SDK stream for use with L0.

```typescript
import OpenAI from "openai";
import { l0, wrapOpenAIStream } from "@ai2070/l0";

const openai = new OpenAI();

const result = await l0({
  stream: async () => {
    const stream = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [{ role: "user", content: "Hello!" }],
      stream: true,
    });
    return wrapOpenAIStream(stream);
  },
});
```

**Options:**

| Option                      | Type      | Default | Description                       |
| --------------------------- | --------- | ------- | --------------------------------- |
| `includeUsage`              | `boolean` | `true`  | Include usage info in done event  |
| `includeToolCalls`          | `boolean` | `true`  | Include tool calls as events      |
| `emitFunctionCallsAsTokens` | `boolean` | `false` | Emit function call args as tokens |

### openaiStream(client, params, options?)

Create a stream factory from OpenAI client and params.

```typescript
import OpenAI from "openai";
import { l0, openaiStream } from "@ai2070/l0";

const openai = new OpenAI();

const result = await l0({
  stream: openaiStream(openai, {
    model: "gpt-4o",
    messages: [{ role: "user", content: "Hello!" }],
  }),
});
```

### openaiText(client, model, prompt, options?)

Simple text generation helper.

```typescript
import OpenAI from "openai";
import { l0, openaiText } from "@ai2070/l0";

const openai = new OpenAI();

const result = await l0({
  stream: openaiText(openai, "gpt-4o", "Write a haiku about coding"),
});

// Or with messages array
const result2 = await l0({
  stream: openaiText(openai, "gpt-4o", [
    { role: "system", content: "You are a poet." },
    { role: "user", content: "Write a haiku." },
  ]),
});
```

### openaiJSON(client, model, prompt, options?)

JSON output with `response_format: { type: "json_object" }`.

```typescript
import OpenAI from "openai";
import { structured, openaiJSON } from "@ai2070/l0";
import { z } from "zod";

const openai = new OpenAI();

const result = await structured({
  schema: z.object({ name: z.string(), age: z.number() }),
  stream: openaiJSON(openai, "gpt-4o", "Generate user data as JSON"),
});
```

### openaiWithTools(client, model, messages, tools, options?)

Tool/function calling support.

```typescript
import OpenAI from "openai";
import { l0, openaiWithTools } from "@ai2070/l0";

const openai = new OpenAI();

const result = await l0({
  stream: openaiWithTools(
    openai,
    "gpt-4o",
    [{ role: "user", content: "What's the weather in Tokyo?" }],
    [
      {
        type: "function",
        function: {
          name: "get_weather",
          description: "Get weather for a location",
          parameters: {
            type: "object",
            properties: { location: { type: "string" } },
            required: ["location"],
          },
        },
      },
    ],
  ),
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
import { isOpenAIChunk, extractOpenAIText } from "@ai2070/l0";

// Type guard for OpenAI chunks
if (isOpenAIChunk(chunk)) {
  // chunk has choices[].delta structure
}

// Extract all text from a stream
const text = await extractOpenAIText(stream);
```

---

## Mastra Adapter

L0 provides an adapter for using Mastra agents directly. Requires `@mastra/core` v0.18+.

### wrapMastraStream(streamResult, options?)

Wrap a Mastra stream result for use with L0.

```typescript
import { Agent } from "@mastra/core/agent";
import { l0, wrapMastraStream } from "@ai2070/l0";

const agent = new Agent({
  name: "my-agent",
  instructions: "You are helpful",
  model: "openai/gpt-4o",
});

const result = await l0({
  stream: async () => {
    const stream = await agent.stream("Hello!");
    return wrapMastraStream(stream);
  },
});
```

**Options:**

| Option             | Type      | Default | Description                      |
| ------------------ | --------- | ------- | -------------------------------- |
| `includeUsage`     | `boolean` | `true`  | Include usage info in done event |
| `includeToolCalls` | `boolean` | `true`  | Include tool calls as events     |
| `includeReasoning` | `boolean` | `false` | Include reasoning content        |

### mastraStream(agent, messages, streamOptions?, adapterOptions?)

Create a stream factory from a Mastra agent.

```typescript
import { Agent } from "@mastra/core/agent";
import { l0, mastraStream } from "@ai2070/l0";

const agent = new Agent({
  name: "my-agent",
  instructions: "You are helpful",
  model: "openai/gpt-4o",
});

const result = await l0({
  stream: mastraStream(agent, "Hello!"),
});

// With messages array
const result2 = await l0({
  stream: mastraStream(agent, [
    { role: "system", content: "You are a poet." },
    { role: "user", content: "Write a haiku." },
  ]),
});
```

### mastraText(agent, prompt, options?)

Simple text generation helper.

```typescript
import { Agent } from "@mastra/core/agent";
import { l0, mastraText } from "@ai2070/l0";

const agent = new Agent({
  name: "writer",
  instructions: "...",
  model: "openai/gpt-4o",
});

const result = await l0({
  stream: mastraText(agent, "Write a haiku about coding"),
});
```

### mastraStructured(agent, prompt, schema, options?)

Structured output with schema validation.

```typescript
import { Agent } from "@mastra/core/agent";
import { structured, mastraStructured } from "@ai2070/l0";
import { z } from "zod";

const agent = new Agent({
  name: "extractor",
  instructions: "...",
  model: "openai/gpt-4o",
});

const schema = z.object({ name: z.string(), age: z.number() });

const result = await structured({
  schema,
  stream: mastraStructured(agent, "Generate user data", schema),
});
```

### wrapMastraFullStream(streamResult, options?)

Wrap Mastra's fullStream for complete control over all chunk types.

```typescript
import { Agent } from "@mastra/core/agent";
import { l0, wrapMastraFullStream } from "@ai2070/l0";

const agent = new Agent({ ... });

const result = await l0({
  stream: async () => {
    const stream = await agent.stream("Hello!");
    return wrapMastraFullStream(stream);
  }
});

// Handles all chunk types: text-delta, tool-call, tool-result, reasoning, finish
```

### Utility Functions

```typescript
import {
  isMastraStream,
  extractMastraText,
  extractMastraObject,
} from "@ai2070/l0";

// Type guard for Mastra streams
if (isMastraStream(stream)) {
  // stream is MastraModelOutput
}

// Extract text from stream result
const text = await extractMastraText(stream);

// Extract structured output
const obj = await extractMastraObject<UserData>(stream);
```

---

## Types

### L0Options

Configuration for the main `l0()` wrapper function.

```typescript
interface L0Options {
  // Required: Stream factory function
  stream: () => Promise<StreamTextResult> | StreamTextResult;

  // Optional fallback streams (tried in order if primary fails)
  fallbackStreams?: Array<() => Promise<StreamTextResult> | StreamTextResult>;

  // Guardrail rules to apply during streaming
  guardrails?: GuardrailRule[];

  // Retry configuration
  retry?: RetryOptions;

  // Timeout configuration (in milliseconds)
  timeout?: {
    initialToken?: number; // Max wait for first token (default: 5000)
    interToken?: number; // Max wait between tokens (default: 10000)
  };

  // Check intervals (in tokens)
  checkIntervals?: {
    guardrails?: number; // Run guardrails every N tokens (default: 5)
    drift?: number; // Run drift detection every N tokens (default: 10)
    checkpoint?: number; // Save checkpoint every N tokens (default: 10)
  };

  // Abort signal for cancellation
  signal?: AbortSignal;

  // Built-in monitoring configuration
  monitoring?: {
    enabled?: boolean; // Enable telemetry collection (default: false)
    sampleRate?: number; // Sample rate 0-1 (default: 1.0)
    includeNetworkDetails?: boolean; // Include detailed network error info
    includeTimings?: boolean; // Include timing metrics
    metadata?: Record<string, any>; // Custom metadata to attach
  };

  // Enable drift detection (default: false)
  detectDrift?: boolean;

  // Enable zero-token detection (default: true)
  detectZeroTokens?: boolean;

  // Continue from checkpoint on retry/fallback (default: false)
  // WARNING: Do not use with structured output/streamObject
  continueFromLastKnownGoodToken?: boolean;

  // Custom function to build continuation prompt (used with continueFromLastKnownGoodToken)
  buildContinuationPrompt?: (checkpoint: string) => string;

  // Interceptors for preprocessing/postprocessing
  interceptors?: L0Interceptor[];

  // Event callbacks
  onEvent?: (event: L0Event) => void;
  onViolation?: (violation: GuardrailViolation) => void;
  onRetry?: (attempt: number, reason: string) => void;
}
```

### L0Result

Result returned from `l0()` execution.

```typescript
interface L0Result {
  // Async iterator for streaming events
  stream: AsyncIterable<L0Event>;

  // Full accumulated text (available after stream completes)
  text?: string;

  // State and metadata from the execution
  state: L0State;

  // Any errors that occurred
  errors: Error[];

  // Telemetry data (if monitoring enabled)
  telemetry?: L0Telemetry;

  // Abort controller for canceling the stream
  abort: () => void;
}
```

### L0State

Internal state tracking for L0 runtime.

```typescript
interface L0State {
  // Current accumulated output
  content: string;

  // Last known good checkpoint
  checkpoint: string;

  // Total tokens received
  tokenCount: number;

  // Retry attempts made (only counts model failures)
  retryAttempts: number;

  // Network retry attempts (doesn't count toward limit)
  networkRetries: number;

  // Index of current fallback stream (0 = primary, 1+ = fallback)
  fallbackIndex: number;

  // Guardrail violations encountered
  violations: GuardrailViolation[];

  // Whether drift was detected
  driftDetected: boolean;

  // Whether stream completed successfully
  completed: boolean;

  // Timestamp of first token
  firstTokenAt?: number;

  // Timestamp of last token
  lastTokenAt?: number;

  // Total duration in milliseconds
  duration?: number;

  // Network errors encountered (categorized)
  networkErrors: CategorizedNetworkError[];

  // Whether continuation from checkpoint was used
  continuedFromCheckpoint: boolean;

  // The checkpoint content used for continuation (if any)
  continuationCheckpoint?: string;
}
```

### L0Event

Unified event format that L0 normalizes all streaming events into.

```typescript
interface L0Event {
  type: "token" | "message" | "error" | "done";
  value?: string;
  role?: string;
  error?: Error;
  timestamp?: number;
}
```

### L0Telemetry

Telemetry data collected during L0 execution.

```typescript
interface L0Telemetry {
  sessionId: string;
  startTime: number;
  endTime?: number;
  duration?: number;

  metrics: {
    timeToFirstToken?: number;
    avgInterTokenTime?: number;
    tokensPerSecond?: number;
    totalTokens: number;
    totalRetries: number;
    networkRetries: number;
    modelRetries: number;
  };

  network: {
    errorCount: number;
    errorsByType: Record<string, number>;
    errors?: Array<{
      type: string;
      message: string;
      timestamp: number;
      retried: boolean;
      delay?: number;
    }>;
  };

  guardrails?: {
    violationCount: number;
    violationsByRule: Record<string, number>;
    violationsByRuleAndSeverity: Record<
      string,
      {
        warning: number;
        error: number;
        fatal: number;
      }
    >;
    violationsBySeverity: {
      warning: number;
      error: number;
      fatal: number;
    };
  };

  drift?: {
    detected: boolean;
    types: string[];
  };

  continuation?: {
    enabled: boolean;
    used: boolean;
    checkpointContent?: string;
    checkpointLength?: number;
    continuationCount?: number;
  };

  metadata?: Record<string, any>;
}
```

### L0Interceptor

Interceptor for preprocessing and postprocessing L0 execution.

```typescript
interface L0Interceptor {
  // Optional name for the interceptor
  name?: string;

  // Before hook - runs before stream starts
  // Can modify options, inject metadata, add authentication, etc.
  before?: (options: L0Options) => L0Options | Promise<L0Options>;

  // After hook - runs after stream completes
  // Can inspect output, post-process content, log results, etc.
  after?: (result: L0Result) => L0Result | Promise<L0Result>;

  // Error hook - runs if an error occurs
  onError?: (error: Error, options: L0Options) => void | Promise<void>;
}
```

### RetryOptions

Retry configuration options.

```typescript
interface RetryOptions {
  // Max retry attempts for model failures (default: 3)
  // Network and transient errors do not count toward this limit
  attempts?: number;

  // Absolute maximum retries across ALL error types (default: 6)
  // Hard cap including network errors, transient errors, and model errors
  maxRetries?: number;

  // Backoff strategy (default: "fixed-jitter")
  backoff?: "exponential" | "linear" | "fixed" | "full-jitter" | "fixed-jitter";

  // Base delay in milliseconds (default: 1000)
  baseDelay?: number;

  // Maximum delay cap in milliseconds (default: 10000)
  maxDelay?: number;

  // What types of errors to retry on
  retryOn?: Array<
    | "zero_output"
    | "guardrail_violation"
    | "drift"
    | "malformed"
    | "incomplete"
    | "network_error"
    | "timeout"
    | "rate_limit"
  >;

  // Custom delays for specific network error types
  errorTypeDelays?: {
    connectionDropped?: number;
    fetchError?: number;
    econnreset?: number;
    econnrefused?: number;
    sseAborted?: number;
    noBytes?: number;
    partialChunks?: number;
    runtimeKilled?: number;
    backgroundThrottle?: number;
    dnsError?: number;
    timeout?: number;
    unknown?: number;
  };

  // Custom function to override default retry behavior
  // Return true to retry, false to stop, undefined to use default logic
  shouldRetry?: (
    error: Error,
    context: {
      attempt: number;
      totalAttempts: number;
      category: ErrorCategory;
      reason: string;
      content: string;
      tokenCount: number;
    },
  ) => boolean | undefined;

  // Custom function to calculate retry delay
  // Return number for custom delay, undefined to use default calculation
  calculateDelay?: (context: {
    attempt: number;
    totalAttempts: number;
    category: ErrorCategory;
    reason: string;
    error: Error;
    defaultDelay: number;
  }) => number | undefined;
}
```

### CategorizedNetworkError

Categorized network error for telemetry.

```typescript
interface CategorizedNetworkError {
  type: string;
  message: string;
  timestamp: number;
  retried: boolean;
  delay?: number;
  attempt?: number;
}
```

### CheckpointValidationResult

Result of checkpoint validation for continuation.

```typescript
interface CheckpointValidationResult {
  // Whether to skip continuation and start fresh
  skipContinuation: boolean;

  // Guardrail violations found in checkpoint
  violations: GuardrailViolation[];

  // Whether drift was detected
  driftDetected: boolean;

  // Drift types if detected
  driftTypes: string[];
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

### GuardrailContext

Context passed to guardrail check functions.

```typescript
interface GuardrailContext {
  content: string; // Current accumulated content
  checkpoint: string; // Last checkpoint content
  delta: string; // New content since last check
  tokenCount: number; // Total tokens received
  completed: boolean; // Whether stream is complete
}
```

### GuardrailViolation

```typescript
interface GuardrailViolation {
  rule: string;
  message: string;
  severity: "warning" | "error" | "fatal";
  recoverable: boolean;
  context?: Record<string, any>;
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

### ErrorCategory

Error classification for retry logic.

```typescript
type ErrorCategory =
  | "network" // Network failures - retry forever with backoff
  | "transient" // 429, 503, timeouts - retry forever with backoff
  | "model" // Model failures - count toward retry limit
  | "fatal"; // Don't retry
```

---

## See Also

- [QUICKSTART.md](./QUICKSTART.md) - Getting started
- [STRUCTURED_OUTPUT.md](./STRUCTURED_OUTPUT.md) - Structured output guide
- [DOCUMENT_WINDOWS.md](./DOCUMENT_WINDOWS.md) - Document processing
- [NETWORK_ERRORS.md](./NETWORK_ERRORS.md) - Network error handling
- [PERFORMANCE.md](./PERFORMANCE.md) - Performance tuning
- [ERROR_HANDLING.md](./ERROR_HANDLING.md) - Error handling guide
