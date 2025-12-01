// Fallback Models Example
// Run: OPENAI_API_KEY=sk-... npx tsx examples/03-fallback-models.ts

import { l0, recommendedGuardrails } from "@ai2070/l0";
import { streamText } from "ai";
import { openai } from "@ai-sdk/openai";

const prompt = "Explain quantum computing in one sentence";

async function main() {
  console.log("=== Fallback Models Example ===\n");

  const result = await l0({
    // Primary: GPT-4o
    stream: () =>
      streamText({
        model: openai("gpt-4o"),
        prompt,
      }),
    // Fallbacks: try cheaper/different models if primary fails
    fallbackStreams: [
      () =>
        streamText({
          model: openai("gpt-5-nano"),
          prompt,
        }),
      () =>
        streamText({
          model: openai("gpt-3.5-turbo"),
          prompt,
        }),
    ],
    guardrails: recommendedGuardrails,
  });

  for await (const event of result.stream) {
    if (event.type === "token") {
      process.stdout.write(event.value || "");
    }
  }

  console.log(
    "\n\nModel used:",
    result.state.fallbackIndex === 0
      ? "Primary (gpt-4o)"
      : `Fallback ${result.state.fallbackIndex}`,
  );
}

main().catch(console.error);
