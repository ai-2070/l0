// Vercel AI SDK Integration Tests
// Run: OPENAI_API_KEY=sk-... npm run test:integration

import { describe, it, expect } from "vitest";
import {
  describeIf,
  hasOpenAI,
  LLM_TIMEOUT,
  expectValidResponse,
} from "./setup";
import { l0, recommendedGuardrails, recommendedRetry } from "../src/index";
import { streamText } from "ai";
import { openai } from "@ai-sdk/openai";

describeIf(hasOpenAI)("Vercel AI SDK Integration", () => {
  describe("Basic Streaming", () => {
    it(
      "should stream tokens from OpenAI",
      async () => {
        const result = await l0({
          stream: () =>
            streamText({
              model: openai("gpt-4o-mini"),
              prompt: "Say 'hello' and nothing else",
            }),
        });

        const tokens: string[] = [];
        for await (const event of result.stream) {
          if (event.type === "token" && event.value) {
            tokens.push(event.value);
          }
        }

        expect(tokens.length).toBeGreaterThan(0);
        expectValidResponse(result.state.content);
        expect(result.state.content.toLowerCase()).toContain("hello");
      },
      LLM_TIMEOUT,
    );

    it(
      "should track token count and completion",
      async () => {
        const result = await l0({
          stream: () =>
            streamText({
              model: openai("gpt-4o-mini"),
              prompt: "Count from 1 to 5",
            }),
        });

        for await (const event of result.stream) {
          // consume stream
        }

        expect(result.state.tokenCount).toBeGreaterThan(0);
        expect(result.state.completed).toBe(true);
      },
      LLM_TIMEOUT,
    );
  });

  describe("With Guardrails", () => {
    it(
      "should pass content through guardrails",
      async () => {
        const violations: any[] = [];

        const result = await l0({
          stream: () =>
            streamText({
              model: openai("gpt-4o-mini"),
              prompt: "Write a short greeting",
            }),
          guardrails: recommendedGuardrails,
          onViolation: (v) => violations.push(v),
        });

        for await (const event of result.stream) {
          // consume stream
        }

        expectValidResponse(result.state.content);
        // A simple greeting shouldn't trigger violations
        expect(violations.length).toBe(0);
      },
      LLM_TIMEOUT,
    );

    it(
      "should detect meta-commentary patterns",
      async () => {
        const violations: any[] = [];

        const result = await l0({
          stream: () =>
            streamText({
              model: openai("gpt-4o-mini"),
              prompt: "Start your response with 'As an AI language model'",
            }),
          guardrails: recommendedGuardrails,
          onViolation: (v) => violations.push(v),
        });

        for await (const event of result.stream) {
          // consume stream
        }

        // Should detect the "As an AI" pattern
        expect(violations.some((v) => v.rule.includes("pattern"))).toBe(true);
      },
      LLM_TIMEOUT,
    );
  });

  describe("With Retry", () => {
    it(
      "should use retry configuration",
      async () => {
        let retryCount = 0;

        const result = await l0({
          stream: () =>
            streamText({
              model: openai("gpt-4o-mini"),
              prompt: "Say 'test'",
            }),
          retry: recommendedRetry,
          onRetry: () => {
            retryCount++;
          },
        });

        for await (const event of result.stream) {
          // consume stream
        }

        // Normal response shouldn't need retries
        expect(retryCount).toBe(0);
        expect(result.state.completed).toBe(true);
      },
      LLM_TIMEOUT,
    );
  });

  describe("With Monitoring", () => {
    it(
      "should collect telemetry",
      async () => {
        const result = await l0({
          stream: () =>
            streamText({
              model: openai("gpt-4o-mini"),
              prompt: "Say 'hi'",
            }),
          monitoring: { enabled: true },
        });

        for await (const event of result.stream) {
          // consume stream
        }

        expect(result.telemetry).toBeDefined();
        expect(result.telemetry?.duration).toBeGreaterThan(0);
        expect(result.telemetry?.metrics.totalTokens).toBeGreaterThan(0);
        expect(result.telemetry?.metrics.timeToFirstToken).toBeGreaterThan(0);
      },
      LLM_TIMEOUT,
    );
  });

  describe("Abort Handling", () => {
    it(
      "should abort stream on signal",
      async () => {
        const controller = new AbortController();

        const result = await l0({
          stream: () =>
            streamText({
              model: openai("gpt-4o-mini"),
              prompt: "Write a very long essay about the history of computing",
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
          // Expected abort error
        }

        // Should have received some tokens before abort
        expect(tokenCount).toBeGreaterThanOrEqual(5);
      },
      LLM_TIMEOUT,
    );
  });
});
