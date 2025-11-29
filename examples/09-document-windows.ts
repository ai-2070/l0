// Document Windows Example
// Run: OPENAI_API_KEY=sk-... npx tsx examples/09-document-windows.ts

import { createWindow } from "../src/index";
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

// Example 1: Process document in chunks
async function processChunks() {
  console.log("=== Process Document in Chunks ===\n");

  const window = createWindow(longDocument, {
    size: 500,
    overlap: 50,
    strategy: "paragraph",
  });

  console.log(`Document split into ${window.totalChunks} chunks\n`);

  const summaries: string[] = [];

  for (let i = 0; i < window.totalChunks; i++) {
    const chunk = window.getChunk(i);
    console.log(`Processing chunk ${i + 1}/${window.totalChunks}...`);

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

  const window = createWindow(longDocument, {
    size: 400,
    overlap: 0,
    strategy: "sentence",
  });

  console.log("First chunk:");
  console.log(window.current().content.slice(0, 100) + "...\n");

  console.log("Moving to next...");
  const next = window.next();
  if (next) {
    console.log(next.content.slice(0, 100) + "...\n");
  }

  console.log("Jumping to last chunk...");
  const last = window.getChunk(window.totalChunks - 1);
  console.log(last.content.slice(0, 100) + "...\n");
}

// Example 3: Process all with L0
async function processAllWithL0() {
  console.log("\n=== Process All Chunks with L0 ===\n");

  const window = createWindow(longDocument, {
    size: 600,
    overlap: 100,
    strategy: "paragraph",
  });

  const results = await window.processAll((chunk) => ({
    stream: () =>
      streamText({
        model: openai("gpt-4o-mini"),
        prompt: `Extract 2-3 key terms from this text. Return only the terms, comma-separated:\n\n${chunk.content}`,
      }),
  }));

  console.log("Key terms from each chunk:");
  results.forEach((r, i) => {
    console.log(`  Chunk ${i + 1}: ${r.state.content.trim()}`);
  });
}

async function main() {
  await processChunks();
  await navigateChunks();
  await processAllWithL0();
}

main().catch(console.error);
