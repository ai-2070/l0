// Parallel and Race Example
// Run: OPENAI_API_KEY=sk-... npx tsx examples/06-parallel-and-race.ts

import { parallel, race, recommendedGuardrails } from "@ai2070/l0";
import { streamText } from "ai";
import { openai } from "@ai-sdk/openai";

// Example 1: Race - first response wins
async function raceExample() {
  console.log("=== Race Example ===\n");

  const result = await race([
    {
      stream: () =>
        streamText({
          model: openai("gpt-5-nano"),
          prompt: "What is 2+2? Answer in one word.",
        }),
    },
    {
      stream: () =>
        streamText({
          model: openai("gpt-4o"),
          prompt: "What is 2+2? Answer in one word.",
        }),
    },
  ]);

  console.log("Winner:", result.state.content);
  console.log("Winner Index:", result.winnerIndex);
}

// Example 2: Parallel execution
async function parallelExample() {
  console.log("\n=== Parallel Example ===\n");

  const prompts = ["Name a fruit", "Name a color", "Name an animal"];

  const results = await parallel(
    prompts.map((prompt) => ({
      stream: () =>
        streamText({
          model: openai("gpt-5-nano"),
          prompt,
        }),
      guardrails: recommendedGuardrails,
    })),
    { concurrency: 3 },
  );

  console.log("Results:");
  results.results.forEach((r, i) => {
    console.log(`  ${prompts[i]}: ${r?.state.content.trim()}`);
  });
  console.log(`\nSuccess: ${results.successCount}/${results.results.length}`);
}

// Example 3: Parallel with limited concurrency
async function batchedParallel() {
  console.log("\n=== Batched Parallel (concurrency=2) ===\n");

  const tasks = Array.from({ length: 5 }, (_, i) => ({
    stream: () =>
      streamText({
        model: openai("gpt-5-nano"),
        prompt: `Count to ${i + 1}`,
      }),
  }));

  const results = await parallel(tasks, {
    concurrency: 2,
    onProgress: (completed, total) => {
      console.log(`Progress: ${completed}/${total}`);
    },
  });

  console.log("\nAll done:", results.successCount, "succeeded");
}

async function main() {
  await raceExample();
  await parallelExample();
  await batchedParallel();
}

main().catch(console.error);
