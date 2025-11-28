# Deterministic Structured Output

**Guaranteed valid JSON matching your schema. No hallucinations. No narrations. No weird prefaces.**

L0's structured output provides automatic schema validation, auto-correction of common JSON issues, retry on validation failure, and full integration with L0's reliability features.

---

## Table of Contents

- [Overview](#overview)
- [Quick Start](#quick-start)
- [Core Features](#core-features)
- [API Reference](#api-reference)
- [Auto-Correction](#auto-correction)
- [Schema Validation](#schema-validation)
- [Real-World Examples](#real-world-examples)
- [Best Practices](#best-practices)
- [Error Handling](#error-handling)
- [Integration with L0 Features](#integration-with-l0-features)
- [Performance](#performance)

---

## Overview

### The Problem

LLMs frequently produce unreliable JSON output:

```typescript
// ❌ Common LLM failures:
"Sure! Here's the JSON: {\"name\": \"Alice\"}"  // Text prefix
'{"name": "Alice",}'                            // Trailing comma
{"name": "Alice"                                 // Missing closing brace
```json\n{"name": "Alice"}\n```                  // Markdown fence
"As an AI, I'll provide: {\"name\": \"Alice\"}" // Narration
```

**Result:** Your app crashes on `JSON.parse()`.

### The Solution

L0 Structured Output provides:

✅ **Automatic schema validation** with Zod  
✅ **Auto-correction** of common JSON issues  
✅ **Retry on validation failure**  
✅ **Fallback models** for reliability  
✅ **Type-safe results** with TypeScript  
✅ **Zero crashes** - guaranteed valid JSON  

---

## Quick Start

### Basic Usage

```typescript
import { structured } from 'l0';
import { z } from 'zod';
import { openai } from '@ai-sdk/openai';
import { streamText } from 'ai';

// Define your schema
const schema = z.object({
  name: z.string(),
  age: z.number(),
  email: z.string().email()
});

// Get structured output
const result = await structured({
  schema,
  stream: () => streamText({
    model: openai('gpt-4o'),
    prompt: 'Generate user profile for Alice, age 30'
  })
});

// Guaranteed to match schema!
console.log(result.data.name);   // Type-safe: string
console.log(result.data.age);    // Type-safe: number
console.log(result.data.email);  // Type-safe: string
```

### With Auto-Correction

```typescript
const result = await structured({
  schema,
  stream: () => streamText({ model, prompt }),
  autoCorrect: true,  // Fix common issues automatically
  onAutoCorrect: (info) => {
    console.log('Corrections applied:', info.corrections);
  }
});

// Even if LLM returns malformed JSON, it's automatically fixed
console.log('Was corrected:', result.corrected);
console.log('Corrections:', result.corrections);
```

---

## Core Features

### 1. Schema Validation with Zod

Ensures output matches your exact requirements:

```typescript
const schema = z.object({
  amount: z.number().positive(),
  currency: z.enum(['USD', 'EUR', 'GBP']),
  approved: z.boolean(),
  risk_score: z.number().min(0).max(1)
});

const result = await structured({ schema, stream });

// Guaranteed to be valid:
// - amount is a positive number
// - currency is exactly USD, EUR, or GBP
// - approved is a boolean
// - risk_score is between 0 and 1
```

### 2. Auto-Correction of Common Issues

Automatically fixes:

- ✅ Missing closing braces `}` or brackets `]`
- ✅ Trailing commas
- ✅ Markdown code fences ` ```json ... ``` `
- ✅ Text prefixes ("Here's the JSON:", "Sure!", etc.)
- ✅ Text suffixes ("I hope this helps", etc.)
- ✅ JSON comments (some models add them)
- ✅ Unescaped control characters
- ✅ Single quotes instead of double quotes

### 3. Retry on Validation Failure

If validation fails, automatically retries:

```typescript
const result = await structured({
  schema,
  stream: () => streamText({ model, prompt }),
  retry: {
    attempts: 3,          // Try up to 3 times
    backoff: 'exponential'
  },
  onValidationError: (error, attempt) => {
    console.log(`Validation failed (attempt ${attempt}):`, error);
  }
});
```

### 4. Fallback Models

Use cheaper/alternative models if primary fails:

```typescript
const result = await structured({
  schema,
  stream: () => streamText({ model: openai('gpt-4o'), prompt }),
  fallbackStreams: [
    () => streamText({ model: openai('gpt-4o-mini'), prompt }),
    () => streamText({ model: anthropic('claude-3-haiku'), prompt })
  ]
});

// System tries GPT-4o, falls back to mini, then Claude if needed
```

### 5. Type-Safe Results

Full TypeScript support with automatic type inference:

```typescript
const schema = z.object({
  name: z.string(),
  age: z.number()
});

const result = await structured({ schema, stream });

// result.data is typed as { name: string; age: number }
result.data.name.toUpperCase();  // ✓ String methods available
result.data.age.toFixed(2);       // ✓ Number methods available
result.data.unknown;              // ✗ TypeScript error
```

---

## API Reference

### `structured(options)`

Main API for structured output.

```typescript
interface StructuredOptions<T extends z.ZodTypeAny> {
  schema: T;                                    // Zod schema
  stream: () => Promise<any>;                   // Stream factory
  fallbackStreams?: Array<() => Promise<any>>;  // Fallback models
  retry?: RetryOptions;                         // Retry configuration
  autoCorrect?: boolean;                        // Enable auto-correction (default: true)
  strictMode?: boolean;                         // Reject unknown fields (default: false)
  timeout?: { initialToken?: number; interToken?: number };
  signal?: AbortSignal;
  monitoring?: { enabled?: boolean; metadata?: Record<string, any> };
  onValidationError?: (error: z.ZodError, attempt: number) => void;
  onAutoCorrect?: (info: CorrectionInfo) => void;
  onRetry?: (attempt: number, reason: string) => void;
}

interface StructuredResult<T> {
  data: T;                     // Validated, typed data
  raw: string;                 // Original JSON string
  corrected: boolean;          // Whether auto-correction was applied
  corrections: string[];       // List of corrections applied
  state: StructuredState;      // L0 state with validation info
  telemetry?: StructuredTelemetry;
  errors: Error[];
  abort: () => void;
}
```

### `structuredObject(shape, options)`

Helper for object schemas:

```typescript
const result = await structuredObject(
  {
    name: z.string(),
    age: z.number()
  },
  {
    stream: () => streamText({ model, prompt })
  }
);
```

### `structuredArray(itemSchema, options)`

Helper for array schemas:

```typescript
const result = await structuredArray(
  z.object({ id: z.number(), name: z.string() }),
  {
    stream: () => streamText({ model, prompt })
  }
);

console.log(result.data.length);  // Array of validated items
```

### `structuredStream(options)`

Streaming version (yields tokens, validates at end):

```typescript
const { stream, result } = await structuredStream({
  schema,
  stream: () => streamText({ model, prompt })
});

// Stream tokens in real-time
for await (const event of stream) {
  if (event.type === 'token') {
    process.stdout.write(event.value || '');
  }
}

// Get validated result
const validated = await result;
console.log(validated.data);
```

---

## Auto-Correction

### What Gets Auto-Corrected

#### 1. Structural Issues ✅ Safe

```typescript
// Missing closing braces
'{"name": "Alice"' → '{"name": "Alice"}'

// Trailing commas
'{"name": "Alice",}' → '{"name": "Alice"}'

// Unclosed arrays
'[1, 2, 3' → '[1, 2, 3]'
```

#### 2. Formatting Issues ✅ Safe

```typescript
// Markdown fences
'```json\n{"name": "Alice"}\n```' → '{"name": "Alice"}'

// Text prefixes
'Here is the JSON: {"name": "Alice"}' → '{"name": "Alice"}'

// Text suffixes
'{"name": "Alice"}\n\nI hope this helps!' → '{"name": "Alice"}'
```

#### 3. Quote/Escape Issues ✅ Safe

```typescript
// Unescaped newlines
'{"text": "Hello\nWorld"}' → '{"text": "Hello\\nWorld"}'

// Control characters
'{"text": "Tab\there"}' → '{"text": "Tab\\there"}'
```

#### 4. Comments ✅ Safe

```typescript
// C-style comments (some models add them)
'{"name": "Alice" /* user profile */}' → '{"name": "Alice"}'
```

### Configuration

```typescript
const result = await structured({
  schema,
  stream,
  autoCorrect: true,  // Enable auto-correction
  onAutoCorrect: (info) => {
    console.log('Original:', info.original);
    console.log('Corrected:', info.corrected);
    console.log('Fixes:', info.corrections);
  }
});
```

### Manual Auto-Correction

You can also use auto-correction utilities directly:

```typescript
import { autoCorrectJSON, safeJSONParse } from 'l0';

// Auto-correct and get result
const result = autoCorrectJSON('{"name": "Alice",}');
if (result.success) {
  console.log('Corrected:', result.corrected);
  console.log('Applied:', result.corrections);
}

// Safe parsing with auto-correction
const { data, corrected } = safeJSONParse('{"name": "Alice",}');
console.log('Was corrected:', corrected);
```

---

## Schema Validation

### Basic Schemas

```typescript
import { z } from 'zod';

// String
const nameSchema = z.object({
  name: z.string()
});

// Number
const ageSchema = z.object({
  age: z.number()
});

// Boolean
const activeSchema = z.object({
  active: z.boolean()
});

// Enum
const statusSchema = z.object({
  status: z.enum(['pending', 'approved', 'rejected'])
});
```

### Advanced Schemas

```typescript
// Optional fields
const schema = z.object({
  name: z.string(),
  nickname: z.string().optional(),
  age: z.number().nullable()
});

// Nested objects
const schema = z.object({
  user: z.object({
    name: z.string(),
    email: z.string().email()
  }),
  metadata: z.record(z.string())
});

// Arrays
const schema = z.object({
  tags: z.array(z.string()),
  scores: z.array(z.number())
});

// Complex validation
const schema = z.object({
  amount: z.number().positive().max(10000),
  email: z.string().email(),
  url: z.string().url(),
  date: z.string().datetime()
});
```

### Custom Validation

```typescript
const schema = z.object({
  amount: z.number().refine(
    (val) => val > 0 && val < 10000,
    { message: 'Amount must be between 0 and 10000' }
  ),
  email: z.string().refine(
    (val) => val.endsWith('@company.com'),
    { message: 'Must be company email' }
  )
});
```

---

## Real-World Examples

### Example 1: Financial Transaction Validation

```typescript
import { structured, recommendedStructured } from 'l0';
import { z } from 'zod';

const transactionSchema = z.object({
  transaction_id: z.string().uuid(),
  amount: z.number().positive(),
  currency: z.enum(['USD', 'EUR', 'GBP']),
  approved: z.boolean(),
  risk_score: z.number().min(0).max(1),
  reason: z.string().optional(),
  timestamp: z.string().datetime()
});

async function validateTransaction(txData: any) {
  const prompt = `Validate this transaction and respond with JSON: ${JSON.stringify(txData)}`;
  
  const result = await structured({
    schema: transactionSchema,
    stream: () => streamText({
      model: openai('gpt-4o'),
      prompt,
      response_format: { type: 'json_object' }
    }),
    ...recommendedStructured,
    fallbackStreams: [
      () => streamText({
        model: openai('gpt-4o-mini'),
        prompt,
        response_format: { type: 'json_object' }
      })
    ],
    monitoring: {
      enabled: true,
      metadata: {
        transaction_type: 'validation',
        critical: true
      }
    }
  });
  
  return {
    validated: result.data,
    approved: result.data.approved,
    riskScore: result.data.risk_score,
    modelUsed: result.state.fallbackIndex === 0 ? 'primary' : 'fallback'
  };
}

// Usage
const validation = await validateTransaction({
  id: 'txn_12345',
  amount: 1000,
  account: '123456'
});

console.log('Approved:', validation.approved);
console.log('Risk score:', validation.riskScore);
```

### Example 2: E-commerce Product Extraction

```typescript
const productSchema = z.object({
  name: z.string(),
  description: z.string(),
  price: z.number().positive(),
  currency: z.string(),
  in_stock: z.boolean(),
  category: z.string(),
  tags: z.array(z.string()),
  images: z.array(z.string().url()).optional()
});

const result = await structured({
  schema: productSchema,
  stream: () => streamText({
    model: openai('gpt-4o'),
    prompt: 'Extract product details from this page: [HTML content]'
  }),
  autoCorrect: true
});

console.log('Product:', result.data.name);
console.log('Price:', `${result.data.currency} ${result.data.price}`);
console.log('In stock:', result.data.in_stock);
```

### Example 3: Healthcare Data Extraction

```typescript
const patientSchema = z.object({
  patient_id: z.string(),
  name: z.object({
    first: z.string(),
    last: z.string()
  }),
  dob: z.string().date(),
  diagnoses: z.array(z.object({
    code: z.string(),
    description: z.string(),
    date: z.string().date()
  })),
  medications: z.array(z.object({
    name: z.string(),
    dosage: z.string(),
    frequency: z.string()
  })),
  allergies: z.array(z.string()).optional()
});

const result = await structured({
  schema: patientSchema,
  stream: () => streamText({
    model: openai('gpt-4o'),
    prompt: 'Extract patient data from medical record...'
  }),
  strictMode: true,  // Reject any unknown fields
  retry: {
    attempts: 3,
    backoff: 'exponential'
  },
  monitoring: {
    enabled: true,
    metadata: {
      data_type: 'PHI',  // Protected Health Information
      compliance: 'HIPAA'
    }
  }
});
```

### Example 4: Batch Data Processing

```typescript
import { structuredArray, batched } from 'l0';

const itemSchema = z.object({
  id: z.string(),
  title: z.string(),
  category: z.string(),
  score: z.number().min(0).max(100)
});

async function processBatch(items: string[]) {
  const operations = items.map(item => ({
    stream: () => structuredArray(itemSchema, {
      stream: () => streamText({
        model: openai('gpt-4o-mini'),
        prompt: `Categorize and score: ${item}`
      })
    })
  }));
  
  const results = await batched(operations, {
    batchSize: 10,
    concurrency: 5
  });
  
  return results.results.map(r => r.status === 'success' ? r.data : null);
}
```

---

## Best Practices

### 1. Always Enable Auto-Correction for Production

```typescript
// ✅ Good: Auto-correction enabled
const result = await structured({
  schema,
  stream,
  autoCorrect: true
});

// ❌ Bad: Disabled (may fail on valid but oddly formatted JSON)
const result = await structured({
  schema,
  stream,
  autoCorrect: false
});
```

### 2. Use Strict Mode for Critical Data

```typescript
// For financial, healthcare, or other critical data
const result = await structured({
  schema,
  stream,
  strictMode: true,  // Reject unknown fields
  retry: {
    attempts: 3
  }
});
```

### 3. Add Fallback Models for High Availability

```typescript
const result = await structured({
  schema,
  stream: () => streamText({ model: openai('gpt-4o'), prompt }),
  fallbackStreams: [
    () => streamText({ model: openai('gpt-4o-mini'), prompt }),
    () => streamText({ model: anthropic('claude-3-haiku'), prompt })
  ]
});
```

### 4. Monitor Validation Failures

```typescript
const result = await structured({
  schema,
  stream,
  monitoring: {
    enabled: true,
    metadata: {
      endpoint: 'transaction_validation',
      version: 'v1'
    }
  },
  onValidationError: (error, attempt) => {
    logger.warn('Validation failed', {
      attempt,
      errors: error.errors,
      zodError: error
    });
  }
});

// Check telemetry
if (result.telemetry?.structured) {
  console.log('Validation attempts:', result.telemetry.structured.validationAttempts);
  console.log('Failures:', result.telemetry.structured.validationFailures);
}
```

### 5. Use Presets for Common Scenarios

```typescript
import { recommendedStructured, strictStructured } from 'l0';

// Standard apps
const result = await structured({
  schema,
  stream,
  ...recommendedStructured  // autoCorrect: true, retry: 2
});

// Critical apps
const result = await structured({
  schema,
  stream,
  ...strictStructured  // strictMode: true, retry: 3
});
```

### 6. Keep Schemas Focused

```typescript
// ✅ Good: Focused schema
const userSchema = z.object({
  name: z.string(),
  email: z.string().email(),
  age: z.number()
});

// ❌ Bad: Too complex (harder for model to get right)
const userSchema = z.object({
  personalInfo: z.object({
    basicInfo: z.object({
      name: z.object({
        first: z.string(),
        middle: z.string().optional(),
        last: z.string(),
        // ... 20 more nested levels
      })
    })
  })
});
```

---

## Error Handling

### Validation Errors

```typescript
try {
  const result = await structured({
    schema,
    stream,
    onValidationError: (error, attempt) => {
      console.log(`Attempt ${attempt} failed:`);
      error.errors.forEach(err => {
        console.log(`  ${err.path.join('.')}: ${err.message}`);
      });
    }
  });
} catch (error) {
  if (error.message.includes('Schema validation failed')) {
    console.error('All validation attempts exhausted');
  }
}
```

### JSON Parse Errors

```typescript
try {
  const result = await structured({
    schema,
    stream,
    autoCorrect: true  // Will try to fix parse errors
  });
} catch (error) {
  if (error.message.includes('Invalid JSON')) {
    console.error('JSON could not be parsed or corrected');
  }
}
```

### Handling Partial Failures

```typescript
const result = await structured({
  schema,
  stream,
  autoCorrect: true
});

// Check if corrections were applied
if (result.corrected) {
  console.warn('Auto-corrections were applied:', result.corrections);
  
  // Log for monitoring
  logger.info('json_autocorrected', {
    corrections: result.corrections,
    original: result.raw,
    corrected: JSON.stringify(result.data)
  });
}

// Check state
if (result.state.validationFailures > 0) {
  console.warn(`Had ${result.state.validationFailures} validation failures`);
}
```

---

## Integration with L0 Features

### With Guardrails

```typescript
import { structured, recommendedGuardrails } from 'l0';

const result = await structured({
  schema,
  stream: () => streamText({ model, prompt }),
  // L0 guardrails are automatically applied
  // (JSON guardrails, drift detection, etc.)
});
```

### With Fallback Models

```typescript
const result = await structured({
  schema,
  stream: () => streamText({ model: openai('gpt-4o'), prompt }),
  fallbackStreams: [
    () => streamText({ model: openai('gpt-4o-mini'), prompt })
  ]
});

console.log('Fallback used:', result.state.fallbackIndex > 0);
```

### With Monitoring

```typescript
const result = await structured({
  schema,
  stream,
  monitoring: {
    enabled: true,
    metadata: {
      user_id: 'user_123',
      endpoint: 'api/validate'
    }
  }
});

// Structured-specific telemetry
console.log(result.telemetry?.structured);
// {
//   validationAttempts: 1,
//   validationFailures: 0,
//   autoCorrections: 2,
//   correctionTypes: ['strip_markdown_fence', 'close_brace'],
//   validationSuccess: true,
//   validationTime: 5
// }
```

### With Interceptors

```typescript
import { structured } from 'l0';

// Interceptors work with structured output
const result = await structured({
  schema,
  stream,
  // Note: Interceptors are applied at the L0 layer
  // before schema validation
});
```

---

## Performance

### Benchmarks

Typical performance on structured output:

| Operation | Time | Notes |
|-----------|------|-------|
| Valid JSON (no correction) | ~0ms | Parse-only |
| Auto-correction | ~1-5ms | Depends on complexity |
| Schema validation (simple) | ~1ms | Zod overhead |
| Schema validation (complex) | ~5-10ms | Deep nested schemas |
| Full pipeline | ~5-15ms | End-to-end |

### Optimization Tips

#### 1. Disable Auto-Correction If Not Needed

```typescript
// If you trust your model to always return valid JSON
const result = await structured({
  schema,
  stream,
  autoCorrect: false  // Skip correction step
});
```

#### 2. Use Simpler Schemas

```typescript
// ✅ Fast: Simple schema
z.object({ name: z.string(), age: z.number() })

// ❌ Slow: Complex nested schema
z.object({
  level1: z.object({
    level2: z.object({
      // ... many levels deep
    })
  })
})
```

#### 3. Batch Operations

```typescript
// Process multiple items in parallel
const operations = items.map(item => ({
  stream: () => structured({
    schema,
    stream: () => streamText({ model, prompt: item })
  })
}));

const results = await Promise.all(operations);
```

---

## Presets

L0 includes three presets for common scenarios:

### Minimal

Fast failure, minimal corrections:

```typescript
import { minimalStructured } from 'l0';

const result = await structured({
  schema,
  stream,
  ...minimalStructured
});

// Equivalent to:
// {
//   autoCorrect: false,
//   strictMode: false,
//   retry: { attempts: 1 }
// }
```

### Recommended (Default)

Balanced reliability and performance:

```typescript
import { recommendedStructured } from 'l0';

const result = await structured({
  schema,
  stream,
  ...recommendedStructured
});

// Equivalent to:
// {
//   autoCorrect: true,
//   strictMode: false,
//   retry: { attempts: 2, backoff: 'exponential' }
// }
```

### Strict

Maximum validation, auto-correction, retries:

```typescript
import { strictStructured } from 'l0';

const result = await structured({
  schema,
  stream,
  ...strictStructured
});

// Equivalent to:
// {
//   autoCorrect: true,
//   strictMode: true,
//   retry: { attempts: 3, backoff: 'exponential' }
// }
```

---

## Comparison with Other Solutions

### vs. Vercel AI SDK Alone

| Feature | Vercel AI SDK | L0 Structured |
|---------|---------------|---------------|
| JSON mode | ✅ Basic | ✅ With validation |
| Schema validation | ❌ Manual | ✅ Automatic |
| Auto-correction | ❌ None | ✅ Built-in |
| Retry on invalid | ❌ Manual | ✅ Automatic |
| Fallback models | ❌ Manual | ✅ Automatic |
| Type safety | ⚠️ Manual typing | ✅ Inferred from schema |
| Error handling | ❌ Manual | ✅ Automatic |

### vs. Manual JSON.parse()

```typescript
// ❌ Manual approach (fragile)
const result = await streamText({ model, prompt });
let text = '';
for await (const chunk of result.textStream) {
  text += chunk;
}
const data = JSON.parse(text);  // May crash!

// ✅ L0 Structured (reliable)
const result = await structured({
  schema,
  stream: () => streamText({ model, prompt })
});
console.log(result.data);  // Guaranteed valid + typed
```

---

## FAQ

**Q: Do I need Zod?**  
A: Yes, L0 uses Zod for schema validation. It's a peer dependency.

**Q: What happens if validation fails after all retries?**  
A: Throws an error with details about validation failures.

**Q: Can I use with non-OpenAI models?**  
A: Yes! Works with any Vercel AI SDK compatible model.

**Q: Does auto-correction change the meaning of the data?**  
A: No. Auto-correction only fixes structural issues (braces, quotes, etc.), never data values.

**Q: Can I disable auto-correction?**  
A: Yes, set `autoCorrect: false`. But we recommend keeping it enabled for production.

**Q: How much overhead does schema validation add?**  
A: Minimal (~1-10ms depending on schema complexity). JSON parsing is fast.

**Q: Can I use with streaming output?**  
A: Yes! Use `structuredStream()` for real-time tokens + validation at the end.

**Q: What if the model returns valid JSON but wrong schema?**  
A: It will retry (if retry is configured) or throw a validation error.

---

## Summary

L0 Structured Output provides:

✅ **Guaranteed valid JSON** - Never crashes on parse errors  
✅ **Schema validation** - Ensures output matches your requirements  
✅ **Auto-correction** - Fixes common LLM JSON issues automatically  
✅ **Retry logic** - Automatically retries on validation failure  
✅ **Fallback models** - High availability with cheaper models  
✅ **Type safety** - Full TypeScript support with type inference  
✅ **Production-ready** - Built-in monitoring, telemetry, error handling  

**This is the #1 feature request** for production LLM apps. L0 makes it effortless.

---

## See Also

- [README.md](./README.md) - Main L0 documentation
- [FALLBACK_MODELS.md](./FALLBACK_MODELS.md) - Fall-through model retries
- [GUARDRAILS.md](./GUARDRAILS.md) - Guardrail system
- [API.md](./API.md) - Complete API reference