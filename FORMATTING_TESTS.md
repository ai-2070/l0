# Formatting Tests Documentation

## Overview

Comprehensive test suite for L0's formatting utilities, covering context formatting, memory management, output formatting, tool definitions, and utility functions.

## Test Coverage Summary

**Total Tests:** 158 (100% passing ✅)

| Category | Tests | Description |
|----------|-------|-------------|
| Context Formatting | 30 | XML/Markdown/Bracket delimiters, documents, instructions |
| Memory Formatting | 23 | Conversational/structured/compact styles, history management |
| Output Formatting | 32 | JSON/YAML/XML/Markdown/plain, constraints, extraction |
| Tools Formatting | 25 | JSON schema, TypeScript, natural language, XML |
| Utility Functions | 48 | Escaping, sanitization, truncation, padding, ANSI removal |

## Module Details

### 1. Context Formatting (30 tests)

**Purpose:** Format context, documents, and instructions with proper delimiters and normalization.

**Key Functions Tested:**
- `formatContext()` - Format content with XML, Markdown, or Bracket delimiters
- `formatMultipleContexts()` - Format multiple context items
- `formatDocument()` - Format documents with metadata
- `formatInstructions()` - Format instructions with clear boundaries
- `escapeDelimiters()` / `unescapeDelimiters()` - Prevent injection attacks

**Test Coverage:**
```typescript
✓ XML delimiters: <context>content</context>
✓ Markdown delimiters: # Context
✓ Bracket delimiters: [CONTEXT] with separators
✓ Custom delimiters: <<START>>content<<END>>
✓ No delimiters (passthrough)
✓ Empty content handling
✓ Whitespace normalization
✓ Multi-line content
✓ Metadata handling (title, author, date)
✓ Delimiter escaping for security
```

**Example Usage:**
```typescript
const context = formatContext("User manual content", {
  label: "Documentation",
  delimiter: "xml"
});
// <documentation>
// User manual content
// </documentation>
```

### 2. Memory Formatting (23 tests)

**Purpose:** Format conversation history in model-friendly ways.

**Key Functions Tested:**
- `formatMemory()` - Format memory in conversational/structured/compact styles
- `createMemoryEntry()` - Create timestamped memory entries
- `mergeMemory()` - Merge and sort multiple memory arrays
- `filterMemoryByRole()` - Filter by user/assistant/system
- `getLastNEntries()` - Get recent entries
- `calculateMemorySize()` - Calculate character count
- `truncateMemory()` - Truncate to fit size limits

**Test Coverage:**
```typescript
✓ Conversational style: "User: Hello\nAssistant: Hi!"
✓ Structured style: <conversation_history><message>...</message></conversation_history>
✓ Compact style: "U: Hello\nA: Hi!"
✓ Timestamp inclusion
✓ Metadata inclusion
✓ Entry limiting (maxEntries)
✓ Role filtering
✓ Size-based truncation
✓ Memory merging with timestamp sorting
```

**Example Usage:**
```typescript
const memory = formatMemory([
  { role: "user", content: "Hello" },
  { role: "assistant", content: "Hi there!" }
], { style: "conversational" });
// User: Hello
//
// Assistant: Hi there!
```

### 3. Output Formatting (32 tests)

**Purpose:** Generate instructions for requesting specific output formats from models.

**Key Functions Tested:**
- `formatJsonOutput()` - JSON-only output instructions
- `formatStructuredOutput()` - Format instructions for JSON/YAML/XML/Markdown/plain
- `formatOutputConstraints()` - Length, language, tone constraints
- `createOutputFormatSection()` - Complete format section with constraints
- `extractJsonFromOutput()` - Extract JSON from model output
- `cleanOutput()` - Remove common prefix text and markdown wrappers

**Test Coverage:**
```typescript
✓ Strict JSON instructions (no extra text)
✓ Non-strict JSON instructions
✓ Schema inclusion
✓ Example inclusion
✓ YAML/XML/Markdown/plain text formats
✓ Max/min length constraints
✓ No code blocks/markdown constraints
✓ Language and tone constraints
✓ Multiple constraints combination
✓ JSON extraction from code blocks
✓ JSON extraction from text
✓ Common prefix removal ("Here is...", "Sure,", etc.)
```

**Example Usage:**
```typescript
const instruction = formatJsonOutput({ 
  strict: true,
  schema: '{ "name": "string", "age": "number" }'
});
// Respond with valid JSON only. Do not include any text before or after...
// Expected JSON schema:
// { "name": "string", "age": "number" }
```

### 4. Tools Formatting (25 tests)

**Purpose:** Format tool/function definitions for LLM consumption.

**Key Functions Tested:**
- `formatTool()` - Format tool in JSON schema/TypeScript/natural/XML
- `formatTools()` - Format multiple tools
- `createTool()` - Create tool definition
- `createParameter()` - Create parameter definition
- `validateTool()` - Validate tool structure
- `formatFunctionArguments()` - Format arguments as JSON
- `parseFunctionCall()` - Parse function calls from output

**Test Coverage:**
```typescript
✓ JSON schema format (OpenAI function calling)
✓ TypeScript function signature format
✓ Natural language format
✓ XML format
✓ Required/optional parameters
✓ Enum values
✓ Default values
✓ Multiple tools formatting
✓ Tool validation (name, description, parameter types)
✓ Function call parsing (JSON and function formats)
```

**Example Usage:**
```typescript
const tool = createTool("get_weather", "Get current weather", [
  { name: "location", type: "string", required: true },
  { name: "units", type: "string", enum: ["celsius", "fahrenheit"] }
]);

const formatted = formatTool(tool, { style: "json-schema" });
// {
//   "name": "get_weather",
//   "description": "Get current weather",
//   "parameters": {
//     "type": "object",
//     "properties": { ... },
//     "required": ["location"]
//   }
// }
```

### 5. Utility Functions (48 tests)

**Purpose:** String manipulation, escaping, and formatting utilities.

**Key Functions Tested:**
- `trim()` - Trim whitespace
- `escape()` / `unescape()` - Escape special characters
- `escapeHtml()` / `unescapeHtml()` - HTML entity escaping
- `escapeRegex()` - Escape regex special characters
- `sanitize()` - Remove control characters
- `truncate()` / `truncateWords()` - Truncate with suffix
- `wrap()` - Wrap text to width
- `pad()` - Pad string (left/right/center)
- `removeAnsi()` - Remove ANSI color codes

**Test Coverage:**
```typescript
✓ Whitespace trimming
✓ Backslash escaping (proper order handling)
✓ Quote escaping (" and ')
✓ Newline/tab/carriage return escaping
✓ HTML entity escaping (<, >, &, ", ')
✓ Regex special character escaping
✓ Control character removal (preserving \n and \t)
✓ Character and word-boundary truncation
✓ Custom suffix support
✓ Text wrapping to width
✓ Left/right/center padding
✓ Custom padding characters
✓ ANSI color code removal (simple and complex sequences)
```

**Example Usage:**
```typescript
// Escaping
const escaped = escape('path\to\file');  // "path\\to\\file"
const htmlSafe = escapeHtml('<div>');     // "&lt;div&gt;"

// Truncation
const short = truncate("hello world test", 12);      // "hello..."
const wordBound = truncateWords("hello world", 8);   // "hello..."

// Padding
const padded = pad("hello", 10, " ", "center");      // "  hello   "

// Wrapping
const wrapped = wrap("hello world test message", 12);
// "hello world
//  test message"
```

## Edge Cases Covered

### Security
- ✅ Delimiter injection prevention
- ✅ HTML entity escaping
- ✅ Control character sanitization

### Unicode & Encoding
- ✅ Unicode content handling
- ✅ Zero-width characters
- ✅ Mixed language content
- ✅ Special unicode punctuation

### Performance
- ✅ Very long content handling
- ✅ Empty string handling
- ✅ Null/undefined handling

### Escaping Edge Cases
- ✅ Proper backslash escape order (prevents `\\t` → tab conversion)
- ✅ Nested escaping
- ✅ Escape/unescape round-trip consistency

## Running the Tests

```bash
# Run formatting tests only
npm test -- format.test.ts

# Run with coverage
npm run test:coverage -- format.test.ts

# Watch mode
npm run test:watch -- format.test.ts

# Interactive UI
npm run test:ui
```

## Test Organization

```
tests/format.test.ts
├── Context Formatting (30 tests)
│   ├── formatContext (10)
│   ├── formatMultipleContexts (4)
│   ├── formatDocument (5)
│   ├── formatInstructions (2)
│   ├── escapeDelimiters (5)
│   └── unescapeDelimiters (4)
├── Memory Formatting (23 tests)
│   ├── formatMemory (9)
│   ├── createMemoryEntry (2)
│   ├── mergeMemory (3)
│   ├── filterMemoryByRole (2)
│   ├── getLastNEntries (2)
│   ├── calculateMemorySize (2)
│   └── truncateMemory (3)
├── Output Formatting (32 tests)
│   ├── formatJsonOutput (5)
│   ├── formatStructuredOutput (6)
│   ├── formatOutputConstraints (7)
│   ├── createOutputFormatSection (3)
│   ├── extractJsonFromOutput (6)
│   └── cleanOutput (5)
├── Tools Formatting (25 tests)
│   ├── formatTool (7)
│   ├── formatTools (2)
│   ├── createTool (1)
│   ├── createParameter (2)
│   ├── validateTool (6)
│   ├── formatFunctionArguments (3)
│   └── parseFunctionCall (4)
└── Utility Functions (48 tests)
    ├── trim (3)
    ├── escape (5)
    ├── unescape (4)
    ├── escapeHtml (3)
    ├── unescapeHtml (2)
    ├── escapeRegex (3)
    ├── sanitize (3)
    ├── truncate (5)
    ├── truncateWords (5)
    ├── wrap (4)
    ├── pad (6)
    └── removeAnsi (5)
```

## Integration with L0

These formatting utilities are used throughout L0 for:

1. **Context Preparation:** Safely wrapping user documents and instructions
2. **Memory Management:** Formatting conversation history for model context
3. **Output Validation:** Extracting and cleaning model outputs
4. **Tool Calling:** Formatting function definitions for models
5. **Prompt Engineering:** Building structured prompts with proper delimiters

## Quality Metrics

- **Test Coverage:** 100% (158/158 passing)
- **Edge Cases:** Comprehensive (empty, null, unicode, large content)
- **Security:** Injection prevention through escaping
- **Performance:** Efficient handling of large content
- **Maintainability:** Well-organized, documented test suites

## Future Enhancements

Potential areas for expansion:

- [ ] Internationalization (i18n) formatting
- [ ] Custom delimiter templates
- [ ] Advanced markdown parsing
- [ ] LaTeX formula formatting
- [ ] Code syntax formatting
- [ ] Table formatting utilities
- [ ] List formatting utilities
- [ ] Citation formatting

## Contributing

When adding new formatting utilities:

1. Add comprehensive tests covering:
   - Happy path scenarios
   - Edge cases (empty, null, unicode)
   - Security considerations
   - Performance with large inputs
2. Update this documentation
3. Ensure 100% test coverage
4. Add examples to function JSDoc comments

## References

- Main implementation: `src/format/`
- Test suite: `tests/format.test.ts`
- Type definitions: `src/format/index.ts`
- API documentation: `API.md`
