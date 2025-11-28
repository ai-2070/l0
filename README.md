# **L0 — A Lightweight Runtime for Reliable LLM Apps**

**Tiny. Predictable. Streaming-first. Zero bloat.**  
L0 adds **guardrails, drift detection, retry logic, formatting helpers, and network protections** on top of the **Vercel AI SDK**, turning raw LLM streams into **reliable, stable, production-grade outputs** without complexity.

- streaming stabilization
- structure-aware guardrails
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

# 🧱 **8\. Unified Event Format**

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

# 🧮 **9\. Memory, State & Checkpoints**

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

# 📝 **10\. Formatting Helpers**

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

# 🔧 **12\. Guardrail Presets**

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

# 🔁 **13\. Retry Presets**

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
