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
          model: "gpt-5-nano",
        });

        const result = await l0({
          stream: () =>
            streamText({
              model: openai("gpt-5-nano"),
              prompt: "Say 'Hello, World!' and nothing else.",
            }),
        });

        // Consume the stream and record tokens
        let tokenIndex = 0;
        for await (const event of result.stream) {
          if (event.type === "token") {
            await recorder.recordToken(event.value!, tokenIndex++);
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
              model: openai("gpt-5-nano"),
              prompt: "Count from 1 to 3.",
            }),
        });

        let tokenIndex = 0;
        for await (const event of result.stream) {
          if (event.type === "token") {
            await recorder.recordToken(event.value!, tokenIndex++);
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
              model: openai("gpt-5-nano"),
              prompt: "Say 'Replay Test' exactly.",
            }),
        });

        let tokenIndex = 0;
        for await (const event of originalResult.stream) {
          if (event.type === "token") {
            await recorder.recordToken(event.value!, tokenIndex++);
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
              model: openai("gpt-5-nano"),
              prompt: "Say 'A B C' with spaces.",
            }),
        });

        let tokenIndex = 0;
        for await (const event of result.stream) {
          if (event.type === "token") {
            await recorder.recordToken(event.value!, tokenIndex++);
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
              model: openai("gpt-5-nano"),
              prompt: "Say 'First'",
            }),
        });

        let idx1 = 0;
        for await (const event of result1.stream) {
          if (event.type === "token") {
            await recorder1.recordToken(event.value!, idx1++);
          }
        }
        await recorder1.recordComplete(result1.state.content, idx1);

        // Record second stream
        const recorder2 = createEventRecorder(store, streamId2);
        await recorder2.recordStart({ prompt: "Say 'Second'" });

        const result2 = await l0({
          stream: () =>
            streamText({
              model: openai("gpt-5-nano"),
              prompt: "Say 'Second'",
            }),
        });

        let idx2 = 0;
        for await (const event of result2.stream) {
          if (event.type === "token") {
            await recorder2.recordToken(event.value!, idx2++);
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
                model: openai("gpt-5-nano"),
                prompt: "Say 'test'",
              }),
          });

          let idx = 0;
          for await (const event of result.stream) {
            if (event.type === "token") {
              await recorder.recordToken(event.value!, idx++);
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
          model: "gpt-5-nano",
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

  describe("Byte-for-byte Identical Replay", () => {
    it(
      "should produce byte-for-byte identical output on replay",
      async () => {
        const store = createInMemoryEventStore();
        const streamId = "byte-identical-" + Date.now();
        const recorder = createEventRecorder(store, streamId);

        // Record a real LLM stream
        await recorder.recordStart({
          prompt: "Output exactly: 'The quick brown fox'",
          model: "gpt-5-nano",
        });

        const result = await l0({
          stream: () =>
            streamText({
              model: openai("gpt-5-nano"),
              prompt: "Output exactly: 'The quick brown fox'",
            }),
        });

        // Record each token with precise ordering
        const originalTokens: string[] = [];
        let tokenIndex = 0;
        for await (const event of result.stream) {
          if (event.type === "token") {
            originalTokens.push(event.value!);
            await recorder.recordToken(event.value!, tokenIndex++);
          }
        }

        const originalOutput = result.state.content;
        await recorder.recordComplete(originalOutput, tokenIndex);

        // Replay and reconstruct
        const replayer = createEventReplayer(store);

        // Method 1: Replay tokens
        const replayedTokens: string[] = [];
        for await (const token of replayer.replayTokens(streamId)) {
          replayedTokens.push(token);
        }
        const replayedFromTokens = replayedTokens.join("");

        // Method 2: Replay to state
        const replayedState = await replayer.replayToState(streamId);

        // Verify byte-for-byte identical
        expect(replayedFromTokens).toBe(originalOutput);
        expect(replayedState.content).toBe(originalOutput);

        // Verify token-by-token identical
        expect(replayedTokens.length).toBe(originalTokens.length);
        for (let i = 0; i < originalTokens.length; i++) {
          expect(replayedTokens[i]!).toBe(originalTokens[i]!);
        }
      },
      LLM_TIMEOUT,
    );
  });

  describe("Reconstruct from Halfway Point", () => {
    it(
      "should correctly reconstruct partial output from first N events",
      async () => {
        const store = createInMemoryEventStore();
        const streamId = "partial-replay-" + Date.now();
        const recorder = createEventRecorder(store, streamId);

        // Use manual recording for deterministic test
        await recorder.recordStart({ prompt: "Test partial replay" });

        // Record known tokens
        const allTokens = ["One", " ", "Two", " ", "Three", " ", "Four"];
        for (let i = 0; i < allTokens.length; i++) {
          await recorder.recordToken(allTokens[i]!, i);
        }
        await recorder.recordComplete(allTokens.join(""), allTokens.length);

        // Get all events
        const allEvents = await store.getEvents(streamId);
        const tokenEvents = allEvents.filter((e) => e.event.type === "TOKEN");

        // Replay only first half of tokens (3 out of 7)
        const halfwayCount = Math.floor(tokenEvents.length / 2);
        const replayer = createEventReplayer(store);

        // Replay with toSeq limit (seq 0 = START, seq 1-7 = tokens)
        // To get first 3 tokens, we need seq 0-3 (START + 3 tokens)
        const partialTokens: string[] = [];
        for await (const envelope of replayer.replay(streamId, {
          toSeq: halfwayCount, // START is seq 0, so this gives us halfwayCount tokens
        })) {
          if (envelope.event.type === "TOKEN") {
            partialTokens.push(envelope.event.value);
          }
        }

        // Verify partial output matches first half of original tokens
        const expectedPartial = allTokens.slice(0, halfwayCount).join("");
        const actualPartial = partialTokens.join("");

        expect(actualPartial).toBe(expectedPartial);
        expect(partialTokens.length).toBe(halfwayCount);
        expect(partialTokens.length).toBeLessThan(allTokens.length);

        // Verify no phantom tokens
        expect(partialTokens).toEqual(allTokens.slice(0, halfwayCount));
      },
      LLM_TIMEOUT,
    );

    it(
      "should handle replay interruption gracefully",
      async () => {
        const store = createInMemoryEventStore();
        const streamId = "interrupted-" + Date.now();
        const recorder = createEventRecorder(store, streamId);

        // Simulate an interrupted stream (no COMPLETE event)
        await recorder.recordStart({ prompt: "Test" });
        await recorder.recordToken("Hello", 0);
        await recorder.recordToken(" ", 1);
        await recorder.recordToken("World", 2);
        // Note: No recordComplete - simulates crash/interrupt

        const replayer = createEventReplayer(store);
        const state = await replayer.replayToState(streamId);

        // Should reconstruct partial content
        expect(state.content).toBe("Hello World");
        expect(state.completed).toBe(false); // Not marked complete
        expect(state.tokenCount).toBe(3);
      },
      LLM_TIMEOUT,
    );
  });

  describe("Deterministic Replays Across Models", () => {
    it(
      "should deterministically replay fallback sequence",
      async () => {
        const store = createInMemoryEventStore();
        const streamId = "fallback-determinism-" + Date.now();
        const recorder = createEventRecorder(store, streamId);

        // Record a sequence with fallbacks
        await recorder.recordStart({
          prompt: "Test",
          model: "gpt-5-nano",
          fallbackCount: 2,
        });

        // Simulate: primary failed, fell back to model 1, then model 2
        await recorder.recordFallback(1);
        await recorder.recordFallback(2);
        await recorder.recordToken("Success", 0);
        await recorder.recordToken(" on fallback", 1);
        await recorder.recordComplete("Success on fallback", 2);

        // Replay multiple times - should be identical each time
        const replayer = createEventReplayer(store);

        const replay1 = await replayer.replayToState(streamId);
        const replay2 = await replayer.replayToState(streamId);
        const replay3 = await replayer.replayToState(streamId);

        // All replays must produce identical results
        expect(replay1.content).toBe(replay2.content);
        expect(replay2.content).toBe(replay3.content);
        expect(replay1.fallbackIndex).toBe(2);
        expect(replay2.fallbackIndex).toBe(2);
        expect(replay3.fallbackIndex).toBe(2);
      },
      LLM_TIMEOUT,
    );

    it(
      "should deterministically replay retry sequence",
      async () => {
        const store = createInMemoryEventStore();
        const streamId = "retry-determinism-" + Date.now();
        const recorder = createEventRecorder(store, streamId);

        // Record a sequence with retries
        await recorder.recordStart({
          prompt: "Test",
          retry: { attempts: 3, backoff: "exponential" },
        });

        // Simulate: 2 retries before success
        await recorder.recordRetry("rate_limit", 1, true);
        await recorder.recordRetry("timeout", 2, true);
        await recorder.recordToken("Finally", 0);
        await recorder.recordComplete("Finally", 1);

        const replayer = createEventReplayer(store);

        // Replay and verify retry count is deterministic
        const state = await replayer.replayToState(streamId);
        expect(state.retryAttempts).toBe(2);
        expect(state.content).toBe("Finally");

        // Replay again - same result
        const state2 = await replayer.replayToState(streamId);
        expect(state2.retryAttempts).toBe(2);
        expect(state2.content).toBe("Finally");
      },
      LLM_TIMEOUT,
    );

    it(
      "should deterministically replay continuation",
      async () => {
        const store = createInMemoryEventStore();
        const streamId = "continuation-determinism-" + Date.now();
        const recorder = createEventRecorder(store, streamId);

        await recorder.recordStart({
          prompt: "Write a story",
          continueFromLastKnownGoodToken: true,
        });

        // First attempt - partial
        await recorder.recordToken("Once upon", 0);
        await recorder.recordCheckpoint(1, "Once upon");

        // Network error, continuation triggered
        await recorder.recordContinuation("Once upon", 1);

        // Continued from checkpoint
        await recorder.recordToken(" a time", 1);
        await recorder.recordComplete("Once upon a time", 2);

        const replayer = createEventReplayer(store);
        const state = await replayer.replayToState(streamId);

        // Content should reflect the continuation
        expect(state.content).toBe("Once upon a time");
        expect(state.checkpoint).toBe("Once upon");
      },
      LLM_TIMEOUT,
    );
  });

  describe("Out-of-Order Events Detection", () => {
    it(
      "should detect duplicate sequence numbers",
      async () => {
        const store = createInMemoryEventStore();
        const streamId = "duplicate-seq-" + Date.now();

        // Manually inject events with duplicate sequences
        await store.append(streamId, {
          type: "START",
          ts: Date.now(),
          options: { prompt: "Test" },
        });
        await store.append(streamId, {
          type: "TOKEN",
          ts: Date.now(),
          value: "A",
          index: 0,
        });
        await store.append(streamId, {
          type: "TOKEN",
          ts: Date.now(),
          value: "B",
          index: 1,
        });

        const events = await store.getEvents(streamId);

        // Verify sequence numbers are assigned correctly by the store
        expect(events[0]!.seq).toBe(0);
        expect(events[1]!.seq).toBe(1);
        expect(events[2]!.seq).toBe(2);

        // Sequences should be strictly increasing
        for (let i = 1; i < events.length; i++) {
          expect(events[i]!.seq).toBeGreaterThan(events[i - 1]!.seq);
        }
      },
      LLM_TIMEOUT,
    );

    it(
      "should detect missing START event",
      async () => {
        const store = createInMemoryEventStore();
        const streamId = "missing-start-" + Date.now();

        // Record tokens without START
        await store.append(streamId, {
          type: "TOKEN",
          ts: Date.now(),
          value: "orphan",
          index: 0,
        });

        const events = await store.getEvents(streamId);

        // Validation: first event should be START for valid stream
        const hasStart = events.some((e) => e.event.type === "START");
        expect(hasStart).toBe(false); // This is an invalid stream

        // Replayer should still work but state may be incomplete
        const replayer = createEventReplayer(store);
        const state = await replayer.replayToState(streamId);

        expect(state.content).toBe("orphan");
        expect(state.startTs).toBe(0); // No start timestamp
      },
      LLM_TIMEOUT,
    );

    it(
      "should validate token index continuity",
      async () => {
        const store = createInMemoryEventStore();
        const streamId = "token-gap-" + Date.now();
        const recorder = createEventRecorder(store, streamId);

        await recorder.recordStart({ prompt: "Test" });
        await recorder.recordToken("A", 0);
        await recorder.recordToken("B", 1);
        // Gap: skipping index 2
        await recorder.recordToken("D", 3);

        const events = await store.getEvents(streamId);
        const tokenEvents = events.filter((e) => e.event.type === "TOKEN");

        // Check for index gaps
        const indices = tokenEvents.map((e) => {
          if (e.event.type === "TOKEN") return e.event.index;
          return -1;
        });

        // Detect gap: indices should be [0, 1, 3] - gap at 2
        expect(indices).toEqual([0, 1, 3]);

        // Verify gap exists
        const hasGap = indices.some(
          (idx, i) => i > 0 && idx !== indices[i - 1]! + 1,
        );
        expect(hasGap).toBe(true);
      },
      LLM_TIMEOUT,
    );
  });

  describe("Multi-Stream Pipeline Replay", () => {
    it(
      "should replay multiple related streams (simulated pipeline)",
      async () => {
        const store = createInMemoryEventStore();
        const pipelineId = "pipeline-" + Date.now();

        // Simulate a 2-step pipeline: extract -> transform
        // Each step is a separate stream linked by pipeline ID

        // Step 1: Extract
        const extractStreamId = `${pipelineId}-extract`;
        const extractRecorder = createEventRecorder(store, extractStreamId);
        await extractRecorder.recordStart({
          prompt: "Extract data",
          metadata: { pipelineId, step: 1 },
        });
        await extractRecorder.recordToken("raw data", 0);
        await extractRecorder.recordComplete("raw data", 1);

        // Step 2: Transform (depends on step 1)
        const transformStreamId = `${pipelineId}-transform`;
        const transformRecorder = createEventRecorder(store, transformStreamId);
        await transformRecorder.recordStart({
          prompt: "Transform: raw data",
          metadata: { pipelineId, step: 2, dependsOn: extractStreamId },
        });
        await transformRecorder.recordToken("TRANSFORMED DATA", 0);
        await transformRecorder.recordComplete("TRANSFORMED DATA", 1);

        // Replay both streams
        const replayer = createEventReplayer(store);

        const extractState = await replayer.replayToState(extractStreamId);
        const transformState = await replayer.replayToState(transformStreamId);

        // Verify pipeline execution order preserved
        expect(extractState.content).toBe("raw data");
        expect(transformState.content).toBe("TRANSFORMED DATA");

        // Both should be complete
        expect(extractState.completed).toBe(true);
        expect(transformState.completed).toBe(true);
      },
      LLM_TIMEOUT,
    );

    it(
      "should replay parallel streams (fan-out pattern)",
      async () => {
        const store = createInMemoryEventStore();
        const fanOutId = "fanout-" + Date.now();

        // Simulate parallel execution: 3 concurrent streams
        const streamIds = [
          `${fanOutId}-branch-1`,
          `${fanOutId}-branch-2`,
          `${fanOutId}-branch-3`,
        ];

        // Record all three "parallel" streams
        for (let i = 0; i < 3; i++) {
          const recorder = createEventRecorder(store, streamIds[i]!);
          await recorder.recordStart({
            prompt: `Branch ${i + 1}`,
            metadata: { fanOutId, branchIndex: i },
          });
          await recorder.recordToken(`Result ${i + 1}`, 0);
          await recorder.recordComplete(`Result ${i + 1}`, 1);
        }

        // Replay all branches
        const replayer = createEventReplayer(store);
        const results: string[] = [];

        for (const streamId of streamIds) {
          const state = await replayer.replayToState(streamId);
          results.push(state.content);
        }

        // All branches should replay correctly
        expect(results).toEqual(["Result 1", "Result 2", "Result 3"]);
      },
      LLM_TIMEOUT,
    );

    it(
      "should replay consensus pattern with multiple votes",
      async () => {
        const store = createInMemoryEventStore();
        const consensusId = "consensus-" + Date.now();

        // Simulate consensus: 3 models vote
        const voteStreamIds = [
          `${consensusId}-vote-1`,
          `${consensusId}-vote-2`,
          `${consensusId}-vote-3`,
        ];

        const votes = ["yes", "yes", "no"];

        for (let i = 0; i < 3; i++) {
          const recorder = createEventRecorder(store, voteStreamIds[i]!);
          await recorder.recordStart({
            prompt: "Vote yes or no",
            metadata: { consensusId, voteIndex: i },
          });
          await recorder.recordToken(votes[i]!, 0);
          await recorder.recordComplete(votes[i]!, 1);
        }

        // Replay all votes
        const replayer = createEventReplayer(store);
        const replayedVotes: string[] = [];

        for (const streamId of voteStreamIds) {
          const state = await replayer.replayToState(streamId);
          replayedVotes.push(state.content);
        }

        // Votes should match original
        expect(replayedVotes).toEqual(votes);

        // Deterministic consensus: 2 yes, 1 no = yes wins
        const yesCount = replayedVotes.filter((v) => v === "yes").length;
        const noCount = replayedVotes.filter((v) => v === "no").length;
        expect(yesCount).toBe(2);
        expect(noCount).toBe(1);
      },
      LLM_TIMEOUT,
    );
  });

  describe("Repair Replay", () => {
    it(
      "should replay guardrail violation and repair sequence",
      async () => {
        const store = createInMemoryEventStore();
        const streamId = "repair-replay-" + Date.now();
        const recorder = createEventRecorder(store, streamId);

        await recorder.recordStart({
          prompt: "Generate JSON",
          guardrailCount: 1,
        });

        // Initial tokens (malformed JSON)
        await recorder.recordToken('{"name":', 0);
        await recorder.recordToken(" ", 1);
        await recorder.recordToken('"test"', 2);
        // Missing closing brace

        // Guardrail detected violation
        await recorder.recordGuardrail(3, {
          violations: [
            {
              rule: "json-syntax",
              message: "Unclosed brace",
              severity: "error",
              position: 3,
              recoverable: true,
            },
          ],
          shouldRetry: true,
          shouldHalt: false,
        });

        // Retry triggered
        await recorder.recordRetry("guardrail_violation", 1, true);

        // Repaired output
        await recorder.recordToken('{"name": "test"}', 3);
        await recorder.recordComplete('{"name": "test"}', 4);

        const replayer = createEventReplayer(store);
        const state = await replayer.replayToState(streamId);

        // Should have the repaired version
        expect(state.content).toBe('{"name": "test"}');
        expect(state.violations.length).toBe(1);
        expect(state.violations[0]!.rule).toBe("json-syntax");
        expect(state.retryAttempts).toBe(1);
        expect(state.completed).toBe(true);
      },
      LLM_TIMEOUT,
    );

    it(
      "should replay multiple guardrail checks",
      async () => {
        const store = createInMemoryEventStore();
        const streamId = "multi-guardrail-" + Date.now();
        const recorder = createEventRecorder(store, streamId);

        await recorder.recordStart({ prompt: "Test" });

        await recorder.recordToken("Content", 0);

        // First guardrail check - passed
        await recorder.recordGuardrail(1, {
          violations: [],
          shouldRetry: false,
          shouldHalt: false,
        });

        await recorder.recordToken(" more", 1);

        // Second guardrail check - violation detected
        await recorder.recordGuardrail(2, {
          violations: [
            {
              rule: "content-policy",
              message: "Potential issue",
              severity: "warning",
              position: 2,
              recoverable: false,
            },
          ],
          shouldRetry: false,
          shouldHalt: false,
        });

        await recorder.recordToken(" content", 2);
        await recorder.recordComplete("Content more content", 3);

        const replayer = createEventReplayer(store);
        const state = await replayer.replayToState(streamId);

        // Should have recorded the violation
        expect(state.violations.length).toBe(1);
        expect(state.content).toBe("Content more content");
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
          model: "gpt-5-nano",
        });

        const result = await l0({
          stream: () =>
            streamText({
              model: openai("gpt-5-nano"),
              prompt: "Write a haiku about coding.",
            }),
        });

        let tokenIndex = 0;
        let lastCheckpoint = "";
        for await (const event of result.stream) {
          if (event.type === "token") {
            await recorder.recordToken(event.value!, tokenIndex);
            lastCheckpoint += event.value!;

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
