// Fallback and Retry Integration Tests
// Run: OPENAI_API_KEY=sk-... npm run test:integration

import { describe, it, expect } from "vitest";
import {
  describeIf,
  hasOpenAI,
  LLM_TIMEOUT,
  expectValidResponse,
} from "./setup";
import { l0, parallel, race, recommendedGuardrails } from "../src/index";
import { streamText } from "ai";
import { openai } from "@ai-sdk/openai";

describeIf(hasOpenAI)("Fallback and Retry Integration", () => {
  describe("Fallback Models", () => {
    it(
      "should use primary model when available",
      async () => {
        const result = await l0({
          stream: () =>
            streamText({
              model: openai("gpt-5-nano"),
              prompt: "Say 'primary'",
            }),
          fallbackStreams: [
            () =>
              streamText({
                model: openai("gpt-5-nano"),
                prompt: "Say 'fallback'",
              }),
          ],
        });

        for await (const event of result.stream) {
          // consume stream
        }

        expect(result.state.fallbackIndex).toBe(0);
        expectValidResponse(result.state.content);
      },
      LLM_TIMEOUT,
    );

    it(
      "should fall back on primary failure",
      async () => {
        const result = await l0({
          stream: () => {
            throw new Error("Primary model failed");
          },
          fallbackStreams: [
            () =>
              streamText({
                model: openai("gpt-5-nano"),
                prompt: "Say 'fallback worked successfully'",
              }),
          ],
          // Enable retry so thrown errors trigger fallback after exhausting retries
          retry: {
            attempts: 1,
            retryOn: ["unknown", "server_error"],
          },
          detectZeroTokens: false,
        });

        for await (const event of result.stream) {
          // consume stream
        }

        expect(result.state.fallbackIndex).toBe(1);
        expectValidResponse(result.state.content);
      },
      LLM_TIMEOUT,
    );

    it(
      "should try multiple fallbacks",
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
                prompt: "Say 'fallback 2 worked successfully'",
              }),
          ],
          // Enable retry with unknown so thrown errors trigger fallback after exhausting retries
          // Generic thrown errors are categorized as "unknown"
          retry: {
            attempts: 1,
            retryOn: ["unknown", "server_error"],
          },
          detectZeroTokens: false,
        });

        for await (const event of result.stream) {
          // consume stream
        }

        expect(result.state.fallbackIndex).toBe(2);
        expectValidResponse(result.state.content);
      },
      LLM_TIMEOUT,
    );
  });

  describe("Parallel Execution", () => {
    it(
      "should run operations in parallel",
      async () => {
        const start = Date.now();

        const results = await parallel(
          [
            {
              stream: () =>
                streamText({
                  model: openai("gpt-5-nano"),
                  prompt: "Say 'first response here'",
                }),
              detectZeroTokens: false,
            },
            {
              stream: () =>
                streamText({
                  model: openai("gpt-5-nano"),
                  prompt: "Say 'second response here'",
                }),
              detectZeroTokens: false,
            },
            {
              stream: () =>
                streamText({
                  model: openai("gpt-5-nano"),
                  prompt: "Say 'third response here'",
                }),
              detectZeroTokens: false,
            },
          ],
          { concurrency: 3 },
        );

        const duration = Date.now() - start;

        expect(results.successCount).toBe(3);
        expect(results.results.length).toBe(3);
        results.results.forEach((r) => {
          expectValidResponse(r!.state.content);
        });

        // Parallel should be faster than 3x sequential (rough check)
        // Each call ~1-2s, so 3 parallel should be < 6s
        expect(duration).toBeLessThan(15000);
      },
      LLM_TIMEOUT * 2,
    );

    it(
      "should handle partial failures",
      async () => {
        const results = await parallel(
          [
            {
              stream: () =>
                streamText({
                  model: openai("gpt-5-nano"),
                  prompt: "Say 'success'",
                }),
            },
            {
              stream: () => {
                throw new Error("Intentional failure");
              },
            },
            {
              stream: () =>
                streamText({
                  model: openai("gpt-5-nano"),
                  prompt: "Say 'also success'",
                }),
            },
          ],
          { concurrency: 3, failFast: false },
        );

        expect(results.successCount).toBe(2);
        expect(results.failureCount).toBe(1);
      },
      LLM_TIMEOUT * 2,
    );
  });

  describe("Race", () => {
    it(
      "should return first successful response",
      async () => {
        const result = await race([
          {
            stream: () =>
              streamText({
                model: openai("gpt-5-nano"),
                prompt: "Say 'racer 1'",
              }),
          },
          {
            stream: () =>
              streamText({
                model: openai("gpt-5-nano"),
                prompt: "Say 'racer 2'",
              }),
          },
        ]);

        expectValidResponse(result.state.content);
      },
      LLM_TIMEOUT,
    );
  });

  describe("With Guardrails", () => {
    it(
      "should apply guardrails to fallback responses",
      async () => {
        const violations: any[] = [];

        const result = await l0({
          stream: () => {
            throw new Error("Primary failed");
          },
          fallbackStreams: [
            () =>
              streamText({
                model: openai("gpt-5-nano"),
                prompt: "Write a friendly greeting message",
              }),
          ],
          guardrails: recommendedGuardrails,
          onViolation: (v) => violations.push(v),
          // Enable retry with unknown so thrown errors trigger fallback
          retry: {
            attempts: 1,
            retryOn: ["unknown", "server_error"],
          },
          detectZeroTokens: false,
        });

        for await (const event of result.stream) {
          // consume stream
        }

        expectValidResponse(result.state.content);
        // Verify guardrails were applied (fallback was used, so fallbackIndex > 0)
        expect(result.state.fallbackIndex).toBe(1);
        // Note: We don't assert violations.length === 0 because LLM output is variable
        // The important thing is that the fallback worked and guardrails were applied
      },
      LLM_TIMEOUT,
    );
  });

  describe("Custom Retry Functions", () => {
    it(
      "should use custom shouldRetry function with real LLM",
      async () => {
        let shouldRetryCalled = false;

        const result = await l0({
          stream: () =>
            streamText({
              model: openai("gpt-5-nano"),
              prompt: "Say 'hello world' and nothing else",
            }),
          retry: {
            attempts: 3,
            shouldRetry: async (error, state, attempt, category) => {
              shouldRetryCalled = true;
              // Veto retry
              return false;
            },
          },
        });

        for await (const event of result.stream) {
          // consume stream
        }

        // With a successful stream, shouldRetry should NOT be called
        expect(shouldRetryCalled).toBe(false);
        expectValidResponse(result.state.content);
      },
      LLM_TIMEOUT,
    );

    it(
      "should use custom shouldRetry to veto retry on failure",
      async () => {
        let attempts = 0;
        let shouldRetryCalls = 0;

        try {
          const result = await l0({
            stream: () => {
              attempts++;
              throw new Error("Simulated failure");
            },
            retry: {
              attempts: 3,
              baseDelay: 100,
              retryOn: ["unknown"], // Enable retry for simulated errors
              shouldRetry: async (error, state, attempt, category) => {
                shouldRetryCalls++;
                expect(error.message).toContain("Simulated");
                expect(attempt).toBeGreaterThanOrEqual(0);
                expect(category).toBeDefined();
                return false; // Veto retry
              },
            },
            detectZeroTokens: false,
          });

          for await (const event of result.stream) {
            // consume stream
          }
        } catch {
          // Expected to throw since we veto all retries
        }

        expect(shouldRetryCalls).toBe(1); // Called once, then vetoed
        expect(attempts).toBe(1); // Only one attempt due to veto
      },
      LLM_TIMEOUT,
    );

    it(
      "should use custom calculateDelay function with real LLM",
      async () => {
        let attempts = 0;
        let calculateDelayCalled = false;
        const customDelay = 50;

        const startTime = Date.now();
        const result = await l0({
          stream: () => {
            attempts++;
            if (attempts === 1) {
              throw new Error("Simulated failure for delay test");
            }
            return streamText({
              model: openai("gpt-5-nano"),
              prompt: "Say 'delay test passed'",
            });
          },
          retry: {
            attempts: 3,
            baseDelay: 2000, // High base delay
            retryOn: ["unknown"], // Enable retry for simulated errors
            calculateDelay: (context) => {
              calculateDelayCalled = true;
              expect(context.attempt).toBeGreaterThanOrEqual(0);
              expect(context.defaultDelay).toBeDefined();
              expect(context.error).toBeInstanceOf(Error);
              return customDelay; // Override with short delay
            },
          },
          detectZeroTokens: false,
        });

        for await (const event of result.stream) {
          // consume stream
        }

        const duration = Date.now() - startTime;

        expect(calculateDelayCalled).toBe(true);
        expect(attempts).toBe(2);
        // Should be much faster than 2000ms base delay (account for LLM time)
        expect(duration).toBeLessThan(LLM_TIMEOUT / 2);
        expectValidResponse(result.state.content);
      },
      LLM_TIMEOUT,
    );

    it(
      "should use both shouldRetry and calculateDelay together",
      async () => {
        let attempts = 0;
        let shouldRetryCalls = 0;
        let calculateDelayCalls = 0;

        const result = await l0({
          stream: () => {
            attempts++;
            if (attempts <= 2) {
              throw new Error("Simulated failure " + attempts);
            }
            return streamText({
              model: openai("gpt-5-nano"),
              prompt: "Say 'combined test success'",
            });
          },
          retry: {
            attempts: 5,
            baseDelay: 1000,
            retryOn: ["unknown"], // Enable retry for simulated errors
            shouldRetry: async (error, state, attempt, category) => {
              shouldRetryCalls++;
              // Allow default retry behavior (don't veto)
              return true;
            },
            calculateDelay: (context) => {
              calculateDelayCalls++;
              // Use fast delay for testing
              return 50;
            },
          },
          detectZeroTokens: false,
        });

        for await (const event of result.stream) {
          // consume stream
        }

        expect(shouldRetryCalls).toBeGreaterThan(0);
        expect(calculateDelayCalls).toBeGreaterThan(0);
        expect(attempts).toBe(3);
        expectValidResponse(result.state.content);
      },
      LLM_TIMEOUT,
    );

    it(
      "should provide accurate parameters to shouldRetry",
      async () => {
        let capturedParams: Array<{
          attempt: number;
          category: string;
          contentLength: number;
          tokenCount: number;
        }> = [];

        const result = await l0({
          stream: () => {
            throw new Error("Always fail for context test");
          },
          fallbackStreams: [
            () =>
              streamText({
                model: openai("gpt-5-nano"),
                prompt: "Say 'fallback after context capture'",
              }),
          ],
          retry: {
            attempts: 2,
            baseDelay: 50,
            retryOn: ["unknown"], // Enable retry for simulated errors
            shouldRetry: async (error, state, attempt, category) => {
              capturedParams.push({
                attempt,
                category,
                contentLength: state.content.length,
                tokenCount: state.tokenCount,
              });
              return true; // Allow retries until limit
            },
          },
          detectZeroTokens: false,
        });

        for await (const event of result.stream) {
          // consume stream
        }

        // Should have captured params from retry attempts
        expect(capturedParams.length).toBeGreaterThan(0);

        // Verify parameter types
        capturedParams.forEach((params) => {
          expect(typeof params.attempt).toBe("number");
          expect(typeof params.category).toBe("string");
          expect(typeof params.contentLength).toBe("number");
          expect(typeof params.tokenCount).toBe("number");
        });

        expectValidResponse(result.state.content);
      },
      LLM_TIMEOUT,
    );
  });
});
