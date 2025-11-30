// Mastra adapter tests
import { describe, it, expect } from "vitest";
import {
  wrapMastraStream,
  wrapMastraFullStream,
  mastraStream,
  mastraText,
  mastraStructured,
  isMastraStream,
  extractMastraText,
  extractMastraObject,
} from "../src/adapters/mastra";
import type { L0Event } from "../src/types/l0";

// Mock Mastra stream result
function createMockMastraStream(
  textChunks: string[],
  options: {
    usage?: { inputTokens: number; outputTokens: number; totalTokens: number };
    finishReason?: string;
    toolCalls?: Array<{ toolCallId: string; toolName: string; args: any }>;
    toolResults?: Array<{ toolCallId: string; toolName: string; result: any }>;
    reasoningText?: string;
    shouldError?: boolean;
    errorMessage?: string;
  } = {},
) {
  let textStreamRead = false;
  let fullStreamRead = false;

  const textStream = {
    getReader: () => ({
      read: async () => {
        if (options.shouldError && !textStreamRead) {
          textStreamRead = true;
          throw new Error(options.errorMessage || "Stream error");
        }
        if (!textStreamRead && textChunks.length > 0) {
          textStreamRead = true;
          // Return chunks one at a time
          const chunk = textChunks.shift();
          if (chunk !== undefined) {
            return { done: false, value: chunk };
          }
        }
        if (textChunks.length > 0) {
          const chunk = textChunks.shift();
          return { done: false, value: chunk };
        }
        return { done: true, value: undefined };
      },
    }),
  };

  const fullStreamChunks: any[] = [];

  // Add text deltas
  for (const text of [...textChunks]) {
    fullStreamChunks.push({
      type: "text-delta",
      payload: { text },
    });
  }

  // Add tool calls
  if (options.toolCalls) {
    for (const tc of options.toolCalls) {
      fullStreamChunks.push({
        type: "tool-call",
        payload: tc,
      });
    }
  }

  // Add tool results
  if (options.toolResults) {
    for (const tr of options.toolResults) {
      fullStreamChunks.push({
        type: "tool-result",
        payload: tr,
      });
    }
  }

  // Add finish
  fullStreamChunks.push({
    type: "finish",
    finishReason: options.finishReason || "stop",
  });

  let fullStreamIndex = 0;
  const fullStream = {
    getReader: () => ({
      read: async () => {
        if (options.shouldError && fullStreamIndex === 0) {
          fullStreamIndex++;
          throw new Error(options.errorMessage || "Stream error");
        }
        if (fullStreamIndex < fullStreamChunks.length) {
          return { done: false, value: fullStreamChunks[fullStreamIndex++] };
        }
        return { done: true, value: undefined };
      },
    }),
  };

  return {
    textStream,
    fullStream,
    text: Promise.resolve(textChunks.join("")),
    usage: Promise.resolve(
      options.usage || { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
    ),
    finishReason: Promise.resolve(options.finishReason || "stop"),
    toolCalls: Promise.resolve(
      options.toolCalls?.map((tc) => ({
        type: "tool-call",
        payload: tc,
        ...tc,
      })) || [],
    ),
    toolResults: Promise.resolve(
      options.toolResults?.map((tr) => ({
        type: "tool-result",
        payload: tr,
        ...tr,
      })) || [],
    ),
    reasoningText: Promise.resolve(options.reasoningText),
    object: Promise.resolve(null),
    runId: "test-run-id",
    messageList: {} as any,
  };
}

// Mock Mastra Agent
function createMockAgent(streamResult: any) {
  return {
    stream: async (_messages: any, _options?: any) => streamResult,
    generate: async (_messages: any, _options?: any) => ({
      text: "Generated text",
    }),
    name: "test-agent",
    id: "test-agent",
  };
}

describe("Mastra Adapter", () => {
  describe("wrapMastraStream", () => {
    it("should convert Mastra text stream to L0 token events", async () => {
      const chunks = ["Hello", " ", "world"];
      const mockStream = createMockMastraStream([...chunks]);

      const events: L0Event[] = [];
      for await (const event of wrapMastraStream(mockStream as any)) {
        events.push(event);
      }

      const tokenEvents = events.filter((e) => e.type === "token");
      const doneEvents = events.filter((e) => e.type === "complete");

      expect(tokenEvents).toHaveLength(3);
      expect(tokenEvents[0]!.value).toBe("Hello");
      expect(tokenEvents[1]!.value).toBe(" ");
      expect(tokenEvents[2]!.value).toBe("world");
      expect(doneEvents).toHaveLength(1);
    });

    it("should include usage information when available", async () => {
      const mockStream = createMockMastraStream(["Hi"], {
        usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
      });

      const events: L0Event[] = [];
      for await (const event of wrapMastraStream(mockStream as any)) {
        events.push(event);
      }

      const doneEvent = events.find((e) => e.type === "complete");
      expect(doneEvent).toBeDefined();
      expect((doneEvent as any).usage).toBeDefined();
      expect((doneEvent as any).usage.totalTokens).toBe(15);
    });

    it("should exclude usage when includeUsage is false", async () => {
      const mockStream = createMockMastraStream(["Hi"], {
        usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
      });

      const events: L0Event[] = [];
      for await (const event of wrapMastraStream(mockStream as any, {
        includeUsage: false,
      })) {
        events.push(event);
      }

      const doneEvent = events.find((e) => e.type === "complete");
      expect(doneEvent).toBeDefined();
      expect((doneEvent as any).usage).toBeUndefined();
    });

    it("should include finish reason", async () => {
      const mockStream = createMockMastraStream(["complete"], {
        finishReason: "stop",
      });

      const events: L0Event[] = [];
      for await (const event of wrapMastraStream(mockStream as any)) {
        events.push(event);
      }

      const doneEvent = events.find((e) => e.type === "complete");
      expect(doneEvent).toBeDefined();
      expect((doneEvent as any).finishReason).toBe("stop");
    });

    it("should handle tool calls when enabled", async () => {
      const mockStream = createMockMastraStream(["Calling tool..."], {
        toolCalls: [
          {
            toolCallId: "call_123",
            toolName: "get_weather",
            args: { location: "Tokyo" },
          },
        ],
      });

      const events: L0Event[] = [];
      for await (const event of wrapMastraStream(mockStream as any)) {
        events.push(event);
      }

      const messageEvent = events.find(
        (e) => e.type === "message" && e.value?.includes("tool_calls"),
      );
      expect(messageEvent).toBeDefined();

      const data = JSON.parse(messageEvent!.value!);
      expect(data.type).toBe("tool_calls");
      expect(data.tool_calls).toHaveLength(1);
      expect(data.tool_calls[0].name).toBe("get_weather");
    });

    it("should handle tool results when enabled", async () => {
      const mockStream = createMockMastraStream(["Got result"], {
        toolResults: [
          {
            toolCallId: "call_123",
            toolName: "get_weather",
            result: { temp: 25, condition: "sunny" },
          },
        ],
      });

      const events: L0Event[] = [];
      for await (const event of wrapMastraStream(mockStream as any)) {
        events.push(event);
      }

      const messageEvent = events.find(
        (e) => e.type === "message" && e.value?.includes("tool_results"),
      );
      expect(messageEvent).toBeDefined();

      const data = JSON.parse(messageEvent!.value!);
      expect(data.type).toBe("tool_results");
      expect(data.tool_results[0].result.temp).toBe(25);
    });

    it("should exclude tool calls when includeToolCalls is false", async () => {
      const mockStream = createMockMastraStream(["Text"], {
        toolCalls: [
          {
            toolCallId: "call_123",
            toolName: "test",
            args: {},
          },
        ],
      });

      const events: L0Event[] = [];
      for await (const event of wrapMastraStream(mockStream as any, {
        includeToolCalls: false,
      })) {
        events.push(event);
      }

      const messageEvents = events.filter(
        (e) => e.type === "message" && e.value?.includes("tool"),
      );
      expect(messageEvents).toHaveLength(0);
    });

    it("should handle errors in stream", async () => {
      const mockStream = createMockMastraStream(["Start"], {
        shouldError: true,
        errorMessage: "Stream failed",
      });

      const events: L0Event[] = [];
      for await (const event of wrapMastraStream(mockStream as any)) {
        events.push(event);
      }

      const errorEvent = events.find((e) => e.type === "error");
      expect(errorEvent).toBeDefined();
      expect(errorEvent!.error!.message).toBe("Stream failed");
    });

    it("should handle empty stream", async () => {
      const mockStream = createMockMastraStream([]);

      const events: L0Event[] = [];
      for await (const event of wrapMastraStream(mockStream as any)) {
        events.push(event);
      }

      const tokenEvents = events.filter((e) => e.type === "token");
      const doneEvents = events.filter((e) => e.type === "complete");

      expect(tokenEvents).toHaveLength(0);
      expect(doneEvents).toHaveLength(1);
    });
  });

  describe("wrapMastraFullStream", () => {
    it("should handle text-delta chunks", async () => {
      const chunks = ["Hello", " ", "world"];
      const mockStream = createMockMastraStream([...chunks]);

      // Reset text stream since we're using fullStream
      const events: L0Event[] = [];
      for await (const event of wrapMastraFullStream(mockStream as any)) {
        events.push(event);
      }

      const tokenEvents = events.filter((e) => e.type === "token");
      expect(tokenEvents).toHaveLength(chunks.length);
    });

    it("should handle tool-call chunks", async () => {
      const mockStream = createMockMastraStream([], {
        toolCalls: [
          {
            toolCallId: "call_abc",
            toolName: "search",
            args: { query: "test" },
          },
        ],
      });

      const events: L0Event[] = [];
      for await (const event of wrapMastraFullStream(mockStream as any)) {
        events.push(event);
      }

      const toolCallEvent = events.find(
        (e) => e.type === "message" && e.value?.includes("tool_call"),
      );
      expect(toolCallEvent).toBeDefined();
    });

    it("should handle finish chunk with usage", async () => {
      const mockStream = createMockMastraStream(["complete"], {
        usage: { inputTokens: 5, outputTokens: 10, totalTokens: 15 },
        finishReason: "stop",
      });

      const events: L0Event[] = [];
      for await (const event of wrapMastraFullStream(mockStream as any)) {
        events.push(event);
      }

      const doneEvent = events.find((e) => e.type === "complete");
      expect(doneEvent).toBeDefined();
      expect((doneEvent as any).usage).toBeDefined();
    });
  });

  describe("mastraStream", () => {
    it("should create a stream factory from agent", async () => {
      const mockStreamResult = createMockMastraStream(["Test response"]);
      const mockAgent = createMockAgent(mockStreamResult);

      const factory = mastraStream(mockAgent as any, "Hello");
      expect(typeof factory).toBe("function");

      const stream = await factory();
      const events: L0Event[] = [];

      for await (const event of stream) {
        events.push(event);
      }

      expect(events.filter((e) => e.type === "token")).toHaveLength(1);
    });

    it("should pass stream options to agent", async () => {
      let capturedOptions: any;
      const mockStreamResult = createMockMastraStream(["Response"]);
      const mockAgent = {
        stream: async (_messages: any, options?: any) => {
          capturedOptions = options;
          return mockStreamResult;
        },
      };

      const factory = mastraStream(mockAgent as any, "Hello", {
        temperature: 0.7,
      });

      const stream = await factory();
      for await (const _ of stream) {
        // Consume stream
      }

      expect(capturedOptions).toEqual({ temperature: 0.7 });
    });
  });

  describe("mastraText", () => {
    it("should create a text stream from prompt", async () => {
      const mockStreamResult = createMockMastraStream(["Hello", " there"]);
      const mockAgent = createMockAgent(mockStreamResult);

      const factory = mastraText(mockAgent as any, "Say hello");

      const stream = await factory();
      const events: L0Event[] = [];

      for await (const event of stream) {
        events.push(event);
      }

      const tokens = events.filter((e) => e.type === "token");
      expect(tokens).toHaveLength(2);
    });
  });

  describe("mastraStructured", () => {
    it("should create a structured output stream", async () => {
      const mockStreamResult = createMockMastraStream(['{"name":"John"}']);
      const mockAgent = createMockAgent(mockStreamResult);

      const schema = {
        type: "object",
        properties: { name: { type: "string" } },
      };
      const factory = mastraStructured(
        mockAgent as any,
        "Generate data",
        schema,
      );

      const stream = await factory();
      const events: L0Event[] = [];

      for await (const event of stream) {
        events.push(event);
      }

      expect(events.filter((e) => e.type === "token")).toHaveLength(1);
    });

    it("should pass schema in structuredOutput option", async () => {
      let capturedOptions: any;
      const mockStreamResult = createMockMastraStream(["{}"], {});
      const mockAgent = {
        stream: async (_messages: any, options?: any) => {
          capturedOptions = options;
          return mockStreamResult;
        },
      };

      const schema = { name: "string" };
      const factory = mastraStructured(mockAgent as any, "Generate", schema);

      const stream = await factory();
      for await (const _ of stream) {
        // Consume stream
      }

      expect(capturedOptions.structuredOutput).toBeDefined();
      expect(capturedOptions.structuredOutput.schema).toBe(schema);
    });
  });

  describe("isMastraStream", () => {
    it("should return true for valid Mastra streams", () => {
      const mockStream = createMockMastraStream(["Test"]);
      expect(isMastraStream(mockStream)).toBe(true);
    });

    it("should return false for invalid objects", () => {
      expect(isMastraStream(null)).toBe(false);
      expect(isMastraStream(undefined)).toBe(false);
      expect(isMastraStream({})).toBe(false);
      expect(isMastraStream({ textStream: null })).toBe(false);
    });

    it("should return false for objects missing required properties", () => {
      expect(isMastraStream({ textStream: {} })).toBe(false);
      expect(
        isMastraStream({ textStream: {}, text: Promise.resolve("") }),
      ).toBe(false);
    });
  });

  describe("extractMastraText", () => {
    it("should extract text from stream result", async () => {
      const mockStream = createMockMastraStream(["Hello", " ", "world"]);
      (mockStream as any).text = Promise.resolve("Hello world");

      const text = await extractMastraText(mockStream as any);
      expect(text).toBe("Hello world");
    });
  });

  describe("extractMastraObject", () => {
    it("should extract object from stream result", async () => {
      const mockStream = createMockMastraStream([]);
      (mockStream as any).object = Promise.resolve({ name: "John", age: 30 });

      const obj = await extractMastraObject<{ name: string; age: number }>(
        mockStream as any,
      );
      expect(obj).toEqual({ name: "John", age: 30 });
    });
  });

  describe("Integration scenarios", () => {
    it("should handle complete conversation flow", async () => {
      const chunks = ["I", "'ll", " help", " you", " with", " that", "."];
      const mockStream = createMockMastraStream([...chunks], {
        usage: { inputTokens: 10, outputTokens: 7, totalTokens: 17 },
        finishReason: "stop",
      });

      const mockAgent = createMockAgent(mockStream);
      const factory = mastraText(mockAgent as any, "Help me");

      const stream = await factory();
      let fullText = "";
      let usage: any;

      for await (const event of stream) {
        if (event.type === "token") {
          fullText += event.value;
        }
        if (event.type === "complete" && (event as any).usage) {
          usage = (event as any).usage;
        }
      }

      expect(fullText).toBe("I'll help you with that.");
      expect(usage).toBeDefined();
      expect(usage.totalTokens).toBe(17);
    });

    it("should handle agent with tools", async () => {
      const mockStream = createMockMastraStream(["The weather is sunny."], {
        toolCalls: [
          {
            toolCallId: "call_weather",
            toolName: "get_weather",
            args: { location: "Tokyo" },
          },
        ],
        toolResults: [
          {
            toolCallId: "call_weather",
            toolName: "get_weather",
            result: { temp: 25, condition: "sunny" },
          },
        ],
      });

      const mockAgent = createMockAgent(mockStream);
      const factory = mastraStream(mockAgent as any, "What's the weather?");

      const stream = await factory();
      const events: L0Event[] = [];

      for await (const event of stream) {
        events.push(event);
      }

      const toolCallEvent = events.find(
        (e) => e.type === "message" && e.value?.includes("tool_calls"),
      );
      const toolResultEvent = events.find(
        (e) => e.type === "message" && e.value?.includes("tool_results"),
      );

      expect(toolCallEvent).toBeDefined();
      expect(toolResultEvent).toBeDefined();
    });

    it("should work with messages array", async () => {
      const mockStream = createMockMastraStream(["Response"]);
      let capturedMessages: any;

      const mockAgent = {
        stream: async (messages: any, _options?: any) => {
          capturedMessages = messages;
          return mockStream;
        },
      };

      const factory = mastraStream(mockAgent as any, [
        { role: "system" as const, content: "You are helpful." },
        { role: "user" as const, content: "Hello" },
      ]);

      const stream = await factory();
      for await (const _ of stream) {
        // Consume stream
      }

      expect(Array.isArray(capturedMessages)).toBe(true);
      expect(capturedMessages).toHaveLength(2);
    });
  });
});
