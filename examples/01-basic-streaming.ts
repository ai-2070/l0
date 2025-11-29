// Basic L0 Streaming Example
// Run: OPENAI_API_KEY=sk-... npx tsx examples/01-basic-streaming.ts

import { l0, recommendedGuardrails, recommendedRetry } from "../src/index";
import { streamText } from "ai";
import { openai } from "@ai-sdk/openai";

async function main() {
  console.log("=== Basic Streaming Example ===\n");

  const result = await l0({
    stream: () =>
      streamText({
        model: openai("gpt-4o-mini"),
        prompt: "Write a haiku about TypeScript",
      }),
    guardrails: recommendedGuardrails,
    retry: recommendedRetry,
  });

  // Consume the stream
  for await (const event of result.stream) {
    switch (event.type) {
      case "token":
        process.stdout.write(event.value || "");
        break;
      case "done":
        console.log("\n\n✓ Stream completed");
        break;
      case "error":
        console.error("\n✗ Error:", event.error?.message);
        break;
    }
  }

  // Access final state
  console.log("\nFinal state:", {
    tokens: result.state.tokenCount,
    content: result.state.content,
  });
}

main().catch(console.error);
