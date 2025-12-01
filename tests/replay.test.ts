import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  replay,
  compareReplays,
  getStreamMetadata,
} from "../src/runtime/replay";
import type { L0EventStore, L0EventEnvelope } from "../src/types/events";
import type { L0State, L0Event } from "../src/types/l0";

// Mock event store
function createMockEventStore(
  events: L0EventEnvelope[] = [],
  exists: boolean = true,
): L0EventStore {
  return {
    exists: vi.fn().mockResolvedValue(exists),
    getEvents: vi.fn().mockResolvedValue(events),
    getLastEvent: vi
      .fn()
      .mockResolvedValue(events.length > 0 ? events[events.length - 1] : null),
    getEventsAfter: vi.fn().mockResolvedValue(events),
    append: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn().mockResolvedValue(undefined),
    listStreams: vi.fn().mockResolvedValue([]),
  };
}

// Helper to create event envelopes
function createEnvelope(
  seq: number,
  event: any,
  ts: number = Date.now(),
): L0EventEnvelope {
  return {
    streamId: "test-stream",
    seq,
    event: { ...event, ts },
  };
}

describe("Replay Runtime", () => {
  describe("replay", () => {
    it("should throw if stream does not exist", async () => {
      const store = createMockEventStore([], false);

      await expect(
        replay({ streamId: "nonexistent", eventStore: store }),
      ).rejects.toThrow("Stream not found");
    });

    it("should throw if stream has no events", async () => {
      const store = createMockEventStore([], true);

      await expect(
        replay({ streamId: "empty", eventStore: store }),
      ).rejects.toThrow("Stream has no events");
    });

    it("should replay token events", async () => {
      const events = [
        createEnvelope(0, { type: "START", options: {} }),
        createEnvelope(1, { type: "TOKEN", value: "Hello", index: 0 }),
        createEnvelope(2, { type: "TOKEN", value: " ", index: 1 }),
        createEnvelope(3, { type: "TOKEN", value: "World", index: 2 }),
        createEnvelope(4, {
          type: "COMPLETE",
          content: "Hello World",
          tokenCount: 3,
        }),
      ];

      const store = createMockEventStore(events);
      const result = await replay({ streamId: "test", eventStore: store });

      const replayedEvents: L0Event[] = [];
      for await (const event of result.stream) {
        replayedEvents.push(event);
      }

      expect(replayedEvents).toHaveLength(4); // 3 tokens + 1 complete
      expect(result.state.content).toBe("Hello World");
      expect(result.state.tokenCount).toBe(3);
      expect(result.isReplay).toBe(true);
    });

    it("should fire callbacks when enabled", async () => {
      const events = [
        createEnvelope(0, { type: "START", options: {} }),
        createEnvelope(1, { type: "TOKEN", value: "test", index: 0 }),
        createEnvelope(2, { type: "COMPLETE", content: "test", tokenCount: 1 }),
      ];

      const store = createMockEventStore(events);
      const result = await replay({
        streamId: "test",
        eventStore: store,
        fireCallbacks: true,
      });

      const onToken = vi.fn();
      const onEvent = vi.fn();
      result.setCallbacks({ onToken, onEvent });

      for await (const _ of result.stream) {
        // consume
      }

      expect(onToken).toHaveBeenCalledWith("test");
      expect(onEvent).toHaveBeenCalled();
    });

    it("should not fire callbacks when disabled", async () => {
      const events = [
        createEnvelope(0, { type: "START", options: {} }),
        createEnvelope(1, { type: "TOKEN", value: "test", index: 0 }),
        createEnvelope(2, { type: "COMPLETE", content: "test", tokenCount: 1 }),
      ];

      const store = createMockEventStore(events);
      const result = await replay({
        streamId: "test",
        eventStore: store,
        fireCallbacks: false,
      });

      const onToken = vi.fn();
      result.setCallbacks({ onToken });

      for await (const _ of result.stream) {
        // consume
      }

      expect(onToken).not.toHaveBeenCalled();
    });

    it("should handle checkpoint events", async () => {
      const events = [
        createEnvelope(0, { type: "START", options: {} }),
        createEnvelope(1, { type: "CHECKPOINT", content: "checkpoint-data" }),
        createEnvelope(2, { type: "COMPLETE", content: "", tokenCount: 0 }),
      ];

      const store = createMockEventStore(events);
      const result = await replay({ streamId: "test", eventStore: store });

      for await (const _ of result.stream) {
        // consume
      }

      expect(result.state.checkpoint).toBe("checkpoint-data");
    });

    it("should handle guardrail events", async () => {
      const violations = [{ rule: "test", message: "violation" }];
      const events = [
        createEnvelope(0, { type: "START", options: {} }),
        createEnvelope(1, { type: "GUARDRAIL", result: { violations } }),
        createEnvelope(2, { type: "COMPLETE", content: "", tokenCount: 0 }),
      ];

      const store = createMockEventStore(events);
      const result = await replay({
        streamId: "test",
        eventStore: store,
        fireCallbacks: true,
      });

      const onViolation = vi.fn();
      result.setCallbacks({ onViolation });

      for await (const _ of result.stream) {
        // consume
      }

      expect(result.state.violations).toHaveLength(1);
      expect(onViolation).toHaveBeenCalled();
    });

    it("should handle drift events", async () => {
      const events = [
        createEnvelope(0, { type: "START", options: {} }),
        createEnvelope(1, {
          type: "DRIFT",
          result: { detected: true, types: ["repetition"] },
        }),
        createEnvelope(2, { type: "COMPLETE", content: "", tokenCount: 0 }),
      ];

      const store = createMockEventStore(events);
      const result = await replay({ streamId: "test", eventStore: store });

      for await (const _ of result.stream) {
        // consume
      }

      expect(result.state.driftDetected).toBe(true);
    });

    it("should handle retry events", async () => {
      const events = [
        createEnvelope(0, { type: "START", options: {} }),
        createEnvelope(1, {
          type: "RETRY",
          attempt: 1,
          reason: "rate_limit",
          countsTowardLimit: true,
        }),
        createEnvelope(2, {
          type: "RETRY",
          attempt: 2,
          reason: "network",
          countsTowardLimit: false,
        }),
        createEnvelope(3, { type: "COMPLETE", content: "", tokenCount: 0 }),
      ];

      const store = createMockEventStore(events);
      const result = await replay({
        streamId: "test",
        eventStore: store,
        fireCallbacks: true,
      });

      const onRetry = vi.fn();
      result.setCallbacks({ onRetry });

      for await (const _ of result.stream) {
        // consume
      }

      expect(result.state.modelRetryCount).toBe(1);
      expect(result.state.networkRetryCount).toBe(1);
      expect(onRetry).toHaveBeenCalledTimes(2);
    });

    it("should handle fallback events", async () => {
      const events = [
        createEnvelope(0, { type: "START", options: {} }),
        createEnvelope(1, { type: "FALLBACK", from: 0, to: 1 }),
        createEnvelope(2, { type: "COMPLETE", content: "", tokenCount: 0 }),
      ];

      const store = createMockEventStore(events);
      const result = await replay({ streamId: "test", eventStore: store });

      for await (const _ of result.stream) {
        // consume
      }

      expect(result.state.fallbackIndex).toBe(1);
    });

    it("should handle continuation events", async () => {
      const events = [
        createEnvelope(0, { type: "START", options: {} }),
        createEnvelope(1, { type: "CONTINUATION", checkpoint: "resume-point" }),
        createEnvelope(2, { type: "COMPLETE", content: "", tokenCount: 0 }),
      ];

      const store = createMockEventStore(events);
      const result = await replay({ streamId: "test", eventStore: store });

      for await (const _ of result.stream) {
        // consume
      }

      expect(result.state.resumed).toBe(true);
      expect(result.state.resumePoint).toBe("resume-point");
    });

    it("should handle error events", async () => {
      const events = [
        createEnvelope(0, { type: "START", options: {} }),
        createEnvelope(1, {
          type: "ERROR",
          error: { name: "Error", message: "Test error" },
        }),
      ];

      const store = createMockEventStore(events);
      const result = await replay({ streamId: "test", eventStore: store });

      const replayedEvents: L0Event[] = [];
      for await (const event of result.stream) {
        replayedEvents.push(event);
      }

      expect(replayedEvents.some((e) => e.type === "error")).toBe(true);
      expect(result.errors).toHaveLength(1);
    });

    it("should respect fromSeq and toSeq options", async () => {
      const events = [
        createEnvelope(0, { type: "START", options: {} }),
        createEnvelope(1, { type: "TOKEN", value: "a", index: 0 }),
        createEnvelope(2, { type: "TOKEN", value: "b", index: 1 }),
        createEnvelope(3, { type: "TOKEN", value: "c", index: 2 }),
        createEnvelope(4, { type: "COMPLETE", content: "abc", tokenCount: 3 }),
      ];

      const store = createMockEventStore(events);
      const result = await replay({
        streamId: "test",
        eventStore: store,
        fromSeq: 1,
        toSeq: 2,
      });

      const replayedEvents: L0Event[] = [];
      for await (const event of result.stream) {
        replayedEvents.push(event);
      }

      // Should only get events with seq 1 and 2 (tokens a and b)
      expect(replayedEvents).toHaveLength(2);
    });

    it("should support abort", async () => {
      const events = [
        createEnvelope(0, { type: "START", options: {} }),
        createEnvelope(1, { type: "TOKEN", value: "a", index: 0 }),
        createEnvelope(2, { type: "TOKEN", value: "b", index: 1 }),
        createEnvelope(3, { type: "COMPLETE", content: "ab", tokenCount: 2 }),
      ];

      const store = createMockEventStore(events);
      const result = await replay({ streamId: "test", eventStore: store });

      const replayedEvents: L0Event[] = [];
      for await (const event of result.stream) {
        replayedEvents.push(event);
        if (replayedEvents.length === 1) {
          result.abort();
        }
      }

      expect(replayedEvents.length).toBeLessThanOrEqual(2);
    });
  });

  describe("compareReplays", () => {
    it("should return identical for same states", () => {
      const state: L0State = {
        content: "test",
        checkpoint: "",
        tokenCount: 1,
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

      const result = compareReplays(state, { ...state });

      expect(result.identical).toBe(true);
      expect(result.differences).toHaveLength(0);
    });

    it("should detect content differences", () => {
      const stateA: L0State = {
        content: "hello",
        checkpoint: "",
        tokenCount: 1,
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

      const stateB = { ...stateA, content: "world" };

      const result = compareReplays(stateA, stateB);

      expect(result.identical).toBe(false);
      expect(result.differences.some((d) => d.includes("content"))).toBe(true);
    });

    it("should detect token count differences", () => {
      const stateA: L0State = {
        content: "test",
        checkpoint: "",
        tokenCount: 5,
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

      const stateB = { ...stateA, tokenCount: 10 };

      const result = compareReplays(stateA, stateB);

      expect(result.identical).toBe(false);
      expect(result.differences.some((d) => d.includes("tokenCount"))).toBe(
        true,
      );
    });

    it("should detect multiple differences", () => {
      const stateA: L0State = {
        content: "a",
        checkpoint: "",
        tokenCount: 1,
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

      const stateB: L0State = {
        ...stateA,
        content: "b",
        tokenCount: 2,
        completed: false,
      };

      const result = compareReplays(stateA, stateB);

      expect(result.identical).toBe(false);
      expect(result.differences.length).toBeGreaterThan(1);
    });
  });

  describe("getStreamMetadata", () => {
    it("should return null for non-existent stream", async () => {
      const store = createMockEventStore([], false);
      const metadata = await getStreamMetadata(store, "nonexistent");

      expect(metadata).toBeNull();
    });

    it("should return null for empty stream", async () => {
      const store = createMockEventStore([], true);
      const metadata = await getStreamMetadata(store, "empty");

      expect(metadata).toBeNull();
    });

    it("should return metadata for valid stream", async () => {
      const now = Date.now();
      const events = [
        createEnvelope(0, { type: "START", options: { model: "test" } }, now),
        createEnvelope(1, { type: "TOKEN", value: "a", index: 0 }, now + 10),
        createEnvelope(2, { type: "TOKEN", value: "b", index: 1 }, now + 20),
        createEnvelope(
          3,
          { type: "COMPLETE", content: "ab", tokenCount: 2 },
          now + 30,
        ),
      ];

      const store = createMockEventStore(events);
      const metadata = await getStreamMetadata(store, "test");

      expect(metadata).not.toBeNull();
      expect(metadata!.streamId).toBe("test");
      expect(metadata!.eventCount).toBe(4);
      expect(metadata!.tokenCount).toBe(2);
      expect(metadata!.completed).toBe(true);
      expect(metadata!.hasError).toBe(false);
    });

    it("should detect error streams", async () => {
      const events = [
        createEnvelope(0, { type: "START", options: {} }),
        createEnvelope(1, {
          type: "ERROR",
          error: { name: "Error", message: "fail" },
        }),
      ];

      const store = createMockEventStore(events);
      const metadata = await getStreamMetadata(store, "test");

      expect(metadata!.hasError).toBe(true);
      expect(metadata!.completed).toBe(false);
    });
  });
});
