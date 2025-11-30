// Tests for formatting utilities (context, memory, output, tools, utils)

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
  createOutputFormatSection,
  extractJsonFromOutput,
  cleanOutput,
  // Tools formatting
  formatTool,
  formatTools,
  createTool,
  createParameter,
  validateTool,
  formatFunctionArguments,
  parseFunctionCall,
  // Utility functions
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
} from "../src/index";

// ============================================================================
// Context Formatting Tests
// ============================================================================

describe("Context Formatting", () => {
  describe("formatContext", () => {
    it("should format context with XML delimiters by default", () => {
      const result = formatContext("Test content");
      expect(result).toContain("<context>");
      expect(result).toContain("Test content");
      expect(result).toContain("</context>");
    });

    it("should use custom label", () => {
      const result = formatContext("Test content", { label: "Document" });
      expect(result).toContain("<document>");
      expect(result).toContain("</document>");
    });

    it("should format with markdown delimiters", () => {
      const result = formatContext("Test content", { delimiter: "markdown" });
      expect(result).toContain("# Context");
      expect(result).toContain("Test content");
    });

    it("should format with bracket delimiters", () => {
      const result = formatContext("Test content", { delimiter: "brackets" });
      expect(result).toContain("[CONTEXT]");
      expect(result).toContain("=".repeat(20));
      expect(result).toContain("Test content");
    });

    it("should format with no delimiters", () => {
      const result = formatContext("Test content", { delimiter: "none" });
      expect(result).toBe("Test content");
    });

    it("should support custom delimiters", () => {
      const result = formatContext("Test content", {
        customDelimiterStart: "<<START>>",
        customDelimiterEnd: "<<END>>",
      });
      expect(result).toContain("<<START>>");
      expect(result).toContain("<<END>>");
      expect(result).toContain("Test content");
    });

    it("should return empty string for empty content", () => {
      expect(formatContext("")).toBe("");
      expect(formatContext("   ")).toBe("");
    });

    it("should normalize whitespace by default", () => {
      const result = formatContext("Test   content\n\n\nwith   spaces");
      expect(result).not.toContain("   ");
    });

    it("should skip normalization when disabled", () => {
      const result = formatContext("Test   content", { normalize: false });
      expect(result).toContain("Test   content");
    });

    it("should handle multi-line content", () => {
      const content = "Line 1\nLine 2\nLine 3";
      const result = formatContext(content);
      expect(result).toContain("Line 1");
      expect(result).toContain("Line 2");
      expect(result).toContain("Line 3");
    });
  });

  describe("formatMultipleContexts", () => {
    it("should format multiple contexts", () => {
      const result = formatMultipleContexts([
        { content: "Content 1", label: "Doc1" },
        { content: "Content 2", label: "Doc2" },
      ]);
      expect(result).toContain("<doc1>");
      expect(result).toContain("Content 1");
      expect(result).toContain("<doc2>");
      expect(result).toContain("Content 2");
    });

    it("should filter out empty content", () => {
      const result = formatMultipleContexts([
        { content: "Content 1", label: "Doc1" },
        { content: "", label: "Doc2" },
        { content: "Content 3", label: "Doc3" },
      ]);
      expect(result).toContain("Content 1");
      expect(result).not.toContain("<doc2>");
      expect(result).toContain("Content 3");
    });

    it("should use default label when not provided", () => {
      const result = formatMultipleContexts([
        { content: "Content 1" },
        { content: "Content 2" },
      ]);
      expect(result).toContain("<context>");
    });

    it("should apply options to all contexts", () => {
      const result = formatMultipleContexts(
        [{ content: "Content 1" }, { content: "Content 2" }],
        { delimiter: "markdown" },
      );
      expect(result).toContain("# Context");
    });
  });

  describe("formatDocument", () => {
    it("should format document with metadata", () => {
      const result = formatDocument("Document content", {
        title: "Test Doc",
        author: "John Doe",
      });
      expect(result).toContain("title: Test Doc");
      expect(result).toContain("author: John Doe");
      expect(result).toContain("Document content");
    });

    it("should work without metadata", () => {
      const result = formatDocument("Document content");
      expect(result).toContain("Document content");
      expect(result).toContain("<document>");
    });

    it("should use title from metadata as label", () => {
      const result = formatDocument("Content", { title: "My Title" });
      expect(result).toContain("<my_title>");
    });

    it("should filter out empty metadata values", () => {
      const result = formatDocument("Content", {
        title: "Test",
        author: "",
        date: "2024",
      });
      expect(result).toContain("title: Test");
      expect(result).toContain("date: 2024");
      expect(result).not.toContain("author:");
    });

    it("should return empty string for empty content", () => {
      expect(formatDocument("")).toBe("");
      expect(formatDocument("   ", { title: "Test" })).toBe("");
    });
  });

  describe("formatInstructions", () => {
    it("should format instructions with default label", () => {
      const result = formatInstructions("Do this task");
      expect(result).toContain("<instructions>");
      expect(result).toContain("Do this task");
      expect(result).toContain("</instructions>");
    });

    it("should allow custom options", () => {
      const result = formatInstructions("Do this task", {
        delimiter: "markdown",
      });
      expect(result).toContain("# Instructions");
    });
  });

  describe("escapeDelimiters", () => {
    it("should escape XML delimiters", () => {
      const result = escapeDelimiters("<tag>content</tag>", "xml");
      expect(result).toBe("&lt;tag&gt;content&lt;/tag&gt;");
    });

    it("should escape markdown headers", () => {
      const result = escapeDelimiters("# Header\n## Subheader", "markdown");
      expect(result).toContain("\\#");
    });

    it("should escape brackets", () => {
      const result = escapeDelimiters("[content]", "brackets");
      expect(result).toBe("\\[content\\]");
    });

    it("should handle empty strings", () => {
      expect(escapeDelimiters("", "xml")).toBe("");
    });

    it("should default to XML escaping", () => {
      const result = escapeDelimiters("<tag>");
      expect(result).toBe("&lt;tag&gt;");
    });
  });

  describe("unescapeDelimiters", () => {
    it("should unescape XML delimiters", () => {
      const result = unescapeDelimiters("&lt;tag&gt;", "xml");
      expect(result).toBe("<tag>");
    });

    it("should unescape markdown headers", () => {
      const result = unescapeDelimiters("\\# Header", "markdown");
      expect(result).toBe("# Header");
    });

    it("should unescape brackets", () => {
      const result = unescapeDelimiters("\\[content\\]", "brackets");
      expect(result).toBe("[content]");
    });

    it("should handle empty strings", () => {
      expect(unescapeDelimiters("", "xml")).toBe("");
    });
  });
});

// ============================================================================
// Memory Formatting Tests
// ============================================================================

describe("Memory Formatting", () => {
  describe("formatMemory", () => {
    it("should format conversational style by default", () => {
      const memory = [
        { role: "user" as const, content: "Hello" },
        { role: "assistant" as const, content: "Hi there!" },
      ];
      const result = formatMemory(memory);
      expect(result).toContain("User: Hello");
      expect(result).toContain("Assistant: Hi there!");
    });

    it("should format structured style", () => {
      const memory = [
        { role: "user" as const, content: "Hello" },
        { role: "assistant" as const, content: "Hi there!" },
      ];
      const result = formatMemory(memory, { style: "structured" });
      expect(result).toContain("<conversation_history>");
      expect(result).toContain('role="user"');
      expect(result).toContain('role="assistant"');
    });

    it("should format compact style", () => {
      const memory = [
        { role: "user" as const, content: "Hello" },
        { role: "assistant" as const, content: "Hi there!" },
      ];
      const result = formatMemory(memory, { style: "compact" });
      expect(result).toContain("U: Hello");
      expect(result).toContain("A: Hi there!");
    });

    it("should include timestamps when requested", () => {
      const memory = [
        { role: "user" as const, content: "Hello", timestamp: 1000000 },
      ];
      const result = formatMemory(memory, { includeTimestamps: true });
      expect(result).toContain("[");
      expect(result).toContain("]");
    });

    it("should include metadata when requested", () => {
      const memory = [
        {
          role: "user" as const,
          content: "Hello",
          metadata: { lang: "en" },
        },
      ];
      const result = formatMemory(memory, { includeMetadata: true });
      expect(result).toContain("lang=en");
    });

    it("should limit entries with maxEntries", () => {
      const memory = [
        { role: "user" as const, content: "Message 1" },
        { role: "user" as const, content: "Message 2" },
        { role: "user" as const, content: "Message 3" },
      ];
      const result = formatMemory(memory, { maxEntries: 2 });
      expect(result).not.toContain("Message 1");
      expect(result).toContain("Message 2");
      expect(result).toContain("Message 3");
    });

    it("should handle empty memory", () => {
      expect(formatMemory([])).toBe("");
    });

    it("should handle string input", () => {
      const result = formatMemory("Some memory string");
      expect(result).toContain("Some memory string");
    });

    it("should handle system messages", () => {
      const memory = [{ role: "system" as const, content: "System message" }];
      const result = formatMemory(memory);
      expect(result).toContain("System: System message");
    });
  });

  describe("createMemoryEntry", () => {
    it("should create memory entry with timestamp", () => {
      const entry = createMemoryEntry("user", "Hello");
      expect(entry.role).toBe("user");
      expect(entry.content).toBe("Hello");
      expect(entry.timestamp).toBeTypeOf("number");
    });

    it("should include metadata when provided", () => {
      const entry = createMemoryEntry("user", "Hello", { lang: "en" });
      expect(entry.metadata).toEqual({ lang: "en" });
    });
  });

  describe("mergeMemory", () => {
    it("should merge multiple memory arrays", () => {
      const memory1 = [{ role: "user" as const, content: "A", timestamp: 100 }];
      const memory2 = [{ role: "user" as const, content: "B", timestamp: 200 }];
      const merged = mergeMemory(memory1, memory2);
      expect(merged).toHaveLength(2);
      expect(merged[0]!.content).toBe("A");
      expect(merged[1]!.content).toBe("B");
    });

    it("should sort by timestamp", () => {
      const memory1 = [{ role: "user" as const, content: "B", timestamp: 200 }];
      const memory2 = [{ role: "user" as const, content: "A", timestamp: 100 }];
      const merged = mergeMemory(memory1, memory2);
      expect(merged[0]!.content).toBe("A");
      expect(merged[1]!.content).toBe("B");
    });

    it("should handle entries without timestamps", () => {
      const memory1 = [{ role: "user" as const, content: "A" }];
      const memory2 = [{ role: "user" as const, content: "B", timestamp: 100 }];
      const merged = mergeMemory(memory1, memory2);
      expect(merged).toHaveLength(2);
    });
  });

  describe("filterMemoryByRole", () => {
    it("should filter by user role", () => {
      const memory = [
        { role: "user" as const, content: "User message" },
        { role: "assistant" as const, content: "Assistant message" },
      ];
      const filtered = filterMemoryByRole(memory, "user");
      expect(filtered).toHaveLength(1);
      expect(filtered[0]!.role).toBe("user");
    });

    it("should filter by assistant role", () => {
      const memory = [
        { role: "user" as const, content: "User message" },
        { role: "assistant" as const, content: "Assistant message" },
      ];
      const filtered = filterMemoryByRole(memory, "assistant");
      expect(filtered).toHaveLength(1);
      expect(filtered[0]!.role).toBe("assistant");
    });
  });

  describe("getLastNEntries", () => {
    it("should return last N entries", () => {
      const memory = [
        { role: "user" as const, content: "1" },
        { role: "user" as const, content: "2" },
        { role: "user" as const, content: "3" },
        { role: "user" as const, content: "4" },
      ];
      const last2 = getLastNEntries(memory, 2);
      expect(last2).toHaveLength(2);
      expect(last2[0]!.content).toBe("3");
      expect(last2[1]!.content).toBe("4");
    });

    it("should return all entries if N is larger", () => {
      const memory = [
        { role: "user" as const, content: "1" },
        { role: "user" as const, content: "2" },
      ];
      const result = getLastNEntries(memory, 10);
      expect(result).toHaveLength(2);
    });
  });

  describe("calculateMemorySize", () => {
    it("should calculate total character count", () => {
      const memory = [
        { role: "user" as const, content: "Hello" }, // 5 chars
        { role: "user" as const, content: "World" }, // 5 chars
      ];
      const size = calculateMemorySize(memory);
      expect(size).toBe(10);
    });

    it("should return 0 for empty memory", () => {
      expect(calculateMemorySize([])).toBe(0);
    });
  });

  describe("truncateMemory", () => {
    it("should truncate to fit size limit", () => {
      const memory = [
        { role: "user" as const, content: "A".repeat(100) },
        { role: "user" as const, content: "B".repeat(100) },
        { role: "user" as const, content: "C".repeat(100) },
      ];
      const truncated = truncateMemory(memory, 250);
      expect(truncated).toHaveLength(2);
      expect(calculateMemorySize(truncated)).toBeLessThanOrEqual(250);
    });

    it("should keep most recent entries", () => {
      const memory = [
        { role: "user" as const, content: "Old message" },
        { role: "user" as const, content: "Recent" },
      ];
      const truncated = truncateMemory(memory, 8);
      expect(truncated).toHaveLength(1);
      expect(truncated[0]!.content).toBe("Recent");
    });

    it("should return empty array if size is too small", () => {
      const memory = [{ role: "user" as const, content: "Hello" }];
      const truncated = truncateMemory(memory, 2);
      expect(truncated).toHaveLength(0);
    });
  });
});

// ============================================================================
// Output Formatting Tests
// ============================================================================

describe("Output Formatting", () => {
  describe("formatJsonOutput", () => {
    it("should format strict JSON instructions", () => {
      const result = formatJsonOutput({ strict: true });
      expect(result).toContain("valid JSON only");
      expect(result).toContain("Do not include any text");
      expect(result).toContain("Start your response with {");
    });

    it("should format non-strict instructions", () => {
      const result = formatJsonOutput({ strict: false });
      expect(result).toContain("valid JSON");
      expect(result).not.toContain("Do not include any text");
    });

    it("should include schema when provided", () => {
      const result = formatJsonOutput({ schema: '{ "name": "string" }' });
      expect(result).toContain("Expected JSON schema:");
      expect(result).toContain('"name": "string"');
    });

    it("should include example when provided", () => {
      const result = formatJsonOutput({ example: '{"name": "John"}' });
      expect(result).toContain("Example output:");
      expect(result).toContain('{"name": "John"}');
    });

    it("should work with no options", () => {
      const result = formatJsonOutput();
      expect(result).toContain("valid JSON");
    });
  });

  describe("formatStructuredOutput", () => {
    it("should format JSON output", () => {
      const result = formatStructuredOutput("json");
      expect(result).toContain("valid JSON");
    });

    it("should format YAML output", () => {
      const result = formatStructuredOutput("yaml");
      expect(result).toContain("valid YAML");
    });

    it("should format XML output", () => {
      const result = formatStructuredOutput("xml");
      expect(result).toContain("valid XML");
    });

    it("should format Markdown output", () => {
      const result = formatStructuredOutput("markdown");
      expect(result).toContain("Markdown");
    });

    it("should format plain text output", () => {
      const result = formatStructuredOutput("plain");
      expect(result).toContain("plain text");
    });

    it("should handle strict mode for different formats", () => {
      const result = formatStructuredOutput("yaml", { strict: true });
      expect(result).toContain("Do not include any text before or after");
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
      const result = formatOutputConstraints({ tone: "formal" });
      expect(result).toContain("formal tone");
    });

    it("should handle multiple constraints", () => {
      const result = formatOutputConstraints({
        maxLength: 100,
        noCodeBlocks: true,
        tone: "casual",
      });
      expect(result).toContain("under 100 characters");
      expect(result).toContain("Do not use code blocks");
      expect(result).toContain("casual tone");
    });
  });

  describe("createOutputFormatSection", () => {
    it("should create complete format section", () => {
      const result = createOutputFormatSection("json");
      expect(result).toContain("<output_format>");
      expect(result).toContain("</output_format>");
      expect(result).toContain("valid JSON");
    });

    it("should include constraints when provided", () => {
      const result = createOutputFormatSection("json", {
        constraints: { maxLength: 100 },
      });
      expect(result).toContain("under 100 characters");
    });

    it("should allow unwrapped output", () => {
      const result = createOutputFormatSection("json", { wrap: false });
      expect(result).not.toContain("<output_format>");
      expect(result).toContain("valid JSON");
    });
  });

  describe("extractJsonFromOutput", () => {
    it("should extract JSON from code block", () => {
      const output = '```json\n{"name": "test"}\n```';
      const result = extractJsonFromOutput(output);
      expect(result).toBe('{"name": "test"}');
    });

    it("should extract JSON from plain code block", () => {
      const output = '```\n{"name": "test"}\n```';
      const result = extractJsonFromOutput(output);
      expect(result).toBe('{"name": "test"}');
    });

    it("should extract JSON object from text", () => {
      const output = 'Here is the result: {"name": "test"} done';
      const result = extractJsonFromOutput(output);
      expect(result).toBe('{"name": "test"}');
    });

    it("should extract JSON array from text", () => {
      const output = "Here is the list: [1, 2, 3] done";
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
      expect(cleanOutput("Here is the answer: test")).toContain("test");
      expect(cleanOutput("Here's the result: test")).toContain("test");
      expect(cleanOutput("Sure, test")).toContain("test");
      expect(cleanOutput("Certainly test")).toContain("test");
      expect(cleanOutput("Of course, test")).toContain("test");
    });

    it("should remove markdown code blocks", () => {
      const result = cleanOutput("```json\ntest\n```");
      expect(result).toBe("test");
    });

    it("should remove code blocks with language", () => {
      const result = cleanOutput("```javascript\ntest\n```");
      expect(result).toBe("test");
    });

    it("should handle empty input", () => {
      expect(cleanOutput("")).toBe("");
    });

    it("should trim whitespace", () => {
      expect(cleanOutput("  test  ")).toBe("test");
    });
  });
});

// ============================================================================
// Tools Formatting Tests
// ============================================================================

describe("Tools Formatting", () => {
  const testTool = {
    name: "get_weather",
    description: "Get current weather",
    parameters: [
      {
        name: "location",
        type: "string",
        required: true,
        description: "City name",
      },
      {
        name: "units",
        type: "string",
        required: false,
        enum: ["celsius", "fahrenheit"],
      },
    ],
  };

  describe("formatTool", () => {
    it("should format tool as JSON schema by default", () => {
      const result = formatTool(testTool);
      const parsed = JSON.parse(result);
      expect(parsed.name).toBe("get_weather");
      expect(parsed.description).toBe("Get current weather");
      expect(parsed.parameters.type).toBe("object");
      expect(parsed.parameters.properties.location).toBeDefined();
    });

    it("should format tool as TypeScript", () => {
      const result = formatTool(testTool, { style: "typescript" });
      expect(result).toContain("function get_weather");
      expect(result).toContain("location: string");
      expect(result).toContain("units?: string");
    });

    it("should format tool as natural language", () => {
      const result = formatTool(testTool, { style: "natural" });
      expect(result).toContain("Tool: get_weather");
      expect(result).toContain("Description: Get current weather");
      expect(result).toContain("location (required)");
      expect(result).toContain("units (optional)");
    });

    it("should format tool as XML", () => {
      const result = formatTool(testTool, { style: "xml" });
      expect(result).toContain('<tool name="get_weather">');
      expect(result).toContain(
        "<description>Get current weather</description>",
      );
      expect(result).toContain('name="location"');
    });

    it("should include examples in natural format", () => {
      const result = formatTool(testTool, {
        style: "natural",
        includeExamples: true,
      });
      expect(result).toContain("Example usage:");
      expect(result).toContain("get_weather");
    });

    it("should handle enum values", () => {
      const result = formatTool(testTool);
      const parsed = JSON.parse(result);
      expect(parsed.parameters.properties.units.enum).toEqual([
        "celsius",
        "fahrenheit",
      ]);
    });

    it("should handle required parameters", () => {
      const result = formatTool(testTool);
      const parsed = JSON.parse(result);
      expect(parsed.parameters.required).toContain("location");
      expect(parsed.parameters.required).not.toContain("units");
    });

    it("should include types by default in JSON schema", () => {
      const result = formatTool(testTool, { style: "json-schema" });
      const parsed = JSON.parse(result);
      expect(parsed.parameters.properties.location.type).toBe("string");
      expect(parsed.parameters.properties.units.type).toBe("string");
    });

    it("should include types when includeTypes is true", () => {
      const result = formatTool(testTool, {
        style: "json-schema",
        includeTypes: true,
      });
      const parsed = JSON.parse(result);
      expect(parsed.parameters.properties.location.type).toBe("string");
      expect(parsed.parameters.properties.units.type).toBe("string");
    });

    it("should omit types when includeTypes is false", () => {
      const result = formatTool(testTool, {
        style: "json-schema",
        includeTypes: false,
      });
      const parsed = JSON.parse(result);
      expect(parsed.parameters.properties.location.type).toBeUndefined();
      expect(parsed.parameters.properties.units.type).toBeUndefined();
      // Other properties should still be present
      expect(parsed.parameters.properties.location.description).toBeDefined();
      expect(parsed.parameters.properties.units.enum).toEqual([
        "celsius",
        "fahrenheit",
      ]);
    });
  });

  describe("formatTools", () => {
    it("should format multiple tools as JSON schema", () => {
      const tools = [testTool, { ...testTool, name: "get_forecast" }];
      const result = formatTools(tools);
      const parsed = JSON.parse(result);
      expect(parsed).toHaveLength(2);
      expect(parsed[0].name).toBe("get_weather");
      expect(parsed[1].name).toBe("get_forecast");
    });

    it("should format multiple tools in natural language", () => {
      const tools = [testTool, { ...testTool, name: "get_forecast" }];
      const result = formatTools(tools, { style: "natural" });
      expect(result).toContain("Tool: get_weather");
      expect(result).toContain("Tool: get_forecast");
      expect(result).toContain("=".repeat(50));
    });
  });

  describe("createTool", () => {
    it("should create tool definition", () => {
      const tool = createTool("test_tool", "A test tool", [
        { name: "param1", type: "string", required: true },
      ]);
      expect(tool.name).toBe("test_tool");
      expect(tool.description).toBe("A test tool");
      expect(tool.parameters).toHaveLength(1);
    });
  });

  describe("createParameter", () => {
    it("should create parameter with required fields", () => {
      const param = createParameter("test", "string");
      expect(param.name).toBe("test");
      expect(param.type).toBe("string");
      expect(param.required).toBe(false);
    });

    it("should create required parameter", () => {
      const param = createParameter("test", "string", "Test param", true);
      expect(param.required).toBe(true);
      expect(param.description).toBe("Test param");
    });
  });

  describe("validateTool", () => {
    it("should validate valid tool", () => {
      const errors = validateTool(testTool);
      expect(errors).toHaveLength(0);
    });

    it("should detect missing name", () => {
      const invalid = { ...testTool, name: "" };
      const errors = validateTool(invalid);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors.some((e) => e.includes("name is required"))).toBe(true);
    });

    it("should detect invalid name format", () => {
      const invalid = { ...testTool, name: "invalid-name" };
      const errors = validateTool(invalid);
      expect(errors.some((e) => e.includes("valid identifier"))).toBe(true);
    });

    it("should detect missing description", () => {
      const invalid = { ...testTool, description: "" };
      const errors = validateTool(invalid);
      expect(errors.some((e) => e.includes("description is required"))).toBe(
        true,
      );
    });

    it("should detect invalid parameter type", () => {
      const invalid = {
        ...testTool,
        parameters: [{ name: "test", type: "invalid", required: false }],
      };
      const errors = validateTool(invalid);
      expect(errors.some((e) => e.includes("invalid type"))).toBe(true);
    });

    it("should detect missing parameter name", () => {
      const invalid = {
        ...testTool,
        parameters: [{ name: "", type: "string", required: false }],
      };
      const errors = validateTool(invalid);
      expect(errors.some((e) => e.includes("missing a name"))).toBe(true);
    });
  });

  describe("formatFunctionArguments", () => {
    it("should format arguments as JSON", () => {
      const result = formatFunctionArguments({
        location: "NYC",
        units: "celsius",
      });
      expect(result).toBe('{"location":"NYC","units":"celsius"}');
    });

    it("should pretty-print when requested", () => {
      const result = formatFunctionArguments({ location: "NYC" }, true);
      expect(result).toContain("\n");
      expect(result).toContain("  ");
    });

    it("should handle empty arguments", () => {
      const result = formatFunctionArguments({});
      expect(result).toBe("{}");
    });
  });

  describe("parseFunctionCall", () => {
    it("should parse JSON format function call", () => {
      const output =
        '{"name": "get_weather", "arguments": {"location": "NYC"}}';
      const result = parseFunctionCall(output);
      expect(result).not.toBeNull();
      expect(result?.name).toBe("get_weather");
      expect(result?.arguments.location).toBe("NYC");
    });

    it("should parse function call format", () => {
      const output = 'get_weather({"location": "NYC"})';
      const result = parseFunctionCall(output);
      expect(result).not.toBeNull();
      expect(result?.name).toBe("get_weather");
      expect(result?.arguments.location).toBe("NYC");
    });

    it("should return null for invalid format", () => {
      const result = parseFunctionCall("not a function call");
      expect(result).toBeNull();
    });

    it("should return null for malformed JSON", () => {
      const output = "get_weather({invalid json})";
      const result = parseFunctionCall(output);
      expect(result).toBeNull();
    });
  });
});

// ============================================================================
// Utility Functions Tests
// ============================================================================

describe("Utility Functions", () => {
  describe("trim", () => {
    it("should trim whitespace", () => {
      expect(trim("  hello  ")).toBe("hello");
      expect(trim("\n\thello\n\t")).toBe("hello");
    });

    it("should handle empty strings", () => {
      expect(trim("")).toBe("");
      expect(trim("   ")).toBe("");
    });

    it("should not modify strings without whitespace", () => {
      expect(trim("hello")).toBe("hello");
    });
  });

  describe("escape", () => {
    it("should escape backslashes", () => {
      expect(escape("path\\to\\file")).toBe("path\\\\to\\\\file");
    });

    it("should escape quotes", () => {
      expect(escape('"hello"')).toBe('\\"hello\\"');
      expect(escape("'hello'")).toBe("\\'hello\\'");
    });

    it("should escape newlines and control characters", () => {
      expect(escape("line1\nline2")).toBe("line1\\nline2");
      expect(escape("tab\there")).toBe("tab\\there");
      expect(escape("return\rhere")).toBe("return\\rhere");
    });

    it("should handle empty strings", () => {
      expect(escape("")).toBe("");
    });

    it("should escape multiple special characters", () => {
      expect(escape('hello\n"world"')).toBe('hello\\n\\"world\\"');
    });
  });

  describe("unescape", () => {
    it("should unescape backslashes", () => {
      expect(unescape("path\\\\to\\\\file")).toBe("path\\to\\file");
    });

    it("should unescape quotes", () => {
      expect(unescape('\\"hello\\"')).toBe('"hello"');
      expect(unescape("\\'hello\\'")).toBe("'hello'");
    });

    it("should unescape control characters", () => {
      expect(unescape("line1\\nline2")).toBe("line1\nline2");
      expect(unescape("tab\\there")).toBe("tab\there");
      expect(unescape("return\\rhere")).toBe("return\rhere");
    });

    it("should be inverse of escape", () => {
      const original = 'test\n"string"\twith\\special';
      expect(unescape(escape(original))).toBe(original);
    });
  });

  describe("escapeHtml", () => {
    it("should escape HTML entities", () => {
      expect(escapeHtml("<div>")).toBe("&lt;div&gt;");
      expect(escapeHtml("a & b")).toBe("a &amp; b");
      expect(escapeHtml('"quoted"')).toBe("&quot;quoted&quot;");
      expect(escapeHtml("'single'")).toBe("&#39;single&#39;");
    });

    it("should handle multiple entities", () => {
      expect(escapeHtml('<a href="test">Link & More</a>')).toBe(
        "&lt;a href=&quot;test&quot;&gt;Link &amp; More&lt;/a&gt;",
      );
    });

    it("should handle empty strings", () => {
      expect(escapeHtml("")).toBe("");
    });
  });

  describe("unescapeHtml", () => {
    it("should unescape HTML entities", () => {
      expect(unescapeHtml("&lt;div&gt;")).toBe("<div>");
      expect(unescapeHtml("a &amp; b")).toBe("a & b");
      expect(unescapeHtml("&quot;quoted&quot;")).toBe('"quoted"');
      expect(unescapeHtml("&#39;single&#39;")).toBe("'single'");
    });

    it("should be inverse of escapeHtml", () => {
      const original = '<div class="test">A & B</div>';
      expect(unescapeHtml(escapeHtml(original))).toBe(original);
    });
  });

  describe("escapeRegex", () => {
    it("should escape regex special characters", () => {
      expect(escapeRegex(".*+?")).toBe("\\.\\*\\+\\?");
      expect(escapeRegex("^${}()|[]\\")).toBe(
        "\\^\\$\\{\\}\\(\\)\\|\\[\\]\\\\",
      );
    });

    it("should not modify regular text", () => {
      expect(escapeRegex("hello world")).toBe("hello world");
    });

    it("should handle empty strings", () => {
      expect(escapeRegex("")).toBe("");
    });
  });

  describe("sanitize", () => {
    it("should remove control characters", () => {
      const withControl = "hello\x00\x01\x02world";
      expect(sanitize(withControl)).toBe("helloworld");
    });

    it("should preserve newlines and tabs", () => {
      expect(sanitize("hello\nworld\ttab")).toBe("hello\nworld\ttab");
    });

    it("should handle empty strings", () => {
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
      expect(truncate("hello world", 8, "…")).toBe("hello w…");
    });

    it("should handle exact length", () => {
      expect(truncate("hello", 5)).toBe("hello");
    });

    it("should handle empty strings", () => {
      expect(truncate("", 10)).toBe("");
    });
  });

  describe("truncateWords", () => {
    it("should truncate at word boundary", () => {
      expect(truncateWords("hello world test", 12)).toBe("hello...");
    });

    it("should not truncate short strings", () => {
      expect(truncateWords("hello", 10)).toBe("hello");
    });

    it("should use custom suffix", () => {
      expect(truncateWords("hello world test", 12, "…")).toBe("hello…");
    });

    it("should fallback to character truncate if no space", () => {
      const result = truncateWords("verylongwordwithoutspaces", 10);
      expect(result.length).toBeLessThanOrEqual(10);
    });

    it("should handle empty strings", () => {
      expect(truncateWords("", 10)).toBe("");
    });
  });

  describe("wrap", () => {
    it("should wrap text to specified width", () => {
      const result = wrap("hello world test message", 12);
      const lines = result.split("\n");
      expect(lines.length).toBeGreaterThan(1);
      expect(lines.every((line) => line.length <= 12)).toBe(true);
    });

    it("should not wrap short text", () => {
      expect(wrap("hello", 20)).toBe("hello");
    });

    it("should handle empty strings", () => {
      expect(wrap("", 10)).toBe("");
    });

    it("should preserve existing newlines", () => {
      const result = wrap("hello world", 20);
      expect(result).toBe("hello world");
    });
  });

  describe("pad", () => {
    it("should pad left by default", () => {
      expect(pad("hello", 10)).toBe("hello     ");
    });

    it("should pad right", () => {
      expect(pad("hello", 10, " ", "right")).toBe("     hello");
    });

    it("should pad center", () => {
      const result = pad("hello", 11, " ", "center");
      expect(result).toBe("   hello   ");
      expect(result.length).toBe(11);
    });

    it("should not pad if already long enough", () => {
      expect(pad("hello", 5)).toBe("hello");
      expect(pad("hello world", 5)).toBe("hello world");
    });

    it("should use custom padding character", () => {
      expect(pad("hello", 10, "*")).toBe("hello*****");
    });

    it("should handle empty strings", () => {
      expect(pad("", 5)).toBe("     ");
    });
  });

  describe("removeAnsi", () => {
    it("should remove ANSI color codes", () => {
      const colored = "\x1b[31mRed text\x1b[0m";
      expect(removeAnsi(colored)).toBe("Red text");
    });

    it("should remove multiple ANSI codes", () => {
      const colored = "\x1b[1m\x1b[31mBold Red\x1b[0m\x1b[0m";
      expect(removeAnsi(colored)).toBe("Bold Red");
    });

    it("should not modify text without ANSI codes", () => {
      expect(removeAnsi("plain text")).toBe("plain text");
    });

    it("should handle empty strings", () => {
      expect(removeAnsi("")).toBe("");
    });

    it("should handle complex ANSI sequences", () => {
      const colored = "\x1b[38;5;214mOrange\x1b[0m";
      expect(removeAnsi(colored)).toBe("Orange");
    });
  });
});
