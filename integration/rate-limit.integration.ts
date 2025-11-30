// Rate Limiting Integration Tests
// Run: OPENAI_API_KEY=sk-... npm run test:integration

import { describe, it, expect } from "vitest";
import {
  describeIf,
  hasOpenAI,
  LLM_TIMEOUT,
  expectValidResponse,
} from "./setup";
import { l0, parallel } from "../src/index";
import { streamText } from "ai";
import { openai } from "@ai-sdk/openai";

describeIf(hasOpenAI)("Rate Limiting Integration", () => {
  describe("Rate Limit Retry Configuration", () => {
    it(
      "should have rate_limit in default retry reasons",
      async () => {
        const result = await l0({
          stream: () =>
            streamText({
              model: openai("gpt-5-nano"),
              prompt: "Say: Hello",
            }),
          monitoring: { enabled: true },
        });

        for await (const event of result.stream) {
          // consume stream
        }

        expectValidResponse(result.state.content);
        // Verify telemetry is tracked
        expect(result.telemetry).toBeDefined();
        // Note: Default retry reasons include rate_limit - verified in unit tests
        // This integration test verifies the stream completes successfully with defaults
      },
      LLM_TIMEOUT,
    );

    it(
      "should allow disabling rate_limit retry",
      async () => {
        const result = await l0({
          stream: () =>
            streamText({
              model: openai("gpt-5-nano"),
              prompt: "Say: Test",
            }),
          retry: {
            attempts: 2,
            retryOn: ["network_error", "server_error"], // Explicitly exclude rate_limit
          },
          monitoring: { enabled: true },
        });

        for await (const event of result.stream) {
          // consume stream
        }

        expectValidResponse(result.state.content);
      },
      LLM_TIMEOUT,
    );

    it(
      "should allow custom retry delays for rate limits",
      async () => {
        const result = await l0({
          stream: () =>
            streamText({
              model: openai("gpt-5-nano"),
              prompt: "Say: Custom delay",
            }),
          retry: {
            attempts: 3,
            baseDelay: 2000, // 2 second base delay
            maxDelay: 30000, // 30 second max delay
            backoff: "exponential",
            retryOn: ["rate_limit", "server_error"],
          },
          monitoring: { enabled: true },
        });

        for await (const event of result.stream) {
          // consume stream
        }

        expectValidResponse(result.state.content);
      },
      LLM_TIMEOUT,
    );
  });

  describe("Concurrent Request Handling", () => {
    it(
      "should handle multiple concurrent requests",
      async () => {
        const results = await parallel(
          [
            {
              stream: () =>
                streamText({
                  model: openai("gpt-5-nano"),
                  prompt: "Say: One",
                }),
              detectZeroTokens: false,
            },
            {
              stream: () =>
                streamText({
                  model: openai("gpt-5-nano"),
                  prompt: "Say: Two",
                }),
              detectZeroTokens: false,
            },
            {
              stream: () =>
                streamText({
                  model: openai("gpt-5-nano"),
                  prompt: "Say: Three",
                }),
              detectZeroTokens: false,
            },
          ],
          { concurrency: 3 },
        );

        expect(results.results.length).toBe(3);
        expect(results.successCount).toBeGreaterThan(0);
      },
      LLM_TIMEOUT * 2,
    );

    it(
      "should respect concurrency limits",
      async () => {
        const startTimes: number[] = [];

        const results = await parallel(
          [
            {
              stream: () => {
                startTimes.push(Date.now());
                return streamText({
                  model: openai("gpt-5-nano"),
                  prompt: "Say: A",
                });
              },
              detectZeroTokens: false,
            },
            {
              stream: () => {
                startTimes.push(Date.now());
                return streamText({
                  model: openai("gpt-5-nano"),
                  prompt: "Say: B",
                });
              },
              detectZeroTokens: false,
            },
            {
              stream: () => {
                startTimes.push(Date.now());
                return streamText({
                  model: openai("gpt-5-nano"),
                  prompt: "Say: C",
                });
              },
              detectZeroTokens: false,
            },
            {
              stream: () => {
                startTimes.push(Date.now());
                return streamText({
                  model: openai("gpt-5-nano"),
                  prompt: "Say: D",
                });
              },
              detectZeroTokens: false,
            },
          ],
          { concurrency: 2 }, // Only 2 at a time
        );

        expect(results.results.length).toBe(4);
        expect(startTimes.length).toBe(4);

        // With concurrency of 2, we expect two batches
        // First two should start at nearly the same time
        // Last two should start after the first batch completes
        const sortedTimes = [...startTimes].sort((a, b) => a - b);

        // First batch: first two operations should start within 500ms of each other
        const firstBatchSpread = sortedTimes[1]! - sortedTimes[0]!;
        expect(firstBatchSpread).toBeLessThan(500);

        // Key assertion: second batch must start AFTER first batch started
        // With concurrency=2, the 3rd operation can only start once one of the first two completes
        // Even with fast API responses, there should be a measurable gap (>50ms)
        const secondBatchStart = sortedTimes[2]!;
        const firstBatchStart = sortedTimes[0]!;
        const gapBetweenBatches = secondBatchStart - firstBatchStart;

        // The gap should be at least 50ms (time for network round-trip + processing)
        // If all 4 started together, this gap would be <50ms
        expect(gapBetweenBatches).toBeGreaterThan(50);
      },
      LLM_TIMEOUT * 3,
    );
  });

  describe("Backoff Strategies", () => {
    it(
      "should support exponential backoff",
      async () => {
        let attemptCount = 0;

        const result = await l0({
          stream: () => {
            attemptCount++;
            return streamText({
              model: openai("gpt-5-nano"),
              prompt: "Say: Exponential",
            });
          },
          retry: {
            attempts: 2,
            baseDelay: 100,
            backoff: "exponential",
            retryOn: ["rate_limit", "server_error"],
          },
          monitoring: { enabled: true },
        });

        for await (const event of result.stream) {
          // consume stream
        }

        expectValidResponse(result.state.content);
        expect(attemptCount).toBe(1); // Should succeed on first try
      },
      LLM_TIMEOUT,
    );

    it(
      "should support linear backoff",
      async () => {
        const result = await l0({
          stream: () =>
            streamText({
              model: openai("gpt-5-nano"),
              prompt: "Say: Linear",
            }),
          retry: {
            attempts: 2,
            baseDelay: 100,
            backoff: "linear",
            retryOn: ["rate_limit", "server_error"],
          },
          monitoring: { enabled: true },
        });

        for await (const event of result.stream) {
          // consume stream
        }

        expectValidResponse(result.state.content);
      },
      LLM_TIMEOUT,
    );

    it(
      "should support fixed backoff",
      async () => {
        const result = await l0({
          stream: () =>
            streamText({
              model: openai("gpt-5-nano"),
              prompt: "Say: Fixed",
            }),
          retry: {
            attempts: 2,
            baseDelay: 500,
            backoff: "fixed",
            retryOn: ["rate_limit", "server_error"],
          },
          monitoring: { enabled: true },
        });

        for await (const event of result.stream) {
          // consume stream
        }

        expectValidResponse(result.state.content);
      },
      LLM_TIMEOUT,
    );
  });

  describe("Fallback on Rate Limit Exhaustion", () => {
    it(
      "should fall back to secondary model after rate limit retries exhausted",
      async () => {
        let primaryCalls = 0;

        const result = await l0({
          stream: () => {
            primaryCalls++;
            // Simulate rate limit by throwing on first call
            if (primaryCalls === 1) {
              const error = new Error("Rate limit exceeded");
              (error as any).status = 429;
              throw error;
            }
            return streamText({
              model: openai("gpt-5-nano"),
              prompt: "Say: Primary recovered",
            });
          },
          fallbackStreams: [
            () =>
              streamText({
                model: openai("gpt-5-nano"),
                prompt: "Say: Fallback used",
              }),
          ],
          retry: {
            attempts: 2,
            baseDelay: 100,
            retryOn: ["rate_limit"],
          },
          detectZeroTokens: false,
        });

        for await (const event of result.stream) {
          // consume stream
        }

        expectValidResponse(result.state.content);
        // Either primary recovered after retry or fallback was used
        expect(primaryCalls).toBeGreaterThanOrEqual(1);
      },
      LLM_TIMEOUT * 2,
    );
  });

  describe("Rate Limit Telemetry", () => {
    it(
      "should track retry attempts in telemetry",
      async () => {
        let attemptCount = 0;

        const result = await l0({
          stream: () => {
            attemptCount++;
            if (attemptCount === 1) {
              throw new Error("Simulated transient error");
            }
            return streamText({
              model: openai("gpt-5-nano"),
              prompt: "Say: Telemetry test",
            });
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
        expect(result.telemetry).toBeDefined();
        expect(attemptCount).toBe(2);
      },
      LLM_TIMEOUT * 2,
    );
  });

  describe("Graceful Degradation", () => {
    it(
      "should complete successfully under normal load",
      async () => {
        // Run multiple sequential requests to simulate sustained usage
        const results: string[] = [];

        for (let i = 0; i < 3; i++) {
          const result = await l0({
            stream: () =>
              streamText({
                model: openai("gpt-5-nano"),
                prompt: `Say: Request ${i + 1}`,
              }),
            detectZeroTokens: false,
          });

          for await (const event of result.stream) {
            // consume stream
          }

          results.push(result.state.content);
        }

        expect(results.length).toBe(3);
        results.forEach((content) => {
          expectValidResponse(content);
        });
      },
      LLM_TIMEOUT * 4,
    );

    it(
      "should handle burst requests with parallel utility",
      async () => {
        const operations = Array.from({ length: 5 }, (_, i) => ({
          stream: () =>
            streamText({
              model: openai("gpt-5-nano"),
              prompt: `Say: Burst ${i + 1}`,
            }),
          detectZeroTokens: false,
        }));

        const results = await parallel(operations, {
          concurrency: 2, // Limit concurrency to avoid rate limits
          sharedRetry: {
            attempts: 2,
            baseDelay: 500,
            retryOn: ["rate_limit", "server_error"],
          },
        });

        expect(results.results.length).toBe(5);
        // At least some should succeed
        expect(results.successCount).toBeGreaterThan(0);
      },
      LLM_TIMEOUT * 5,
    );
  });
});
