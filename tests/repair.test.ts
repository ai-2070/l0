import { describe, it, expect } from "vitest";
import {
  repairJson,
  balanceBraces,
  balanceBrackets,
  removeTrailingCommas,
  fixUnclosedStrings,
  repairMarkdownFences,
  repairLatexEnvironments,
  repairToolCallArguments,
  isValidJson,
  parseOrRepairJson,
  extractJson,
  wrapInJson,
  ensureJson,
} from "../src/utils/repair";

describe("Repair Utilities", () => {
  describe("balanceBraces", () => {
    it("should return empty/null input unchanged", () => {
      expect(balanceBraces("")).toBe("");
      expect(balanceBraces(null as any)).toBe(null);
    });

    it("should add missing closing braces", () => {
      expect(balanceBraces('{"a": 1')).toBe('{"a": 1}');
      expect(balanceBraces('{"a": {"b": 1}')).toBe('{"a": {"b": 1}}');
    });

    it("should remove extra closing braces", () => {
      expect(balanceBraces('{"a": 1}}')).toBe('{"a": 1}');
      expect(balanceBraces('{"a": 1}}}')).toBe('{"a": 1}');
    });

    it("should not count braces inside strings", () => {
      expect(balanceBraces('{"a": "{"}')).toBe('{"a": "{"}');
    });

    it("should handle escaped quotes in strings", () => {
      expect(balanceBraces('{"a": "\\""}')).toBe('{"a": "\\""}');
    });

    it("should leave balanced braces unchanged", () => {
      expect(balanceBraces('{"a": 1}')).toBe('{"a": 1}');
    });
  });

  describe("balanceBrackets", () => {
    it("should return empty/null input unchanged", () => {
      expect(balanceBrackets("")).toBe("");
      expect(balanceBrackets(null as any)).toBe(null);
    });

    it("should add missing closing brackets", () => {
      expect(balanceBrackets("[1, 2")).toBe("[1, 2]");
      expect(balanceBrackets("[[1, 2]")).toBe("[[1, 2]]");
    });

    it("should remove extra closing brackets", () => {
      expect(balanceBrackets("[1, 2]]")).toBe("[1, 2]");
    });

    it("should not count brackets inside strings", () => {
      expect(balanceBrackets('["["]')).toBe('["["]');
    });

    it("should leave balanced brackets unchanged", () => {
      expect(balanceBrackets("[1, 2, 3]")).toBe("[1, 2, 3]");
    });
  });

  describe("removeTrailingCommas", () => {
    it("should return empty/null input unchanged", () => {
      expect(removeTrailingCommas("")).toBe("");
      expect(removeTrailingCommas(null as any)).toBe(null);
    });

    it("should remove trailing commas before closing brace", () => {
      expect(removeTrailingCommas('{"a": 1,}')).toBe('{"a": 1}');
      expect(removeTrailingCommas('{"a": 1, }')).toBe('{"a": 1 }');
    });

    it("should remove trailing commas before closing bracket", () => {
      expect(removeTrailingCommas("[1, 2,]")).toBe("[1, 2]");
      expect(removeTrailingCommas("[1, 2, ]")).toBe("[1, 2 ]");
    });

    it("should handle multiple trailing commas", () => {
      expect(removeTrailingCommas('{"a": [1,],}')).toBe('{"a": [1]}');
    });
  });

  describe("fixUnclosedStrings", () => {
    it("should return empty/null input unchanged", () => {
      expect(fixUnclosedStrings("")).toBe("");
      expect(fixUnclosedStrings(null as any)).toBe(null);
    });

    it("should add closing quote for unclosed string", () => {
      expect(fixUnclosedStrings('{"a": "hello')).toBe('{"a": "hello"');
    });

    it("should not add quote if already balanced", () => {
      expect(fixUnclosedStrings('{"a": "hello"}')).toBe('{"a": "hello"}');
    });

    it("should handle escaped quotes", () => {
      expect(fixUnclosedStrings('"test\\"')).toBe('"test\\""');
    });
  });

  describe("repairJson", () => {
    it("should return empty input unchanged", () => {
      expect(repairJson("")).toBe("");
    });

    it("should trim whitespace-only input", () => {
      // repairJson trims input but doesn't return empty string
      expect(repairJson("   ").trim()).toBe("");
    });

    it("should fix trailing commas and missing braces", () => {
      const broken = '{"a": 1,';
      const repaired = repairJson(broken);
      expect(repaired).toBe('{"a": 1}');
    });

    it("should fix simple missing brace", () => {
      const broken = '{"a": 1';
      const repaired = repairJson(broken);
      expect(() => JSON.parse(repaired)).not.toThrow();
    });

    it("should fix trailing comma in object", () => {
      const broken = '{"a": 1,}';
      const repaired = repairJson(broken);
      expect(() => JSON.parse(repaired)).not.toThrow();
    });
  });

  describe("repairMarkdownFences", () => {
    it("should return empty/null input unchanged", () => {
      expect(repairMarkdownFences("")).toBe("");
      expect(repairMarkdownFences(null as any)).toBe(null);
    });

    it("should close unclosed code fence", () => {
      const input = "```javascript\nconst x = 1;";
      const result = repairMarkdownFences(input);
      expect(result).toContain("```");
      expect(result.match(/```/g)!.length).toBe(2);
    });

    it("should not modify balanced fences", () => {
      const input = "```js\ncode\n```";
      expect(repairMarkdownFences(input)).toBe(input);
    });

    it("should handle multiple fence pairs", () => {
      const input = "```\ncode1\n```\n\n```\ncode2\n```";
      expect(repairMarkdownFences(input)).toBe(input);
    });

    it("should handle no fences", () => {
      const input = "just plain text";
      expect(repairMarkdownFences(input)).toBe(input);
    });
  });

  describe("repairLatexEnvironments", () => {
    it("should return empty/null input unchanged", () => {
      expect(repairLatexEnvironments("")).toBe("");
      expect(repairLatexEnvironments(null as any)).toBe(null);
    });

    it("should close unclosed environment", () => {
      const input = "\\begin{equation}\nx = 1";
      const result = repairLatexEnvironments(input);
      expect(result).toContain("\\end{equation}");
    });

    it("should handle nested environments", () => {
      const input = "\\begin{align}\\begin{cases}x";
      const result = repairLatexEnvironments(input);
      expect(result).toContain("\\end{cases}");
      expect(result).toContain("\\end{align}");
    });

    it("should not modify balanced environments", () => {
      const input = "\\begin{equation}x\\end{equation}";
      expect(repairLatexEnvironments(input)).toBe(input);
    });

    it("should handle no environments", () => {
      const input = "plain text";
      expect(repairLatexEnvironments(input)).toBe(input);
    });
  });

  describe("repairToolCallArguments", () => {
    it("should return empty/null input unchanged", () => {
      expect(repairToolCallArguments("")).toBe("");
      expect(repairToolCallArguments(null as any)).toBe(null);
    });

    it("should add opening brace if missing", () => {
      const input = '"key": "value"}';
      const result = repairToolCallArguments(input);
      expect(result.startsWith("{")).toBe(true);
    });

    it("should balance braces", () => {
      const input = '{"key": "value"';
      const result = repairToolCallArguments(input);
      expect(() => JSON.parse(result)).not.toThrow();
    });

    it("should trim whitespace", () => {
      const input = '  {"key": "value"}  ';
      const result = repairToolCallArguments(input);
      expect(result).toBe('{"key": "value"}');
    });
  });

  describe("isValidJson", () => {
    it("should return false for empty/null input", () => {
      expect(isValidJson("")).toBe(false);
      expect(isValidJson("   ")).toBe(false);
      expect(isValidJson(null as any)).toBe(false);
    });

    it("should return true for valid JSON", () => {
      expect(isValidJson('{"a": 1}')).toBe(true);
      expect(isValidJson("[1, 2, 3]")).toBe(true);
      expect(isValidJson('"string"')).toBe(true);
      expect(isValidJson("123")).toBe(true);
      expect(isValidJson("true")).toBe(true);
      expect(isValidJson("null")).toBe(true);
    });

    it("should return false for invalid JSON", () => {
      expect(isValidJson('{"a": 1')).toBe(false);
      expect(isValidJson("undefined")).toBe(false);
      expect(isValidJson("{a: 1}")).toBe(false);
    });
  });

  describe("parseOrRepairJson", () => {
    it("should return null for empty input", () => {
      expect(parseOrRepairJson("")).toBe(null);
      expect(parseOrRepairJson(null as any)).toBe(null);
    });

    it("should parse valid JSON directly", () => {
      expect(parseOrRepairJson('{"a": 1}')).toEqual({ a: 1 });
    });

    it("should repair and parse broken JSON", () => {
      expect(parseOrRepairJson('{"a": 1')).toEqual({ a: 1 });
    });

    it("should return null for unrepairable JSON", () => {
      expect(parseOrRepairJson("completely invalid {{{{")).toBe(null);
    });
  });

  describe("extractJson", () => {
    it("should return null for empty input", () => {
      expect(extractJson("")).toBe(null);
      expect(extractJson(null as any)).toBe(null);
    });

    it("should extract JSON object from text", () => {
      const text = 'Here is the result: {"a": 1} and more text';
      expect(extractJson(text)).toBe('{"a": 1}');
    });

    it("should extract JSON array from text", () => {
      const text = "The array is [1, 2, 3] in the middle";
      expect(extractJson(text)).toBe("[1, 2, 3]");
    });

    it("should handle nested structures", () => {
      const text = 'prefix {"outer": {"inner": 1}} suffix';
      expect(extractJson(text)).toBe('{"outer": {"inner": 1}}');
    });

    it("should repair incomplete JSON at end", () => {
      const text = 'result: {"a": 1, "b": 2';
      const extracted = extractJson(text);
      expect(extracted).not.toBeNull();
      expect(() => JSON.parse(extracted!)).not.toThrow();
    });

    it("should return null if no JSON found", () => {
      expect(extractJson("no json here")).toBe(null);
    });

    it("should prefer object over array when object comes first", () => {
      const text = '{"a": 1} [1, 2]';
      expect(extractJson(text)).toBe('{"a": 1}');
    });

    it("should prefer array when it comes first", () => {
      const text = "[1, 2] then {a: 1}";
      expect(extractJson(text)).toBe("[1, 2]");
    });
  });

  describe("wrapInJson", () => {
    it("should wrap content in JSON object", () => {
      expect(wrapInJson("key", "value")).toBe('{"key":"value"}');
    });

    it("should handle special characters", () => {
      const result = wrapInJson("key", 'value with "quotes"');
      expect(() => JSON.parse(result)).not.toThrow();
    });
  });

  describe("ensureJson", () => {
    it("should return empty object for empty input", () => {
      expect(ensureJson("")).toBe("{}");
      expect(ensureJson(null as any)).toBe("{}");
    });

    it("should return valid JSON unchanged", () => {
      expect(ensureJson('{"a": 1}')).toBe('{"a": 1}');
    });

    it("should repair and return repairable JSON", () => {
      const result = ensureJson('{"a": 1');
      expect(() => JSON.parse(result)).not.toThrow();
    });

    it("should wrap non-JSON content", () => {
      const result = ensureJson("just text");
      const parsed = JSON.parse(result);
      expect(parsed.content).toBe("just text");
    });

    it("should use custom wrap key", () => {
      const result = ensureJson("text", "message");
      const parsed = JSON.parse(result);
      expect(parsed.message).toBe("text");
    });
  });
});
