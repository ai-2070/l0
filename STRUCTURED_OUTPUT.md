# Structured Output Guide

Guaranteed valid JSON matching your Zod schema.

## Quick Start

```typescript
import { structured } from "@ai2070/l0";
import { z } from "zod";

const schema = z.object({
  name: z.string(),
  age: z.number(),
  email: z.string().email(),
});

const result = await structured({
  schema,
  stream: () =>
    streamText({
      model: openai("gpt-4o"),
      prompt: "Generate a user profile as JSON",
    }),
});

// Type-safe access
console.log(result.data.name); // string
console.log(result.data.age); // number
```

---

## Features

| Feature           | Description                                            |
| ----------------- | ------------------------------------------------------ |
| Schema validation | Automatic Zod validation                               |
| Auto-correction   | Fixes trailing commas, missing braces, markdown fences |
| Retry on failure  | Automatic retry when validation fails                  |
| Fallback models   | Try cheaper models if primary fails                    |
| Type safety       | Full TypeScript inference from schema                  |

---

## API

### structured(options)

```typescript
const result = await structured({
  // Required
  schema: z.object({ ... }),
  stream: () => streamText({ model, prompt }),

  // Optional
  fallbackStreams: [...],      // Fallback model streams
  autoCorrect: true,           // Fix common JSON issues (default: true)
  retry: { attempts: 2 },      // Retry on validation failure

  // Callbacks
  onValidationError: (error, attempt) => {},
  onAutoCorrect: (info) => {}
});

// Result
result.data          // Validated data (typed)
result.raw           // Raw JSON string
result.corrected     // boolean - was auto-corrected
result.corrections   // string[] - corrections applied
```

### structuredStream(options)

Stream tokens with validation at the end:

```typescript
const { stream, result } = await structuredStream({
  schema,
  stream: () => streamText({ model, prompt }),
});

for await (const event of stream) {
  if (event.type === "token") process.stdout.write(event.value);
}

const validated = await result;
console.log(validated.data);
```

---

## Auto-Correction

Automatically fixes common LLM JSON issues:

| Issue          | Example               | Fixed               |
| -------------- | --------------------- | ------------------- |
| Missing brace  | `{"name": "Alice"`    | `{"name": "Alice"}` |
| Trailing comma | `{"a": 1,}`           | `{"a": 1}`          |
| Markdown fence | ` ```json {...} ``` ` | `{...}`             |
| Text prefix    | `Sure! {"a": 1}`      | `{"a": 1}`          |
| Single quotes  | `{'a': 1}`            | `{"a": 1}`          |

```typescript
const result = await structured({
  schema,
  stream,
  autoCorrect: true,
  onAutoCorrect: (info) => {
    console.log("Applied:", info.corrections);
  },
});

if (result.corrected) {
  console.log("Fixes applied:", result.corrections);
}
```

---

## Schema Examples

### Basic Types

```typescript
z.object({
  name: z.string(),
  age: z.number(),
  active: z.boolean(),
  status: z.enum(["pending", "approved", "rejected"]),
});
```

### Optional & Nullable

```typescript
z.object({
  name: z.string(),
  nickname: z.string().optional(),
  middleName: z.string().nullable(),
});
```

### Nested Objects

```typescript
z.object({
  user: z.object({
    name: z.string(),
    email: z.string().email(),
  }),
  metadata: z.record(z.string()),
});
```

### Arrays

```typescript
z.object({
  tags: z.array(z.string()),
  items: z.array(
    z.object({
      id: z.number(),
      name: z.string(),
    }),
  ),
});
```

### Validation Constraints

```typescript
z.object({
  amount: z.number().positive().max(10000),
  email: z.string().email(),
  url: z.string().url(),
  score: z.number().min(0).max(100),
});
```

---

## Fallback Models

```typescript
const result = await structured({
  schema,
  stream: () => streamText({ model: openai("gpt-5-mini"), prompt }),
  fallbackStreams: [
    () => streamText({ model: openai("gpt-4o"), prompt }),
    () => streamText({ model: anthropic("claude-3-haiku"), prompt }),
  ],
});

if (result.state.fallbackIndex > 0) {
  console.log("Used fallback model");
}
```

---

## Error Handling

```typescript
try {
  const result = await structured({
    schema,
    stream,
    retry: { attempts: 3 },
    onValidationError: (error, attempt) => {
      console.log(`Attempt ${attempt} failed:`, error.errors);
    },
  });
} catch (error) {
  // All retries exhausted
  console.error("Validation failed:", error.message);
}
```

---

## Best Practices

1. **Enable auto-correction** - Handles common LLM quirks
2. **Add fallback models** - Increases reliability
3. **Keep schemas focused** - Simpler schemas validate more reliably
4. **Monitor corrections** - Track what gets auto-corrected
5. **Use retry** - Transient failures are common

```typescript
// Recommended configuration
const result = await structured({
  schema,
  stream: () => streamText({ model, prompt }),
  autoCorrect: true,
  retry: { attempts: 2 },
  fallbackStreams: [() => streamText({ model: fallbackModel, prompt })],
  onValidationError: (error, attempt) => {
    logger.warn("Validation failed", { attempt, errors: error.errors });
  },
});
```

---

## See Also

- [API.md](./API.md) - Complete API reference
- [QUICKSTART.md](./QUICKSTART.md) - Getting started
- [ERROR_HANDLING.md](./ERROR_HANDLING.md) - Error handling guide
