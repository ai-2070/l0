// Guardrails Example
// Run: OPENAI_API_KEY=sk-... npx tsx examples/05-guardrails.ts

import {
  l0,
  jsonRule,
  markdownRule,
  zeroOutputRule,
  patternRule,
  customPatternRule,
  recommendedGuardrails,
  strictGuardrails,
} from "../src/index";
import { streamText } from "ai";
import { openai } from "@ai-sdk/openai";

// Example 1: JSON validation
async function jsonGuardrail() {
  console.log("=== JSON Guardrail ===\n");

  const result = await l0({
    stream: () =>
      streamText({
        model: openai("gpt-5-nano"),
        prompt: "Generate a JSON object with name and age fields",
      }),
    guardrails: [jsonRule()],
    onViolation: (v) => console.log("Violation:", v.message),
  });

  let content = "";
  for await (const event of result.stream) {
    if (event.type === "token" && event.value) {
      content += event.value;
    }
  }

  console.log("Output:", content);
  console.log(
    "Valid JSON:",
    (() => {
      try {
        JSON.parse(content);
        return true;
      } catch {
        return false;
      }
    })(),
  );
}

// Example 2: Custom pattern detection
async function customPatterns() {
  console.log("\n=== Custom Pattern Detection ===\n");

  const result = await l0({
    stream: () =>
      streamText({
        model: openai("gpt-5-nano"),
        prompt: "Write a short greeting",
      }),
    guardrails: [
      patternRule(), // Detects "As an AI..." patterns
      customPatternRule(
        [/sorry/i, /apologize/i, /unfortunately/i],
        "Detected apologetic language",
      ),
    ],
    onViolation: (v) => console.log("Detected:", v.message),
  });

  for await (const event of result.stream) {
    if (event.type === "token") {
      process.stdout.write(event.value || "");
    }
  }
  console.log("\n");
}

// Example 3: Using presets
async function presets() {
  console.log("=== Guardrail Presets ===\n");

  console.log(
    "recommendedGuardrails includes:",
    recommendedGuardrails.map((g) => g.name).join(", "),
  );
  console.log(
    "strictGuardrails includes:",
    strictGuardrails.map((g) => g.name).join(", "),
  );

  const result = await l0({
    stream: () =>
      streamText({
        model: openai("gpt-5-nano"),
        prompt: "Say hello",
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

// Example 4: Custom guardrail
async function customGuardrail() {
  console.log("\n=== Custom Guardrail ===\n");

  const minLengthRule = {
    name: "min-length",
    description: "Ensure minimum response length",
    check: (context: { content: string; isComplete: boolean }) => {
      if (context.isComplete && context.content.length < 20) {
        return [
          {
            rule: "min-length",
            message: `Response too short: ${context.content.length} chars`,
            severity: "warning" as const,
            recoverable: true,
          },
        ];
      }
      return [];
    },
  };

  const result = await l0({
    stream: () =>
      streamText({
        model: openai("gpt-5-nano"),
        prompt: "Write a detailed explanation of recursion",
      }),
    guardrails: [minLengthRule, ...recommendedGuardrails],
    onViolation: (v) => console.log("Violation:", v.message),
  });

  for await (const event of result.stream) {
    if (event.type === "token") {
      process.stdout.write(event.value || "");
    }
  }
  console.log("\n\nLength:", result.state.content.length, "chars");
}

async function main() {
  await jsonGuardrail();
  await customPatterns();
  await presets();
  await customGuardrail();
}

main().catch(console.error);
