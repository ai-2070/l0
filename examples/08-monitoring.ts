// Monitoring Example (Prometheus + Sentry)
// Run: OPENAI_API_KEY=sk-... npx tsx examples/08-monitoring.ts

import {
  l0,
  recommendedGuardrails,
  createPrometheusCollector,
  sentryInterceptor,
} from "../src/index";
import { streamText } from "ai";
import { openai } from "@ai-sdk/openai";

// Example 1: Basic telemetry
async function basicTelemetry() {
  console.log("=== Basic Telemetry ===\n");

  const result = await l0({
    stream: () =>
      streamText({
        model: openai("gpt-4o-mini"),
        prompt: "Write a short poem about monitoring",
      }),
    guardrails: recommendedGuardrails,
    monitoring: { enabled: true },
  });

  for await (const event of result.stream) {
    if (event.type === "token") {
      process.stdout.write(event.value || "");
    }
  }

  console.log("\n\nTelemetry:");
  console.log("  Duration:", result.telemetry?.duration, "ms");
  console.log("  Tokens:", result.telemetry?.metrics.totalTokens);
  console.log("  TTFT:", result.telemetry?.metrics.timeToFirstToken, "ms");
  console.log(
    "  Tokens/sec:",
    result.telemetry?.metrics.tokensPerSecond?.toFixed(1),
  );
}

// Example 2: Prometheus metrics
async function prometheusMetrics() {
  console.log("\n=== Prometheus Metrics ===\n");

  const collector = createPrometheusCollector({ prefix: "myapp_l0" });

  // Run a few requests
  for (let i = 0; i < 3; i++) {
    const result = await l0({
      stream: () =>
        streamText({
          model: openai("gpt-4o-mini"),
          prompt: `Say "hello ${i}"`,
        }),
      monitoring: { enabled: true },
    });

    for await (const event of result.stream) {
      // consume stream
    }

    collector.record(result.telemetry!, { model: "gpt-4o-mini" });
  }

  console.log("Prometheus metrics output:\n");
  console.log(collector.expose());
}

// Example 3: With custom metadata
async function customMetadata() {
  console.log("\n=== Custom Metadata ===\n");

  const result = await l0({
    stream: () =>
      streamText({
        model: openai("gpt-4o-mini"),
        prompt: "Summarize: The quick brown fox jumps over the lazy dog.",
      }),
    monitoring: {
      enabled: true,
      metadata: {
        userId: "user-123",
        requestType: "summarization",
        priority: "high",
      },
    },
  });

  for await (const event of result.stream) {
    // consume stream
  }

  console.log("Metadata attached to telemetry:");
  console.log(result.telemetry?.metadata);
}

// Example 4: Sentry integration (requires @sentry/node)
async function sentryExample() {
  console.log("\n=== Sentry Integration ===\n");
  console.log("(Requires @sentry/node to be installed and configured)\n");

  // Uncomment to use with Sentry:
  // import * as Sentry from "@sentry/node";
  // Sentry.init({ dsn: "your-dsn" });
  //
  // const result = await l0({
  //   stream: () => streamText({ model: openai("gpt-4o-mini"), prompt: "Hello" }),
  //   interceptors: [
  //     sentryInterceptor({ sentry: Sentry, enableTracing: true })
  //   ],
  // });

  console.log("Example code:");
  console.log(`
  import * as Sentry from "@sentry/node";
  import { l0, sentryInterceptor } from "@ai2070/l0";

  const result = await l0({
    stream: () => streamText({ model, prompt }),
    interceptors: [
      sentryInterceptor({ sentry: Sentry, enableTracing: true })
    ],
  });
  `);
}

async function main() {
  await basicTelemetry();
  await prometheusMetrics();
  await customMetadata();
  await sentryExample();
}

main().catch(console.error);
