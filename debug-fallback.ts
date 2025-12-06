import { l0 } from "./src/runtime/l0";
import type { L0Event } from "./src/types/l0";
import type { L0Event as L0ObservabilityEvent } from "./src/types/observability";

function createTokenStream(tokens: string[]): () => AsyncGenerator<L0Event> {
  return async function* () {
    for (const token of tokens) {
      yield { type: "token", value: token, timestamp: Date.now() };
    }
    yield { type: "complete", timestamp: Date.now() };
  };
}

function createFailingStream(
  tokens: string[],
  error: Error = new Error("Stream failed"),
): () => AsyncGenerator<L0Event> {
  return async function* () {
    for (const token of tokens) {
      yield { type: "token", value: token, timestamp: Date.now() };
    }
    yield { type: "error", error, timestamp: Date.now() };
  };
}

async function main() {
  const events: string[] = [];
  let attemptIndex = 0;
  const primaryAttempts = [
    { tokens: ["fail-1"], error: true },
    { tokens: ["fail-2"], error: true },
  ];

  const streamFactory = () => {
    const currentAttempt = primaryAttempts[attemptIndex];
    attemptIndex++;
    console.log(`Stream factory called, attempt ${attemptIndex}`);
    if (currentAttempt?.error) {
      return createFailingStream(currentAttempt.tokens)();
    }
    return createTokenStream(currentAttempt?.tokens || [])();
  };

  const result = await l0({
    stream: streamFactory,
    fallbackStreams: [createTokenStream(["fallback-success"])],
    retry: { attempts: 1, retryOn: ["unknown"] },
    context: { requestId: "test" },
    onEvent: (event) => {
      if ("ts" in event && "streamId" in event) {
        events.push((event as L0ObservabilityEvent).type);
      }
    },
    onStart: (a, r, f) =>
      console.log(`onStart: attempt=${a}, isRetry=${r}, isFallback=${f}`),
    onRetry: (a, r) => console.log(`onRetry: attempt=${a}, reason=${r}`),
    onFallback: (i, r) => console.log(`onFallback: index=${i}, reason=${r}`),
    detectZeroTokens: false,
  });

  for await (const e of result.stream) {
    if (e.type === "token") console.log(`Token: ${e.value}`);
  }

  console.log("\nEvents:", events.join(", "));
}

main().catch(console.error);
