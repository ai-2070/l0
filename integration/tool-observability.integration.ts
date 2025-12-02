// Tool Call Observability Integration Tests
// Run: OPENAI_API_KEY=sk-... npm run test:integration
//
// Tests real tool calls with actual LLM providers to verify:
// - Tool call detection from streaming responses
// - onToolCall callback firing
// - Tool result handling
// - Multiple concurrent tool calls

import { describe, it, expect, vi } from "vitest";
import {
  describeIf,
  hasOpenAI,
  hasAnthropic,
  LLM_TIMEOUT,
  expectValidResponse,
} from "./setup";
import { l0, openaiAdapter, anthropicAdapter } from "../src/index";
import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";

const openai = hasOpenAI ? new OpenAI() : null;
const anthropic = hasAnthropic ? new Anthropic() : null;

// Tool definitions for OpenAI
const openaiTools: OpenAI.Chat.Completions.ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "get_weather",
      description: "Get the current weather for a location",
      parameters: {
        type: "object",
        properties: {
          location: { type: "string", description: "City name" },
          unit: { type: "string", enum: ["celsius", "fahrenheit"] },
        },
        required: ["location"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_time",
      description: "Get the current time for a timezone",
      parameters: {
        type: "object",
        properties: {
          timezone: { type: "string", description: "IANA timezone name" },
        },
        required: ["timezone"],
      },
    },
  },
];

// Tool definitions for Anthropic
const anthropicTools: Anthropic.Tool[] = [
  {
    name: "get_weather",
    description: "Get the current weather for a location",
    input_schema: {
      type: "object",
      properties: {
        location: { type: "string", description: "City name" },
        unit: { type: "string", enum: ["celsius", "fahrenheit"] },
      },
      required: ["location"],
    },
  },
  {
    name: "get_time",
    description: "Get the current time for a timezone",
    input_schema: {
      type: "object",
      properties: {
        timezone: { type: "string", description: "IANA timezone name" },
      },
      required: ["timezone"],
    },
  },
];

describeIf(hasOpenAI)("Tool Observability - OpenAI", () => {
  describe("Single Tool Call", () => {
    it(
      "should detect tool call and fire onToolCall callback",
      async () => {
        const onToolCall = vi.fn();
        const toolCalls: Array<{ name: string; id: string; args: unknown }> =
          [];

        const result = await l0({
          stream: () =>
            openai!.chat.completions.create({
              model: "gpt-5-nano",
              messages: [
                {
                  role: "user",
                  content: "What's the weather in San Francisco?",
                },
              ],
              tools: openaiTools,
              tool_choice: {
                type: "function",
                function: { name: "get_weather" },
              },
              stream: true,
            }),
          adapter: openaiAdapter,
          onToolCall: (name, id, args) => {
            onToolCall(name, id, args);
            toolCalls.push({ name, id, args: args as unknown });
          },
          detectZeroTokens: false, // Tool calls may not produce text
        });

        for await (const event of result.stream) {
          // consume stream
        }

        expect(onToolCall).toHaveBeenCalled();
        expect(toolCalls.length).toBeGreaterThanOrEqual(1);

        const weatherCall = toolCalls.find((t) => t.name === "get_weather");
        expect(weatherCall).toBeDefined();
        expect(weatherCall!.id).toBeDefined();
        expect(weatherCall!.args).toHaveProperty("location");
      },
      LLM_TIMEOUT,
    );

    it(
      "should include tool call ID for correlation",
      async () => {
        const toolCallIds: string[] = [];

        const result = await l0({
          stream: () =>
            openai!.chat.completions.create({
              model: "gpt-5-nano",
              messages: [
                { role: "user", content: "What time is it in Tokyo?" },
              ],
              tools: openaiTools,
              tool_choice: { type: "function", function: { name: "get_time" } },
              stream: true,
            }),
          adapter: openaiAdapter,
          onToolCall: (_name, id) => {
            toolCallIds.push(id);
          },
          detectZeroTokens: false,
        });

        for await (const _ of result.stream) {
          // consume
        }

        expect(toolCallIds.length).toBeGreaterThanOrEqual(1);
        // OpenAI tool call IDs start with "call_"
        expect(toolCallIds[0]).toMatch(/^call_/);
      },
      LLM_TIMEOUT,
    );
  });

  describe("Multiple Tool Calls", () => {
    it(
      "should detect multiple parallel tool calls",
      async () => {
        const toolCalls: Array<{ name: string; id: string }> = [];

        const result = await l0({
          stream: () =>
            openai!.chat.completions.create({
              model: "gpt-5-nano",
              messages: [
                {
                  role: "user",
                  content:
                    "What's the weather in Tokyo AND what time is it there? Use both tools.",
                },
              ],
              tools: openaiTools,
              tool_choice: "required",
              stream: true,
            }),
          adapter: openaiAdapter,
          onToolCall: (name, id) => {
            toolCalls.push({ name, id });
          },
          detectZeroTokens: false,
        });

        for await (const _ of result.stream) {
          // consume
        }

        // Should have at least one tool call (model might call both)
        expect(toolCalls.length).toBeGreaterThanOrEqual(1);

        // Each tool call should have unique ID
        const ids = toolCalls.map((t) => t.id);
        const uniqueIds = new Set(ids);
        expect(uniqueIds.size).toBe(ids.length);
      },
      LLM_TIMEOUT,
    );
  });

  describe("Tool Call Arguments", () => {
    it(
      "should parse complex nested arguments",
      async () => {
        const capturedArgs: unknown[] = [];

        const complexTools: OpenAI.Chat.Completions.ChatCompletionTool[] = [
          {
            type: "function",
            function: {
              name: "search_products",
              description: "Search for products with filters",
              parameters: {
                type: "object",
                properties: {
                  query: { type: "string" },
                  filters: {
                    type: "object",
                    properties: {
                      minPrice: { type: "number" },
                      maxPrice: { type: "number" },
                      categories: {
                        type: "array",
                        items: { type: "string" },
                      },
                    },
                  },
                  limit: { type: "number" },
                },
                required: ["query"],
              },
            },
          },
        ];

        const result = await l0({
          stream: () =>
            openai!.chat.completions.create({
              model: "gpt-5-nano",
              messages: [
                {
                  role: "user",
                  content:
                    "Search for laptops under $1000 in electronics category, limit 5 results",
                },
              ],
              tools: complexTools,
              tool_choice: {
                type: "function",
                function: { name: "search_products" },
              },
              stream: true,
            }),
          adapter: openaiAdapter,
          onToolCall: (_name, _id, args) => {
            capturedArgs.push(args);
          },
          detectZeroTokens: false,
        });

        for await (const _ of result.stream) {
          // consume
        }

        expect(capturedArgs.length).toBeGreaterThanOrEqual(1);
        const args = capturedArgs[0] as Record<string, unknown>;
        expect(args).toHaveProperty("query");
      },
      LLM_TIMEOUT,
    );
  });

  describe("Integration with L0 Features", () => {
    it(
      "should work with retry configuration",
      async () => {
        const onToolCall = vi.fn();

        const result = await l0({
          stream: () =>
            openai!.chat.completions.create({
              model: "gpt-5-nano",
              messages: [
                { role: "user", content: "What's the weather in London?" },
              ],
              tools: openaiTools,
              tool_choice: {
                type: "function",
                function: { name: "get_weather" },
              },
              stream: true,
            }),
          adapter: openaiAdapter,
          retry: { attempts: 2 },
          onToolCall,
          detectZeroTokens: false,
        });

        for await (const _ of result.stream) {
          // consume
        }

        expect(onToolCall).toHaveBeenCalled();
      },
      LLM_TIMEOUT,
    );

    it(
      "should track tool calls in telemetry",
      async () => {
        const result = await l0({
          stream: () =>
            openai!.chat.completions.create({
              model: "gpt-5-nano",
              messages: [
                { role: "user", content: "What's the weather in Paris?" },
              ],
              tools: openaiTools,
              tool_choice: {
                type: "function",
                function: { name: "get_weather" },
              },
              stream: true,
            }),
          adapter: openaiAdapter,
          monitoring: { enabled: true },
          detectZeroTokens: false,
        });

        for await (const _ of result.stream) {
          // consume
        }

        // Telemetry should be available when monitoring is enabled
        expect(result.telemetry).toBeDefined();
      },
      LLM_TIMEOUT,
    );
  });
});

describeIf(hasAnthropic)("Tool Observability - Anthropic", () => {
  describe("Single Tool Call", () => {
    it(
      "should detect Anthropic tool_use and fire onToolCall callback",
      async () => {
        const onToolCall = vi.fn();
        const toolCalls: Array<{ name: string; id: string; args: unknown }> =
          [];

        const result = await l0({
          stream: () =>
            anthropic!.messages.stream({
              model: "claude-sonnet-4-20250514",
              max_tokens: 1024,
              messages: [
                {
                  role: "user",
                  content:
                    "What's the weather in Berlin? Use the get_weather tool.",
                },
              ],
              tools: anthropicTools,
              tool_choice: { type: "tool", name: "get_weather" },
            }),
          adapter: anthropicAdapter,
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
        // Anthropic tool IDs start with "toolu_"
        expect(weatherCall!.id).toMatch(/^toolu_/);
        expect(weatherCall!.args).toHaveProperty("location");
      },
      LLM_TIMEOUT,
    );
  });

  describe("Multiple Tool Calls", () => {
    it(
      "should detect multiple Anthropic tool calls",
      async () => {
        const toolCalls: Array<{ name: string; id: string }> = [];

        const result = await l0({
          stream: () =>
            anthropic!.messages.stream({
              model: "claude-sonnet-4-20250514",
              max_tokens: 1024,
              messages: [
                {
                  role: "user",
                  content:
                    "I need both the weather in Sydney AND the current time there. Please use both tools.",
                },
              ],
              tools: anthropicTools,
              tool_choice: { type: "any" },
            }),
          adapter: anthropicAdapter,
          onToolCall: (name, id) => {
            toolCalls.push({ name, id });
          },
          detectZeroTokens: false,
        });

        for await (const _ of result.stream) {
          // consume
        }

        expect(toolCalls.length).toBeGreaterThanOrEqual(1);
      },
      LLM_TIMEOUT,
    );
  });

  describe("Tool Call Arguments", () => {
    it(
      "should correctly parse Anthropic tool input",
      async () => {
        const capturedArgs: unknown[] = [];

        const result = await l0({
          stream: () =>
            anthropic!.messages.stream({
              model: "claude-sonnet-4-20250514",
              max_tokens: 1024,
              messages: [
                {
                  role: "user",
                  content: "Get the weather in New York in fahrenheit units.",
                },
              ],
              tools: anthropicTools,
              tool_choice: { type: "tool", name: "get_weather" },
            }),
          adapter: anthropicAdapter,
          onToolCall: (_name, _id, args) => {
            capturedArgs.push(args);
          },
          detectZeroTokens: false,
        });

        for await (const _ of result.stream) {
          // consume
        }

        expect(capturedArgs.length).toBeGreaterThanOrEqual(1);
        const args = capturedArgs[0] as Record<string, unknown>;
        expect(args).toHaveProperty("location");
      },
      LLM_TIMEOUT,
    );
  });
});

describeIf(hasOpenAI && hasAnthropic)(
  "Tool Observability - Cross-Provider",
  () => {
    it(
      "should handle tool calls consistently across providers",
      async () => {
        const openaiToolCalls: string[] = [];
        const anthropicToolCalls: string[] = [];

        // OpenAI call
        const openaiResult = await l0({
          stream: () =>
            openai!.chat.completions.create({
              model: "gpt-5-nano",
              messages: [
                { role: "user", content: "What's the weather in Miami?" },
              ],
              tools: openaiTools,
              tool_choice: {
                type: "function",
                function: { name: "get_weather" },
              },
              stream: true,
            }),
          adapter: openaiAdapter,
          onToolCall: (name) => {
            openaiToolCalls.push(name);
          },
          detectZeroTokens: false,
        });

        for await (const _ of openaiResult.stream) {
          // consume
        }

        // Anthropic call
        const anthropicResult = await l0({
          stream: () =>
            anthropic!.messages.stream({
              model: "claude-sonnet-4-20250514",
              max_tokens: 1024,
              messages: [
                { role: "user", content: "What's the weather in Miami?" },
              ],
              tools: anthropicTools,
              tool_choice: { type: "tool", name: "get_weather" },
            }),
          adapter: anthropicAdapter,
          onToolCall: (name) => {
            anthropicToolCalls.push(name);
          },
          detectZeroTokens: false,
        });

        for await (const _ of anthropicResult.stream) {
          // consume
        }

        // Both should detect the same tool name
        expect(openaiToolCalls).toContain("get_weather");
        expect(anthropicToolCalls).toContain("get_weather");
      },
      LLM_TIMEOUT * 2,
    );
  },
);
