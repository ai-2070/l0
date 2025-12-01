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
