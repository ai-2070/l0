// Pipeline Integration Tests
// Tests multi-step streaming pipelines with real LLM calls

import { describe, it, expect } from "vitest";
import {
  describeIf,
  hasOpenAI,
  LLM_TIMEOUT,
  expectValidResponse,
  expectValidJSON,
} from "./setup";
import {
  pipe,
  createPipeline,
  createStep,
  chainPipelines,
  parallelPipelines,
  createBranchStep,
} from "../src/pipeline";
import type { PipelineStep } from "../src/types/pipeline";
import { streamText } from "ai";
import { openai } from "@ai-sdk/openai";

describeIf(hasOpenAI)("Pipeline Integration", () => {
  describe("Basic Pipeline Execution", () => {
    it(
      "should execute a single-step pipeline with real LLM",
      async () => {
        const steps: PipelineStep[] = [
          {
            name: "greet",
            fn: () => ({
              stream: () =>
                streamText({
                  model: openai("gpt-4o-mini"),
                  prompt: "Say 'Hello' and nothing else.",
                }),
            }),
          },
        ];

        const result = await pipe(steps, "");

        expect(result.status).toBe("success");
        expect(result.steps.length).toBe(1);
        expect(result.steps[0]?.status).toBe("success");
        expectValidResponse(result.output);
        expect(result.output.toLowerCase()).toContain("hello");
      },
      LLM_TIMEOUT,
    );

    it(
      "should execute multi-step pipeline passing output between steps",
      async () => {
        const steps: PipelineStep[] = [
          {
            name: "generate-word",
            fn: () => ({
              stream: () =>
                streamText({
                  model: openai("gpt-4o-mini"),
                  prompt:
                    "Output exactly one word: 'apple'. Nothing else, just the word.",
                }),
            }),
          },
          {
            name: "describe-word",
            fn: (input: string) => ({
              stream: () =>
                streamText({
                  model: openai("gpt-4o-mini"),
                  prompt: `Describe the color of: ${input}. Answer in one short sentence.`,
                }),
            }),
          },
        ];

        const result = await pipe(steps, "");

        expect(result.status).toBe("success");
        expect(result.steps.length).toBe(2);
        expect(result.steps[0]?.status).toBe("success");
        expect(result.steps[1]?.status).toBe("success");
        expectValidResponse(result.output);
        // The description should mention red/green since apples are typically those colors
        const output = result.output.toLowerCase();
        expect(output.length).toBeGreaterThan(10);
      },
      LLM_TIMEOUT * 2,
    );
  });

  describe("Pipeline with Transform", () => {
    it(
      "should apply transform function to step output",
      async () => {
        const steps: PipelineStep[] = [
          {
            name: "generate",
            fn: () => ({
              stream: () =>
                streamText({
                  model: openai("gpt-4o-mini"),
                  prompt: "Say 'hello world' and nothing else.",
                }),
            }),
            transform: (result) => {
              // Transform to uppercase
              return result.state.content.toUpperCase();
            },
          },
        ];

        const result = await pipe(steps, "");

        expect(result.status).toBe("success");
        // Transform should have uppercased the output
        expect(result.output).toBe(result.output.toUpperCase());
        expect(result.output.toLowerCase()).toContain("hello");
      },
      LLM_TIMEOUT,
    );

    it(
      "should pass transformed output to next step",
      async () => {
        const steps: PipelineStep[] = [
          {
            name: "generate-json",
            fn: () => ({
              stream: () =>
                streamText({
                  model: openai("gpt-4o-mini"),
                  prompt:
                    'Output valid JSON: {"name": "Alice", "age": 30}. Nothing else.',
                }),
            }),
            transform: (result) => {
              const json = JSON.parse(result.state.content);
              return json.name;
            },
          },
          {
            name: "use-name",
            fn: (name: string) => ({
              stream: () =>
                streamText({
                  model: openai("gpt-4o-mini"),
                  prompt: `Say "Hello, ${name}!" and nothing else.`,
                }),
            }),
          },
        ];

        const result = await pipe(steps, "");

        expect(result.status).toBe("success");
        expect(result.output.toLowerCase()).toContain("hello");
        expect(result.output).toContain("Alice");
      },
      LLM_TIMEOUT * 2,
    );
  });

  describe("Conditional Steps", () => {
    it(
      "should skip step when condition returns false",
      async () => {
        const steps: PipelineStep[] = [
          {
            name: "initial",
            fn: () => ({
              stream: () =>
                streamText({
                  model: openai("gpt-4o-mini"),
                  prompt: "Say 'short' and nothing else.",
                }),
            }),
          },
          {
            name: "skipped",
            fn: () => ({
              stream: () =>
                streamText({
                  model: openai("gpt-4o-mini"),
                  prompt: "This should not run.",
                }),
            }),
            condition: (input: string) => input.length > 100, // Will be false
          },
          {
            name: "final",
            fn: (input: string) => ({
              stream: () =>
                streamText({
                  model: openai("gpt-4o-mini"),
                  prompt: `Echo back: "${input}"`,
                }),
            }),
          },
        ];

        const result = await pipe(steps, "");

        expect(result.status).toBe("success");
        expect(result.steps.length).toBe(3);
        expect(result.steps[0]?.status).toBe("success");
        expect(result.steps[1]?.status).toBe("skipped");
        expect(result.steps[2]?.status).toBe("success");
      },
      LLM_TIMEOUT * 2,
    );

    it(
      "should execute step when condition returns true",
      async () => {
        const steps: PipelineStep[] = [
          {
            name: "conditional",
            fn: () => ({
              stream: () =>
                streamText({
                  model: openai("gpt-4o-mini"),
                  prompt: "Say 'executed' and nothing else.",
                }),
            }),
            condition: () => true,
          },
        ];

        const result = await pipe(steps, "trigger");

        expect(result.status).toBe("success");
        expect(result.steps[0]?.status).toBe("success");
        expect(result.output.toLowerCase()).toContain("executed");
      },
      LLM_TIMEOUT,
    );
  });

  describe("Reusable Pipeline", () => {
    it(
      "should create and run a reusable pipeline",
      async () => {
        const pipeline = createPipeline(
          [
            {
              name: "process",
              fn: (input: string) => ({
                stream: () =>
                  streamText({
                    model: openai("gpt-4o-mini"),
                    prompt: `Reverse this word: "${input}". Output only the reversed word.`,
                  }),
              }),
            },
          ],
          { name: "reverser" },
        );

        const result = await pipeline.run("hello");

        expect(result.status).toBe("success");
        expect(result.name).toBe("reverser");
        expectValidResponse(result.output);
      },
      LLM_TIMEOUT,
    );

    it(
      "should allow adding steps to pipeline",
      async () => {
        const pipeline = createPipeline<string, string>(
          [
            {
              name: "step1",
              fn: () => ({
                stream: () =>
                  streamText({
                    model: openai("gpt-4o-mini"),
                    prompt: "Output: 'first'",
                  }),
              }),
            },
          ],
          { name: "extendable" },
        );

        pipeline.addStep({
          name: "step2",
          fn: (input: string) => ({
            stream: () =>
              streamText({
                model: openai("gpt-4o-mini"),
                prompt: `You received: "${input}". Now output: 'second'`,
              }),
          }),
        });

        const result = await pipeline.run("");

        expect(result.steps.length).toBe(2);
        expect(result.steps[0]?.stepName).toBe("step1");
        expect(result.steps[1]?.stepName).toBe("step2");
      },
      LLM_TIMEOUT * 2,
    );
  });

  describe("Chained Pipelines", () => {
    it(
      "should chain multiple pipelines together",
      async () => {
        const pipeline1 = createPipeline(
          [
            {
              name: "p1-step",
              fn: (input: string) => ({
                stream: () =>
                  streamText({
                    model: openai("gpt-4o-mini"),
                    prompt: `Add "FIRST" to: "${input}". Output the combined text.`,
                  }),
              }),
            },
          ],
          { name: "pipeline1" },
        );

        const pipeline2 = createPipeline(
          [
            {
              name: "p2-step",
              fn: (input: string) => ({
                stream: () =>
                  streamText({
                    model: openai("gpt-4o-mini"),
                    prompt: `Add "SECOND" to: "${input}". Output the combined text.`,
                  }),
              }),
            },
          ],
          { name: "pipeline2" },
        );

        const combined = chainPipelines(pipeline1, pipeline2);
        const result = await combined.run("START");

        expect(result.status).toBe("success");
        expect(result.steps.length).toBe(2);
        expect(combined.name).toBe("pipeline1 -> pipeline2");
      },
      LLM_TIMEOUT * 2,
    );
  });

  describe("Parallel Pipelines", () => {
    it(
      "should run pipelines in parallel and combine results",
      async () => {
        const sentimentPipeline = createPipeline(
          [
            {
              name: "sentiment",
              fn: (input: string) => ({
                stream: () =>
                  streamText({
                    model: openai("gpt-4o-mini"),
                    prompt: `Analyze sentiment of "${input}". Reply with one word: positive, negative, or neutral.`,
                  }),
              }),
            },
          ],
          { name: "sentiment" },
        );

        const lengthPipeline = createPipeline(
          [
            {
              name: "length",
              fn: (input: string) => ({
                stream: () =>
                  streamText({
                    model: openai("gpt-4o-mini"),
                    prompt: `Count the words in "${input}". Reply with just the number.`,
                  }),
              }),
            },
          ],
          { name: "length" },
        );

        const result = await parallelPipelines(
          [sentimentPipeline, lengthPipeline],
          "I love this beautiful day",
          (results) => ({
            sentiment: results[0]?.output,
            wordCount: results[1]?.output,
          }),
        );

        expect(result.sentiment).toBeDefined();
        expect(result.wordCount).toBeDefined();
        expect(result.sentiment!.toLowerCase()).toContain("positive");
      },
      LLM_TIMEOUT * 2,
    );
  });

  describe("Branch Steps", () => {
    it(
      "should execute correct branch based on condition",
      async () => {
        const shortStep: PipelineStep = {
          name: "short-response",
          fn: () => ({
            stream: () =>
              streamText({
                model: openai("gpt-4o-mini"),
                prompt: "Say 'SHORT' and nothing else.",
              }),
          }),
        };

        const longStep: PipelineStep = {
          name: "long-response",
          fn: () => ({
            stream: () =>
              streamText({
                model: openai("gpt-4o-mini"),
                prompt: "Say 'LONG' and nothing else.",
              }),
          }),
        };

        const branchStep = createBranchStep(
          "length-branch",
          (input: string) => input.length > 10,
          longStep,
          shortStep,
        );

        // Short input should trigger short branch
        const shortResult = await pipe([branchStep], "hi");
        expect(shortResult.output.toUpperCase()).toContain("SHORT");

        // Long input should trigger long branch
        const longResult = await pipe(
          [branchStep],
          "this is a much longer input string",
        );
        expect(longResult.output.toUpperCase()).toContain("LONG");
      },
      LLM_TIMEOUT * 2,
    );
  });

  describe("Pipeline Callbacks", () => {
    it(
      "should call onProgress for each step",
      async () => {
        const progressCalls: Array<{ step: number; total: number }> = [];

        const steps: PipelineStep[] = [
          {
            name: "step1",
            fn: () => ({
              stream: () =>
                streamText({
                  model: openai("gpt-4o-mini"),
                  prompt: "Say 'one'",
                }),
            }),
          },
          {
            name: "step2",
            fn: () => ({
              stream: () =>
                streamText({
                  model: openai("gpt-4o-mini"),
                  prompt: "Say 'two'",
                }),
            }),
          },
        ];

        await pipe(steps, "", {
          onProgress: (step, total) => {
            progressCalls.push({ step, total });
          },
        });

        expect(progressCalls).toEqual([
          { step: 0, total: 2 },
          { step: 1, total: 2 },
        ]);
      },
      LLM_TIMEOUT * 2,
    );

    it(
      "should call onComplete with final result",
      async () => {
        let completedResult: any = null;

        const steps: PipelineStep[] = [
          {
            name: "final",
            fn: () => ({
              stream: () =>
                streamText({
                  model: openai("gpt-4o-mini"),
                  prompt: "Say 'done'",
                }),
            }),
          },
        ];

        await pipe(steps, "", {
          onComplete: (result) => {
            completedResult = result;
          },
        });

        expect(completedResult).not.toBeNull();
        expect(completedResult.status).toBe("success");
        expect(completedResult.steps.length).toBe(1);
      },
      LLM_TIMEOUT,
    );
  });

  describe("Real-World Pipeline Scenarios", () => {
    it(
      "should handle summarize-then-translate pipeline",
      async () => {
        const pipeline = createPipeline(
          [
            {
              name: "summarize",
              fn: (text: string) => ({
                stream: () =>
                  streamText({
                    model: openai("gpt-4o-mini"),
                    prompt: `Summarize in one sentence: "${text}"`,
                  }),
              }),
            },
            {
              name: "translate",
              fn: (summary: string) => ({
                stream: () =>
                  streamText({
                    model: openai("gpt-4o-mini"),
                    prompt: `Translate to French: "${summary}"`,
                  }),
              }),
            },
          ],
          { name: "summarize-translate" },
        );

        const result = await pipeline.run(
          "The quick brown fox jumps over the lazy dog. This sentence contains every letter of the alphabet.",
        );

        expect(result.status).toBe("success");
        expect(result.steps.length).toBe(2);
        expect(result.steps[0]?.status).toBe("success");
        expect(result.steps[1]?.status).toBe("success");
        expectValidResponse(result.output);
      },
      LLM_TIMEOUT * 2,
    );

    it(
      "should handle extract-analyze-format pipeline",
      async () => {
        const pipeline = createPipeline(
          [
            {
              name: "extract",
              fn: () => ({
                stream: () =>
                  streamText({
                    model: openai("gpt-4o-mini"),
                    prompt:
                      'Extract: name and age from "John is 25 years old". Output as JSON: {"name": "...", "age": ...}',
                  }),
              }),
            },
            {
              name: "format",
              fn: (json: string) => ({
                stream: () =>
                  streamText({
                    model: openai("gpt-4o-mini"),
                    prompt: `Format this data as a sentence: ${json}`,
                  }),
              }),
            },
          ],
          { name: "extract-format" },
        );

        const result = await pipeline.run("");

        expect(result.status).toBe("success");
        expect(result.steps.length).toBe(2);
        // Final output should be a formatted sentence
        expectValidResponse(result.output);
        expect(result.output.toLowerCase()).toContain("john");
      },
      LLM_TIMEOUT * 2,
    );
  });

  describe("Pipeline Metadata", () => {
    it(
      "should pass metadata through pipeline",
      async () => {
        let receivedMetadata: Record<string, any> = {};

        const steps: PipelineStep[] = [
          {
            name: "metadata-check",
            fn: (_, context) => {
              receivedMetadata = context.metadata;
              return {
                stream: () =>
                  streamText({
                    model: openai("gpt-4o-mini"),
                    prompt: "Say 'ok'",
                  }),
              };
            },
          },
        ];

        const result = await pipe(steps, "", {
          metadata: { userId: "123", requestId: "abc" },
        });

        expect(result.status).toBe("success");
        expect(receivedMetadata).toEqual({ userId: "123", requestId: "abc" });
        expect(result.metadata).toEqual({ userId: "123", requestId: "abc" });
      },
      LLM_TIMEOUT,
    );
  });

  describe("Pipeline Duration Tracking", () => {
    it(
      "should track pipeline and step durations",
      async () => {
        const steps: PipelineStep[] = [
          {
            name: "timed-step",
            fn: () => ({
              stream: () =>
                streamText({
                  model: openai("gpt-4o-mini"),
                  prompt: "Say 'hello'",
                }),
            }),
          },
        ];

        const result = await pipe(steps, "");

        expect(result.status).toBe("success");
        expect(result.duration).toBeGreaterThan(0);
        expect(result.startTime).toBeLessThan(result.endTime);
        expect(result.steps[0]?.duration).toBeGreaterThan(0);
        expect(result.steps[0]?.startTime).toBeLessThan(
          result.steps[0]?.endTime ?? 0,
        );
      },
      LLM_TIMEOUT,
    );
  });
});
