/**
 * Example 11: Last-Known-Good Token Resumption
 *
 * Demonstrates how L0 can resume from checkpoints when streams fail mid-generation,
 * preserving already-generated content and reducing retry latency.
 *
 * Run: OPENAI_API_KEY=sk-... npx tsx examples/11-continuation-resumption.ts
 */

import { l0 } from "@ai2070/l0";
import { streamText } from "ai";
import { openai } from "@ai-sdk/openai";

const model = openai("gpt-4o-mini");

// -----------------------------------------------------------------------------
// Example 1: Basic Continuation
// -----------------------------------------------------------------------------
async function basicContinuation() {
  console.log("=== Basic Continuation ===\n");

  const result = await l0({
    stream: () =>
      streamText({
        model,
        prompt: "Write a short paragraph about the benefits of clean code.",
      }),

    // Enable continuation from last checkpoint
    continueFromLastKnownGoodToken: true,

    // Save checkpoint every 10 tokens
    checkIntervals: { checkpoint: 10 },

    retry: { attempts: 3 },
  });

  for await (const event of result.stream) {
    if (event.type === "token") {
      process.stdout.write(event.value!);
    }
  }

  console.log("\n");

  // Check if continuation was used
  if (result.state.resumed) {
    console.log("Stream was resumed from checkpoint!");
    console.log("Resume point:", result.state.checkpoint?.slice(0, 50) + "...");
  } else {
    console.log("Stream completed without needing resumption.");
  }
}

// -----------------------------------------------------------------------------
// Example 2: Custom Continuation Prompt
// -----------------------------------------------------------------------------
async function customContinuationPrompt() {
  console.log("\n=== Custom Continuation Prompt ===\n");

  const originalPrompt = "Write a haiku about programming.";
  let continuationPrompt = "";

  const result = await l0({
    stream: () =>
      streamText({
        model,
        prompt: continuationPrompt || originalPrompt,
      }),

    continueFromLastKnownGoodToken: true,
    checkIntervals: { checkpoint: 5 },

    // Customize how the prompt is modified for continuation
    buildContinuationPrompt: (checkpoint) => {
      continuationPrompt = `${originalPrompt}\n\nContinue from where you left off. Here's what you wrote so far:\n${checkpoint}`;
      console.log("[Building continuation prompt with checkpoint]");
      return continuationPrompt;
    },

    retry: { attempts: 2 },
  });

  for await (const event of result.stream) {
    if (event.type === "token") {
      process.stdout.write(event.value!);
    }
  }

  console.log("\n");
}

// -----------------------------------------------------------------------------
// Example 3: Continuation with Fallback Models
// -----------------------------------------------------------------------------
async function continuationWithFallback() {
  console.log("\n=== Continuation with Fallback Models ===\n");

  const prompt = "List 5 benefits of test-driven development.";

  const result = await l0({
    stream: () => streamText({ model: openai("gpt-4o"), prompt }),

    // Fallback models will also benefit from continuation
    fallbackStreams: [
      () => streamText({ model: openai("gpt-4o-mini"), prompt }),
    ],

    continueFromLastKnownGoodToken: true,
    checkIntervals: { checkpoint: 8 },

    retry: { attempts: 2 },

    onRetry: (attempt, reason) => {
      console.log(`[Retry ${attempt}: ${reason}]`);
    },
  });

  for await (const event of result.stream) {
    if (event.type === "token") {
      process.stdout.write(event.value!);
    }
  }

  console.log("\n");

  // Check telemetry for continuation details
  if (result.telemetry?.continuation?.used) {
    console.log("Continuation was used!");
    console.log(
      "Checkpoint length:",
      result.telemetry.continuation.checkpointLength,
    );
  }
}

// -----------------------------------------------------------------------------
// Example 4: Deduplication Options
// -----------------------------------------------------------------------------
async function deduplicationOptions() {
  console.log("\n=== Deduplication Options ===\n");

  // When LLMs continue from a checkpoint, they often repeat words.
  // L0 automatically detects and removes this overlap.

  const result = await l0({
    stream: () =>
      streamText({
        model,
        prompt: "Write a brief explanation of recursion in programming.",
      }),

    continueFromLastKnownGoodToken: true,

    // Deduplication is enabled by default when continuation is enabled
    deduplicateContinuation: true,

    // Fine-tune deduplication behavior
    deduplicationOptions: {
      minOverlap: 3, // Minimum characters to consider as overlap
      maxOverlap: 200, // Maximum characters to search for overlap
      caseSensitive: false, // Ignore case when matching
      normalizeWhitespace: true, // Treat multiple spaces as one
    },

    checkIntervals: { checkpoint: 10 },
    retry: { attempts: 2 },
  });

  for await (const event of result.stream) {
    if (event.type === "token") {
      process.stdout.write(event.value!);
    }
  }

  console.log("\n");
}

// -----------------------------------------------------------------------------
// Example 5: Monitoring Continuation State
// -----------------------------------------------------------------------------
async function monitoringContinuation() {
  console.log("\n=== Monitoring Continuation State ===\n");

  const result = await l0({
    stream: () =>
      streamText({
        model,
        prompt:
          "Explain the concept of immutability in functional programming.",
      }),

    continueFromLastKnownGoodToken: true,
    checkIntervals: { checkpoint: 10 },
    retry: { attempts: 3 },

    // Monitor all events including internal state
    onEvent: (event) => {
      if (event.type === "complete") {
        console.log("\n[Stream complete]");
      }
    },
  });

  for await (const event of result.stream) {
    if (event.type === "token") {
      process.stdout.write(event.value!);
    }
  }

  // Detailed state inspection
  console.log("\n\n--- Final State ---");
  console.log("Content length:", result.state.content.length);
  console.log("Token count:", result.state.tokenCount);
  console.log("Resumed:", result.state.resumed);
  console.log("Model retries:", result.state.modelRetryCount);
  console.log("Network retries:", result.state.networkRetryCount);

  if (result.state.checkpoint) {
    console.log("Last checkpoint length:", result.state.checkpoint.length);
  }
}

// -----------------------------------------------------------------------------
// Run examples
// -----------------------------------------------------------------------------
async function main() {
  try {
    await basicContinuation();
    await customContinuationPrompt();
    await continuationWithFallback();
    await deduplicationOptions();
    await monitoringContinuation();

    console.log("\n=== All examples completed ===");
  } catch (error) {
    console.error("Error:", error);
    process.exit(1);
  }
}

main();
