# **L0 — A Lightweight Runtime for Reliable LLM Apps**

**Tiny. Predictable. Streaming-first. Zero bloat.**  
L0 adds **guardrails, drift detection, retry logic, formatting helpers, and network protections** on top of the **Vercel AI SDK**, turning raw LLM streams into **reliable, stable, production-grade outputs** without complexity.

- streaming stabilization
- structure-aware guardrails
- **deterministic structured output** (guaranteed valid JSON with schema validation)
- **document windows** (automatic chunking for long documents)
- drift/entropy detection
- safe retry logic
- zero-token detection
- timeouts
- unified events
- memory/state handling
- formatting helpers
- network-failure protection
- stream resume
- retryOnStatus guardrail
- mobile background recovery
- fully testable primitives

No frameworks. No hidden logic. No unnecessary deps.

# 📦 Install

```bash
npm install l0
```

---

# ⭐️ Features Overview

L0 solves the **two biggest problems** in real LLM apps:

1.  **Fragile outputs** (broken JSON, drift, hallucination patterns, premature truncation)
2.  **Unreliable networks** (timeouts, stalls, mobile backgrounding, partial SSE streams)

Everything is opt-in, tiny, and explicit.

---

# 🔁 **1\. Streaming Runtime**

L0 provides a **thin, deterministic streaming wrapper** around `streamText()`.

### Includes:

- token-by-token normalization
- unified event shapes
- state accumulation
- last-known-good checkpoints
- clean async iterator interface
- resumable generation
- cancellation support (`AbortSignal`)

---

# 🧩 **2\. Guardrails (Ultra-Light, Schema-Free)**

Guardrails are:

- pure functions
- ultra-fast
- microstateless
- streaming-safe
- deterministic
- dependency-free

### Built-in rules:

- **JSON structure** (balanced braces, premature close, malformed chunks)
- **Markdown fences** (triple-backtick blocks, tables, list consistency)
- **LaTeX block rules** (`\begin{}` / `\end{}` matching)
- **Zero-token detection**
- **Incomplete output detection**
- **Known-bad-pattern detection** (“As an AI…”, duplicated sentences, filler)
- **Entropy spikes / drift detection**
- **Function call validation** (tool name + args structure)
- **Schema validation** (if using Zod or optional JSON schema)

All rules emit **signals**, never rewrite output.

---

# 🔦 **3\. Drift & Hallucination Detection**

L0 detects early signs of model derailment:

- tone change
- meta commentary
- abrupt formatting resets
- repeated tokens
- excessive hedging (“Sure!”, “Certainly!”)
- markdown -> plaintext collapse
- entropy jumps
- duplicated first/last sentence

These events trigger **soft halts** or **retry attempts**.

---

# 🧪 **4\. Zero-Token Protection**

If the model:

- emits only whitespace
- never produces a meaningful token
- produces only noise
- finishes instantly
- stalls on first chunk

→ This is treated as a **network/transport failure**, not a model failure.

L0 retries automatically **without counting against retry attempts**.

---

# ⏱ **5\. Timeout Handling**

Two levels of timeout:

### **Initial Token Timeout**

If the first token doesn’t arrive in X ms → retry (no penalty).

### **Inter-Token Timeout**

If the stream stalls mid-flow → retry (no penalty).

Both timeouts are:

- explicit
- configurable
- predictable
- fully streaming-aware

---

# 🔄 **6\. Retry Logic (Smart, Bounded, Model-Aware)**

Retries are small, safe, and very predictable.

### **Retries that DO count toward your attempt limit:**

- guardrail violations
- malformed output
- incomplete JSON/Markdown/LaTeX
- drift or semantic anomalies
- repeated formatting errors
- bad arguments for function calls
- model-side errors (recoverable)

### **Retries that do NOT count toward your attempt limit:**

- zero-token output
- network disconnect
- browser tab backgrounding
- SSE abortion
- 429 / rate limit
- 503 / provider overload
- initial token timeout
- inter-token timeout

This prevents infinite loops and preserves UX quality.

Backoff options:

- exponential
- full jitter
- fixed
- capped

---

# 🌐 **7\. Network Failure Protection**

L0 automatically detects and recovers from **all common network failures**:

- ✅ Connection dropped / closed / lost
- ✅ fetch() TypeError / network request failed
- ✅ ECONNRESET / ECONNREFUSED / ECONNABORTED
- ✅ SSE aborted / stream closed
- ✅ No bytes arrived / empty response
- ✅ Partial chunks / incomplete data
- ✅ Node/Edge runtime killed (Lambda/Vercel timeout)
- ✅ Mobile background throttle / tab suspension
- ✅ DNS errors / host not found
- ✅ Timeout errors (initial token / inter-token)

### Features:

- **12 specific error types** detected and handled
- Automatic retry without counting toward limit
- Smart backoff based on error type
- Checkpoint preservation for partial progress
- Detailed error analysis for debugging
- Mobile and edge runtime support

📚 See [NETWORK_ERRORS.md](./NETWORK_ERRORS.md) for complete details

---

# 🔀 **8\. Fall-Through Model Retries**

**Automatic fallback to cheaper models when primary model fails.**

L0 supports automatic model fallback when the primary model exhausts all retry attempts. This is **critical for financial/enterprise apps** where reliability is more important than using a specific model.

### How it works:

```typescript
const result = await l0({
  stream: () => streamText({ 
    model: openai('gpt-4o'), 
    prompt 
  }),
  fallbackStreams: [
    () => streamText({ model: openai('gpt-4o-mini'), prompt }),
    () => streamText({ model: openai('gpt-3.5-turbo'), prompt })
  ],
  retry: recommendedRetry
});
```

### Behavior:

1. **Primary model** (`gpt-4o`) attempts with full retry logic
2. If all retries exhausted → **automatic fallback** to `gpt-4o-mini`
3. If that fails → fallback to `gpt-3.5-turbo`
4. Each fallback gets its own full retry attempts

### Benefits:

- **Reliability over cost** — System stays up even if primary model fails
- **Graceful degradation** — Cheaper models often sufficient for validation passes
- **Zero code changes** — Fallbacks are transparent to consuming code
- **Telemetry tracking** — `state.fallbackIndex` shows which model succeeded
- **Enterprise-grade** — Perfect for financial apps requiring 99.9% uptime

### Use Cases:

- **Validation passes** — GPT-4o fails → use mini for a simpler validation
- **High availability** — Ensure system never goes down due to model issues
- **Cost optimization** — Try expensive model first, fallback to cheap if unavailable
- **Multi-provider** — Fallback to different providers (OpenAI → Anthropic → Google)

---

## Fall-Through vs. Multi-Model Redundancy

L0 supports **two different patterns** for model reliability. They solve different problems:

### Fall-Through Model Retries (Sequential Fallback)

**Pattern:** Try one model at a time, fallback if it fails.

```typescript
const result = await l0({
  stream: () => streamText({ model: openai('gpt-4o'), prompt }),
  fallbackStreams: [
    () => streamText({ model: openai('gpt-4o-mini'), prompt }),
    () => streamText({ model: anthropic('claude'), prompt })
  ]
});

// Execution: GPT-4o → (fails) → GPT-4o-mini → (fails) → Claude
```

**Characteristics:**
- ⏱️ **Higher latency** (sequential execution)
- 💰 **Lower cost** (only pay for 1 model at a time)
- 🎯 **Predictable order** (primary → fallback1 → fallback2)
- 🔄 **Each model gets full retry attempts**

**Best for:**
- Financial/enterprise apps (reliability over speed)
- Batch processing (not latency-sensitive)
- Cost-conscious applications
- Predictable degradation paths

---

### Multi-Model Redundancy (Parallel Race)

**Pattern:** Call all models simultaneously, take fastest response.

```typescript
import { race } from 'l0';

const result = await race([
  () => streamText({ model: openai('gpt-4o'), prompt }),
  () => streamText({ model: anthropic('claude'), prompt }),
  () => streamText({ model: google('gemini'), prompt })
]);

// Execution: All 3 models called at once → fastest wins
```

**Characteristics:**
- ⚡ **Lower latency** (parallel, take fastest)
- 💸 **Higher cost** (pay for all parallel calls)
- 🎲 **Non-deterministic** (fastest wins, not necessarily best)
- ❌ **Wastes tokens** from slower responses

**Best for:**
- Real-time chat (user waiting for response)
- Ultra-low latency requirements
- High-value queries (cost doesn't matter)
- Experimentation (comparing model outputs)

---

### Comparison Table

| Aspect | Fall-Through Retries | Multi-Model Redundancy |
|--------|---------------------|------------------------|
| **Execution** | Sequential (one at a time) | Parallel (all at once) |
| **Cost** | Low (1 model/attempt) | High (N models simultaneously) |
| **Latency** | Higher (sum of attempts) | Lower (fastest response) |
| **Predictability** | High (ordered fallback) | Low (race condition) |
| **Token Waste** | None | High (unused responses) |
| **Use Case** | High availability, budget-conscious | Speed-critical, cost-insensitive |

📚 See [INTERCEPTORS_AND_PARALLEL.md](./INTERCEPTORS_AND_PARALLEL.md) for parallel operations documentation.

---

# 🧱 **9\. Unified Event Format**

Regardless of Vercel event types,  
L0 normalizes events into:

```ts
{
  type: "token" | "message" | "error" | "done",
  value?: string,
  role?: string,
  error?: Error,
}
```

This makes downstream UI much simpler and fully testable.

---

# 🎯 **10\. Deterministic Structured Output**

**Guaranteed valid JSON matching your schema. No hallucinations. No narrations. No weird prefaces.**

The #1 request from production teams: reliable JSON output.

### What You Get:

```typescript
import { structured } from 'l0';
import { z } from 'zod';

const schema = z.object({
  amount: z.number(),
  approved: z.boolean(),
  reason: z.string().optional()
});

const result = await structured({
  schema,
  stream: () => streamText({ model, prompt })
});

// Guaranteed to match schema!
console.log(result.data.amount);   // Type-safe: number
console.log(result.data.approved); // Type-safe: boolean
```

### Features:

- ✅ **Automatic schema validation** with Zod
- ✅ **Auto-correction** of common JSON issues (missing braces, trailing commas, markdown fences)
- ✅ **Retry on validation failure**
- ✅ **Fallback model support**
- ✅ **Type-safe results** with TypeScript inference
- ✅ **Zero crashes** - never fails on malformed JSON

### Auto-Correction:

Automatically fixes:
- Missing closing `}` or `]`
- Trailing commas
- Markdown code fences ` ```json ... ``` `
- Text prefixes ("Here's the JSON:", "Sure!", etc.)
- Unescaped control characters
- Single quotes instead of double quotes

### Example with Fallbacks:

```typescript
const result = await structured({
  schema,
  stream: () => streamText({ model: openai('gpt-4o'), prompt }),
  fallbackStreams: [
    () => streamText({ model: openai('gpt-4o-mini'), prompt })
  ],
  autoCorrect: true,
  retry: { attempts: 2 }
});

console.log('Was corrected:', result.corrected);
console.log('Corrections:', result.corrections);
console.log('Fallback used:', result.state.fallbackIndex > 0);
```

📚 See [STRUCTURED_OUTPUT.md](./STRUCTURED_OUTPUT.md) for complete guide with examples

---

# 📄 **11\. Document Windows**

**Automatic chunking and navigation for long documents.**

When documents exceed model context limits, L0 automatically chunks and processes them:

### Quick Example:

```typescript
import { createWindow } from 'l0';

// Long document (50,000 tokens)
const document = readFileSync('legal-contract.txt', 'utf-8');

// Create window with automatic chunking
const window = createWindow(document, {
  size: 2000,    // 2000 tokens per chunk
  overlap: 200,  // 200 token overlap
  strategy: 'paragraph'
});

console.log(`Split into ${window.totalChunks} chunks`);

// Process all chunks
const results = await window.processAll((chunk) => ({
  stream: () => streamText({
    model: openai('gpt-4o'),
    prompt: `Summarize: ${chunk.content}`
  })
}));

// Merge results
const summary = results
  .map(r => r.result.state.content)
  .join('\n\n');
```

### Features:

- ✅ **Automatic chunking** - Token, character, paragraph, or sentence-based
- ✅ **Smart overlap** - Maintains context between chunks
- ✅ **Navigation** - next(), prev(), jump() through chunks
- ✅ **Batch processing** - Sequential or parallel with concurrency control
- ✅ **Context restoration** - Auto-retry with adjacent chunks on drift

### Chunking Strategies:

```typescript
// Token-based (default)
const window = createWindow(doc, {
  size: 2000,
  strategy: 'token'
});

// Paragraph-based (preserves structure)
const window = createWindow(doc, {
  size: 2000,
  strategy: 'paragraph'
});

// Sentence-based (never splits sentences)
const window = createWindow(doc, {
  size: 1500,
  strategy: 'sentence'
});

// Character-based (exact counts)
const window = createWindow(doc, {
  size: 5000,
  strategy: 'char'
});
```

### Use Cases:

- **Legal documents** - Analyze contracts, terms, policies
- **Transcripts** - Summarize meetings, interviews, podcasts
- **Books** - Extract themes, analyze chapters
- **Code** - Generate documentation for large files
- **Reports** - Process multi-page documents

📚 See [DOCUMENT_WINDOWS.md](./DOCUMENT_WINDOWS.md) for complete guide

---

# 🧮 **12\. Memory, State & Checkpoints**

L0 provides:

- event-sourced accumulation
- last-valid-token checkpoint
- partial structure capture
- state integration for retries

Memory is:

- tiny
- deterministic
- JSON-serializable

Perfect for restoring sessions.

---

# 📝 **13\. Formatting Helpers**

These helpers normalize user prompts and output formats:

### **formatContext()**

Wrap uploaded documents or instructions safely.

### **formatMemory()**

Embed session memory in a clean, model-friendly way.

### **formatTool()**

Provide stable tool-call definitions with valid JSON schema.

### **formatJsonOutput()**

Instruct the model to return only JSON with clear boundaries.

All formatting helpers:

- normalize indentation
- escape delimiters
- prevent prompt injection
- provide a single consistent pattern for users

---

# 🧱 **11\. Output Repair Helpers (Tiny, Optional)**

Pure, lightweight helpers:

- close unbalanced `{}`
- fix incomplete markdown fences
- trim malformed tool-call arguments

These are non-AI, tiny syntactic repairs, not semantic corrections.

---

# 🎯 **14\. Guardrail Presets**

L0 includes presets to simplify configuration.

### **Minimal**

```ts
minimalGuardrails = [jsonRule(), zeroTokenRule()];
```

### **Recommended**

```ts
recommendedGuardrails = [
  jsonRule(),
  markdownRule(),
  zeroTokenRule(),
  driftRule(),
  incompleteRule(),
  patternRule(),
];
```

### **Strict**

```ts
strictGuardrails = [
  ...recommendedGuardrails,
  functionCallRule(),
  outputSchemaRule(),
];
```

---

# 🔁 **15\. Retry Presets**

### **Minimal**

```ts
{
  attempts: 1;
}
```

### **Recommended**

```ts
{
  attempts: 2,
  backoff: "exp",
  retryOn: ["zero_output", "guardrail_violation", "drift"]
}
```

### **Strict**

```ts
{
  attempts: 3,
  backoff: "full-jitter",
  retryOn: ["zero_output", "drift", "malformed", "incomplete"]
}
```

---

# 🧪 **14\. Fully Testable Primitives**

Every component is a pure function.

You can test:

- streams
- guardrails
- retries
- drift detection
- zero-token logic
- formatting helpers

With mocked streams:

```ts
async function* mock() {
  yield { type: "token", value: "{" };
  throw new TypeError("NetworkError");
}
```

This is intentional. L0 is **fully deterministic**.

---

# 🧱 **15\. Zero Dependencies**

L0 is:

- tiny
- tree-shakable
- safe for Node, Bun, Deno
- safe for Edge runtimes
- safe for browsers
- TypeScript-native

Optional: Zod integration for structured outputs.

---

# 🚀 **Example Usage**

```ts
import { l0, recommendedGuardrails, recommendedRetry } from "l0";
import { streamText } from "ai";

const result = await l0({
  stream: () =>
    streamText({
      model: openai("gpt-4o-mini"),
      prompt: "Generate JSON only",
    }),
  guardrails: recommendedGuardrails,
  retry: recommendedRetry,
});

for await (const event of result.stream) {
  console.log(event);
}
```

---

# 🎯 Philosophy

- **No magic**
- **No heavy frameworks**
- **No agent abstraction**
- **Signals, not rewriting**
- **Model-agnostic patterns**
- **Streaming-first always**
- **Works with the developer, not against them**

L0 is the missing reliability layer for modern LLM apps.

---

# 📚 Documentation

- [README.md](./README.md) - Main documentation (this file)
- [API.md](./API.md) - Complete API reference
- [QUICKSTART.md](./QUICKSTART.md) - 5-minute getting started
- [NETWORK_ERRORS.md](./NETWORK_ERRORS.md) - Network error handling guide
- [IMPLEMENTATION.md](./IMPLEMENTATION.md) - Implementation details
- [CONTRIBUTING.md](./CONTRIBUTING.md) - Contribution guidelines

# 🗺 Roadmap

- L0-UI (virtualized chat, markdown-safe rendering, tool call viewer)
- Python L0 with matching primitives
- Display-mode formatting helpers
- More guardrail patterns
- OpenAI/Anthropic adapters (if demand emerges)

---

# 🧱 **Retry Matrix**

| Error Type                                  | Retry? | Count? |
| ------------------------------------------- | ------ | ------ |
| **Network error**                           | YES    | ❌ No  |
| **Zero tokens**                             | YES    | ❌ No  |
| **Timeout before first token**              | YES    | ❌ No  |
| **429 / rate limit**                        | YES    | ❌ No  |
| **503 / overload**                          | YES    | ❌ No  |
| **JSON/Markdown/LaTeX structure violation** | YES    | ✔️ Yes |
| **Drift detected**                          | YES    | ✔️ Yes |
| **Partial/truncated output**                | YES    | ✔️ Yes |
| **Known bad pattern**                       | YES    | ✔️ Yes |
| **Model-side error (recoverable)**          | YES    | ✔️ Yes |
| **Authentication/403**                      | NO     | —      |
| **Invalid request (developer error)**       | NO     | —      |
| **Fatal guardrail violation**               | NO     | —      |

---

# 🟢 **CATEGORY 1 — Do _NOT_ count toward retry attempts (retry forever with backoff)**

These are **external**, **transient**, or **not the model’s fault**.  
Retrying them indefinitely is safe.

### ✅ 1. **Network Errors**

- connection dropped
- fetch() TypeError
- ECONNRESET / ECONNREFUSED
- SSE aborted
- no bytes arrived
- partial chunks
- node/edge runtime kill
- mobile background throttle

These are not the model’s fault — the generation never actually happened.

Retry forever (with exponential backoff + cap).

---

### ✅ 2. **Zero Token Output Before First Meaningful Token**

- only whitespace
- only newlines
- immediate FIN
- empty stream
- zero output due to network

This MUST **NOT** count toward retries — it is a transport failure.

---

### ✅ 3. **Timeout Before First Token**

(e.g., Safari background tab, network stall, provider hiccup)

If we hit:

- **initialTokenTimeout** (e.g., 1500–2000ms)

We retry without counting.

---

### ✅ 4. **429 / Rate Limit**

Sometimes retryable **forever**, because it’s an external throttle.

These need:

- jitter backoff
- cap on delay
- but infinite retry allowed

Do _not_ count toward attempts.

---

### ✅ 5. **503 / Provider Overload**

“Try again” from provider.  
Never count toward model retry attempts.

---

### 🟢 Summary of Non-Counting Cases

These errors **do not increment** the retry counter:

| Case                  | Count? |
| --------------------- | ------ |
| Network disconnect    | ❌ NO  |
| SSE aborted           | ❌ NO  |
| Initial token timeout | ❌ NO  |
| No meaningful tokens  | ❌ NO  |
| 429 rate limit        | ❌ NO  |
| 500/503 transient     | ❌ NO  |

These are safe because _the model didn't produce anything yet._

---

# 🔴 **CATEGORY 2 — Count Toward Retry Attempts (bounded attempts)**

These are **model-caused problems**, meaning retrying eventually won’t help or is potentially expensive.

We MUST count these to avoid runaway loops and billing disasters.

---

### 🔴 1. **Guardrail Violations (Structural Faults)**

If we detect:

- malformed JSON
- incomplete object
- mismatched braces
- broken markdown fences
- invalid tool call arguments
- invalid schema output

**Count this as a retry attempt.**

These are the model’s fault.

---

### 🔴 2. **Drift or Semantically Wrong Output**

If drift detector triggers:

- tone shift
- fallback pattern (“As an AI…”)
- reasoning hallucination
- output merges instruction + result
- meta commentary

This is the model misbehaving → count this attempt.

---

### 🔴 3. **Premature Termination with Partial Structure**

If we detect:

- unclosed JSON
- unclosed LaTeX
- halfway markdown table
- truncated sentences
- incomplete reasoning

This is the model’s doing → count.

---

### 🔴 4. **Repeated Formatting Errors**

If the model produces formatting that ALWAYS breaks, we need to stop after N attempts.

Count these.

---

### 🔴 5. **Explicit Model Errors**

Some providers send:

- “Unable to produce output”
- “Invalid arguments”
- “Token limit exceeded”

These MUST count.

---
