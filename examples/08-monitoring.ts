// Monitoring Example (Sentry + OpenTelemetry)
// Run: OPENAI_API_KEY=sk-... npx tsx examples/08-monitoring.ts

import {
  l0,
  recommendedGuardrails,
  createSentryHandler,
  L0OpenTelemetry,
  createOpenTelemetryHandler,
} from "@ai2070/l0";
import { streamText } from "ai";
import { openai } from "@ai-sdk/openai";

// Example 1: Basic telemetry
async function basicTelemetry() {
  console.log("=== Basic Telemetry ===\n");

  const result = await l0({
    stream: () =>
      streamText({
        model: openai("gpt-5-nano"),
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

// Example 2: With custom metadata
async function customMetadata() {
  console.log("\n=== Custom Metadata ===\n");

  const result = await l0({
    stream: () =>
      streamText({
        model: openai("gpt-5-nano"),
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

// Example 3: Sentry integration (requires @sentry/node)
async function sentryExample() {
  console.log("\n=== Sentry Integration ===\n");
  console.log("(Requires @sentry/node to be installed and configured)\n");

  // Uncomment to use with Sentry:
  // import * as Sentry from "@sentry/node";
  // Sentry.init({ dsn: "your-dsn" });
  //
  // const result = await l0({
  //   stream: () => streamText({ model: openai("gpt-5-nano"), prompt: "Hello" }),
  //   onEvent: createSentryHandler({ sentry: Sentry, enableTracing: true }),
  // });

  console.log("Example code:");
  console.log(`
  import * as Sentry from "@sentry/node";
  import { l0, createSentryHandler } from "@ai2070/l0";

  const result = await l0({
    stream: () => streamText({ model, prompt }),
    onEvent: createSentryHandler({ sentry: Sentry, enableTracing: true }),
  });
  `);
}

// Example 4: OpenTelemetry integration (requires @opentelemetry/api)
async function openTelemetryExample() {
  console.log("\n=== OpenTelemetry Integration ===\n");
  console.log("(Requires @opentelemetry/api to be installed and configured)\n");

  // Uncomment to use with OpenTelemetry:
  // import { trace, metrics } from "@opentelemetry/api";
  //
  // const otel = new L0OpenTelemetry({
  //   tracer: trace.getTracer("my-app"),
  //   meter: metrics.getMeter("my-app"),
  // });
  //
  // // Option 1: Manual tracing with full control
  // const result = await otel.traceStream("chat-completion", async (span) => {
  //   const res = await l0({
  //     stream: () => streamText({ model: openai("gpt-5-nano"), prompt: "Hello" }),
  //     monitoring: { enabled: true },
  //   });
  //
  //   for await (const event of res.stream) {
  //     if (event.type === "token") {
  //       otel.recordToken(span, event.value);
  //     }
  //   }
  //
  //   otel.recordTelemetry(res.telemetry!, span);
  //   return res;
  // });
  //
  // // Option 2: Use the event handler for automatic tracing
  // const result = await l0({
  //   stream: () => streamText({ model: openai("gpt-5-nano"), prompt: "Hello" }),
  //   onEvent: createOpenTelemetryHandler({
  //     tracer: trace.getTracer("my-app"),
  //     meter: metrics.getMeter("my-app"),
  //   }),
  // });

  console.log("Example code (manual tracing):");
  console.log(`
  import { trace, metrics } from "@opentelemetry/api";
  import { l0, L0OpenTelemetry } from "@ai2070/l0";

  const otel = new L0OpenTelemetry({
    tracer: trace.getTracer("my-app"),
    meter: metrics.getMeter("my-app"),
  });

  const result = await otel.traceStream("chat-completion", async (span) => {
    const res = await l0({
      stream: () => streamText({ model, prompt }),
      monitoring: { enabled: true },
    });

    for await (const event of res.stream) {
      otel.recordToken(span, event.value);
    }

    otel.recordTelemetry(res.telemetry, span);
    return res;
  });
  `);

  console.log("Example code (event handler):");
  console.log(`
  import { trace, metrics } from "@opentelemetry/api";
  import { l0, createOpenTelemetryHandler } from "@ai2070/l0";

  const result = await l0({
    stream: () => streamText({ model, prompt }),
    onEvent: createOpenTelemetryHandler({
      tracer: trace.getTracer("my-app"),
      meter: metrics.getMeter("my-app"),
    }),
  });
  `);

  console.log("Metrics exported:");
  console.log("  - l0.requests (counter)");
  console.log("  - l0.tokens (counter)");
  console.log("  - l0.retries (counter)");
  console.log("  - l0.errors (counter)");
  console.log("  - l0.duration (histogram)");
  console.log("  - l0.time_to_first_token (histogram)");
  console.log("  - l0.active_streams (up-down counter)");
}

async function main() {
  await basicTelemetry();
  await customMetadata();
  await sentryExample();
  await openTelemetryExample();
}

main().catch(console.error);
