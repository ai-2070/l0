// Anthropic SDK adapter tests
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  wrapAnthropicStream,
  anthropicAdapter,
  isAnthropicStream,
  isAnthropicStreamEvent,
  type AnthropicStream,
  type RawMessageStreamEvent,
} from "../src/adapters/anthropic";
import { l0 } from "../src/runtime/l0";
import { clearAdapters, registerAdapter } from "../src/adapters/registry";
import type { L0Event } from "../src/types/l0";

// Helper to create mock Anthropic stream events
function createMessageStartEvent(
  inputTokens = 10,
  outputTokens = 0,
): RawMessageStreamEvent {
  return {
    type: "message_start",
    message: {
      id: "msg_123",
      type: "message",
      role: "assistant",
      content: [],
      model: "claude-sonnet-4-20250514",
      stop_reason: null,
      stop_sequence: null,
      usage: {
        input_tokens: inputTokens,
        output_tokens: outputTokens,
        cache_creation: null,
        cache_creation_input_tokens: null,
        cache_read_input_tokens: null,
        server_tool_use: null,
        service_tier: null,
      },
    },
  };
}

function createContentBlockStartEvent(
  index: number,
  type: "text" | "tool_use" = "text",
  toolInfo?: { id: string; name: string },
): RawMessageStreamEvent {
  if (type === "tool_use") {
    return {
      type: "content_block_start",
      index,
      content_block: {
        type: "tool_use",
        id: toolInfo?.id || "tool_123",
        name: toolInfo?.name || "get_weather",
        input: {},
      },
    } as RawMessageStreamEvent;
  }
  return {
    type: "content_block_start",
    index,
    content_block: {
      type: "text",
      text: "",
    },
  } as RawMessageStreamEvent;
}

function createContentBlockDeltaEvent(
  index: number,
  text: string,
): RawMessageStreamEvent {
  return {
    type: "content_block_delta",
    index,
    delta: {
      type: "text_delta",
      text,
    },
  } as RawMessageStreamEvent;
}

function createToolInputDeltaEvent(
  index: number,
  partialJson: string,
): RawMessageStreamEvent {
  return {
    type: "content_block_delta",
    index,
    delta: {
      type: "input_json_delta",
      partial_json: partialJson,
    },
  } as RawMessageStreamEvent;
}

function createContentBlockStopEvent(index: number): RawMessageStreamEvent {
  return {
    type: "content_block_stop",
    index,
  } as RawMessageStreamEvent;
}

function createMessageDeltaEvent(outputTokens: number): RawMessageStreamEvent {
  return {
    type: "message_delta",
    delta: {
      stop_reason: "end_turn",
      stop_sequence: null,
    },
    usage: {
      output_tokens: outputTokens,
    },
  } as RawMessageStreamEvent;
}

function createMessageStopEvent(): RawMessageStreamEvent {
  return {
    type: "message_stop",
  } as RawMessageStreamEvent;
}

// Create an async iterable from events
async function* createMockAnthropicStream(
  events: RawMessageStreamEvent[],
): AnthropicStream {
  for (const event of events) {
    yield event;
  }
}

// Create a mock that looks like MessageStream
function createMockMessageStream(
  events: RawMessageStreamEvent[],
): AnthropicStream {
  const stream = {
    [Symbol.asyncIterator]: async function* () {
      for (const event of events) {
        yield event;
      }
    },
    on: () => stream,
    finalMessage: async () => ({}),
  };
  return stream as unknown as AnthropicStream;
}

describe("Anthropic SDK Adapter", () => {
  beforeEach(() => {
    clearAdapters();
  });

  afterEach(() => {
    clearAdapters();
  });

  describe("isAnthropicStreamEvent", () => {
    it("should detect valid Anthropic stream events", () => {
      expect(isAnthropicStreamEvent(createMessageStartEvent())).toBe(true);
      expect(isAnthropicStreamEvent(createContentBlockStartEvent(0))).toBe(
        true,
      );
      expect(
        isAnthropicStreamEvent(createContentBlockDeltaEvent(0, "hi")),
      ).toBe(true);
      expect(isAnthropicStreamEvent(createContentBlockStopEvent(0))).toBe(true);
      expect(isAnthropicStreamEvent(createMessageDeltaEvent(10))).toBe(true);
      expect(isAnthropicStreamEvent(createMessageStopEvent())).toBe(true);
    });

    it("should reject non-Anthropic events", () => {
      expect(isAnthropicStreamEvent(null)).toBe(false);
      expect(isAnthropicStreamEvent(undefined)).toBe(false);
      expect(isAnthropicStreamEvent({})).toBe(false);
      expect(isAnthropicStreamEvent({ type: "unknown" })).toBe(false);
      expect(isAnthropicStreamEvent({ type: 123 })).toBe(false);
      expect(isAnthropicStreamEvent("string")).toBe(false);
    });
  });

  describe("isAnthropicStream", () => {
    it("should detect Anthropic MessageStream by heuristics", () => {
      const mockStream = createMockMessageStream([]);
      expect(isAnthropicStream(mockStream)).toBe(true);
    });

    it("should NOT detect non-Anthropic streams", () => {
      // Plain async iterable without Anthropic markers
      const plainIterable = {
        [Symbol.asyncIterator]: async function* () {
          yield { data: "test" };
        },
      };
      expect(isAnthropicStream(plainIterable)).toBe(false);

      // OpenAI-like stream
      const openaiLike = {
        [Symbol.asyncIterator]: async function* () {
          yield { choices: [{ delta: { content: "hi" } }] };
        },
      };
      expect(isAnthropicStream(openaiLike)).toBe(false);

      // Non-objects
      expect(isAnthropicStream(null)).toBe(false);
      expect(isAnthropicStream(undefined)).toBe(false);
      expect(isAnthropicStream("string")).toBe(false);
      expect(isAnthropicStream(123)).toBe(false);
    });

    it("should detect stream with controller marker", () => {
      const streamWithController = {
        [Symbol.asyncIterator]: async function* () {
          yield createMessageStartEvent();
        },
        controller: {},
        body: {},
      };
      expect(isAnthropicStream(streamWithController)).toBe(true);
    });
  });

  describe("wrapAnthropicStream", () => {
    it("should emit token events for every content_block_delta", async () => {
      const events = [
        createMessageStartEvent(),
        createContentBlockStartEvent(0),
        createContentBlockDeltaEvent(0, "Hello"),
        createContentBlockDeltaEvent(0, " "),
        createContentBlockDeltaEvent(0, "world"),
        createContentBlockStopEvent(0),
        createMessageDeltaEvent(3),
        createMessageStopEvent(),
      ];

      const stream = createMockAnthropicStream(events);
      const l0Events: L0Event[] = [];

      for await (const event of wrapAnthropicStream(stream)) {
        l0Events.push(event);
      }

      const tokenEvents = l0Events.filter((e) => e.type === "token");
      expect(tokenEvents).toHaveLength(3);
      expect(tokenEvents[0]!.value).toBe("Hello");
      expect(tokenEvents[1]!.value).toBe(" ");
      expect(tokenEvents[2]!.value).toBe("world");
    });

    it("should pass through chunk text EXACTLY as-is (no trim)", async () => {
      const events = [
        createMessageStartEvent(),
        createContentBlockStartEvent(0),
        createContentBlockDeltaEvent(0, "  leading spaces"),
        createContentBlockDeltaEvent(0, "trailing spaces  "),
        createContentBlockDeltaEvent(0, "\n\nnewlines\n\n"),
        createContentBlockDeltaEvent(0, "\ttabs\t"),
        createContentBlockStopEvent(0),
        createMessageStopEvent(),
      ];

      const stream = createMockAnthropicStream(events);
      const l0Events: L0Event[] = [];

      for await (const event of wrapAnthropicStream(stream)) {
        l0Events.push(event);
      }

      const tokenEvents = l0Events.filter((e) => e.type === "token");
      expect(tokenEvents[0]!.value).toBe("  leading spaces");
      expect(tokenEvents[1]!.value).toBe("trailing spaces  ");
      expect(tokenEvents[2]!.value).toBe("\n\nnewlines\n\n");
      expect(tokenEvents[3]!.value).toBe("\ttabs\t");
    });

    it("should include timestamps on all events", async () => {
      const events = [
        createMessageStartEvent(),
        createContentBlockStartEvent(0),
        createContentBlockDeltaEvent(0, "test"),
        createContentBlockStopEvent(0),
        createMessageStopEvent(),
      ];

      const stream = createMockAnthropicStream(events);
      const l0Events: L0Event[] = [];

      for await (const event of wrapAnthropicStream(stream)) {
        l0Events.push(event);
      }

      for (const event of l0Events) {
        expect(event.timestamp).toBeDefined();
        expect(typeof event.timestamp).toBe("number");
        expect(event.timestamp).toBeGreaterThan(0);
      }
    });

    it("should emit done on message_stop", async () => {
      const events = [
        createMessageStartEvent(),
        createContentBlockStartEvent(0),
        createContentBlockDeltaEvent(0, "test"),
        createContentBlockStopEvent(0),
        createMessageStopEvent(),
      ];

      const stream = createMockAnthropicStream(events);
      const l0Events: L0Event[] = [];

      for await (const event of wrapAnthropicStream(stream)) {
        l0Events.push(event);
      }

      const doneEvents = l0Events.filter((e) => e.type === "complete");
      expect(doneEvents).toHaveLength(1);
    });

    it("should not emit done twice", async () => {
      // Even if stream has multiple message_stop events (shouldn't happen but test robustness)
      const events = [
        createMessageStartEvent(),
        createContentBlockStartEvent(0),
        createContentBlockDeltaEvent(0, "test"),
        createContentBlockStopEvent(0),
        createMessageStopEvent(),
        createMessageStopEvent(), // Duplicate
      ];

      const stream = createMockAnthropicStream(events);
      const l0Events: L0Event[] = [];

      for await (const event of wrapAnthropicStream(stream)) {
        l0Events.push(event);
      }

      const doneEvents = l0Events.filter((e) => e.type === "complete");
      expect(doneEvents).toHaveLength(1);
    });

    it("should skip irrelevant chunk types (message_start, content_block_start, etc.)", async () => {
      const events = [
        createMessageStartEvent(),
        createContentBlockStartEvent(0),
        createContentBlockDeltaEvent(0, "text"),
        createContentBlockStopEvent(0),
        createMessageDeltaEvent(5),
        createMessageStopEvent(),
      ];

      const stream = createMockAnthropicStream(events);
      const l0Events: L0Event[] = [];

      for await (const event of wrapAnthropicStream(stream)) {
        l0Events.push(event);
      }

      // Should only have token and complete events (no message_start, etc.)
      const eventTypes = l0Events.map((e) => e.type);
      expect(eventTypes).toEqual(["token", "complete"]);
    });

    it("should produce no extra events", async () => {
      const events = [
        createMessageStartEvent(),
        createContentBlockStartEvent(0),
        createContentBlockDeltaEvent(0, "A"),
        createContentBlockDeltaEvent(0, "B"),
        createContentBlockStopEvent(0),
        createMessageStopEvent(),
      ];

      const stream = createMockAnthropicStream(events);
      const l0Events: L0Event[] = [];

      for await (const event of wrapAnthropicStream(stream)) {
        l0Events.push(event);
      }

      // Exactly 2 tokens + 1 complete = 3 events
      expect(l0Events).toHaveLength(3);
      expect(l0Events[0]!.type).toBe("token");
      expect(l0Events[1]!.type).toBe("token");
      expect(l0Events[2]!.type).toBe("complete");
    });

    it("should wrap thrown errors into { type: 'error' }", async () => {
      async function* errorStream(): AnthropicStream {
        yield createMessageStartEvent();
        yield createContentBlockStartEvent(0);
        yield createContentBlockDeltaEvent(0, "partial");
        throw new Error("Network failure");
      }

      const l0Events: L0Event[] = [];

      for await (const event of wrapAnthropicStream(errorStream())) {
        l0Events.push(event);
      }

      const errorEvents = l0Events.filter((e) => e.type === "error");
      expect(errorEvents).toHaveLength(1);
      expect(errorEvents[0]!.error).toBeInstanceOf(Error);
      expect(errorEvents[0]!.error!.message).toBe("Network failure");
      expect(errorEvents[0]!.timestamp).toBeDefined();
    });

    it("should preserve ordering (delta -> delta -> done)", async () => {
      const events = [
        createMessageStartEvent(),
        createContentBlockStartEvent(0),
        createContentBlockDeltaEvent(0, "first"),
        createContentBlockDeltaEvent(0, "second"),
        createContentBlockDeltaEvent(0, "third"),
        createContentBlockStopEvent(0),
        createMessageStopEvent(),
      ];

      const stream = createMockAnthropicStream(events);
      const l0Events: L0Event[] = [];

      for await (const event of wrapAnthropicStream(stream)) {
        l0Events.push(event);
      }

      expect(l0Events[0]!.type).toBe("token");
      expect(l0Events[0]!.value).toBe("first");
      expect(l0Events[1]!.type).toBe("token");
      expect(l0Events[1]!.value).toBe("second");
      expect(l0Events[2]!.type).toBe("token");
      expect(l0Events[2]!.value).toBe("third");
      expect(l0Events[3]!.type).toBe("complete");
    });

    it("should work when stream yields no deltas", async () => {
      const events = [
        createMessageStartEvent(),
        createContentBlockStartEvent(0),
        createContentBlockStopEvent(0),
        createMessageStopEvent(),
      ];

      const stream = createMockAnthropicStream(events);
      const l0Events: L0Event[] = [];

      for await (const event of wrapAnthropicStream(stream)) {
        l0Events.push(event);
      }

      const tokenEvents = l0Events.filter((e) => e.type === "token");
      const doneEvents = l0Events.filter((e) => e.type === "complete");

      expect(tokenEvents).toHaveLength(0);
      expect(doneEvents).toHaveLength(1);
    });

    it("should work when stream ends immediately", async () => {
      const events = [createMessageStopEvent()];

      const stream = createMockAnthropicStream(events);
      const l0Events: L0Event[] = [];

      for await (const event of wrapAnthropicStream(stream)) {
        l0Events.push(event);
      }

      expect(l0Events).toHaveLength(1);
      expect(l0Events[0]!.type).toBe("complete");
    });

    it("should emit done even if stream ends without message_stop", async () => {
      const events = [
        createMessageStartEvent(),
        createContentBlockStartEvent(0),
        createContentBlockDeltaEvent(0, "incomplete"),
        // No message_stop
      ];

      const stream = createMockAnthropicStream(events);
      const l0Events: L0Event[] = [];

      for await (const event of wrapAnthropicStream(stream)) {
        l0Events.push(event);
      }

      const doneEvents = l0Events.filter((e) => e.type === "complete");
      expect(doneEvents).toHaveLength(1);
    });

    it("should include usage when available", async () => {
      const events = [
        createMessageStartEvent(15, 0),
        createContentBlockStartEvent(0),
        createContentBlockDeltaEvent(0, "test"),
        createContentBlockStopEvent(0),
        createMessageDeltaEvent(8),
        createMessageStopEvent(),
      ];

      const stream = createMockAnthropicStream(events);
      const l0Events: L0Event[] = [];

      for await (const event of wrapAnthropicStream(stream)) {
        l0Events.push(event);
      }

      const doneEvent = l0Events.find((e) => e.type === "complete");
      expect((doneEvent as any).usage).toBeDefined();
      expect((doneEvent as any).usage.input_tokens).toBe(15);
      expect((doneEvent as any).usage.output_tokens).toBe(8);
    });

    it("should exclude usage when includeUsage is false", async () => {
      const events = [
        createMessageStartEvent(15, 0),
        createContentBlockStartEvent(0),
        createContentBlockDeltaEvent(0, "test"),
        createContentBlockStopEvent(0),
        createMessageDeltaEvent(8),
        createMessageStopEvent(),
      ];

      const stream = createMockAnthropicStream(events);
      const l0Events: L0Event[] = [];

      for await (const event of wrapAnthropicStream(stream, {
        includeUsage: false,
      })) {
        l0Events.push(event);
      }

      const doneEvent = l0Events.find((e) => e.type === "complete");
      expect((doneEvent as any).usage).toBeUndefined();
    });

    it("should handle tool use blocks", async () => {
      const events = [
        createMessageStartEvent(),
        createContentBlockStartEvent(0, "tool_use", {
          id: "tool_abc",
          name: "get_weather",
        }),
        createToolInputDeltaEvent(0, '{"location":'),
        createToolInputDeltaEvent(0, '"Tokyo"}'),
        createContentBlockStopEvent(0),
        createMessageStopEvent(),
      ];

      const stream = createMockAnthropicStream(events);
      const l0Events: L0Event[] = [];

      for await (const event of wrapAnthropicStream(stream)) {
        l0Events.push(event);
      }

      const messageEvents = l0Events.filter((e) => e.type === "message");
      expect(messageEvents).toHaveLength(1);

      const data = JSON.parse(messageEvents[0]!.value!);
      expect(data.type).toBe("tool_use");
      expect(data.tool_use.id).toBe("tool_abc");
      expect(data.tool_use.name).toBe("get_weather");
      expect(data.tool_use.input).toBe('{"location":"Tokyo"}');
    });

    it("should exclude tool use when includeToolUse is false", async () => {
      const events = [
        createMessageStartEvent(),
        createContentBlockStartEvent(0, "tool_use", {
          id: "tool_abc",
          name: "get_weather",
        }),
        createToolInputDeltaEvent(0, '{"location":"NYC"}'),
        createContentBlockStopEvent(0),
        createMessageStopEvent(),
      ];

      const stream = createMockAnthropicStream(events);
      const l0Events: L0Event[] = [];

      for await (const event of wrapAnthropicStream(stream, {
        includeToolUse: false,
      })) {
        l0Events.push(event);
      }

      const messageEvents = l0Events.filter((e) => e.type === "message");
      expect(messageEvents).toHaveLength(0);
    });
  });

  describe("anthropicAdapter", () => {
    it("should have correct name", () => {
      expect(anthropicAdapter.name).toBe("anthropic");
    });

    it("should have detect function", () => {
      expect(anthropicAdapter.detect).toBeDefined();
      expect(typeof anthropicAdapter.detect).toBe("function");
    });

    it("should have wrap function", () => {
      expect(anthropicAdapter.wrap).toBeDefined();
      expect(typeof anthropicAdapter.wrap).toBe("function");
    });
  });

  describe("Integration with l0()", () => {
    it("should work inside l0({ adapter: anthropicAdapter })", async () => {
      const events = [
        createMessageStartEvent(),
        createContentBlockStartEvent(0),
        createContentBlockDeltaEvent(0, "Hello"),
        createContentBlockDeltaEvent(0, " from"),
        createContentBlockDeltaEvent(0, " Claude"),
        createContentBlockStopEvent(0),
        createMessageStopEvent(),
      ];

      const result = await l0({
        stream: () => createMockAnthropicStream(events),
        adapter: anthropicAdapter,
      });

      let fullText = "";
      for await (const event of result.stream) {
        if (event.type === "token" && event.value) {
          fullText += event.value;
        }
      }

      expect(fullText).toBe("Hello from Claude");
      expect(result.state.completed).toBe(true);
    });

    it("should work with pre-wrapped stream (manual adapter.wrap call)", async () => {
      // This tests the common pattern where user manually wraps the stream
      // before passing to l0 - useful when adapter is used directly
      const events = [
        createMessageStartEvent(),
        createContentBlockStartEvent(0),
        createContentBlockDeltaEvent(0, "Pre-wrapped!"),
        createContentBlockStopEvent(0),
        createMessageStopEvent(),
      ];

      const result = await l0({
        stream: () => wrapAnthropicStream(createMockAnthropicStream(events)),
      });

      let fullText = "";
      for await (const event of result.stream) {
        if (event.type === "token" && event.value) {
          fullText += event.value;
        }
      }

      expect(fullText).toBe("Pre-wrapped!");
    });

    it("should work with adapter specified by name", async () => {
      registerAdapter(anthropicAdapter);

      const events = [
        createMessageStartEvent(),
        createContentBlockStartEvent(0),
        createContentBlockDeltaEvent(0, "By name!"),
        createContentBlockStopEvent(0),
        createMessageStopEvent(),
      ];

      const result = await l0({
        stream: () => createMockAnthropicStream(events),
        adapter: "anthropic",
      });

      let fullText = "";
      for await (const event of result.stream) {
        if (event.type === "token" && event.value) {
          fullText += event.value;
        }
      }

      expect(fullText).toBe("By name!");
    });

    it("should pass adapter options through l0", async () => {
      const events = [
        createMessageStartEvent(20, 0),
        createContentBlockStartEvent(0),
        createContentBlockDeltaEvent(0, "With options"),
        createContentBlockStopEvent(0),
        createMessageDeltaEvent(5),
        createMessageStopEvent(),
      ];

      const result = await l0({
        stream: () => createMockAnthropicStream(events),
        adapter: anthropicAdapter,
        adapterOptions: { includeUsage: false },
      });

      const l0Events: L0Event[] = [];
      for await (const event of result.stream) {
        l0Events.push(event);
      }

      // Complete event should not have usage
      const completeEvent = l0Events.find((e) => e.type === "complete");
      expect((completeEvent as any).usage).toBeUndefined();
    });

    it("should handle multiple content blocks", async () => {
      const events = [
        createMessageStartEvent(),
        // First content block
        createContentBlockStartEvent(0),
        createContentBlockDeltaEvent(0, "First "),
        createContentBlockDeltaEvent(0, "block."),
        createContentBlockStopEvent(0),
        // Second content block
        createContentBlockStartEvent(1),
        createContentBlockDeltaEvent(1, " Second "),
        createContentBlockDeltaEvent(1, "block."),
        createContentBlockStopEvent(1),
        createMessageStopEvent(),
      ];

      const result = await l0({
        stream: () => createMockAnthropicStream(events),
        adapter: anthropicAdapter,
      });

      let fullText = "";
      for await (const event of result.stream) {
        if (event.type === "token" && event.value) {
          fullText += event.value;
        }
      }

      expect(fullText).toBe("First block. Second block.");
    });
  });
});
