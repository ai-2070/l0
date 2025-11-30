// Consensus Example
// Run: OPENAI_API_KEY=sk-... npx tsx examples/07-consensus.ts

import { consensus } from "../src/index";
import { streamText } from "ai";
import { openai } from "@ai-sdk/openai";

// Example 1: Majority consensus
async function majorityConsensus() {
  console.log("=== Majority Consensus ===\n");

  const prompt =
    "What is the capital of France? Answer with just the city name.";

  const result = await consensus({
    streams: [
      () => streamText({ model: openai("gpt-5-nano"), prompt }),
      () => streamText({ model: openai("gpt-5-nano"), prompt }),
      () => streamText({ model: openai("gpt-5-nano"), prompt }),
    ],
    strategy: "majority",
    threshold: 0.66,
  });

  console.log("Consensus:", result.consensus);
  console.log("Confidence:", result.confidence);
  console.log(
    "Individual responses:",
    result.outputs.map((o) => o.text.trim()),
  );
}

// Example 2: Unanimous consensus
async function unanimousConsensus() {
  console.log("\n=== Unanimous Consensus ===\n");

  const prompt = "What is 5 + 5? Answer with just the number.";

  const result = await consensus({
    streams: [
      () => streamText({ model: openai("gpt-5-nano"), prompt }),
      () => streamText({ model: openai("gpt-5-nano"), prompt }),
      () => streamText({ model: openai("gpt-5-nano"), prompt }),
    ],
    strategy: "unanimous",
  });

  console.log("Consensus:", result.consensus);
  console.log("Confidence:", result.confidence);
  console.log("Agreement reached:", result.confidence === 1);
}

// Example 3: Best response selection
async function bestResponse() {
  console.log("\n=== Best Response Selection ===\n");

  const prompt = "Write a one-sentence tagline for a coffee shop.";

  const result = await consensus({
    streams: [
      () => streamText({ model: openai("gpt-5-nano"), prompt }),
      () => streamText({ model: openai("gpt-5-nano"), prompt }),
      () => streamText({ model: openai("gpt-5-nano"), prompt }),
    ],
    strategy: "best",
  });

  console.log("Best tagline:", result.consensus);
  console.log("All options:");
  result.outputs.forEach((o, i) => {
    console.log(`  ${i + 1}. ${o.text.trim()}`);
  });
}

async function main() {
  await majorityConsensus();
  await unanimousConsensus();
  await bestResponse();
}

main().catch(console.error);
