// Anthropic SDK Direct Integration Tests
// Run: ANTHROPIC_API_KEY=sk-ant-... npm run test:integration

import { describe, it, expect } from "vitest";
import {
  describeIf,
  hasAnthropic,
  LLM_TIMEOUT,
  expectValidResponse,
} from "./setup";
import {
  l0,
  anthropicAdapter,
  anthropicStream,
  anthropicText,
  wrapAnthropicStream,
  registerAdapter,
  clearAdapters,
} from "../src/index";
import Anthropic from "@anthropic-ai/sdk";
import type { L0Event } from "../src/types/l0";

const client = hasAnthropic ? new Anthropic() : null;

describeIf(hasAnthropic)("Anthropic SDK Direct Integration", () => {
  describe("wrapAnthropicStream", () => {
    it(
      "should stream with wrapAnthropicStream",
      async () => {
        const stream = client!.messages.stream({
          model: "claude-sonnet-4-20250514",
          max_tokens: 50,
          messages: [
            { role: "user", content: "Say hello in exactly 3 words." },
          ],
        });

        const events: L0Event[] = [];
        for await (const event of wrapAnthropicStream(stream)) {
          events.push(event);
        }

        const tokens = events.filter((e) => e.type === "token");
        const doneEvents = events.filter((e) => e.type === "done");

        expect(tokens.length).toBeGreaterThan(0);
        expect(doneEvents).toHaveLength(1);

        const fullText = tokens.map((e) => e.value).join("");
        expectValidResponse(fullText);
      },
      LLM_TIMEOUT,
    );

    it(
      "should include usage information",
      async () => {
        const stream = client!.messages.stream({
          model: "claude-sonnet-4-20250514",
          max_tokens: 20,
          messages: [{ role: "user", content: "Hi" }],
        });

        const events: L0Event[] = [];
        for await (const event of wrapAnthropicStream(stream)) {
          events.push(event);
        }

        const doneEvent = events.find((e) => e.type === "done");
        expect(doneEvent).toBeDefined();
        expect((doneEvent as any).usage).toBeDefined();
        expect((doneEvent as any).usage.input_tokens).toBeGreaterThan(0);
        expect((doneEvent as any).usage.output_tokens).toBeGreaterThan(0);
      },
      LLM_TIMEOUT,
    );
  });

  describe("anthropicStream", () => {
    it(
      "should stream with anthropicStream helper",
      async () => {
        const result = await l0({
          stream: anthropicStream(client!, {
            model: "claude-sonnet-4-20250514",
            max_tokens: 30,
            messages: [{ role: "user", content: "Count to 3" }],
          }),
        });

        for await (const _event of result.stream) {
          // consume stream
        }

        expectValidResponse(result.state.content);
        expect(result.state.content).toMatch(/1|2|3|one|two|three/i);
      },
      LLM_TIMEOUT,
    );
  });

  describe("anthropicText", () => {
    it(
      "should stream with string prompt",
      async () => {
        const result = await l0({
          stream: anthropicText(
            client!,
            "claude-sonnet-4-20250514",
            "What is 2+2? Answer with just the number.",
            { maxTokens: 10 },
          ),
        });

        for await (const _event of result.stream) {
          // consume stream
        }

        expectValidResponse(result.state.content);
        expect(result.state.content).toMatch(/4/);
      },
      LLM_TIMEOUT,
    );

    it(
      "should work with system prompt",
      async () => {
        const result = await l0({
          stream: anthropicText(
            client!,
            "claude-sonnet-4-20250514",
            "Say test",
            {
              maxTokens: 20,
              system: "You are a helpful assistant. Always respond briefly.",
            },
          ),
        });

        for await (const _event of result.stream) {
          // consume stream
        }

        expectValidResponse(result.state.content);
      },
      LLM_TIMEOUT,
    );
  });

  describe("With l0() adapter option", () => {
    it(
      "should work with explicit adapter",
      async () => {
        const result = await l0({
          stream: () =>
            client!.messages.stream({
              model: "claude-sonnet-4-20250514",
              max_tokens: 50,
              messages: [{ role: "user", content: "Say 'test passed'" }],
            }),
          adapter: anthropicAdapter,
        });

        for await (const _event of result.stream) {
          // consume stream
        }

        expect(result.state.content.toLowerCase()).toContain("test");
        expect(result.state.completed).toBe(true);
        expect(result.state.tokenCount).toBeGreaterThan(0);
      },
      LLM_TIMEOUT,
    );

    it(
      "should work with registered adapter by name",
      async () => {
        clearAdapters();
        registerAdapter(anthropicAdapter);

        const result = await l0({
          stream: () =>
            client!.messages.stream({
              model: "claude-sonnet-4-20250514",
              max_tokens: 30,
              messages: [{ role: "user", content: "Say OK" }],
            }),
          adapter: "anthropic",
        });

        for await (const _event of result.stream) {
          // consume stream
        }

        expectValidResponse(result.state.content);
        clearAdapters();
      },
      LLM_TIMEOUT,
    );
  });

  describe("Monitoring", () => {
    it(
      "should track metrics with monitoring enabled",
      async () => {
        const result = await l0({
          stream: () =>
            client!.messages.stream({
              model: "claude-sonnet-4-20250514",
              max_tokens: 50,
              messages: [{ role: "user", content: "Hello" }],
            }),
          adapter: anthropicAdapter,
          monitoring: {
            enabled: true,
            includeTimings: true,
          },
        });

        for await (const _event of result.stream) {
          // consume stream
        }

        expect(result.telemetry).toBeDefined();
        expect(result.telemetry!.metrics.totalTokens).toBeGreaterThan(0);
        expect(result.telemetry!.metrics.timeToFirstToken).toBeGreaterThan(0);
      },
      LLM_TIMEOUT,
    );
  });

  describe("Streaming behavior", () => {
    it(
      "should emit timestamps on all events",
      async () => {
        const result = await l0({
          stream: () =>
            client!.messages.stream({
              model: "claude-sonnet-4-20250514",
              max_tokens: 30,
              messages: [{ role: "user", content: "Hi" }],
            }),
          adapter: anthropicAdapter,
        });

        const events: L0Event[] = [];
        for await (const event of result.stream) {
          events.push(event);
        }

        for (const event of events) {
          expect(event.timestamp).toBeDefined();
          expect(typeof event.timestamp).toBe("number");
          expect(event.timestamp).toBeGreaterThan(0);
        }
      },
      LLM_TIMEOUT,
    );

    it(
      "should track token count in state",
      async () => {
        const result = await l0({
          stream: anthropicText(
            client!,
            "claude-sonnet-4-20250514",
            "Say hello world",
            { maxTokens: 20 },
          ),
        });

        for await (const _event of result.stream) {
          // consume stream
        }

        expect(result.state.tokenCount).toBeGreaterThan(0);
        expect(result.state.content.length).toBeGreaterThan(0);
        expect(result.state.completed).toBe(true);
      },
      LLM_TIMEOUT,
    );
  });

  describe("Error handling", () => {
    it(
      "should handle invalid model gracefully",
      async () => {
        const result = await l0({
          stream: () =>
            client!.messages.stream({
              model: "invalid-model-name" as any,
              max_tokens: 10,
              messages: [{ role: "user", content: "Hi" }],
            }),
          adapter: anthropicAdapter,
          retry: { attempts: 1 },
        });

        try {
          for await (const _event of result.stream) {
            // consume stream
          }
          // Should have thrown
          expect.fail("Expected an error to be thrown");
        } catch (error) {
          expect(error).toBeDefined();
        }
      },
      LLM_TIMEOUT,
    );
  });
});
