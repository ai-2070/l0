# Structured Output Tests Documentation

## Overview

Comprehensive test suite for L0's structured output functionality, covering JSON auto-correction, schema validation with Zod, retry logic, and real-world LLM output scenarios.

## Test Coverage Summary

**Total Tests:** 93 (100% passing ✅)

| Category | Tests | Description |
|----------|-------|-------------|
| Auto-Correction Utilities | 28 | JSON repair, validation, extraction |
| Structured Output Core | 31 | Schema validation, retries, callbacks |
| Helper Functions | 11 | structuredObject, structuredArray, structuredStream |
| Edge Cases | 16 | Unicode, large data, complex types |
| Performance | 2 | Concurrent validation, rapid execution |
| Real-World Scenarios | 5 | API responses, code analysis, entity extraction |

## Module Details

### 1. Auto-Correction Utilities (28 tests)

**Purpose:** Automatically fix common JSON formatting issues in LLM output.

**Key Functions Tested:**

#### `autoCorrectJSON()`
- Pass through valid JSON unchanged
- Remove markdown code fences (```json\n{}\n```)
- Close missing braces and brackets
- Remove trailing commas
- Strip "json" prefix
- Remove common LLM prefixes ("Here's the JSON:", "Sure,", etc.)
- Remove suffix text after closing brace
- Remove C-style comments (/* */ and //)
- Handle multiple corrections in sequence
- Respect configuration options (structural, stripFormatting)
- Handle deeply nested structures
- Handle arrays with missing brackets

#### `isValidJSON()`
- Validate JSON objects and arrays
- Validate JSON primitives (true, false, null, numbers, strings)
- Reject invalid JSON
- Reject empty strings

#### `safeJSONParse()`
- Parse valid JSON without correction
- Parse and auto-correct invalid JSON
- Throw for unparseable JSON
- Respect auto-correction options

#### `extractJSON()`
- Extract JSON object from mixed content
- Extract JSON array from text
- Return original if no JSON found
- Prefer object over array when both present
- Handle nested JSON structures

**Test Coverage:**
```typescript
✓ Structural fixes (close braces, brackets, remove trailing commas)
✓ Formatting cleanup (markdown fences, prefixes, suffixes)
✓ Comment removal (C-style /* */ and //)
✓ Deep nesting (4+ levels)
✓ Complex arrays and objects
✓ Configuration options respected
```

**Example Usage:**
```typescript
// Auto-correct malformed JSON
const result = autoCorrectJSON('{"name": "John"', {
  structural: true,
  stripFormatting: true
});
// result.corrected = '{"name": "John"}'
// result.success = true
// result.corrections = ['close_brace']

// Validate JSON
if (isValidJSON('{"valid": true}')) {
  // Process JSON
}

// Safe parsing with auto-correction
const { data, corrected, corrections } = safeJSONParse(
  '{"name": "John"' // Missing brace
);
// data = { name: "John" }
// corrected = true
```

### 2. Structured Output Core (31 tests)

**Purpose:** Validate LLM output against Zod schemas with automatic retry and correction.

**Key Functions Tested:**

#### `structured()`
- Parse valid JSON matching schema
- Auto-correct malformed JSON
- Handle arrays and nested objects
- Validate schema constraints (email, min/max, etc.)
- Support optional fields and default values
- Track state (validation failures, auto-corrections)
- Retry on validation failure
- Respect retry attempt limits
- Call callbacks (onValidationError, onAutoCorrect, onRetry)
- Handle error cases (empty output, whitespace, invalid JSON)
- Collect errors during retries
- Support strict mode and passthrough schemas
- Collect telemetry when enabled
- Provide abort functionality
- Handle abort signals

**Test Coverage:**
```typescript
✓ Basic Functionality (9 tests)
  ✓ Valid JSON with schema matching
  ✓ Auto-correction of malformed output
  ✓ Arrays and nested objects
  ✓ Schema validation (email, numbers, etc.)
  ✓ Optional and default fields
  ✓ State tracking

✓ Retry Logic (4 tests)
  ✓ Retry on validation failure
  ✓ Respect retry limits
  ✓ Callback invocation
  ✓ Attempt tracking

✓ Callbacks (3 tests)
  ✓ onValidationError called on failures
  ✓ onAutoCorrect called when corrections applied
  ✓ No callback when no corrections needed

✓ Error Handling (4 tests)
  ✓ Empty output detection
  ✓ Whitespace-only output
  ✓ Completely invalid JSON
  ✓ Error collection during retries

✓ Auto-Correction (4 tests)
  ✓ Disable when configured
  ✓ Enable by default
  ✓ Track correction types
  ✓ Handle multiple corrections

✓ Strict Mode (2 tests)
  ✓ Allow extra fields when not strict
  ✓ Work with passthrough schemas

✓ Telemetry (3 tests)
  ✓ Collect when enabled
  ✓ Not collect when disabled
  ✓ Track validation metrics

✓ Abort Handling (2 tests)
  ✓ Provide abort function
  ✓ Handle abort signal
```

**Example Usage:**
```typescript
import { structured } from 'l0';
import { z } from 'zod';

// Define schema
const schema = z.object({
  name: z.string(),
  age: z.number().min(0),
  email: z.string().email().optional()
});

// Validate LLM output
const result = await structured({
  schema,
  stream: () => streamText({ model, prompt }),
  autoCorrect: true,
  retry: { attempts: 2 },
  onValidationError: (error, attempt) => {
    console.log(`Validation failed (attempt ${attempt}):`, error);
  },
  onAutoCorrect: (info) => {
    console.log('Applied corrections:', info.corrections);
  }
});

console.log(result.data.name); // Typed!
console.log(result.corrected); // Was auto-correction applied?
console.log(result.corrections); // List of corrections
```

### 3. Helper Functions (11 tests)

**Purpose:** Simplified APIs for common structured output patterns.

#### `structuredObject()`
- Create structured output from shape definition
- Handle optional fields
- Apply auto-correction
- Provide typed results

#### `structuredArray()`
- Create structured array output
- Validate array items
- Handle empty arrays
- Auto-correct array output

#### `structuredStream()`
- Provide streaming and final result
- Yield tokens as they arrive
- Validate after stream completion
- Provide abort function

**Test Coverage:**
```typescript
✓ structuredObject (3 tests)
  ✓ Create from shape definition
  ✓ Handle optional fields
  ✓ Apply auto-correction

✓ structuredArray (4 tests)
  ✓ Create array output
  ✓ Validate items
  ✓ Handle empty arrays
  ✓ Auto-correct output

✓ structuredStream (4 tests)
  ✓ Provide stream and result promise
  ✓ Yield tokens during streaming
  ✓ Validate after completion
  ✓ Provide abort function
```

**Example Usage:**
```typescript
// Simplified object creation
const result = await structuredObject(
  {
    name: z.string(),
    age: z.number()
  },
  { stream: () => streamText({ model, prompt }) }
);

// Simplified array creation
const items = await structuredArray(
  z.object({ id: z.number(), name: z.string() }),
  { stream: () => streamText({ model, prompt }) }
);

// Streaming with validation
const { stream, result } = await structuredStream({
  schema,
  stream: () => streamText({ model, prompt })
});

// Process tokens as they arrive
for await (const event of stream) {
  if (event.type === 'token') {
    console.log(event.value);
  }
}

// Get validated result
const validated = await result;
console.log(validated.data);
```

### 4. Edge Cases (16 tests)

**Purpose:** Handle unusual but valid data and complex type scenarios.

**Test Coverage:**
```typescript
✓ Very large JSON (1000+ array items)
✓ Deeply nested JSON (4+ levels)
✓ Unicode characters (世界 🌍)
✓ Escaped characters (\n, \t, \r)
✓ Numbers (integers, decimals, negative)
✓ Boolean values (true, false)
✓ Null values (with nullable schema)
✓ Mixed types in arrays (union types)
✓ Enums (string literal unions)
✓ Invalid enum rejection
✓ String transformations (toLowerCase, trim)
✓ Number transformations (int, positive)
✓ Date handling (ISO 8601 strings)
✓ Complex validation rules (password matching)
✓ Record types (key-value pairs)
✓ Discriminated unions (type-based routing)
```

**Example Edge Cases:**
```typescript
// Very large arrays
const schema = z.object({
  items: z.array(z.number())
});
const result = await structured({
  schema,
  stream: () => streamText({ 
    prompt: "Generate 1000 random numbers" 
  })
});
expect(result.data.items).toHaveLength(1000);

// Deeply nested
const schema = z.object({
  a: z.object({
    b: z.object({
      c: z.object({
        d: z.string()
      })
    })
  })
});

// Unicode
const schema = z.object({ text: z.string() });
const result = await structured({
  schema,
  stream: () => streamText({ prompt: "Say hello in Chinese with emoji" })
});
expect(result.data.text).toBe("Hello 世界 🌍");

// Discriminated unions
const schema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("text"), content: z.string() }),
  z.object({ type: z.literal("number"), value: z.number() })
]);
```

### 5. Performance (2 tests)

**Purpose:** Ensure structured output scales with concurrent requests.

**Test Coverage:**
```typescript
✓ Rapid validation (10 concurrent requests)
✓ Concurrent validations (3 simultaneous)
✓ Reasonable completion time (< 5 seconds)
```

**Example:**
```typescript
// Concurrent validations
const promises = Array.from({ length: 10 }, (_, i) =>
  structured({
    schema: z.object({ value: z.string() }),
    stream: () => streamText({ prompt: `Generate item ${i}` })
  })
);

const results = await Promise.all(promises);
expect(results).toHaveLength(10);
```

### 6. Real-World Scenarios (5 tests)

**Purpose:** Test realistic LLM output patterns from production use cases.

**Scenarios Tested:**

#### API Response Format
```typescript
const schema = z.object({
  success: z.boolean(),
  data: z.object({
    id: z.number(),
    name: z.string(),
    email: z.string().email()
  }),
  timestamp: z.string()
});
```

#### LLM-Generated Code Analysis
```typescript
const schema = z.object({
  language: z.string(),
  issues: z.array(
    z.object({
      line: z.number(),
      severity: z.enum(["error", "warning", "info"]),
      message: z.string()
    })
  ),
  suggestions: z.array(z.string())
});
```

#### Structured Entity Extraction
```typescript
const schema = z.object({
  entities: z.array(
    z.object({
      type: z.enum(["person", "organization", "location"]),
      name: z.string(),
      confidence: z.number().min(0).max(1)
    })
  )
});
```

#### Sentiment Analysis Output
```typescript
const schema = z.object({
  sentiment: z.enum(["positive", "negative", "neutral"]),
  score: z.number().min(-1).max(1),
  aspects: z.array(
    z.object({
      aspect: z.string(),
      sentiment: z.enum(["positive", "negative", "neutral"])
    })
  )
});
```

#### Classification with Probabilities
```typescript
const schema = z.object({
  predictions: z.array(
    z.object({
      label: z.string(),
      probability: z.number().min(0).max(1)
    })
  ),
  topPrediction: z.string()
});
```

## Running the Tests

```bash
# Run structured output tests only
npm test -- structured.test.ts

# Run with coverage
npm run test:coverage -- structured.test.ts

# Watch mode
npm run test:watch -- structured.test.ts

# Interactive UI
npm run test:ui
```

## Test Organization

```
tests/structured.test.ts
├── Auto-Correction Utilities (28 tests)
│   ├── autoCorrectJSON (14)
│   │   ├── Valid JSON passthrough
│   │   ├── Markdown fence removal
│   │   ├── Structural fixes (braces, brackets, commas)
│   │   ├── Prefix/suffix removal
│   │   ├── Comment removal
│   │   ├── Configuration options
│   │   └── Complex structures
│   ├── isValidJSON (5)
│   ├── safeJSONParse (4)
│   └── extractJSON (5)
├── Structured Output Core (31 tests)
│   ├── Basic Functionality (9)
│   ├── Retry Logic (4)
│   ├── Callbacks (3)
│   ├── Error Handling (4)
│   ├── Auto-Correction (4)
│   ├── Strict Mode (2)
│   ├── Telemetry (3)
│   └── Abort Handling (2)
├── Helper Functions (11 tests)
│   ├── structuredObject (3)
│   ├── structuredArray (4)
│   └── structuredStream (4)
├── Edge Cases (16 tests)
│   ├── Data size and nesting
│   ├── Character encoding
│   ├── Type variations
│   ├── Transformations
│   └── Complex schemas
├── Performance (2 tests)
│   └── Concurrent validations
└── Real-World Scenarios (5 tests)
    ├── API responses
    ├── Code analysis
    ├── Entity extraction
    ├── Sentiment analysis
    └── Classification
```

## Integration with L0

The structured output functionality integrates deeply with L0's core features:

1. **Reliability:** Uses L0's retry manager for automatic retry on validation failures
2. **Guardrails:** Adds JSON structure guardrail to catch malformed output early
3. **Zero-Token Detection:** Disabled for structured output (short valid JSON like `[]` is acceptable)
4. **Fallback Models:** Supports fallback streams if primary model fails
5. **Monitoring:** Tracks structured-specific metrics (validation attempts, corrections)
6. **Abort Signals:** Full support for cancellation and cleanup

## Quality Metrics

- **Test Coverage:** 100% (93/93 passing)
- **Auto-Correction Success Rate:** High for common LLM mistakes
- **Edge Cases:** Comprehensive (unicode, large data, complex types)
- **Real-World Scenarios:** 5 production-ready examples
- **Performance:** Validated with concurrent requests
- **Maintainability:** Well-organized, documented test suites

## Common Patterns

### Basic Validation
```typescript
const result = await structured({
  schema: z.object({ name: z.string() }),
  stream: () => streamText({ model, prompt })
});
```

### With Retry and Callbacks
```typescript
const result = await structured({
  schema,
  stream: () => streamText({ model, prompt }),
  retry: { attempts: 3 },
  onValidationError: (error, attempt) => {
    log.warn(`Validation failed (${attempt}):`, error);
  },
  onAutoCorrect: (info) => {
    log.info('Auto-corrected:', info.corrections);
  }
});
```

### Streaming with Validation
```typescript
const { stream, result } = await structuredStream({
  schema,
  stream: () => streamText({ model, prompt })
});

// Show progress
for await (const event of stream) {
  if (event.type === 'token') {
    showProgress(event.value);
  }
}

// Get validated result
const validated = await result;
return validated.data;
```

### With Monitoring
```typescript
const result = await structured({
  schema,
  stream: () => streamText({ model, prompt }),
  monitoring: {
    enabled: true,
    metadata: { use_case: 'user_extraction' }
  }
});

// Check telemetry
console.log(result.telemetry?.structured);
// {
//   validationAttempts: 1,
//   validationFailures: 0,
//   autoCorrections: 2,
//   correctionTypes: ['strip_markdown_fence', 'close_brace'],
//   validationSuccess: true,
//   validationTime: 12
// }
```

## Known Limitations

1. **Auto-Correction Scope:** Cannot fix deeply malformed JSON (e.g., missing quotes around keys)
2. **Schema Complexity:** Very complex schemas with many refinements may impact performance
3. **Streaming Validation:** Final validation only occurs after stream completion
4. **Correction Determinism:** Some corrections may not produce intended results with ambiguous input

## Future Enhancements

Potential areas for expansion:

- [ ] Schema-based auto-correction (fill missing required fields)
- [ ] Partial validation during streaming
- [ ] Custom correction rules
- [ ] More sophisticated JSON repair (fix unquoted keys)
- [ ] Validation caching for repeated schemas
- [ ] Streaming JSON parsing (validate as tokens arrive)
- [ ] Schema inference from examples
- [ ] Auto-correction telemetry dashboard

## Contributing

When adding new structured output features:

1. Add comprehensive tests covering:
   - Happy path with valid input
   - Auto-correction scenarios
   - Schema validation edge cases
   - Error handling and retries
   - Performance with large/complex data
2. Update this documentation
3. Ensure 100% test coverage
4. Add real-world scenario examples
5. Document limitations and edge cases

## References

- Main implementation: `src/structured.ts`
- Auto-correction utilities: `src/utils/autoCorrect.ts`
- Type definitions: `src/types/structured.ts`
- Test suite: `tests/structured.test.ts`
- API documentation: `API.md`
- Structured output guide: `STRUCTURED_OUTPUT.md`
