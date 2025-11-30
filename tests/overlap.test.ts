// Unit tests for overlap detection in continuation

import { describe, it, expect } from "vitest";
import {
  detectOverlap,
  deduplicateContinuation,
} from "../src/utils/tokens";

describe("detectOverlap", () => {
  describe("basic overlap detection", () => {
    it("should detect simple word overlap", () => {
      const result = detectOverlap("Hello world", "world is great");
      expect(result.hasOverlap).toBe(true);
      expect(result.overlapLength).toBe(5);
      expect(result.overlapText).toBe("world");
      expect(result.deduplicatedContinuation).toBe(" is great");
    });

    it("should detect multi-word overlap", () => {
      const result = detectOverlap(
        "The quick brown fox",
        "brown fox jumps over",
      );
      expect(result.hasOverlap).toBe(true);
      expect(result.overlapLength).toBe(9);
      expect(result.overlapText).toBe("brown fox");
      expect(result.deduplicatedContinuation).toBe(" jumps over");
    });

    it("should detect overlap with punctuation", () => {
      const result = detectOverlap(
        "Hello, world!",
        "world! How are you?",
      );
      expect(result.hasOverlap).toBe(true);
      expect(result.overlapLength).toBe(6);
      expect(result.overlapText).toBe("world!");
      expect(result.deduplicatedContinuation).toBe(" How are you?");
    });

    it("should detect single character overlap", () => {
      const result = detectOverlap("abc", "cd", { minOverlap: 1 });
      expect(result.hasOverlap).toBe(true);
      expect(result.overlapLength).toBe(1);
      expect(result.overlapText).toBe("c");
      expect(result.deduplicatedContinuation).toBe("d");
    });

    it("should detect overlap at sentence boundary", () => {
      const result = detectOverlap(
        "First sentence. Second sentence",
        "Second sentence continues here.",
      );
      expect(result.hasOverlap).toBe(true);
      expect(result.overlapText).toBe("Second sentence");
      expect(result.deduplicatedContinuation).toBe(" continues here.");
    });
  });

  describe("no overlap cases", () => {
    it("should return no overlap when strings are completely different", () => {
      const result = detectOverlap("Hello world", "Goodbye universe");
      expect(result.hasOverlap).toBe(false);
      expect(result.overlapLength).toBe(0);
      expect(result.overlapText).toBe("");
      expect(result.deduplicatedContinuation).toBe("Goodbye universe");
    });

    it("should return no overlap for empty checkpoint", () => {
      const result = detectOverlap("", "Hello world");
      expect(result.hasOverlap).toBe(false);
      expect(result.deduplicatedContinuation).toBe("Hello world");
    });

    it("should return no overlap for empty continuation", () => {
      const result = detectOverlap("Hello world", "");
      expect(result.hasOverlap).toBe(false);
      expect(result.deduplicatedContinuation).toBe("");
    });

    it("should return no overlap when overlap is below minimum", () => {
      const result = detectOverlap("abc", "cd", { minOverlap: 2 });
      expect(result.hasOverlap).toBe(false);
      expect(result.deduplicatedContinuation).toBe("cd");
    });

    it("should handle null/undefined gracefully", () => {
      const result1 = detectOverlap(null as any, "test");
      expect(result1.hasOverlap).toBe(false);
      expect(result1.deduplicatedContinuation).toBe("test");

      const result2 = detectOverlap("test", null as any);
      expect(result2.hasOverlap).toBe(false);
      expect(result2.deduplicatedContinuation).toBe("");
    });
  });

  describe("case sensitivity", () => {
    it("should be case-sensitive by default", () => {
      const result = detectOverlap("Hello World", "world is great");
      expect(result.hasOverlap).toBe(false);
    });

    it("should detect overlap case-insensitively when option is set", () => {
      const result = detectOverlap("Hello World", "world is great", {
        caseSensitive: false,
      });
      expect(result.hasOverlap).toBe(true);
      expect(result.overlapText).toBe("world");
      expect(result.deduplicatedContinuation).toBe(" is great");
    });

    it("should handle mixed case with case-insensitive matching", () => {
      const result = detectOverlap("The QUICK Brown", "brown FOX jumps", {
        caseSensitive: false,
      });
      expect(result.hasOverlap).toBe(true);
      expect(result.overlapText).toBe("brown");
      expect(result.deduplicatedContinuation).toBe(" FOX jumps");
    });
  });

  describe("whitespace normalization", () => {
    it("should not normalize whitespace by default", () => {
      const result = detectOverlap("Hello  world", "world is great");
      // "Hello  world" ends with "world", "world is great" starts with "world"
      // This should still match since the overlap is just "world"
      expect(result.hasOverlap).toBe(true);
    });

    it("should match despite different whitespace when normalization enabled", () => {
      const result = detectOverlap("Hello   world", "world    is great", {
        normalizeWhitespace: true,
      });
      expect(result.hasOverlap).toBe(true);
      expect(result.deduplicatedContinuation).toBe("    is great");
    });

    it("should handle tabs and newlines with normalization", () => {
      const result = detectOverlap("Hello\tworld", "world\nis great", {
        normalizeWhitespace: true,
      });
      expect(result.hasOverlap).toBe(true);
    });
  });

  describe("overlap length limits", () => {
    it("should respect minOverlap option", () => {
      const result = detectOverlap("abcdef", "efgh", { minOverlap: 3 });
      expect(result.hasOverlap).toBe(false);
    });

    it("should respect maxOverlap option", () => {
      const longText = "a".repeat(100);
      const result = detectOverlap(
        longText,
        longText + " more",
        { maxOverlap: 50 },
      );
      // Should only check up to 50 characters
      expect(result.overlapLength).toBeLessThanOrEqual(50);
    });

    it("should find longest overlap within limits", () => {
      const result = detectOverlap(
        "The quick brown fox jumps",
        "fox jumps over the lazy dog",
        { minOverlap: 2, maxOverlap: 100 },
      );
      expect(result.hasOverlap).toBe(true);
      expect(result.overlapText).toBe("fox jumps");
    });
  });

  describe("edge cases", () => {
    it("should handle complete overlap (continuation is subset of checkpoint end)", () => {
      const result = detectOverlap("Hello world test", "test");
      expect(result.hasOverlap).toBe(true);
      expect(result.overlapText).toBe("test");
      expect(result.deduplicatedContinuation).toBe("");
    });

    it("should handle when continuation is entirely the overlap", () => {
      const result = detectOverlap("Hello world", "world");
      expect(result.hasOverlap).toBe(true);
      expect(result.overlapText).toBe("world");
      expect(result.deduplicatedContinuation).toBe("");
    });

    it("should handle very long strings efficiently", () => {
      const longCheckpoint = "x".repeat(10000) + "MARKER";
      const longContinuation = "MARKER" + "y".repeat(10000);

      const start = Date.now();
      const result = detectOverlap(longCheckpoint, longContinuation);
      const duration = Date.now() - start;

      expect(result.hasOverlap).toBe(true);
      expect(result.overlapText).toBe("MARKER");
      expect(duration).toBeLessThan(1000); // Should complete in under 1 second
    });

    it("should handle unicode characters", () => {
      const result = detectOverlap("Hello 世界", "世界 is beautiful");
      expect(result.hasOverlap).toBe(true);
      expect(result.overlapText).toBe("世界");
      expect(result.deduplicatedContinuation).toBe(" is beautiful");
    });

    it("should handle emoji", () => {
      const result = detectOverlap("Hello 👋🌍", "👋🌍 world");
      expect(result.hasOverlap).toBe(true);
      expect(result.overlapText).toBe("👋🌍");
      expect(result.deduplicatedContinuation).toBe(" world");
    });

    it("should handle newlines in overlap", () => {
      const result = detectOverlap(
        "Line 1\nLine 2",
        "Line 2\nLine 3",
      );
      expect(result.hasOverlap).toBe(true);
      expect(result.overlapText).toBe("Line 2");
      expect(result.deduplicatedContinuation).toBe("\nLine 3");
    });
  });

  describe("realistic LLM continuation scenarios", () => {
    it("should handle typical sentence continuation overlap", () => {
      const checkpoint = "The weather today is sunny and warm. I decided to go for a walk in the park";
      const continuation = "in the park and enjoy the beautiful scenery.";

      const result = detectOverlap(checkpoint, continuation);
      expect(result.hasOverlap).toBe(true);
      expect(result.overlapText).toBe("in the park");
      expect(result.deduplicatedContinuation).toBe(" and enjoy the beautiful scenery.");
    });

    it("should handle code continuation overlap", () => {
      const checkpoint = `function hello() {
  console.log("Hello`;
      const continuation = `console.log("Hello, World!");
}`;

      const result = detectOverlap(checkpoint, continuation);
      expect(result.hasOverlap).toBe(true);
      expect(result.overlapText).toBe(`console.log("Hello`);
    });

    it("should handle JSON continuation overlap", () => {
      const checkpoint = `{
  "name": "John",
  "age": 30`;
      const continuation = `"age": 30,
  "city": "NYC"
}`;

      const result = detectOverlap(checkpoint, continuation);
      expect(result.hasOverlap).toBe(true);
      expect(result.overlapText).toBe(`"age": 30`);
    });

    it("should handle markdown continuation overlap", () => {
      const checkpoint = `# Introduction

This is a document about AI. The main topics include`;
      const continuation = `topics include:

1. Machine Learning
2. Deep Learning`;

      const result = detectOverlap(checkpoint, continuation);
      expect(result.hasOverlap).toBe(true);
      expect(result.overlapText).toBe("topics include");
    });
  });
});

describe("deduplicateContinuation", () => {
  it("should return deduplicated string directly", () => {
    const result = deduplicateContinuation("Hello world", "world is great");
    expect(result).toBe(" is great");
  });

  it("should return original continuation when no overlap", () => {
    const result = deduplicateContinuation("Hello", "Goodbye");
    expect(result).toBe("Goodbye");
  });

  it("should pass options through", () => {
    const result = deduplicateContinuation("Hello World", "world test", {
      caseSensitive: false,
    });
    expect(result).toBe(" test");
  });

  it("should return empty string when continuation is entirely overlap", () => {
    const result = deduplicateContinuation("Hello world", "world");
    expect(result).toBe("");
  });
});
