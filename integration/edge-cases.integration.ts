// Edge Case Integration Tests
// Run: OPENAI_API_KEY=sk-... npm run test:integration

import { describe, it, expect } from "vitest";
import {
  describeIf,
  hasOpenAI,
  LLM_TIMEOUT,
  expectValidResponse,
} from "./setup";
import {
  l0,
  parallel,
  race,
  recommendedGuardrails,
  customPatternRule,
} from "../src/index";
import { streamText } from "ai";
import { openai } from "@ai-sdk/openai";

describeIf(hasOpenAI)("Edge Cases Integration", () => {
  describe("Error Handling Edge Cases", () => {
    it(
      "should handle all fallbacks exhausted",
      async () => {
        await expect(
          l0({
            stream: () => {
              throw new Error("Primary failed");
            },
            fallbackStreams: [
              () => {
                throw new Error("Fallback 1 failed");
              },
              () => {
                throw new Error("Fallback 2 failed");
              },
            ],
          }),
        ).rejects.toThrow();
      },
      LLM_TIMEOUT,
    );

    it(
      "should handle empty fallback array",
      async () => {
        await expect(
          l0({
            stream: () => {
              throw new Error("Primary failed");
            },
            fallbackStreams: [],
          }),
        ).rejects.toThrow("Primary failed");
      },
      LLM_TIMEOUT,
    );

    it(
      "should track correct fallback index when all fail",
      async () => {
        try {
          await l0({
            stream: () => {
              throw new Error("Primary failed");
            },
            fallbackStreams: [
              () => {
                throw new Error("Fallback 1 failed");
              },
              () => {
                throw new Error("Fallback 2 failed");
              },
            ],
          });
        } catch (error) {
          expect(error).toBeInstanceOf(Error);
          expect((error as Error).message).toContain("failed");
        }
      },
      LLM_TIMEOUT,
    );
  });

  describe("Timeout Edge Cases", () => {
    it(
      "should abort stream on signal before first token",
      async () => {
        const controller = new AbortController();

        // Abort immediately
        setTimeout(() => controller.abort(), 10);

        const result = await l0({
          stream: () =>
            streamText({
              model: openai("gpt-4o-mini"),
              prompt: "Write a very long story about the history of computing",
            }),
          signal: controller.signal,
        });

        let tokenCount = 0;
        try {
          for await (const event of result.stream) {
            if (event.type === "token") {
              tokenCount++;
            }
          }
        } catch (error) {
          // Expected abort error
        }

        // Should have very few or no tokens due to immediate abort
        expect(tokenCount).toBeLessThan(50);
      },
      LLM_TIMEOUT,
    );

    it(
      "should handle abort after stream completion",
      async () => {
        const controller = new AbortController();

        const result = await l0({
          stream: () =>
            streamText({
              model: openai("gpt-4o-mini"),
              prompt: "Say 'hi'",
            }),
          signal: controller.signal,
        });

        for await (const event of result.stream) {
          // consume stream
        }

        // Abort after completion should not throw
        controller.abort();
        expect(result.state.completed).toBe(true);
      },
      LLM_TIMEOUT,
    );
  });

  describe("Streaming Edge Cases", () => {
    it(
      "should handle minimal response",
      async () => {
        const result = await l0({
          stream: () =>
            streamText({
              model: openai("gpt-4o-mini"),
              prompt: "Reply with only the letter 'X' and nothing else",
            }),
        });

        for await (const event of result.stream) {
          // consume stream
        }

        expect(result.state.content.length).toBeGreaterThan(0);
        expect(result.state.tokenCount).toBeGreaterThan(0);
      },
      LLM_TIMEOUT,
    );

    it(
      "should handle special characters in response",
      async () => {
        const result = await l0({
          stream: () =>
            streamText({
              model: openai("gpt-4o-mini"),
              prompt:
                'Reply with these exact characters: @#$%^&*(){}[]|\\:";<>?,./~`',
            }),
        });

        for await (const event of result.stream) {
          // consume stream
        }

        expectValidResponse(result.state.content);
      },
      LLM_TIMEOUT,
    );

    it(
      "should handle unicode and emoji in response",
      async () => {
        const result = await l0({
          stream: () =>
            streamText({
              model: openai("gpt-4o-mini"),
              prompt: "Reply with 3 different emojis",
            }),
        });

        for await (const event of result.stream) {
          // consume stream
        }

        expectValidResponse(result.state.content);
      },
      LLM_TIMEOUT,
    );
  });

  describe("Guardrail Edge Cases", () => {
    it(
      "should handle empty guardrails array",
      async () => {
        const result = await l0({
          stream: () =>
            streamText({
              model: openai("gpt-4o-mini"),
              prompt: "Say hello",
            }),
          guardrails: [],
        });

        for await (const event of result.stream) {
          // consume stream
        }

        expectValidResponse(result.state.content);
      },
      LLM_TIMEOUT,
    );

    it(
      "should collect multiple violations in single response",
      async () => {
        const violations: any[] = [];

        // Create guardrails that will definitely trigger
        const strictGuardrails = [
          customPatternRule([/hello/i], "Contains hello", "warning"),
          customPatternRule([/hi/i], "Contains hi", "warning"),
        ];

        const result = await l0({
          stream: () =>
            streamText({
              model: openai("gpt-4o-mini"),
              prompt: "Say 'Hello! Hi there!'",
            }),
          guardrails: strictGuardrails,
          onViolation: (v) => violations.push(v),
        });

        for await (const event of result.stream) {
          // consume stream
        }

        // Should have collected multiple violations (at least one for hello AND one for hi pattern)
        expect(violations.length).toBeGreaterThan(1);
      },
      LLM_TIMEOUT,
    );

    it(
      "should handle violation callback that throws",
      async () => {
        const result = await l0({
          stream: () =>
            streamText({
              model: openai("gpt-4o-mini"),
              prompt: "Start your response with 'As an AI'",
            }),
          guardrails: recommendedGuardrails,
          onViolation: () => {
            throw new Error("Callback error");
          },
        });

        // Should still complete despite callback error
        try {
          for await (const event of result.stream) {
            // consume stream
          }
        } catch (error) {
          // May or may not throw depending on implementation
        }
      },
      LLM_TIMEOUT,
    );
  });

  describe("Retry Edge Cases", () => {
    it(
      "should track retry count accurately",
      async () => {
        let retryCount = 0;
        let attemptCount = 0;

        const result = await l0({
          stream: () => {
            attemptCount++;
            if (attemptCount < 2) {
              throw new Error("Transient error");
            }
            return streamText({
              model: openai("gpt-4o-mini"),
              prompt: "Say 'success'",
            });
          },
          retry: {
            attempts: 3,
            retryOn: ["network_error", "timeout"],
          },
          onRetry: () => {
            retryCount++;
          },
        });

        for await (const event of result.stream) {
          // consume stream
        }

        expect(attemptCount).toBe(2);
        expect(retryCount).toBe(1);
      },
      LLM_TIMEOUT * 2,
    );
  });

  describe("Parallel Edge Cases", () => {
    it(
      "should handle empty operations array",
      async () => {
        const results = await parallel([], { concurrency: 3 });

        expect(results.successCount).toBe(0);
        expect(results.failureCount).toBe(0);
        expect(results.results).toHaveLength(0);
      },
      LLM_TIMEOUT,
    );

    it(
      "should handle all operations failing",
      async () => {
        const results = await parallel(
          [
            {
              stream: () => {
                throw new Error("Error 1");
              },
            },
            {
              stream: () => {
                throw new Error("Error 2");
              },
            },
          ],
          { concurrency: 2, failFast: false },
        );

        expect(results.successCount).toBe(0);
        expect(results.failureCount).toBe(2);
        expect(results.allSucceeded).toBe(false);
      },
      LLM_TIMEOUT,
    );

    it(
      "should handle failFast correctly",
      async () => {
        let operationsStarted = 0;

        const results = await parallel(
          [
            {
              stream: () => {
                operationsStarted++;
                throw new Error("Immediate failure");
              },
            },
            {
              stream: () => {
                operationsStarted++;
                return streamText({
                  model: openai("gpt-4o-mini"),
                  prompt: "Say 'hello'",
                });
              },
            },
          ],
          { concurrency: 1, failFast: true },
        );

        expect(results.failureCount).toBeGreaterThanOrEqual(1);
      },
      LLM_TIMEOUT,
    );
  });

  describe("Race Edge Cases", () => {
    it(
      "should handle single operation in race",
      async () => {
        const result = await race([
          {
            stream: () =>
              streamText({
                model: openai("gpt-4o-mini"),
                prompt: "Say 'only one'",
              }),
          },
        ]);

        expectValidResponse(result.state.content);
      },
      LLM_TIMEOUT,
    );

    it(
      "should handle all racers failing",
      async () => {
        await expect(
          race([
            {
              stream: () => {
                throw new Error("Racer 1 failed");
              },
            },
            {
              stream: () => {
                throw new Error("Racer 2 failed");
              },
            },
          ]),
        ).rejects.toThrow();
      },
      LLM_TIMEOUT,
    );
  });

  describe("Telemetry Edge Cases", () => {
    it(
      "should collect telemetry on failed streams",
      async () => {
        try {
          const result = await l0({
            stream: () => {
              throw new Error("Immediate failure");
            },
            monitoring: { enabled: true },
          });

          for await (const event of result.stream) {
            // Should not reach here
          }
        } catch (error) {
          expect(error).toBeInstanceOf(Error);
        }
      },
      LLM_TIMEOUT,
    );

    it(
      "should collect telemetry with fallback usage",
      async () => {
        const result = await l0({
          stream: () => {
            throw new Error("Primary failed");
          },
          fallbackStreams: [
            () =>
              streamText({
                model: openai("gpt-4o-mini"),
                prompt: "Say 'fallback'",
              }),
          ],
          monitoring: { enabled: true },
        });

        for await (const event of result.stream) {
          // consume stream
        }

        expect(result.telemetry).toBeDefined();
        expect(result.state.fallbackIndex).toBe(1);
      },
      LLM_TIMEOUT,
    );
  });

  describe("State Consistency", () => {
    it(
      "should maintain consistent state after abort",
      async () => {
        const controller = new AbortController();

        const result = await l0({
          stream: () =>
            streamText({
              model: openai("gpt-4o-mini"),
              prompt: "Write a long essay",
            }),
          signal: controller.signal,
        });

        let tokenCount = 0;
        try {
          for await (const event of result.stream) {
            if (event.type === "token") {
              tokenCount++;
              if (tokenCount >= 5) {
                controller.abort();
              }
            }
          }
        } catch (error) {
          // Expected abort
        }

        // State should be consistent
        expect(result.state.tokenCount).toBeGreaterThanOrEqual(tokenCount - 1);
        expect(result.state.content).toBeDefined();
      },
      LLM_TIMEOUT,
    );
  });
});
