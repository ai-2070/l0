import { describe, it, expect, vi } from "vitest";
import { getText, consumeStream } from "../src/runtime/helpers";
import type { L0Result, L0Event, L0State } from "../src/types/l0";

// Helper to create async generator from events
async function* asyncGen(events: L0Event[]): AsyncGenerator<L0Event> {
  for (const event of events) {
    yield event;
  }
}

// Helper to create mock L0Result
function createMockResult(events: L0Event[], finalContent: string): L0Result {
  const state: L0State = {
    content: finalContent,
    checkpoint: "",
    tokenCount: events.filter((e) => e.type === "token").length,
    modelRetryCount: 0,
    networkRetryCount: 0,
    fallbackIndex: 0,
    violations: [],
    driftDetected: false,
    completed: true,
    networkErrors: [],
    resumed: false,
    dataOutputs: [],
  };

  return {
    stream: asyncGen(events),
    state,
    abort: vi.fn(),
    errors: [],
  };
}

describe("Runtime Helpers", () => {
  describe("getText", () => {
    it("should consume stream and return final content", async () => {
      const events: L0Event[] = [
        { type: "token", value: "Hello", timestamp: 1 },
        { type: "token", value: " ", timestamp: 2 },
        { type: "token", value: "World", timestamp: 3 },
        { type: "complete", timestamp: 4 },
      ];

      const result = createMockResult(events, "Hello World");
      const text = await getText(result);

      expect(text).toBe("Hello World");
    });

    it("should handle empty stream", async () => {
      const events: L0Event[] = [{ type: "complete", timestamp: 1 }];

      const result = createMockResult(events, "");
      const text = await getText(result);

      expect(text).toBe("");
    });

    it("should handle stream with only non-token events", async () => {
      const events: L0Event[] = [
        { type: "progress", value: "50%", timestamp: 1 },
        { type: "complete", timestamp: 2 },
      ];

      const result = createMockResult(events, "");
      const text = await getText(result);

      expect(text).toBe("");
    });
  });

  describe("consumeStream", () => {
    it("should call callback for each token", async () => {
      const events: L0Event[] = [
        { type: "token", value: "Hello", timestamp: 1 },
        { type: "token", value: " ", timestamp: 2 },
        { type: "token", value: "World", timestamp: 3 },
        { type: "complete", timestamp: 4 },
      ];

      const result = createMockResult(events, "Hello World");
      const onToken = vi.fn();

      const text = await consumeStream(result, onToken);

      expect(text).toBe("Hello World");
      expect(onToken).toHaveBeenCalledTimes(3);
      expect(onToken).toHaveBeenNthCalledWith(1, "Hello");
      expect(onToken).toHaveBeenNthCalledWith(2, " ");
      expect(onToken).toHaveBeenNthCalledWith(3, "World");
    });

    it("should not call callback for non-token events", async () => {
      const events: L0Event[] = [
        { type: "token", value: "test", timestamp: 1 },
        { type: "progress", value: "50%", timestamp: 2 },
        { type: "complete", timestamp: 3 },
      ];

      const result = createMockResult(events, "test");
      const onToken = vi.fn();

      await consumeStream(result, onToken);

      expect(onToken).toHaveBeenCalledTimes(1);
      expect(onToken).toHaveBeenCalledWith("test");
    });

    it("should skip tokens without value", async () => {
      const events: L0Event[] = [
        { type: "token", value: "a", timestamp: 1 },
        { type: "token", timestamp: 2 }, // no value
        { type: "token", value: "b", timestamp: 3 },
        { type: "complete", timestamp: 4 },
      ];

      const result = createMockResult(events, "ab");
      const onToken = vi.fn();

      await consumeStream(result, onToken);

      expect(onToken).toHaveBeenCalledTimes(2);
      expect(onToken).toHaveBeenNthCalledWith(1, "a");
      expect(onToken).toHaveBeenNthCalledWith(2, "b");
    });

    it("should handle empty stream", async () => {
      const events: L0Event[] = [{ type: "complete", timestamp: 1 }];

      const result = createMockResult(events, "");
      const onToken = vi.fn();

      const text = await consumeStream(result, onToken);

      expect(text).toBe("");
      expect(onToken).not.toHaveBeenCalled();
    });

    it("should return final content from state", async () => {
      const events: L0Event[] = [
        { type: "token", value: "streamed", timestamp: 1 },
        { type: "complete", timestamp: 2 },
      ];

      // The state content may differ from streamed tokens
      const result = createMockResult(events, "final content from state");
      const onToken = vi.fn();

      const text = await consumeStream(result, onToken);

      // Returns state.content, not accumulated tokens
      expect(text).toBe("final content from state");
    });
  });
});
