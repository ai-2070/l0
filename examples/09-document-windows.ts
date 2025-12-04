// Document Windows Example
// Run: OPENAI_API_KEY=sk-... npx tsx examples/09-document-windows.ts

import {
  createWindow,
  processWithWindow,
  l0WithWindow,
  mergeResults,
  getProcessingStats,
  // Presets
  smallWindow,
  mediumWindow,
  largeWindow,
  paragraphWindow,
  sentenceWindow,
  // Types
  type DocumentChunk,
  type WindowStats,
  type WindowProcessResult,
} from "@ai2070/l0";
import { streamText } from "ai";
import { openai } from "@ai-sdk/openai";

const longDocument = `
Chapter 1: Introduction to Machine Learning

Machine learning is a subset of artificial intelligence that enables systems to learn and improve from experience without being explicitly programmed. It focuses on developing computer programs that can access data and use it to learn for themselves.

The process begins with observations or data, such as examples, direct experience, or instruction, to look for patterns in data and make better decisions in the future. The primary aim is to allow computers to learn automatically without human intervention.

Chapter 2: Types of Machine Learning

There are three main types of machine learning:

1. Supervised Learning: The algorithm learns from labeled training data and makes predictions based on that data. Examples include classification and regression problems.

2. Unsupervised Learning: The algorithm learns from unlabeled data, finding hidden patterns or intrinsic structures. Examples include clustering and dimensionality reduction.

3. Reinforcement Learning: The algorithm learns by interacting with an environment, receiving rewards or penalties for actions taken. Examples include game playing and robotics.

Chapter 3: Applications

Machine learning has numerous applications across industries:
- Healthcare: Disease diagnosis, drug discovery
- Finance: Fraud detection, algorithmic trading
- Transportation: Self-driving cars, route optimization
- Retail: Recommendation systems, inventory management
`;

// Example 1: Process document in chunks with statistics
async function processChunks() {
  console.log("=== Process Document in Chunks ===\n");

  // Using paragraph preset
  const window = createWindow(longDocument, {
    ...paragraphWindow,
    size: 500,
    overlap: 50,
  });

  // Get window statistics
  const stats: WindowStats = window.getStats();
  console.log("Window statistics:");
  console.log(`  Total chunks: ${stats.totalChunks}`);
  console.log(`  Total chars: ${stats.totalChars}`);
  console.log(`  Total tokens: ${stats.totalTokens}`);
  console.log(`  Avg chunk size: ${stats.avgChunkSize}`);
  console.log(`  Strategy: ${stats.strategy}\n`);

  const summaries: string[] = [];

  for (let i = 0; i < window.totalChunks; i++) {
    const chunk = window.get(i);
    if (!chunk) continue;
    console.log(
      `Processing chunk ${i + 1}/${window.totalChunks} (${chunk.tokenCount} tokens)...`,
    );

    const result = await streamText({
      model: openai("gpt-4o-mini"),
      prompt: `Summarize this text in one sentence:\n\n${chunk.content}`,
    });

    let summary = "";
    for await (const text of result.textStream) {
      summary += text;
    }
    summaries.push(summary.trim());
  }

  console.log("\nChunk summaries:");
  summaries.forEach((s, i) => console.log(`  ${i + 1}. ${s}`));
}

// Example 2: Navigate chunks manually
async function navigateChunks() {
  console.log("\n=== Navigate Chunks Manually ===\n");

  // Using sentence window preset
  const window = createWindow(longDocument, {
    ...sentenceWindow,
    size: 400,
    overlap: 0,
  });

  console.log("First chunk:");
  const current = window.current();
  if (current) {
    console.log(`  Index: ${current.index}`);
    console.log(`  Position: ${current.startPos}-${current.endPos}`);
    console.log(`  Is first: ${current.isFirst}, Is last: ${current.isLast}`);
    console.log(`  Content: ${current.content.slice(0, 80)}...\n`);
  }

  console.log("Moving to next...");
  const next = window.next();
  if (next) {
    console.log(`  Index: ${next.index}`);
    console.log(`  Content: ${next.content.slice(0, 80)}...\n`);
  }

  console.log("Navigation state:");
  console.log(`  Current index: ${window.currentIndex}`);
  console.log(`  Has prev: ${window.hasPrev()}`);
  console.log(`  Has next: ${window.hasNext()}\n`);

  console.log("Jumping to last chunk...");
  const last = window.jump(window.totalChunks - 1);
  if (last) {
    console.log(`  Index: ${last.index}`);
    console.log(`  Is last: ${last.isLast}`);
    console.log(`  Content: ${last.content.slice(0, 80)}...\n`);
  }

  // Reset to beginning
  window.reset();
  console.log(`Reset to index: ${window.currentIndex}`);
}

// Example 3: Process all with L0 (parallel)
async function processAllWithL0() {
  console.log("\n=== Process All Chunks with L0 (Parallel) ===\n");

  // Using medium window preset
  const window = createWindow(longDocument, {
    ...mediumWindow,
    size: 600,
    overlap: 100,
  });

  const results = await window.processParallel(
    (chunk: DocumentChunk) => ({
      stream: () =>
        streamText({
          model: openai("gpt-4o-mini"),
          prompt: `Extract 2-3 key terms from this text. Return only the terms, comma-separated:\n\n${chunk.content}`,
        }),
      meta: { chunkIndex: chunk.index },
    }),
    { concurrency: 3 }, // Control parallelism
  );

  console.log("Key terms from each chunk:");
  results.forEach((r: WindowProcessResult, i: number) => {
    if (r.status === "success" && r.result) {
      console.log(`  Chunk ${i + 1}: ${r.result.state.content.trim()}`);
      console.log(`    Duration: ${r.duration}ms`);
    } else if (r.error) {
      console.log(`  Chunk ${i + 1}: ERROR - ${r.error.message}`);
    }
  });

  // Get processing statistics
  const procStats = getProcessingStats(results);
  console.log("\nProcessing statistics:");
  console.log(`  Total: ${procStats.total}`);
  console.log(`  Successful: ${procStats.successful}`);
  console.log(`  Failed: ${procStats.failed}`);
  console.log(`  Success rate: ${procStats.successRate.toFixed(1)}%`);
  console.log(`  Avg duration: ${procStats.avgDuration}ms`);
  console.log(`  Total duration: ${procStats.totalDuration}ms`);
}

// Example 4: Process sequentially
async function processSequential() {
  console.log("\n=== Process Chunks Sequentially ===\n");

  const window = createWindow(longDocument, smallWindow);

  const results = await window.processSequential((chunk: DocumentChunk) => ({
    stream: () =>
      streamText({
        model: openai("gpt-4o-mini"),
        prompt: `What is the main topic of this text? Reply in 3 words:\n\n${chunk.content}`,
      }),
  }));

  // Merge all results into single text
  const merged = mergeResults(results, " | ");
  console.log("Merged topics:", merged);
}

// Example 5: Using processWithWindow helper
async function processWithWindowHelper() {
  console.log("\n=== Using processWithWindow Helper ===\n");

  const results = await processWithWindow(
    longDocument,
    (chunk: DocumentChunk) => ({
      stream: () =>
        streamText({
          model: openai("gpt-4o-mini"),
          prompt: `Count the number of bullet points in this text. Reply with just the number:\n\n${chunk.content}`,
        }),
    }),
    { size: 800, overlap: 0, strategy: "paragraph" },
  );

  console.log("Bullet point counts per chunk:");
  results.forEach((r: WindowProcessResult, i: number) => {
    if (r.status === "success" && r.result) {
      console.log(`  Chunk ${i + 1}: ${r.result.state.content.trim()}`);
    }
  });
}

// Example 6: L0 with window and context restoration
async function l0WithWindowExample() {
  console.log("\n=== L0 with Window and Context Restoration ===\n");

  const window = createWindow(longDocument, mediumWindow);

  const result = await l0WithWindow({
    window,
    chunkIndex: 1,
    stream: () =>
      streamText({
        model: openai("gpt-4o-mini"),
        prompt: `Summarize the second section of this document:\n\n${window.get(1)?.content}`,
      }),
    contextRestoration: {
      enabled: true,
      strategy: "adjacent", // Try adjacent chunks on drift
      maxAttempts: 2,
      onRestore: (from, to) => {
        console.log(`Context restored: chunk ${from} -> ${to}`);
      },
    },
  });

  for await (const event of result.stream) {
    if (event.type === "text") {
      process.stdout.write(event.text);
    }
  }
  console.log("\n");
}

// Example 7: Finding and filtering chunks
async function findAndFilterChunks() {
  console.log("\n=== Finding and Filtering Chunks ===\n");

  const window = createWindow(longDocument, paragraphWindow);

  // Find chunks containing specific text
  const mlChunks = window.findChunks("Machine learning", false);
  console.log(`Chunks containing "Machine learning": ${mlChunks.length}`);
  mlChunks.forEach((chunk: DocumentChunk) => {
    console.log(`  - Chunk ${chunk.index}: ${chunk.content.slice(0, 50)}...`);
  });

  // Get chunks in a character range
  const rangeChunks = window.getChunksInRange(100, 500);
  console.log(`\nChunks in char range 100-500: ${rangeChunks.length}`);

  // Get a range of chunks
  const firstTwo = window.getRange(0, 2);
  console.log(`\nFirst two chunks: ${firstTwo.length}`);

  // Get context around a chunk (with surrounding chunks)
  const context = window.getContext(1, { before: 1, after: 1 });
  console.log(
    `\nContext around chunk 1 (with neighbors): ${context.length} chars`,
  );
}

// Example 8: Window presets comparison
function showPresets() {
  console.log("\n=== Window Presets ===\n");

  const presets = [
    { name: "smallWindow", ...smallWindow },
    { name: "mediumWindow", ...mediumWindow },
    { name: "largeWindow", ...largeWindow },
    { name: "paragraphWindow", ...paragraphWindow },
    { name: "sentenceWindow", ...sentenceWindow },
  ];

  console.log("Available presets:");
  console.log("| Preset          | Size  | Overlap | Strategy  |");
  console.log("|-----------------|-------|---------|-----------|");
  presets.forEach((p) => {
    console.log(
      `| ${p.name.padEnd(15)} | ${String(p.size).padEnd(5)} | ${String(p.overlap).padEnd(7)} | ${p.strategy.padEnd(9)} |`,
    );
  });
}

async function main() {
  showPresets();
  await processChunks();
  await navigateChunks();
  await processAllWithL0();
  await processSequential();
  await processWithWindowHelper();
  await l0WithWindowExample();
  await findAndFilterChunks();
}

main().catch(console.error);
