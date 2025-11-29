// Retry and Error Handling Example
// Run: OPENAI_API_KEY=sk-... npx tsx examples/10-retry-and-errors.ts

import {
  l0,
  recommendedGuardrails,
  recommendedRetry,
  isL0Error,
  isNetworkError,
  analyzeNetworkError,
} from "../src/index";
import { streamText } from "ai";
import { openai } from "@ai-sdk/openai";

// Example 1: Basic retry configuration
async function basicRetry() {
  console.log("=== Basic Retry ===\n");

  const result = await l0({
    stream: () =>
      streamText({
        model: openai("gpt-4o-mini"),
        prompt: "Say hello",
      }),
    retry: {
      attempts: 3,
      baseDelay: 1000,
      maxDelay: 10000,
      backoff: "exponential",
      retryOn: ["zero_output", "guardrail_violation", "network_error"],
    },
    onRetry: (attempt, reason) => {
      console.log(`Retry attempt ${attempt}: ${reason}`);
    },
  });

  for await (const event of result.stream) {
    if (event.type === "token") {
      process.stdout.write(event.value || "");
    }
  }
  console.log("\n\nRetries used:", result.state.retryAttempts);
}

// Example 2: Using recommended retry preset
async function recommendedRetryExample() {
  console.log("\n=== Recommended Retry Preset ===\n");

  console.log("recommendedRetry config:", recommendedRetry);

  const result = await l0({
    stream: () =>
      streamText({
        model: openai("gpt-4o-mini"),
        prompt: "Generate a random number between 1 and 100",
      }),
    retry: recommendedRetry,
    guardrails: recommendedGuardrails,
  });

  for await (const event of result.stream) {
    if (event.type === "token") {
      process.stdout.write(event.value || "");
    }
  }
  console.log("\n");
}

// Example 3: Error handling
async function errorHandling() {
  console.log("\n=== Error Handling ===\n");

  try {
    const result = await l0({
      stream: () =>
        streamText({
          model: openai("gpt-4o-mini"),
          prompt: "Hello",
        }),
      guardrails: recommendedGuardrails,
      retry: { attempts: 1 },
    });

    for await (const event of result.stream) {
      if (event.type === "token") {
        process.stdout.write(event.value || "");
      }
    }
    console.log("\n✓ Success");
  } catch (error) {
    if (isL0Error(error)) {
      console.log("L0 Error:");
      console.log("  Code:", error.code);
      console.log("  Message:", error.message);
      console.log("  Recoverable:", error.isRecoverable?.());
      console.log("  Checkpoint:", error.context?.checkpoint);
    } else if (isNetworkError(error)) {
      const analysis = analyzeNetworkError(error as Error);
      console.log("Network Error:");
      console.log("  Type:", analysis.type);
      console.log("  Retryable:", analysis.retryable);
      console.log("  Suggestion:", analysis.suggestion);
    } else {
      console.log("Unknown error:", error);
    }
  }
}

// Example 4: Timeouts
async function timeouts() {
  console.log("\n=== Timeout Configuration ===\n");

  const result = await l0({
    stream: () =>
      streamText({
        model: openai("gpt-4o-mini"),
        prompt: "Write a haiku",
      }),
    timeout: {
      initialToken: 5000, // 5s to first token
      interToken: 10000, // 10s between tokens
    },
    onEvent: (event) => {
      if (event.type === "token") {
        // Could track timing here
      }
    },
  });

  for await (const event of result.stream) {
    if (event.type === "token") {
      process.stdout.write(event.value || "");
    }
  }
  console.log("\n\n✓ Completed within timeouts");
}

// Example 5: Abort handling
async function abortHandling() {
  console.log("\n=== Abort Handling ===\n");

  const controller = new AbortController();

  // Abort after 100ms (will likely cut off response)
  setTimeout(() => {
    console.log("\n[Aborting...]");
    controller.abort();
  }, 100);

  try {
    const result = await l0({
      stream: () =>
        streamText({
          model: openai("gpt-4o-mini"),
          prompt: "Write a long story about a dragon",
        }),
      signal: controller.signal,
    });

    for await (const event of result.stream) {
      if (event.type === "token") {
        process.stdout.write(event.value || "");
      }
    }
  } catch (error) {
    if ((error as Error).name === "AbortError") {
      console.log("\n✓ Request was aborted as expected");
    } else {
      throw error;
    }
  }
}

async function main() {
  await basicRetry();
  await recommendedRetryExample();
  await errorHandling();
  await timeouts();
  await abortHandling();
}

main().catch(console.error);
