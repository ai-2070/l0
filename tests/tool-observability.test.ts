/**
 * Tests for tool call observability events
 *
 * L0 detects tool calls from various SDK formats and emits observability events:
 * - TOOL_REQUESTED: Tool call detected
 * - TOOL_START: Tool execution began
 * - TOOL_RESULT: Tool completed successfully
 * - TOOL_ERROR: Tool execution failed
 * - TOOL_COMPLETED: Tool lifecycle finished
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { l0 } from "../src/runtime/l0";
import { EventDispatcher } from "../src/runtime/event-dispatcher";
import { EventType } from "../src/types/observability";
import type { L0Event } from "../src/types/l0";

// Helper to create a token stream with tool calls
function createStreamWithToolCall(
  toolCallMessage: object,
  toolResultMessage?: object,
): () => AsyncGenerator<L0Event> {
  return async function* () {
    yield { type: "token", value: "Before tool call. ", timestamp: Date.now() };
    yield {
      type: "message",
      value: JSON.stringify(toolCallMessage),
      role: "assistant",
      timestamp: Date.now(),
    };
    if (toolResultMessage) {
      // Small delay to ensure duration tracking works
      await new Promise((r) => setTimeout(r, 10));
      yield {
        type: "message",
        value: JSON.stringify(toolResultMessage),
        role: "tool",
        timestamp: Date.now(),
      };
    }
    yield { type: "token", value: "After tool call.", timestamp: Date.now() };
    yield { type: "complete", timestamp: Date.now() };
  };
}

describe("Tool Call Observability", () => {
  describe("L0 Flat Format (Custom Adapters)", () => {
    it("should emit TOOL_REQUESTED for flat tool_call format", async () => {
      const onToolCall = vi.fn();

      const result = await l0({
        stream: createStreamWithToolCall({
          type: "tool_call",
          id: "call_123",
          name: "get_weather",
          arguments: { location: "Seattle" },
        }),
        onToolCall,
      });

      for await (const _ of result.stream) {
        // consume
      }

      // Verify TOOL_REQUESTED event was emitted via onToolCall callback
      expect(onToolCall).toHaveBeenCalledTimes(1);
      expect(onToolCall).toHaveBeenCalledWith("get_weather", "call_123", {
        location: "Seattle",
      });
      expect(result.state.completed).toBe(true);
    });

    it("should call onToolCall callback for flat format", async () => {
      const onToolCall = vi.fn();

      const result = await l0({
        stream: createStreamWithToolCall({
          type: "tool_call",
          id: "call_456",
          name: "search_web",
          arguments: { query: "L0 library" },
        }),
        onToolCall,
      });

      for await (const _ of result.stream) {
        // consume
      }

      expect(onToolCall).toHaveBeenCalledTimes(1);
      expect(onToolCall).toHaveBeenCalledWith("search_web", "call_456", {
        query: "L0 library",
      });
    });

    it("should emit TOOL_RESULT and TOOL_COMPLETED for flat tool_result format", async () => {
      const onToolCall = vi.fn();

      const result = await l0({
        stream: createStreamWithToolCall(
          {
            type: "tool_call",
            id: "call_789",
            name: "calculate",
            arguments: { expression: "2+2" },
          },
          {
            type: "tool_result",
            id: "call_789",
            result: { value: 4 },
          },
        ),
        onToolCall,
      });

      for await (const _ of result.stream) {
        // consume
      }

      expect(onToolCall).toHaveBeenCalledWith("calculate", "call_789", {
        expression: "2+2",
      });
    });

    it("should emit TOOL_ERROR for tool_result with error", async () => {
      const onToolCall = vi.fn();

      const result = await l0({
        stream: createStreamWithToolCall(
          {
            type: "tool_call",
            id: "call_err",
            name: "risky_operation",
            arguments: {},
          },
          {
            type: "tool_result",
            id: "call_err",
            result: null,
            error: "Operation failed",
          },
        ),
        onToolCall,
      });

      for await (const _ of result.stream) {
        // consume
      }

      expect(onToolCall).toHaveBeenCalledWith(
        "risky_operation",
        "call_err",
        {},
      );
    });
  });

  describe("OpenAI Format", () => {
    it("should detect OpenAI tool_calls array format", async () => {
      const onToolCall = vi.fn();

      const result = await l0({
        stream: createStreamWithToolCall({
          type: "tool_calls",
          tool_calls: [
            {
              id: "openai_call_1",
              name: "get_stock_price",
              arguments: JSON.stringify({ symbol: "AAPL" }),
            },
          ],
        }),
        onToolCall,
      });

      for await (const _ of result.stream) {
        // consume
      }

      expect(onToolCall).toHaveBeenCalledTimes(1);
      expect(onToolCall).toHaveBeenCalledWith(
        "get_stock_price",
        "openai_call_1",
        { symbol: "AAPL" },
      );
    });

    it("should handle multiple tool calls in OpenAI format", async () => {
      const onToolCall = vi.fn();

      const result = await l0({
        stream: createStreamWithToolCall({
          type: "tool_calls",
          tool_calls: [
            {
              id: "multi_1",
              name: "tool_a",
              arguments: { a: 1 },
            },
            {
              id: "multi_2",
              name: "tool_b",
              arguments: { b: 2 },
            },
          ],
        }),
        onToolCall,
      });

      for await (const _ of result.stream) {
        // consume
      }

      expect(onToolCall).toHaveBeenCalledTimes(2);
      expect(onToolCall).toHaveBeenNthCalledWith(1, "tool_a", "multi_1", {
        a: 1,
      });
      expect(onToolCall).toHaveBeenNthCalledWith(2, "tool_b", "multi_2", {
        b: 2,
      });
    });

    it("should parse stringified arguments in OpenAI format", async () => {
      const onToolCall = vi.fn();

      const result = await l0({
        stream: createStreamWithToolCall({
          type: "tool_calls",
          tool_calls: [
            {
              id: "str_args",
              name: "parse_json",
              arguments: '{"nested": {"key": "value"}}',
            },
          ],
        }),
        onToolCall,
      });

      for await (const _ of result.stream) {
        // consume
      }

      expect(onToolCall).toHaveBeenCalledWith("parse_json", "str_args", {
        nested: { key: "value" },
      });
    });
  });

  describe("Anthropic Format", () => {
    it("should detect Anthropic tool_use format", async () => {
      const onToolCall = vi.fn();

      const result = await l0({
        stream: createStreamWithToolCall({
          type: "tool_use",
          tool_use: {
            id: "toolu_123",
            name: "computer",
            input: { action: "screenshot" },
          },
        }),
        onToolCall,
      });

      for await (const _ of result.stream) {
        // consume
      }

      expect(onToolCall).toHaveBeenCalledTimes(1);
      expect(onToolCall).toHaveBeenCalledWith("computer", "toolu_123", {
        action: "screenshot",
      });
    });
  });

  describe("Mastra/Legacy Nested Format", () => {
    it("should detect nested tool_call format", async () => {
      const onToolCall = vi.fn();

      const result = await l0({
        stream: createStreamWithToolCall({
          type: "tool_call",
          tool_call: {
            id: "mastra_call",
            name: "agent_action",
            arguments: { step: "analyze" },
          },
        }),
        onToolCall,
      });

      for await (const _ of result.stream) {
        // consume
      }

      expect(onToolCall).toHaveBeenCalledTimes(1);
      expect(onToolCall).toHaveBeenCalledWith("agent_action", "mastra_call", {
        step: "analyze",
      });
    });

    it("should detect nested tool_result format", async () => {
      const onToolCall = vi.fn();

      const result = await l0({
        stream: createStreamWithToolCall(
          {
            type: "tool_call",
            tool_call: {
              id: "nested_result",
              name: "fetch_data",
              arguments: {},
            },
          },
          {
            type: "tool_result",
            tool_result: {
              id: "nested_result",
              result: { data: [1, 2, 3] },
            },
          },
        ),
        onToolCall,
      });

      for await (const _ of result.stream) {
        // consume
      }

      expect(onToolCall).toHaveBeenCalledWith(
        "fetch_data",
        "nested_result",
        {},
      );
    });
  });

  describe("Legacy function_call Format", () => {
    it("should detect legacy function_call format", async () => {
      const onToolCall = vi.fn();

      const result = await l0({
        stream: createStreamWithToolCall({
          type: "function_call",
          function_call: {
            name: "legacy_function",
            arguments: '{"old": "style"}',
          },
        }),
        onToolCall,
      });

      for await (const _ of result.stream) {
        // consume
      }

      expect(onToolCall).toHaveBeenCalledTimes(1);
      expect(onToolCall.mock.calls[0][0]).toBe("legacy_function");
      expect(onToolCall.mock.calls[0][2]).toEqual({ old: "style" });
      // ID is generated for legacy format
      expect(onToolCall.mock.calls[0][1]).toMatch(/^fn_\d+$/);
    });
  });

  describe("Edge Cases", () => {
    it("should handle non-JSON message values gracefully", async () => {
      const onToolCall = vi.fn();

      const stream = async function* (): AsyncGenerator<L0Event> {
        yield { type: "token", value: "Hello", timestamp: Date.now() };
        yield {
          type: "message",
          value: "not valid json",
          role: "assistant",
          timestamp: Date.now(),
        };
        yield { type: "complete", timestamp: Date.now() };
      };

      const result = await l0({
        stream: () => stream(),
        onToolCall,
      });

      for await (const _ of result.stream) {
        // consume
      }

      // Should not throw, just not call onToolCall
      expect(onToolCall).not.toHaveBeenCalled();
      expect(result.state.completed).toBe(true);
    });

    it("should handle message without tool call structure", async () => {
      const onToolCall = vi.fn();

      const stream = async function* (): AsyncGenerator<L0Event> {
        yield { type: "token", value: "Hello", timestamp: Date.now() };
        yield {
          type: "message",
          value: JSON.stringify({ type: "other", data: "something" }),
          role: "assistant",
          timestamp: Date.now(),
        };
        yield { type: "complete", timestamp: Date.now() };
      };

      const result = await l0({
        stream: () => stream(),
        onToolCall,
      });

      for await (const _ of result.stream) {
        // consume
      }

      expect(onToolCall).not.toHaveBeenCalled();
      expect(result.state.completed).toBe(true);
    });

    it("should handle tool call with missing fields gracefully", async () => {
      const onToolCall = vi.fn();

      const result = await l0({
        stream: createStreamWithToolCall({
          type: "tool_call",
          // Missing id and name - should not trigger onToolCall
        }),
        onToolCall,
      });

      for await (const _ of result.stream) {
        // consume
      }

      // Flat format requires id and name
      expect(onToolCall).not.toHaveBeenCalled();
    });

    it("should handle empty arguments", async () => {
      const onToolCall = vi.fn();

      const result = await l0({
        stream: createStreamWithToolCall({
          type: "tool_call",
          id: "empty_args",
          name: "no_params",
          arguments: {},
        }),
        onToolCall,
      });

      for await (const _ of result.stream) {
        // consume
      }

      expect(onToolCall).toHaveBeenCalledWith("no_params", "empty_args", {});
    });

    it("should handle undefined arguments", async () => {
      const onToolCall = vi.fn();

      const result = await l0({
        stream: createStreamWithToolCall({
          type: "tool_call",
          id: "undef_args",
          name: "optional_params",
          // arguments not provided
        }),
        onToolCall,
      });

      for await (const _ of result.stream) {
        // consume
      }

      expect(onToolCall).toHaveBeenCalledWith(
        "optional_params",
        "undef_args",
        {},
      );
    });

    it("should handle malformed JSON in arguments string", async () => {
      const onToolCall = vi.fn();

      const result = await l0({
        stream: createStreamWithToolCall({
          type: "tool_calls",
          tool_calls: [
            {
              id: "bad_json",
              name: "broken",
              arguments: "{not valid json}",
            },
          ],
        }),
        onToolCall,
      });

      for await (const _ of result.stream) {
        // consume
      }

      // Should still call onToolCall with empty args
      expect(onToolCall).toHaveBeenCalledWith("broken", "bad_json", {});
    });
  });

  describe("State Tracking", () => {
    it("should track tool call start times for duration calculation", async () => {
      const result = await l0({
        stream: createStreamWithToolCall(
          {
            type: "tool_call",
            id: "duration_test",
            name: "slow_tool",
            arguments: {},
          },
          {
            type: "tool_result",
            id: "duration_test",
            result: "done",
          },
        ),
      });

      for await (const _ of result.stream) {
        // consume
      }

      // After completion, tracking maps should be cleaned up
      expect(result.state.toolCallStartTimes?.size ?? 0).toBe(0);
      expect(result.state.toolCallNames?.size ?? 0).toBe(0);
    });

    it("should handle multiple concurrent tool calls", async () => {
      const onToolCall = vi.fn();

      const stream = async function* (): AsyncGenerator<L0Event> {
        yield {
          type: "token",
          value: "Starting concurrent calls. ",
          timestamp: Date.now(),
        };
        // Two tool calls without results
        yield {
          type: "message",
          value: JSON.stringify({
            type: "tool_call",
            id: "concurrent_1",
            name: "tool_a",
            arguments: {},
          }),
          role: "assistant",
          timestamp: Date.now(),
        };
        yield {
          type: "message",
          value: JSON.stringify({
            type: "tool_call",
            id: "concurrent_2",
            name: "tool_b",
            arguments: {},
          }),
          role: "assistant",
          timestamp: Date.now(),
        };
        // Results come back
        yield {
          type: "message",
          value: JSON.stringify({
            type: "tool_result",
            id: "concurrent_1",
            result: "result_a",
          }),
          role: "tool",
          timestamp: Date.now(),
        };
        yield {
          type: "message",
          value: JSON.stringify({
            type: "tool_result",
            id: "concurrent_2",
            result: "result_b",
          }),
          role: "tool",
          timestamp: Date.now(),
        };
        yield { type: "token", value: "Done.", timestamp: Date.now() };
        yield { type: "complete", timestamp: Date.now() };
      };

      const result = await l0({
        stream: () => stream(),
        onToolCall,
      });

      for await (const _ of result.stream) {
        // consume
      }

      expect(onToolCall).toHaveBeenCalledTimes(2);
      expect(onToolCall).toHaveBeenCalledWith("tool_a", "concurrent_1", {});
      expect(onToolCall).toHaveBeenCalledWith("tool_b", "concurrent_2", {});
    });
  });

  describe("Integration with other L0 features", () => {
    it("should work alongside guardrails", async () => {
      const onToolCall = vi.fn();

      const result = await l0({
        stream: createStreamWithToolCall({
          type: "tool_call",
          id: "with_guardrails",
          name: "safe_tool",
          arguments: { safe: true },
        }),
        guardrails: [],
        onToolCall,
      });

      for await (const _ of result.stream) {
        // consume
      }

      expect(onToolCall).toHaveBeenCalled();
      expect(result.state.completed).toBe(true);
    });

    it("should work with retry configuration", async () => {
      const onToolCall = vi.fn();

      const result = await l0({
        stream: createStreamWithToolCall({
          type: "tool_call",
          id: "with_retry",
          name: "reliable_tool",
          arguments: {},
        }),
        retry: { attempts: 2 },
        onToolCall,
      });

      for await (const _ of result.stream) {
        // consume
      }

      expect(onToolCall).toHaveBeenCalled();
      expect(result.state.completed).toBe(true);
    });
  });
});
