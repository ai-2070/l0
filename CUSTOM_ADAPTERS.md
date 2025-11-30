# Custom Adapters (BYOA - Bring Your Own Adapter)

L0 supports custom adapters for integrating any LLM provider or streaming source. This guide covers everything you need to build production-ready adapters.

## ⚠️ Adapter Scope

L0 provides **official first-party adapters** for:

*   Vercel AI SDK
*   OpenAI SDK
*   Mastra AI

These are the only integrations maintained within the core project.

Support for **additional providers** is **out of scope**.

---

## Table of Contents

- [Overview](#overview)
- [The L0Adapter Interface](#the-l0adapter-interface)
- [Usage Modes](#usage-modes)
- [Building Adapters](#building-adapters)
- [Adapter Invariants](#adapter-invariants)
- [Helper Functions](#helper-functions)
- [Adapter Registry](#adapter-registry)
- [Built-in Adapters](#built-in-adapters)
- [Complete Examples](#complete-examples)
- [Testing Adapters](#testing-adapters)
- [Best Practices](#best-practices)

## Overview

Adapters convert provider-specific streams into L0's unified event format. L0 handles all reliability concerns (retries, timeouts, guardrails), so adapters can focus purely on format conversion.

```
Provider Stream → Adapter → L0Events → L0 Runtime → Reliable Output
```

L0 ships with built-in adapters for:
- **Vercel AI SDK** (native support, no adapter needed)
- **OpenAI SDK** (`openaiAdapter`)
- **Mastra AI** (`mastraAdapter`)

For other providers, create a custom adapter.

## The L0Adapter Interface

```typescript
interface L0Adapter<StreamType = unknown, Options = unknown> {
  /**
   * Unique identifier for this adapter.
   */
  name: string;

  /**
   * Optional type guard for auto-detection.
   * Required ONLY for registerAdapter() auto-detection.
   * Not needed for explicit `adapter: myAdapter` usage.
   */
  detect?(input: unknown): input is StreamType;

  /**
   * Convert provider stream → L0Events.
   */
  wrap(stream: StreamType, options?: Options): AsyncGenerator<L0Event>;
}
```

### L0Event Types

```typescript
type L0Event =
  | { type: "token"; value: string; timestamp: number }
  | { type: "message"; value: string; role?: string; timestamp: number }
  | { type: "done"; timestamp: number; usage?: { input_tokens?: number; output_tokens?: number } }
  | { type: "error"; error: Error; timestamp: number };
```

## Usage Modes

### 1. Explicit Adapter (Recommended)

Pass the adapter directly. No `detect()` needed.

```typescript
import { l0, anthropicAdapter } from "@ai2070/l0";
import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic();

const result = await l0({
  stream: () => anthropic.messages.stream({
    model: "claude-sonnet-4-20250514",
    max_tokens: 1024,
    messages: [{ role: "user", content: "Hello!" }],
  }),
  adapter: anthropicAdapter,
});
```

### 2. Adapter by Name

Reference a registered adapter by name:

```typescript
import { l0, registerAdapter, anthropicAdapter } from "@ai2070/l0";

// Register once at startup
registerAdapter(anthropicAdapter);

// Use by name
const result = await l0({
  stream: () => anthropic.messages.stream({ /* ... */ }),
  adapter: "anthropic",
});
```

### 3. Auto-Detection

Register adapters with `detect()` for automatic stream detection:

```typescript
import { l0, registerAdapter, anthropicAdapter, openaiAdapter } from "@ai2070/l0";

// Register at startup
registerAdapter(anthropicAdapter);
registerAdapter(openaiAdapter);

// L0 auto-detects the adapter
const result = await l0({
  stream: () => anthropic.messages.stream({ /* ... */ }),
  // No adapter specified - auto-detected!
});
```

### Stream Resolution Order

When L0 receives a stream, it resolves the adapter in this order:

1. **Explicit adapter object** - `adapter: myAdapter`
2. **Adapter by name** - `adapter: "myai"` → lookup in registry
3. **Native L0 streams** - Already L0Events, no wrapping needed
4. **Auto-detection** - Call `detect()` on registered adapters

## Building Adapters

### Minimal Adapter

```typescript
import type { L0Adapter, L0Event } from "@ai2070/l0";

interface MyChunk {
  text?: string;
  done?: boolean;
}

type MyStream = AsyncIterable<MyChunk>;

const myAdapter: L0Adapter<MyStream> = {
  name: "myai",

  async *wrap(stream) {
    try {
      for await (const chunk of stream) {
        if (chunk.text) {
          yield {
            type: "token",
            value: chunk.text,
            timestamp: Date.now(),
          };
        }
      }
      yield { type: "done", timestamp: Date.now() };
    } catch (err) {
      yield {
        type: "error",
        error: err instanceof Error ? err : new Error(String(err)),
        timestamp: Date.now(),
      };
    }
  },
};
```

### Adapter with Auto-Detection

Add `detect()` to enable auto-detection:

```typescript
const myAdapter: L0Adapter<MyStream> = {
  name: "myai",

  // Type guard - must be fast, synchronous, no I/O
  detect(input): input is MyStream {
    if (!input || typeof input !== "object") return false;
    if (!(Symbol.asyncIterator in input)) return false;
    // Check for provider-specific markers
    return "__myai_stream" in input;
  },

  async *wrap(stream) {
    // ... same as above
  },
};
```

### Adapter with Options

```typescript
interface MyAdapterOptions {
  includeUsage?: boolean;
  customField?: string;
}

const myAdapter: L0Adapter<MyStream, MyAdapterOptions> = {
  name: "myai",

  async *wrap(stream, options = {}) {
    const { includeUsage = true } = options;

    for await (const chunk of stream) {
      // Use options in processing
    }

    yield {
      type: "done",
      timestamp: Date.now(),
      ...(includeUsage ? { usage: { output_tokens: 100 } } : {}),
    };
  },
};

// Use with options
const result = await l0({
  stream: () => getMyStream(),
  adapter: myAdapter,
  adapterOptions: { includeUsage: false },
});
```

## Adapter Invariants

Adapters MUST follow these rules. L0 depends on them for reliability.

### MUST Do

| Requirement | Description |
|------------|-------------|
| **Preserve text exactly** | Never trim, modify, or transform text content |
| **Include timestamps** | Every event must have `timestamp: Date.now()` |
| **Emit events in order** | Yield events in exact order received from provider |
| **Convert errors to events** | Catch all errors, yield `{ type: "error" }` |
| **Emit done exactly once** | Always yield `{ type: "done" }` at stream end |
| **Be synchronous iteration** | Only async operation is `for await` on the stream |

### MUST NOT Do

| Forbidden | Reason |
|-----------|--------|
| **Modify text** | L0 guardrails need exact text for validation |
| **Buffer chunks** | Breaks streaming, L0 handles batching if needed |
| **Retry internally** | L0 handles all retry logic |
| **Throw exceptions** | Convert to error events instead |
| **Skip chunks** | Unless they contain no text (metadata-only) |
| **Perform I/O** | No HTTP calls, file reads, etc. |

### Example: Correct vs Incorrect

```typescript
// WRONG - modifies text
yield { type: "token", value: chunk.text.trim(), timestamp: Date.now() };

// CORRECT - preserves text exactly
yield { type: "token", value: chunk.text, timestamp: Date.now() };

// WRONG - throws on error
if (chunk.error) throw new Error(chunk.error);

// CORRECT - converts to error event
if (chunk.error) {
  yield { type: "error", error: new Error(chunk.error), timestamp: Date.now() };
  return;
}

// WRONG - missing timestamp
yield { type: "token", value: chunk.text };

// CORRECT - includes timestamp
yield { type: "token", value: chunk.text, timestamp: Date.now() };
```

## Helper Functions

L0 provides helpers to make building correct adapters easier.

### toL0Events

The simplest way to build an adapter:

```typescript
import { toL0Events, type L0Adapter } from "@ai2070/l0";

const myAdapter: L0Adapter<MyStream> = {
  name: "myai",
  wrap(stream) {
    return toL0Events(stream, (chunk) => chunk.text ?? null);
  },
};
```

`toL0Events` handles:
- Timestamp generation
- Error conversion to error events
- Automatic done event emission
- Null/undefined filtering

### toL0EventsWithMessages

For streams with both text and structured messages (tool calls, etc.):

```typescript
import { toL0EventsWithMessages, type L0Adapter } from "@ai2070/l0";

const toolAdapter: L0Adapter<ToolStream> = {
  name: "tool-ai",
  wrap(stream) {
    return toL0EventsWithMessages(stream, {
      extractText: (chunk) =>
        chunk.type === "text" ? chunk.content : null,
      extractMessage: (chunk) => {
        if (chunk.type === "tool_call") {
          return {
            value: JSON.stringify(chunk.tool),
            role: "assistant",
          };
        }
        return null;
      },
    });
  },
};
```

### Event Creation Helpers

For manual adapter implementations:

```typescript
import {
  createAdapterTokenEvent,
  createAdapterDoneEvent,
  createAdapterErrorEvent,
  createAdapterMessageEvent,
} from "@ai2070/l0";

async function* manualAdapter(stream: MyStream): AsyncGenerator<L0Event> {
  try {
    for await (const chunk of stream) {
      if (chunk.text) {
        yield createAdapterTokenEvent(chunk.text);
      }
      if (chunk.toolCall) {
        yield createAdapterMessageEvent(
          JSON.stringify(chunk.toolCall),
          "assistant"
        );
      }
    }
    yield createAdapterDoneEvent();
  } catch (err) {
    yield createAdapterErrorEvent(err);
  }
}
```

## Adapter Registry

### Registering Adapters

```typescript
import { registerAdapter, unregisterAdapter, clearAdapters } from "@ai2070/l0";

// Register for auto-detection
registerAdapter(myAdapter);

// Silence warning for adapters without detect()
registerAdapter(adapterWithoutDetect, { silent: true });

// Unregister by name
unregisterAdapter("myai");

// Clear all (useful in tests)
clearAdapters();
```

### Registry Functions

| Function | Description |
|----------|-------------|
| `registerAdapter(adapter, options?)` | Register for auto-detection |
| `unregisterAdapter(name)` | Remove by name |
| `getAdapter(name)` | Get adapter by name |
| `getRegisteredStreamAdapters()` | List all registered names |
| `clearAdapters()` | Remove all adapters |
| `detectAdapter(input)` | Auto-detect adapter for stream |
| `hasMatchingAdapter(input)` | Check if exactly one adapter matches |

### DX Warning

In development mode, registering an adapter without `detect()` logs a warning:

```
⚠️  Adapter "myai" has no detect() method.
   It will not be used for auto-detection.
   Use explicit `adapter: myAdapter` instead, or add a detect() method.
```

Suppress with `{ silent: true }` or in production (`NODE_ENV=production`).

## Built-in Adapters

### OpenAI Adapter

```typescript
import { l0, openaiAdapter, wrapOpenAIStream } from "@ai2070/l0";
import OpenAI from "openai";

const openai = new OpenAI();

// Option 1: Explicit adapter
const result = await l0({
  stream: () => openai.chat.completions.create({
    model: "gpt-4",
    messages: [{ role: "user", content: "Hello!" }],
    stream: true,
  }),
  adapter: openaiAdapter,
});

// Option 2: Pre-wrap the stream
const result = await l0({
  stream: async () => {
    const stream = await openai.chat.completions.create({
      model: "gpt-4",
      messages: [{ role: "user", content: "Hello!" }],
      stream: true,
    });
    return wrapOpenAIStream(stream);
  },
});
```

### Anthropic Adapter

```typescript
import { l0, anthropicAdapter, wrapAnthropicStream, anthropicStream } from "@ai2070/l0";
import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic();

// Option 1: Explicit adapter
const result = await l0({
  stream: () => anthropic.messages.stream({
    model: "claude-sonnet-4-20250514",
    max_tokens: 1024,
    messages: [{ role: "user", content: "Hello!" }],
  }),
  adapter: anthropicAdapter,
});

// Option 2: Pre-wrap the stream
const result = await l0({
  stream: async () => {
    const stream = anthropic.messages.stream({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1024,
      messages: [{ role: "user", content: "Hello!" }],
    });
    return wrapAnthropicStream(stream);
  },
});

// Option 3: Use helper factory
const result = await l0({
  stream: anthropicStream(anthropic, {
    model: "claude-sonnet-4-20250514",
    max_tokens: 1024,
    messages: [{ role: "user", content: "Hello!" }],
  }),
});
```

### Mastra Adapter

```typescript
import { l0, mastraAdapter } from "@ai2070/l0";
import { Agent } from "@mastra/core";

const agent = new Agent({ /* config */ });

const result = await l0({
  stream: () => agent.stream("Hello!"),
  adapter: mastraAdapter,
});
```

## Complete Examples

### Custom Provider Adapter

```typescript
import type { L0Adapter, L0Event } from "@ai2070/l0";
import { toL0Events } from "@ai2070/l0";

// Define the provider's stream types
interface CustomProviderChunk {
  type: "text" | "metadata" | "end";
  content?: string;
  tokens?: number;
}

type CustomProviderStream = AsyncIterable<CustomProviderChunk> & {
  __customProvider: true;
};

// Build the adapter
export const customProviderAdapter: L0Adapter<CustomProviderStream> = {
  name: "custom-provider",

  // Type guard for auto-detection
  detect(input): input is CustomProviderStream {
    return (
      !!input &&
      typeof input === "object" &&
      Symbol.asyncIterator in input &&
      "__customProvider" in input
    );
  },

  // Stream conversion
  wrap(stream) {
    return toL0Events(stream, (chunk) => {
      if (chunk.type === "text" && chunk.content) {
        return chunk.content;
      }
      return null; // Skip non-text chunks
    });
  },
};
```

### Adapter with Tool Support

```typescript
import type { L0Adapter, L0Event } from "@ai2070/l0";

interface ToolProviderChunk {
  type: "text" | "tool_call" | "tool_result" | "done";
  text?: string;
  tool?: { id: string; name: string; arguments: string };
  result?: { id: string; output: string };
}

type ToolProviderStream = AsyncIterable<ToolProviderChunk>;

export const toolProviderAdapter: L0Adapter<ToolProviderStream> = {
  name: "tool-provider",

  async *wrap(stream) {
    try {
      for await (const chunk of stream) {
        switch (chunk.type) {
          case "text":
            if (chunk.text) {
              yield {
                type: "token",
                value: chunk.text,
                timestamp: Date.now(),
              };
            }
            break;

          case "tool_call":
            if (chunk.tool) {
              yield {
                type: "message",
                value: JSON.stringify({
                  type: "tool_call",
                  ...chunk.tool,
                }),
                role: "assistant",
                timestamp: Date.now(),
              };
            }
            break;

          case "tool_result":
            if (chunk.result) {
              yield {
                type: "message",
                value: JSON.stringify({
                  type: "tool_result",
                  ...chunk.result,
                }),
                role: "tool",
                timestamp: Date.now(),
              };
            }
            break;

          case "done":
            yield { type: "done", timestamp: Date.now() };
            return;
        }
      }

      // Ensure done is emitted
      yield { type: "done", timestamp: Date.now() };
    } catch (err) {
      yield {
        type: "error",
        error: err instanceof Error ? err : new Error(String(err)),
        timestamp: Date.now(),
      };
    }
  },
};
```

### Wrapping a REST API

```typescript
import type { L0Adapter, L0Event } from "@ai2070/l0";

interface SSEMessage {
  data: string;
  event?: string;
}

// Parse SSE stream from fetch response
async function* parseSSE(response: Response): AsyncIterable<SSEMessage> {
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    for (const line of lines) {
      if (line.startsWith("data: ")) {
        yield { data: line.slice(6) };
      }
    }
  }
}

// Adapter wraps the parsed SSE
export const restApiAdapter: L0Adapter<Response> = {
  name: "rest-api",

  async *wrap(response) {
    try {
      for await (const message of parseSSE(response)) {
        if (message.data === "[DONE]") {
          yield { type: "done", timestamp: Date.now() };
          return;
        }

        const parsed = JSON.parse(message.data);
        if (parsed.text) {
          yield {
            type: "token",
            value: parsed.text,
            timestamp: Date.now(),
          };
        }
      }

      yield { type: "done", timestamp: Date.now() };
    } catch (err) {
      yield {
        type: "error",
        error: err instanceof Error ? err : new Error(String(err)),
        timestamp: Date.now(),
      };
    }
  },
};

// Usage
const result = await l0({
  stream: async () => {
    const response = await fetch("https://api.example.com/stream", {
      method: "POST",
      body: JSON.stringify({ prompt: "Hello!" }),
    });
    return response;
  },
  adapter: restApiAdapter,
});
```

## Testing Adapters

### Unit Test Structure

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { myAdapter } from "./my-adapter";
import { registerAdapter, clearAdapters, detectAdapter } from "@ai2070/l0";

// Helper to collect events
async function collectEvents(gen: AsyncGenerator<L0Event>): Promise<L0Event[]> {
  const events: L0Event[] = [];
  for await (const event of gen) {
    events.push(event);
  }
  return events;
}

// Helper to create mock stream
async function* mockStream(chunks: MyChunk[]): AsyncIterable<MyChunk> {
  for (const chunk of chunks) {
    yield chunk;
  }
}

describe("myAdapter", () => {
  beforeEach(() => {
    clearAdapters();
  });

  afterEach(() => {
    clearAdapters();
  });

  it("should preserve exact text content", async () => {
    const stream = mockStream([
      { text: "  Hello  " },
      { text: "\n\nWorld\n\n" },
    ]);

    const events = await collectEvents(myAdapter.wrap(stream));

    expect(events[0]).toMatchObject({ type: "token", value: "  Hello  " });
    expect(events[1]).toMatchObject({ type: "token", value: "\n\nWorld\n\n" });
  });

  it("should include timestamps on all events", async () => {
    const stream = mockStream([{ text: "Hello" }]);
    const events = await collectEvents(myAdapter.wrap(stream));

    for (const event of events) {
      expect(event.timestamp).toBeDefined();
      expect(typeof event.timestamp).toBe("number");
    }
  });

  it("should emit done event exactly once", async () => {
    const stream = mockStream([{ text: "A" }, { text: "B" }]);
    const events = await collectEvents(myAdapter.wrap(stream));

    const doneEvents = events.filter((e) => e.type === "done");
    expect(doneEvents).toHaveLength(1);
  });

  it("should convert errors to error events", async () => {
    async function* errorStream(): AsyncIterable<MyChunk> {
      yield { text: "Hello" };
      throw new Error("Stream failed");
    }

    const events = await collectEvents(myAdapter.wrap(errorStream()));

    expect(events[0]).toMatchObject({ type: "token", value: "Hello" });
    expect(events[1].type).toBe("error");
    expect((events[1] as any).error.message).toBe("Stream failed");
  });

  it("should detect stream correctly", () => {
    const validStream = createMyStream();
    const invalidStream = { notMyStream: true };

    expect(myAdapter.detect?.(validStream)).toBe(true);
    expect(myAdapter.detect?.(invalidStream)).toBe(false);
    expect(myAdapter.detect?.(null)).toBe(false);
    expect(myAdapter.detect?.(undefined)).toBe(false);
  });
});
```

### Key Test Cases

1. **Text preservation** - Exact text including whitespace, newlines, special chars
2. **Timestamps** - Every event has numeric timestamp
3. **Done event** - Emitted exactly once at end
4. **Error handling** - Errors become error events, never thrown
5. **Event ordering** - Events emitted in receive order
6. **Empty streams** - Still emit done event
7. **Detection** - Type guard returns correct boolean

## Best Practices

### DO

- Use `toL0Events` helper when possible
- Test with various chunk shapes from your provider
- Handle all edge cases (empty text, missing fields)
- Keep `detect()` fast and synchronous
- Document provider-specific behavior

### DON'T

- Don't trim or normalize text
- Don't add artificial delays
- Don't buffer chunks for batching
- Don't make HTTP calls in `wrap()`
- Don't assume chunk structure without checking

### Performance Tips

1. **Avoid allocations in hot path** - Reuse objects where possible
2. **Keep detect() O(1)** - Only check object properties
3. **Don't parse JSON unnecessarily** - Pass through raw text
4. **Let L0 handle batching** - Yield events immediately

### Error Messages

Provide helpful error messages:

```typescript
detect(input): input is MyStream {
  if (!input || typeof input !== "object") return false;
  if (!(Symbol.asyncIterator in input)) return false;
  if (!("__myMarker" in input)) return false;
  return true;
}
```

If detection fails, L0 shows:
```
No registered adapter detected for stream.
Detectable adapters: [openai, anthropic, myai].
Use explicit `adapter: myAdapter` or register an adapter with detect().
```

---

## See Also

- [API.md](./API.md) - Complete API reference
- [QUICKSTART.md](./QUICKSTART.md) - Getting started guide
- [NETWORK_ERRORS.md](./NETWORK_ERRORS.md) - Error handling and retries
