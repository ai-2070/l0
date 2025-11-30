// Event Sourcing Integration Tests
// Tests event recording and replay with real LLM streams

import { describe, it, expect } from "vitest";
import {
  describeIf,
  hasOpenAI,
  LLM_TIMEOUT,
  expectValidResponse,
} from "./setup";
import {
  l0,
  createInMemoryEventStore,
  createEventRecorder,
  createEventReplayer,
} from "../src/index";
import { streamText } from "ai";
import { openai } from "@ai-sdk/openai";

describeIf(hasOpenAI)("Event Sourcing Integration", () => {
  describe("Recording Real LLM Streams", () => {
    it(
      "should record all events from a real LLM stream using recorder",
      async () => {
        const store = createInMemoryEventStore();
        const streamId = "test-recording-" + Date.now();
        const recorder = createEventRecorder(store, streamId);

        // Record start
        await recorder.recordStart({
          prompt: "Say 'Hello, World!' and nothing else.",
          model: "gpt-4o-mini",
        });

        const result = await l0({
          stream: () =>
            streamText({
              model: openai("gpt-4o-mini"),
              prompt: "Say 'Hello, World!' and nothing else.",
            }),
        });

        // Consume the stream and record tokens
        let tokenIndex = 0;
        for await (const event of result.stream) {
          if (event.type === "token") {
            await recorder.recordToken(event.value, tokenIndex++);
          }
        }

        // Record completion
        await recorder.recordComplete(result.state.content, tokenIndex);

        // Verify events were recorded
        const events = await store.getEvents(streamId);
        expect(events.length).toBeGreaterThan(0);

        // Should have START event
        const startEvent = events.find((e) => e.event.type === "START");
        expect(startEvent).toBeDefined();

        // Should have TOKEN events
        const tokenEvents = events.filter((e) => e.event.type === "TOKEN");
        expect(tokenEvents.length).toBeGreaterThan(0);

        // Should have COMPLETE event
        const completeEvent = events.find((e) => e.event.type === "COMPLETE");
        expect(completeEvent).toBeDefined();

        // Final content should be valid
        expectValidResponse(result.state.content);
      },
      LLM_TIMEOUT,
    );

    it(
      "should record events with correct sequence numbers",
      async () => {
        const store = createInMemoryEventStore();
        const streamId = "test-sequence-" + Date.now();
        const recorder = createEventRecorder(store, streamId);

        await recorder.recordStart({ prompt: "Count from 1 to 3." });

        const result = await l0({
          stream: () =>
            streamText({
              model: openai("gpt-4o-mini"),
              prompt: "Count from 1 to 3.",
            }),
        });

        let tokenIndex = 0;
        for await (const event of result.stream) {
          if (event.type === "token") {
            await recorder.recordToken(event.value, tokenIndex++);
          }
        }

        await recorder.recordComplete(result.state.content, tokenIndex);

        const events = await store.getEvents(streamId);

        // Verify sequence numbers are sequential
        for (let i = 0; i < events.length; i++) {
          expect(events[i]!.seq).toBe(i);
        }
      },
      LLM_TIMEOUT,
    );
  });

  describe("Replaying Recorded Streams", () => {
    it(
      "should replay events and reconstruct state",
      async () => {
        const store = createInMemoryEventStore();
        const streamId = "test-replay-" + Date.now();
        const recorder = createEventRecorder(store, streamId);

        // First, record a stream
        await recorder.recordStart({ prompt: "Say 'Replay Test' exactly." });

        const originalResult = await l0({
          stream: () =>
            streamText({
              model: openai("gpt-4o-mini"),
              prompt: "Say 'Replay Test' exactly.",
            }),
        });

        let tokenIndex = 0;
        for await (const event of originalResult.stream) {
          if (event.type === "token") {
            await recorder.recordToken(event.value, tokenIndex++);
          }
        }

        await recorder.recordComplete(originalResult.state.content, tokenIndex);

        const originalContent = originalResult.state.content;

        // Now replay and verify state matches
        const replayer = createEventReplayer(store);
        const replayedState = await replayer.replayToState(streamId);

        expect(replayedState.content).toBe(originalContent);
        expect(replayedState.completed).toBe(true);
      },
      LLM_TIMEOUT,
    );

    it(
      "should replay tokens in correct order",
      async () => {
        const store = createInMemoryEventStore();
        const streamId = "test-token-order-" + Date.now();
        const recorder = createEventRecorder(store, streamId);

        await recorder.recordStart({ prompt: "Say 'A B C' with spaces." });

        const result = await l0({
          stream: () =>
            streamText({
              model: openai("gpt-4o-mini"),
              prompt: "Say 'A B C' with spaces.",
            }),
        });

        let tokenIndex = 0;
        for await (const event of result.stream) {
          if (event.type === "token") {
            await recorder.recordToken(event.value, tokenIndex++);
          }
        }

        await recorder.recordComplete(result.state.content, tokenIndex);

        // Replay tokens using async generator
        const replayer = createEventReplayer(store);
        const tokens: string[] = [];
        for await (const token of replayer.replayTokens(streamId)) {
          tokens.push(token);
        }

        // Tokens should join to form the content
        const replayedContent = tokens.join("");
        expect(replayedContent).toBe(result.state.content);
      },
      LLM_TIMEOUT,
    );
  });

  describe("Event Store Persistence", () => {
    it(
      "should maintain separate streams for different requests",
      async () => {
        const store = createInMemoryEventStore();
        const streamId1 = "test-stream-1-" + Date.now();
        const streamId2 = "test-stream-2-" + Date.now();

        // Record first stream
        const recorder1 = createEventRecorder(store, streamId1);
        await recorder1.recordStart({ prompt: "Say 'First'" });

        const result1 = await l0({
          stream: () =>
            streamText({
              model: openai("gpt-4o-mini"),
              prompt: "Say 'First'",
            }),
        });

        let idx1 = 0;
        for await (const event of result1.stream) {
          if (event.type === "token") {
            await recorder1.recordToken(event.value, idx1++);
          }
        }
        await recorder1.recordComplete(result1.state.content, idx1);

        // Record second stream
        const recorder2 = createEventRecorder(store, streamId2);
        await recorder2.recordStart({ prompt: "Say 'Second'" });

        const result2 = await l0({
          stream: () =>
            streamText({
              model: openai("gpt-4o-mini"),
              prompt: "Say 'Second'",
            }),
        });

        let idx2 = 0;
        for await (const event of result2.stream) {
          if (event.type === "token") {
            await recorder2.recordToken(event.value, idx2++);
          }
        }
        await recorder2.recordComplete(result2.state.content, idx2);

        // Verify streams are separate
        const events1 = await store.getEvents(streamId1);
        const events2 = await store.getEvents(streamId2);

        expect(events1.length).toBeGreaterThan(0);
        expect(events2.length).toBeGreaterThan(0);

        // All events in stream1 should have streamId1
        for (const event of events1) {
          expect(event.streamId).toBe(streamId1);
        }

        // All events in stream2 should have streamId2
        for (const event of events2) {
          expect(event.streamId).toBe(streamId2);
        }
      },
      LLM_TIMEOUT * 2,
    );

    it(
      "should list all recorded streams",
      async () => {
        const store = createInMemoryEventStore();
        const streamIds = [
          "list-test-1-" + Date.now(),
          "list-test-2-" + Date.now(),
        ];

        for (const streamId of streamIds) {
          const recorder = createEventRecorder(store, streamId);
          await recorder.recordStart({ prompt: "Say 'test'" });

          const result = await l0({
            stream: () =>
              streamText({
                model: openai("gpt-4o-mini"),
                prompt: "Say 'test'",
              }),
          });

          let idx = 0;
          for await (const event of result.stream) {
            if (event.type === "token") {
              await recorder.recordToken(event.value, idx++);
            }
          }
          await recorder.recordComplete(result.state.content, idx);
        }

        const listedStreams = await store.listStreams();

        for (const streamId of streamIds) {
          expect(listedStreams).toContain(streamId);
        }
      },
      LLM_TIMEOUT * 2,
    );
  });

  describe("Manual Event Recording", () => {
    it(
      "should allow manual event recording alongside LLM events",
      async () => {
        const store = createInMemoryEventStore();
        const streamId = "test-manual-" + Date.now();
        const recorder = createEventRecorder(store, streamId);

        // Record a custom start
        await recorder.recordStart({
          prompt: "Test prompt",
          model: "gpt-4o-mini",
        });

        // Record some manual tokens
        await recorder.recordToken("Hello", 0);
        await recorder.recordToken(" ", 1);
        await recorder.recordToken("World", 2);

        // Record completion
        await recorder.recordComplete("Hello World", 3);

        // Verify all events were recorded
        const events = await store.getEvents(streamId);
        expect(events.length).toBe(5); // START + 3 TOKENS + COMPLETE

        // Replay and verify
        const replayer = createEventReplayer(store);
        const state = await replayer.replayToState(streamId);

        expect(state.content).toBe("Hello World");
        expect(state.completed).toBe(true);
      },
      LLM_TIMEOUT,
    );
  });

  describe("Error Recording", () => {
    it(
      "should record error events when stream fails",
      async () => {
        const store = createInMemoryEventStore();
        const streamId = "test-error-" + Date.now();
        const recorder = createEventRecorder(store, streamId);

        // Simulate error recording
        await recorder.recordStart({ prompt: "Test" });
        await recorder.recordToken("Partial", 0);
        await recorder.recordError(
          { name: "NetworkError", message: "Connection lost" },
          true, // recoverable
        );

        const events = await store.getEvents(streamId);
        const errorEvent = events.find((e) => e.event.type === "ERROR");

        expect(errorEvent).toBeDefined();
        if (errorEvent && errorEvent.event.type === "ERROR") {
          expect(errorEvent.event.error.name).toBe("NetworkError");
          expect(errorEvent.event.recoverable).toBe(true);
        }
      },
      LLM_TIMEOUT,
    );
  });

  describe("Retry and Fallback Recording", () => {
    it(
      "should record retry events",
      async () => {
        const store = createInMemoryEventStore();
        const streamId = "test-retry-record-" + Date.now();
        const recorder = createEventRecorder(store, streamId);

        await recorder.recordStart({ prompt: "Test" });
        await recorder.recordRetry("rate_limit", 1, true);
        await recorder.recordRetry("timeout", 2, true);
        await recorder.recordComplete("Success after retries", 0);

        const events = await store.getEvents(streamId);
        const retryEvents = events.filter((e) => e.event.type === "RETRY");

        expect(retryEvents.length).toBe(2);

        // Replay and check retry count
        const replayer = createEventReplayer(store);
        const state = await replayer.replayToState(streamId);

        expect(state.retryAttempts).toBe(2);
      },
      LLM_TIMEOUT,
    );

    it(
      "should record fallback events",
      async () => {
        const store = createInMemoryEventStore();
        const streamId = "test-fallback-record-" + Date.now();
        const recorder = createEventRecorder(store, streamId);

        await recorder.recordStart({ prompt: "Test" });
        await recorder.recordFallback(1); // Fallback to model index 1
        await recorder.recordFallback(2); // Fallback to model index 2
        await recorder.recordComplete("Success on fallback", 0);

        const events = await store.getEvents(streamId);
        const fallbackEvents = events.filter(
          (e) => e.event.type === "FALLBACK",
        );

        expect(fallbackEvents.length).toBe(2);

        // Replay and check fallback index
        const replayer = createEventReplayer(store);
        const state = await replayer.replayToState(streamId);

        expect(state.fallbackIndex).toBe(2);
      },
      LLM_TIMEOUT,
    );
  });

  describe("Real-World Workflow", () => {
    it(
      "should handle complete record and replay workflow",
      async () => {
        const store = createInMemoryEventStore();
        const streamId = "workflow-" + Date.now();
        const recorder = createEventRecorder(store, streamId);

        // Record a real LLM interaction
        await recorder.recordStart({
          prompt: "Write a haiku about coding.",
          model: "gpt-4o-mini",
        });

        const result = await l0({
          stream: () =>
            streamText({
              model: openai("gpt-4o-mini"),
              prompt: "Write a haiku about coding.",
            }),
        });

        let tokenIndex = 0;
        let lastCheckpoint = "";
        for await (const event of result.stream) {
          if (event.type === "token") {
            await recorder.recordToken(event.value, tokenIndex);
            lastCheckpoint += event.value;

            // Record checkpoint every 20 tokens
            if (tokenIndex > 0 && tokenIndex % 20 === 0) {
              await recorder.recordCheckpoint(tokenIndex, lastCheckpoint);
            }
            tokenIndex++;
          }
        }

        await recorder.recordComplete(result.state.content, tokenIndex);

        // Verify recording
        const events = await store.getEvents(streamId);
        expect(events.length).toBeGreaterThan(5);

        // Replay and verify
        const replayer = createEventReplayer(store);
        const replayedState = await replayer.replayToState(streamId);

        expect(replayedState.content).toBe(result.state.content);
        expect(replayedState.completed).toBe(true);
        expect(replayedState.tokenCount).toBe(tokenIndex);

        // Verify we can iterate tokens
        const tokens: string[] = [];
        for await (const token of replayer.replayTokens(streamId)) {
          tokens.push(token);
        }
        expect(tokens.join("")).toBe(result.state.content);
      },
      LLM_TIMEOUT,
    );
  });
});
