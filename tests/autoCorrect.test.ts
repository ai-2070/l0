// Additional tests for src/utils/autoCorrect.ts

import { describe, it, expect } from "vitest";
import {
  autoCorrectJSON,
  extractJSON,
  isValidJSON,
  describeJSONError,
  repairJSON,
  safeJSONParse,
} from "../src/utils/autoCorrect";

describe("autoCorrectJSON edge cases", () => {
  it("should handle control characters in strings", () => {
    // Create a string with actual control characters (newline)
    const withControlChars = '{"text": "line1\nline2"}';
    const result = autoCorrectJSON(withControlChars);

    // Should escape the control character and produce valid JSON
    expect(result.success).toBe(true);
    expect(result.corrections).toContain("escape_control_chars");
    const parsed = JSON.parse(result.corrected);
    expect(parsed.text).toBe("line1\nline2");
  });

  it("should handle deeply nested structures", () => {
    const nested = '{"a": {"b": {"c": {"d": {"e": "value"';
    const result = autoCorrectJSON(nested);

    expect(result.corrections).toContain("close_brace");
    expect(result.success).toBe(true);
    const parsed = JSON.parse(result.corrected);
    expect(parsed.a.b.c.d.e).toBe("value");
  });

  it("should handle mixed missing brackets and braces", () => {
    const input = '{"arr": [1, 2, 3, {"nested": true';
    const result = autoCorrectJSON(input);

    expect(result.corrections.length).toBeGreaterThan(0);
  });

  it("should remove comments", () => {
    const input = '{"key": "value" /* comment */}';
    const result = autoCorrectJSON(input);

    expect(result.corrections).toContain("remove_comments");
    expect(result.success).toBe(true);
  });

  it("should remove line comments", () => {
    const input = '{"key": "value"} // end comment';
    const result = autoCorrectJSON(input);

    expect(result.corrections).toContain("remove_comments");
  });

  it("should handle structural option disabled", () => {
    const input = '{"key": "value"';
    const result = autoCorrectJSON(input, { structural: false });

    expect(result.success).toBe(false);
  });

  it("should handle stripFormatting option disabled", () => {
    const input = '```json\n{"key": "value"}\n```';
    const result = autoCorrectJSON(input, { stripFormatting: false });

    expect(result.success).toBe(false);
  });

  it("should strip json prefix", () => {
    const input = 'json {"name": "test"}';
    const result = autoCorrectJSON(input);

    expect(result.corrections).toContain("strip_json_prefix");
    expect(result.success).toBe(true);
  });

  it("should remove I hope this helps suffix", () => {
    const input = '{"result": true}\n\nI hope this helps!';
    const result = autoCorrectJSON(input);

    expect(result.corrections).toContain("remove_suffix_text");
    expect(result.success).toBe(true);
  });

  it("should remove Let me know if suffix", () => {
    const input = '{"data": 1}\n\nLet me know if you need more.';
    const result = autoCorrectJSON(input);

    expect(result.corrections).toContain("remove_suffix_text");
  });

  it("should remove This JSON suffix", () => {
    const input = '{"value": 42}\n\nThis JSON contains the answer.';
    const result = autoCorrectJSON(input);

    expect(result.corrections).toContain("remove_suffix_text");
  });

  it("should handle Output: prefix", () => {
    const input = 'Output: {"key": "value"}';
    const result = autoCorrectJSON(input);

    expect(result.corrections).toContain("remove_prefix_text");
  });

  it("should handle Result: prefix", () => {
    const input = 'Result: {"key": "value"}';
    const result = autoCorrectJSON(input);

    expect(result.corrections).toContain("remove_prefix_text");
  });

  it("should handle Response: prefix", () => {
    const input = 'Response: {"key": "value"}';
    const result = autoCorrectJSON(input);

    expect(result.corrections).toContain("remove_prefix_text");
  });

  it("should handle As an AI prefix", () => {
    const input = 'As an AI assistant, here is {"key": "value"}';
    const result = autoCorrectJSON(input);

    expect(result.corrections).toContain("remove_prefix_text");
  });

  it("should handle I can help prefix", () => {
    const input = 'I can help with that. Here is {"key": "value"}';
    const result = autoCorrectJSON(input);

    expect(result.corrections).toContain("remove_prefix_text");
  });

  it("should remove trailing comma at end", () => {
    const input = '{"key": "value"},';
    const result = autoCorrectJSON(input);

    expect(result.corrections).toContain("remove_trailing_comma");
    expect(result.success).toBe(true);
  });
});

describe("extractJSON edge cases", () => {
  it("should handle text with no JSON", () => {
    const text = "This is just plain text without any JSON.";
    const result = extractJSON(text);

    expect(result).toBe(text);
  });

  it("should handle unbalanced braces", () => {
    const text = 'Start {"name": "test" more text';
    const result = extractJSON(text);

    // Should try greedy regex fallback
    expect(result).toBeDefined();
  });

  it("should handle escaped backslashes in strings", () => {
    const text = 'Prefix {"path": "C:\\\\Users"} suffix';
    const result = extractJSON(text);

    expect(result).toBe('{"path": "C:\\\\Users"}');
  });

  it("should prefer object when both present", () => {
    const text = '{"obj": true} and [1, 2, 3]';
    const result = extractJSON(text);

    expect(result).toBe('{"obj": true}');
  });

  it("should prefer array when it comes first", () => {
    const text = '[1, 2] and {"obj": true}';
    const result = extractJSON(text);

    expect(result).toBe("[1, 2]");
  });

  it("should handle complex nested escape sequences", () => {
    const text = 'Result: {"msg": "Say \\"hi\\" to \\"them\\""}';
    const result = extractJSON(text);

    expect(result).toBe('{"msg": "Say \\"hi\\" to \\"them\\""}');
    expect(JSON.parse(result).msg).toBe('Say "hi" to "them"');
  });
});

describe("describeJSONError", () => {
  it("should describe unexpected end error", () => {
    // Create an error with "unexpected end" message
    const error = new Error("Unexpected end of JSON input");
    const desc = describeJSONError(error);
    expect(desc).toContain("Incomplete");
  });

  it("should describe unexpected token error", () => {
    // Create an error with "unexpected token" message
    const error = new Error("Unexpected token x in JSON");
    const desc = describeJSONError(error);
    expect(desc).toContain("unexpected");
  });

  it("should describe control character error", () => {
    const error = new Error("Bad control character in string");
    const desc = describeJSONError(error);

    expect(desc).toContain("control character");
  });

  it("should describe trailing comma error", () => {
    const error = new Error("Trailing comma not allowed");
    const desc = describeJSONError(error);

    expect(desc).toContain("Trailing comma");
  });

  it("should describe property name error", () => {
    const error = new Error("Expected property name");
    const desc = describeJSONError(error);

    expect(desc).toContain("property name");
  });

  it("should return original message for unknown errors", () => {
    const error = new Error("Some other error");
    const desc = describeJSONError(error);

    expect(desc).toBe("Some other error");
  });
});

describe("repairJSON", () => {
  it("should repair simple missing brace", () => {
    const input = '{"name": "John"';
    const result = repairJSON(input);

    expect(result).toBe('{"name": "John"}');
  });

  it("should repair JSON in surrounding text", () => {
    const input = 'Here is the result: {"value": 42} done';
    const result = repairJSON(input);

    expect(JSON.parse(result).value).toBe(42);
  });

  it("should repair single quotes to double quotes", () => {
    const input = "{'name': 'John'}";
    const result = repairJSON(input);

    expect(JSON.parse(result).name).toBe("John");
  });

  it("should throw for unrepairable JSON", () => {
    const input = "completely invalid {{{{ not json at all";

    expect(() => repairJSON(input)).toThrow();
  });

  it("should handle already valid JSON", () => {
    const input = '{"valid": true}';
    const result = repairJSON(input);

    expect(result).toBe('{"valid": true}');
  });

  it("should handle markdown fences", () => {
    const input = '```json\n{"key": "value"}\n```';
    const result = repairJSON(input);

    expect(JSON.parse(result).key).toBe("value");
  });
});

describe("safeJSONParse", () => {
  it("should parse valid JSON without correction", () => {
    const result = safeJSONParse('{"name": "John"}');

    expect(result.data.name).toBe("John");
    expect(result.corrected).toBe(false);
    expect(result.corrections).toHaveLength(0);
  });

  it("should parse and correct invalid JSON", () => {
    const result = safeJSONParse('{"name": "John"');

    expect(result.data.name).toBe("John");
    expect(result.corrected).toBe(true);
    expect(result.corrections.length).toBeGreaterThan(0);
  });

  it("should throw for unrepairable JSON", () => {
    expect(() => safeJSONParse("not json")).toThrow();
  });

  it("should accept correction options", () => {
    const result = safeJSONParse('{"value": 1}', { structural: true });

    expect(result.data.value).toBe(1);
  });

  it("should parse arrays", () => {
    const result = safeJSONParse("[1, 2, 3]");

    expect(result.data).toEqual([1, 2, 3]);
    expect(result.corrected).toBe(false);
  });

  it("should correct arrays with missing bracket", () => {
    const result = safeJSONParse("[1, 2, 3");

    expect(result.data).toEqual([1, 2, 3]);
    expect(result.corrected).toBe(true);
  });
});

describe("isValidJSON", () => {
  it("should return true for valid object", () => {
    expect(isValidJSON('{"key": "value"}')).toBe(true);
  });

  it("should return true for valid array", () => {
    expect(isValidJSON("[1, 2, 3]")).toBe(true);
  });

  it("should return true for primitives", () => {
    expect(isValidJSON("true")).toBe(true);
    expect(isValidJSON("false")).toBe(true);
    expect(isValidJSON("null")).toBe(true);
    expect(isValidJSON("123")).toBe(true);
    expect(isValidJSON('"string"')).toBe(true);
  });

  it("should return false for invalid JSON", () => {
    expect(isValidJSON("{invalid}")).toBe(false);
    expect(isValidJSON('{"incomplete')).toBe(false);
    expect(isValidJSON("undefined")).toBe(false);
  });

  it("should return false for empty string", () => {
    expect(isValidJSON("")).toBe(false);
  });
});

describe("complex scenarios", () => {
  it("should handle LLM output with explanation before and after", () => {
    const input = `Here's the JSON you requested:

\`\`\`json
{
  "name": "Test",
  "value": 42
}
\`\`\`

Let me know if you need any changes!`;

    const result = autoCorrectJSON(input);

    expect(result.success).toBe(true);
    const parsed = JSON.parse(result.corrected);
    expect(parsed.name).toBe("Test");
    expect(parsed.value).toBe(42);
  });

  it("should handle nested arrays and objects", () => {
    const input = '{"users": [{"name": "John", "tags": ["admin", "user"]}]}';
    const result = autoCorrectJSON(input);

    expect(result.success).toBe(true);
    const parsed = JSON.parse(result.corrected);
    expect(parsed.users[0].name).toBe("John");
    expect(parsed.users[0].tags).toContain("admin");
  });

  it("should handle unicode content", () => {
    const input = '{"message": "Hello 世界 🌍"}';
    const result = autoCorrectJSON(input);

    expect(result.success).toBe(true);
    expect(JSON.parse(result.corrected).message).toBe("Hello 世界 🌍");
  });

  it("should handle escaped quotes in values", () => {
    const input = '{"quote": "He said \\"hello\\""}';
    const result = autoCorrectJSON(input);

    expect(result.success).toBe(true);
    expect(JSON.parse(result.corrected).quote).toBe('He said "hello"');
  });
});
