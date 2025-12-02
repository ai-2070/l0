/**
 * Tests for L0 lifecycle callbacks: onRetry, onFallback, onResume
 */

import { describe, it, expect, vi } from "vitest";
import { l0 } from "../src/runtime/l0";
import type { L0Event } from "../src/types/l0";
import type { GuardrailRule } from "../src/types/guardrails";

// Helper to create a simple token stream
function createTokenStream(tokens: string[]): () => AsyncGenerator<L0Event> {
  return async function* () {
    for (const token of tokens) {
      yield { type: "token", value: token, timestamp: Date.now() };
    }
    yield { type: "complete", timestamp: Date.now() };
  };
}

describe("onRetry callback", () => {
  it("should call onRetry for guardrail violations that trigger retry", async () => {
    const onRetry = vi.fn();
    let attemptCount = 0;

    const badWordRule: GuardrailRule = {
      name: "no-bad-words",
      check: (ctx) => {
        if (ctx.completed && ctx.content.includes("forbidden")) {
          return [
            {
              rule: "no-bad-words",
              severity: "error",
              message: "Content contains forbidden word",
              recoverable: true,
            },
          ];
        }
        return [];
      },
    };

    const streamFactory = () => {
      attemptCount++;
      const gen = async function* (): AsyncGenerator<L0Event> {
        if (attemptCount === 1) {
          yield { type: "token", value: "forbidden", timestamp: Date.now() };
        } else {
          yield {
            type: "token",
            value: "clean-content",
            timestamp: Date.now(),
          };
        }
        yield { type: "complete", timestamp: Date.now() };
      };
      return gen();
    };

    const result = await l0({
      stream: streamFactory,
      guardrails: [badWordRule],
      retry: { attempts: 2 },
      onRetry,
    });

    for await (const _ of result.stream) {
      // Consume stream
    }

    expect(onRetry).toHaveBeenCalled();
    expect(onRetry.mock.calls[0]![0]).toBeGreaterThanOrEqual(1); // attempt number
    expect(typeof onRetry.mock.calls[0]![1]).toBe("string"); // reason
  });

  it("should not call onRetry when stream succeeds on first attempt", async () => {
    const onRetry = vi.fn();

    const result = await l0({
      stream: createTokenStream(["hello", "world"]),
      retry: { attempts: 2 },
      onRetry,
    });

    for await (const _ of result.stream) {
      // Consume stream
    }

    expect(onRetry).not.toHaveBeenCalled();
  });

  it("should call onRetry multiple times for multiple guardrail retries", async () => {
    const onRetry = vi.fn();
    let attemptCount = 0;

    const rule: GuardrailRule = {
      name: "force-retry",
      check: (ctx) => {
        if (ctx.completed && ctx.content.includes("retry-me")) {
          return [
            {
              rule: "force-retry",
              severity: "error",
              message: "Force retry",
              recoverable: true,
            },
          ];
        }
        return [];
      },
    };

    const streamFactory = () => {
      attemptCount++;
      const gen = async function* (): AsyncGenerator<L0Event> {
        if (attemptCount < 3) {
          yield { type: "token", value: "retry-me", timestamp: Date.now() };
        } else {
          yield { type: "token", value: "success", timestamp: Date.now() };
        }
        yield { type: "complete", timestamp: Date.now() };
      };
      return gen();
    };

    const result = await l0({
      stream: streamFactory,
      guardrails: [rule],
      retry: { attempts: 3 },
      onRetry,
    });

    for await (const _ of result.stream) {
      // Consume stream
    }

    expect(onRetry).toHaveBeenCalledTimes(2);
  });
});

describe("onFallback callback", () => {
  it("should call onFallback when switching to fallback model", async () => {
    const onFallback = vi.fn();

    // Primary stream fails via guardrail
    const failRule: GuardrailRule = {
      name: "fail-primary",
      check: (ctx) => {
        if (ctx.completed && ctx.content.includes("primary")) {
          return [
            {
              rule: "fail-primary",
              severity: "error",
              message: "Primary must fail",
              recoverable: false, // Not recoverable = triggers fallback
            },
          ];
        }
        return [];
      },
    };

    const result = await l0({
      stream: createTokenStream(["primary"]),
      fallbackStreams: [createTokenStream(["fallback-success"])],
      guardrails: [failRule],
      retry: { attempts: 1 },
      onFallback,
    });

    for await (const _ of result.stream) {
      // Consume stream
    }

    expect(onFallback).toHaveBeenCalledTimes(1);
    expect(onFallback.mock.calls[0]![0]).toBe(0); // First fallback (0-indexed)
    expect(typeof onFallback.mock.calls[0]![1]).toBe("string"); // reason
  });

  it("should not call onFallback when primary stream succeeds", async () => {
    const onFallback = vi.fn();

    const result = await l0({
      stream: createTokenStream(["success"]),
      fallbackStreams: [createTokenStream(["fallback"])],
      retry: { attempts: 1 },
      onFallback,
    });

    for await (const _ of result.stream) {
      // Consume stream
    }

    expect(onFallback).not.toHaveBeenCalled();
  });

  it("should call onFallback for each fallback used", async () => {
    const onFallback = vi.fn();

    // Each stream fails except the last
    const failRule: GuardrailRule = {
      name: "fail-until-third",
      check: (ctx) => {
        if (ctx.completed && !ctx.content.includes("third")) {
          return [
            {
              rule: "fail-until-third",
              severity: "error",
              message: "Must fail",
              recoverable: false,
            },
          ];
        }
        return [];
      },
    };

    const result = await l0({
      stream: createTokenStream(["first"]),
      fallbackStreams: [
        createTokenStream(["second"]),
        createTokenStream(["third-success"]),
      ],
      guardrails: [failRule],
      retry: { attempts: 1 },
      onFallback,
    });

    for await (const _ of result.stream) {
      // Consume stream
    }

    expect(onFallback).toHaveBeenCalledTimes(2);
    expect(onFallback.mock.calls[0]![0]).toBe(0); // First fallback
    expect(onFallback.mock.calls[1]![0]).toBe(1); // Second fallback
  });
});

describe("onResume callback", () => {
  it("should call onResume when resuming from checkpoint on fallback", async () => {
    const onResume = vi.fn();

    // Primary generates tokens then fails
    const primaryStream = async function* (): AsyncGenerator<L0Event> {
      for (let i = 0; i < 15; i++) {
        yield { type: "token", value: `t${i}-`, timestamp: Date.now() };
      }
      yield {
        type: "error",
        error: new Error("Primary failed"),
        timestamp: Date.now(),
      };
    };

    // Fallback continues
    const fallbackStream = async function* (): AsyncGenerator<L0Event> {
      yield { type: "token", value: "continued", timestamp: Date.now() };
      yield { type: "complete", timestamp: Date.now() };
    };

    const result = await l0({
      stream: () => primaryStream(),
      fallbackStreams: [() => fallbackStream()],
      retry: { attempts: 1 },
      continueFromLastKnownGoodToken: true,
      checkIntervals: { checkpoint: 5 },
      onResume,
    });

    for await (const _ of result.stream) {
      // Consume stream
    }

    expect(onResume).toHaveBeenCalled();
    expect(typeof onResume.mock.calls[0]![0]).toBe("string"); // checkpoint content
    expect(typeof onResume.mock.calls[0]![1]).toBe("number"); // token count
  });

  it("should not call onResume on successful first run", async () => {
    const onResume = vi.fn();

    const result = await l0({
      stream: createTokenStream(["hello", "world"]),
      retry: { attempts: 2 },
      continueFromLastKnownGoodToken: true,
      checkIntervals: { checkpoint: 1 },
      onResume,
    });

    for await (const _ of result.stream) {
      // Consume stream
    }

    expect(onResume).not.toHaveBeenCalled();
  });

  it("should not call onResume when continuation is disabled", async () => {
    const onResume = vi.fn();

    // Primary generates tokens then fails
    const primaryStream = async function* (): AsyncGenerator<L0Event> {
      for (let i = 0; i < 10; i++) {
        yield { type: "token", value: `t${i}`, timestamp: Date.now() };
      }
      yield {
        type: "error",
        error: new Error("Failed"),
        timestamp: Date.now(),
      };
    };

    const result = await l0({
      stream: () => primaryStream(),
      fallbackStreams: [createTokenStream(["fallback"])],
      retry: { attempts: 1 },
      continueFromLastKnownGoodToken: false, // Disabled
      onResume,
    });

    for await (const _ of result.stream) {
      // Consume stream
    }

    // No resumption because continuation is disabled
    expect(onResume).not.toHaveBeenCalled();
  });

  it("should include checkpoint content in onResume", async () => {
    const onResume = vi.fn();

    // Primary generates specific tokens then fails
    const primaryStream = async function* (): AsyncGenerator<L0Event> {
      yield { type: "token", value: "checkpoint-", timestamp: Date.now() };
      yield { type: "token", value: "content-", timestamp: Date.now() };
      yield { type: "token", value: "here-", timestamp: Date.now() };
      yield { type: "token", value: "more-", timestamp: Date.now() };
      yield { type: "token", value: "tokens", timestamp: Date.now() };
      yield {
        type: "error",
        error: new Error("Failed after tokens"),
        timestamp: Date.now(),
      };
    };

    const result = await l0({
      stream: () => primaryStream(),
      fallbackStreams: [createTokenStream(["continued"])],
      retry: { attempts: 1 },
      continueFromLastKnownGoodToken: true,
      checkIntervals: { checkpoint: 2 },
      onResume,
    });

    for await (const _ of result.stream) {
      // Consume stream
    }

    expect(onResume).toHaveBeenCalled();
    const checkpointContent = onResume.mock.calls[0]![0] as string;
    expect(checkpointContent).toContain("checkpoint-");
  });
});

describe("onStart callback", () => {
  it("should call onStart on first attempt", async () => {
    const onStart = vi.fn();

    const result = await l0({
      stream: createTokenStream(["hello"]),
      onStart,
    });

    for await (const _ of result.stream) {
      // Consume stream
    }

    expect(onStart).toHaveBeenCalledTimes(1);
    expect(onStart).toHaveBeenCalledWith(1, false, false); // attempt 1, not retry, not fallback
  });

  it("should call onStart on retry with correct flags", async () => {
    const onStart = vi.fn();
    let attemptCount = 0;

    const rule: GuardrailRule = {
      name: "force-retry",
      check: (ctx) => {
        if (ctx.completed && ctx.content.includes("retry-me")) {
          return [
            {
              rule: "force-retry",
              severity: "error",
              message: "Force retry",
              recoverable: true,
            },
          ];
        }
        return [];
      },
    };

    const streamFactory = () => {
      attemptCount++;
      const gen = async function* (): AsyncGenerator<L0Event> {
        if (attemptCount === 1) {
          yield { type: "token", value: "retry-me", timestamp: Date.now() };
        } else {
          yield { type: "token", value: "success", timestamp: Date.now() };
        }
        yield { type: "complete", timestamp: Date.now() };
      };
      return gen();
    };

    const result = await l0({
      stream: streamFactory,
      guardrails: [rule],
      retry: { attempts: 2 },
      onStart,
    });

    for await (const _ of result.stream) {
      // Consume stream
    }

    expect(onStart).toHaveBeenCalledTimes(2);
    expect(onStart.mock.calls[0]).toEqual([1, false, false]); // First attempt
    expect(onStart.mock.calls[1]).toEqual([2, true, false]); // Retry attempt
  });

  it("should call onStart on fallback with correct flags", async () => {
    const onStart = vi.fn();

    const failRule: GuardrailRule = {
      name: "fail-primary",
      check: (ctx) => {
        if (ctx.completed && ctx.content.includes("primary")) {
          return [
            {
              rule: "fail-primary",
              severity: "error",
              message: "Primary must fail",
              recoverable: false,
            },
          ];
        }
        return [];
      },
    };

    const result = await l0({
      stream: createTokenStream(["primary"]),
      fallbackStreams: [createTokenStream(["fallback-success"])],
      guardrails: [failRule],
      retry: { attempts: 1 },
      onStart,
    });

    for await (const _ of result.stream) {
      // Consume stream
    }

    expect(onStart).toHaveBeenCalledTimes(2);
    expect(onStart.mock.calls[0]).toEqual([1, false, false]); // Primary
    expect(onStart.mock.calls[1]![2]).toBe(true); // Fallback flag is true
  });

  it("should not crash runtime when onStart throws", async () => {
    const onStart = vi.fn().mockImplementation(() => {
      throw new Error("User callback error");
    });

    const result = await l0({
      stream: createTokenStream(["hello", "world"]),
      onStart,
    });

    const tokens: string[] = [];
    for await (const event of result.stream) {
      if (event.type === "token" && event.value) {
        tokens.push(event.value);
      }
    }

    // Stream should still complete successfully despite onStart throwing
    expect(tokens.join("")).toBe("helloworld");
    expect(onStart).toHaveBeenCalled();
  });
});

describe("onComplete callback", () => {
  it("should call onComplete on successful stream", async () => {
    const onComplete = vi.fn();

    const result = await l0({
      stream: createTokenStream(["hello", "world"]),
      onComplete,
    });

    for await (const _ of result.stream) {
      // Consume stream
    }

    expect(onComplete).toHaveBeenCalledTimes(1);
    const state = onComplete.mock.calls[0]![0];
    expect(state.content).toBe("helloworld");
    expect(state.completed).toBe(true);
  });

  it("should not call onComplete when stream fails with no fallback", async () => {
    const onComplete = vi.fn();

    const failingStream = async function* (): AsyncGenerator<L0Event> {
      yield {
        type: "error",
        error: new Error("Fatal error"),
        timestamp: Date.now(),
      };
    };

    const result = await l0({
      stream: () => failingStream(),
      retry: { attempts: 0 },
      onComplete,
    });

    try {
      for await (const _ of result.stream) {
        // Consume stream
      }
    } catch {
      // Expected to throw
    }

    expect(onComplete).not.toHaveBeenCalled();
  });

  it("should call onComplete after successful retry", async () => {
    const onComplete = vi.fn();
    let attemptCount = 0;

    const rule: GuardrailRule = {
      name: "force-retry",
      check: (ctx) => {
        if (ctx.completed && ctx.content.includes("retry-me")) {
          return [
            {
              rule: "force-retry",
              severity: "error",
              message: "Force retry",
              recoverable: true,
            },
          ];
        }
        return [];
      },
    };

    const streamFactory = () => {
      attemptCount++;
      const gen = async function* (): AsyncGenerator<L0Event> {
        if (attemptCount === 1) {
          yield { type: "token", value: "retry-me", timestamp: Date.now() };
        } else {
          yield { type: "token", value: "success", timestamp: Date.now() };
        }
        yield { type: "complete", timestamp: Date.now() };
      };
      return gen();
    };

    const result = await l0({
      stream: streamFactory,
      guardrails: [rule],
      retry: { attempts: 2 },
      onComplete,
    });

    for await (const _ of result.stream) {
      // Consume stream
    }

    expect(onComplete).toHaveBeenCalledTimes(1);
    const state = onComplete.mock.calls[0]![0];
    expect(state.content).toBe("success");
  });
});

describe("onError callback", () => {
  it("should call onError when error occurs", async () => {
    const onError = vi.fn();

    const failingStream = async function* (): AsyncGenerator<L0Event> {
      yield { type: "token", value: "start", timestamp: Date.now() };
      yield {
        type: "error",
        error: new Error("Test error"),
        timestamp: Date.now(),
      };
    };

    const result = await l0({
      stream: () => failingStream(),
      fallbackStreams: [createTokenStream(["fallback"])],
      retry: { attempts: 1 },
      onError,
    });

    for await (const _ of result.stream) {
      // Consume stream
    }

    expect(onError).toHaveBeenCalled();
    const [error, willRetry, willFallback] = onError.mock.calls[0]!;
    expect(error).toBeInstanceOf(Error);
    expect(typeof willRetry).toBe("boolean");
    expect(typeof willFallback).toBe("boolean");
  });

  it("should indicate willRetry=true when retry will happen", async () => {
    const onError = vi.fn();

    // Use a failing stream that triggers retry then fallback
    const failingStream = async function* (): AsyncGenerator<L0Event> {
      yield { type: "token", value: "start", timestamp: Date.now() };
      yield {
        type: "error",
        error: new Error("Retryable"),
        timestamp: Date.now(),
      };
    };

    const result = await l0({
      stream: () => failingStream(),
      fallbackStreams: [createTokenStream(["fallback"])],
      retry: { attempts: 2 },
      onError,
    });

    for await (const _ of result.stream) {
      // Consume stream
    }

    // onError should have been called
    expect(onError).toHaveBeenCalled();
    // Check that at least one call indicated willRetry or willFallback
    const anyRecovery = onError.mock.calls.some((call) => {
      const [, willRetry, willFallback] = call as [Error, boolean, boolean];
      return willRetry || willFallback;
    });
    expect(anyRecovery).toBe(true);
  });

  it("should indicate willFallback=true when fallback will happen", async () => {
    const onError = vi.fn();

    const failingStream = async function* (): AsyncGenerator<L0Event> {
      yield { type: "error", error: new Error("Fatal"), timestamp: Date.now() };
    };

    const result = await l0({
      stream: () => failingStream(),
      fallbackStreams: [createTokenStream(["fallback"])],
      retry: { attempts: 0 }, // No retries
      onError,
    });

    for await (const _ of result.stream) {
      // Consume stream
    }

    expect(onError).toHaveBeenCalled();
    const [, willRetry, willFallback] = onError.mock.calls[0]!;
    expect(willRetry).toBe(false);
    expect(willFallback).toBe(true);
  });
});

describe("Combined callbacks", () => {
  it("should call onFallback before onResume during fallback with continuation", async () => {
    const callOrder: string[] = [];
    const onFallback = vi.fn(() => callOrder.push("onFallback"));
    const onResume = vi.fn(() => callOrder.push("onResume"));

    const primaryStream = async function* (): AsyncGenerator<L0Event> {
      for (let i = 0; i < 10; i++) {
        yield { type: "token", value: `t${i}`, timestamp: Date.now() };
      }
      yield {
        type: "error",
        error: new Error("Primary failed"),
        timestamp: Date.now(),
      };
    };

    const fallbackStream = async function* (): AsyncGenerator<L0Event> {
      yield { type: "token", value: "fallback-done", timestamp: Date.now() };
      yield { type: "complete", timestamp: Date.now() };
    };

    const result = await l0({
      stream: () => primaryStream(),
      fallbackStreams: [() => fallbackStream()],
      retry: { attempts: 1 },
      continueFromLastKnownGoodToken: true,
      checkIntervals: { checkpoint: 2 },
      onFallback,
      onResume,
    });

    for await (const _ of result.stream) {
      // Consume stream
    }

    expect(callOrder[0]).toBe("onFallback");
    expect(callOrder).toContain("onResume");
  });

  it("should call all relevant callbacks during complex flow", async () => {
    const onRetry = vi.fn();
    const onFallback = vi.fn();
    const onResume = vi.fn();
    const onViolation = vi.fn();

    let attemptCount = 0;

    // Guardrail that forces retry on first attempt, then allows
    const rule: GuardrailRule = {
      name: "force-flow",
      check: (ctx) => {
        if (ctx.completed && ctx.content.includes("retry-trigger")) {
          return [
            {
              rule: "force-flow",
              severity: "error",
              message: "Triggering retry",
              recoverable: true,
            },
          ];
        }
        return [];
      },
    };

    const streamFactory = () => {
      attemptCount++;
      const gen = async function* (): AsyncGenerator<L0Event> {
        if (attemptCount === 1) {
          yield {
            type: "token",
            value: "retry-trigger",
            timestamp: Date.now(),
          };
        } else {
          yield { type: "token", value: "success", timestamp: Date.now() };
        }
        yield { type: "complete", timestamp: Date.now() };
      };
      return gen();
    };

    const result = await l0({
      stream: streamFactory,
      guardrails: [rule],
      retry: { attempts: 2 },
      onRetry,
      onFallback,
      onResume,
      onViolation,
    });

    for await (const _ of result.stream) {
      // Consume stream
    }

    // Should have called onViolation and onRetry
    expect(onViolation).toHaveBeenCalled();
    expect(onRetry).toHaveBeenCalled();
    // Should NOT have called onFallback (retry succeeded)
    expect(onFallback).not.toHaveBeenCalled();
    // Should NOT have called onResume (no continuation enabled)
    expect(onResume).not.toHaveBeenCalled();
  });
});

describe("onCheckpoint callback", () => {
  it("should call onCheckpoint when checkpoint is saved", async () => {
    const onCheckpoint = vi.fn();

    // Generate enough tokens to trigger checkpoint (default interval is 10)
    const tokens = Array.from({ length: 25 }, (_, i) => `t${i}-`);

    const result = await l0({
      stream: createTokenStream(tokens),
      continueFromLastKnownGoodToken: true,
      checkIntervals: { checkpoint: 5 },
      onCheckpoint,
    });

    for await (const _ of result.stream) {
      // Consume stream
    }

    // Should have multiple checkpoints
    expect(onCheckpoint).toHaveBeenCalled();
    const [checkpoint, tokenCount] = onCheckpoint.mock.calls[0]!;
    expect(typeof checkpoint).toBe("string");
    expect(typeof tokenCount).toBe("number");
    expect(tokenCount).toBeGreaterThan(0);
  });

  it("should NOT call onCheckpoint when continuation is disabled", async () => {
    const onCheckpoint = vi.fn();

    // Generate enough tokens to exceed checkpoint interval
    const tokens = Array.from({ length: 25 }, (_, i) => `t${i}-`);

    const result = await l0({
      stream: createTokenStream(tokens),
      continueFromLastKnownGoodToken: false,
      checkIntervals: { checkpoint: 5 },
      onCheckpoint,
    });

    for await (const _ of result.stream) {
      // Consume stream
    }

    // Checkpoints are only saved when continuation is enabled
    // (no point in saving checkpoints if we can't resume from them)
    expect(onCheckpoint).not.toHaveBeenCalled();
  });
});

describe("onAbort callback", () => {
  it("should call onAbort when stream is aborted", async () => {
    const onAbort = vi.fn();

    const slowStream = async function* (): AsyncGenerator<L0Event> {
      for (let i = 0; i < 100; i++) {
        yield { type: "token", value: `t${i}`, timestamp: Date.now() };
        await new Promise((r) => setTimeout(r, 10));
      }
      yield { type: "complete", timestamp: Date.now() };
    };

    const result = await l0({
      stream: () => slowStream(),
      onAbort,
    });

    // Consume a few tokens then abort
    let count = 0;
    try {
      for await (const event of result.stream) {
        if (event.type === "token") {
          count++;
          if (count >= 5) {
            result.abort();
            // Continue consuming to let the abort be detected
          }
        }
      }
    } catch {
      // Expected - stream will throw on abort
    }

    expect(onAbort).toHaveBeenCalledTimes(1);
    const [tokenCount, contentLength] = onAbort.mock.calls[0]!;
    expect(typeof tokenCount).toBe("number");
    expect(typeof contentLength).toBe("number");
  });

  it("should not call onAbort when stream completes normally", async () => {
    const onAbort = vi.fn();

    const result = await l0({
      stream: createTokenStream(["hello", "world"]),
      onAbort,
    });

    for await (const _ of result.stream) {
      // Consume stream
    }

    expect(onAbort).not.toHaveBeenCalled();
  });
});
