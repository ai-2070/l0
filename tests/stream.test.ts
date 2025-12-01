import { describe, it, expect, vi } from "vitest";
import {
  StreamNormalizer,
  createStreamNormalizer,
  normalizeStreamWithTimeout,
  bufferStream,
  mapStream,
  filterStream,
  takeStream,
  collectStream,
  consumeStream,
  passthroughStream,
  tapStream,
  mergeStreams,
  streamFromArray,
  debounceStream,
} from "../src/runtime/stream";
import type { L0Event } from "../src/types/l0";

// Helper to create async generator from array
async function* asyncGen<T>(items: T[]): AsyncGenerator<T> {
  for (const item of items) {
    yield item;
  }
}

describe("Stream Utilities", () => {
  describe("StreamNormalizer", () => {
    it("should create initial state", () => {
      const normalizer = new StreamNormalizer();
      const state = normalizer.getState();

      expect(state.started).toBe(false);
      expect(state.firstTokenReceived).toBe(false);
      expect(state.tokenCount).toBe(0);
      expect(state.complete).toBe(false);
      expect(state.aborted).toBe(false);
    });

    it("should normalize token events", async () => {
      const normalizer = new StreamNormalizer();
      const chunks = [
        { type: "token", value: "Hello" },
        { type: "token", value: " " },
        { type: "token", value: "World" },
        { type: "complete" },
      ];

      const events: L0Event[] = [];
      for await (const event of normalizer.normalize(asyncGen(chunks))) {
        events.push(event);
      }

      expect(events).toHaveLength(4);
      expect(normalizer.getAccumulated()).toBe("Hello World");
      expect(normalizer.getState().tokenCount).toBe(3);
      expect(normalizer.getState().complete).toBe(true);
    });

    it("should track first token time", async () => {
      const normalizer = new StreamNormalizer();
      const chunks = [{ type: "token", value: "test" }];

      for await (const _ of normalizer.normalize(asyncGen(chunks))) {
        // consume
      }

      const state = normalizer.getState();
      expect(state.firstTokenReceived).toBe(true);
      expect(state.firstTokenTime).toBeDefined();
    });

    it("should create checkpoints periodically", async () => {
      const normalizer = new StreamNormalizer({ checkpointInterval: 2 });
      const chunks = [
        { type: "token", value: "a" },
        { type: "token", value: "b" },
        { type: "token", value: "c" },
        { type: "token", value: "d" },
      ];

      for await (const _ of normalizer.normalize(asyncGen(chunks))) {
        // consume
      }

      expect(normalizer.getCheckpoint()).toBe("abcd");
    });

    it("should handle abort signal", async () => {
      const normalizer = new StreamNormalizer();
      const controller = new AbortController();
      const chunks = [
        { type: "token", value: "a" },
        { type: "token", value: "b" },
      ];

      controller.abort();

      await expect(async () => {
        for await (const _ of normalizer.normalize(
          asyncGen(chunks),
          controller.signal,
        )) {
          // consume
        }
      }).rejects.toThrow("Stream aborted");

      expect(normalizer.getState().aborted).toBe(true);
    });

    it("should handle error events", async () => {
      const normalizer = new StreamNormalizer();
      const error = new Error("Test error");
      const chunks = [{ type: "error", error }];

      await expect(async () => {
        for await (const _ of normalizer.normalize(asyncGen(chunks))) {
          // consume
        }
      }).rejects.toThrow("Test error");
    });

    it("should reset state", async () => {
      const normalizer = new StreamNormalizer();
      const chunks = [{ type: "token", value: "test" }];

      for await (const _ of normalizer.normalize(asyncGen(chunks))) {
        // consume
      }

      normalizer.reset();

      expect(normalizer.getAccumulated()).toBe("");
      expect(normalizer.getCheckpoint()).toBe("");
      expect(normalizer.getState().tokenCount).toBe(0);
    });
  });

  describe("createStreamNormalizer", () => {
    it("should create a new normalizer instance", () => {
      const normalizer = createStreamNormalizer();
      expect(normalizer).toBeInstanceOf(StreamNormalizer);
    });

    it("should accept options", () => {
      const normalizer = createStreamNormalizer({ checkpointInterval: 5 });
      expect(normalizer).toBeInstanceOf(StreamNormalizer);
    });
  });

  describe("bufferStream", () => {
    it("should buffer events into batches", async () => {
      const events: L0Event[] = [
        { type: "token", value: "a" },
        { type: "token", value: "b" },
        { type: "token", value: "c" },
        { type: "complete" },
      ];

      const batches: L0Event[][] = [];
      for await (const batch of bufferStream(asyncGen(events), 2)) {
        batches.push(batch);
      }

      expect(batches).toHaveLength(2);
      expect(batches[0]).toHaveLength(2);
    });

    it("should flush on complete event", async () => {
      const events: L0Event[] = [
        { type: "token", value: "a" },
        { type: "complete" },
      ];

      const batches: L0Event[][] = [];
      for await (const batch of bufferStream(asyncGen(events), 10)) {
        batches.push(batch);
      }

      expect(batches).toHaveLength(1);
      expect(batches[0]).toHaveLength(2);
    });
  });

  describe("mapStream", () => {
    it("should transform events", async () => {
      const events: L0Event[] = [
        { type: "token", value: "hello" },
        { type: "token", value: "world" },
      ];

      const mapped: string[] = [];
      for await (const value of mapStream(asyncGen(events), (e) =>
        e.type === "token" ? e.value?.toUpperCase() : "",
      )) {
        mapped.push(value as string);
      }

      expect(mapped).toEqual(["HELLO", "WORLD"]);
    });
  });

  describe("filterStream", () => {
    it("should filter events", async () => {
      const events: L0Event[] = [
        { type: "token", value: "a" },
        { type: "complete" },
        { type: "token", value: "b" },
      ];

      const filtered: L0Event[] = [];
      for await (const event of filterStream(
        asyncGen(events),
        (e) => e.type === "token",
      )) {
        filtered.push(event);
      }

      expect(filtered).toHaveLength(2);
      expect(filtered.every((e) => e.type === "token")).toBe(true);
    });
  });

  describe("takeStream", () => {
    it("should take first N events", async () => {
      const events: L0Event[] = [
        { type: "token", value: "a" },
        { type: "token", value: "b" },
        { type: "token", value: "c" },
        { type: "token", value: "d" },
      ];

      const taken: L0Event[] = [];
      for await (const event of takeStream(asyncGen(events), 2)) {
        taken.push(event);
      }

      expect(taken).toHaveLength(2);
    });

    it("should handle streams shorter than count", async () => {
      const events: L0Event[] = [{ type: "token", value: "a" }];

      const taken: L0Event[] = [];
      for await (const event of takeStream(asyncGen(events), 10)) {
        taken.push(event);
      }

      expect(taken).toHaveLength(1);
    });
  });

  describe("collectStream", () => {
    it("should collect all events into array", async () => {
      const events: L0Event[] = [
        { type: "token", value: "a" },
        { type: "token", value: "b" },
        { type: "complete" },
      ];

      const collected = await collectStream(asyncGen(events));

      expect(collected).toHaveLength(3);
      expect(collected).toEqual(events);
    });
  });

  describe("consumeStream", () => {
    it("should return accumulated text", async () => {
      const events: L0Event[] = [
        { type: "token", value: "Hello" },
        { type: "token", value: " " },
        { type: "token", value: "World" },
        { type: "complete" },
      ];

      const text = await consumeStream(asyncGen(events));

      expect(text).toBe("Hello World");
    });

    it("should handle events without value", async () => {
      const events: L0Event[] = [
        { type: "token", value: "test" },
        { type: "complete" },
      ];

      const text = await consumeStream(asyncGen(events));

      expect(text).toBe("test");
    });
  });

  describe("passthroughStream", () => {
    it("should pass events unchanged", async () => {
      const events: L0Event[] = [
        { type: "token", value: "a" },
        { type: "complete" },
      ];

      const passed: L0Event[] = [];
      for await (const event of passthroughStream(asyncGen(events))) {
        passed.push(event);
      }

      expect(passed).toEqual(events);
    });
  });

  describe("tapStream", () => {
    it("should call callback for each event", async () => {
      const events: L0Event[] = [
        { type: "token", value: "a" },
        { type: "token", value: "b" },
      ];

      const callback = vi.fn();
      const tapped: L0Event[] = [];

      for await (const event of tapStream(asyncGen(events), callback)) {
        tapped.push(event);
      }

      expect(callback).toHaveBeenCalledTimes(2);
      expect(tapped).toEqual(events);
    });
  });

  describe("mergeStreams", () => {
    it("should merge multiple streams sequentially", async () => {
      const stream1: L0Event[] = [{ type: "token", value: "a" }];
      const stream2: L0Event[] = [{ type: "token", value: "b" }];

      const merged: L0Event[] = [];
      for await (const event of mergeStreams(
        asyncGen(stream1),
        asyncGen(stream2),
      )) {
        merged.push(event);
      }

      expect(merged).toHaveLength(2);
      expect(merged[0]!.type === "token" && merged[0]!.value).toBe("a");
      expect(merged[1]!.type === "token" && merged[1]!.value).toBe("b");
    });
  });

  describe("streamFromArray", () => {
    it("should create stream from array", async () => {
      const events: L0Event[] = [
        { type: "token", value: "test" },
        { type: "complete" },
      ];

      const streamed: L0Event[] = [];
      for await (const event of streamFromArray(events)) {
        streamed.push(event);
      }

      expect(streamed).toEqual(events);
    });
  });

  describe("normalizeStreamWithTimeout", () => {
    it("should normalize stream events", async () => {
      const chunks = [
        { type: "token", value: "Hello" },
        { type: "token", value: " World" },
        { type: "complete" },
      ];

      const events: L0Event[] = [];
      for await (const event of normalizeStreamWithTimeout(asyncGen(chunks))) {
        events.push(event);
      }

      expect(events).toHaveLength(3);
      expect(events[0]!.type).toBe("token");
      expect(events[2]!.type).toBe("complete");
    });

    it("should handle abort signal", async () => {
      const controller = new AbortController();
      const chunks = [
        { type: "token", value: "a" },
        { type: "token", value: "b" },
      ];

      controller.abort();

      await expect(async () => {
        for await (const _ of normalizeStreamWithTimeout(asyncGen(chunks), {
          signal: controller.signal,
        })) {
          // consume
        }
      }).rejects.toThrow("Stream aborted");
    });

    it("should use custom timeout values", async () => {
      const chunks = [{ type: "token", value: "test" }, { type: "complete" }];

      const events: L0Event[] = [];
      for await (const event of normalizeStreamWithTimeout(asyncGen(chunks), {
        initialTimeout: 5000,
        interTokenTimeout: 10000,
      })) {
        events.push(event);
      }

      expect(events).toHaveLength(2);
    });

    it("should handle zero initial timeout (disabled)", async () => {
      const chunks = [{ type: "token", value: "test" }, { type: "complete" }];

      const events: L0Event[] = [];
      for await (const event of normalizeStreamWithTimeout(asyncGen(chunks), {
        initialTimeout: 0,
      })) {
        events.push(event);
      }

      expect(events).toHaveLength(2);
    });
  });

  describe("debounceStream", () => {
    it("should debounce stream events", async () => {
      vi.useFakeTimers();

      const events: L0Event[] = [
        { type: "token", value: "a" },
        { type: "token", value: "b" },
        { type: "complete" },
      ];

      const debounced: L0Event[] = [];
      const generator = debounceStream(asyncGen(events), 10);

      // Process all events with fake timers
      const processPromise = (async () => {
        for await (const event of generator) {
          debounced.push(event);
        }
      })();

      // Advance timers to process all debounced events
      await vi.runAllTimersAsync();
      await processPromise;

      // All events should eventually be yielded
      expect(debounced.length).toBeGreaterThan(0);

      vi.useRealTimers();
    });

    it("should handle empty stream", async () => {
      const events: L0Event[] = [];

      const debounced: L0Event[] = [];
      for await (const event of debounceStream(asyncGen(events), 10)) {
        debounced.push(event);
      }

      expect(debounced).toHaveLength(0);
    });

    it("should handle single event", async () => {
      vi.useFakeTimers();

      const events: L0Event[] = [{ type: "token", value: "single" }];

      const debounced: L0Event[] = [];
      const generator = debounceStream(asyncGen(events), 10);

      const processPromise = (async () => {
        for await (const event of generator) {
          debounced.push(event);
        }
      })();

      await vi.runAllTimersAsync();
      await processPromise;

      expect(debounced).toHaveLength(1);
      expect(debounced[0]!.type === "token" && debounced[0]!.value).toBe(
        "single",
      );

      vi.useRealTimers();
    });
  });
});
