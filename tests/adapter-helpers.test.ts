// Unit tests for adapter helpers
// Tests for toL0Events, toL0EventsWithMessages, and event creation functions

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  toL0Events,
  toL0EventsWithMessages,
  createAdapterTokenEvent,
  createAdapterDoneEvent,
  createAdapterErrorEvent,
  createAdapterMessageEvent,
} from "../src/adapters/helpers";
import type { L0Event } from "../src/types/l0";

// Helper to create an async iterable from an array
async function* arrayToAsyncIterable<T>(items: T[]): AsyncIterable<T> {
  for (const item of items) {
    yield item;
  }
}

// Helper to create an async iterable that throws
async function* throwingAsyncIterable<T>(
  items: T[],
  errorAfter: number,
): AsyncIterable<T> {
  let count = 0;
  for (const item of items) {
    if (count >= errorAfter) {
      throw new Error("Stream error");
    }
    yield item;
    count++;
  }
}

// Helper to collect all events from an async generator
async function collectEvents(gen: AsyncGenerator<L0Event>): Promise<L0Event[]> {
  const events: L0Event[] = [];
  for await (const event of gen) {
    events.push(event);
  }
  return events;
}

describe("toL0Events", () => {
  let originalDateNow: () => number;

  beforeEach(() => {
    originalDateNow = Date.now;
    let mockTime = 1000;
    vi.spyOn(Date, "now").mockImplementation(() => mockTime++);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("basic text extraction", () => {
    it("should convert simple text chunks to token events", async () => {
      const chunks = [{ text: "Hello" }, { text: " " }, { text: "World" }];
      const stream = arrayToAsyncIterable(chunks);

      const events = await collectEvents(
        toL0Events(stream, (chunk) => chunk.text),
      );

      expect(events).toHaveLength(4); // 3 tokens + 1 done
      expect(events[0]).toMatchObject({ type: "token", value: "Hello" });
      expect(events[1]).toMatchObject({ type: "token", value: " " });
      expect(events[2]).toMatchObject({ type: "token", value: "World" });
      expect(events[3]).toMatchObject({ type: "done" });
    });

    it("should preserve exact text content without modification", async () => {
      const chunks = [
        { text: "  leading spaces" },
        { text: "trailing spaces  " },
        { text: "\n\nnewlines\n\n" },
        { text: "special chars: <>&\"'" },
      ];
      const stream = arrayToAsyncIterable(chunks);

      const events = await collectEvents(
        toL0Events(stream, (chunk) => chunk.text),
      );

      expect(events[0]).toMatchObject({
        type: "token",
        value: "  leading spaces",
      });
      expect(events[1]).toMatchObject({
        type: "token",
        value: "trailing spaces  ",
      });
      expect(events[2]).toMatchObject({
        type: "token",
        value: "\n\nnewlines\n\n",
      });
      expect(events[3]).toMatchObject({
        type: "token",
        value: "special chars: <>&\"'",
      });
    });

    it("should handle empty string tokens", async () => {
      const chunks = [{ text: "" }, { text: "hello" }, { text: "" }];
      const stream = arrayToAsyncIterable(chunks);

      const events = await collectEvents(
        toL0Events(stream, (chunk) => chunk.text),
      );

      // Empty strings are NOT null/undefined, so they should be emitted
      expect(events).toHaveLength(4); // 3 tokens + 1 done
      expect(events[0]).toMatchObject({ type: "token", value: "" });
      expect(events[1]).toMatchObject({ type: "token", value: "hello" });
      expect(events[2]).toMatchObject({ type: "token", value: "" });
    });
  });

  describe("null/undefined filtering", () => {
    it("should skip chunks where extractText returns null", async () => {
      const chunks = [
        { type: "text", content: "Hello" },
        { type: "metadata", content: null },
        { type: "text", content: "World" },
      ];
      const stream = arrayToAsyncIterable(chunks);

      const events = await collectEvents(
        toL0Events(stream, (chunk) =>
          chunk.type === "text" ? chunk.content : null,
        ),
      );

      expect(events).toHaveLength(3); // 2 tokens + 1 done
      expect(events[0]).toMatchObject({ type: "token", value: "Hello" });
      expect(events[1]).toMatchObject({ type: "token", value: "World" });
      expect(events[2]).toMatchObject({ type: "done" });
    });

    it("should skip chunks where extractText returns undefined", async () => {
      const chunks = [{ text: "A" }, { noText: true }, { text: "B" }];
      const stream = arrayToAsyncIterable(chunks);

      const events = await collectEvents(
        toL0Events(stream, (chunk) => (chunk as { text?: string }).text),
      );

      expect(events).toHaveLength(3); // 2 tokens + 1 done
      expect(events[0]).toMatchObject({ type: "token", value: "A" });
      expect(events[1]).toMatchObject({ type: "token", value: "B" });
    });
  });

  describe("timestamps", () => {
    it("should include timestamps on all events", async () => {
      const chunks = [{ text: "Hello" }];
      const stream = arrayToAsyncIterable(chunks);

      const events = await collectEvents(
        toL0Events(stream, (chunk) => chunk.text),
      );

      expect(events[0]?.timestamp).toBeDefined();
      expect(events[1]?.timestamp).toBeDefined();
      expect(typeof events[0]?.timestamp).toBe("number");
      expect(typeof events[1]?.timestamp).toBe("number");
    });

    it("should have monotonically increasing timestamps", async () => {
      const chunks = [{ text: "A" }, { text: "B" }, { text: "C" }];
      const stream = arrayToAsyncIterable(chunks);

      const events = await collectEvents(
        toL0Events(stream, (chunk) => chunk.text),
      );

      for (let i = 1; i < events.length; i++) {
        const current = events[i]!.timestamp!;
        const previous = events[i - 1]!.timestamp!;
        expect(current).toBeGreaterThan(previous);
      }
    });
  });

  describe("done event", () => {
    it("should always emit done event at the end of successful stream", async () => {
      const chunks = [{ text: "Hello" }];
      const stream = arrayToAsyncIterable(chunks);

      const events = await collectEvents(
        toL0Events(stream, (chunk) => chunk.text),
      );

      const lastEvent = events[events.length - 1];
      expect(lastEvent).toMatchObject({ type: "done" });
    });

    it("should emit done event even for empty streams", async () => {
      const chunks: { text: string }[] = [];
      const stream = arrayToAsyncIterable(chunks);

      const events = await collectEvents(
        toL0Events(stream, (chunk) => chunk.text),
      );

      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({ type: "done" });
    });

    it("should emit done event when all chunks are filtered out", async () => {
      const chunks = [{ skip: true }, { skip: true }];
      const stream = arrayToAsyncIterable(chunks);

      const events = await collectEvents(toL0Events(stream, () => null));

      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({ type: "done" });
    });
  });

  describe("error handling", () => {
    it("should convert stream errors to error events", async () => {
      const stream = throwingAsyncIterable([{ text: "A" }, { text: "B" }], 1);

      const events = await collectEvents(
        toL0Events(stream, (chunk) => chunk.text),
      );

      expect(events).toHaveLength(2); // 1 token + 1 error
      expect(events[0]).toMatchObject({ type: "token", value: "A" });
      expect(events[1]?.type).toBe("error");
      expect((events[1] as { error: Error }).error).toBeInstanceOf(Error);
      expect((events[1] as { error: Error }).error.message).toBe(
        "Stream error",
      );
    });

    it("should convert non-Error throws to Error objects", async () => {
      async function* stringErrorStream(): AsyncIterable<{ text: string }> {
        yield { text: "A" };
        throw "string error";
      }

      const events = await collectEvents(
        toL0Events(stringErrorStream(), (chunk) => chunk.text),
      );

      expect(events[1]?.type).toBe("error");
      expect((events[1] as { error: Error }).error).toBeInstanceOf(Error);
      expect((events[1] as { error: Error }).error.message).toBe(
        "string error",
      );
    });

    it("should include timestamp on error events", async () => {
      const stream = throwingAsyncIterable([{ text: "A" }], 0);

      const events = await collectEvents(
        toL0Events(stream, (chunk) => chunk.text),
      );

      expect(events[0]?.type).toBe("error");
      expect(events[0]?.timestamp).toBeDefined();
      expect(typeof events[0]?.timestamp).toBe("number");
    });

    it("should not emit done event after error", async () => {
      // Need at least 2 items so the error can trigger on the second
      const stream = throwingAsyncIterable([{ text: "A" }, { text: "B" }], 1);

      const events = await collectEvents(
        toL0Events(stream, (chunk) => chunk.text),
      );

      // Should have: 1 token (A), then error when trying to yield B
      expect(events.filter((e) => e.type === "token")).toHaveLength(1);
      expect(events.filter((e) => e.type === "done")).toHaveLength(0);
      expect(events.filter((e) => e.type === "error")).toHaveLength(1);
    });
  });

  describe("complex extraction functions", () => {
    it("should handle nested property extraction", async () => {
      const chunks = [
        { delta: { content: { text: "A" } } },
        { delta: { content: { text: "B" } } },
      ];
      const stream = arrayToAsyncIterable(chunks);

      const events = await collectEvents(
        toL0Events(stream, (chunk) => chunk.delta.content.text),
      );

      expect(events[0]).toMatchObject({ type: "token", value: "A" });
      expect(events[1]).toMatchObject({ type: "token", value: "B" });
    });

    it("should handle conditional extraction based on chunk type", async () => {
      const chunks = [
        { type: "content_block_delta", delta: { text: "Hello" } },
        { type: "message_delta", usage: { tokens: 5 } },
        { type: "content_block_delta", delta: { text: " World" } },
      ];
      const stream = arrayToAsyncIterable(chunks);

      const events = await collectEvents(
        toL0Events(stream, (chunk) => {
          if (chunk.type === "content_block_delta") {
            return (chunk.delta as { text: string }).text;
          }
          return null;
        }),
      );

      expect(events).toHaveLength(3); // 2 tokens + 1 done
      expect(events[0]).toMatchObject({ type: "token", value: "Hello" });
      expect(events[1]).toMatchObject({ type: "token", value: " World" });
    });
  });
});

describe("toL0EventsWithMessages", () => {
  let originalDateNow: () => number;

  beforeEach(() => {
    originalDateNow = Date.now;
    let mockTime = 1000;
    vi.spyOn(Date, "now").mockImplementation(() => mockTime++);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("text extraction", () => {
    it("should extract text when extractMessage is not provided", async () => {
      const chunks = [{ text: "Hello" }, { text: " World" }];
      const stream = arrayToAsyncIterable(chunks);

      const events = await collectEvents(
        toL0EventsWithMessages(stream, {
          extractText: (chunk) => chunk.text,
        }),
      );

      expect(events).toHaveLength(3); // 2 tokens + 1 done
      expect(events[0]).toMatchObject({ type: "token", value: "Hello" });
      expect(events[1]).toMatchObject({ type: "token", value: " World" });
    });
  });

  describe("message extraction", () => {
    it("should extract messages when text returns null", async () => {
      const chunks = [
        { type: "text", content: "Hello" },
        { type: "tool_call", tool: { name: "search", args: "{}" } },
      ];
      const stream = arrayToAsyncIterable(chunks);

      const events = await collectEvents(
        toL0EventsWithMessages(stream, {
          extractText: (chunk) =>
            chunk.type === "text" ? chunk.content : null,
          extractMessage: (chunk) => {
            if (chunk.type === "tool_call") {
              return { value: JSON.stringify(chunk.tool), role: "assistant" };
            }
            return null;
          },
        }),
      );

      expect(events).toHaveLength(3); // 1 token + 1 message + 1 done
      expect(events[0]).toMatchObject({ type: "token", value: "Hello" });
      expect(events[1]).toMatchObject({
        type: "message",
        value: '{"name":"search","args":"{}"}',
        role: "assistant",
      });
    });

    it("should prioritize text over message (text wins)", async () => {
      const chunks = [{ hasText: true, text: "Hello", message: "ignored" }];
      const stream = arrayToAsyncIterable(chunks);

      const events = await collectEvents(
        toL0EventsWithMessages(stream, {
          extractText: (chunk) => (chunk.hasText ? chunk.text : null),
          extractMessage: (chunk) => ({ value: chunk.message, role: "test" }),
        }),
      );

      // Text is extracted, so message handler is skipped (continue statement)
      expect(events).toHaveLength(2); // 1 token + 1 done
      expect(events[0]).toMatchObject({ type: "token", value: "Hello" });
    });

    it("should handle message without role", async () => {
      const chunks = [{ type: "msg", content: "test" }];
      const stream = arrayToAsyncIterable(chunks);

      const events = await collectEvents(
        toL0EventsWithMessages(stream, {
          extractText: () => null,
          extractMessage: (chunk) => ({ value: chunk.content }),
        }),
      );

      expect(events[0]).toMatchObject({ type: "message", value: "test" });
      expect((events[0] as { role?: string }).role).toBeUndefined();
    });
  });

  describe("mixed content", () => {
    it("should handle interleaved text and messages", async () => {
      type MixedChunk =
        | { type: "text"; content: string }
        | { type: "tool"; tool: { name: string; query: string } }
        | { type: "tool_result"; result: string };

      const chunks: MixedChunk[] = [
        { type: "text", content: "Let me " },
        { type: "text", content: "search for " },
        { type: "tool", tool: { name: "search", query: "test" } },
        { type: "text", content: "I found " },
        { type: "tool_result", result: "success" },
      ];
      const stream = arrayToAsyncIterable(chunks);

      const events = await collectEvents(
        toL0EventsWithMessages(stream, {
          extractText: (chunk) =>
            chunk.type === "text" ? chunk.content : null,
          extractMessage: (chunk) => {
            if (chunk.type === "tool") {
              return { value: JSON.stringify(chunk.tool), role: "assistant" };
            }
            if (chunk.type === "tool_result") {
              return { value: chunk.result, role: "tool" };
            }
            return null;
          },
        }),
      );

      expect(events).toHaveLength(6); // 3 tokens + 2 messages + 1 done
      expect(events[0]).toMatchObject({ type: "token", value: "Let me " });
      expect(events[1]).toMatchObject({ type: "token", value: "search for " });
      expect(events[2]).toMatchObject({ type: "message", role: "assistant" });
      expect(events[3]).toMatchObject({ type: "token", value: "I found " });
      expect(events[4]).toMatchObject({
        type: "message",
        role: "tool",
        value: "success",
      });
    });
  });

  describe("error handling", () => {
    it("should convert errors to error events", async () => {
      async function* errorStream(): AsyncIterable<{ text: string }> {
        yield { text: "A" };
        throw new Error("Connection lost");
      }

      const events = await collectEvents(
        toL0EventsWithMessages(errorStream(), {
          extractText: (chunk) => chunk.text,
        }),
      );

      expect(events).toHaveLength(2); // 1 token + 1 error
      expect(events[1]?.type).toBe("error");
      expect((events[1] as { error: Error }).error.message).toBe(
        "Connection lost",
      );
    });
  });

  describe("timestamps", () => {
    it("should include timestamps on all event types", async () => {
      type TimestampChunk =
        | { type: "text"; content: string }
        | { type: "msg"; data: string };

      const chunks: TimestampChunk[] = [
        { type: "text", content: "Hello" },
        { type: "msg", data: "test" },
      ];
      const stream = arrayToAsyncIterable(chunks);

      const events = await collectEvents(
        toL0EventsWithMessages(stream, {
          extractText: (chunk) =>
            chunk.type === "text" ? chunk.content : null,
          extractMessage: (chunk) =>
            chunk.type === "msg" ? { value: chunk.data } : null,
        }),
      );

      expect(events[0]?.timestamp).toBeDefined(); // token
      expect(events[1]?.timestamp).toBeDefined(); // message
      expect(events[2]?.timestamp).toBeDefined(); // done
    });
  });
});

describe("createAdapterTokenEvent", () => {
  beforeEach(() => {
    vi.spyOn(Date, "now").mockReturnValue(12345);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should create a token event with correct structure", () => {
    const event = createAdapterTokenEvent("Hello");

    expect(event).toEqual({
      type: "token",
      value: "Hello",
      timestamp: 12345,
    });
  });

  it("should preserve exact text value", () => {
    const event = createAdapterTokenEvent("  \n  spaces  \n  ");

    expect(event.type).toBe("token");
    expect((event as { value: string }).value).toBe("  \n  spaces  \n  ");
  });

  it("should handle empty string", () => {
    const event = createAdapterTokenEvent("");

    expect(event.type).toBe("token");
    expect((event as { value: string }).value).toBe("");
  });

  it("should include timestamp", () => {
    const event = createAdapterTokenEvent("test");

    expect(event.timestamp).toBe(12345);
  });
});

describe("createAdapterDoneEvent", () => {
  beforeEach(() => {
    vi.spyOn(Date, "now").mockReturnValue(99999);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should create a done event with correct structure", () => {
    const event = createAdapterDoneEvent();

    expect(event).toEqual({
      type: "done",
      timestamp: 99999,
    });
  });

  it("should include timestamp", () => {
    const event = createAdapterDoneEvent();

    expect(event.timestamp).toBe(99999);
  });
});

describe("createAdapterErrorEvent", () => {
  beforeEach(() => {
    vi.spyOn(Date, "now").mockReturnValue(55555);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should create an error event from Error object", () => {
    const error = new Error("Test error");
    const event = createAdapterErrorEvent(error);

    expect(event).toEqual({
      type: "error",
      error: error,
      timestamp: 55555,
    });
  });

  it("should wrap string errors in Error object", () => {
    const event = createAdapterErrorEvent("String error");

    expect(event.type).toBe("error");
    expect((event as { error: Error }).error).toBeInstanceOf(Error);
    expect((event as { error: Error }).error.message).toBe("String error");
  });

  it("should wrap number errors in Error object", () => {
    const event = createAdapterErrorEvent(404);

    expect(event.type).toBe("error");
    expect((event as { error: Error }).error).toBeInstanceOf(Error);
    expect((event as { error: Error }).error.message).toBe("404");
  });

  it("should wrap object errors in Error object", () => {
    const event = createAdapterErrorEvent({ code: "ERR", msg: "fail" });

    expect(event.type).toBe("error");
    expect((event as { error: Error }).error).toBeInstanceOf(Error);
    expect((event as { error: Error }).error.message).toBe("[object Object]");
  });

  it("should wrap null/undefined errors in Error object", () => {
    const nullEvent = createAdapterErrorEvent(null);
    const undefinedEvent = createAdapterErrorEvent(undefined);

    expect((nullEvent as { error: Error }).error.message).toBe("null");
    expect((undefinedEvent as { error: Error }).error.message).toBe(
      "undefined",
    );
  });

  it("should preserve Error subclass instances", () => {
    class CustomError extends Error {
      code = "CUSTOM";
    }
    const error = new CustomError("Custom error");
    const event = createAdapterErrorEvent(error);

    expect((event as { error: Error }).error).toBeInstanceOf(CustomError);
    expect(((event as { error: Error }).error as CustomError).code).toBe(
      "CUSTOM",
    );
  });

  it("should include timestamp", () => {
    const event = createAdapterErrorEvent(new Error("test"));

    expect(event.timestamp).toBe(55555);
  });
});

describe("createAdapterMessageEvent", () => {
  beforeEach(() => {
    vi.spyOn(Date, "now").mockReturnValue(77777);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should create a message event with value and role", () => {
    const event = createAdapterMessageEvent('{"tool":"search"}', "assistant");

    expect(event).toEqual({
      type: "message",
      value: '{"tool":"search"}',
      role: "assistant",
      timestamp: 77777,
    });
  });

  it("should create a message event without role", () => {
    const event = createAdapterMessageEvent("test message");

    expect(event).toEqual({
      type: "message",
      value: "test message",
      role: undefined,
      timestamp: 77777,
    });
  });

  it("should handle empty value", () => {
    const event = createAdapterMessageEvent("", "system");

    expect(event.type).toBe("message");
    expect((event as { value: string }).value).toBe("");
    expect((event as { role: string }).role).toBe("system");
  });

  it("should include timestamp", () => {
    const event = createAdapterMessageEvent("test");

    expect(event.timestamp).toBe(77777);
  });
});

describe("edge cases", () => {
  beforeEach(() => {
    let mockTime = 1000;
    vi.spyOn(Date, "now").mockImplementation(() => mockTime++);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should handle Unicode and emoji text correctly", async () => {
    const chunks = [
      { text: "Hello " },
      { text: "World" },
      { text: " " },
      { text: "" },
    ];
    const stream = arrayToAsyncIterable(chunks);

    const events = await collectEvents(
      toL0Events(stream, (chunk) => chunk.text),
    );

    expect(events[0]).toMatchObject({ type: "token", value: "Hello " });
    expect(events[1]).toMatchObject({ type: "token", value: "World" });
    expect(events[2]).toMatchObject({ type: "token", value: " " });
    expect(events[3]).toMatchObject({ type: "token", value: "" });
  });

  it("should handle very large strings", async () => {
    const largeString = "x".repeat(100000);
    const chunks = [{ text: largeString }];
    const stream = arrayToAsyncIterable(chunks);

    const events = await collectEvents(
      toL0Events(stream, (chunk) => chunk.text),
    );

    expect(events[0]).toMatchObject({ type: "token", value: largeString });
    expect((events[0] as any).value.length).toBe(100000);
  });

  it("should handle extractor function that throws", async () => {
    const chunks = [{ text: "A" }, { text: "B" }, { text: "C" }];
    const stream = arrayToAsyncIterable(chunks);
    let callCount = 0;

    const events = await collectEvents(
      toL0Events(stream, (chunk) => {
        callCount++;
        if (callCount === 2) {
          throw new Error("Extractor error");
        }
        return chunk.text;
      }),
    );

    // First token succeeds, then error on second extractor call
    expect(events[0]).toMatchObject({ type: "token", value: "A" });
    expect(events[1]?.type).toBe("error");
    expect((events[1] as any).error.message).toBe("Extractor error");
  });

  it("should handle rapid successive chunks", async () => {
    const chunks = Array.from({ length: 100 }, (_, i) => ({ text: `${i}` }));
    const stream = arrayToAsyncIterable(chunks);

    const events = await collectEvents(
      toL0Events(stream, (chunk) => chunk.text),
    );

    const tokens = events.filter((e) => e.type === "token");
    expect(tokens).toHaveLength(100);
    expect(tokens[0]).toMatchObject({ value: "0" });
    expect(tokens[99]).toMatchObject({ value: "99" });
  });
});

describe("adapter helper integration patterns", () => {
  beforeEach(() => {
    let mockTime = 1000;
    vi.spyOn(Date, "now").mockImplementation(() => mockTime++);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should work with typical adapter pattern", async () => {
    // Simulating a typical adapter implementation
    interface MockChunk {
      type: string;
      text?: string;
    }

    const mockAdapter = {
      name: "mock",
      wrap(stream: AsyncIterable<MockChunk>) {
        return toL0Events(stream, (chunk) => chunk.text ?? null);
      },
    };

    const chunks: MockChunk[] = [
      { type: "start" },
      { type: "delta", text: "Hello" },
      { type: "delta", text: " World" },
      { type: "end" },
    ];

    const events = await collectEvents(
      mockAdapter.wrap(arrayToAsyncIterable(chunks)),
    );

    expect(events.filter((e) => e.type === "token")).toHaveLength(2);
    expect(events.filter((e) => e.type === "done")).toHaveLength(1);
  });

  it("should work with event creation helpers for manual adapter", async () => {
    // Simulating a manual adapter that uses individual helpers
    async function* manualAdapter(
      stream: AsyncIterable<{ text?: string; error?: string }>,
    ): AsyncGenerator<L0Event> {
      try {
        for await (const chunk of stream) {
          if (chunk.error) {
            yield createAdapterErrorEvent(new Error(chunk.error));
            return;
          }
          if (chunk.text) {
            yield createAdapterTokenEvent(chunk.text);
          }
        }
        yield createAdapterDoneEvent();
      } catch (err) {
        yield createAdapterErrorEvent(err);
      }
    }

    const chunks = [{ text: "A" }, { text: "B" }, { error: "fail" }];
    const events = await collectEvents(
      manualAdapter(arrayToAsyncIterable(chunks)),
    );

    expect(events).toHaveLength(3); // 2 tokens + 1 error
    expect(events[0]).toMatchObject({ type: "token", value: "A" });
    expect(events[1]).toMatchObject({ type: "token", value: "B" });
    expect(events[2]?.type).toBe("error");
  });
});
