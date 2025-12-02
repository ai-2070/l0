/**
 * Example 12: Lifecycle Callbacks
 *
 * Demonstrates how to use L0's lifecycle callbacks for monitoring,
 * logging, and responding to runtime events.
 *
 * Run: OPENAI_API_KEY=sk-... npx tsx examples/12-lifecycle-callbacks.ts
 */

import { l0, recommendedGuardrails } from "@ai2070/l0";
import { streamText } from "ai";
import { openai } from "@ai-sdk/openai";

const model = openai("gpt-4o-mini");
const fallbackModel = openai("gpt-4o");

// -----------------------------------------------------------------------------
// Example 1: Basic Lifecycle Callbacks
// -----------------------------------------------------------------------------
async function basicCallbacks() {
  console.log("=== Basic Lifecycle Callbacks ===\n");

  const result = await l0({
    stream: () =>
      streamText({
        model,
        prompt: "Write a haiku about TypeScript.",
      }),

    // Called when execution starts
    onStart: (attempt, isRetry, isFallback) => {
      console.log(`[onStart] Attempt ${attempt}`);
      if (isRetry) console.log("  (this is a retry)");
      if (isFallback) console.log("  (using fallback model)");
    },

    // Called when stream completes successfully
    onComplete: (state) => {
      console.log(`[onComplete] Finished with ${state.tokenCount} tokens`);
      console.log(`  Duration: ${state.duration}ms`);
    },

    // Called for every streaming event
    onEvent: (event) => {
      if (event.type === "token") {
        process.stdout.write(event.value || "");
      }
    },
  });

  // Consume stream
  for await (const event of result.stream) {
    // Events already handled by onEvent
  }

  console.log("\n");
}

// -----------------------------------------------------------------------------
// Example 2: Error and Retry Callbacks
// -----------------------------------------------------------------------------
async function errorAndRetryCallbacks() {
  console.log("\n=== Error and Retry Callbacks ===\n");

  const result = await l0({
    stream: () =>
      streamText({
        model,
        prompt: "Generate a valid JSON object with name and age.",
      }),

    guardrails: recommendedGuardrails,
    retry: { attempts: 3 },

    onStart: (attempt, isRetry) => {
      console.log(`[onStart] Attempt ${attempt}${isRetry ? " (retry)" : ""}`);
    },

    // Called when an error occurs (before retry decision)
    onError: (error, willRetry, willFallback) => {
      console.log(`[onError] ${error.message}`);
      if (willRetry) console.log("  -> Will retry");
      if (willFallback) console.log("  -> Will try fallback");
      if (!willRetry && !willFallback) console.log("  -> Fatal, giving up");
    },

    // Called when a retry is triggered
    onRetry: (attempt, reason) => {
      console.log(`[onRetry] Attempt ${attempt}, reason: ${reason}`);
    },

    onComplete: (state) => {
      console.log(
        `[onComplete] Success after ${state.modelRetryCount} retries`,
      );
    },
  });

  for await (const event of result.stream) {
    if (event.type === "token") {
      process.stdout.write(event.value || "");
    }
  }

  console.log("\n");
}

// -----------------------------------------------------------------------------
// Example 3: Fallback Callbacks
// -----------------------------------------------------------------------------
async function fallbackCallbacks() {
  console.log("\n=== Fallback Callbacks ===\n");

  const prompt = "Explain recursion in one sentence.";

  const result = await l0({
    stream: () => streamText({ model, prompt }),

    fallbackStreams: [() => streamText({ model: fallbackModel, prompt })],

    retry: { attempts: 2 },

    onStart: (attempt, isRetry, isFallback) => {
      const status = isFallback ? "fallback" : isRetry ? "retry" : "initial";
      console.log(`[onStart] Attempt ${attempt} (${status})`);
    },

    // Called when switching to a fallback model
    onFallback: (index, reason) => {
      console.log(`[onFallback] Switching to fallback #${index}: ${reason}`);
    },

    onError: (error, willRetry, willFallback) => {
      console.log(`[onError] ${error.message}`);
      console.log(`  willRetry: ${willRetry}, willFallback: ${willFallback}`);
    },

    onComplete: (state) => {
      console.log(`[onComplete] Used fallback index: ${state.fallbackIndex}`);
    },
  });

  for await (const event of result.stream) {
    if (event.type === "token") {
      process.stdout.write(event.value || "");
    }
  }

  console.log("\n");
}

// -----------------------------------------------------------------------------
// Example 4: Guardrail Violation Callbacks
// -----------------------------------------------------------------------------
async function violationCallbacks() {
  console.log("\n=== Guardrail Violation Callbacks ===\n");

  const result = await l0({
    stream: () =>
      streamText({
        model,
        prompt: "Write a short greeting message.",
      }),

    guardrails: recommendedGuardrails,
    retry: { attempts: 2 },

    // Called when a guardrail violation is detected
    onViolation: (violation) => {
      console.log(`[onViolation] Rule: ${violation.rule}`);
      console.log(`  Message: ${violation.message}`);
      console.log(`  Severity: ${violation.severity}`);
      console.log(`  Recoverable: ${violation.recoverable}`);
    },

    onRetry: (attempt, reason) => {
      console.log(`[onRetry] Retrying due to: ${reason}`);
    },

    onComplete: (state) => {
      console.log(
        `[onComplete] Violations encountered: ${state.violations.length}`,
      );
    },
  });

  for await (const event of result.stream) {
    if (event.type === "token") {
      process.stdout.write(event.value || "");
    }
  }

  console.log("\n");
}

// -----------------------------------------------------------------------------
// Example 5: Checkpoint Resume Callbacks
// -----------------------------------------------------------------------------
async function resumeCallbacks() {
  console.log("\n=== Checkpoint Resume Callbacks ===\n");

  const result = await l0({
    stream: () =>
      streamText({
        model,
        prompt: "Write a paragraph about functional programming.",
      }),

    continueFromLastKnownGoodToken: true,
    checkIntervals: { checkpoint: 10 },
    retry: { attempts: 3 },

    onStart: (attempt, isRetry, isFallback) => {
      console.log(`[onStart] Attempt ${attempt}`);
    },

    // Called when resuming from a checkpoint
    onResume: (checkpoint, tokenCount) => {
      console.log(`[onResume] Resuming from checkpoint`);
      console.log(`  Tokens preserved: ${tokenCount}`);
      console.log(`  Checkpoint preview: "${checkpoint.slice(0, 40)}..."`);
    },

    onComplete: (state) => {
      console.log(`[onComplete] Resumed: ${state.resumed}`);
      if (state.resumePoint) {
        console.log(`  Resume point length: ${state.resumePoint.length}`);
      }
    },
  });

  for await (const event of result.stream) {
    if (event.type === "token") {
      process.stdout.write(event.value || "");
    }
  }

  console.log("\n");
}

// -----------------------------------------------------------------------------
// Example 6: Checkpoint, Timeout, Abort, and Drift Callbacks
// -----------------------------------------------------------------------------
async function advancedCallbacks() {
  console.log(
    "\n=== Advanced Callbacks (Checkpoint, Timeout, Abort, Drift) ===\n",
  );

  const abortController = new AbortController();

  const result = await l0({
    stream: () =>
      streamText({
        model,
        prompt:
          "Write a detailed explanation of how async/await works in JavaScript.",
      }),

    continueFromLastKnownGoodToken: true,
    checkIntervals: { checkpoint: 5 },
    detectDrift: true,
    timeout: {
      initialToken: 10000,
      interToken: 5000,
    },
    signal: abortController.signal,

    onStart: (attempt) => {
      console.log(`[onStart] Attempt ${attempt}`);
    },

    // Called when a checkpoint is saved
    onCheckpoint: (checkpoint, tokenCount) => {
      console.log(`[onCheckpoint] Saved at ${tokenCount} tokens`);
      console.log(`  Preview: "${checkpoint.slice(-30)}..."`);
    },

    // Called when a timeout occurs
    onTimeout: (type, elapsedMs) => {
      console.log(`[onTimeout] ${type} timeout after ${elapsedMs}ms`);
    },

    // Called when the stream is aborted
    onAbort: (tokenCount, contentLength) => {
      console.log(
        `[onAbort] Aborted after ${tokenCount} tokens (${contentLength} chars)`,
      );
    },

    // Called when drift is detected
    onDrift: (types, score) => {
      console.log(`[onDrift] Detected: ${types.join(", ")} (score: ${score})`);
    },

    onComplete: (state) => {
      console.log(`[onComplete] Finished with ${state.tokenCount} tokens`);
    },

    onEvent: (event) => {
      if (event.type === "token") {
        process.stdout.write(event.value || "");
      }
    },
  });

  for await (const event of result.stream) {
    // Events handled by onEvent
  }

  console.log("\n");
}

// -----------------------------------------------------------------------------
// Example 7: Complete Callback Suite (All Callbacks)
// -----------------------------------------------------------------------------
async function allCallbacks() {
  console.log("\n=== Complete Callback Suite ===\n");

  const prompt = "List 3 benefits of unit testing.";

  const result = await l0({
    stream: () => streamText({ model, prompt }),

    fallbackStreams: [() => streamText({ model: fallbackModel, prompt })],

    guardrails: recommendedGuardrails,
    continueFromLastKnownGoodToken: true,
    checkIntervals: { checkpoint: 8 },
    detectDrift: true,
    retry: { attempts: 2 },
    timeout: {
      initialToken: 10000,
      interToken: 5000,
    },

    // All lifecycle callbacks
    onStart: (attempt, isRetry, isFallback) => {
      const flags = [isRetry && "retry", isFallback && "fallback"]
        .filter(Boolean)
        .join(", ");
      console.log(`[START] Attempt ${attempt}${flags ? ` (${flags})` : ""}`);
    },

    onComplete: (state) => {
      console.log(`[COMPLETE] ${state.tokenCount} tokens, ${state.duration}ms`);
    },

    onError: (error, willRetry, willFallback) => {
      const action = willRetry ? "retry" : willFallback ? "fallback" : "fail";
      console.log(`[ERROR] ${error.message} -> ${action}`);
    },

    onEvent: (event) => {
      if (event.type === "token") {
        process.stdout.write(event.value || "");
      }
    },

    onViolation: (violation) => {
      console.log(`[VIOLATION] ${violation.rule}: ${violation.message}`);
    },

    onRetry: (attempt, reason) => {
      console.log(`[RETRY] Attempt ${attempt}: ${reason}`);
    },

    onFallback: (index, reason) => {
      console.log(`[FALLBACK] #${index}: ${reason}`);
    },

    onResume: (checkpoint, tokenCount) => {
      console.log(`[RESUME] From ${tokenCount} tokens`);
    },

    onCheckpoint: (checkpoint, tokenCount) => {
      console.log(`[CHECKPOINT] Saved at ${tokenCount} tokens`);
    },

    onTimeout: (type, elapsedMs) => {
      console.log(`[TIMEOUT] ${type} after ${elapsedMs}ms`);
    },

    onAbort: (tokenCount, contentLength) => {
      console.log(
        `[ABORT] After ${tokenCount} tokens (${contentLength} chars)`,
      );
    },

    onDrift: (types, score) => {
      console.log(`[DRIFT] ${types.join(", ")} (score: ${score})`);
    },
  });

  for await (const event of result.stream) {
    // Events handled by onEvent
  }

  console.log("\n");
}

// -----------------------------------------------------------------------------
// Run examples
// -----------------------------------------------------------------------------
async function main() {
  try {
    await basicCallbacks();
    await errorAndRetryCallbacks();
    await fallbackCallbacks();
    await violationCallbacks();
    await resumeCallbacks();
    await advancedCallbacks();
    await allCallbacks();

    console.log("=== All examples completed ===");
  } catch (error) {
    console.error("Error:", error);
    process.exit(1);
  }
}

main();
