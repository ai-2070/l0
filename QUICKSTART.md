# L0 Quick Start Guide

Get started with L0 in 5 minutes.

## Installation

```bash
npm install l0
# or
yarn add l0
# or
pnpm add l0
```

## Basic Usage

```typescript
import { l0, recommendedGuardrails, recommendedRetry } from 'l0';
import { streamText } from 'ai';
import { openai } from '@ai-sdk/openai';

// Create an L0-wrapped stream
const result = await l0({
  stream: () => streamText({
    model: openai('gpt-4o-mini'),
    prompt: 'Write a haiku about coding'
  }),
  guardrails: recommendedGuardrails,
  retry: recommendedRetry
});

// Consume the stream
for await (const event of result.stream) {
  if (event.type === 'token') {
    process.stdout.write(event.value || '');
  }
}
```

That's it! You now have:
- ✅ Streaming with automatic retry on failures
- ✅ Guardrails detecting malformed output
- ✅ Network failure protection
- ✅ Zero-token detection
- ✅ Unified event format

## Common Patterns

### 1. JSON Output with Validation

```typescript
import { l0, jsonOnlyGuardrails, formatJsonOutput } from 'l0';

const result = await l0({
  stream: () => streamText({
    model: openai('gpt-4o-mini'),
    prompt: `
      ${formatJsonOutput({ strict: true })}
      
      Generate a user profile with name, age, and email.
    `
  }),
  guardrails: jsonOnlyGuardrails,
  retry: { attempts: 3, retryOn: ['guardrail_violation', 'malformed'] }
});

let json = '';
for await (const event of result.stream) {
  if (event.type === 'token') json += event.value;
}

const parsed = JSON.parse(json);
console.log(parsed);
```

### 2. With Timeout Protection

```typescript
const result = await l0({
  stream: () => streamText({ /* ... */ }),
  guardrails: recommendedGuardrails,
  retry: recommendedRetry,
  timeout: {
    initialToken: 2000,  // 2 seconds for first token
    interToken: 5000     // 5 seconds between tokens
  }
});
```

### 3. With Callbacks

```typescript
const result = await l0({
  stream: () => streamText({ /* ... */ }),
  guardrails: recommendedGuardrails,
  retry: recommendedRetry,
  
  onEvent: (event) => {
    console.log('Event:', event.type);
  },
  
  onViolation: (violation) => {
    console.warn('⚠️', violation.message);
  },
  
  onRetry: (attempt, reason) => {
    console.log(`Retry ${attempt}: ${reason}`);
  }
});
```

### 4. Drift Detection

```typescript
const result = await l0({
  stream: () => streamText({ /* ... */ }),
  guardrails: recommendedGuardrails,
  retry: recommendedRetry,
  detectDrift: true  // Detect model derailment
});

// After consuming stream
if (result.state.driftDetected) {
  console.warn('Model output drifted from expected behavior');
}
```

### 5. Custom Guardrails

```typescript
const customRule = {
  name: 'custom-length',
  check: (context) => {
    if (context.isComplete && context.content.length < 100) {
      return [{
        rule: 'custom-length',
        message: 'Output too short',
        severity: 'error' as const,
        recoverable: true
      }];
    }
    return [];
  }
};

const result = await l0({
  stream: () => streamText({ /* ... */ }),
  guardrails: [customRule, ...recommendedGuardrails],
  retry: recommendedRetry
});
```

## Preset Configurations

L0 includes several presets for common scenarios:

### Guardrail Presets

```typescript
import {
  minimalGuardrails,      // JSON + zero-output only
  recommendedGuardrails,  // Balanced for most cases
  strictGuardrails,       // All rules enabled
  jsonOnlyGuardrails,     // JSON-specific
  markdownOnlyGuardrails  // Markdown-specific
} from 'l0';
```

### Retry Presets

```typescript
import {
  minimalRetry,      // 1 attempt
  recommendedRetry,  // 2 attempts, exponential backoff
  strictRetry        // 3 attempts, full-jitter backoff
} from 'l0';
```

## Format Helpers

L0 includes helpers to format your prompts consistently:

```typescript
import {
  formatContext,
  formatMemory,
  formatJsonOutput,
  formatTool
} from 'l0';

const prompt = `
${formatContext(documentContent, { label: 'Documentation' })}

${formatMemory(conversationHistory)}

${formatJsonOutput({ strict: true })}
`;
```

## Utility Functions

### Text Normalization

```typescript
import { normalizeForModel, dedent } from 'l0';

const normalized = normalizeForModel(userInput);
const dedented = dedent(`
  Some indented
  text here
`);
```

### JSON Repair

```typescript
import { repairJson, isValidJson } from 'l0';

let json = '{"name": "Alice", "age": 30';  // Missing closing brace
json = repairJson(json);

if (isValidJson(json)) {
  console.log('Fixed!');
}
```

### Token Analysis

```typescript
import { hasMeaningfulContent, estimateTokenCount } from 'l0';

if (hasMeaningfulContent(output)) {
  const tokens = estimateTokenCount(output);
  console.log(`Estimated ${tokens} tokens`);
}
```

## Error Handling

L0 automatically categorizes errors:

```typescript
try {
  const result = await l0({
    stream: () => streamText({ /* ... */ }),
    guardrails: recommendedGuardrails,
    retry: recommendedRetry
  });
  
  for await (const event of result.stream) {
    // Handle events
  }
} catch (error) {
  // Only fatal errors or max retries reached
  console.error('L0 error:', error);
}
```

Error categories:
- **Network errors**: Retry forever (doesn't count toward limit)
- **Transient errors** (429, 503): Retry forever (doesn't count)
- **Model errors**: Count toward retry limit
- **Fatal errors**: No retry (auth, invalid request)

## Get Full Text

If you just want the final text without streaming:

```typescript
import { l0, getText } from 'l0';

const result = await l0({ /* ... */ });
const text = await getText(result);
console.log(text);
```

Or with a callback:

```typescript
import { consumeStream } from 'l0';

const text = await consumeStream(result, (token) => {
  process.stdout.write(token);
});
```

## Check Results

After consuming the stream, inspect the state:

```typescript
console.log({
  tokenCount: result.state.tokenCount,
  retries: result.state.retryAttempts,
  networkRetries: result.state.networkRetries,
  completed: result.state.completed,
  violations: result.state.violations,
  driftDetected: result.state.driftDetected
});
```

## Next Steps

- Read the [API Reference](./API.md) for complete documentation
- Check out [examples](./examples/) for more patterns
- Learn about [custom guardrails](./API.md#custom-guardrails)
- Explore [format helpers](./API.md#format-helpers)

## Common Issues

### "Maximum retry attempts reached"

Increase retry attempts or adjust guardrails:

```typescript
retry: { attempts: 5 }
```

### "Initial token timeout"

Increase timeout for slow models:

```typescript
timeout: { initialToken: 5000 }
```

### Too many violations

Use more lenient guardrails:

```typescript
guardrails: minimalGuardrails
```

### Need custom validation

Add your own guardrail:

```typescript
guardrails: [
  {
    name: 'my-rule',
    check: (context) => { /* validation logic */ }
  },
  ...recommendedGuardrails
]
```

## Tips

1. **Start with presets**: Use `recommendedGuardrails` and `recommendedRetry`
2. **Enable callbacks**: Monitor violations and retries in development
3. **Set timeouts**: Prevent hanging on slow/stalled streams
4. **Use format helpers**: Consistent prompts lead to better outputs
5. **Check state**: Inspect `result.state` after completion

## Support

- [GitHub Issues](https://github.com/yourusername/l0/issues)
- [Documentation](./README.md)
- [API Reference](./API.md)

---

**Ready to build reliable LLM apps!** 🚀