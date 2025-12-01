import { describe, it, expect } from "vitest";
import {
  normalizeNewlines,
  normalizeWhitespace,
  normalizeIndentation,
  dedent,
  indent,
  trimText,
  normalizeText,
  ensureTrailingNewline,
  removeTrailingWhitespace,
  normalizeForModel,
  isWhitespaceOnly,
  countLines,
  getLine,
  replaceLine,
} from "../src/utils/normalize";

describe("Normalize Utilities", () => {
  describe("normalizeNewlines", () => {
    it("should return empty/null input unchanged", () => {
      expect(normalizeNewlines("")).toBe("");
      expect(normalizeNewlines(null as any)).toBe(null);
    });

    it("should convert Windows newlines to Unix", () => {
      expect(normalizeNewlines("line1\r\nline2")).toBe("line1\nline2");
    });

    it("should convert old Mac newlines to Unix", () => {
      expect(normalizeNewlines("line1\rline2")).toBe("line1\nline2");
    });

    it("should leave Unix newlines unchanged", () => {
      expect(normalizeNewlines("line1\nline2")).toBe("line1\nline2");
    });

    it("should handle mixed newlines", () => {
      expect(normalizeNewlines("a\r\nb\rc\nd")).toBe("a\nb\nc\nd");
    });
  });

  describe("normalizeWhitespace", () => {
    it("should return empty/null input unchanged", () => {
      expect(normalizeWhitespace("")).toBe("");
      expect(normalizeWhitespace(null as any)).toBe(null);
    });

    it("should collapse multiple spaces when enabled", () => {
      expect(normalizeWhitespace("hello   world", { collapseSpaces: true })).toBe(
        "hello world"
      );
    });

    it("should not collapse spaces by default", () => {
      expect(normalizeWhitespace("hello   world")).toBe("hello   world");
    });

    it("should trim lines when enabled", () => {
      expect(normalizeWhitespace("  hello  \n  world  ", { trimLines: true })).toBe(
        "hello\nworld"
      );
    });

    it("should remove empty lines when enabled", () => {
      expect(
        normalizeWhitespace("line1\n\n\nline2", { removeEmptyLines: true })
      ).toBe("line1\nline2");
    });

    it("should combine options", () => {
      const result = normalizeWhitespace("  hello   world  \n\n  foo  ", {
        collapseSpaces: true,
        trimLines: true,
        removeEmptyLines: true,
      });
      expect(result).toBe("hello world\nfoo");
    });
  });

  describe("normalizeIndentation", () => {
    it("should return empty/null input unchanged", () => {
      expect(normalizeIndentation("")).toBe("");
      expect(normalizeIndentation(null as any)).toBe(null);
    });

    it("should convert tabs to spaces by default", () => {
      expect(normalizeIndentation("\thello")).toBe("  hello");
    });

    it("should respect spacesPerTab option", () => {
      expect(normalizeIndentation("\thello", "spaces", 4)).toBe("    hello");
    });

    it("should convert spaces to tabs", () => {
      expect(normalizeIndentation("    hello", "tabs", 2)).toBe("\t\thello");
    });

    it("should handle partial indentation when converting to tabs", () => {
      expect(normalizeIndentation("   hello", "tabs", 2)).toBe("\t hello");
    });

    it("should preserve content after indentation", () => {
      expect(normalizeIndentation("\tint x = 1;")).toBe("  int x = 1;");
    });
  });

  describe("dedent", () => {
    it("should return empty/null input unchanged", () => {
      expect(dedent("")).toBe("");
      expect(dedent(null as any)).toBe(null);
    });

    it("should remove common indentation", () => {
      const input = "    line1\n    line2\n    line3";
      expect(dedent(input)).toBe("line1\nline2\nline3");
    });

    it("should preserve relative indentation", () => {
      const input = "  line1\n    line2\n  line3";
      expect(dedent(input)).toBe("line1\n  line2\nline3");
    });

    it("should skip empty lines when calculating indent", () => {
      const input = "  line1\n\n  line2";
      expect(dedent(input)).toBe("line1\n\nline2");
    });

    it("should return unchanged if no indentation", () => {
      const input = "line1\nline2";
      expect(dedent(input)).toBe("line1\nline2");
    });
  });

  describe("indent", () => {
    it("should return empty/null input unchanged", () => {
      expect(indent("")).toBe("");
      expect(indent(null as any)).toBe(null);
    });

    it("should add default indentation (2 spaces)", () => {
      expect(indent("hello\nworld")).toBe("  hello\n  world");
    });

    it("should add custom space indentation", () => {
      expect(indent("hello", 4)).toBe("    hello");
    });

    it("should add string indentation", () => {
      expect(indent("hello", "\t")).toBe("\thello");
    });

    it("should not indent empty lines", () => {
      expect(indent("hello\n\nworld")).toBe("  hello\n\n  world");
    });
  });

  describe("trimText", () => {
    it("should return empty/null input unchanged", () => {
      expect(trimText("")).toBe("");
      expect(trimText(null as any)).toBe(null);
    });

    it("should remove leading empty lines", () => {
      expect(trimText("\n\nhello")).toBe("hello");
    });

    it("should remove trailing empty lines", () => {
      expect(trimText("hello\n\n")).toBe("hello");
    });

    it("should trim leading/trailing whitespace", () => {
      expect(trimText("  hello  ")).toBe("hello");
    });

    it("should preserve internal structure", () => {
      expect(trimText("\n\nhello\n\nworld\n\n")).toBe("hello\n\nworld");
    });
  });

  describe("normalizeText", () => {
    it("should return empty/null input unchanged", () => {
      expect(normalizeText("")).toBe("");
      expect(normalizeText(null as any)).toBe(null);
    });

    it("should normalize newlines by default", () => {
      expect(normalizeText("a\r\nb")).toBe("a\nb");
    });

    it("should normalize whitespace when enabled", () => {
      expect(normalizeText("hello   world", { whitespace: true })).toBe(
        "hello world"
      );
    });

    it("should normalize indentation when enabled", () => {
      expect(normalizeText("\thello", { indentation: "spaces" })).toBe("  hello");
    });

    it("should dedent when enabled", () => {
      expect(normalizeText("  hello\n  world", { dedent: true })).toBe(
        "hello\nworld"
      );
    });

    it("should trim when enabled", () => {
      expect(normalizeText("\n\nhello\n\n", { trim: true })).toBe("hello");
    });

    it("should combine all options", () => {
      const input = "\r\n  \thello   world  \r\n  \tline2  \r\n";
      const result = normalizeText(input, {
        newlines: true,
        whitespace: true,
        indentation: "spaces",
        dedent: true,
        trim: true,
      });
      expect(result).not.toContain("\r");
      expect(result).not.toContain("\t");
    });
  });

  describe("ensureTrailingNewline", () => {
    it("should return empty/null input unchanged", () => {
      expect(ensureTrailingNewline("")).toBe("");
      expect(ensureTrailingNewline(null as any)).toBe(null);
    });

    it("should add newline if missing", () => {
      expect(ensureTrailingNewline("hello")).toBe("hello\n");
    });

    it("should keep single trailing newline", () => {
      expect(ensureTrailingNewline("hello\n")).toBe("hello\n");
    });

    it("should reduce multiple trailing newlines to one", () => {
      expect(ensureTrailingNewline("hello\n\n\n")).toBe("hello\n");
    });
  });

  describe("removeTrailingWhitespace", () => {
    it("should return empty/null input unchanged", () => {
      expect(removeTrailingWhitespace("")).toBe("");
      expect(removeTrailingWhitespace(null as any)).toBe(null);
    });

    it("should remove trailing spaces from lines", () => {
      expect(removeTrailingWhitespace("hello   \nworld   ")).toBe("hello\nworld");
    });

    it("should remove trailing tabs", () => {
      expect(removeTrailingWhitespace("hello\t\t")).toBe("hello");
    });

    it("should preserve internal whitespace", () => {
      expect(removeTrailingWhitespace("hello   world   ")).toBe("hello   world");
    });
  });

  describe("normalizeForModel", () => {
    it("should return empty/null input unchanged", () => {
      expect(normalizeForModel("")).toBe("");
      expect(normalizeForModel(null as any)).toBe(null);
    });

    it("should normalize newlines, whitespace, and trim", () => {
      const input = "\r\n  hello   world  \r\n";
      const result = normalizeForModel(input);
      expect(result).not.toContain("\r");
      expect(result).toBe("hello world");
    });
  });

  describe("isWhitespaceOnly", () => {
    it("should return true for empty string", () => {
      expect(isWhitespaceOnly("")).toBe(true);
    });

    it("should return true for null/undefined", () => {
      expect(isWhitespaceOnly(null as any)).toBe(true);
      expect(isWhitespaceOnly(undefined as any)).toBe(true);
    });

    it("should return true for spaces", () => {
      expect(isWhitespaceOnly("   ")).toBe(true);
    });

    it("should return true for tabs and newlines", () => {
      expect(isWhitespaceOnly("\t\n\r")).toBe(true);
    });

    it("should return false for text content", () => {
      expect(isWhitespaceOnly("hello")).toBe(false);
      expect(isWhitespaceOnly("  a  ")).toBe(false);
    });
  });

  describe("countLines", () => {
    it("should return 0 for empty/null input", () => {
      expect(countLines("")).toBe(0);
      expect(countLines(null as any)).toBe(0);
    });

    it("should count single line", () => {
      expect(countLines("hello")).toBe(1);
    });

    it("should count multiple lines", () => {
      expect(countLines("line1\nline2\nline3")).toBe(3);
    });

    it("should normalize newlines before counting", () => {
      expect(countLines("line1\r\nline2")).toBe(2);
    });
  });

  describe("getLine", () => {
    it("should return null for empty/null input", () => {
      expect(getLine("", 0)).toBe(null);
      expect(getLine(null as any, 0)).toBe(null);
    });

    it("should return line at index", () => {
      expect(getLine("line0\nline1\nline2", 1)).toBe("line1");
    });

    it("should return first line at index 0", () => {
      expect(getLine("first\nsecond", 0)).toBe("first");
    });

    it("should return null for negative index", () => {
      expect(getLine("hello", -1)).toBe(null);
    });

    it("should return null for out of bounds index", () => {
      expect(getLine("hello", 5)).toBe(null);
    });
  });

  describe("replaceLine", () => {
    it("should return empty/null input unchanged", () => {
      expect(replaceLine("", 0, "new")).toBe("");
      expect(replaceLine(null as any, 0, "new")).toBe(null);
    });

    it("should replace line at index", () => {
      expect(replaceLine("line0\nline1\nline2", 1, "replaced")).toBe(
        "line0\nreplaced\nline2"
      );
    });

    it("should return unchanged for negative index", () => {
      expect(replaceLine("hello", -1, "new")).toBe("hello");
    });

    it("should return unchanged for out of bounds index", () => {
      expect(replaceLine("hello", 5, "new")).toBe("hello");
    });
  });
});
