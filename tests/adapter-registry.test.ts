// Adapter registry tests (BYOA - Bring Your Own Adapter)
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  registerAdapter,
  unregisterAdapter,
  getAdapter,
  getRegisteredStreamAdapters,
  clearAdapters,
  detectAdapter,
  hasMatchingAdapter,
} from "../src/adapters/registry";
import type { L0Adapter, L0Event } from "../src/types/l0";

// Mock stream types for testing
interface MockStreamA {
  __brand: "streamA";
  data: AsyncIterable<string>;
}

interface MockStreamB {
  __brand: "streamB";
  chunks: AsyncIterable<{ text: string }>;
}

// Helper to create mock streams
function createMockStreamA(texts: string[]): MockStreamA {
  return {
    __brand: "streamA",
    data: (async function* () {
      for (const text of texts) {
        yield text;
      }
    })(),
  };
}

function createMockStreamB(texts: string[]): MockStreamB {
  return {
    __brand: "streamB",
    chunks: (async function* () {
      for (const text of texts) {
        yield { text };
      }
    })(),
  };
}

// Mock adapters for testing
function createAdapterA(): L0Adapter<MockStreamA> {
  return {
    name: "adapter-a",
    detect(input): input is MockStreamA {
      return (
        input !== null &&
        typeof input === "object" &&
        (input as any).__brand === "streamA"
      );
    },
    async *wrap(stream) {
      for await (const text of stream.data) {
        yield { type: "token", value: text, timestamp: Date.now() };
      }
      yield { type: "complete", timestamp: Date.now() };
    },
  };
}

function createAdapterB(): L0Adapter<MockStreamB> {
  return {
    name: "adapter-b",
    detect(input): input is MockStreamB {
      return (
        input !== null &&
        typeof input === "object" &&
        (input as any).__brand === "streamB"
      );
    },
    async *wrap(stream) {
      for await (const chunk of stream.chunks) {
        yield { type: "token", value: chunk.text, timestamp: Date.now() };
      }
      yield { type: "complete", timestamp: Date.now() };
    },
  };
}

function createAdapterWithoutDetect(): L0Adapter<MockStreamA> {
  return {
    name: "adapter-no-detect",
    async *wrap(stream) {
      for await (const text of stream.data) {
        yield { type: "token", value: text, timestamp: Date.now() };
      }
      yield { type: "complete", timestamp: Date.now() };
    },
  };
}

describe("Adapter Registry", () => {
  beforeEach(() => {
    clearAdapters();
  });

  afterEach(() => {
    clearAdapters();
  });

  describe("registerAdapter", () => {
    it("should register an adapter with detect()", () => {
      const adapter = createAdapterA();
      registerAdapter(adapter);

      expect(getRegisteredStreamAdapters()).toContain("adapter-a");
    });

    it("should allow registering adapter without detect() with warning", () => {
      const adapter = createAdapterWithoutDetect();
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      registerAdapter(adapter);

      expect(getRegisteredStreamAdapters()).toContain("adapter-no-detect");
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining(
          'Adapter "adapter-no-detect" has no detect() method',
        ),
      );

      warnSpy.mockRestore();
    });

    it("should suppress warning with silent option", () => {
      const adapter = createAdapterWithoutDetect();
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      registerAdapter(adapter, { silent: true });

      expect(getRegisteredStreamAdapters()).toContain("adapter-no-detect");
      expect(warnSpy).not.toHaveBeenCalled();

      warnSpy.mockRestore();
    });

    it("should throw when registering duplicate adapter name", () => {
      const adapter1 = createAdapterA();
      const adapter2 = createAdapterA();

      registerAdapter(adapter1);

      expect(() => registerAdapter(adapter2)).toThrow(
        'Adapter "adapter-a" is already registered',
      );
    });

    it("should register multiple different adapters", () => {
      registerAdapter(createAdapterA());
      registerAdapter(createAdapterB());

      const registered = getRegisteredStreamAdapters();
      expect(registered).toContain("adapter-a");
      expect(registered).toContain("adapter-b");
      expect(registered).toHaveLength(2);
    });
  });

  describe("unregisterAdapter", () => {
    it("should unregister an existing adapter", () => {
      registerAdapter(createAdapterA());
      expect(getRegisteredStreamAdapters()).toContain("adapter-a");

      const result = unregisterAdapter("adapter-a");

      expect(result).toBe(true);
      expect(getRegisteredStreamAdapters()).not.toContain("adapter-a");
    });

    it("should return false for non-existent adapter", () => {
      const result = unregisterAdapter("non-existent");
      expect(result).toBe(false);
    });

    it("should allow re-registering after unregister", () => {
      const adapter = createAdapterA();
      registerAdapter(adapter);
      unregisterAdapter("adapter-a");
      registerAdapter(adapter);

      expect(getRegisteredStreamAdapters()).toContain("adapter-a");
    });
  });

  describe("getAdapter", () => {
    it("should return adapter by name", () => {
      const adapter = createAdapterA();
      registerAdapter(adapter);

      const found = getAdapter("adapter-a");
      expect(found).toBe(adapter);
    });

    it("should return undefined for non-existent adapter", () => {
      const found = getAdapter("non-existent");
      expect(found).toBeUndefined();
    });
  });

  describe("getRegisteredStreamAdapters", () => {
    it("should return empty array when no adapters registered", () => {
      expect(getRegisteredStreamAdapters()).toEqual([]);
    });

    it("should return all registered adapter names", () => {
      registerAdapter(createAdapterA());
      registerAdapter(createAdapterB());

      const names = getRegisteredStreamAdapters();
      expect(names).toEqual(["adapter-a", "adapter-b"]);
    });

    it("should preserve registration order", () => {
      registerAdapter(createAdapterB());
      registerAdapter(createAdapterA());

      const names = getRegisteredStreamAdapters();
      expect(names).toEqual(["adapter-b", "adapter-a"]);
    });
  });

  describe("clearAdapters", () => {
    it("should remove all registered adapters", () => {
      registerAdapter(createAdapterA());
      registerAdapter(createAdapterB());

      clearAdapters();

      expect(getRegisteredStreamAdapters()).toEqual([]);
    });
  });

  describe("detectAdapter", () => {
    it("should detect correct adapter for stream type", () => {
      registerAdapter(createAdapterA());
      registerAdapter(createAdapterB());

      const streamA = createMockStreamA(["hello"]);
      const streamB = createMockStreamB(["world"]);

      const detectedA = detectAdapter(streamA);
      const detectedB = detectAdapter(streamB);

      expect(detectedA.name).toBe("adapter-a");
      expect(detectedB.name).toBe("adapter-b");
    });

    it("should throw when no adapter matches", () => {
      registerAdapter(createAdapterA());

      const unknownStream = { unknown: true };

      expect(() => detectAdapter(unknownStream)).toThrow(
        "No registered adapter detected for stream",
      );
    });

    it("should throw when multiple adapters match", () => {
      // Create two adapters that both detect the same stream type
      const adapter1: L0Adapter<MockStreamA> = {
        name: "ambiguous-1",
        detect: (input): input is MockStreamA =>
          (input as any)?.__brand === "streamA",
        async *wrap() {
          yield { type: "complete", timestamp: Date.now() };
        },
      };
      const adapter2: L0Adapter<MockStreamA> = {
        name: "ambiguous-2",
        detect: (input): input is MockStreamA =>
          (input as any)?.__brand === "streamA",
        async *wrap() {
          yield { type: "complete", timestamp: Date.now() };
        },
      };

      registerAdapter(adapter1);
      registerAdapter(adapter2);

      const stream = createMockStreamA(["test"]);

      expect(() => detectAdapter(stream)).toThrow(
        "Multiple adapters detected for stream",
      );
      expect(() => detectAdapter(stream)).toThrow("ambiguous-1");
      expect(() => detectAdapter(stream)).toThrow("ambiguous-2");
    });

    it("should skip adapters without detect()", () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      registerAdapter(createAdapterWithoutDetect(), { silent: true });
      registerAdapter(createAdapterA());

      const stream = createMockStreamA(["test"]);
      const detected = detectAdapter(stream);

      expect(detected.name).toBe("adapter-a");

      warnSpy.mockRestore();
    });

    it("should report skipped adapters in error message", () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      registerAdapter(createAdapterWithoutDetect(), { silent: true });

      const unknownStream = { unknown: true };

      expect(() => detectAdapter(unknownStream)).toThrow(
        "1 adapter(s) without detect() were skipped",
      );

      warnSpy.mockRestore();
    });

    it("should provide helpful error message with no adapters", () => {
      expect(() => detectAdapter({ test: true })).toThrow(
        "Detectable adapters: (none)",
      );
    });
  });

  describe("hasMatchingAdapter", () => {
    it("should return true when exactly one adapter matches", () => {
      registerAdapter(createAdapterA());
      registerAdapter(createAdapterB());

      const stream = createMockStreamA(["test"]);
      expect(hasMatchingAdapter(stream)).toBe(true);
    });

    it("should return false when no adapter matches", () => {
      registerAdapter(createAdapterA());

      const unknownStream = { unknown: true };
      expect(hasMatchingAdapter(unknownStream)).toBe(false);
    });

    it("should return false when multiple adapters match", () => {
      const adapter1: L0Adapter<unknown> = {
        name: "dup-1",
        detect: (input): input is unknown => true,
        async *wrap() {
          yield { type: "complete", timestamp: Date.now() };
        },
      };
      const adapter2: L0Adapter<unknown> = {
        name: "dup-2",
        detect: (input): input is unknown => true,
        async *wrap() {
          yield { type: "complete", timestamp: Date.now() };
        },
      };

      registerAdapter(adapter1);
      registerAdapter(adapter2);

      expect(hasMatchingAdapter({ any: "stream" })).toBe(false);
    });

    it("should skip adapters without detect()", () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      registerAdapter(createAdapterWithoutDetect(), { silent: true });

      const stream = createMockStreamA(["test"]);
      expect(hasMatchingAdapter(stream)).toBe(false);

      warnSpy.mockRestore();
    });
  });

  describe("Adapter wrap() functionality", () => {
    it("should correctly wrap stream to L0 events", async () => {
      registerAdapter(createAdapterA());

      const stream = createMockStreamA(["Hello", " ", "World"]);
      const adapter = detectAdapter(stream);
      const events: L0Event[] = [];

      for await (const event of adapter.wrap(stream)) {
        events.push(event);
      }

      const tokens = events.filter((e) => e.type === "token");
      const doneEvents = events.filter((e) => e.type === "complete");

      expect(tokens).toHaveLength(3);
      expect(tokens[0]!.value).toBe("Hello");
      expect(tokens[1]!.value).toBe(" ");
      expect(tokens[2]!.value).toBe("World");
      expect(doneEvents).toHaveLength(1);
    });

    it("should include timestamps on all events", async () => {
      registerAdapter(createAdapterA());

      const stream = createMockStreamA(["test"]);
      const adapter = detectAdapter(stream);
      const events: L0Event[] = [];

      for await (const event of adapter.wrap(stream)) {
        events.push(event);
      }

      for (const event of events) {
        expect(event.timestamp).toBeDefined();
        expect(typeof event.timestamp).toBe("number");
        expect(event.timestamp).toBeGreaterThan(0);
      }
    });
  });

  describe("edge cases", () => {
    it("should handle detect() returning false for null input", () => {
      registerAdapter(createAdapterA());

      expect(hasMatchingAdapter(null)).toBe(false);
      expect(() => detectAdapter(null)).toThrow(
        "No registered adapter detected for stream",
      );
    });

    it("should handle detect() returning false for undefined input", () => {
      registerAdapter(createAdapterA());

      expect(hasMatchingAdapter(undefined)).toBe(false);
      expect(() => detectAdapter(undefined)).toThrow(
        "No registered adapter detected for stream",
      );
    });

    it("should handle detect() that throws an error gracefully", () => {
      const throwingAdapter: L0Adapter<unknown> = {
        name: "throwing-adapter",
        detect(_input): _input is unknown {
          throw new Error("Detection error");
        },
        async *wrap() {
          yield { type: "complete", timestamp: Date.now() };
        },
      };

      registerAdapter(throwingAdapter);

      // detect() throwing should propagate the error
      expect(() => detectAdapter({ test: true })).toThrow("Detection error");
    });

    it("should use first matching adapter when registration order matters", () => {
      // Create two adapters where both could match but have different detection logic
      const broadAdapter: L0Adapter<{ data: string }> = {
        name: "broad-adapter",
        detect(input): input is { data: string } {
          return (
            !!input && typeof input === "object" && "data" in (input as object)
          );
        },
        async *wrap() {
          yield { type: "token", value: "broad", timestamp: Date.now() };
          yield { type: "complete", timestamp: Date.now() };
        },
      };

      const specificAdapter: L0Adapter<{ data: string; specific: true }> = {
        name: "specific-adapter",
        detect(input): input is { data: string; specific: true } {
          return (
            !!input &&
            typeof input === "object" &&
            "data" in (input as object) &&
            "specific" in (input as object)
          );
        },
        async *wrap() {
          yield { type: "token", value: "specific", timestamp: Date.now() };
          yield { type: "complete", timestamp: Date.now() };
        },
      };

      // Register specific first, then broad
      registerAdapter(specificAdapter);
      registerAdapter(broadAdapter);

      // Input that matches both - should match specific (registered first)
      const inputBoth = { data: "test", specific: true as const };

      // Both adapters match, so should throw ambiguity error
      expect(() => detectAdapter(inputBoth)).toThrow(
        "Multiple adapters detected for stream",
      );

      // Input that only matches broad
      const inputBroad = { data: "test" };
      const detected = detectAdapter(inputBroad);
      expect(detected.name).toBe("broad-adapter");
    });

    it("should handle primitive inputs to detect functions", () => {
      registerAdapter(createAdapterA());

      expect(hasMatchingAdapter("string")).toBe(false);
      expect(hasMatchingAdapter(123)).toBe(false);
      expect(hasMatchingAdapter(true)).toBe(false);
      expect(hasMatchingAdapter(Symbol("test"))).toBe(false);
    });

    it("should handle array inputs to detect functions", () => {
      registerAdapter(createAdapterA());

      expect(hasMatchingAdapter([])).toBe(false);
      expect(hasMatchingAdapter([1, 2, 3])).toBe(false);
    });

    it("should list all matching adapter names in ambiguity error", () => {
      const adapter1: L0Adapter<object> = {
        name: "match-1",
        detect: (input): input is object =>
          typeof input === "object" && input !== null,
        async *wrap() {
          yield { type: "complete", timestamp: Date.now() };
        },
      };
      const adapter2: L0Adapter<object> = {
        name: "match-2",
        detect: (input): input is object =>
          typeof input === "object" && input !== null,
        async *wrap() {
          yield { type: "complete", timestamp: Date.now() };
        },
      };
      const adapter3: L0Adapter<object> = {
        name: "match-3",
        detect: (input): input is object =>
          typeof input === "object" && input !== null,
        async *wrap() {
          yield { type: "complete", timestamp: Date.now() };
        },
      };

      registerAdapter(adapter1);
      registerAdapter(adapter2);
      registerAdapter(adapter3);

      try {
        detectAdapter({ test: true });
        expect.fail("Should have thrown");
      } catch (error) {
        const message = (error as Error).message;
        expect(message).toContain("match-1");
        expect(message).toContain("match-2");
        expect(message).toContain("match-3");
      }
    });
  });
});
