// Vercel AI SDK Integration Tests
// Run: OPENAI_API_KEY=sk-... npm run test:integration

import { describe, it, expect, vi } from "vitest";
import {
  describeIf,
  hasOpenAI,
  LLM_TIMEOUT,
  expectValidResponse,
} from "./setup";
import { l0, recommendedGuardrails, recommendedRetry } from "../src/index";
import { streamText, tool } from "ai";
import { openai } from "@ai-sdk/openai";
import { z } from "zod";

describeIf(hasOpenAI)("Vercel AI SDK Integration", () => {
  describe("Basic Streaming", () => {
    it(
      "should stream tokens from OpenAI",
      async () => {
        const result = await l0({
          stream: () =>
            streamText({
              model: openai("gpt-5-nano"),
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
              model: openai("gpt-5-nano"),
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
              model: openai("gpt-5-nano"),
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
              model: openai("gpt-5-nano"),
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
              model: openai("gpt-5-nano"),
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
              model: openai("gpt-5-nano"),
              prompt: "Say 'hello world' and explain why",
            }),
          monitoring: { enabled: true },
          detectZeroTokens: false,
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
              model: openai("gpt-5-nano"),
              prompt: "Write a very long essay about the history of computing",
              abortSignal: controller.signal,
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

  describe("Tool Call Observability", () => {
    it(
      "should detect tool calls and fire onToolCall callback",
      async () => {
        const onToolCall = vi.fn();
        const toolCalls: Array<{ name: string; id: string; args: unknown }> =
          [];

        const result = await l0({
          stream: () =>
            streamText({
              model: openai("gpt-5-nano"),
              prompt: "What's the weather in San Francisco?",
              tools: {
                get_weather: tool({
                  description: "Get the current weather for a location",
                  parameters: z.object({
                    location: z.string().describe("City name"),
                    unit: z.enum(["celsius", "fahrenheit"]).optional(),
                  }),
                }),
              },
              toolChoice: { type: "tool", toolName: "get_weather" },
            }),
          onToolCall: (name, id, args) => {
            onToolCall(name, id, args);
            toolCalls.push({ name, id, args: args as unknown });
          },
          detectZeroTokens: false,
        });

        for await (const event of result.stream) {
          // consume stream
        }

        expect(onToolCall).toHaveBeenCalled();
        expect(toolCalls.length).toBeGreaterThanOrEqual(1);

        const weatherCall = toolCalls.find((t) => t.name === "get_weather");
        expect(weatherCall).toBeDefined();
        expect(weatherCall!.args).toHaveProperty("location");
      },
      LLM_TIMEOUT,
    );

    it(
      "should handle multiple tool calls",
      async () => {
        const toolCalls: Array<{ name: string; id: string }> = [];

        const result = await l0({
          stream: () =>
            streamText({
              model: openai("gpt-5-nano"),
              prompt: "What's the weather in Tokyo AND what time is it there?",
              tools: {
                get_weather: tool({
                  description: "Get the current weather for a location",
                  parameters: z.object({
                    location: z.string().describe("City name"),
                  }),
                }),
                get_time: tool({
                  description: "Get the current time for a timezone",
                  parameters: z.object({
                    timezone: z.string().describe("IANA timezone name"),
                  }),
                }),
              },
              toolChoice: "required",
            }),
          onToolCall: (name, id) => {
            toolCalls.push({ name, id });
          },
          detectZeroTokens: false,
        });

        for await (const event of result.stream) {
          // consume stream
        }

        // Should have at least one tool call
        expect(toolCalls.length).toBeGreaterThanOrEqual(1);

        // Each tool call should have unique ID
        const ids = toolCalls.map((t) => t.id);
        const uniqueIds = new Set(ids);
        expect(uniqueIds.size).toBe(ids.length);
      },
      LLM_TIMEOUT,
    );

    it(
      "should parse complex nested tool arguments",
      async () => {
        const capturedArgs: unknown[] = [];

        const result = await l0({
          stream: () =>
            streamText({
              model: openai("gpt-5-nano"),
              prompt: "Search for laptops under $1000 in electronics, limit 5",
              tools: {
                search_products: tool({
                  description: "Search for products with filters",
                  parameters: z.object({
                    query: z.string(),
                    filters: z
                      .object({
                        minPrice: z.number().optional(),
                        maxPrice: z.number().optional(),
                        categories: z.array(z.string()).optional(),
                      })
                      .optional(),
                    limit: z.number().optional(),
                  }),
                }),
              },
              toolChoice: { type: "tool", toolName: "search_products" },
            }),
          onToolCall: (_name, _id, args) => {
            capturedArgs.push(args);
          },
          detectZeroTokens: false,
        });

        for await (const event of result.stream) {
          // consume stream
        }

        expect(capturedArgs.length).toBeGreaterThanOrEqual(1);
        const args = capturedArgs[0] as Record<string, unknown>;
        expect(args).toHaveProperty("query");
      },
      LLM_TIMEOUT,
    );

    it(
      "should work with tool calls and monitoring enabled",
      async () => {
        const onToolCall = vi.fn();

        const result = await l0({
          stream: () =>
            streamText({
              model: openai("gpt-5-nano"),
              prompt: "What's the weather in Paris?",
              tools: {
                get_weather: tool({
                  description: "Get the current weather for a location",
                  parameters: z.object({
                    location: z.string().describe("City name"),
                  }),
                }),
              },
              toolChoice: { type: "tool", toolName: "get_weather" },
            }),
          onToolCall,
          monitoring: { enabled: true },
          detectZeroTokens: false,
        });

        for await (const event of result.stream) {
          // consume stream
        }

        expect(onToolCall).toHaveBeenCalled();
        expect(result.telemetry).toBeDefined();
      },
      LLM_TIMEOUT,
    );
  });
});
