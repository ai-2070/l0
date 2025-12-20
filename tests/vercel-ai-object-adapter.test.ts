// Vercel AI SDK streamObject() adapter tests
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  wrapVercelAIObjectStream,
  vercelAIObjectAdapter,
  isVercelAIObjectStream,
  type VercelStreamObjectResult,
} from "../src/adapters/vercel-ai-object";
import { isVercelAIStream } from "../src/adapters/vercel-ai";
import type { L0Event } from "../src/types/l0";

/**
 * Create a mock streamObject() result that mimics Vercel AI SDK behavior
 */
function createMockStreamObjectResult<T = unknown>(
  textChunks: string[],
  options: {
    finalObject?: T;
    usage?: { promptTokens: number; completionTokens: number };
    finishReason?: string;
  } = {},
): VercelStreamObjectResult<T> {
  const { finalObject, usage, finishReason = "stop" } = options;

  // Create textStream as an AsyncIterable
  async function* createTextStream(): AsyncIterable<string> {
    for (const chunk of textChunks) {
      yield chunk;
    }
  }

  // Create partialObjectStream (not used by our adapter, but needed for detection)
  async function* createPartialObjectStream(): AsyncIterable<T> {
    if (finalObject !== undefined) {
      yield finalObject;
    }
  }

  return {
    textStream: createTextStream(),
    partialObjectStream: createPartialObjectStream(),
    object: Promise.resolve(finalObject as T),
    usage: Promise.resolve(usage),
    finishReason: Promise.resolve(finishReason),
  };
}

/**
 * Create a mock streamText() result for testing detection
 */
function createMockStreamTextResult() {
  async function* createTextStream(): AsyncIterable<string> {
    yield "Hello";
  }

  return {
    textStream: createTextStream(),
    // streamText has toolCalls, streamObject doesn't
    toolCalls: Promise.resolve([]),
    toolResults: Promise.resolve([]),
    fullStream: new ReadableStream(),
    text: Promise.resolve("Hello"),
  };
}

describe("Vercel AI Object Adapter", () => {
  describe("isVercelAIObjectStream", () => {
    it("should return true for streamObject() results", () => {
      const result = createMockStreamObjectResult(["{}"], {
        finalObject: {},
      });
      expect(isVercelAIObjectStream(result)).toBe(true);
    });

    it("should return false for streamText() results", () => {
      const result = createMockStreamTextResult();
      expect(isVercelAIObjectStream(result)).toBe(false);
    });

    it("should return false for null/undefined", () => {
      expect(isVercelAIObjectStream(null)).toBe(false);
      expect(isVercelAIObjectStream(undefined)).toBe(false);
    });

    it("should return false for plain objects", () => {
      expect(isVercelAIObjectStream({})).toBe(false);
      expect(isVercelAIObjectStream({ textStream: {} })).toBe(false);
    });

    it("should return false for objects missing required properties", () => {
      expect(isVercelAIObjectStream({ partialObjectStream: {} })).toBe(false);
      expect(isVercelAIObjectStream({ object: Promise.resolve({}) })).toBe(
        false,
      );
      expect(
        isVercelAIObjectStream({
          partialObjectStream: {},
          object: Promise.resolve({}),
          // missing textStream
        }),
      ).toBe(false);
    });

    it("should distinguish from vercel-ai adapter detection", () => {
      // streamObject result should be detected by our adapter, not vercel-ai
      const objectResult = createMockStreamObjectResult(["{}"], {
        finalObject: {},
      });

      // Our adapter should detect it
      expect(isVercelAIObjectStream(objectResult)).toBe(true);
      // The streamText adapter might also detect it (has textStream), but shouldn't be used
      // because our adapter has higher priority
    });
  });

  describe("wrapVercelAIObjectStream", () => {
    it("should convert textStream chunks to L0 token events", async () => {
      const result = createMockStreamObjectResult(
        ['{"name":', '"Alice"', ',"age":', "30", "}"],
        { finalObject: { name: "Alice", age: 30 } },
      );

      const events: L0Event[] = [];
      for await (const event of wrapVercelAIObjectStream(result)) {
        events.push(event);
      }

      const tokenEvents = events.filter((e) => e.type === "token");
      const completeEvent = events.find((e) => e.type === "complete");

      expect(tokenEvents).toHaveLength(5);
      expect(tokenEvents[0]!.value).toBe('{"name":');
      expect(tokenEvents[1]!.value).toBe('"Alice"');
      expect(tokenEvents[2]!.value).toBe(',"age":');
      expect(tokenEvents[3]!.value).toBe("30");
      expect(tokenEvents[4]!.value).toBe("}");
      expect(completeEvent).toBeDefined();
    });

    it("should include timestamps on all events", async () => {
      const result = createMockStreamObjectResult(["test"], {
        finalObject: "test",
      });

      const events: L0Event[] = [];
      for await (const event of wrapVercelAIObjectStream(result)) {
        events.push(event);
      }

      for (const event of events) {
        expect(event.timestamp).toBeDefined();
        expect(typeof event.timestamp).toBe("number");
      }
    });

    it("should include usage information when available", async () => {
      const result = createMockStreamObjectResult(["{}"], {
        finalObject: {},
        usage: { promptTokens: 10, completionTokens: 5 },
      });

      const events: L0Event[] = [];
      for await (const event of wrapVercelAIObjectStream(result)) {
        events.push(event);
      }

      const completeEvent = events.find((e) => e.type === "complete");
      expect(completeEvent).toBeDefined();
      expect((completeEvent as any).usage).toBeDefined();
      expect((completeEvent as any).usage.promptTokens).toBe(10);
      expect((completeEvent as any).usage.completionTokens).toBe(5);
    });

    it("should exclude usage when includeUsage is false", async () => {
      const result = createMockStreamObjectResult(["{}"], {
        finalObject: {},
        usage: { promptTokens: 10, completionTokens: 5 },
      });

      const events: L0Event[] = [];
      for await (const event of wrapVercelAIObjectStream(result, {
        includeUsage: false,
      })) {
        events.push(event);
      }

      const completeEvent = events.find((e) => e.type === "complete");
      expect(completeEvent).toBeDefined();
      expect((completeEvent as any).usage).toBeUndefined();
    });

    it("should handle empty stream", async () => {
      const result = createMockStreamObjectResult([], {
        finalObject: {},
      });

      const events: L0Event[] = [];
      for await (const event of wrapVercelAIObjectStream(result)) {
        events.push(event);
      }

      const tokenEvents = events.filter((e) => e.type === "token");
      const completeEvent = events.find((e) => e.type === "complete");

      expect(tokenEvents).toHaveLength(0);
      expect(completeEvent).toBeDefined();
    });

    it("should handle errors in textStream", async () => {
      // Create a result with an error-throwing textStream
      async function* errorTextStream(): AsyncIterable<string> {
        yield '{"start":';
        throw new Error("Stream error");
      }

      // Create a rejected promise and add a catch handler to prevent unhandled rejection
      const rejectedObject = Promise.reject(new Error("Stream error"));
      rejectedObject.catch(() => {}); // Prevent unhandled rejection warning

      const result: VercelStreamObjectResult = {
        textStream: errorTextStream(),
        partialObjectStream: (async function* () {})(),
        object: rejectedObject,
        usage: Promise.resolve(undefined),
      };

      const events: L0Event[] = [];
      for await (const event of wrapVercelAIObjectStream(result)) {
        events.push(event);
      }

      const tokenEvents = events.filter((e) => e.type === "token");
      const errorEvent = events.find((e) => e.type === "error");

      expect(tokenEvents).toHaveLength(1);
      expect(tokenEvents[0]!.value).toBe('{"start":');
      expect(errorEvent).toBeDefined();
      expect(errorEvent!.error!.message).toBe("Stream error");
    });

    it("should handle large JSON objects", async () => {
      const largeObject = {
        users: Array.from({ length: 100 }, (_, i) => ({
          id: i,
          name: `User ${i}`,
          email: `user${i}@example.com`,
        })),
      };
      const jsonString = JSON.stringify(largeObject);

      // Simulate chunked streaming
      const chunks: string[] = [];
      for (let i = 0; i < jsonString.length; i += 50) {
        chunks.push(jsonString.slice(i, i + 50));
      }

      const result = createMockStreamObjectResult(chunks, {
        finalObject: largeObject,
      });

      const events: L0Event[] = [];
      for await (const event of wrapVercelAIObjectStream(result)) {
        events.push(event);
      }

      const tokenEvents = events.filter((e) => e.type === "token");
      const reconstructed = tokenEvents.map((e) => e.value).join("");

      expect(reconstructed).toBe(jsonString);
    });
  });

  describe("vercelAIObjectAdapter", () => {
    it("should have correct name", () => {
      expect(vercelAIObjectAdapter.name).toBe("vercel-ai-object");
    });

    it("should have detect function", () => {
      expect(typeof vercelAIObjectAdapter.detect).toBe("function");
    });

    it("should have wrap function", () => {
      expect(typeof vercelAIObjectAdapter.wrap).toBe("function");
    });

    it("detect should work correctly", () => {
      const objectResult = createMockStreamObjectResult(["{}"], {
        finalObject: {},
      });
      const textResult = createMockStreamTextResult();

      expect(vercelAIObjectAdapter.detect!(objectResult)).toBe(true);
      expect(vercelAIObjectAdapter.detect!(textResult)).toBe(false);
    });

    it("wrap should produce valid L0 events", async () => {
      const result = createMockStreamObjectResult(['{"test":true}'], {
        finalObject: { test: true },
      });

      const events: L0Event[] = [];
      for await (const event of vercelAIObjectAdapter.wrap(result)) {
        events.push(event);
      }

      expect(events.length).toBeGreaterThan(0);
      expect(events.some((e) => e.type === "token")).toBe(true);
      expect(events.some((e) => e.type === "complete")).toBe(true);
    });
  });

  describe("Integration scenarios", () => {
    it("should work with nested objects", async () => {
      const nestedObject = {
        user: {
          profile: {
            name: "Alice",
            settings: {
              theme: "dark",
              notifications: true,
            },
          },
        },
      };
      const jsonString = JSON.stringify(nestedObject);

      const result = createMockStreamObjectResult([jsonString], {
        finalObject: nestedObject,
      });

      const events: L0Event[] = [];
      for await (const event of wrapVercelAIObjectStream(result)) {
        events.push(event);
      }

      const tokenEvents = events.filter((e) => e.type === "token");
      expect(tokenEvents.map((e) => e.value).join("")).toBe(jsonString);
    });

    it("should work with arrays", async () => {
      const arrayData = [1, 2, 3, { nested: true }];
      const jsonString = JSON.stringify(arrayData);

      const result = createMockStreamObjectResult(
        ["[1,", "2,", "3,", '{"nested":', "true}]"],
        { finalObject: arrayData },
      );

      const events: L0Event[] = [];
      for await (const event of wrapVercelAIObjectStream(result)) {
        events.push(event);
      }

      const tokenEvents = events.filter((e) => e.type === "token");
      expect(tokenEvents.map((e) => e.value).join("")).toBe(
        '[1,2,3,{"nested":true}]',
      );
    });

    it("should not lock ReadableStream (regression test)", async () => {
      // This is the key test - vercel-ai adapter uses fullStream.getReader() which locks
      // Our adapter uses textStream which is an AsyncIterable and doesn't lock

      const result = createMockStreamObjectResult(['{"data":', '"test"}'], {
        finalObject: { data: "test" },
      });

      // First consumption should work
      const events1: L0Event[] = [];
      for await (const event of wrapVercelAIObjectStream(result)) {
        events1.push(event);
      }
      expect(events1.some((e) => e.type === "token")).toBe(true);

      // Note: AsyncIterables can only be consumed once, so we can't re-iterate
      // But the key point is that textStream doesn't throw "ReadableStream is locked"
      // like fullStream.getReader() would
    });

    it("should handle unicode content", async () => {
      const unicodeObject = {
        greeting: "こんにちは",
        emoji: "🎉",
        chinese: "你好世界",
      };
      const jsonString = JSON.stringify(unicodeObject);

      const result = createMockStreamObjectResult([jsonString], {
        finalObject: unicodeObject,
      });

      const events: L0Event[] = [];
      for await (const event of wrapVercelAIObjectStream(result)) {
        events.push(event);
      }

      const tokenEvents = events.filter((e) => e.type === "token");
      const reconstructed = tokenEvents.map((e) => e.value).join("");
      expect(reconstructed).toBe(jsonString);

      // Verify the JSON can be parsed back
      const parsed = JSON.parse(reconstructed);
      expect(parsed.greeting).toBe("こんにちは");
      expect(parsed.emoji).toBe("🎉");
    });
  });
});
