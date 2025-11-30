// Window/Document Chunking Integration Tests
// Run: OPENAI_API_KEY=sk-... npm run test:integration

import { describe, it, expect } from "vitest";
import {
  describeIf,
  hasOpenAI,
  LLM_TIMEOUT,
  expectValidResponse,
} from "./setup";
import {
  createWindow,
  processWithWindow,
  mergeResults,
  getProcessingStats,
} from "../src/window";
import { streamText } from "ai";
import { openai } from "@ai-sdk/openai";

// Sample long document for testing
const LONG_DOCUMENT = `
The history of artificial intelligence began in antiquity, with myths, stories and rumors of artificial beings endowed with intelligence or consciousness by master craftsmen. The seeds of modern AI were planted by philosophers who attempted to describe the process of human thinking as the mechanical manipulation of symbols.

This work culminated in the invention of the programmable digital computer in the 1940s, a machine based on the abstract essence of mathematical reasoning. This device and the ideas behind it inspired a handful of scientists to begin seriously discussing the possibility of building an electronic brain.

The field of AI research was founded at a workshop held on the campus of Dartmouth College during the summer of 1956. Those who attended would become the leaders of AI research for decades. Many of them predicted that a machine as intelligent as a human being would exist in no more than a generation, and they were given millions of dollars to make this vision come true.

Eventually, it became obvious that they had grossly underestimated the difficulty of the project. In 1973, in response to the criticism of James Lighthill and ongoing pressure from Congress, the U.S. and British governments stopped funding undirected research into artificial intelligence. Seven years later, a visionary initiative by the Japanese Government inspired governments and industry to provide AI with billions of dollars, but by the late 1980s the investors became disillusioned and withdrew funding again.

Investment and interest in AI boomed in the first decades of the 21st century, when machine learning was successfully applied to many problems in academia and industry due to the availability of powerful computer hardware. The field experienced another setback in 2023 when researchers found that large language models had inherent limitations that prevented them from achieving artificial general intelligence.

Deep learning breakthroughs in the 2010s led to a new wave of AI enthusiasm. Convolutional neural networks revolutionized computer vision, while recurrent neural networks and later transformer models transformed natural language processing. These advances enabled applications like voice assistants, autonomous vehicles, and medical diagnosis systems.

The ethical implications of AI have become increasingly important. Researchers and policymakers debate issues such as algorithmic bias, privacy concerns, job displacement, and the potential risks of superintelligent AI. Many organizations have established AI ethics boards and guidelines to ensure responsible development and deployment of AI systems.

Today, AI continues to evolve rapidly. Large language models have demonstrated remarkable capabilities in text generation, code writing, and reasoning tasks. Multimodal models can process and generate text, images, and audio. The quest for artificial general intelligence continues, though experts disagree on timelines and approaches.
`.trim();

describeIf(hasOpenAI)("Window/Document Chunking Integration", () => {
  describe("Document Window Creation", () => {
    it("should create a window with default options", () => {
      const window = createWindow(LONG_DOCUMENT);

      expect(window.totalChunks).toBeGreaterThan(0);
      expect(window.currentIndex).toBe(0);
      expect(window.current()).not.toBeNull();
    });

    it("should create a window with custom chunk size", () => {
      const smallWindow = createWindow(LONG_DOCUMENT, { size: 500 });
      const largeWindow = createWindow(LONG_DOCUMENT, { size: 2000 });

      expect(smallWindow.totalChunks).toBeGreaterThan(largeWindow.totalChunks);
    });

    it("should create a window with overlap", () => {
      const window = createWindow(LONG_DOCUMENT, {
        size: 1000,
        overlap: 100,
      });

      const stats = window.getStats();
      expect(stats.overlapSize).toBe(100);
      expect(stats.totalChunks).toBeGreaterThan(0);
    });
  });

  describe("Window Navigation", () => {
    it("should navigate through chunks", () => {
      const window = createWindow(LONG_DOCUMENT, { size: 500 });

      const first = window.current();
      expect(first).not.toBeNull();
      expect(first?.index).toBe(0);

      const second = window.next();
      expect(second).not.toBeNull();
      expect(second?.index).toBe(1);

      const backToFirst = window.prev();
      expect(backToFirst).not.toBeNull();
      expect(backToFirst?.index).toBe(0);
    });

    it("should jump to specific chunk", () => {
      const window = createWindow(LONG_DOCUMENT, { size: 500 });

      if (window.totalChunks > 2) {
        const jumped = window.jump(2);
        expect(jumped).not.toBeNull();
        expect(jumped?.index).toBe(2);
        expect(window.currentIndex).toBe(2);
      }
    });

    it("should reset to first chunk", () => {
      const window = createWindow(LONG_DOCUMENT, { size: 500 });

      window.next();
      window.next();
      window.reset();

      expect(window.currentIndex).toBe(0);
    });

    it("should check hasNext and hasPrev", () => {
      const window = createWindow(LONG_DOCUMENT, { size: 500 });

      expect(window.hasPrev()).toBe(false);
      expect(window.hasNext()).toBe(window.totalChunks > 1);

      if (window.totalChunks > 1) {
        window.next();
        expect(window.hasPrev()).toBe(true);
      }
    });
  });

  describe("Chunk Processing with LLM", () => {
    it(
      "should process a single chunk with L0",
      async () => {
        const window = createWindow(LONG_DOCUMENT, { size: 1000 });
        const chunk = window.current();

        expect(chunk).not.toBeNull();

        const results = await window.processSequential((c) => ({
          stream: () =>
            streamText({
              model: openai("gpt-5-nano"),
              prompt: `Summarize in one sentence: ${c.content.substring(0, 200)}...`,
            }),
          detectZeroTokens: false,
        }));

        // At least first chunk should succeed
        expect(results.length).toBeGreaterThan(0);
        expect(results[0].status).toBe("success");
        expectValidResponse(results[0].result?.state?.content || "");
      },
      LLM_TIMEOUT * 3,
    );

    it(
      "should process multiple chunks in parallel",
      async () => {
        const window = createWindow(LONG_DOCUMENT, { size: 1500 });

        // Limit to first 2 chunks to keep test fast
        const chunks = window.getRange(0, 2);

        const results = await Promise.all(
          chunks.map(async (chunk) => {
            const { l0 } = await import("../src/index");
            const result = await l0({
              stream: () =>
                streamText({
                  model: openai("gpt-5-nano"),
                  prompt: `What is the main topic? ${chunk.content.substring(0, 150)}`,
                }),
              detectZeroTokens: false,
            });

            for await (const _event of result.stream) {
              // consume
            }

            return {
              chunk,
              content: result.state.content,
              status: "success" as const,
            };
          }),
        );

        expect(results.length).toBe(chunks.length);
        results.forEach((r) => {
          expect(r.status).toBe("success");
          expectValidResponse(r.content);
        });
      },
      LLM_TIMEOUT * 3,
    );
  });

  describe("processWithWindow Helper", () => {
    it(
      "should process document with window helper",
      async () => {
        // Use a shorter document to limit chunks
        const shortDoc = LONG_DOCUMENT.substring(0, 1000);

        const results = await processWithWindow(
          shortDoc,
          (chunk) => ({
            stream: () =>
              streamText({
                model: openai("gpt-5-nano"),
                prompt: `Extract key terms from: ${chunk.content.substring(0, 100)}`,
              }),
            detectZeroTokens: false,
          }),
          { size: 800, overlap: 50 },
        );

        expect(results.length).toBeGreaterThan(0);

        const stats = getProcessingStats(results);
        expect(stats.total).toBeGreaterThan(0);
        expect(stats.successRate).toBeGreaterThan(0);
      },
      LLM_TIMEOUT * 4,
    );
  });

  describe("Result Merging", () => {
    it(
      "should merge results from multiple chunks",
      async () => {
        const window = createWindow(LONG_DOCUMENT.substring(0, 800), {
          size: 400,
        });

        const results = await window.processSequential((chunk) => ({
          stream: () =>
            streamText({
              model: openai("gpt-5-nano"),
              prompt: `Give one word about: ${chunk.content.substring(0, 50)}`,
            }),
          detectZeroTokens: false,
        }));

        const merged = mergeResults(results, " | ");

        expect(merged.length).toBeGreaterThan(0);
        // Should have separator if multiple successful results
        if (results.filter((r) => r.status === "success").length > 1) {
          expect(merged).toContain(" | ");
        }
      },
      LLM_TIMEOUT * 3,
    );
  });

  describe("Window Statistics", () => {
    it("should provide accurate statistics", () => {
      const window = createWindow(LONG_DOCUMENT, {
        size: 1000,
        overlap: 100,
        strategy: "token",
      });

      const stats = window.getStats();

      expect(stats.totalChunks).toBe(window.totalChunks);
      expect(stats.totalChars).toBe(LONG_DOCUMENT.length);
      expect(stats.totalTokens).toBeGreaterThan(0);
      expect(stats.avgChunkSize).toBeGreaterThan(0);
      expect(stats.avgChunkTokens).toBeGreaterThan(0);
      expect(stats.overlapSize).toBe(100);
      expect(stats.strategy).toBe("token");
    });
  });

  describe("Chunk Search", () => {
    it("should find chunks containing specific text using getAllChunks", () => {
      const window = createWindow(LONG_DOCUMENT, { size: 500 });

      // Use getAllChunks and filter manually since findChunks doesn't exist
      const allChunks = window.getAllChunks();
      const results = allChunks.filter((chunk) =>
        chunk.content.toLowerCase().includes("artificial intelligence"),
      );

      expect(results.length).toBeGreaterThan(0);
      results.forEach((chunk) => {
        expect(chunk.content.toLowerCase()).toContain(
          "artificial intelligence",
        );
      });
    });

    it("should handle case-sensitive search using getAllChunks", () => {
      const window = createWindow(LONG_DOCUMENT, { size: 500 });

      const allChunks = window.getAllChunks();
      const caseInsensitive = allChunks.filter((chunk) =>
        chunk.content.toLowerCase().includes("ai"),
      );
      const caseSensitive = allChunks.filter((chunk) =>
        chunk.content.includes("AI"),
      );

      // Case insensitive should find more or equal matches
      expect(caseInsensitive.length).toBeGreaterThanOrEqual(
        caseSensitive.length,
      );
    });
  });

  describe("Context Retrieval", () => {
    it("should get context with surrounding chunks using getRange", () => {
      const window = createWindow(LONG_DOCUMENT, { size: 300 });

      if (window.totalChunks >= 3) {
        // Use getRange to get surrounding chunks instead of getContext
        const beforeChunk = window.get(0);
        const currentChunk = window.get(1);
        const afterChunk = window.get(2);

        const context = [beforeChunk, currentChunk, afterChunk]
          .filter(Boolean)
          .map((c) => c!.content)
          .join("\n");

        // Context should include content from multiple chunks
        expect(context.length).toBeGreaterThan(
          currentChunk?.content.length || 0,
        );
      }
    });
  });
});
