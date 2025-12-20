// Comprehensive zero token detection tests
import { describe, it, expect, beforeEach } from "vitest";
import {
  detectZeroToken,
  detectZeroTokenBeforeFirstMeaningful,
  detectInstantFinish,
  analyzeZeroToken,
  isOnlyWhitespace,
  isOnlyPunctuation,
  detectFirstChunkStall,
  getZeroTokenErrorMessage,
} from "../src/runtime/zeroToken";

describe("Zero Token Detection", () => {
  describe("detectZeroToken", () => {
    it("should detect null content", () => {
      expect(detectZeroToken(null as any)).toBe(true);
    });

    it("should detect undefined content", () => {
      expect(detectZeroToken(undefined as any)).toBe(true);
    });

    it("should detect empty string", () => {
      expect(detectZeroToken("")).toBe(true);
    });

    it("should detect whitespace-only content", () => {
      expect(detectZeroToken("   ")).toBe(true);
      expect(detectZeroToken("\n\n\n")).toBe(true);
      expect(detectZeroToken("\t\t\t")).toBe(true);
      expect(detectZeroToken("  \n\t  \r\n  ")).toBe(true);
    });

    it("should allow short but meaningful content", () => {
      // Short alphanumeric content is valid (e.g., "4", "12", "Y", "No")
      expect(detectZeroToken("a")).toBe(false);
      expect(detectZeroToken("ab")).toBe(false);
      expect(detectZeroToken("  x  ")).toBe(false);
      expect(detectZeroToken("4")).toBe(false);
      expect(detectZeroToken("12")).toBe(false);
      expect(detectZeroToken("Y")).toBe(false);
      expect(detectZeroToken("No")).toBe(false);
    });

    it("should detect punctuation-only content", () => {
      expect(detectZeroToken("...")).toBe(true);
      expect(detectZeroToken("!!!")).toBe(true);
      expect(detectZeroToken("???")).toBe(true);
      expect(detectZeroToken(".,;:")).toBe(true);
    });

    it("should detect repeated single character", () => {
      expect(detectZeroToken("aaa")).toBe(true);
      expect(detectZeroToken("!!!")).toBe(true);
      expect(detectZeroToken("   ")).toBe(true);
      expect(detectZeroToken("---")).toBe(true);
    });

    it("should accept valid content", () => {
      expect(detectZeroToken("Hello")).toBe(false);
      expect(detectZeroToken("Valid content here")).toBe(false);
      expect(detectZeroToken("abc")).toBe(false);
      expect(detectZeroToken("Response: OK")).toBe(false);
    });

    it("should accept content with mixed characters", () => {
      expect(detectZeroToken("Hi!")).toBe(false);
      expect(detectZeroToken("OK.")).toBe(false);
      expect(detectZeroToken("Yes?")).toBe(false);
    });

    it("should handle content with leading/trailing whitespace", () => {
      expect(detectZeroToken("  Hello  ")).toBe(false);
      expect(detectZeroToken("\nValid\n")).toBe(false);
    });

    it("should detect special character noise", () => {
      expect(detectZeroToken("###")).toBe(true);
      expect(detectZeroToken("***")).toBe(true);
      expect(detectZeroToken("@@@")).toBe(true);
    });
  });

  describe("detectZeroTokenBeforeFirstMeaningful", () => {
    it("should detect zero tokens received", () => {
      expect(detectZeroTokenBeforeFirstMeaningful("", 0)).toBe(true);
      expect(detectZeroTokenBeforeFirstMeaningful("Some content", 0)).toBe(
        true,
      );
    });

    it("should detect tokens without meaningful content", () => {
      expect(detectZeroTokenBeforeFirstMeaningful("   ", 5)).toBe(true);
      expect(detectZeroTokenBeforeFirstMeaningful("\n\n\n", 3)).toBe(true);
      expect(detectZeroTokenBeforeFirstMeaningful("\t\t", 2)).toBe(true);
    });

    it("should detect many tokens with minimal content (encoding issue)", () => {
      expect(detectZeroTokenBeforeFirstMeaningful("a", 15)).toBe(true);
      expect(detectZeroTokenBeforeFirstMeaningful("abc", 20)).toBe(true);
      expect(detectZeroTokenBeforeFirstMeaningful("  x  ", 12)).toBe(true);
    });

    it("should accept valid token-to-content ratio", () => {
      expect(detectZeroTokenBeforeFirstMeaningful("Hello world", 5)).toBe(
        false,
      );
      expect(
        detectZeroTokenBeforeFirstMeaningful("Valid content here", 10),
      ).toBe(false);
      expect(detectZeroTokenBeforeFirstMeaningful("OK", 3)).toBe(false);
    });

    it("should handle edge case of exactly 10 tokens", () => {
      expect(detectZeroTokenBeforeFirstMeaningful("test", 10)).toBe(false);
      expect(detectZeroTokenBeforeFirstMeaningful("Hello!", 10)).toBe(false);
    });

    it("should accept reasonable content with many tokens", () => {
      expect(
        detectZeroTokenBeforeFirstMeaningful("This is reasonable", 15),
      ).toBe(false);
      expect(
        detectZeroTokenBeforeFirstMeaningful("Long enough content", 20),
      ).toBe(false);
    });
  });

  describe("detectInstantFinish", () => {
    it("should detect instant finish with few tokens", () => {
      const start = Date.now();
      const end = start + 50; // 50ms
      expect(detectInstantFinish(start, end, 2)).toBe(true);
      expect(detectInstantFinish(start, end, 4)).toBe(true);
    });

    it("should detect extremely fast completion", () => {
      const start = Date.now();
      const end = start + 30; // 30ms
      expect(detectInstantFinish(start, end, 0)).toBe(true);
      expect(detectInstantFinish(start, end, 10)).toBe(true);
      expect(detectInstantFinish(start, end, 100)).toBe(true);
    });

    it("should accept normal completion time with few tokens", () => {
      const start = Date.now();
      const end = start + 200; // 200ms
      expect(detectInstantFinish(start, end, 3)).toBe(false);
      expect(detectInstantFinish(start, end, 5)).toBe(false);
    });

    it("should accept fast completion with many tokens", () => {
      const start = Date.now();
      const end = start + 80; // 80ms
      expect(detectInstantFinish(start, end, 10)).toBe(false);
      expect(detectInstantFinish(start, end, 20)).toBe(false);
    });

    it("should handle exact boundary cases", () => {
      const start = Date.now();

      // Exactly 50ms with < 5 tokens
      const end50 = start + 50;
      expect(detectInstantFinish(start, end50, 4)).toBe(true);

      // Exactly 100ms with < 5 tokens
      const end100 = start + 100;
      expect(detectInstantFinish(start, end100, 4)).toBe(false);
    });

    it("should accept slow completion", () => {
      const start = Date.now();
      const end = start + 5000; // 5 seconds
      expect(detectInstantFinish(start, end, 1)).toBe(false);
      expect(detectInstantFinish(start, end, 100)).toBe(false);
    });
  });

  describe("analyzeZeroToken", () => {
    it("should analyze network failure (no tokens)", () => {
      const result = analyzeZeroToken("", 0);
      expect(result.isZeroToken).toBe(true);
      expect(result.category).toBe("network");
      expect(result.reason).toContain("network or transport failure");
    });

    it("should analyze encoding issue (tokens but no content)", () => {
      const result = analyzeZeroToken("   ", 5);
      expect(result.isZeroToken).toBe(true);
      expect(result.category).toBe("encoding");
      expect(result.reason).toContain("encoding issue");
    });

    it("should analyze transport issue (whitespace/noise)", () => {
      const result = analyzeZeroToken("\n\n", 3);
      expect(result.isZeroToken).toBe(true);
      expect(result.category).toBe("encoding");
      expect(result.reason).toContain("encoding");
    });

    it("should analyze instant finish as transport failure", () => {
      const start = Date.now();
      const end = start + 30;
      const result = analyzeZeroToken("abc", 3, start, end);
      expect(result.isZeroToken).toBe(true);
      expect(result.category).toBe("transport");
      expect(result.reason).toContain("suspiciously fast");
    });

    it("should return valid for good content", () => {
      const result = analyzeZeroToken("Valid response here", 10);
      expect(result.isZeroToken).toBe(false);
      expect(result.category).toBe("none");
      expect(result.reason).toBe("Valid output detected");
    });

    it("should work without timing information", () => {
      const result = analyzeZeroToken("", 0);
      expect(result.isZeroToken).toBe(true);
      expect(result.category).toBe("network");
    });

    it("should handle valid content with timing", () => {
      const start = Date.now();
      const end = start + 1000; // 1 second
      const result = analyzeZeroToken("Good response", 15, start, end);
      expect(result.isZeroToken).toBe(false);
      expect(result.category).toBe("none");
    });

    it("should analyze repeated characters", () => {
      const result = analyzeZeroToken("aaa", 1);
      expect(result.isZeroToken).toBe(true);
      expect(result.category).toBe("transport");
    });

    it("should analyze punctuation only", () => {
      const result = analyzeZeroToken("...", 1);
      expect(result.isZeroToken).toBe(true);
      expect(result.category).toBe("transport");
    });
  });

  describe("isOnlyWhitespace", () => {
    it("should detect empty string", () => {
      expect(isOnlyWhitespace("")).toBe(true);
    });

    it("should detect null/undefined", () => {
      expect(isOnlyWhitespace(null as any)).toBe(true);
      expect(isOnlyWhitespace(undefined as any)).toBe(true);
    });

    it("should detect spaces", () => {
      expect(isOnlyWhitespace("   ")).toBe(true);
    });

    it("should detect newlines", () => {
      expect(isOnlyWhitespace("\n\n\n")).toBe(true);
      expect(isOnlyWhitespace("\r\n\r\n")).toBe(true);
    });

    it("should detect tabs", () => {
      expect(isOnlyWhitespace("\t\t\t")).toBe(true);
    });

    it("should detect mixed whitespace", () => {
      expect(isOnlyWhitespace("  \n\t  \r\n  ")).toBe(true);
    });

    it("should reject content with characters", () => {
      expect(isOnlyWhitespace("a")).toBe(false);
      expect(isOnlyWhitespace("  hello  ")).toBe(false);
      expect(isOnlyWhitespace("\ntext\n")).toBe(false);
    });

    it("should reject punctuation", () => {
      expect(isOnlyWhitespace(".")).toBe(false);
      expect(isOnlyWhitespace("...")).toBe(false);
    });
  });

  describe("isOnlyPunctuation", () => {
    it("should detect single punctuation", () => {
      expect(isOnlyPunctuation(".")).toBe(true);
      expect(isOnlyPunctuation("!")).toBe(true);
      expect(isOnlyPunctuation("?")).toBe(true);
    });

    it("should detect multiple punctuation", () => {
      expect(isOnlyPunctuation("...")).toBe(true);
      expect(isOnlyPunctuation("!!!")).toBe(true);
      expect(isOnlyPunctuation("???")).toBe(true);
      expect(isOnlyPunctuation(".,;:")).toBe(true);
    });

    it("should detect punctuation with whitespace", () => {
      expect(isOnlyPunctuation("  ...  ")).toBe(true);
      expect(isOnlyPunctuation("\n!!!\n")).toBe(true);
    });

    it("should reject empty string", () => {
      expect(isOnlyPunctuation("")).toBe(false);
    });

    it("should reject null/undefined", () => {
      expect(isOnlyPunctuation(null as any)).toBe(false);
      expect(isOnlyPunctuation(undefined as any)).toBe(false);
    });

    it("should reject whitespace only", () => {
      expect(isOnlyPunctuation("   ")).toBe(false);
    });

    it("should reject alphanumeric content", () => {
      expect(isOnlyPunctuation("a")).toBe(false);
      expect(isOnlyPunctuation("hello")).toBe(false);
      expect(isOnlyPunctuation("test123")).toBe(false);
    });

    it("should reject mixed content", () => {
      expect(isOnlyPunctuation("Hi!")).toBe(false);
      expect(isOnlyPunctuation("What?")).toBe(false);
      expect(isOnlyPunctuation("OK.")).toBe(false);
    });

    it("should detect special character combinations", () => {
      expect(isOnlyPunctuation("@#$%")).toBe(true);
      expect(isOnlyPunctuation("***")).toBe(true);
      expect(isOnlyPunctuation("---")).toBe(true);
    });
  });

  describe("detectFirstChunkStall", () => {
    it("should detect stall with few tokens and timeout", () => {
      const lastToken = Date.now() - 6000; // 6 seconds ago
      const now = Date.now();
      expect(detectFirstChunkStall("ab", 2, lastToken, now, 5000)).toBe(true);
    });

    it("should detect stall with minimal content", () => {
      const lastToken = Date.now() - 10000; // 10 seconds ago
      const now = Date.now();
      expect(detectFirstChunkStall("test", 1, lastToken, now, 5000)).toBe(true);
    });

    it("should not detect stall with sufficient content", () => {
      const lastToken = Date.now() - 6000;
      const now = Date.now();
      expect(
        detectFirstChunkStall(
          "This is enough content",
          2,
          lastToken,
          now,
          5000,
        ),
      ).toBe(false);
    });

    it("should not detect stall within timeout window", () => {
      const lastToken = Date.now() - 3000; // 3 seconds ago
      const now = Date.now();
      expect(detectFirstChunkStall("ab", 2, lastToken, now, 5000)).toBe(false);
    });

    it("should not detect stall with many tokens", () => {
      const lastToken = Date.now() - 10000;
      const now = Date.now();
      expect(detectFirstChunkStall("test", 10, lastToken, now, 5000)).toBe(
        false,
      );
    });

    it("should handle custom timeout", () => {
      const lastToken = Date.now() - 15000; // 15 seconds ago
      const now = Date.now();
      expect(detectFirstChunkStall("ab", 2, lastToken, now, 10000)).toBe(true);
    });

    it("should handle exactly 3 tokens", () => {
      const lastToken = Date.now() - 6000;
      const now = Date.now();
      expect(detectFirstChunkStall("abc", 3, lastToken, now, 5000)).toBe(false);
    });

    it("should require both conditions (tokens and timeout)", () => {
      const lastToken = Date.now() - 6000;
      const now = Date.now();

      // Many tokens but timeout - not stalled
      expect(detectFirstChunkStall("ab", 10, lastToken, now, 5000)).toBe(false);

      // Few tokens but no timeout - not stalled
      expect(detectFirstChunkStall("ab", 2, now - 1000, now, 5000)).toBe(false);
    });

    it("should handle zero tokens", () => {
      const lastToken = Date.now() - 6000;
      const now = Date.now();
      expect(detectFirstChunkStall("", 0, lastToken, now, 5000)).toBe(false);
    });
  });

  describe("getZeroTokenErrorMessage", () => {
    it("should return message for network failure", () => {
      const msg = getZeroTokenErrorMessage("", 0);
      expect(msg).toContain("Zero-token output detected");
      expect(msg).toContain("network or transport failure");
      expect(msg).toContain("tokens: 0");
    });

    it("should return message for encoding issue", () => {
      const msg = getZeroTokenErrorMessage("   ", 5);
      expect(msg).toContain("Zero-token output detected");
      expect(msg).toContain("encoding issue");
      expect(msg).toContain("tokens: 5");
    });

    it("should return message for whitespace/noise", () => {
      const msg = getZeroTokenErrorMessage("\n\n", 2);
      expect(msg).toContain("Zero-token output detected");
      // May be categorized as encoding or transport
      expect(msg).toBeDefined();
    });

    it("should return empty string for valid content", () => {
      const msg = getZeroTokenErrorMessage("Valid response", 10);
      expect(msg).toBe("");
    });

    it("should include content length in message", () => {
      const content = "   ";
      const msg = getZeroTokenErrorMessage(content, 3);
      expect(msg).toContain(`chars: ${content.length}`);
    });

    it("should allow short but meaningful content", () => {
      // Short alphanumeric content like "ab", "12", "Y" is valid
      const msg = getZeroTokenErrorMessage("ab", 1);
      expect(msg).toBe("");
    });

    it("should handle punctuation only", () => {
      const msg = getZeroTokenErrorMessage("...", 1);
      expect(msg).toContain("Zero-token output detected");
    });
  });

  describe("Edge Cases", () => {
    it("should handle unicode characters", () => {
      expect(detectZeroToken("😀")).toBe(true); // single emoji
      expect(detectZeroToken("😀😀😀")).toBe(true); // repeated emoji
      expect(detectZeroToken("Hello 😀")).toBe(false); // emoji with text
    });

    it("should handle zero-width characters", () => {
      expect(detectZeroToken("\u200B")).toBe(true); // zero-width space
      expect(detectZeroToken("\uFEFF")).toBe(true); // zero-width no-break space
    });

    it("should handle very long whitespace", () => {
      const longWhitespace = " ".repeat(1000);
      expect(detectZeroToken(longWhitespace)).toBe(true);
    });

    it("should handle very long repeated characters", () => {
      const repeated = "a".repeat(1000);
      expect(detectZeroToken(repeated)).toBe(true);
    });

    it("should handle mixed language content", () => {
      // Multi-byte characters with variety pass detection
      expect(detectZeroToken("Hello 世界")).toBe(false);
      expect(detectZeroToken("привет world")).toBe(false);
      expect(detectZeroToken("Test مرحبا")).toBe(false);
      // Mixed alphanumeric ensures no repeated pattern
      expect(detectZeroToken("abc123")).toBe(false);
    });

    it("should handle special unicode punctuation", () => {
      expect(detectZeroToken("…")).toBe(true); // ellipsis
      expect(detectZeroToken("—")).toBe(true); // em dash
      expect(detectZeroToken("'")).toBe(true); // smart quote
    });

    it("should handle newline variations", () => {
      expect(detectZeroToken("\r\n")).toBe(true);
      expect(detectZeroToken("\n\r")).toBe(true);
      expect(detectZeroToken("\r")).toBe(true);
    });
  });

  describe("Integration Scenarios", () => {
    it("should handle network timeout scenario", () => {
      const content = "";
      const tokenCount = 0;
      const start = Date.now();
      const end = start + 100;

      expect(detectZeroToken(content)).toBe(true);
      expect(detectZeroTokenBeforeFirstMeaningful(content, tokenCount)).toBe(
        true,
      );

      const analysis = analyzeZeroToken(content, tokenCount, start, end);
      expect(analysis.isZeroToken).toBe(true);
      expect(analysis.category).toBe("network");
    });

    it("should handle encoding corruption scenario", () => {
      const content = "   "; // whitespace
      const tokenCount = 10;

      expect(detectZeroToken(content)).toBe(true);
      expect(detectZeroTokenBeforeFirstMeaningful(content, tokenCount)).toBe(
        true,
      );

      const analysis = analyzeZeroToken(content, tokenCount);
      expect(analysis.isZeroToken).toBe(true);
      expect(analysis.category).toBe("encoding");
    });

    it("should handle instant failure scenario", () => {
      const content = "ab";
      const tokenCount = 1;
      const start = Date.now();
      const end = start + 20; // Very fast

      const analysis = analyzeZeroToken(content, tokenCount, start, end);
      expect(analysis.isZeroToken).toBe(true);
      expect(analysis.category).toBe("transport");
    });

    it("should handle successful stream", () => {
      const content = "This is a valid, meaningful response from the model.";
      const tokenCount = 15;
      const start = Date.now();
      const end = start + 2000;

      expect(detectZeroToken(content)).toBe(false);
      expect(detectZeroTokenBeforeFirstMeaningful(content, tokenCount)).toBe(
        false,
      );
      expect(detectInstantFinish(start, end, tokenCount)).toBe(false);

      const analysis = analyzeZeroToken(content, tokenCount, start, end);
      expect(analysis.isZeroToken).toBe(false);
      expect(analysis.category).toBe("none");
    });

    it("should handle stalled stream scenario", () => {
      // Short content like "He" is valid but stall detection still works
      const content = "He";
      const tokenCount = 1;
      const lastToken = Date.now() - 10000;
      const now = Date.now();

      // "He" is valid short content, not zero-token
      expect(detectZeroToken(content)).toBe(false);
      // But the stall detector still catches it based on timing/token count
      expect(detectFirstChunkStall(content, tokenCount, lastToken, now)).toBe(
        true,
      );
    });
  });

  describe("Performance", () => {
    it("should handle very large content efficiently", () => {
      const largeContent = "word ".repeat(100000); // 100k words
      const start = Date.now();
      const result = detectZeroToken(largeContent);
      const duration = Date.now() - start;

      expect(result).toBe(false);
      expect(duration).toBeLessThan(100); // Should be fast
    });

    it("should handle many calls efficiently", () => {
      const start = Date.now();

      for (let i = 0; i < 1000; i++) {
        detectZeroToken(`Test content ${i}`);
      }

      const duration = Date.now() - start;
      expect(duration).toBeLessThan(100);
    });
  });
});
