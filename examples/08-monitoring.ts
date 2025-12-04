// Monitoring Example (Sentry + OpenTelemetry)
// Run: OPENAI_API_KEY=sk-... npx tsx examples/08-monitoring.ts

import {
  l0,
  recommendedGuardrails,
  createSentryHandler,
  L0OpenTelemetry,
  createOpenTelemetryHandler,
  combineEvents,
  filterEvents,
  excludeEvents,
  EventType,
} from "@ai2070/l0";
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
    monitoring: {
      enabled: true,
      includeTimings: true,
      includeNetworkDetails: true,
    },

    // Optional: User metadata attached to all events
    meta: {
      example: "08-monitoring",
    },
  });

  for await (const event of result.stream) {
    if (event.type === "token") {
      process.stdout.write(event.value || "");
    }
  }

  console.log("\n\nTelemetry:");
  console.log("  Session ID:", result.telemetry?.sessionId);
  console.log("  Duration:", result.telemetry?.duration, "ms");
  console.log("  Tokens:", result.telemetry?.metrics.totalTokens);
  console.log("  TTFT:", result.telemetry?.metrics.timeToFirstToken, "ms");
  console.log(
    "  Tokens/sec:",
    result.telemetry?.metrics.tokensPerSecond?.toFixed(1),
  );
  console.log("  Model retries:", result.telemetry?.metrics.modelRetryCount);
  console.log(
    "  Network retries:",
    result.telemetry?.metrics.networkRetryCount,
  );
}

// Example 2: With custom metadata
async function customMetadata() {
  console.log("\n=== Custom Metadata ===\n");

  const result = await l0({
    stream: () =>
      streamText({
        model: openai("gpt-4o-mini"),
        prompt: "Summarize: The quick brown fox jumps over the lazy dog.",
      }),

    // User metadata (immutable for session, on all events)
    meta: {
      userId: "user-123",
      requestType: "summarization",
    },

    // Monitoring metadata (on telemetry object)
    monitoring: {
      enabled: true,
      metadata: {
        priority: "high",
        source: "api",
      },
    },
  });

  for await (const event of result.stream) {
    // consume stream
  }

  console.log("Monitoring metadata:", result.telemetry?.metadata);
}

// Example 3: Event handler utilities
async function eventHandlers() {
  console.log("\n=== Event Handler Utilities ===\n");

  // Custom handler
  const loggingHandler = (event: unknown) => {
    const e = event as { type: string };
    console.log(`  Event: ${e.type}`);
  };

  const result = await l0({
    stream: () =>
      streamText({
        model: openai("gpt-4o-mini"),
        prompt: "Say hello",
      }),

    // Combine multiple handlers
    onEvent: combineEvents(
      // Filter to only specific events
      filterEvents(
        [EventType.SESSION_START, EventType.COMPLETE, EventType.ERROR],
        loggingHandler,
      ),
      // Exclude noisy token events from another handler
      excludeEvents([EventType.TOKEN], (event) => {
        // This handler won't see token events
      }),
    ),
  });

  for await (const event of result.stream) {
    if (event.type === "token") {
      process.stdout.write(event.value || "");
    }
  }
  console.log("\n");
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
  //   onEvent: createSentryHandler({ sentry: Sentry }),
  // });

  console.log("Example code:");
  console.log(`
  import * as Sentry from "@sentry/node";
  import { l0, createSentryHandler } from "@ai2070/l0";

  const result = await l0({
    stream: () => streamText({ model, prompt }),
    onEvent: createSentryHandler({ sentry: Sentry }),
  });
  `);

  console.log("Sentry tracks:");
  console.log("  - Breadcrumbs for all events");
  console.log("  - Network errors with context");
  console.log("  - Guardrail violations");
  console.log("  - Performance transactions with TTFT and token count");
}

// Example 5: OpenTelemetry integration (requires @opentelemetry/api)
async function openTelemetryExample() {
  console.log("\n=== OpenTelemetry Integration ===\n");
  console.log("(Requires @opentelemetry/api to be installed and configured)\n");

  // Uncomment to use with OpenTelemetry:
  // import { trace, metrics } from "@opentelemetry/api";
  //
  // const result = await l0({
  //   stream: () => streamText({ model: openai("gpt-4o-mini"), prompt: "Hello" }),
  //   onEvent: createOpenTelemetryHandler({
  //     tracer: trace.getTracer("my-app"),
  //     meter: metrics.getMeter("my-app"),
  //   }),
  // });

  console.log("Example code (event handler - recommended):");
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
  console.log(
    "\nSpan attributes follow OpenTelemetry GenAI semantic conventions",
  );
  console.log("  - gen_ai.* and l0.* attributes");
}

// Example 6: Combined monitoring
async function combinedMonitoring() {
  console.log("\n=== Combined Monitoring ===\n");

  console.log("Example: Sentry + OpenTelemetry + custom logger");
  console.log(`
  import * as Sentry from "@sentry/node";
  import { trace, metrics } from "@opentelemetry/api";
  import { l0, combineEvents, createSentryHandler, createOpenTelemetryHandler } from "@ai2070/l0";

  const result = await l0({
    stream: () => streamText({ model, prompt }),
    onEvent: combineEvents(
      createOpenTelemetryHandler({
        tracer: trace.getTracer("my-app"),
        meter: metrics.getMeter("my-app"),
      }),
      createSentryHandler({ sentry: Sentry }),
      (event) => console.log(event.type), // custom handler
    ),
  });
  `);
}

async function main() {
  await basicTelemetry();
  await customMetadata();
  await eventHandlers();
  await sentryExample();
  await openTelemetryExample();
  await combinedMonitoring();
}

main().catch(console.error);
