// Consensus Integration Tests
// Run: OPENAI_API_KEY=sk-... npm run test:integration

import { describe, it, expect } from "vitest";
import {
  describeIf,
  hasOpenAI,
  LLM_TIMEOUT,
  expectValidResponse,
} from "./setup";
import {
  consensus,
  quickConsensus,
  getConsensusValue,
  validateConsensus,
} from "../src/consensus";
import { streamText } from "ai";
import { openai } from "@ai-sdk/openai";
import { z } from "zod";

describeIf(hasOpenAI)("Consensus Integration", () => {
  describe("Basic Text Consensus", () => {
    it(
      "should reach consensus with identical prompts",
      async () => {
        const prompt = "What is 2 + 2? Reply with just the number.";

        const result = await consensus({
          detectZeroTokens: false,
          streams: [
            () => streamText({ model: openai("gpt-5-nano"), prompt }),
            () => streamText({ model: openai("gpt-5-nano"), prompt }),
            () => streamText({ model: openai("gpt-5-nano"), prompt }),
          ],
        });

        expect(result.status).toBe("success");
        expect(result.consensus).toBeDefined();
        expect(result.confidence).toBeGreaterThan(0);
        expect(result.outputs.length).toBe(3);
        expect(result.analysis.successfulOutputs).toBe(3);
      },
      LLM_TIMEOUT * 2,
    );

    it(
      "should calculate similarity between outputs",
      async () => {
        const prompt = "Say: Hello World";

        const result = await consensus({
          detectZeroTokens: false,
          streams: [
            () => streamText({ model: openai("gpt-5-nano"), prompt }),
            () => streamText({ model: openai("gpt-5-nano"), prompt }),
          ],
        });

        expect(result.analysis.similarityMatrix).toBeDefined();
        expect(result.analysis.averageSimilarity).toBeGreaterThanOrEqual(0);
        expect(result.analysis.averageSimilarity).toBeLessThanOrEqual(1);
      },
      LLM_TIMEOUT * 2,
    );

    it(
      "should track agreements and disagreements",
      async () => {
        const prompt = "What color is the sky on a clear day? One word answer.";

        const result = await consensus({
          detectZeroTokens: false,
          streams: [
            () => streamText({ model: openai("gpt-5-nano"), prompt }),
            () => streamText({ model: openai("gpt-5-nano"), prompt }),
            () => streamText({ model: openai("gpt-5-nano"), prompt }),
          ],
          threshold: 0.7,
        });

        expect(result.agreements).toBeDefined();
        expect(result.disagreements).toBeDefined();
        expect(result.analysis.totalAgreements).toBeGreaterThanOrEqual(0);
        expect(result.analysis.totalDisagreements).toBeGreaterThanOrEqual(0);
      },
      LLM_TIMEOUT * 2,
    );
  });

  describe("Structured Consensus", () => {
    it(
      "should reach consensus on structured output",
      async () => {
        const schema = z.object({
          answer: z.number(),
          unit: z.string(),
        });

        const prompt =
          "What is 5 + 3? Return JSON with answer (number) and unit (string, use 'none').";

        const result = await consensus({
          detectZeroTokens: false,
          streams: [
            () => streamText({ model: openai("gpt-5-nano"), prompt }),
            () => streamText({ model: openai("gpt-5-nano"), prompt }),
            () => streamText({ model: openai("gpt-5-nano"), prompt }),
          ],
          schema,
        });

        expect(result.type).toBe("structured");
        expect(result.consensus).toBeDefined();
        expect(typeof result.consensus).toBe("object");
        expect(result.fieldConsensus).toBeDefined();
      },
      LLM_TIMEOUT * 3,
    );

    it(
      "should calculate field-level consensus",
      async () => {
        const schema = z.object({
          name: z.string(),
          count: z.number(),
        });

        const prompt =
          'Return JSON: {"name": "test", "count": 42}. Exactly as shown.';

        const result = await consensus({
          detectZeroTokens: false,
          streams: [
            () => streamText({ model: openai("gpt-5-nano"), prompt }),
            () => streamText({ model: openai("gpt-5-nano"), prompt }),
          ],
          schema,
        });

        expect(result.fieldConsensus).toBeDefined();
        if (result.fieldConsensus) {
          // Field consensus should have entries for each field
          expect(Object.keys(result.fieldConsensus).length).toBeGreaterThan(0);
        }
      },
      LLM_TIMEOUT * 2,
    );
  });

  describe("Consensus Strategies", () => {
    it(
      "should use majority strategy by default",
      async () => {
        const prompt = "Say: test";

        const result = await consensus({
          detectZeroTokens: false,
          streams: [
            () => streamText({ model: openai("gpt-5-nano"), prompt }),
            () => streamText({ model: openai("gpt-5-nano"), prompt }),
            () => streamText({ model: openai("gpt-5-nano"), prompt }),
          ],
          strategy: "majority",
        });

        expect(result.analysis.strategy).toBe("majority");
        expect(result.consensus).toBeDefined();
      },
      LLM_TIMEOUT * 2,
    );

    it(
      "should support best strategy",
      async () => {
        const prompt = "Write a very short greeting.";

        const result = await consensus({
          detectZeroTokens: false,
          streams: [
            () => streamText({ model: openai("gpt-5-nano"), prompt }),
            () => streamText({ model: openai("gpt-5-nano"), prompt }),
          ],
          strategy: "best",
        });

        expect(result.analysis.strategy).toBe("best");
        expect(result.consensus).toBeDefined();
        expectValidResponse(result.consensus as string);
      },
      LLM_TIMEOUT * 2,
    );

    it(
      "should support weighted strategy",
      async () => {
        const prompt = "Say: weighted test";

        const result = await consensus({
          detectZeroTokens: false,
          streams: [
            () => streamText({ model: openai("gpt-5-nano"), prompt }),
            () => streamText({ model: openai("gpt-5-nano"), prompt }),
            () => streamText({ model: openai("gpt-5-nano"), prompt }),
          ],
          strategy: "weighted",
          weights: [1.0, 0.5, 0.5], // First stream has more weight
        });

        expect(result.analysis.strategy).toBe("weighted");
        expect(result.consensus).toBeDefined();
      },
      LLM_TIMEOUT * 2,
    );
  });

  describe("Conflict Resolution", () => {
    it(
      "should resolve conflicts with vote by default",
      async () => {
        const prompt = "Pick a random number between 1 and 3. Just the number.";

        const result = await consensus({
          detectZeroTokens: false,
          streams: [
            () => streamText({ model: openai("gpt-5-nano"), prompt }),
            () => streamText({ model: openai("gpt-5-nano"), prompt }),
            () => streamText({ model: openai("gpt-5-nano"), prompt }),
          ],
          resolveConflicts: "vote",
        });

        expect(result.analysis.conflictResolution).toBe("vote");
        expect(result.consensus).toBeDefined();
      },
      LLM_TIMEOUT * 2,
    );

    it(
      "should support merge conflict resolution",
      async () => {
        const prompt = "List one fruit.";

        const result = await consensus({
          detectZeroTokens: false,
          streams: [
            () => streamText({ model: openai("gpt-5-nano"), prompt }),
            () => streamText({ model: openai("gpt-5-nano"), prompt }),
          ],
          resolveConflicts: "merge",
        });

        expect(result.consensus).toBeDefined();
      },
      LLM_TIMEOUT * 2,
    );

    it(
      "should support best conflict resolution",
      async () => {
        const prompt = "Say: conflict test";

        const result = await consensus({
          detectZeroTokens: false,
          streams: [
            () => streamText({ model: openai("gpt-5-nano"), prompt }),
            () => streamText({ model: openai("gpt-5-nano"), prompt }),
          ],
          resolveConflicts: "best",
        });

        expect(result.consensus).toBeDefined();
      },
      LLM_TIMEOUT * 2,
    );
  });

  describe("Consensus Analysis", () => {
    it(
      "should provide detailed analysis",
      async () => {
        const prompt = "Say: analysis test";

        const result = await consensus({
          detectZeroTokens: false,
          streams: [
            () => streamText({ model: openai("gpt-5-nano"), prompt }),
            () => streamText({ model: openai("gpt-5-nano"), prompt }),
          ],
        });

        expect(result.analysis).toBeDefined();
        expect(result.analysis.totalOutputs).toBe(2);
        expect(result.analysis.successfulOutputs).toBeGreaterThan(0);
        expect(result.analysis.duration).toBeGreaterThan(0);
        expect(result.analysis.averageSimilarity).toBeDefined();
        expect(result.analysis.minSimilarity).toBeDefined();
        expect(result.analysis.maxSimilarity).toBeDefined();
      },
      LLM_TIMEOUT * 2,
    );

    it(
      "should count identical outputs",
      async () => {
        const prompt = "Reply with exactly: IDENTICAL";

        const result = await consensus({
          detectZeroTokens: false,
          streams: [
            () => streamText({ model: openai("gpt-5-nano"), prompt }),
            () => streamText({ model: openai("gpt-5-nano"), prompt }),
            () => streamText({ model: openai("gpt-5-nano"), prompt }),
          ],
        });

        expect(result.analysis.identicalOutputs).toBeGreaterThanOrEqual(0);
        expect(result.analysis.identicalOutputs).toBeLessThanOrEqual(3);
      },
      LLM_TIMEOUT * 2,
    );
  });

  describe("Confidence Calculation", () => {
    it(
      "should calculate confidence score",
      async () => {
        const prompt = "What is the capital of France? One word.";

        const result = await consensus({
          detectZeroTokens: false,
          streams: [
            () => streamText({ model: openai("gpt-5-nano"), prompt }),
            () => streamText({ model: openai("gpt-5-nano"), prompt }),
            () => streamText({ model: openai("gpt-5-nano"), prompt }),
          ],
        });

        expect(result.confidence).toBeGreaterThanOrEqual(0);
        expect(result.confidence).toBeLessThanOrEqual(1);
      },
      LLM_TIMEOUT * 2,
    );

    it(
      "should have higher confidence for agreeing outputs",
      async () => {
        // Deterministic prompt should give high agreement
        const prompt = "What is 1 + 1? Just the number.";

        const result = await consensus({
          detectZeroTokens: false,
          streams: [
            () => streamText({ model: openai("gpt-5-nano"), prompt }),
            () => streamText({ model: openai("gpt-5-nano"), prompt }),
            () => streamText({ model: openai("gpt-5-nano"), prompt }),
          ],
        });

        // Should have reasonable confidence for simple math
        expect(result.confidence).toBeGreaterThan(0.3);
      },
      LLM_TIMEOUT * 2,
    );
  });

  describe("Callbacks", () => {
    it(
      "should call onComplete callback",
      async () => {
        let completeCalled = false;
        let outputCount = 0;

        const result = await consensus({
          detectZeroTokens: false,
          streams: [
            () =>
              streamText({
                model: openai("gpt-5-nano"),
                prompt: "Say: callback test",
              }),
            () =>
              streamText({
                model: openai("gpt-5-nano"),
                prompt: "Say: callback test",
              }),
          ],
          onComplete: async (outputs) => {
            completeCalled = true;
            outputCount = outputs.length;
          },
        });

        expect(completeCalled).toBe(true);
        expect(outputCount).toBe(2);
      },
      LLM_TIMEOUT * 2,
    );

    it(
      "should call onConsensus callback",
      async () => {
        let consensusCalled = false;
        let receivedConfidence = 0;

        await consensus({
          detectZeroTokens: false,
          streams: [
            () =>
              streamText({
                model: openai("gpt-5-nano"),
                prompt: "Say: consensus callback",
              }),
            () =>
              streamText({
                model: openai("gpt-5-nano"),
                prompt: "Say: consensus callback",
              }),
          ],
          onConsensus: async (result) => {
            consensusCalled = true;
            receivedConfidence = result.confidence;
          },
        });

        expect(consensusCalled).toBe(true);
        expect(receivedConfidence).toBeGreaterThan(0);
      },
      LLM_TIMEOUT * 2,
    );
  });

  describe("Error Handling", () => {
    it(
      "should handle partial failures gracefully",
      async () => {
        const result = await consensus({
          detectZeroTokens: false,
          streams: [
            () =>
              streamText({
                model: openai("gpt-5-nano"),
                prompt: "Say: success",
              }),
            () => {
              throw new Error("Simulated stream failure");
            },
            () =>
              streamText({
                model: openai("gpt-5-nano"),
                prompt: "Say: success",
              }),
          ],
        });

        // Should still produce a result from successful streams
        expect(result.status).toBe("partial");
        expect(result.analysis.failedOutputs).toBe(1);
        expect(result.analysis.successfulOutputs).toBe(2);
        expect(result.consensus).toBeDefined();
      },
      LLM_TIMEOUT * 2,
    );

    it("should throw error if less than 2 streams provided", async () => {
      await expect(
        consensus({
          streams: [
            () =>
              streamText({
                model: openai("gpt-5-nano"),
                prompt: "Single stream",
              }),
          ],
        }),
      ).rejects.toThrow("Consensus requires at least 2 streams");
    });
  });

  describe("Utility Functions", () => {
    it("quickConsensus should check agreement", () => {
      expect(quickConsensus(["A", "A", "A"])).toBe(true); // 3/3 = 1.0 >= 0.8 default
      expect(quickConsensus(["A", "A", "B"])).toBe(false); // 2/3 = 0.66 < 0.8 default
      expect(quickConsensus(["A", "A", "B"], 0.5)).toBe(true); // 2/3 = 0.66 > 0.5 threshold
      expect(quickConsensus(["A", "B", "C"], 0.9)).toBe(false); // 1/3 = 0.33 < 0.9
    });

    it("getConsensusValue should return most common value", () => {
      expect(getConsensusValue(["A", "A", "B"])).toBe("A");
      expect(getConsensusValue(["X", "Y", "Y", "Y"])).toBe("Y");
      expect(getConsensusValue([1, 1, 2, 1])).toBe(1);
    });

    it(
      "validateConsensus should check criteria",
      async () => {
        const result = await consensus({
          detectZeroTokens: false,
          streams: [
            () =>
              streamText({
                model: openai("gpt-5-nano"),
                prompt: "Say: validate",
              }),
            () =>
              streamText({
                model: openai("gpt-5-nano"),
                prompt: "Say: validate",
              }),
          ],
        });

        // Should be valid with low requirements
        const isValid = validateConsensus(result, 0.1, 10);
        expect(typeof isValid).toBe("boolean");
      },
      LLM_TIMEOUT * 2,
    );
  });

  describe("Metadata", () => {
    it(
      "should pass through metadata",
      async () => {
        const metadata = { testId: "consensus-test-123", version: 1 };

        const result = await consensus({
          detectZeroTokens: false,
          streams: [
            () =>
              streamText({
                model: openai("gpt-5-nano"),
                prompt: "Say: metadata test",
              }),
            () =>
              streamText({
                model: openai("gpt-5-nano"),
                prompt: "Say: metadata test",
              }),
          ],
          metadata,
        });

        expect(result.metadata).toEqual(metadata);
      },
      LLM_TIMEOUT * 2,
    );
  });

  describe("Minimum Agreement Threshold", () => {
    it(
      "should respect minimum agreement setting",
      async () => {
        const prompt = "Say: agreement threshold";

        const result = await consensus({
          detectZeroTokens: false,
          streams: [
            () => streamText({ model: openai("gpt-5-nano"), prompt }),
            () => streamText({ model: openai("gpt-5-nano"), prompt }),
          ],
          minimumAgreement: 0.3, // Low threshold
        });

        expect(result.consensus).toBeDefined();
      },
      LLM_TIMEOUT * 2,
    );
  });
});
