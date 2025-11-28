# Document Windows

**Automatic chunking and navigation for long documents.**

L0's document window feature provides intelligent chunking, navigation, batch processing, and context restoration for documents that exceed model context limits.

---

## Table of Contents

- [Overview](#overview)
- [Quick Start](#quick-start)
- [Core Concepts](#core-concepts)
- [Chunking Strategies](#chunking-strategies)
- [Navigation](#navigation)
- [Batch Processing](#batch-processing)
- [Context Restoration](#context-restoration)
- [Real-World Examples](#real-world-examples)
- [API Reference](#api-reference)
- [Best Practices](#best-practices)

---

## Overview

### The Problem

Long documents exceed model context limits:

```typescript
// ❌ Document too long
const document = readFileSync('legal-contract.txt', 'utf-8'); // 50,000 tokens
const result = await streamText({
  model: openai('gpt-4o'), // Only 8k context
  prompt: `Summarize: ${document}` // Exceeds context!
});
```

**Result:** Truncated input, incomplete processing, or errors.

### The Solution

L0 Document Windows automatically chunk and process long documents:

```typescript
import { createWindow } from 'l0';

// Create window with automatic chunking
const window = createWindow(document, {
  size: 2000,    // 2000 tokens per chunk
  overlap: 200   // 200 token overlap between chunks
});

// Process all chunks
const results = await window.processAll((chunk) => ({
  stream: () => streamText({
    model: openai('gpt-4o'),
    prompt: `Summarize: ${chunk.content}`
  })
}));

// Merge results
const summary = results
  .map(r => r.result.state.content)
  .join('\n\n');
```

---

## Quick Start

### Basic Usage

```typescript
import { createWindow } from 'l0';
import { openai } from '@ai-sdk/openai';
import { streamText } from 'ai';

// 1. Create window
const window = createWindow(document, {
  size: 2000,
  overlap: 200,
  strategy: 'token'
});

console.log(`Document split into ${window.totalChunks} chunks`);

// 2. Navigate chunks
const firstChunk = window.current();
console.log('First chunk:', firstChunk?.content);

const secondChunk = window.next();
console.log('Second chunk:', secondChunk?.content);

// 3. Process specific chunk
const chunk = window.get(0);
const result = await l0({
  stream: () => streamText({
    model: openai('gpt-4o'),
    prompt: `Analyze: ${chunk.content}`
  })
});
```

### Batch Processing

```typescript
// Process all chunks in parallel
const results = await window.processAll((chunk) => ({
  stream: () => streamText({
    model: openai('gpt-4o'),
    prompt: `Extract key points from: ${chunk.content}`
  }),
  retry: { attempts: 2 }
}));

// Check results
results.forEach((r, i) => {
  if (r.status === 'success') {
    console.log(`Chunk ${i}: ${r.result.state.content}`);
  } else {
    console.error(`Chunk ${i} failed: ${r.error?.message}`);
  }
});
```

---

## Core Concepts

### 1. Chunks

A chunk is a piece of the original document:

```typescript
interface DocumentChunk {
  index: number;           // Chunk position (0-based)
  content: string;         // Chunk text
  startPos: number;        // Start position in document
  endPos: number;          // End position in document
  tokenCount: number;      // Estimated tokens
  charCount: number;       // Character count
  isFirst: boolean;        // First chunk?
  isLast: boolean;         // Last chunk?
  totalChunks: number;     // Total number of chunks
}
```

### 2. Overlap

Overlap ensures context continuity between chunks:

```typescript
const window = createWindow(document, {
  size: 2000,
  overlap: 200  // Last 200 tokens of chunk N = first 200 tokens of chunk N+1
});

// Chunk 0: tokens 0-2000
// Chunk 1: tokens 1800-3800 (200 token overlap with chunk 0)
// Chunk 2: tokens 3600-5600 (200 token overlap with chunk 1)
```

### 3. Window Navigation

Navigate through chunks like pages in a book:

```typescript
const window = createWindow(document, { size: 2000 });

window.current();  // Get current chunk
window.next();     // Move to next chunk
window.prev();     // Move to previous chunk
window.jump(5);    // Jump to chunk 5
window.reset();    // Back to first chunk

window.hasNext();  // Check if next exists
window.hasPrev();  // Check if prev exists
```

---

## Chunking Strategies

### 1. Token-Based (Default)

Chunks by estimated token count:

```typescript
const window = createWindow(document, {
  size: 2000,
  strategy: 'token'
});
```

**Best for:** General-purpose, model context limits

**Pros:**
- Respects model token limits
- Predictable chunk sizes
- Works with any text

**Cons:**
- Token estimation is approximate
- May split mid-sentence

---

### 2. Character-Based

Chunks by character count:

```typescript
const window = createWindow(document, {
  size: 5000,        // 5000 characters
  overlap: 500,
  strategy: 'char'
});
```

**Best for:** Fixed-length requirements, simple text

**Pros:**
- Exact character counts
- Fast processing
- No token estimation needed

**Cons:**
- Doesn't respect model token limits
- May split mid-word

---

### 3. Paragraph-Based

Chunks by paragraphs (respecting size limit):

```typescript
const window = createWindow(document, {
  size: 2000,
  strategy: 'paragraph'
});
```

**Best for:** Structured documents, articles, reports

**Pros:**
- Preserves semantic units
- Natural break points
- Readable chunks

**Cons:**
- Variable chunk sizes
- Large paragraphs may exceed limit

---

### 4. Sentence-Based

Chunks by sentences (respecting size limit):

```typescript
const window = createWindow(document, {
  size: 1500,
  strategy: 'sentence'
});
```

**Best for:** Precise chunking, summaries, analysis

**Pros:**
- Never splits sentences
- Most natural boundaries
- Clean chunks

**Cons:**
- More complex processing
- Long sentences may exceed limit

---

## Navigation

### Basic Navigation

```typescript
const window = createWindow(document, { size: 2000 });

// Get specific chunk
const chunk = window.get(0);       // First chunk
const chunk = window.get(5);       // 6th chunk

// Navigate sequentially
window.current();  // Get current chunk
window.next();     // Move to next, return chunk
window.prev();     // Move to prev, return chunk

// Jump around
window.jump(10);   // Jump to chunk 10
window.reset();    // Back to first chunk
```

### Check Boundaries

```typescript
if (window.hasNext()) {
  window.next();
}

if (window.hasPrev()) {
  window.prev();
}

console.log(`On chunk ${window.currentIndex + 1} of ${window.totalChunks}`);
```

### Get Multiple Chunks

```typescript
// Get all chunks
const allChunks = window.getAllChunks();

// Get range
const middle = window.getRange(5, 10); // Chunks 5-9

// Get surrounding context
const context = window.getRange(
  Math.max(0, currentIndex - 1),
  Math.min(window.totalChunks, currentIndex + 2)
);
```

---

## Batch Processing

### Parallel Processing (Default)

Process all chunks in parallel with concurrency control:

```typescript
const results = await window.processAll((chunk) => ({
  stream: () => streamText({
    model: openai('gpt-4o'),
    prompt: `Summarize: ${chunk.content}`
  })
}));

// Or with explicit parallel call
const results = await window.processParallel(
  (chunk) => ({
    stream: () => streamText({ model, prompt: chunk.content })
  }),
  { concurrency: 5 }  // 5 chunks at a time
);
```

### Sequential Processing

Process chunks one at a time:

```typescript
const results = await window.processSequential((chunk) => ({
  stream: () => streamText({
    model: openai('gpt-4o'),
    prompt: `Process chunk ${chunk.index + 1}/${chunk.totalChunks}: ${chunk.content}`
  })
}));
```

**When to use:**
- Order matters (e.g., maintaining context)
- Rate limit concerns
- Memory constraints

### Custom Processing

```typescript
// Process only specific chunks
const importantChunks = window.getRange(0, 5);

for (const chunk of importantChunks) {
  const result = await l0({
    stream: () => streamText({
      model: openai('gpt-4o'),
      prompt: `Analyze: ${chunk.content}`
    })
  });
  
  console.log(`Chunk ${chunk.index}:`, result.state.content);
}
```

---

## Context Restoration

Automatically restore context if model drifts or fails:

```typescript
import { l0WithWindow } from 'l0';

const window = createWindow(document, { size: 2000 });

const result = await l0WithWindow({
  window,
  chunkIndex: 0,
  stream: () => streamText({
    model: openai('gpt-4o'),
    prompt: `Summarize: ${window.get(0)?.content}`
  }),
  contextRestoration: {
    enabled: true,
    strategy: 'adjacent',  // Try adjacent chunks if drift detected
    maxAttempts: 2,
    onRestore: (from, to) => {
      console.log(`Context restored: chunk ${from} → ${to}`);
    }
  }
});
```

### Restoration Strategies

#### 1. Adjacent (Default)

Try next/previous chunks:

```typescript
contextRestoration: {
  strategy: 'adjacent'
}

// If chunk 5 fails → try chunk 6, then chunk 4
```

#### 2. Overlap

Try chunks with more overlap:

```typescript
contextRestoration: {
  strategy: 'overlap'
}

// Increases overlap and retries
```

#### 3. Full

Use full surrounding context:

```typescript
contextRestoration: {
  strategy: 'full'
}

// Includes prev + current + next chunks
```

---

## Real-World Examples

### Example 1: Legal Document Analysis

```typescript
import { createWindow, mergeResults } from 'l0';

// Load large legal contract
const contract = readFileSync('contract.txt', 'utf-8'); // 30,000 tokens

// Create window
const window = createWindow(contract, {
  size: 2000,
  overlap: 200,
  strategy: 'paragraph'
});

// Extract key clauses from each section
const results = await window.processAll((chunk) => ({
  stream: () => streamText({
    model: openai('gpt-4o'),
    prompt: `Extract key legal clauses and obligations from this section:\n\n${chunk.content}`
  }),
  retry: { attempts: 2 }
}));

// Combine all extracted clauses
const allClauses = mergeResults(results);
console.log('Extracted Clauses:', allClauses);

// Get statistics
const stats = getProcessingStats(results);
console.log(`Processed ${stats.successful}/${stats.total} chunks`);
console.log(`Success rate: ${stats.successRate.toFixed(1)}%`);
```

### Example 2: Transcript Summarization

```typescript
import { createWindow } from 'l0';

// Long meeting transcript
const transcript = loadTranscript('meeting.txt'); // 15,000 tokens

const window = createWindow(transcript, {
  size: 3000,
  overlap: 300,
  strategy: 'sentence'
});

// Summarize each section
const summaries = await window.processSequential((chunk) => ({
  stream: () => streamText({
    model: openai('gpt-4o'),
    prompt: `Summarize this part of the meeting transcript in 2-3 sentences:\n\n${chunk.content}`
  })
}));

// Create final summary
const finalSummary = summaries
  .filter(r => r.status === 'success')
  .map((r, i) => `**Section ${i + 1}:** ${r.result.state.content}`)
  .join('\n\n');

console.log('Meeting Summary:\n', finalSummary);
```

### Example 3: Book Chapter Analysis

```typescript
import { createWindow, largeWindow } from 'l0';

// Full book chapter
const chapter = readFileSync('chapter1.txt', 'utf-8');

const window = createWindow(chapter, largeWindow); // 4000 token chunks

// Extract themes and key points
const analysis = await window.processParallel(
  (chunk) => ({
    stream: () => streamText({
      model: openai('gpt-4o'),
      prompt: `Analyze this section for:
1. Main themes
2. Character development
3. Key events

Section ${chunk.index + 1}/${chunk.totalChunks}:
${chunk.content}`
    }),
    monitoring: { enabled: true }
  }),
  { concurrency: 3 }
);

// Aggregate analysis
const themes = new Set();
const events = [];

analysis.forEach((r, i) => {
  if (r.status === 'success') {
    console.log(`\nSection ${i + 1} Analysis:`);
    console.log(r.result.state.content);
  }
});
```

### Example 4: Code Documentation Generation

```typescript
import { createWindow } from 'l0';

// Large codebase file
const sourceCode = readFileSync('app.ts', 'utf-8');

const window = createWindow(sourceCode, {
  size: 1500,
  overlap: 150,
  strategy: 'paragraph'
});

// Generate documentation for each section
const docs = await window.processAll((chunk) => ({
  stream: () => streamText({
    model: openai('gpt-4o'),
    prompt: `Generate technical documentation for this code:

\`\`\`typescript
${chunk.content}
\`\`\`

Include:
- Purpose
- Parameters
- Return value
- Usage example`
  })
}));

// Compile full documentation
const documentation = docs
  .filter(r => r.status === 'success')
  .map(r => r.result.state.content)
  .join('\n\n---\n\n');

writeFileSync('docs.md', documentation);
```

---

## API Reference

### `createWindow(document, options)`

Create a document window:

```typescript
interface WindowOptions {
  size?: number;                    // Chunk size (default: 2000)
  overlap?: number;                 // Overlap size (default: 200)
  strategy?: ChunkStrategy;         // 'token' | 'char' | 'paragraph' | 'sentence'
  estimateTokens?: (text: string) => number;
  preserveParagraphs?: boolean;     // default: true
  preserveSentences?: boolean;      // default: false
  metadata?: Record<string, any>;
}

const window = createWindow(document, options);
```

### `DocumentWindow` Methods

```typescript
// Navigation
window.get(index: number): DocumentChunk | null
window.current(): DocumentChunk | null
window.next(): DocumentChunk | null
window.prev(): DocumentChunk | null
window.jump(index: number): DocumentChunk | null
window.reset(): DocumentChunk | null

// Queries
window.hasNext(): boolean
window.hasPrev(): boolean
window.getAllChunks(): DocumentChunk[]
window.getRange(start: number, end: number): DocumentChunk[]

// Processing
window.processAll(fn): Promise<WindowProcessResult[]>
window.processSequential(fn): Promise<WindowProcessResult[]>
window.processParallel(fn, opts): Promise<WindowProcessResult[]>

// Utilities
window.getStats(): WindowStats
window.findChunks(text: string): DocumentChunk[]
window.getChunksInRange(start: number, end: number): DocumentChunk[]
```

### `processWithWindow(document, fn, options)`

Helper for quick processing:

```typescript
const results = await processWithWindow(
  document,
  (chunk) => ({
    stream: () => streamText({ model, prompt: chunk.content })
  }),
  { size: 2000, overlap: 200 }
);
```

### Presets

```typescript
import {
  smallWindow,     // 1000 tokens, 100 overlap
  mediumWindow,    // 2000 tokens, 200 overlap (default)
  largeWindow,     // 4000 tokens, 400 overlap
  paragraphWindow, // Paragraph-based chunking
  sentenceWindow   // Sentence-based chunking
} from 'l0';

const window = createWindow(document, largeWindow);
```

---

## Best Practices

### 1. Choose Appropriate Chunk Size

```typescript
// ✅ Good: Based on model context limits
const window = createWindow(document, {
  size: 2000  // Leaves room for prompt + response in 8k context
});

// ❌ Bad: Too large for model
const window = createWindow(document, {
  size: 10000  // Exceeds most model limits
});
```

### 2. Use Overlap for Context Continuity

```typescript
// ✅ Good: 10% overlap
const window = createWindow(document, {
  size: 2000,
  overlap: 200  // 10% overlap
});

// ❌ Bad: No overlap (loses context)
const window = createWindow(document, {
  size: 2000,
  overlap: 0
});
```

### 3. Match Strategy to Content

```typescript
// Legal documents: preserve paragraphs
const window = createWindow(legalDoc, {
  strategy: 'paragraph'
});

// Transcripts: preserve sentences
const window = createWindow(transcript, {
  strategy: 'sentence'
});

// Code: token-based with paragraph boundaries
const window = createWindow(sourceCode, {
  strategy: 'token',
  preserveParagraphs: true
});
```

### 4. Handle Failures Gracefully

```typescript
const results = await window.processAll((chunk) => ({
  stream: () => streamText({ model, prompt: chunk.content }),
  retry: { attempts: 2 },
  fallbackStreams: [
    () => streamText({ model: cheaperModel, prompt: chunk.content })
  ]
}));

// Check for failures
const failed = results.filter(r => r.status === 'error');
if (failed.length > 0) {
  console.warn(`${failed.length} chunks failed:`, failed);
}
```

### 5. Use Monitoring for Long Documents

```typescript
const results = await window.processAll((chunk) => ({
  stream: () => streamText({ model, prompt: chunk.content }),
  monitoring: {
    enabled: true,
    metadata: {
      chunk_index: chunk.index,
      total_chunks: chunk.totalChunks
    }
  }
}));

// Analyze telemetry
results.forEach((r, i) => {
  if (r.result.telemetry) {
    console.log(`Chunk ${i}: ${r.result.telemetry.metrics.totalTokens} tokens`);
  }
});
```

### 6. Control Concurrency

```typescript
// For rate-limited APIs
const results = await window.processParallel(
  processFn,
  { concurrency: 2 }  // Only 2 concurrent requests
);

// For unlimited APIs
const results = await window.processParallel(
  processFn,
  { concurrency: 10 }  // Higher throughput
);
```

---

## Performance

### Chunking Performance

| Document Size | Strategy | Chunks | Time |
|---------------|----------|--------|------|
| 10k chars | Token | 5 | ~5ms |
| 50k chars | Token | 25 | ~20ms |
| 100k chars | Paragraph | 30 | ~50ms |
| 100k chars | Sentence | 35 | ~80ms |

### Processing Performance

```typescript
// Sequential: 10 chunks × 2s = 20s total
await window.processSequential(processFn);

// Parallel (5 concurrent): 10 chunks ÷ 5 = 4s total
await window.processParallel(processFn, { concurrency: 5 });
```

---

## Limitations

### 1. Token Estimation is Approximate

L0 uses rough token estimation (1 token ≈ 4 chars). For exact counts, use a tokenizer:

```typescript
import { encode } from 'gpt-tokenizer';

const window = createWindow(document, {
  size: 2000,
  estimateTokens: (text) => encode(text).length
});
```

### 2. Not a Replacement for RAG

Document windows are for **processing**, not **search**:

- ✅ Use windows: Summarize, extract, analyze
- ❌ Don't use windows: Semantic search, question answering

For RAG, use embeddings + vector DB.

### 3. Overlap Increases Cost

Overlap means repeated content:

```typescript
// 10 chunks × 2000 tokens = 20,000 tokens
// With 200 token overlap = 10 × 200 = 2,000 extra tokens
// Total: 22,000 tokens processed
```

Balance overlap vs. cost based on your needs.

---

## FAQ

**Q: What chunk size should I use?**  
A: Start with 2000 tokens (leaves room for 6k response in 8k context). Adjust based on your model.

**Q: How much overlap?**  
A: 10% of chunk size is a good starting point (e.g., 200 for 2000 token chunks).

**Q: Which strategy to use?**  
A: `'token'` for general use, `'paragraph'` for structured docs, `'sentence'` for precision.

**Q: Can I process chunks out of order?**  
A: Yes! Use `processParallel()` for independent chunks.

**Q: What if a single paragraph exceeds chunk size?**  
A: L0 automatically splits it further using character-based chunking.

**Q: How to handle failed chunks?**  
A: Use retry + fallbacks, then check `result.status === 'error'` to identify failures.

**Q: Can I merge results back into original document structure?**  
A: Yes! Use `chunk.startPos` and `chunk.endPos` to map back to original positions.

---

## Summary

L0 Document Windows provide:

✅ **Automatic chunking** - Token, character, paragraph, or sentence-based  
✅ **Smart overlap** - Maintains context between chunks  
✅ **Easy navigation** - next(), prev(), jump()  
✅ **Batch processing** - Sequential or parallel with concurrency control  
✅ **Context restoration** - Auto-retry with adjacent chunks on drift  
✅ **Integration with L0** - Works with all L0 features (retries, fallbacks, structured output)  

**Perfect for:**
- Summarization
- Extraction
- Legal document analysis
- Transcripts
- Books
- Code documentation
- Any document > model context limit

---

## See Also

- [README.md](./README.md) - Main L0 documentation
- [FALLBACK_MODELS.md](./FALLBACK_MODELS.md) - Fall-through model retries
- [STRUCTURED_OUTPUT.md](./STRUCTURED_OUTPUT.md) - Deterministic JSON output
- [API.md](./API.md) - Complete API reference