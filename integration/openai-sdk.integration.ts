// OpenAI SDK Direct Integration Tests
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
  openaiStream,
  openaiText,
  openaiJSON,
  openaiWithTools,
  recommendedGuardrails,
} from "../src/index";
import OpenAI from "openai";

const client = hasOpenAI ? new OpenAI() : null;

describeIf(hasOpenAI)("OpenAI SDK Direct Integration", () => {
  describe("openaiStream", () => {
    it(
      "should stream with openaiStream helper",
      async () => {
        const result = await l0({
          stream: openaiStream(client!, {
            model: "gpt-4o-mini",
            messages: [{ role: "user", content: "Say 'hello'" }],
          }),
        });

        for await (const event of result.stream) {
          // consume stream
        }

        expectValidResponse(result.state.content);
        expect(result.state.content.toLowerCase()).toContain("hello");
      },
      LLM_TIMEOUT,
    );
  });

  describe("openaiText", () => {
    it(
      "should stream with string prompt",
      async () => {
        const result = await l0({
          stream: openaiText(
            client!,
            "gpt-4o-mini",
            "What is 2+2? Answer with just the number.",
          ),
        });

        for await (const event of result.stream) {
          // consume stream
        }

        expectValidResponse(result.state.content);
        expect(result.state.content).toContain("4");
      },
      LLM_TIMEOUT,
    );

    it(
      "should stream with messages array",
      async () => {
        const result = await l0({
          stream: openaiText(client!, "gpt-4o-mini", [
            { role: "system", content: "You are a helpful assistant." },
            { role: "user", content: "Say 'test'" },
          ]),
        });

        for await (const event of result.stream) {
          // consume stream
        }

        expectValidResponse(result.state.content);
      },
      LLM_TIMEOUT,
    );
  });

  describe("openaiJSON", () => {
    it(
      "should return valid JSON",
      async () => {
        const result = await l0({
          stream: openaiJSON(
            client!,
            "gpt-4o-mini",
            "Return a JSON object with fields: name (string) and age (number). Use any values.",
          ),
        });

        for await (const event of result.stream) {
          // consume stream
        }

        expectValidResponse(result.state.content);

        const parsed = JSON.parse(result.state.content);
        expect(parsed).toHaveProperty("name");
        expect(parsed).toHaveProperty("age");
        expect(typeof parsed.name).toBe("string");
        expect(typeof parsed.age).toBe("number");
      },
      LLM_TIMEOUT,
    );
  });

  describe("openaiWithTools", () => {
    it(
      "should handle tool calls",
      async () => {
        const messages: any[] = [];

        const result = await l0({
          stream: openaiWithTools(
            client!,
            "gpt-4o-mini",
            [{ role: "user", content: "What's the weather in Tokyo?" }],
            [
              {
                type: "function",
                function: {
                  name: "get_weather",
                  description: "Get the current weather for a location",
                  parameters: {
                    type: "object",
                    properties: {
                      location: { type: "string", description: "City name" },
                    },
                    required: ["location"],
                  },
                },
              },
            ],
          ),
        });

        for await (const event of result.stream) {
          if (event.type === "message") {
            messages.push(JSON.parse(event.value || "{}"));
          }
        }

        // Should have made a tool call
        expect(messages.length).toBeGreaterThan(0);
        const toolCall = messages.find((m) => m.type === "tool_calls");
        expect(toolCall).toBeDefined();
        expect(toolCall.tool_calls[0].name).toBe("get_weather");
      },
      LLM_TIMEOUT,
    );
  });

  describe("With Guardrails", () => {
    it(
      "should work with guardrails",
      async () => {
        const result = await l0({
          stream: openaiText(client!, "gpt-4o-mini", "Write a short greeting"),
          guardrails: recommendedGuardrails,
        });

        for await (const event of result.stream) {
          // consume stream
        }

        expectValidResponse(result.state.content);
        expect(result.state.completed).toBe(true);
      },
      LLM_TIMEOUT,
    );
  });

  describe("Usage Tracking", () => {
    it(
      "should include usage in done event",
      async () => {
        let usage: any;

        const result = await l0({
          stream: openaiStream(
            client!,
            {
              model: "gpt-4o-mini",
              messages: [{ role: "user", content: "Say hi" }],
              stream_options: { include_usage: true },
            },
            { includeUsage: true },
          ),
        });

        for await (const event of result.stream) {
          if (event.type === "done" && (event as any).usage) {
            usage = (event as any).usage;
          }
        }

        // Usage should be present with stream_options
        if (usage) {
          expect(usage.prompt_tokens).toBeGreaterThan(0);
          expect(usage.completion_tokens).toBeGreaterThan(0);
        }
      },
      LLM_TIMEOUT,
    );
  });
});
