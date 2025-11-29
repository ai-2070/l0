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
        // Simple greeting shouldn't violate guardrails
        expect(violations.length).toBe(0);
      },
      LLM_TIMEOUT,
    );
  });
});
