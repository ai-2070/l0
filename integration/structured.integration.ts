// Structured Output Integration Tests
// Run: OPENAI_API_KEY=sk-... npm run test:integration

import { describe, it, expect } from "vitest";
import { describeIf, hasOpenAI, LLM_TIMEOUT } from "./setup";
import {
  structured,
  structuredArray,
  structuredObject,
} from "../src/structured";
import { streamText } from "ai";
import { openai } from "@ai-sdk/openai";
import { z } from "zod";

describeIf(hasOpenAI)("Structured Output Integration", () => {
  describe("Basic Structured Output", () => {
    it(
      "should parse simple object schema",
      async () => {
        const schema = z.object({
          name: z.string(),
          age: z.number(),
        });

        const result = await structured({
          schema,
          stream: () =>
            streamText({
              model: openai("gpt-5-nano"),
              prompt:
                "Generate a person with name and age as JSON. Use any values.",
            }),
          autoCorrect: true,
        });

        expect(result.data).toBeDefined();
        expect(typeof result.data.name).toBe("string");
        expect(typeof result.data.age).toBe("number");
        expect(result.data.name.length).toBeGreaterThan(0);
      },
      LLM_TIMEOUT,
    );

    it(
      "should parse nested object schema",
      async () => {
        const schema = z.object({
          user: z.object({
            name: z.string(),
            email: z.string(),
          }),
          active: z.boolean(),
        });

        const result = await structured({
          schema,
          stream: () =>
            streamText({
              model: openai("gpt-5-nano"),
              prompt:
                "Generate a user object with nested user (name, email) and active boolean as JSON.",
            }),
          autoCorrect: true,
        });

        expect(result.data.user).toBeDefined();
        expect(typeof result.data.user.name).toBe("string");
        expect(typeof result.data.user.email).toBe("string");
        expect(typeof result.data.active).toBe("boolean");
      },
      LLM_TIMEOUT,
    );
  });

  describe("Array Output", () => {
    it(
      "should parse array of objects",
      async () => {
        const itemSchema = z.object({
          id: z.number(),
          title: z.string(),
        });

        const result = await structuredArray(itemSchema, {
          stream: () =>
            streamText({
              model: openai("gpt-5-nano"),
              prompt:
                "Generate a JSON array with 3 items, each having id (number) and title (string).",
            }),
          autoCorrect: true,
        });

        expect(Array.isArray(result.data)).toBe(true);
        expect(result.data.length).toBeGreaterThanOrEqual(1);
        result.data.forEach((item) => {
          expect(typeof item.id).toBe("number");
          expect(typeof item.title).toBe("string");
        });
      },
      LLM_TIMEOUT,
    );
  });

  describe("Object Helper", () => {
    it(
      "should work with structuredObject helper",
      async () => {
        const result = await structuredObject(
          {
            city: z.string(),
            country: z.string(),
            population: z.number(),
          },
          {
            stream: () =>
              streamText({
                model: openai("gpt-5-nano"),
                prompt:
                  "Generate a city info object with city, country, and population as JSON.",
              }),
            autoCorrect: true,
          },
        );

        expect(typeof result.data.city).toBe("string");
        expect(typeof result.data.country).toBe("string");
        expect(typeof result.data.population).toBe("number");
      },
      LLM_TIMEOUT,
    );
  });

  describe("Auto-Correction", () => {
    it(
      "should handle markdown-wrapped JSON",
      async () => {
        const schema = z.object({
          value: z.string(),
        });

        // Ask for markdown-wrapped response
        const result = await structured({
          schema,
          stream: () =>
            streamText({
              model: openai("gpt-5-nano"),
              prompt:
                'Return this exact text including the backticks: ```json\n{"value": "test"}\n```',
            }),
          autoCorrect: true,
        });

        // Should still parse correctly
        expect(result.data.value).toBeDefined();
      },
      LLM_TIMEOUT,
    );
  });

  describe("Complex Schemas", () => {
    it(
      "should handle enums",
      async () => {
        const schema = z.object({
          status: z.enum(["active", "inactive", "pending"]),
          priority: z.enum(["low", "medium", "high"]),
        });

        const result = await structured({
          schema,
          stream: () =>
            streamText({
              model: openai("gpt-5-nano"),
              prompt:
                "Generate JSON with status (one of: active, inactive, pending) and priority (one of: low, medium, high).",
            }),
          autoCorrect: true,
        });

        expect(["active", "inactive", "pending"]).toContain(result.data.status);
        expect(["low", "medium", "high"]).toContain(result.data.priority);
      },
      LLM_TIMEOUT,
    );

    it(
      "should handle optional fields",
      async () => {
        const schema = z.object({
          required: z.string(),
          optional: z.string().optional(),
        });

        const result = await structured({
          schema,
          stream: () =>
            streamText({
              model: openai("gpt-5-nano"),
              prompt:
                'Generate JSON with a "required" string field. Optionally include an "optional" field.',
            }),
          autoCorrect: true,
        });

        expect(typeof result.data.required).toBe("string");
        // optional may or may not be present
      },
      LLM_TIMEOUT,
    );

    it(
      "should handle arrays with constraints",
      async () => {
        const schema = z.object({
          tags: z.array(z.string()).min(1).max(5),
        });

        const result = await structured({
          schema,
          stream: () =>
            streamText({
              model: openai("gpt-5-nano"),
              prompt:
                "Generate JSON with a 'tags' array containing 2-3 string tags.",
            }),
          autoCorrect: true,
        });

        expect(Array.isArray(result.data.tags)).toBe(true);
        expect(result.data.tags.length).toBeGreaterThanOrEqual(1);
        expect(result.data.tags.length).toBeLessThanOrEqual(5);
      },
      LLM_TIMEOUT,
    );
  });

  describe("Telemetry", () => {
    it(
      "should include structured output telemetry",
      async () => {
        const schema = z.object({ value: z.string() });

        const result = await structured({
          schema,
          stream: () =>
            streamText({
              model: openai("gpt-5-nano"),
              prompt: 'Return {"value": "test"}',
            }),
          monitoring: { enabled: true },
        });

        expect(result.telemetry).toBeDefined();
        expect(result.telemetry?.structured).toBeDefined();
        expect(result.telemetry?.structured.validationSuccess).toBe(true);
      },
      LLM_TIMEOUT,
    );
  });
});
