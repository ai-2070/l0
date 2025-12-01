// OpenAI SDK Direct Example (without Vercel AI SDK)
// Run: OPENAI_API_KEY=sk-... npx tsx examples/04-openai-sdk.ts

import OpenAI from "openai";
import {
  l0,
  openaiStream,
  openaiText,
  recommendedGuardrails,
} from "@ai2070/l0";

const client = new OpenAI();

// Example 1: Using openaiStream helper
async function withOpenaiStream() {
  console.log("=== OpenAI SDK with openaiStream ===\n");

  const result = await l0({
    stream: openaiStream(client, {
      model: "gpt-5-nano",
      messages: [{ role: "user", content: "Write a limerick about APIs" }],
    }),
    guardrails: recommendedGuardrails,
  });

  for await (const event of result.stream) {
    if (event.type === "token") {
      process.stdout.write(event.value || "");
    }
  }
  console.log("\n");
}

// Example 2: Using openaiText helper (simpler)
async function withOpenaiText() {
  console.log("=== OpenAI SDK with openaiText ===\n");

  const result = await l0({
    stream: openaiText(client, "gpt-5-nano", "What is 2 + 2? Answer briefly."),
    guardrails: recommendedGuardrails,
  });

  for await (const event of result.stream) {
    if (event.type === "token") {
      process.stdout.write(event.value || "");
    }
  }
  console.log("\n");
}

// Example 3: With tool calls
async function withTools() {
  console.log("=== OpenAI SDK with Tools ===\n");

  const result = await l0({
    stream: openaiStream(client, {
      model: "gpt-5-nano",
      messages: [{ role: "user", content: "What's the weather in Paris?" }],
      tools: [
        {
          type: "function",
          function: {
            name: "get_weather",
            description: "Get weather for a location",
            parameters: {
              type: "object",
              properties: {
                location: { type: "string", description: "City name" },
              },
              required: ["location"],
            },
          },
        },
      ],
    }),
    guardrails: recommendedGuardrails,
  });

  for await (const event of result.stream) {
    if (event.type === "token") {
      process.stdout.write(event.value || "");
    } else if (event.type === "message") {
      console.log("\nTool call:", event.value);
    }
  }
  console.log("\n");
}

async function main() {
  await withOpenaiStream();
  await withOpenaiText();
  await withTools();
}

main().catch(console.error);
