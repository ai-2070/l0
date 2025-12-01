import { describe, it, expect } from "vitest";
import {
  isMeaningfulToken,
  hasMeaningfulContent,
  countMeaningfulTokens,
  extractMeaningfulTokens,
  isPunctuationOnly,
  isAlphanumeric,
  normalizeToken,
  tokensEqual,
  detectRepeatedTokens,
  calculateTokenDensity,
  estimateTokenCount,
  startsWithMeaningfulToken,
  getFirstMeaningfulToken,
  getLastMeaningfulToken,
  endsAbruptly,
  chunkByTokens,
  detectOverlap,
  deduplicateContinuation,
} from "../src/utils/tokens";

describe("Token Utilities", () => {
  describe("isMeaningfulToken", () => {
    it("should return false for empty string", () => {
      expect(isMeaningfulToken("")).toBe(false);
    });

    it("should return false for null/undefined", () => {
      expect(isMeaningfulToken(null as unknown as string)).toBe(false);
      expect(isMeaningfulToken(undefined as unknown as string)).toBe(false);
    });

    it("should return false for whitespace only", () => {
      expect(isMeaningfulToken("   ")).toBe(false);
      expect(isMeaningfulToken("\n\n")).toBe(false);
      expect(isMeaningfulToken("\t\t")).toBe(false);
      expect(isMeaningfulToken("\r\n")).toBe(false);
    });

    it("should return true for meaningful content", () => {
      expect(isMeaningfulToken("hello")).toBe(true);
      expect(isMeaningfulToken("a")).toBe(true);
      expect(isMeaningfulToken("123")).toBe(true);
      expect(isMeaningfulToken("hello world")).toBe(true);
    });
  });

  describe("hasMeaningfulContent", () => {
    it("should return false for empty/null content", () => {
      expect(hasMeaningfulContent("")).toBe(false);
      expect(hasMeaningfulContent(null as unknown as string)).toBe(false);
    });

    it("should return false for whitespace only", () => {
      expect(hasMeaningfulContent("   ")).toBe(false);
      expect(hasMeaningfulContent("\n\t\r")).toBe(false);
    });

    it("should return true for meaningful content", () => {
      expect(hasMeaningfulContent("hello")).toBe(true);
      expect(hasMeaningfulContent("  hello  ")).toBe(true);
    });
  });

  describe("countMeaningfulTokens", () => {
    it("should return 0 for empty content", () => {
      expect(countMeaningfulTokens("")).toBe(0);
      expect(countMeaningfulTokens(null as unknown as string)).toBe(0);
    });

    it("should return 0 for whitespace only", () => {
      expect(countMeaningfulTokens("   ")).toBe(0);
    });

    it("should count words correctly", () => {
      expect(countMeaningfulTokens("hello")).toBe(1);
      expect(countMeaningfulTokens("hello world")).toBe(2);
      expect(countMeaningfulTokens("one two three four")).toBe(4);
    });

    it("should handle multiple spaces", () => {
      expect(countMeaningfulTokens("hello    world")).toBe(2);
    });
  });

  describe("extractMeaningfulTokens", () => {
    it("should return empty array for empty content", () => {
      expect(extractMeaningfulTokens("")).toEqual([]);
      expect(extractMeaningfulTokens(null as unknown as string)).toEqual([]);
    });

    it("should extract tokens correctly", () => {
      expect(extractMeaningfulTokens("hello world")).toEqual([
        "hello",
        "world",
      ]);
      expect(extractMeaningfulTokens("  one  two  ")).toEqual(["one", "two"]);
    });
  });

  describe("isPunctuationOnly", () => {
    it("should return false for empty string", () => {
      expect(isPunctuationOnly("")).toBe(false);
      expect(isPunctuationOnly(null as unknown as string)).toBe(false);
    });

    it("should return true for punctuation only", () => {
      expect(isPunctuationOnly("...")).toBe(true);
      expect(isPunctuationOnly("!!!")).toBe(true);
      expect(isPunctuationOnly("?!")).toBe(true);
      expect(isPunctuationOnly("---")).toBe(true);
    });

    it("should return false for alphanumeric content", () => {
      expect(isPunctuationOnly("hello")).toBe(false);
      expect(isPunctuationOnly("a!")).toBe(false);
      expect(isPunctuationOnly("123")).toBe(false);
    });
  });

  describe("isAlphanumeric", () => {
    it("should return false for empty string", () => {
      expect(isAlphanumeric("")).toBe(false);
      expect(isAlphanumeric(null as unknown as string)).toBe(false);
    });

    it("should return true for alphanumeric content", () => {
      expect(isAlphanumeric("hello")).toBe(true);
      expect(isAlphanumeric("123")).toBe(true);
      expect(isAlphanumeric("a1b2")).toBe(true);
    });

    it("should return false for punctuation only", () => {
      expect(isAlphanumeric("...")).toBe(false);
      expect(isAlphanumeric("!!!")).toBe(false);
    });
  });

  describe("normalizeToken", () => {
    it("should lowercase and trim", () => {
      expect(normalizeToken("Hello")).toBe("hello");
      expect(normalizeToken("  WORLD  ")).toBe("world");
      expect(normalizeToken("TeSt")).toBe("test");
    });
  });

  describe("tokensEqual", () => {
    it("should compare normalized tokens", () => {
      expect(tokensEqual("hello", "Hello")).toBe(true);
      expect(tokensEqual("  world  ", "WORLD")).toBe(true);
      expect(tokensEqual("foo", "bar")).toBe(false);
    });
  });

  describe("detectRepeatedTokens", () => {
    it("should return empty for empty content", () => {
      expect(detectRepeatedTokens("")).toEqual([]);
      expect(detectRepeatedTokens(null as unknown as string)).toEqual([]);
    });

    it("should detect repeated tokens", () => {
      const result = detectRepeatedTokens("hello hello hello world", 3);
      expect(result).toContain("hello");
      expect(result).not.toContain("world");
    });

    it("should use default threshold of 3", () => {
      const result = detectRepeatedTokens("a a a b b");
      expect(result).toContain("a");
      expect(result).not.toContain("b");
    });

    it("should handle case-insensitive matching", () => {
      const result = detectRepeatedTokens("Hello HELLO hello", 3);
      expect(result.length).toBe(1);
    });
  });

  describe("calculateTokenDensity", () => {
    it("should return 0 for empty content", () => {
      expect(calculateTokenDensity("")).toBe(0);
      expect(calculateTokenDensity(null as unknown as string)).toBe(0);
    });

    it("should calculate density correctly", () => {
      const density = calculateTokenDensity("hello world");
      expect(density).toBeGreaterThan(0);
      expect(density).toBeLessThan(1);
    });
  });

  describe("estimateTokenCount", () => {
    it("should return 0 for empty content", () => {
      expect(estimateTokenCount("")).toBe(0);
      expect(estimateTokenCount(null as unknown as string)).toBe(0);
    });

    it("should estimate token count", () => {
      const estimate = estimateTokenCount("hello world how are you");
      expect(estimate).toBeGreaterThan(0);
    });
  });

  describe("startsWithMeaningfulToken", () => {
    it("should return false for empty content", () => {
      expect(startsWithMeaningfulToken("")).toBe(false);
      expect(startsWithMeaningfulToken(null as unknown as string)).toBe(false);
    });

    it("should return true when starts with meaningful token", () => {
      expect(startsWithMeaningfulToken("hello")).toBe(true);
      expect(startsWithMeaningfulToken("  hello")).toBe(true);
    });

    it("should return false for whitespace only", () => {
      expect(startsWithMeaningfulToken("   ")).toBe(false);
    });
  });

  describe("getFirstMeaningfulToken", () => {
    it("should return null for empty content", () => {
      expect(getFirstMeaningfulToken("")).toBeNull();
      expect(getFirstMeaningfulToken("   ")).toBeNull();
    });

    it("should return first token", () => {
      expect(getFirstMeaningfulToken("hello world")).toBe("hello");
      expect(getFirstMeaningfulToken("  first second  ")).toBe("first");
    });
  });

  describe("getLastMeaningfulToken", () => {
    it("should return null for empty content", () => {
      expect(getLastMeaningfulToken("")).toBeNull();
      expect(getLastMeaningfulToken("   ")).toBeNull();
    });

    it("should return last token", () => {
      expect(getLastMeaningfulToken("hello world")).toBe("world");
      expect(getLastMeaningfulToken("  first second  ")).toBe("second");
    });
  });

  describe("endsAbruptly", () => {
    it("should return false for empty content", () => {
      expect(endsAbruptly("")).toBe(false);
      expect(endsAbruptly(null as unknown as string)).toBe(false);
    });

    it("should return false for sentences ending with punctuation", () => {
      expect(endsAbruptly("Hello world.")).toBe(false);
      expect(endsAbruptly("What?")).toBe(false);
      expect(endsAbruptly("Wow!")).toBe(false);
      expect(endsAbruptly("Item;")).toBe(false);
      expect(endsAbruptly("Note:")).toBe(false);
    });

    it("should return false for content ending with closure", () => {
      expect(endsAbruptly("(example)")).toBe(false);
      expect(endsAbruptly("[item]")).toBe(false);
      expect(endsAbruptly("{object}")).toBe(false);
    });

    it("should return true for abrupt endings", () => {
      expect(endsAbruptly("Hello world")).toBe(true);
      expect(endsAbruptly("The quick brown")).toBe(true);
    });
  });

  describe("chunkByTokens", () => {
    it("should return empty for empty content", () => {
      expect(chunkByTokens("", 5)).toEqual([]);
      expect(chunkByTokens(null as unknown as string, 5)).toEqual([]);
    });

    it("should chunk content by token count", () => {
      const chunks = chunkByTokens("one two three four five six", 2);
      expect(chunks).toHaveLength(3);
      expect(chunks[0]).toBe("one two");
      expect(chunks[1]).toBe("three four");
      expect(chunks[2]).toBe("five six");
    });

    it("should handle uneven chunks", () => {
      const chunks = chunkByTokens("one two three four five", 2);
      expect(chunks).toHaveLength(3);
      expect(chunks[2]).toBe("five");
    });
  });

  describe("detectOverlap", () => {
    it("should return no overlap for empty strings", () => {
      const result = detectOverlap("", "continuation");
      expect(result.hasOverlap).toBe(false);
      expect(result.deduplicatedContinuation).toBe("continuation");
    });

    it("should return no overlap for null/undefined", () => {
      const result = detectOverlap(null as unknown as string, "test");
      expect(result.hasOverlap).toBe(false);
    });

    it("should detect simple overlap", () => {
      const result = detectOverlap("Hello world", "world is great");
      expect(result.hasOverlap).toBe(true);
      expect(result.overlapLength).toBe(5);
      expect(result.overlapText).toBe("world");
      expect(result.deduplicatedContinuation).toBe(" is great");
    });

    it("should detect longer overlaps", () => {
      const result = detectOverlap(
        "The quick brown fox",
        "brown fox jumps over",
      );
      expect(result.hasOverlap).toBe(true);
      expect(result.overlapText).toBe("brown fox");
    });

    it("should return no overlap when none exists", () => {
      const result = detectOverlap("Hello", "World");
      expect(result.hasOverlap).toBe(false);
      expect(result.deduplicatedContinuation).toBe("World");
    });

    it("should respect minOverlap option", () => {
      const result = detectOverlap("ab", "bc", { minOverlap: 5 });
      expect(result.hasOverlap).toBe(false);
    });

    it("should respect maxOverlap option", () => {
      // With maxOverlap=5, only overlaps up to 5 chars are checked
      // "world" is 5 chars but there's a space before it in checkpoint
      // The algorithm looks for suffix of checkpoint matching prefix of continuation
      const result = detectOverlap("abc test", "test more", { maxOverlap: 5 });
      expect(result.hasOverlap).toBe(true);
      expect(result.overlapText).toBe("test");
      expect(result.overlapLength).toBeLessThanOrEqual(5);
    });

    it("should support case-insensitive matching", () => {
      const result = detectOverlap("Hello WORLD", "world is great", {
        caseSensitive: false,
      });
      expect(result.hasOverlap).toBe(true);
      expect(result.overlapText).toBe("world");
    });

    it("should support whitespace normalization", () => {
      const result = detectOverlap("Hello  world", "world   is great", {
        normalizeWhitespace: true,
      });
      expect(result.hasOverlap).toBe(true);
    });

    it("should handle complete overlap", () => {
      const result = detectOverlap("test", "test");
      expect(result.hasOverlap).toBe(true);
      expect(result.overlapLength).toBe(4);
      expect(result.deduplicatedContinuation).toBe("");
    });
  });

  describe("deduplicateContinuation", () => {
    it("should remove overlapping prefix", () => {
      const result = deduplicateContinuation("Hello world", "world is great");
      expect(result).toBe(" is great");
    });

    it("should return unchanged if no overlap", () => {
      const result = deduplicateContinuation("Hello", "World");
      expect(result).toBe("World");
    });

    it("should pass options through", () => {
      const result = deduplicateContinuation("Hello WORLD", "world is great", {
        caseSensitive: false,
      });
      expect(result).toBe(" is great");
    });
  });
});
