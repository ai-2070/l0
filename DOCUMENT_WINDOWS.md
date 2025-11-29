# Document Windows Guide

Automatic chunking and navigation for long documents.

## Quick Start

```typescript
import { createWindow } from "@ai2070/l0";

const window = createWindow(longDocument, {
  size: 2000,           // Tokens per chunk
  overlap: 200,         // Overlap between chunks
  strategy: "paragraph" // "token" | "char" | "paragraph" | "sentence"
});

// Process all chunks
const results = await window.processAll((chunk) => ({
  stream: () => streamText({
    model: openai("gpt-4o"),
    prompt: `Summarize: ${chunk.content}`
  })
}));

// Merge results
const summary = results
  .filter(r => r.status === "success")
  .map(r => r.result.state.content)
  .join("\n\n");
```

---

## Chunking Strategies

| Strategy | Best For | Behavior |
|----------|----------|----------|
| `token` | General purpose | Chunks by estimated token count |
| `char` | Fixed-length | Chunks by character count |
| `paragraph` | Structured docs | Preserves paragraph boundaries |
| `sentence` | Precision | Never splits sentences |

```typescript
// Token-based (default)
createWindow(doc, { size: 2000, strategy: "token" })

// Paragraph-based
createWindow(doc, { size: 2000, strategy: "paragraph" })

// Sentence-based
createWindow(doc, { size: 1500, strategy: "sentence" })
```

---

## Navigation

```typescript
const window = createWindow(document, { size: 2000 });

// Get chunks
window.current()           // Current chunk
window.get(0)              // Specific chunk
window.getAllChunks()      // All chunks

// Navigate
window.next()              // Move to next
window.prev()              // Move to previous
window.jump(5)             // Jump to chunk 5
window.reset()             // Back to first

// Check bounds
window.hasNext()           // Has more chunks?
window.hasPrev()           // Has previous?
window.totalChunks         // Total count
window.currentIndex        // Current position
```

---

## Processing

### Parallel (Default)

```typescript
const results = await window.processAll((chunk) => ({
  stream: () => streamText({ model, prompt: chunk.content })
}), { concurrency: 5 });
```

### Sequential

```typescript
const results = await window.processSequential((chunk) => ({
  stream: () => streamText({ model, prompt: chunk.content })
}));
```

### With Retry & Fallbacks

```typescript
const results = await window.processAll((chunk) => ({
  stream: () => streamText({ model: openai("gpt-4o"), prompt: chunk.content }),
  retry: { attempts: 2 },
  fallbackStreams: [
    () => streamText({ model: openai("gpt-4o-mini"), prompt: chunk.content })
  ]
}));
```

---

## Chunk Structure

```typescript
interface DocumentChunk {
  index: number;        // Position (0-based)
  content: string;      // Chunk text
  startPos: number;     // Start in original document
  endPos: number;       // End in original document
  tokenCount: number;   // Estimated tokens
  charCount: number;    // Character count
  isFirst: boolean;
  isLast: boolean;
  totalChunks: number;
}
```

---

## Overlap

Overlap maintains context between chunks:

```typescript
const window = createWindow(document, {
  size: 2000,
  overlap: 200  // 10% overlap
});

// Chunk 0: tokens 0-2000
// Chunk 1: tokens 1800-3800 (200 overlap with chunk 0)
// Chunk 2: tokens 3600-5600 (200 overlap with chunk 1)
```

**Recommendation:** Use 10% overlap (e.g., 200 for 2000-token chunks)

---

## Context Restoration

Auto-retry with adjacent chunks if drift detected:

```typescript
import { l0WithWindow } from "@ai2070/l0";

const result = await l0WithWindow({
  window,
  chunkIndex: 0,
  stream: () => streamText({ model, prompt: window.get(0)?.content }),
  contextRestoration: {
    enabled: true,
    strategy: "adjacent",  // Try adjacent chunks
    maxAttempts: 2
  }
});
```

---

## Examples

### Legal Document Analysis

```typescript
const window = createWindow(contract, {
  size: 2000,
  strategy: "paragraph"
});

const results = await window.processAll((chunk) => ({
  stream: () => streamText({
    model,
    prompt: `Extract legal clauses from: ${chunk.content}`
  })
}));
```

### Transcript Summarization

```typescript
const window = createWindow(transcript, {
  size: 3000,
  strategy: "sentence"
});

const summaries = await window.processSequential((chunk) => ({
  stream: () => streamText({
    model,
    prompt: `Summarize this section: ${chunk.content}`
  })
}));
```

### Code Documentation

```typescript
const window = createWindow(sourceCode, {
  size: 1500,
  strategy: "paragraph"
});

const docs = await window.processAll((chunk) => ({
  stream: () => streamText({
    model,
    prompt: `Generate documentation for: ${chunk.content}`
  })
}));
```

---

## Presets

```typescript
import {
  smallWindow,      // 1000 tokens, 100 overlap
  mediumWindow,     // 2000 tokens, 200 overlap
  largeWindow,      // 4000 tokens, 400 overlap
  paragraphWindow,  // Paragraph-based
  sentenceWindow    // Sentence-based
} from "@ai2070/l0";

const window = createWindow(document, largeWindow);
```

---

## Best Practices

1. **Chunk size** - Leave room for prompt + response (e.g., 2000 for 8k context)
2. **Overlap** - Use 10% for context continuity
3. **Strategy** - Match to content type (paragraph for docs, sentence for transcripts)
4. **Concurrency** - Limit for rate-limited APIs
5. **Error handling** - Check `result.status === "error"` for failures

```typescript
// Recommended setup
const window = createWindow(document, {
  size: 2000,
  overlap: 200,
  strategy: "paragraph"
});

const results = await window.processAll((chunk) => ({
  stream: () => streamText({ model, prompt: chunk.content }),
  retry: { attempts: 2 }
}), { concurrency: 3 });

// Handle failures
const failed = results.filter(r => r.status === "error");
if (failed.length > 0) {
  console.warn(`${failed.length} chunks failed`);
}
```

---

## See Also

- [API.md](./API.md) - Complete API reference
- [STRUCTURED_OUTPUT.md](./STRUCTURED_OUTPUT.md) - Structured output
- [PERFORMANCE.md](./PERFORMANCE.md) - Performance tuning
