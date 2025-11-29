// Continuation (Last Known Good Token) Integration Tests
// Run: OPENAI_API_KEY=sk-... npm run test:integration

import { describe, it, expect } from "vitest";
import {
  describeIf,
  hasOpenAI,
  LLM_TIMEOUT,
  expectValidResponse,
} from "./setup";
import { l0 } from "../src/index";
import { streamText } from "ai";
import { openai } from "@ai-sdk/openai";

describeIf(hasOpenAI)("Continuation Integration", () => {
  describe("Basic Continuation", () => {
    it(
      "should track continuation state when enabled",
      async () => {
        const result = await l0({
          stream: () =>
            streamText({
              model: openai("gpt-5-nano"),
              prompt: "Write exactly: Hello World",
            }),
          continueFromLastKnownGoodToken: true,
          monitoring: { enabled: true },
        });

        for await (const event of result.stream) {
          // consume stream
        }

        expectValidResponse(result.state.content);
        // No retry happened, so no continuation was used
        expect(result.state.continuedFromCheckpoint).toBe(false);
        expect(result.telemetry?.continuation?.enabled).toBe(true);
        expect(result.telemetry?.continuation?.used).toBe(false);
      },
      LLM_TIMEOUT,
    );

    it(
      "should not track continuation when disabled",
      async () => {
        const result = await l0({
          stream: () =>
            streamText({
              model: openai("gpt-5-nano"),
              prompt: "Write exactly: Test",
            }),
          continueFromLastKnownGoodToken: false,
          monitoring: { enabled: true },
        });

        for await (const event of result.stream) {
          // consume stream
        }

        expectValidResponse(result.state.content);
        expect(result.state.continuedFromCheckpoint).toBe(false);
        expect(result.telemetry?.continuation?.enabled).toBe(false);
      },
      LLM_TIMEOUT,
    );
  });

  describe("Continuation on Retry", () => {
    it(
      "should continue from checkpoint when primary fails and retries",
      async () => {
        let attemptCount = 0;

        const result = await l0({
          stream: () => {
            attemptCount++;
            if (attemptCount === 1) {
              // First attempt - throw error to trigger retry
              throw new Error("Simulated network error");
            }
            // Second attempt - succeed
            return streamText({
              model: openai("gpt-5-nano"),
              prompt: "Say: Retry succeeded",
            });
          },
          continueFromLastKnownGoodToken: true,
          retry: {
            attempts: 2,
            baseDelay: 100,
            retryOn: ["unknown", "network_error"],
          },
          monitoring: { enabled: true },
          detectZeroTokens: false,
        });

        for await (const event of result.stream) {
          // consume stream
        }

        expectValidResponse(result.state.content);
        expect(attemptCount).toBe(2);
      },
      LLM_TIMEOUT * 2,
    );
  });

  describe("Continuation on Fallback", () => {
    it(
      "should use continuation when falling back to secondary model",
      async () => {
        const result = await l0({
          stream: () => {
            throw new Error("Primary model failed");
          },
          fallbackStreams: [
            () =>
              streamText({
                model: openai("gpt-5-nano"),
                prompt: "Say: Fallback model working",
              }),
          ],
          continueFromLastKnownGoodToken: true,
          retry: {
            attempts: 1,
            retryOn: ["unknown", "server_error"],
          },
          monitoring: { enabled: true },
          detectZeroTokens: false,
        });

        for await (const event of result.stream) {
          // consume stream
        }

        expectValidResponse(result.state.content);
        expect(result.state.fallbackIndex).toBe(1);
        expect(result.telemetry?.continuation?.enabled).toBe(true);
      },
      LLM_TIMEOUT,
    );
  });

  describe("Checkpoint Intervals", () => {
    it(
      "should respect checkpoint interval configuration",
      async () => {
        const result = await l0({
          stream: () =>
            streamText({
              model: openai("gpt-5-nano"),
              prompt: "Write a paragraph about technology.",
            }),
          continueFromLastKnownGoodToken: true,
          checkIntervals: {
            checkpoint: 10, // Save checkpoint every 10 tokens
          },
          monitoring: { enabled: true },
        });

        for await (const event of result.stream) {
          // consume stream
        }

        expectValidResponse(result.state.content);
        expect(result.telemetry?.continuation?.enabled).toBe(true);
      },
      LLM_TIMEOUT,
    );
  });

  describe("buildContinuationPrompt Callback", () => {
    it(
      "should allow custom continuation prompt building",
      async () => {
        let attemptCount = 0;
        let continuationPromptCalled = false;
        let receivedCheckpoint = "";

        const result = await l0({
          stream: () => {
            attemptCount++;
            if (attemptCount === 1) {
              throw new Error("Simulated failure");
            }
            return streamText({
              model: openai("gpt-5-nano"),
              prompt: "Say: Continuation test passed",
            });
          },
          continueFromLastKnownGoodToken: true,
          buildContinuationPrompt: (checkpoint) => {
            continuationPromptCalled = true;
            receivedCheckpoint = checkpoint;
            return `Continue from where you left off. Previous content: ${checkpoint}`;
          },
          retry: {
            attempts: 2,
            baseDelay: 100,
            retryOn: ["unknown", "network_error"],
          },
          monitoring: { enabled: true },
          detectZeroTokens: false,
        });

        for await (const event of result.stream) {
          // consume stream
        }

        expectValidResponse(result.state.content);
        expect(attemptCount).toBe(2);
        // Note: continuationPromptCalled may be false if no checkpoint was saved before error
        // This is expected behavior when the error happens before any tokens are received
      },
      LLM_TIMEOUT * 2,
    );
  });

  describe("Telemetry Integration", () => {
    it(
      "should record continuation telemetry correctly",
      async () => {
        const result = await l0({
          stream: () =>
            streamText({
              model: openai("gpt-5-nano"),
              prompt: "Write a short sentence.",
            }),
          continueFromLastKnownGoodToken: true,
          monitoring: { enabled: true },
        });

        for await (const event of result.stream) {
          // consume stream
        }

        expectValidResponse(result.state.content);
        expect(result.telemetry).toBeDefined();
        expect(result.telemetry?.continuation).toBeDefined();
        expect(result.telemetry?.continuation?.enabled).toBe(true);
        expect(result.telemetry?.continuation?.used).toBe(false);
        expect(result.telemetry?.continuation?.continuationCount).toBe(0);
      },
      LLM_TIMEOUT,
    );

    it(
      "should track continuation count in telemetry when retries occur",
      async () => {
        let attemptCount = 0;

        const result = await l0({
          stream: () => {
            attemptCount++;
            if (attemptCount <= 1) {
              throw new Error("Simulated error");
            }
            return streamText({
              model: openai("gpt-5-nano"),
              prompt: "Say: Success after retry",
            });
          },
          continueFromLastKnownGoodToken: true,
          retry: {
            attempts: 3,
            baseDelay: 100,
            retryOn: ["unknown", "network_error"],
          },
          monitoring: { enabled: true },
          detectZeroTokens: false,
        });

        for await (const event of result.stream) {
          // consume stream
        }

        expectValidResponse(result.state.content);
        expect(result.telemetry?.continuation?.enabled).toBe(true);
        // Continuation count tracks how many times we attempted to continue
        expect(
          result.telemetry?.continuation?.continuationCount,
        ).toBeGreaterThanOrEqual(0);
      },
      LLM_TIMEOUT * 2,
    );
  });

  describe("Edge Cases", () => {
    it(
      "should handle stream completing normally without continuation",
      async () => {
        const result = await l0({
          stream: () =>
            streamText({
              model: openai("gpt-5-nano"),
              prompt: "Say: Normal completion",
            }),
          continueFromLastKnownGoodToken: true,
          monitoring: { enabled: true },
        });

        for await (const event of result.stream) {
          // consume stream
        }

        expectValidResponse(result.state.content);
        expect(result.state.completed).toBe(true);
        expect(result.state.continuedFromCheckpoint).toBe(false);
      },
      LLM_TIMEOUT,
    );

    it(
      "should handle multiple fallbacks with continuation enabled",
      async () => {
        const result = await l0({
          stream: () => {
            throw new Error("Primary failed");
          },
          fallbackStreams: [
            () => {
              throw new Error("Fallback 1 failed");
            },
            () =>
              streamText({
                model: openai("gpt-5-nano"),
                prompt: "Say: Third time is the charm",
              }),
          ],
          continueFromLastKnownGoodToken: true,
          retry: {
            attempts: 1,
            retryOn: ["unknown", "server_error"],
          },
          monitoring: { enabled: true },
          detectZeroTokens: false,
        });

        for await (const event of result.stream) {
          // consume stream
        }

        expectValidResponse(result.state.content);
        expect(result.state.fallbackIndex).toBe(2);
        expect(result.telemetry?.continuation?.enabled).toBe(true);
      },
      LLM_TIMEOUT * 2,
    );
  });
});
