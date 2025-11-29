// Formatting tests
import { describe, it, expect } from "vitest";
import {
  // Context formatting
  formatContext,
  formatMultipleContexts,
  formatDocument,
  formatInstructions,
  escapeDelimiters,
  unescapeDelimiters,
  // Memory formatting
  formatMemory,
  createMemoryEntry,
  mergeMemory,
  filterMemoryByRole,
  getLastNEntries,
  calculateMemorySize,
  truncateMemory,
  // Output formatting
  formatJsonOutput,
  formatStructuredOutput,
  formatOutputConstraints,
  wrapOutputInstruction,
  createOutputFormatSection,
  extractJsonFromOutput,
  cleanOutput,
  // Tool formatting
  formatTool,
  formatTools,
  createTool,
  createParameter,
  validateTool,
  formatFunctionArguments,
  parseFunctionCall,
  // Utils
  trim,
  escape,
  unescape,
  escapeHtml,
  unescapeHtml,
  escapeRegex,
  sanitize,
  truncate,
  truncateWords,
  wrap,
  pad,
  removeAnsi,
} from "../src/format";

// ============================================
// Context Formatting Tests
// ============================================

describe("Context Formatting", () => {
  describe("formatContext", () => {
    it("should format context with default XML delimiters", () => {
      const result = formatContext("Hello world");
      expect(result).toContain("<context>");
      expect(result).toContain("</context>");
      expect(result).toContain("Hello world");
    });

    it("should return empty string for empty content", () => {
      expect(formatContext("")).toBe("");
      expect(formatContext("   ")).toBe("");
    });

    it("should use custom label", () => {
      const result = formatContext("Content here", { label: "Documentation" });
      expect(result).toContain("<documentation>");
      expect(result).toContain("</documentation>");
    });

    it("should convert label to lowercase with underscores", () => {
      const result = formatContext("Content", { label: "My Custom Label" });
      expect(result).toContain("<my_custom_label>");
      expect(result).toContain("</my_custom_label>");
    });

    it("should support markdown delimiter", () => {
      const result = formatContext("Content", {
        delimiter: "markdown",
        label: "Instructions",
      });
      expect(result).toContain("# Instructions");
      expect(result).toContain("Content");
    });

    it("should support brackets delimiter", () => {
      const result = formatContext("Content", {
        delimiter: "brackets",
        label: "Section",
      });
      expect(result).toContain("[SECTION]");
      expect(result).toContain("=".repeat(20));
    });

    it("should support no delimiter", () => {
      const result = formatContext("Content only", { delimiter: "none" });
      expect(result).not.toContain("<");
      expect(result).not.toContain(">");
    });

    it("should support custom delimiters", () => {
      const result = formatContext("Content", {
        customDelimiterStart: "<<<START>>>",
        customDelimiterEnd: "<<<END>>>",
      });
      expect(result).toContain("<<<START>>>");
      expect(result).toContain("<<<END>>>");
    });

    it("should dedent content by default", () => {
      const result = formatContext("    indented\n    content");
      expect(result).toContain("indented");
      expect(result).toContain("content");
    });

    it("should skip dedent when disabled", () => {
      const result = formatContext("  indented", { dedent: false });
      expect(result).toContain("indented");
    });
  });

  describe("formatMultipleContexts", () => {
    it("should format multiple context items", () => {
      const items = [
        { content: "First doc", label: "Doc1" },
        { content: "Second doc", label: "Doc2" },
      ];
      const result = formatMultipleContexts(items);
      expect(result).toContain("<doc1>");
      expect(result).toContain("<doc2>");
      expect(result).toContain("First doc");
      expect(result).toContain("Second doc");
    });

    it("should filter empty items", () => {
      const items = [
        { content: "Valid", label: "A" },
        { content: "", label: "B" },
        { content: "Also valid", label: "C" },
      ];
      const result = formatMultipleContexts(items);
      expect(result).toContain("<a>");
      expect(result).toContain("<c>");
      expect(result).not.toContain("<b>");
    });

    it("should apply shared options", () => {
      const items = [{ content: "Content" }];
      const result = formatMultipleContexts(items, { delimiter: "markdown" });
      expect(result).toContain("# Context");
    });
  });

  describe("formatDocument", () => {
    it("should format document with metadata", () => {
      const result = formatDocument("Document content", {
        title: "My Doc",
        author: "John",
      });
      expect(result).toContain("title: My Doc");
      expect(result).toContain("author: John");
      expect(result).toContain("Document content");
    });

    it("should return empty for empty content", () => {
      expect(formatDocument("")).toBe("");
    });

    it("should use title as label", () => {
      const result = formatDocument("Content", { title: "Report" });
      expect(result).toContain("<report>");
    });

    it("should filter empty metadata values", () => {
      const result = formatDocument("Content", {
        title: "Test",
        author: "",
      });
      expect(result).toContain("title: Test");
      expect(result).not.toContain("author:");
    });
  });

  describe("formatInstructions", () => {
    it("should format with Instructions label", () => {
      const result = formatInstructions("Do this task");
      expect(result).toContain("<instructions>");
      expect(result).toContain("</instructions>");
      expect(result).toContain("Do this task");
    });

    it("should use XML delimiter by default", () => {
      const result = formatInstructions("Task");
      expect(result).toContain("<");
      expect(result).toContain(">");
    });
  });

  describe("escapeDelimiters", () => {
    it("should escape XML delimiters", () => {
      const result = escapeDelimiters("<tag>content</tag>", "xml");
      expect(result).toBe("&lt;tag&gt;content&lt;/tag&gt;");
    });

    it("should escape markdown headers", () => {
      const result = escapeDelimiters("# Header\n## Sub", "markdown");
      expect(result).toContain("\\#");
    });

    it("should escape bracket delimiters", () => {
      const result = escapeDelimiters("[section]", "brackets");
      expect(result).toBe("\\[section\\]");
    });

    it("should handle empty/null input", () => {
      expect(escapeDelimiters("", "xml")).toBe("");
    });
  });

  describe("unescapeDelimiters", () => {
    it("should unescape XML delimiters", () => {
      const result = unescapeDelimiters("&lt;tag&gt;", "xml");
      expect(result).toBe("<tag>");
    });

    it("should unescape markdown headers", () => {
      const result = unescapeDelimiters("\\# Header", "markdown");
      expect(result).toContain("# Header");
    });

    it("should unescape bracket delimiters", () => {
      const result = unescapeDelimiters("\\[section\\]", "brackets");
      expect(result).toBe("[section]");
    });

    it("should handle empty/null input", () => {
      expect(unescapeDelimiters("", "xml")).toBe("");
    });

    it("should be reverse of escape", () => {
      const original = "<tag>content</tag>";
      const escaped = escapeDelimiters(original, "xml");
      const unescaped = unescapeDelimiters(escaped, "xml");
      expect(unescaped).toBe(original);
    });
  });
});

// ============================================
// Memory Formatting Tests
// ============================================

describe("Memory Formatting", () => {
  describe("formatMemory", () => {
    it("should format memory in conversational style", () => {
      const memory = [
        { role: "user" as const, content: "Hello" },
        { role: "assistant" as const, content: "Hi there!" },
      ];
      const result = formatMemory(memory);
      expect(result).toContain("User: Hello");
      expect(result).toContain("Assistant: Hi there!");
    });

    it("should handle empty memory", () => {
      expect(formatMemory([])).toBe("");
    });

    it("should handle string input", () => {
      const result = formatMemory("Raw memory string");
      expect(result).toContain("Raw memory string");
    });

    it("should limit entries with maxEntries", () => {
      const memory = [
        { role: "user" as const, content: "First" },
        { role: "assistant" as const, content: "Second" },
        { role: "user" as const, content: "Third" },
      ];
      const result = formatMemory(memory, { maxEntries: 2 });
      expect(result).not.toContain("First");
      expect(result).toContain("Second");
      expect(result).toContain("Third");
    });

    it("should include timestamps when requested", () => {
      const memory = [
        {
          role: "user" as const,
          content: "Hello",
          timestamp: Date.now(),
        },
      ];
      const result = formatMemory(memory, { includeTimestamps: true });
      expect(result).toMatch(/\[\d{4}-\d{2}-\d{2}T/);
    });

    it("should include metadata when requested", () => {
      const memory = [
        {
          role: "user" as const,
          content: "Hello",
          metadata: { source: "web" },
        },
      ];
      const result = formatMemory(memory, { includeMetadata: true });
      expect(result).toContain("source=web");
    });

    it("should format in structured style", () => {
      const memory = [{ role: "user" as const, content: "Hello" }];
      const result = formatMemory(memory, { style: "structured" });
      expect(result).toContain("<conversation_history>");
      expect(result).toContain("<message");
      expect(result).toContain('role="user"');
    });

    it("should format in compact style", () => {
      const memory = [
        { role: "user" as const, content: "Hello" },
        { role: "assistant" as const, content: "Hi" },
        { role: "system" as const, content: "Context" },
      ];
      const result = formatMemory(memory, { style: "compact" });
      expect(result).toContain("U: Hello");
      expect(result).toContain("A: Hi");
      expect(result).toContain("S: Context");
    });
  });

  describe("createMemoryEntry", () => {
    it("should create memory entry with timestamp", () => {
      const entry = createMemoryEntry("user", "Hello");
      expect(entry.role).toBe("user");
      expect(entry.content).toBe("Hello");
      expect(entry.timestamp).toBeDefined();
    });

    it("should include metadata", () => {
      const entry = createMemoryEntry("assistant", "Response", { id: "123" });
      expect(entry.metadata).toEqual({ id: "123" });
    });
  });

  describe("mergeMemory", () => {
    it("should merge and sort by timestamp", () => {
      const memory1 = [
        { role: "user" as const, content: "First", timestamp: 100 },
      ];
      const memory2 = [
        { role: "user" as const, content: "Second", timestamp: 200 },
      ];
      const memory3 = [
        { role: "user" as const, content: "Middle", timestamp: 150 },
      ];

      const merged = mergeMemory(memory1, memory2, memory3);
      expect(merged[0]!.content).toBe("First");
      expect(merged[1]!.content).toBe("Middle");
      expect(merged[2]!.content).toBe("Second");
    });
  });

  describe("filterMemoryByRole", () => {
    it("should filter by role", () => {
      const memory = [
        { role: "user" as const, content: "A" },
        { role: "assistant" as const, content: "B" },
        { role: "user" as const, content: "C" },
      ];
      const filtered = filterMemoryByRole(memory, "user");
      expect(filtered).toHaveLength(2);
      expect(filtered.every((e) => e.role === "user")).toBe(true);
    });
  });

  describe("getLastNEntries", () => {
    it("should get last N entries", () => {
      const memory = [
        { role: "user" as const, content: "A" },
        { role: "user" as const, content: "B" },
        { role: "user" as const, content: "C" },
      ];
      const last = getLastNEntries(memory, 2);
      expect(last).toHaveLength(2);
      expect(last[0]!.content).toBe("B");
      expect(last[1]!.content).toBe("C");
    });
  });

  describe("calculateMemorySize", () => {
    it("should calculate total character count", () => {
      const memory = [
        { role: "user" as const, content: "Hello" },
        { role: "assistant" as const, content: "Hi" },
      ];
      expect(calculateMemorySize(memory)).toBe(7);
    });
  });

  describe("truncateMemory", () => {
    it("should truncate to fit within size limit", () => {
      const memory = [
        { role: "user" as const, content: "12345" },
        { role: "user" as const, content: "67890" },
        { role: "user" as const, content: "abc" },
      ];
      const truncated = truncateMemory(memory, 8);
      expect(truncated).toHaveLength(2);
      expect(truncated[0]!.content).toBe("67890");
      expect(truncated[1]!.content).toBe("abc");
    });

    it("should keep all entries if within limit", () => {
      const memory = [{ role: "user" as const, content: "Hi" }];
      const truncated = truncateMemory(memory, 100);
      expect(truncated).toHaveLength(1);
    });
  });
});

// ============================================
// Output Formatting Tests
// ============================================

describe("Output Formatting", () => {
  describe("formatJsonOutput", () => {
    it("should format strict JSON instructions", () => {
      const result = formatJsonOutput({ strict: true });
      expect(result).toContain("valid JSON only");
      expect(result).toContain("Do not include any text");
      expect(result).toContain("Start your response with {");
    });

    it("should format non-strict JSON instructions", () => {
      const result = formatJsonOutput({ strict: false });
      expect(result).toContain("valid JSON");
      expect(result).not.toContain("Do not include any text");
    });

    it("should include schema when provided", () => {
      const result = formatJsonOutput({ schema: '{"type": "object"}' });
      expect(result).toContain("Expected JSON schema:");
      expect(result).toContain('{"type": "object"}');
    });

    it("should include example when provided", () => {
      const result = formatJsonOutput({ example: '{"key": "value"}' });
      expect(result).toContain("Example output:");
      expect(result).toContain('{"key": "value"}');
    });

    it("should skip instructions when not requested", () => {
      const result = formatJsonOutput({ includeInstructions: false });
      expect(result).toBe("");
    });
  });

  describe("formatStructuredOutput", () => {
    it("should format JSON output", () => {
      const result = formatStructuredOutput("json");
      expect(result).toContain("JSON");
    });

    it("should format YAML output", () => {
      const result = formatStructuredOutput("yaml");
      expect(result).toContain("YAML");
    });

    it("should format XML output", () => {
      const result = formatStructuredOutput("xml");
      expect(result).toContain("XML");
    });

    it("should format markdown output", () => {
      const result = formatStructuredOutput("markdown");
      expect(result).toContain("Markdown");
    });

    it("should format plain output", () => {
      const result = formatStructuredOutput("plain");
      expect(result).toContain("plain text");
    });

    it("should include schema for non-JSON formats", () => {
      const result = formatStructuredOutput("yaml", { schema: "test schema" });
      expect(result).toContain("Expected YAML schema:");
    });
  });

  describe("formatOutputConstraints", () => {
    it("should format max length constraint", () => {
      const result = formatOutputConstraints({ maxLength: 100 });
      expect(result).toContain("under 100 characters");
    });

    it("should format min length constraint", () => {
      const result = formatOutputConstraints({ minLength: 50 });
      expect(result).toContain("at least 50 characters");
    });

    it("should format no code blocks constraint", () => {
      const result = formatOutputConstraints({ noCodeBlocks: true });
      expect(result).toContain("Do not use code blocks");
    });

    it("should format no markdown constraint", () => {
      const result = formatOutputConstraints({ noMarkdown: true });
      expect(result).toContain("Do not use Markdown");
    });

    it("should format language constraint", () => {
      const result = formatOutputConstraints({ language: "Spanish" });
      expect(result).toContain("Respond in Spanish");
    });

    it("should format tone constraint", () => {
      const result = formatOutputConstraints({ tone: "professional" });
      expect(result).toContain("professional tone");
    });

    it("should combine multiple constraints", () => {
      const result = formatOutputConstraints({
        maxLength: 100,
        noMarkdown: true,
        tone: "casual",
      });
      expect(result).toContain("100 characters");
      expect(result).toContain("Markdown");
      expect(result).toContain("casual");
    });
  });

  describe("wrapOutputInstruction", () => {
    it("should wrap with output_format tags", () => {
      const result = wrapOutputInstruction("Some instruction");
      expect(result).toBe(
        "<output_format>\nSome instruction\n</output_format>",
      );
    });
  });

  describe("createOutputFormatSection", () => {
    it("should create wrapped format section", () => {
      const result = createOutputFormatSection("json");
      expect(result).toContain("<output_format>");
      expect(result).toContain("</output_format>");
      expect(result).toContain("JSON");
    });

    it("should skip wrapping when disabled", () => {
      const result = createOutputFormatSection("json", { wrap: false });
      expect(result).not.toContain("<output_format>");
    });

    it("should include constraints", () => {
      const result = createOutputFormatSection("json", {
        constraints: { maxLength: 500 },
      });
      expect(result).toContain("500 characters");
    });
  });

  describe("extractJsonFromOutput", () => {
    it("should extract JSON from code block", () => {
      const output = 'Here is the JSON:\n```json\n{"key": "value"}\n```';
      const result = extractJsonFromOutput(output);
      expect(result).toBe('{"key": "value"}');
    });

    it("should extract JSON without code block", () => {
      const output = 'The result is {"key": "value"} as requested.';
      const result = extractJsonFromOutput(output);
      expect(result).toBe('{"key": "value"}');
    });

    it("should extract JSON array", () => {
      const output = "Here is the array: [1, 2, 3]";
      const result = extractJsonFromOutput(output);
      expect(result).toBe("[1, 2, 3]");
    });

    it("should return null for no JSON", () => {
      const result = extractJsonFromOutput("No JSON here");
      expect(result).toBeNull();
    });

    it("should return null for empty input", () => {
      expect(extractJsonFromOutput("")).toBeNull();
    });
  });

  describe("cleanOutput", () => {
    it("should remove common prefixes", () => {
      expect(cleanOutput("Sure, here is the result")).toBe(
        "here is the result",
      );
      expect(cleanOutput("Certainly, the answer is")).toBe("the answer is");
      expect(cleanOutput("Of course, this is it")).toBe("this is it");
    });

    it("should remove code block wrappers", () => {
      const result = cleanOutput("```json\n{}\n```");
      expect(result).toBe("{}");
    });

    it("should trim whitespace", () => {
      expect(cleanOutput("  content  ")).toBe("content");
    });

    it("should handle empty input", () => {
      expect(cleanOutput("")).toBe("");
    });
  });
});

// ============================================
// Tool Formatting Tests
// ============================================

describe("Tool Formatting", () => {
  const sampleTool = {
    name: "get_weather",
    description: "Get weather for a location",
    parameters: [
      {
        name: "location",
        type: "string",
        description: "City name",
        required: true,
      },
      {
        name: "units",
        type: "string",
        enum: ["celsius", "fahrenheit"],
        required: false,
      },
    ],
  };

  describe("formatTool", () => {
    it("should format tool as JSON schema by default", () => {
      const result = formatTool(sampleTool);
      const parsed = JSON.parse(result);
      expect(parsed.name).toBe("get_weather");
      expect(parsed.parameters.properties.location).toBeDefined();
    });

    it("should include types by default", () => {
      const result = formatTool(sampleTool);
      const parsed = JSON.parse(result);
      expect(parsed.parameters.properties.location.type).toBe("string");
    });

    it("should exclude types when includeTypes is false", () => {
      const result = formatTool(sampleTool, { includeTypes: false });
      const parsed = JSON.parse(result);
      expect(parsed.parameters.properties.location.type).toBeUndefined();
    });

    it("should format tool as TypeScript", () => {
      const result = formatTool(sampleTool, { style: "typescript" });
      expect(result).toContain("function get_weather");
      expect(result).toContain("location: string");
      expect(result).toContain("@param location");
    });

    it("should format tool as natural language", () => {
      const result = formatTool(sampleTool, { style: "natural" });
      expect(result).toContain("Tool: get_weather");
      expect(result).toContain("Description:");
      expect(result).toContain("Parameters:");
      expect(result).toContain("(required)");
      expect(result).toContain("(optional)");
    });

    it("should include examples when requested", () => {
      const result = formatTool(sampleTool, {
        style: "natural",
        includeExamples: true,
      });
      expect(result).toContain("Example usage:");
    });

    it("should format tool as XML", () => {
      const result = formatTool(sampleTool, { style: "xml" });
      expect(result).toContain('<tool name="get_weather">');
      expect(result).toContain("<parameter");
      expect(result).toContain("</tool>");
    });
  });

  describe("formatTools", () => {
    it("should format multiple tools as JSON array", () => {
      const tools = [sampleTool, { ...sampleTool, name: "other_tool" }];
      const result = formatTools(tools);
      const parsed = JSON.parse(result);
      expect(parsed).toHaveLength(2);
    });

    it("should format multiple tools with separators for other styles", () => {
      const tools = [sampleTool, { ...sampleTool, name: "other_tool" }];
      const result = formatTools(tools, { style: "natural" });
      expect(result).toContain("=".repeat(50));
    });
  });

  describe("createTool", () => {
    it("should create tool definition", () => {
      const tool = createTool("my_tool", "Does something", [
        { name: "arg1", type: "string", required: true },
      ]);
      expect(tool.name).toBe("my_tool");
      expect(tool.description).toBe("Does something");
      expect(tool.parameters).toHaveLength(1);
    });
  });

  describe("createParameter", () => {
    it("should create parameter with defaults", () => {
      const param = createParameter("test", "string");
      expect(param.name).toBe("test");
      expect(param.type).toBe("string");
      expect(param.required).toBe(false);
    });

    it("should create required parameter", () => {
      const param = createParameter("test", "string", "A description", true);
      expect(param.required).toBe(true);
      expect(param.description).toBe("A description");
    });
  });

  describe("validateTool", () => {
    it("should validate correct tool", () => {
      const errors = validateTool(sampleTool);
      expect(errors).toHaveLength(0);
    });

    it("should detect missing name", () => {
      const errors = validateTool({ ...sampleTool, name: "" });
      expect(errors).toContain("Tool name is required");
    });

    it("should detect invalid name", () => {
      const errors = validateTool({ ...sampleTool, name: "123invalid" });
      expect(errors).toContain("Tool name must be a valid identifier");
    });

    it("should detect missing description", () => {
      const errors = validateTool({ ...sampleTool, description: "" });
      expect(errors).toContain("Tool description is required");
    });

    it("should detect invalid parameter type", () => {
      const tool = {
        ...sampleTool,
        parameters: [{ name: "test", type: "invalid_type" }],
      };
      const errors = validateTool(tool);
      expect(errors.some((e) => e.includes("invalid type"))).toBe(true);
    });

    it("should detect invalid parameter name", () => {
      const tool = {
        ...sampleTool,
        parameters: [{ name: "123bad", type: "string" }],
      };
      const errors = validateTool(tool);
      expect(errors.some((e) => e.includes("valid identifier"))).toBe(true);
    });
  });

  describe("formatFunctionArguments", () => {
    it("should format arguments as JSON", () => {
      const result = formatFunctionArguments({ key: "value" });
      expect(result).toBe('{"key":"value"}');
    });

    it("should format with pretty printing", () => {
      const result = formatFunctionArguments({ key: "value" }, true);
      expect(result).toContain("\n");
    });
  });

  describe("parseFunctionCall", () => {
    it("should parse JSON format function call", () => {
      const output = '{"name": "my_func", "arguments": {"arg1": "value"}}';
      const result = parseFunctionCall(output);
      expect(result).toEqual({
        name: "my_func",
        arguments: { arg1: "value" },
      });
    });

    it("should parse function call format", () => {
      const output = 'my_func({"arg1": "value"})';
      const result = parseFunctionCall(output);
      expect(result).toEqual({
        name: "my_func",
        arguments: { arg1: "value" },
      });
    });

    it("should return null for invalid format", () => {
      const result = parseFunctionCall("not a function call");
      expect(result).toBeNull();
    });
  });
});

// ============================================
// Utils Tests
// ============================================

describe("Format Utils", () => {
  describe("trim", () => {
    it("should trim whitespace", () => {
      expect(trim("  hello  ")).toBe("hello");
    });

    it("should handle empty/null", () => {
      expect(trim("")).toBe("");
    });
  });

  describe("escape", () => {
    it("should escape special characters", () => {
      expect(escape('"hello\nworld"')).toBe('\\"hello\\nworld\\"');
      expect(escape("tab\there")).toBe("tab\\there");
      expect(escape("return\rhere")).toBe("return\\rhere");
    });

    it("should escape backslashes", () => {
      expect(escape("path\\to\\file")).toBe("path\\\\to\\\\file");
    });

    it("should handle empty input", () => {
      expect(escape("")).toBe("");
    });
  });

  describe("unescape", () => {
    it("should unescape special characters", () => {
      expect(unescape('\\"hello\\nworld\\"')).toBe('"hello\nworld"');
      expect(unescape("tab\\there")).toBe("tab\there");
    });

    it("should be reverse of escape", () => {
      const original = '"hello\nworld"';
      expect(unescape(escape(original))).toBe(original);
    });

    it("should handle empty input", () => {
      expect(unescape("")).toBe("");
    });
  });

  describe("escapeHtml", () => {
    it("should escape HTML entities", () => {
      expect(escapeHtml("<div>&'\"</div>")).toBe(
        "&lt;div&gt;&amp;&#39;&quot;&lt;/div&gt;",
      );
    });

    it("should handle empty input", () => {
      expect(escapeHtml("")).toBe("");
    });
  });

  describe("unescapeHtml", () => {
    it("should unescape HTML entities", () => {
      expect(unescapeHtml("&lt;div&gt;&amp;&#39;&quot;&lt;/div&gt;")).toBe(
        "<div>&'\"</div>",
      );
    });

    it("should handle &#x27; variant", () => {
      expect(unescapeHtml("&#x27;")).toBe("'");
    });

    it("should be reverse of escapeHtml", () => {
      const original = "<div>&'\"</div>";
      expect(unescapeHtml(escapeHtml(original))).toBe(original);
    });
  });

  describe("escapeRegex", () => {
    it("should escape regex special characters", () => {
      expect(escapeRegex("hello.world*")).toBe("hello\\.world\\*");
      expect(escapeRegex("a+b?c")).toBe("a\\+b\\?c");
      expect(escapeRegex("(test)")).toBe("\\(test\\)");
    });

    it("should handle empty input", () => {
      expect(escapeRegex("")).toBe("");
    });
  });

  describe("sanitize", () => {
    it("should remove control characters", () => {
      expect(sanitize("hello\x00world")).toBe("helloworld");
      expect(sanitize("test\x1Fhere")).toBe("testhere");
    });

    it("should preserve newlines and tabs", () => {
      expect(sanitize("hello\nworld\ttab")).toBe("hello\nworld\ttab");
    });

    it("should handle empty input", () => {
      expect(sanitize("")).toBe("");
    });
  });

  describe("truncate", () => {
    it("should truncate long strings", () => {
      expect(truncate("hello world", 8)).toBe("hello...");
    });

    it("should not truncate short strings", () => {
      expect(truncate("hello", 10)).toBe("hello");
    });

    it("should use custom suffix", () => {
      expect(truncate("hello world", 8, "---")).toBe("hello---");
    });

    it("should handle empty input", () => {
      expect(truncate("", 10)).toBe("");
    });
  });

  describe("truncateWords", () => {
    it("should truncate at word boundary", () => {
      expect(truncateWords("hello beautiful world", 15)).toBe("hello...");
    });

    it("should not truncate short strings", () => {
      expect(truncateWords("hello", 20)).toBe("hello");
    });

    it("should fallback to character truncation if no space", () => {
      expect(truncateWords("helloworld", 8)).toBe("hello...");
    });
  });

  describe("wrap", () => {
    it("should wrap text at specified width", () => {
      const result = wrap("hello world test", 10);
      expect(result).toBe("hello\nworld test");
    });

    it("should handle empty input", () => {
      expect(wrap("", 10)).toBe("");
    });

    it("should handle single word", () => {
      expect(wrap("hello", 10)).toBe("hello");
    });
  });

  describe("pad", () => {
    it("should pad left by default", () => {
      expect(pad("hi", 5)).toBe("hi   ");
    });

    it("should pad right", () => {
      expect(pad("hi", 5, " ", "right")).toBe("   hi");
    });

    it("should pad center", () => {
      expect(pad("hi", 6, " ", "center")).toBe("  hi  ");
    });

    it("should use custom character", () => {
      expect(pad("hi", 5, "-")).toBe("hi---");
    });

    it("should not pad if already long enough", () => {
      expect(pad("hello", 3)).toBe("hello");
    });

    it("should handle empty string", () => {
      expect(pad("", 3)).toBe("   ");
    });
  });

  describe("removeAnsi", () => {
    it("should remove ANSI color codes", () => {
      expect(removeAnsi("\x1b[31mred\x1b[0m")).toBe("red");
      expect(removeAnsi("\x1b[1;32mgreen bold\x1b[0m")).toBe("green bold");
    });

    it("should handle strings without ANSI codes", () => {
      expect(removeAnsi("plain text")).toBe("plain text");
    });

    it("should handle empty input", () => {
      expect(removeAnsi("")).toBe("");
    });
  });
});
