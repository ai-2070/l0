# L0 API Reference

Complete API reference for L0 - A Lightweight Runtime for Reliable LLM Apps.

## Table of Contents

- [Core API](#core-api)
- [Guardrails](#guardrails)
- [Retry Logic](#retry-logic)
- [Format Helpers](#format-helpers)
- [Utility Functions](#utility-functions)
- [Types](#types)

---

## Core API

### `l0(options: L0Options): Promise<L0Result>`

Main L0 wrapper function. Provides streaming runtime with guardrails, drift detection, retry logic, and network protections.

**Parameters:**

- `options.stream: () => Promise<any>` - Function that returns a streamText() result from Vercel AI SDK
- `options.guardrails?: GuardrailRule[]` - Array of guardrail rules to apply
- `options.retry?: RetryOptions` - Retry configuration
- `options.timeout?: { initialToken?: number, interToken?: number }` - Timeout settings (ms)
- `options.signal?: AbortSignal` - Optional abort signal for cancellation
- `options.detectDrift?: boolean` - Enable drift detection (default: false)
- `options.detectZeroTokens?: boolean` - Enable zero-token detection (default: true)
- `options.onEvent?: (event: L0Event) => void` - Callback for each event
- `options.onViolation?: (violation: GuardrailViolation) => void` - Callback for violations
- `options.onRetry?: (attempt: number, reason: string) => void` - Callback for retries

**Returns:** `Promise<L0Result>`

```typescript
const result = await l0({
  stream: () => streamText({ model, prompt }),
  guardrails: recommendedGuardrails,
  retry: { attempts: 2, backoff: "exponential" },
  timeout: { initialToken: 2000, interToken: 5000 }
});

for await (const event of result.stream) {
  if (event.type === "token") {
    console.log(event.value);
  }
}
```

### `getText(result: L0Result): Promise<string>`

Helper to consume stream and get final text.

```typescript
const result = await l0({ stream: ... });
const text = await getText(result);
```

### `consumeStream(result: L0Result, onToken: (token: string) => void): Promise<string>`

Helper to consume stream with callback for each token.

```typescript
const text = await consumeStream(result, (token) => {
  process.stdout.write(token);
});
```

---

## Guardrails

### Built-in Guardrail Rules

#### `jsonRule(): GuardrailRule`

Validates JSON structure, balance, and parseability.

```typescript
import { jsonRule } from "l0";

const result = await l0({
  stream: () => streamText({ ... }),
  guardrails: [jsonRule()]
});
```

#### `strictJsonRule(): GuardrailRule`

Strict JSON validation including structure and parseability. Only checks complete output.

#### `markdownRule(): GuardrailRule`

Validates Markdown fences, blocks, tables, and structure.

#### `latexRule(): GuardrailRule`

Validates LaTeX environment balance and math mode.

#### `patternRule(): GuardrailRule`

Detects known bad patterns (meta commentary, refusal, instruction leakage, etc.).

#### `customPatternRule(patterns: RegExp[], message: string, severity?: "warning" | "error" | "fatal"): GuardrailRule`

Create custom pattern-based guardrail.

```typescript
const customRule = customPatternRule(
  [/forbidden-word/i],
  "Contains forbidden word",
  "error"
);
```

#### `zeroOutputRule(): GuardrailRule`

Detects zero or meaningless output (transport failures).

### Guardrail Presets

#### `minimalGuardrails: GuardrailRule[]`

Minimal preset with only critical checks.

```typescript
import { minimalGuardrails } from "l0";
```

#### `recommendedGuardrails: GuardrailRule[]`

Balanced preset for most use cases.

#### `strictGuardrails: GuardrailRule[]`

Comprehensive checking for production systems.

#### `jsonOnlyGuardrails: GuardrailRule[]`

For JSON output requirements.

#### `markdownOnlyGuardrails: GuardrailRule[]`

For Markdown output requirements.

#### `latexOnlyGuardrails: GuardrailRule[]`

For LaTeX output requirements.

### Custom Guardrails

Create custom guardrails by implementing the `GuardrailRule` interface:

```typescript
const customRule: GuardrailRule = {
  name: "custom-rule",
  description: "Custom validation",
  check: (context: GuardrailContext) => {
    const violations: GuardrailViolation[] = [];
    
    // Your validation logic
    if (context.content.length < 10 && context.isComplete) {
      violations.push({
        rule: "custom-rule",
        message: "Output too short",
        severity: "error",
        recoverable: true
      });
    }
    
    return violations;
  }
};
```

### `GuardrailEngine`

Execute and manage guardrails programmatically.

```typescript
import { GuardrailEngine, jsonRule, markdownRule } from "l0";

const engine = new GuardrailEngine({
  rules: [jsonRule(), markdownRule()],
  stopOnFatal: true
});

const result = engine.check({
  content: "...",
  isComplete: true,
  tokenCount: 100
});

console.log(result.violations);
```

---

## Retry Logic

### Retry Presets

#### `minimalRetry: RetryOptions`

Minimal retry configuration (1 attempt).

```typescript
import { minimalRetry } from "l0";

const result = await l0({
  stream: ...,
  retry: minimalRetry
});
```

#### `recommendedRetry: RetryOptions`

Recommended retry configuration (2 attempts, exponential backoff).

#### `strictRetry: RetryOptions`

Strict retry configuration (3 attempts, full-jitter backoff).

### Custom Retry Configuration

```typescript
const result = await l0({
  stream: ...,
  retry: {
    attempts: 3,
    backoff: "exponential",
    baseDelay: 1000,
    maxDelay: 10000,
    retryOn: ["zero_output", "guardrail_violation", "drift"],
    // Custom delays per error type
    errorTypeDelays: {
      connectionDropped: 2000,     // 2s for connection drops
      fetchError: 500,             // 0.5s for fetch errors
      runtimeKilled: 5000,         // 5s for runtime timeouts
      timeout: 1500                // 1.5s for timeouts
    }
  }
});
```

### `RetryManager`

Manage retry logic programmatically.

```typescript
import { RetryManager } from "l0";

const manager = new RetryManager({
  maxAttempts: 3,
  backoff: "exponential",
  errorTypeDelays: {
    connectionDropped: 1500,
    timeout: 2000
  }
});

const result = await manager.execute(async () => {
  // Your async operation
  return await someOperation();
});
```

### Error Categorization

L0 automatically categorizes errors:

- **Network errors** - Retry forever with backoff, doesn't count
- **Transient errors** (429, 503, timeouts) - Retry forever, doesn't count
- **Model errors** - Count toward retry limit
- **Fatal errors** - Don't retry (auth errors, invalid requests)

### Custom Delay Configuration

Configure different retry delays for each network error type:

```typescript
const result = await l0({
  stream: ...,
  retry: {
    attempts: 3,
    backoff: "exponential",
    errorTypeDelays: {
      connectionDropped: 2000,      // Connection lost
      fetchError: 500,              // fetch() failed
      econnreset: 1500,             // Connection reset
      econnrefused: 3000,           // Connection refused
      sseAborted: 1000,             // SSE aborted
      noBytes: 500,                 // No data received
      partialChunks: 750,           // Incomplete data
      runtimeKilled: 5000,          // Lambda/Edge timeout
      backgroundThrottle: 10000,    // Mobile background
      dnsError: 4000,               // DNS lookup failed
      timeout: 2000,                // Request timeout
      unknown: 1000                 // Unknown error
    }
  }
});
```

All delays are in milliseconds and work with the configured backoff strategy.

📚 See [CUSTOM_DELAYS.md](./CUSTOM_DELAYS.md) for comprehensive guide

---

## Format Helpers

### Context Formatting

#### `formatContext(content: string, options?: FormatContextOptions): string`

Format context content with proper delimiters.

```typescript
import { formatContext } from "l0";

const context = formatContext("Document content here", {
  label: "Documentation",
  delimiter: "xml"
});
// <documentation>
// Document content here
// </documentation>
```

#### `formatDocument(content: string, metadata?: Record<string, string>, options?: FormatContextOptions): string`

Format document with metadata.

```typescript
const doc = formatDocument(content, {
  title: "User Manual",
  author: "John Doe",
  date: "2024-01-01"
});
```

#### `formatInstructions(instructions: string, options?: FormatContextOptions): string`

Format instructions with clear boundaries.

### Memory Formatting

#### `formatMemory(memory: MemoryEntry[], options?: FormatMemoryOptions): string`

Format session memory in a model-friendly way.

```typescript
import { formatMemory } from "l0";

const memory = formatMemory([
  { role: "user", content: "Hello" },
  { role: "assistant", content: "Hi there!" }
], {
  style: "conversational",
  maxEntries: 10
});
```

#### `createMemoryEntry(role: "user" | "assistant" | "system", content: string, metadata?: Record<string, any>): MemoryEntry`

Create a memory entry.

### Output Formatting

#### `formatJsonOutput(options?: FormatJsonOutputOptions): string`

Format instructions for JSON-only output.

```typescript
import { formatJsonOutput } from "l0";

const instruction = formatJsonOutput({
  strict: true,
  schema: "{ name: string, age: number }"
});
```

#### `formatStructuredOutput(format: "json" | "yaml" | "xml" | "markdown" | "plain", options?: {...}): string`

Format instructions for structured output.

#### `cleanOutput(output: string): string`

Clean model output by removing common wrapper text.

```typescript
const cleaned = cleanOutput("Sure! Here is the JSON: {...}");
// {...}
```

### Tool Formatting

#### `formatTool(tool: ToolDefinition, options?: FormatToolOptions): string`

Format tool/function definition.

```typescript
import { formatTool, createTool, createParameter } from "l0";

const tool = createTool(
  "get_weather",
  "Get weather for a location",
  [
    createParameter("location", "string", "Location to get weather for", true),
    createParameter("units", "string", "Temperature units", false)
  ]
);

const formatted = formatTool(tool, { style: "json-schema" });
```

#### `formatTools(tools: ToolDefinition[], options?: FormatToolOptions): string`

Format multiple tools.

---

## Utility Functions

### Text Normalization

#### `normalizeNewlines(text: string): string`

Normalize newlines to \n (Unix-style).

#### `normalizeWhitespace(text: string, options?: {...}): string`

Normalize whitespace.

#### `normalizeForModel(text: string): string`

Normalize text for model consumption.

#### `dedent(text: string): string`

Remove common leading indentation.

#### `indent(text: string, indent: string | number): string`

Add indentation to all lines.

### JSON Repair

#### `repairJson(json: string): string`

Attempt to repair malformed JSON.

```typescript
import { repairJson, isValidJson } from "l0";

const repaired = repairJson('{"name": "Alice", "age": 30');
if (isValidJson(repaired)) {
  console.log("Fixed!");
}
```

#### `balanceBraces(json: string): string`

Balance opening and closing braces.

#### `balanceBrackets(json: string): string`

Balance opening and closing brackets.

#### `parseOrRepairJson(json: string): any`

Try to parse JSON, repair if needed.

#### `extractJson(text: string): string | null`

Extract JSON from text that might contain other content.

### Token Utilities

#### `isMeaningfulToken(token: string): boolean`

Check if token contains meaningful content.

#### `hasMeaningfulContent(content: string): boolean`

Check if content has meaningful tokens.

#### `countMeaningfulTokens(content: string): number`

Count meaningful tokens in content.

#### `detectRepeatedTokens(content: string, threshold?: number): string[]`

Detect repeated tokens.

#### `estimateTokenCount(content: string): number`

Estimate token count using heuristic.

### Timer Utilities

#### `exponentialBackoff(attempt: number, baseDelay?: number, maxDelay?: number): BackoffResult`

Calculate exponential backoff delay.

#### `sleep(ms: number): Promise<void>`

Sleep/delay helper.

#### `withTimeout<T>(promise: Promise<T>, timeoutMs: number, timeoutMessage?: string): Promise<T>`

Race a promise against a timeout.

```typescript
import { withTimeout } from "l0";

const result = await withTimeout(
  fetchData(),
  5000,
  "Fetch timeout"
);
```

### Drift Detection

#### `DriftDetector`

Detect model derailment.

```typescript
import { DriftDetector } from "l0";

const detector = new DriftDetector({
  detectToneShift: true,
  detectMetaCommentary: true,
  detectRepetition: true
});

const result = detector.check(content);
if (result.detected) {
  console.log("Drift types:", result.types);
}
```

---

## Types

### `L0Options`

Configuration options for l0().

### `L0Result`

Result from l0() execution.

```typescript
interface L0Result {
  stream: AsyncIterable<L0Event>;
  state: L0State;
  errors: Error[];
}
```

### `L0Event`

Unified event format.

```typescript
interface L0Event {
  type: "token" | "message" | "error" | "done";
  value?: string;
  role?: string;
  error?: Error;
  timestamp?: number;
}
```

### `L0State`

Runtime state tracking.

```typescript
interface L0State {
  content: string;
  checkpoint: string;
  tokenCount: number;
  retryAttempts: number;
  networkRetries: number;
  violations: GuardrailViolation[];
  driftDetected: boolean;
  completed: boolean;
  firstTokenAt?: number;
  lastTokenAt?: number;
}
```

### `GuardrailRule`

Guardrail rule interface.

```typescript
interface GuardrailRule {
  name: string;
  description?: string;
  check: (context: GuardrailContext) => GuardrailViolation[];
  streaming?: boolean;
  severity?: "warning" | "error" | "fatal";
  recoverable?: boolean;
}
```

### `RetryOptions`

Retry configuration.

```typescript
interface RetryOptions {
  attempts?: number;
  backoff?: "exponential" | "linear" | "fixed" | "full-jitter";
  baseDelay?: number;
  maxDelay?: number;
  retryOn?: RetryReason[];
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
}
```

### `ErrorTypeDelays`

Per-error-type delay configuration (all values in milliseconds).

```typescript
interface ErrorTypeDelays {
  connectionDropped?: number;    // Default: 1000ms
  fetchError?: number;           // Default: 500ms
  econnreset?: number;          // Default: 1000ms
  econnrefused?: number;        // Default: 2000ms
  sseAborted?: number;          // Default: 500ms
  noBytes?: number;             // Default: 500ms
  partialChunks?: number;       // Default: 500ms
  runtimeKilled?: number;       // Default: 2000ms
  backgroundThrottle?: number;  // Default: 5000ms
  dnsError?: number;            // Default: 3000ms
  timeout?: number;             // Default: 1000ms
  unknown?: number;             // Default: 1000ms
}
```

---

## Best Practices

### 1. Use Recommended Presets

Start with recommended presets and customize as needed:

```typescript
const result = await l0({
  stream: () => streamText({ ... }),
  guardrails: recommendedGuardrails,
  retry: recommendedRetry
});
```

### 2. Handle Events Properly

Always handle all event types:

```typescript
for await (const event of result.stream) {
  switch (event.type) {
    case "token":
      // Handle token
      break;
    case "done":
      // Handle completion
      break;
    case "error":
      // Handle error
      break;
  }
}
```

### 3. Monitor Violations

Use callbacks to monitor violations:

```typescript
const result = await l0({
  stream: ...,
  onViolation: (violation) => {
    logger.warn("Guardrail violation", violation);
  }
});
```

### 4. Set Appropriate Timeouts

Configure timeouts based on your use case:

```typescript
const result = await l0({
  stream: ...,
  timeout: {
    initialToken: 2000,  // Short prompt
    interToken: 5000     // Normal streaming
  }
});
```

### 5. Use Format Helpers

Always use format helpers for consistent prompts:

```typescript
const prompt = `
${formatInstructions("Generate a JSON response")}

${formatContext(documentContent, { label: "Document" })}

${formatJsonOutput({ strict: true })}
`;
```

---

## Error Handling

L0 categorizes errors into four types:

1. **Network Errors** - Retry forever with backoff
2. **Transient Errors** - Retry forever with backoff (429, 503, timeouts)
3. **Model Errors** - Count toward retry limit
4. **Fatal Errors** - Don't retry (auth, invalid requests)

```typescript
try {
  const result = await l0({ ... });
  for await (const event of result.stream) {
    // Handle events
  }
} catch (error) {
  // Fatal error or max retries reached
  console.error("L0 error:", error);
}
```

---

## Examples

See the `examples/` directory for complete working examples:

- `basic.ts` - Basic usage
- `json-output.ts` - JSON-only generation
- `monitoring.ts` - With monitoring callbacks
- `custom-guardrails.ts` - Custom guardrail rules
- `drift-detection.ts` - Drift detection
- `timeout-handling.ts` - Timeout configuration

---

## License

MIT