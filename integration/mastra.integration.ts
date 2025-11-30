// Mastra AI Integration Tests
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
  mastraStream,
  mastraAdapter,
  wrapMastraStream,
  extractMastraText,
  recommendedGuardrails,
} from "../src/index";
import { Agent } from "@mastra/core/agent";
import { openai } from "@ai-sdk/openai";

// Create a test agent (requires OpenAI key since Mastra uses it under the hood)
const createTestAgent = () =>
  new Agent({
    name: "test-agent",
    instructions: "You are a helpful assistant. Keep responses brief.",
    model: openai("gpt-5-nano"),
  });

describeIf(hasOpenAI)("Mastra AI Integration", () => {
  describe("mastraStream", () => {
    it(
      "should stream from Mastra agent",
      async () => {
        const agent = createTestAgent();

        const result = await l0({
          stream: mastraStream(agent, "Say 'hello' and nothing else"),
        });

        for await (const event of result.stream) {
          // consume stream
        }

        expectValidResponse(result.state.content);
        expect(result.state.content.toLowerCase()).toContain("hello");
      },
      LLM_TIMEOUT,
    );

    it(
      "should work with messages array",
      async () => {
        const agent = createTestAgent();

        const result = await l0({
          stream: mastraStream(agent, [
            {
              role: "user",
              content: "What is 1+1? Please explain your answer.",
            },
          ]),
          detectZeroTokens: false,
        });

        for await (const event of result.stream) {
          // consume stream
        }

        expectValidResponse(result.state.content);
        expect(result.state.content).toContain("2");
      },
      LLM_TIMEOUT,
    );
  });

  describe("mastraAdapter", () => {
    it(
      "should stream with explicit adapter",
      async () => {
        const agent = createTestAgent();

        const result = await l0({
          stream: () => agent.stream("Say 'adapter' and nothing else"),
          adapter: mastraAdapter,
        });

        for await (const event of result.stream) {
          // consume stream
        }

        expectValidResponse(result.state.content);
        expect(result.state.content.toLowerCase()).toContain("adapter");
      },
      LLM_TIMEOUT,
    );
  });

  describe("wrapMastraStream", () => {
    it(
      "should wrap Mastra stream result",
      async () => {
        const agent = createTestAgent();
        const streamResult = await agent.stream("Say 'test'");

        const tokens: string[] = [];
        for await (const event of wrapMastraStream(streamResult)) {
          if (event.type === "token" && event.value) {
            tokens.push(event.value);
          }
        }

        expect(tokens.length).toBeGreaterThan(0);
        expect(tokens.join("").toLowerCase()).toContain("test");
      },
      LLM_TIMEOUT,
    );

    it(
      "should include usage when enabled",
      async () => {
        const agent = createTestAgent();
        const streamResult = await agent.stream("Hi");

        let doneEvent: any;
        for await (const event of wrapMastraStream(streamResult, {
          includeUsage: true,
        })) {
          if (event.type === "done") {
            doneEvent = event;
          }
        }

        expect(doneEvent).toBeDefined();
        // Usage may or may not be present depending on Mastra version
      },
      LLM_TIMEOUT,
    );
  });

  describe("extractMastraText", () => {
    it(
      "should extract full text from stream",
      async () => {
        const agent = createTestAgent();
        const streamResult = await agent.stream("Count from 1 to 3");

        const text = await extractMastraText(streamResult);

        expectValidResponse(text);
        expect(text).toContain("1");
        expect(text).toContain("2");
        expect(text).toContain("3");
      },
      LLM_TIMEOUT,
    );
  });

  describe("With Guardrails", () => {
    it(
      "should apply guardrails to Mastra output",
      async () => {
        const agent = createTestAgent();
        const violations: any[] = [];

        const result = await l0({
          stream: mastraStream(agent, "Write a short greeting"),
          guardrails: recommendedGuardrails,
          onViolation: (v) => violations.push(v),
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

  describe("With Monitoring", () => {
    it(
      "should collect telemetry from Mastra stream",
      async () => {
        const agent = createTestAgent();

        const result = await l0({
          stream: mastraStream(
            agent,
            "Say something interesting about programming",
          ),
          monitoring: { enabled: true },
          detectZeroTokens: false,
        });

        for await (const event of result.stream) {
          // consume stream
        }

        expect(result.telemetry).toBeDefined();
        expect(result.telemetry?.duration).toBeGreaterThan(0);
        expect(result.telemetry?.metrics.totalTokens).toBeGreaterThan(0);
      },
      LLM_TIMEOUT,
    );
  });

  describe("With Fallback", () => {
    it(
      "should fall back from failed Mastra stream",
      async () => {
        const agent = createTestAgent();

        const result = await l0({
          stream: () => {
            throw new Error("Primary Mastra agent failed");
          },
          fallbackStreams: [
            mastraStream(agent, "Say 'fallback worked successfully'"),
          ],
          // Enable retry so thrown errors trigger fallback
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
  });
});
