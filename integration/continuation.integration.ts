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
      "should continue from checkpoint when stream fails mid-way and retries",
      async () => {
        let attemptCount = 0;
        const tokensBeforeFailure = ["Hello", " ", "World", "!"];

        const result = await l0({
          stream: () => {
            attemptCount++;
            if (attemptCount === 1) {
              // First attempt - stream some tokens then fail
              return {
                textStream: (async function* () {
                  for (const token of tokensBeforeFailure) {
                    yield token;
                  }
                  // Fail after streaming tokens to create a checkpoint
                  throw new Error("Simulated mid-stream network error");
                })(),
              };
            }
            // Second attempt - succeed with continuation
            return streamText({
              model: openai("gpt-5-nano"),
              prompt: "Say: Continuation complete",
            });
          },
          continueFromLastKnownGoodToken: true,
          checkIntervals: {
            checkpoint: 2, // Save checkpoint every 2 tokens
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
        // Continuation should have been used since we had a checkpoint
        expect(result.state.continuedFromCheckpoint).toBe(true);
        expect(result.telemetry?.continuation?.enabled).toBe(true);
        expect(result.telemetry?.continuation?.used).toBe(true);
      },
      LLM_TIMEOUT * 2,
    );

    it(
      "should not use continuation when error occurs before any tokens",
      async () => {
        let attemptCount = 0;

        const result = await l0({
          stream: () => {
            attemptCount++;
            if (attemptCount === 1) {
              // First attempt - throw error immediately before any tokens
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
        // No continuation since no checkpoint existed
        expect(result.state.continuedFromCheckpoint).toBe(false);
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
      "should call buildContinuationPrompt with checkpoint on retry",
      async () => {
        let attemptCount = 0;
        let continuationPromptCalled = false;
        let receivedCheckpoint = "";
        const tokensBeforeFailure = ["The", " ", "quick", " ", "brown"];

        const result = await l0({
          stream: () => {
            attemptCount++;
            if (attemptCount === 1) {
              // First attempt - stream tokens then fail
              return {
                textStream: (async function* () {
                  for (const token of tokensBeforeFailure) {
                    yield token;
                  }
                  throw new Error("Simulated mid-stream failure");
                })(),
              };
            }
            return streamText({
              model: openai("gpt-5-nano"),
              prompt: "Say: Continuation test passed",
            });
          },
          continueFromLastKnownGoodToken: true,
          checkIntervals: {
            checkpoint: 2, // Save checkpoint every 2 tokens
          },
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
        // buildContinuationPrompt should have been called with the checkpoint
        expect(continuationPromptCalled).toBe(true);
        expect(receivedCheckpoint.length).toBeGreaterThan(0);
        // Checkpoint should contain accumulated tokens before failure
        expect(receivedCheckpoint).toContain("The");
      },
      LLM_TIMEOUT * 2,
    );

    it(
      "should not call buildContinuationPrompt when no checkpoint exists",
      async () => {
        let attemptCount = 0;
        let continuationPromptCalled = false;

        const result = await l0({
          stream: () => {
            attemptCount++;
            if (attemptCount === 1) {
              // Fail immediately before any tokens
              throw new Error("Simulated failure");
            }
            return streamText({
              model: openai("gpt-5-nano"),
              prompt: "Say: Success",
            });
          },
          continueFromLastKnownGoodToken: true,
          buildContinuationPrompt: () => {
            continuationPromptCalled = true;
            return "Should not be called";
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
        // buildContinuationPrompt should NOT have been called since no checkpoint
        expect(continuationPromptCalled).toBe(false);
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
      "should track continuation count in telemetry when retries occur with checkpoint",
      async () => {
        let attemptCount = 0;
        const tokensBeforeFailure = [
          "Testing",
          " ",
          "continuation",
          " ",
          "tracking",
        ];

        const result = await l0({
          stream: () => {
            attemptCount++;
            if (attemptCount === 1) {
              // First attempt - stream tokens then fail to create checkpoint
              return {
                textStream: (async function* () {
                  for (const token of tokensBeforeFailure) {
                    yield token;
                  }
                  throw new Error("Simulated mid-stream error");
                })(),
              };
            }
            return streamText({
              model: openai("gpt-5-nano"),
              prompt: "Say: Success after retry",
            });
          },
          continueFromLastKnownGoodToken: true,
          checkIntervals: {
            checkpoint: 2, // Save checkpoint every 2 tokens
          },
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
        // Continuation was actually used since we had tokens before failure
        expect(result.telemetry?.continuation?.used).toBe(true);
        // Continuation count should be at least 1
        expect(
          result.telemetry?.continuation?.continuationCount,
        ).toBeGreaterThanOrEqual(1);
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
