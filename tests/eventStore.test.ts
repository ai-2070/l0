// Event Store and Event Sourcing Tests

import { describe, it, expect, beforeEach } from "vitest";
import {
  InMemoryEventStore,
  L0EventRecorder,
  L0EventReplayer,
  createInMemoryEventStore,
  createEventRecorder,
  createEventReplayer,
} from "../src/runtime/eventStore";
import {
  serializeError,
  deserializeError,
  generateStreamId,
} from "../src/types/events";
import type {
  L0RecordedEvent,
  L0TokenEvent,
  SerializedError,
} from "../src/types/events";

describe("Event Sourcing", () => {
  describe("InMemoryEventStore", () => {
    let store: InMemoryEventStore;

    beforeEach(() => {
      store = new InMemoryEventStore();
    });

    it("should append events to a stream", async () => {
      const event: L0RecordedEvent = {
        type: "START",
        ts: Date.now(),
        options: { prompt: "test" },
      };

      await store.append("stream-1", event);

      const events = await store.getEvents("stream-1");
      expect(events).toHaveLength(1);
      expect(events[0]!.event).toEqual(event);
      expect(events[0]!.seq).toBe(0);
      expect(events[0]!.streamId).toBe("stream-1");
    });

    it("should maintain event order", async () => {
      const events: L0RecordedEvent[] = [
        { type: "START", ts: 1000, options: {} },
        { type: "TOKEN", ts: 1100, value: "Hello", index: 0 },
        { type: "TOKEN", ts: 1200, value: " ", index: 1 },
        { type: "TOKEN", ts: 1300, value: "World", index: 2 },
        { type: "COMPLETE", ts: 1400, content: "Hello World", tokenCount: 3 },
      ];

      for (const event of events) {
        await store.append("stream-1", event);
      }

      const stored = await store.getEvents("stream-1");
      expect(stored).toHaveLength(5);
      expect(stored.map((e) => e.seq)).toEqual([0, 1, 2, 3, 4]);
      expect(stored.map((e) => e.event.type)).toEqual([
        "START",
        "TOKEN",
        "TOKEN",
        "TOKEN",
        "COMPLETE",
      ]);
    });

    it("should isolate streams", async () => {
      await store.append("stream-1", {
        type: "TOKEN",
        ts: 1000,
        value: "A",
        index: 0,
      });
      await store.append("stream-2", {
        type: "TOKEN",
        ts: 1000,
        value: "B",
        index: 0,
      });

      const stream1 = await store.getEvents("stream-1");
      const stream2 = await store.getEvents("stream-2");

      expect(stream1).toHaveLength(1);
      expect(stream2).toHaveLength(1);
      const event1 = stream1[0]!.event;
      const event2 = stream2[0]!.event;
      expect(event1.type).toBe("TOKEN");
      expect(event2.type).toBe("TOKEN");
      if (event1.type === "TOKEN" && event2.type === "TOKEN") {
        expect(event1.value).toBe("A");
        expect(event2.value).toBe("B");
      }
    });

    it("should check if stream exists", async () => {
      expect(await store.exists("stream-1")).toBe(false);

      await store.append("stream-1", {
        type: "START",
        ts: 1000,
        options: {},
      });

      expect(await store.exists("stream-1")).toBe(true);
      expect(await store.exists("stream-2")).toBe(false);
    });

    it("should get last event", async () => {
      await store.append("stream-1", {
        type: "START",
        ts: 1000,
        options: {},
      });
      await store.append("stream-1", {
        type: "TOKEN",
        ts: 1100,
        value: "test",
        index: 0,
      });
      await store.append("stream-1", {
        type: "COMPLETE",
        ts: 1200,
        content: "test",
        tokenCount: 1,
      });

      const last = await store.getLastEvent("stream-1");
      expect(last?.event.type).toBe("COMPLETE");
      expect(last?.seq).toBe(2);
    });

    it("should return null for empty stream last event", async () => {
      const last = await store.getLastEvent("nonexistent");
      expect(last).toBeNull();
    });

    it("should get events after sequence", async () => {
      for (let i = 0; i < 5; i++) {
        await store.append("stream-1", {
          type: "TOKEN",
          ts: 1000 + i * 100,
          value: `token${i}`,
          index: i,
        });
      }

      const afterSeq2 = await store.getEventsAfter("stream-1", 2);
      expect(afterSeq2).toHaveLength(2);
      expect(afterSeq2[0]!.seq).toBe(3);
      expect(afterSeq2[1]!.seq).toBe(4);
    });

    it("should delete stream", async () => {
      await store.append("stream-1", {
        type: "START",
        ts: 1000,
        options: {},
      });

      expect(await store.exists("stream-1")).toBe(true);

      await store.delete("stream-1");

      expect(await store.exists("stream-1")).toBe(false);
      expect(await store.getEvents("stream-1")).toEqual([]);
    });

    it("should list all streams", async () => {
      await store.append("stream-1", {
        type: "START",
        ts: 1000,
        options: {},
      });
      await store.append("stream-2", {
        type: "START",
        ts: 1000,
        options: {},
      });
      await store.append("stream-3", {
        type: "START",
        ts: 1000,
        options: {},
      });

      const streams = await store.listStreams();
      expect(streams).toContain("stream-1");
      expect(streams).toContain("stream-2");
      expect(streams).toContain("stream-3");
      expect(streams).toHaveLength(3);
    });

    it("should save and retrieve snapshots", async () => {
      await store.saveSnapshot({
        streamId: "stream-1",
        seq: 10,
        ts: Date.now(),
        content: "Hello World",
        tokenCount: 2,
        checkpoint: "Hello",
        violations: [],
        driftDetected: false,
        retryAttempts: 0,
        networkRetries: 0,
        fallbackIndex: 0,
      });

      const snapshot = await store.getSnapshot("stream-1");
      expect(snapshot).not.toBeNull();
      expect(snapshot?.content).toBe("Hello World");
      expect(snapshot?.seq).toBe(10);
    });

    it("should get snapshot before sequence", async () => {
      await store.saveSnapshot({
        streamId: "stream-1",
        seq: 5,
        ts: 1000,
        content: "partial",
        tokenCount: 1,
        checkpoint: "",
        violations: [],
        driftDetected: false,
        retryAttempts: 0,
        networkRetries: 0,
        fallbackIndex: 0,
      });

      await store.saveSnapshot({
        streamId: "stream-1",
        seq: 10,
        ts: 2000,
        content: "more content",
        tokenCount: 2,
        checkpoint: "",
        violations: [],
        driftDetected: false,
        retryAttempts: 0,
        networkRetries: 0,
        fallbackIndex: 0,
      });

      const snapshotBefore8 = await store.getSnapshotBefore("stream-1", 8);
      expect(snapshotBefore8?.seq).toBe(5);

      const snapshotBefore15 = await store.getSnapshotBefore("stream-1", 15);
      expect(snapshotBefore15?.seq).toBe(10);
    });

    it("should clear all data", () => {
      store.append("stream-1", { type: "START", ts: 1000, options: {} });
      store.append("stream-2", { type: "START", ts: 1000, options: {} });

      store.clear();

      expect(store.getStreamCount()).toBe(0);
      expect(store.getTotalEventCount()).toBe(0);
    });

    it("should track counts", async () => {
      await store.append("stream-1", {
        type: "TOKEN",
        ts: 1000,
        value: "a",
        index: 0,
      });
      await store.append("stream-1", {
        type: "TOKEN",
        ts: 1100,
        value: "b",
        index: 1,
      });
      await store.append("stream-2", {
        type: "TOKEN",
        ts: 1000,
        value: "c",
        index: 0,
      });

      expect(store.getStreamCount()).toBe(2);
      expect(store.getTotalEventCount()).toBe(3);
    });
  });

  describe("L0EventRecorder", () => {
    let store: InMemoryEventStore;
    let recorder: L0EventRecorder;

    beforeEach(() => {
      store = new InMemoryEventStore();
      recorder = new L0EventRecorder(store);
    });

    it("should generate stream ID if not provided", () => {
      const id = recorder.getStreamId();
      expect(id).toMatch(/^l0_/);
    });

    it("should use provided stream ID", () => {
      const recorder = new L0EventRecorder(store, "custom-id");
      expect(recorder.getStreamId()).toBe("custom-id");
    });

    it("should track sequence number", async () => {
      expect(recorder.getSeq()).toBe(0);

      await recorder.recordToken("a", 0);
      expect(recorder.getSeq()).toBe(1);

      await recorder.recordToken("b", 1);
      expect(recorder.getSeq()).toBe(2);
    });

    it("should record START event", async () => {
      await recorder.recordStart({
        prompt: "test",
        model: "gpt-5-micro",
      });

      const events = await store.getEvents(recorder.getStreamId());
      expect(events).toHaveLength(1);
      expect(events[0]!.event.type).toBe("START");
    });

    it("should record TOKEN events", async () => {
      await recorder.recordToken("Hello", 0);
      await recorder.recordToken(" ", 1);
      await recorder.recordToken("World", 2);

      const events = await store.getEvents(recorder.getStreamId());
      expect(events).toHaveLength(3);
      const values = events
        .map((e) => e.event)
        .filter((e): e is L0TokenEvent => e.type === "TOKEN")
        .map((e) => e.value);
      expect(values).toEqual(["Hello", " ", "World"]);
    });

    it("should record CHECKPOINT events", async () => {
      await recorder.recordCheckpoint(10, "checkpoint content");

      const events = await store.getEvents(recorder.getStreamId());
      expect(events[0]!.event.type).toBe("CHECKPOINT");
    });

    it("should record GUARDRAIL events", async () => {
      await recorder.recordGuardrail(5, {
        violations: [
          {
            rule: "json",
            message: "Invalid JSON",
            severity: "error",
            recoverable: true,
          },
        ],
        shouldRetry: true,
        shouldHalt: false,
      });

      const events = await store.getEvents(recorder.getStreamId());
      expect(events[0]!.event.type).toBe("GUARDRAIL");
    });

    it("should record RETRY events", async () => {
      await recorder.recordRetry("rate_limit", 1, true);
      await recorder.recordRetry("network_error", 2, false);

      const events = await store.getEvents(recorder.getStreamId());
      expect(events).toHaveLength(2);
    });

    it("should record FALLBACK events", async () => {
      await recorder.recordFallback(1);

      const events = await store.getEvents(recorder.getStreamId());
      expect(events[0]!.event.type).toBe("FALLBACK");
    });

    it("should record CONTINUATION events", async () => {
      await recorder.recordContinuation("checkpoint", 10);

      const events = await store.getEvents(recorder.getStreamId());
      expect(events[0]!.event.type).toBe("CONTINUATION");
    });

    it("should record COMPLETE events", async () => {
      await recorder.recordComplete("final content", 10);

      const events = await store.getEvents(recorder.getStreamId());
      expect(events[0]!.event.type).toBe("COMPLETE");
    });

    it("should record ERROR events", async () => {
      await recorder.recordError(
        { name: "Error", message: "Something failed" },
        true,
      );

      const events = await store.getEvents(recorder.getStreamId());
      expect(events[0]!.event.type).toBe("ERROR");
    });
  });

  describe("L0EventReplayer", () => {
    let store: InMemoryEventStore;
    let replayer: L0EventReplayer;

    beforeEach(async () => {
      store = new InMemoryEventStore();
      replayer = new L0EventReplayer(store);

      // Setup a sample stream
      const events: L0RecordedEvent[] = [
        { type: "START", ts: 1000, options: { prompt: "test" } },
        { type: "TOKEN", ts: 1100, value: "Hello", index: 0 },
        { type: "TOKEN", ts: 1200, value: " ", index: 1 },
        { type: "TOKEN", ts: 1300, value: "World", index: 2 },
        { type: "CHECKPOINT", ts: 1350, at: 3, content: "Hello World" },
        { type: "COMPLETE", ts: 1400, content: "Hello World", tokenCount: 3 },
      ];

      for (const event of events) {
        await store.append("test-stream", event);
      }
    });

    it("should replay all events", async () => {
      const events: L0RecordedEvent[] = [];

      for await (const envelope of replayer.replay("test-stream")) {
        events.push(envelope.event);
      }

      expect(events).toHaveLength(6);
      expect(events.map((e) => e.type)).toEqual([
        "START",
        "TOKEN",
        "TOKEN",
        "TOKEN",
        "CHECKPOINT",
        "COMPLETE",
      ]);
    });

    it("should replay from specific sequence", async () => {
      const events: L0RecordedEvent[] = [];

      for await (const envelope of replayer.replay("test-stream", {
        fromSeq: 2,
      })) {
        events.push(envelope.event);
      }

      expect(events).toHaveLength(4); // TOKEN(2), TOKEN(3), CHECKPOINT, COMPLETE
    });

    it("should replay to specific sequence", async () => {
      const events: L0RecordedEvent[] = [];

      for await (const envelope of replayer.replay("test-stream", {
        toSeq: 2,
      })) {
        events.push(envelope.event);
      }

      expect(events).toHaveLength(3); // START, TOKEN(0), TOKEN(1)
    });

    it("should replay tokens only", async () => {
      const tokens: string[] = [];

      for await (const token of replayer.replayTokens("test-stream")) {
        tokens.push(token);
      }

      expect(tokens).toEqual(["Hello", " ", "World"]);
    });

    it("should reconstruct state from events", async () => {
      const state = await replayer.replayToState("test-stream");

      expect(state.content).toBe("Hello World");
      expect(state.tokenCount).toBe(3);
      expect(state.checkpoint).toBe("Hello World");
      expect(state.completed).toBe(true);
      expect(state.error).toBeNull();
    });

    it("should handle error events in state", async () => {
      await store.append("error-stream", {
        type: "START",
        ts: 1000,
        options: {},
      });
      await store.append("error-stream", {
        type: "TOKEN",
        ts: 1100,
        value: "partial",
        index: 0,
      });
      await store.append("error-stream", {
        type: "ERROR",
        ts: 1200,
        error: { name: "Error", message: "Network failed" },
        recoverable: true,
      });

      const state = await replayer.replayToState("error-stream");

      expect(state.content).toBe("partial");
      expect(state.completed).toBe(false);
      expect(state.error).not.toBeNull();
      expect(state.error?.message).toBe("Network failed");
    });

    it("should handle retry events in state", async () => {
      await store.append("retry-stream", {
        type: "START",
        ts: 1000,
        options: {},
      });
      await store.append("retry-stream", {
        type: "RETRY",
        ts: 1100,
        reason: "rate_limit",
        attempt: 1,
        countsTowardLimit: true,
      });
      await store.append("retry-stream", {
        type: "RETRY",
        ts: 1200,
        reason: "network",
        attempt: 2,
        countsTowardLimit: false,
      });
      await store.append("retry-stream", {
        type: "COMPLETE",
        ts: 1300,
        content: "done",
        tokenCount: 1,
      });

      const state = await replayer.replayToState("retry-stream");

      expect(state.retryAttempts).toBe(1);
      expect(state.networkRetries).toBe(1);
    });

    it("should handle fallback events in state", async () => {
      await store.append("fallback-stream", {
        type: "START",
        ts: 1000,
        options: {},
      });
      await store.append("fallback-stream", {
        type: "FALLBACK",
        ts: 1100,
        to: 1,
      });
      await store.append("fallback-stream", {
        type: "FALLBACK",
        ts: 1200,
        to: 2,
      });
      await store.append("fallback-stream", {
        type: "COMPLETE",
        ts: 1300,
        content: "done",
        tokenCount: 1,
      });

      const state = await replayer.replayToState("fallback-stream");

      expect(state.fallbackIndex).toBe(2);
    });

    it("should handle drift events in state", async () => {
      await store.append("drift-stream", {
        type: "START",
        ts: 1000,
        options: {},
      });
      await store.append("drift-stream", {
        type: "DRIFT",
        ts: 1100,
        at: 5,
        result: { detected: true, types: ["meta_commentary"], confidence: 0.8 },
      });
      await store.append("drift-stream", {
        type: "COMPLETE",
        ts: 1300,
        content: "done",
        tokenCount: 1,
      });

      const state = await replayer.replayToState("drift-stream");

      expect(state.driftDetected).toBe(true);
    });

    it("should handle guardrail violations in state", async () => {
      await store.append("guardrail-stream", {
        type: "START",
        ts: 1000,
        options: {},
      });
      await store.append("guardrail-stream", {
        type: "GUARDRAIL",
        ts: 1100,
        at: 5,
        result: {
          violations: [
            {
              rule: "json",
              message: "Invalid",
              severity: "warning",
              recoverable: true,
            },
          ],
          shouldRetry: false,
          shouldHalt: false,
        },
      });
      await store.append("guardrail-stream", {
        type: "COMPLETE",
        ts: 1300,
        content: "done",
        tokenCount: 1,
      });

      const state = await replayer.replayToState("guardrail-stream");

      expect(state.violations).toHaveLength(1);
      expect(state.violations[0]!.rule).toBe("json");
    });
  });

  describe("Helper Functions", () => {
    describe("serializeError / deserializeError", () => {
      it("should serialize Error to SerializedError", () => {
        const error = new Error("Test error");
        error.name = "TestError";

        const serialized = serializeError(error);

        expect(serialized.name).toBe("TestError");
        expect(serialized.message).toBe("Test error");
        expect(serialized.stack).toBeDefined();
      });

      it("should serialize error with code", () => {
        const error = Object.assign(new Error("Test"), { code: "ECONNRESET" });

        const serialized = serializeError(error);

        expect(serialized.code).toBe("ECONNRESET");
      });

      it("should deserialize back to Error", () => {
        const serialized: SerializedError = {
          name: "CustomError",
          message: "Something went wrong",
          code: "ERR_001",
        };

        const error = deserializeError(serialized);

        expect(error).toBeInstanceOf(Error);
        expect(error.name).toBe("CustomError");
        expect(error.message).toBe("Something went wrong");
        expect((error as any).code).toBe("ERR_001");
      });

      it("should round-trip error serialization", () => {
        const original = new Error("Round trip test");

        const serialized = serializeError(original);
        const deserialized = deserializeError(serialized);

        expect(deserialized.message).toBe(original.message);
        expect(deserialized.name).toBe(original.name);
      });
    });

    describe("generateStreamId", () => {
      it("should generate unique IDs", () => {
        const ids = new Set<string>();

        for (let i = 0; i < 100; i++) {
          ids.add(generateStreamId());
        }

        expect(ids.size).toBe(100);
      });

      it("should have l0_ prefix", () => {
        const id = generateStreamId();
        expect(id.startsWith("l0_")).toBe(true);
      });
    });

    describe("Factory Functions", () => {
      it("should create InMemoryEventStore", () => {
        const store = createInMemoryEventStore();
        expect(store).toBeInstanceOf(InMemoryEventStore);
      });

      it("should create EventRecorder", () => {
        const store = createInMemoryEventStore();
        const recorder = createEventRecorder(store);
        expect(recorder).toBeInstanceOf(L0EventRecorder);
      });

      it("should create EventReplayer", () => {
        const store = createInMemoryEventStore();
        const replayer = createEventReplayer(store);
        expect(replayer).toBeInstanceOf(L0EventReplayer);
      });
    });
  });

  describe("Complete Recording and Replay Workflow", () => {
    it("should record and replay a complete stream", async () => {
      const store = createInMemoryEventStore();
      const recorder = createEventRecorder(store, "workflow-test");

      // Record a stream
      await recorder.recordStart({
        prompt: "test",
        model: "gpt-5-micro",
      });
      await recorder.recordToken("The", 0);
      await recorder.recordToken(" ", 1);
      await recorder.recordToken("answer", 2);
      await recorder.recordToken(" ", 3);
      await recorder.recordToken("is", 4);
      await recorder.recordToken(" ", 5);
      await recorder.recordToken("42", 6);
      await recorder.recordCheckpoint(6, "The answer is 42");
      await recorder.recordComplete("The answer is 42", 7);

      // Replay the stream
      const replayer = createEventReplayer(store);
      const state = await replayer.replayToState("workflow-test");

      expect(state.content).toBe("The answer is 42");
      expect(state.tokenCount).toBe(7);
      expect(state.completed).toBe(true);
      expect(state.checkpoint).toBe("The answer is 42");
    });

    it("should record and replay a stream with retries and fallback", async () => {
      const store = createInMemoryEventStore();
      const recorder = createEventRecorder(store, "retry-workflow");

      // Record a stream with failures
      await recorder.recordStart({ prompt: "test" });
      await recorder.recordToken("partial", 0);
      await recorder.recordRetry("rate_limit", 1, true);
      await recorder.recordFallback(1);
      await recorder.recordToken("success", 0);
      await recorder.recordComplete("success", 1);

      // Replay
      const replayer = createEventReplayer(store);
      const state = await replayer.replayToState("retry-workflow");

      expect(state.content).toBe("success");
      expect(state.retryAttempts).toBe(1);
      expect(state.fallbackIndex).toBe(1);
      expect(state.completed).toBe(true);
    });

    it("should replay with timing simulation", async () => {
      const store = createInMemoryEventStore();

      // Record with specific timestamps
      await store.append("timed-stream", {
        type: "START",
        ts: 1000,
        options: {},
      });
      await store.append("timed-stream", {
        type: "TOKEN",
        ts: 1100,
        value: "a",
        index: 0,
      });
      await store.append("timed-stream", {
        type: "TOKEN",
        ts: 1200,
        value: "b",
        index: 1,
      });
      await store.append("timed-stream", {
        type: "COMPLETE",
        ts: 1300,
        content: "ab",
        tokenCount: 2,
      });

      const replayer = createEventReplayer(store);

      // Replay at 10x speed (10ms delays instead of 100ms)
      const start = Date.now();
      const events: L0RecordedEvent[] = [];

      for await (const envelope of replayer.replay("timed-stream", {
        speed: 10,
      })) {
        events.push(envelope.event);
      }

      const elapsed = Date.now() - start;

      expect(events).toHaveLength(4);
      // Should take roughly 30ms (300ms / 10) - allow some variance
      expect(elapsed).toBeGreaterThanOrEqual(20);
      expect(elapsed).toBeLessThan(100);
    });
  });
});
