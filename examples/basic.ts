// Basic L0 Usage Example
// This example demonstrates how to use L0 for reliable LLM streaming

import { l0, recommendedGuardrails, recommendedRetry } from "../src/index";

// Example 1: Basic streaming with guardrails
async function basicExample() {
  console.log("=== Basic Example ===\n");

  const result = await l0({
    stream: async () => {
      // Mock stream function - replace with actual streamText() call
      // Example with Vercel AI SDK:
      // return streamText({
      //   model: openai('gpt-4o-mini'),
      //   prompt: 'Generate a JSON object with name and age'
      // });

      return mockStream('{"name": "Alice", "age": 30}');
    },
    guardrails: recommendedGuardrails,
    retry: recommendedRetry,
  });

  // Consume the stream
  for await (const event of result.stream) {
    if (event.type === "token") {
      process.stdout.write(event.value || "");
    } else if (event.type === "done") {
      console.log("\n✓ Stream completed");
    } else if (event.type === "error") {
      console.error("\n✗ Error:", event.error?.message);
    }
  }

  console.log("\nFinal state:", {
    tokens: result.state.tokenCount,
    retries: result.state.retryAttempts,
    completed: result.state.completed,
  });
}

// Example 2: JSON-only output with strict validation
async function jsonExample() {
  console.log("\n=== JSON Example ===\n");

  const result = await l0({
    stream: async () => {
      return mockStream('{"status": "success", "data": [1, 2, 3]}');
    },
    guardrails: [
      // Use JSON-specific guardrails
      ...recommendedGuardrails.filter((g) => g.name.includes("json")),
    ],
    retry: {
      attempts: 3,
      backoff: "exponential",
      baseDelay: 500,
      retryOn: ["guardrail_violation", "malformed"],
    },
    detectZeroTokens: true,
  });

  let content = "";
  for await (const event of result.stream) {
    if (event.type === "token" && event.value) {
      content += event.value;
    }
  }

  console.log("Output:", content);

  // Parse and validate JSON
  try {
    const parsed = JSON.parse(content);
    console.log("✓ Valid JSON:", parsed);
  } catch (err) {
    console.error("✗ Invalid JSON");
  }
}

// Example 3: With callbacks and monitoring
async function monitoringExample() {
  console.log("\n=== Monitoring Example ===\n");

  const result = await l0({
    stream: async () => {
      return mockStream("This is a test response with proper formatting.");
    },
    guardrails: recommendedGuardrails,
    retry: recommendedRetry,

    // Event callback
    onEvent: (event) => {
      if (event.type === "token") {
        // Track token rate, etc.
      }
    },

    // Violation callback
    onViolation: (violation) => {
      console.warn(
        `⚠ Guardrail violation: ${violation.rule} - ${violation.message}`,
      );
    },

    // Retry callback
    onRetry: (attempt, reason) => {
      console.log(`↻ Retry attempt ${attempt}: ${reason}`);
    },
  });

  for await (const event of result.stream) {
    if (event.type === "token") {
      process.stdout.write(event.value || "");
    }
  }

  console.log("\n✓ Completed");
}

// Example 4: With drift detection
async function driftDetectionExample() {
  console.log("\n=== Drift Detection Example ===\n");

  const result = await l0({
    stream: async () => {
      return mockStream(
        "I will help you with that. As an AI assistant, I should mention...",
      );
    },
    guardrails: recommendedGuardrails,
    retry: recommendedRetry,
    detectDrift: true, // Enable drift detection
  });

  for await (const event of result.stream) {
    if (event.type === "token") {
      process.stdout.write(event.value || "");
    }
  }

  if (result.state.driftDetected) {
    console.log("\n⚠ Drift detected in output");
  } else {
    console.log("\n✓ No drift detected");
  }
}

// Example 5: With timeout handling
async function timeoutExample() {
  console.log("\n=== Timeout Example ===\n");

  const result = await l0({
    stream: async () => {
      return mockSlowStream("Slow response...");
    },
    guardrails: recommendedGuardrails,
    retry: recommendedRetry,
    timeout: {
      initialToken: 2000, // 2 seconds to first token
      interToken: 5000, // 5 seconds between tokens
    },
  });

  try {
    for await (const event of result.stream) {
      if (event.type === "token") {
        process.stdout.write(event.value || "");
      }
    }
    console.log("\n✓ Completed within timeout");
  } catch (err) {
    console.error("\n✗ Timeout error:", (err as Error).message);
  }
}

// Example 6: Custom guardrails
async function customGuardrailsExample() {
  console.log("\n=== Custom Guardrails Example ===\n");

  const result = await l0({
    stream: async () => {
      return mockStream("Response with custom validation.");
    },
    guardrails: [
      // Custom guardrail
      {
        name: "custom-length",
        description: "Ensure minimum length",
        check: (context) => {
          if (context.isComplete && context.content.length < 10) {
            return [
              {
                rule: "custom-length",
                message: "Output too short",
                severity: "error" as const,
                recoverable: true,
              },
            ];
          }
          return [];
        },
      },
      ...recommendedGuardrails,
    ],
    retry: recommendedRetry,
  });

  for await (const event of result.stream) {
    if (event.type === "token") {
      process.stdout.write(event.value || "");
    }
  }

  console.log("\n✓ Custom guardrails passed");
}

// Mock stream helper
async function* mockStream(text: string) {
  // Simulate streaming by yielding character by character
  for (const char of text) {
    await sleep(10); // Simulate network delay
    yield {
      type: "text-delta",
      textDelta: char,
    };
  }
  yield { type: "finish" };
}

// Mock slow stream helper
async function* mockSlowStream(text: string) {
  await sleep(3000); // Simulate slow first token
  for (const char of text) {
    await sleep(100);
    yield {
      type: "text-delta",
      textDelta: char,
    };
  }
  yield { type: "finish" };
}

// Helper
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Example 7: Fall-Through Model Retries
async function fallbackModelExample() {
  console.log("\n=== Fall-Through Model Retries Example ===\n");

  const result = await l0({
    stream: async () => {
      // Simulate primary model failing
      throw new Error("Primary model unavailable");
    },
    fallbackStreams: [
      // Fallback 1: Cheaper model
      async () => {
        console.log("→ Falling back to cheaper model...");
        return mockStream(
          "Response from fallback model: Task completed successfully.",
        );
      },
      // Fallback 2: Even cheaper model if first fallback fails
      async () => {
        console.log("→ Falling back to budget model...");
        return mockStream("Budget model response.");
      },
    ],
    guardrails: recommendedGuardrails,
    retry: recommendedRetry,
  });

  for await (const event of result.stream) {
    if (event.type === "token") {
      process.stdout.write(event.value || "");
    }
  }

  console.log("\n\nFallback Info:");
  console.log(`  Used fallback index: ${result.state.fallbackIndex}`);
  console.log(`  Total retries: ${result.state.retryAttempts}`);
  console.log(`  Completed: ${result.state.completed}`);
}

// Example 8: Financial App with High Availability
async function financialAppExample() {
  console.log("\n=== Financial App: High Availability Pattern ===\n");

  const prompt = "Validate this transaction: amount=$1000, account=123456";

  const result = await l0({
    stream: async () => {
      // Primary: GPT-4 for accuracy
      return mockStream(
        '{"valid": true, "risk_score": 0.05, "approved": true}',
      );
    },
    fallbackStreams: [
      // Fallback 1: GPT-3.5 for validation
      async () => {
        console.log("⚠ Primary model failed, using validation model...");
        return mockStream(
          '{"valid": true, "risk_score": 0.1, "approved": true}',
        );
      },
      // Fallback 2: Anthropic as last resort
      async () => {
        console.log("⚠ Both OpenAI models failed, using Anthropic...");
        return mockStream(
          '{"valid": true, "risk_score": 0.08, "approved": true}',
        );
      },
    ],
    guardrails: recommendedGuardrails,
    retry: {
      attempts: 2,
      backoff: "exponential",
      baseDelay: 500,
    },
    monitoring: {
      enabled: true,
      metadata: {
        transaction_type: "validation",
        amount: 1000,
        critical: true,
      },
    },
  });

  let jsonResponse = "";
  for await (const event of result.stream) {
    if (event.type === "token" && event.value) {
      jsonResponse += event.value;
    }
  }

  const parsed = JSON.parse(jsonResponse);
  console.log("\nTransaction Result:", parsed);
  console.log(
    `Model Used: ${result.state.fallbackIndex === 0 ? "Primary (GPT-4)" : `Fallback ${result.state.fallbackIndex}`}`,
  );
  console.log(
    `Reliability: ${result.state.completed ? "✓ Success" : "✗ Failed"}`,
  );
}

// Run all examples
// Example 9: Structured Output with Schema Validation
async function structuredOutputExample() {
  console.log("\n=== Structured Output Example ===\n");

  const { structured } = await import("../src/structured");
  const { z } = await import("zod");

  const schema = z.object({
    name: z.string(),
    age: z.number(),
    email: z.string().email(),
    active: z.boolean(),
  });

  const result = await structured({
    schema,
    stream: async () => {
      return mockStream(
        '{"name": "Alice", "age": 30, "email": "alice@example.com", "active": true}',
      );
    },
    autoCorrect: true,
  });

  console.log("Validated data:", result.data);
  console.log("Was auto-corrected:", result.corrected);
  console.log("Type-safe access:", result.data.name, result.data.age);
}

// Example 10: Structured Output with Auto-Correction
async function structuredAutoCorrectionExample() {
  console.log("\n=== Structured Auto-Correction Example ===\n");

  const { structured } = await import("../src/structured");
  const { z } = await import("zod");

  const schema = z.object({
    status: z.string(),
    count: z.number(),
    items: z.array(z.string()),
  });

  // Simulate malformed JSON from LLM
  const result = await structured({
    schema,
    stream: async () => {
      // Missing closing brace, trailing comma, markdown fence
      return mockStream(`\`\`\`json
{"status": "success", "count": 3, "items": ["a", "b", "c"],
\`\`\``);
    },
    autoCorrect: true,
    onAutoCorrect: (info) => {
      console.log("Auto-corrections applied:", info.corrections);
    },
  });

  console.log("✓ Successfully parsed despite malformed JSON");
  console.log("Data:", result.data);
  console.log("Corrections:", result.corrections);
}

// Example 11: Structured Output for Financial Data
async function structuredFinancialExample() {
  console.log("\n=== Structured Financial Data Example ===\n");

  const { structured } = await import("../src/structured");
  const { z } = await import("zod");

  const transactionSchema = z.object({
    amount: z.number().positive(),
    currency: z.enum(["USD", "EUR", "GBP"]),
    approved: z.boolean(),
    risk_score: z.number().min(0).max(1),
    reason: z.string().optional(),
  });

  const result = await structured({
    schema: transactionSchema,
    stream: async () => {
      return mockStream(
        '{"amount": 1000, "currency": "USD", "approved": true, "risk_score": 0.05}',
      );
    },
    fallbackStreams: [
      async () => {
        return mockStream(
          '{"amount": 1000, "currency": "USD", "approved": true, "risk_score": 0.1}',
        );
      },
    ],
    retry: {
      attempts: 2,
      backoff: "exponential",
    },
    monitoring: {
      enabled: true,
      metadata: {
        transaction_type: "validation",
        critical: true,
      },
    },
  });

  console.log("Transaction validated:", result.data);
  console.log("Amount:", `${result.data.currency} ${result.data.amount}`);
  console.log("Approved:", result.data.approved ? "✓" : "✗");
  console.log("Risk score:", result.data.risk_score);
}

// Example 12: Structured Array Output
async function structuredArrayExample() {
  console.log("\n=== Structured Array Example ===\n");

  const { structuredArray } = await import("../src/structured");
  const { z } = await import("zod");

  const itemSchema = z.object({
    id: z.number(),
    name: z.string(),
    price: z.number(),
  });

  const result = await structuredArray(itemSchema, {
    stream: async () => {
      return mockStream(
        '[{"id": 1, "name": "Product A", "price": 10}, {"id": 2, "name": "Product B", "price": 20}]',
      );
    },
  });

  console.log("Array data:", result.data);
  console.log(`Found ${result.data.length} items`);
  result.data.forEach((item) => {
    console.log(`  - ${item.name}: $${item.price}`);
  });
}

async function runExamples() {
  try {
    await basicExample();
    await jsonExample();
    await monitoringExample();
    await driftDetectionExample();
    await timeoutExample();
    await customGuardrailsExample();
    await fallbackModelExample();
    await financialAppExample();
    await structuredOutputExample();
    await structuredAutoCorrectionExample();
    await structuredFinancialExample();
    await structuredArrayExample();
  } catch (err) {
    console.error("Error running examples:", err);
  }
}

// Uncomment to run:
// runExamples();

export {
  basicExample,
  jsonExample,
  monitoringExample,
  driftDetectionExample,
  timeoutExample,
  customGuardrailsExample,
  fallbackModelExample,
  financialAppExample,
  structuredOutputExample,
  structuredAutoCorrectionExample,
  structuredFinancialExample,
  structuredArrayExample,
};
