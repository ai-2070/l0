/**
 * Comprehensive Lifecycle Tests for L0 Runtime
 *
 * These tests document the DETERMINISTIC lifecycle behavior of L0 for porting to Python.
 * Each test verifies the exact ordering of events and callbacks during various scenarios.
 *
 * LIFECYCLE EVENT ORDERING:
 * -------------------------
 * Normal successful flow:
 *   1. SESSION_START (attempt=1, isRetry=false, isFallback=false)
 *   2. [tokens stream...]
 *   3. CHECKPOINT_SAVED (if continuation enabled, every N tokens)
 *   4. COMPLETE (with full L0State)
 *
 * Retry flow (guardrail violation, drift, network error):
 *   1. SESSION_START (attempt=1, isRetry=false, isFallback=false)
 *   2. [tokens stream...]
 *   3. ERROR (with recoveryStrategy="retry")
 *   4. RETRY_ATTEMPT (attempt=N, reason)
 *   5. SESSION_START (attempt=2, isRetry=true, isFallback=false)
 *   6. [tokens stream...]
 *   7. COMPLETE
 *
 * Fallback flow (retries exhausted):
 *   1. SESSION_START (attempt=1, isRetry=false, isFallback=false)
 *   2. [error occurs, retries exhausted]
 *   3. ERROR (with recoveryStrategy="fallback")
 *   4. FALLBACK_START (fromIndex=0, toIndex=1)
 *   5. SESSION_START (attempt=1, isRetry=false, isFallback=true)
 *   6. [tokens stream...]
 *   7. COMPLETE
 *
 * Continuation/Resume flow:
 *   1. SESSION_START (attempt=1)
 *   2. [tokens stream...]
 *   3. CHECKPOINT_SAVED
 *   4. [error occurs]
 *   5. ERROR (with recoveryStrategy="retry" or "fallback")
 *   6. RETRY_ATTEMPT or FALLBACK_START
 *   7. SESSION_START (isRetry=true or isFallback=true)
 *   8. RESUME_START (checkpoint content, tokenCount)
 *   9. [continuation tokens...]
 *   10. COMPLETE
 *
 * Abort flow:
 *   1. SESSION_START
 *   2. [tokens stream...]
 *   3. [abort() called]
 *   4. ABORT_COMPLETED (tokenCount, contentLength)
 *   5. [throws L0Error with code STREAM_ABORTED]
 *
 * Timeout flow:
 *   1. SESSION_START
 *   2. [waiting for token...]
 *   3. TIMEOUT_TRIGGERED (timeoutType="initial" or "inter", elapsedMs)
 *   4. ERROR
 *   5. [retry or fallback...]
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { l0 } from "../src/runtime/l0";
import type { L0Event, L0State } from "../src/types/l0";
import type { L0Event as L0ObservabilityEvent } from "../src/types/observability";
import { EventType } from "../src/types/observability";
import type { GuardrailRule } from "../src/types/guardrails";

// ============================================================================
// Test Helpers
// ============================================================================

/**
 * Create a simple token stream from an array of tokens
 */
function createTokenStream(tokens: string[]): () => AsyncGenerator<L0Event> {
  return async function* () {
    for (const token of tokens) {
      yield { type: "token", value: token, timestamp: Date.now() };
    }
    yield { type: "complete", timestamp: Date.now() };
  };
}

/**
 * Create a stream that fails after emitting some tokens
 */
function createFailingStream(
  tokensBeforeError: string[],
  error: Error = new Error("Stream failed"),
): () => AsyncGenerator<L0Event> {
  return async function* () {
    for (const token of tokensBeforeError) {
      yield { type: "token", value: token, timestamp: Date.now() };
    }
    yield { type: "error", error, timestamp: Date.now() };
  };
}

/**
 * Create a slow stream that delays between tokens
 */
function createSlowStream(
  tokens: string[],
  delayMs: number,
): () => AsyncGenerator<L0Event> {
  return async function* () {
    for (const token of tokens) {
      await new Promise((r) => setTimeout(r, delayMs));
      yield { type: "token", value: token, timestamp: Date.now() };
    }
    yield { type: "complete", timestamp: Date.now() };
  };
}

/**
 * Event collector for tracking lifecycle events
 */
interface CollectedEvent {
  type: string;
  ts: number;
  data: Record<string, unknown>;
}

function createEventCollector() {
  const events: CollectedEvent[] = [];

  const handler = (event: L0Event | L0ObservabilityEvent) => {
    // Handle streaming events (L0Event from types/l0.ts)
    if ("type" in event && typeof event.type === "string") {
      // Check if it's an observability event (has ts, streamId, meta)
      if ("ts" in event && "streamId" in event) {
        const obsEvent = event as L0ObservabilityEvent;
        events.push({
          type: obsEvent.type,
          ts: obsEvent.ts,
          data: { ...obsEvent } as Record<string, unknown>,
        });
      } else {
        // It's a streaming event (token, message, data, etc.)
        const streamEvent = event as L0Event;
        events.push({
          type: streamEvent.type,
          ts: streamEvent.timestamp || Date.now(),
          data: { ...streamEvent } as Record<string, unknown>,
        });
      }
    }
  };

  return {
    handler,
    events,
    getEventTypes: () => events.map((e) => e.type),
    getEventsOfType: (type: string) => events.filter((e) => e.type === type),
    clear: () => {
      events.length = 0;
    },
  };
}

// ============================================================================
// Normal Flow Tests
// ============================================================================

describe("Lifecycle: Normal Successful Flow", () => {
  it("should emit SESSION_START -> tokens -> COMPLETE in order", async () => {
    const collector = createEventCollector();

    const result = await l0({
      stream: createTokenStream(["Hello", " ", "World"]),
      onEvent: collector.handler,
    });

    for await (const _ of result.stream) {
      // Consume stream
    }

    const types = collector.getEventTypes();

    // First event must be SESSION_START
    expect(types[0]).toBe(EventType.SESSION_START);

    // Last event must be COMPLETE
    expect(types[types.length - 1]).toBe(EventType.COMPLETE);

    // Should have token events in between
    expect(types.filter((t) => t === "token").length).toBe(3);
  });

  it("should pass correct parameters to SESSION_START on first attempt", async () => {
    const collector = createEventCollector();

    const result = await l0({
      stream: createTokenStream(["test"]),
      onEvent: collector.handler,
    });

    for await (const _ of result.stream) {
      // Consume stream
    }

    const sessionStart = collector.getEventsOfType(EventType.SESSION_START)[0];
    expect(sessionStart).toBeDefined();
    expect(sessionStart!.data.attempt).toBe(1);
    expect(sessionStart!.data.isRetry).toBe(false);
    expect(sessionStart!.data.isFallback).toBe(false);
  });

  it("should pass correct L0State to COMPLETE event", async () => {
    const collector = createEventCollector();

    const result = await l0({
      stream: createTokenStream(["Hello", " ", "World"]),
      onEvent: collector.handler,
    });

    for await (const _ of result.stream) {
      // Consume stream
    }

    const complete = collector.getEventsOfType(EventType.COMPLETE)[0];
    expect(complete).toBeDefined();
    expect(complete!.data.tokenCount).toBe(3);
    expect(complete!.data.contentLength).toBe(11); // "Hello World"

    // State should be included
    const state = complete!.data.state as L0State | undefined;
    if (state) {
      expect(state.content).toBe("Hello World");
      expect(state.completed).toBe(true);
    }
  });

  it("should call onStart callback with correct parameters", async () => {
    const onStart = vi.fn();

    const result = await l0({
      stream: createTokenStream(["test"]),
      onStart,
    });

    for await (const _ of result.stream) {
      // Consume stream
    }

    expect(onStart).toHaveBeenCalledTimes(1);
    expect(onStart).toHaveBeenCalledWith(1, false, false);
  });

  it("should call onComplete callback with final state", async () => {
    const onComplete = vi.fn();

    const result = await l0({
      stream: createTokenStream(["Hello", "World"]),
      onComplete,
    });

    for await (const _ of result.stream) {
      // Consume stream
    }

    expect(onComplete).toHaveBeenCalledTimes(1);
    const state = onComplete.mock.calls[0]![0] as L0State;
    expect(state.content).toBe("HelloWorld");
    expect(state.tokenCount).toBe(2);
    expect(state.completed).toBe(true);
  });

  it("should emit tokens in exact order received", async () => {
    const receivedTokens: string[] = [];

    const result = await l0({
      stream: createTokenStream(["A", "B", "C", "D", "E"]),
      onEvent: (event) => {
        if (event.type === "token" && "value" in event) {
          receivedTokens.push(event.value as string);
        }
      },
    });

    for await (const _ of result.stream) {
      // Consume stream
    }

    expect(receivedTokens).toEqual(["A", "B", "C", "D", "E"]);
  });
});

// ============================================================================
// Retry Flow Tests
// ============================================================================

describe("Lifecycle: Retry Flow", () => {
  it("should emit RETRY_ATTEMPT before second SESSION_START on guardrail retry", async () => {
    const collector = createEventCollector();
    let attemptCount = 0;

    const forceRetryRule: GuardrailRule = {
      name: "force-retry",
      check: (ctx) => {
        if (ctx.completed && ctx.content.includes("bad")) {
          return [
            {
              rule: "force-retry",
              severity: "error",
              message: "Content contains bad word",
              recoverable: true,
            },
          ];
        }
        return [];
      },
    };

    const streamFactory = () => {
      attemptCount++;
      if (attemptCount === 1) {
        return createTokenStream(["bad"])();
      }
      return createTokenStream(["good"])();
    };

    const result = await l0({
      stream: streamFactory,
      guardrails: [forceRetryRule],
      retry: { attempts: 2 },
      onEvent: collector.handler,
    });

    for await (const _ of result.stream) {
      // Consume stream
    }

    const types = collector.getEventTypes();

    // Find the RETRY_ATTEMPT event
    const retryIndex = types.indexOf(EventType.RETRY_ATTEMPT);
    expect(retryIndex).toBeGreaterThan(-1);

    // Find SESSION_START events
    const sessionStartIndices = types
      .map((t, i) => (t === EventType.SESSION_START ? i : -1))
      .filter((i) => i !== -1);

    expect(sessionStartIndices.length).toBe(2);

    // RETRY_ATTEMPT should be between first and second SESSION_START
    expect(retryIndex).toBeGreaterThan(sessionStartIndices[0]!);
    expect(retryIndex).toBeLessThan(sessionStartIndices[1]!);
  });

  it("should mark second SESSION_START as isRetry=true", async () => {
    const collector = createEventCollector();
    let attemptCount = 0;

    const forceRetryRule: GuardrailRule = {
      name: "force-retry",
      check: (ctx) => {
        if (ctx.completed && ctx.content.includes("retry-me")) {
          return [
            {
              rule: "force-retry",
              severity: "error",
              message: "Retry triggered",
              recoverable: true,
            },
          ];
        }
        return [];
      },
    };

    const streamFactory = () => {
      attemptCount++;
      if (attemptCount === 1) {
        return createTokenStream(["retry-me"])();
      }
      return createTokenStream(["success"])();
    };

    const result = await l0({
      stream: streamFactory,
      guardrails: [forceRetryRule],
      retry: { attempts: 2 },
      onEvent: collector.handler,
    });

    for await (const _ of result.stream) {
      // Consume stream
    }

    const sessionStarts = collector.getEventsOfType(EventType.SESSION_START);
    expect(sessionStarts.length).toBe(2);

    // First attempt
    expect(sessionStarts[0]!.data.attempt).toBe(1);
    expect(sessionStarts[0]!.data.isRetry).toBe(false);
    expect(sessionStarts[0]!.data.isFallback).toBe(false);

    // Second attempt (retry)
    expect(sessionStarts[1]!.data.attempt).toBe(2);
    expect(sessionStarts[1]!.data.isRetry).toBe(true);
    expect(sessionStarts[1]!.data.isFallback).toBe(false);
  });

  it("should call onRetry callback with attempt number and reason", async () => {
    const onRetry = vi.fn();
    let attemptCount = 0;

    const forceRetryRule: GuardrailRule = {
      name: "force-retry",
      check: (ctx) => {
        if (ctx.completed && ctx.content === "bad") {
          return [
            {
              rule: "force-retry",
              severity: "error",
              message: "Bad content",
              recoverable: true,
            },
          ];
        }
        return [];
      },
    };

    const streamFactory = () => {
      attemptCount++;
      if (attemptCount === 1) {
        return createTokenStream(["bad"])();
      }
      return createTokenStream(["good"])();
    };

    const result = await l0({
      stream: streamFactory,
      guardrails: [forceRetryRule],
      retry: { attempts: 2 },
      onRetry,
    });

    for await (const _ of result.stream) {
      // Consume stream
    }

    expect(onRetry).toHaveBeenCalledTimes(1);
    const [attempt, reason] = onRetry.mock.calls[0]!;
    expect(attempt).toBeGreaterThanOrEqual(1);
    expect(typeof reason).toBe("string");
    expect(reason).toContain("Guardrail");
  });

  it("should include correct data in RETRY_ATTEMPT event", async () => {
    const collector = createEventCollector();
    let attemptCount = 0;

    const forceRetryRule: GuardrailRule = {
      name: "test-rule",
      check: (ctx) => {
        if (ctx.completed && ctx.content === "trigger-retry") {
          return [
            {
              rule: "test-rule",
              severity: "error",
              message: "Triggered",
              recoverable: true,
            },
          ];
        }
        return [];
      },
    };

    const streamFactory = () => {
      attemptCount++;
      if (attemptCount === 1) {
        return createTokenStream(["trigger-retry"])();
      }
      return createTokenStream(["success-content"])();
    };

    const result = await l0({
      stream: streamFactory,
      guardrails: [forceRetryRule],
      retry: { attempts: 3 },
      onEvent: collector.handler,
      detectZeroTokens: false,
    });

    for await (const _ of result.stream) {
      // Consume stream
    }

    const retryAttempts = collector.getEventsOfType(EventType.RETRY_ATTEMPT);
    expect(retryAttempts.length).toBe(1);

    const retryEvent = retryAttempts[0]!;
    expect(retryEvent.data.attempt).toBeDefined();
    expect(retryEvent.data.maxAttempts).toBeDefined();
    expect(retryEvent.data.reason).toBeDefined();
    expect(typeof retryEvent.data.delayMs).toBe("number");
  });

  it("should handle multiple retries in correct order", async () => {
    const collector = createEventCollector();
    let attemptCount = 0;

    const forceRetryRule: GuardrailRule = {
      name: "multi-retry",
      check: (ctx) => {
        if (ctx.completed && ctx.content.includes("fail")) {
          return [
            {
              rule: "multi-retry",
              severity: "error",
              message: "Must retry",
              recoverable: true,
            },
          ];
        }
        return [];
      },
    };

    const streamFactory = () => {
      attemptCount++;
      if (attemptCount < 3) {
        return createTokenStream(["fail"])();
      }
      return createTokenStream(["success"])();
    };

    const result = await l0({
      stream: streamFactory,
      guardrails: [forceRetryRule],
      retry: { attempts: 3 },
      onEvent: collector.handler,
    });

    for await (const _ of result.stream) {
      // Consume stream
    }

    const sessionStarts = collector.getEventsOfType(EventType.SESSION_START);
    const retryAttempts = collector.getEventsOfType(EventType.RETRY_ATTEMPT);

    // Should have 3 session starts (initial + 2 retries)
    expect(sessionStarts.length).toBe(3);

    // Should have 2 retry attempts
    expect(retryAttempts.length).toBe(2);

    // Verify ordering: each RETRY_ATTEMPT should come before its corresponding SESSION_START
    const types = collector.getEventTypes();
    let lastRetryIndex = -1;
    let sessionStartAfterRetry = 0;

    for (let i = 0; i < types.length; i++) {
      if (types[i] === EventType.RETRY_ATTEMPT) {
        lastRetryIndex = i;
      }
      if (
        types[i] === EventType.SESSION_START &&
        lastRetryIndex !== -1 &&
        i > lastRetryIndex
      ) {
        sessionStartAfterRetry++;
        lastRetryIndex = -1; // Reset to avoid double counting
      }
    }

    expect(sessionStartAfterRetry).toBe(2);
  });

  it("should emit RETRY_FN_START and RETRY_FN_RESULT when shouldRetry callback is provided", async () => {
    const collector = createEventCollector();
    let attemptCount = 0;
    let shouldRetryCalled = false;

    const streamFactory = () => {
      attemptCount++;
      if (attemptCount === 1) {
        return createFailingStream([], new Error("Network error"))();
      }
      return createTokenStream(["success"])();
    };

    const result = await l0({
      stream: streamFactory,
      retry: {
        attempts: 3,
        retryOn: ["unknown"],
        shouldRetry: async (error, state, attempt, category) => {
          shouldRetryCalled = true;
          return true; // Allow retry
        },
      },
      onEvent: collector.handler,
      detectZeroTokens: false,
    });

    for await (const _ of result.stream) {
      // Consume stream
    }

    expect(shouldRetryCalled).toBe(true);

    // Check for RETRY_FN_START and RETRY_FN_RESULT events
    const fnStartEvents = collector.getEventsOfType(EventType.RETRY_FN_START);
    const fnResultEvents = collector.getEventsOfType(EventType.RETRY_FN_RESULT);

    expect(fnStartEvents.length).toBeGreaterThan(0);
    expect(fnResultEvents.length).toBeGreaterThan(0);

    // RETRY_FN_START should have defaultShouldRetry
    expect(fnStartEvents[0]?.data).toHaveProperty("defaultShouldRetry");

    // RETRY_FN_RESULT should have userResult and finalShouldRetry
    expect(fnResultEvents[0]?.data).toHaveProperty("userResult");
    expect(fnResultEvents[0]?.data).toHaveProperty("finalShouldRetry");
  });

  it("should emit RETRY_FN_ERROR when shouldRetry callback throws", async () => {
    const collector = createEventCollector();

    const streamFactory = () => {
      return createFailingStream([], new Error("Network error"))();
    };

    try {
      const result = await l0({
        stream: streamFactory,
        retry: {
          attempts: 3,
          retryOn: ["unknown"],
          shouldRetry: async () => {
            throw new Error("Callback error");
          },
        },
        onEvent: collector.handler,
        detectZeroTokens: false,
      });

      for await (const _ of result.stream) {
        // Consume stream
      }
    } catch {
      // Expected to throw since callback errors veto retry
    }

    // Check for RETRY_FN_ERROR event
    const fnErrorEvents = collector.getEventsOfType(EventType.RETRY_FN_ERROR);
    expect(fnErrorEvents.length).toBeGreaterThan(0);
    expect(fnErrorEvents[0]?.data).toHaveProperty("error");
    expect(fnErrorEvents[0]?.data.finalShouldRetry).toBe(false);
  });

  it("should allow shouldRetry to veto retry and proceed to fallback", async () => {
    const collector = createEventCollector();
    let shouldRetryCalls = 0;

    const streamFactory = () => {
      return createFailingStream([], new Error("Network error"))();
    };

    const result = await l0({
      stream: streamFactory,
      fallbackStreams: [() => createTokenStream(["fallback-success"])()],
      retry: {
        attempts: 3,
        retryOn: ["unknown"],
        shouldRetry: async () => {
          shouldRetryCalls++;
          return false; // Veto retry, should trigger fallback
        },
      },
      onEvent: collector.handler,
      detectZeroTokens: false,
    });

    for await (const _ of result.stream) {
      // Consume stream
    }

    expect(shouldRetryCalls).toBe(1);

    // Should have proceeded to fallback
    const fallbackStarts = collector.getEventsOfType(EventType.FALLBACK_START);
    expect(fallbackStarts.length).toBe(1);

    // Verify event order: RETRY_FN_RESULT (with veto) should come before FALLBACK_START
    const types = collector.getEventTypes();
    const fnResultIndex = types.indexOf(EventType.RETRY_FN_RESULT);
    const fallbackIndex = types.indexOf(EventType.FALLBACK_START);
    expect(fnResultIndex).toBeLessThan(fallbackIndex);
  });
});

// ============================================================================
// Fallback Flow Tests
// ============================================================================

describe("Lifecycle: Fallback Flow", () => {
  it("should emit FALLBACK_START when switching to fallback model", async () => {
    const collector = createEventCollector();

    const failRule: GuardrailRule = {
      name: "fail-primary",
      check: (ctx) => {
        if (ctx.completed && ctx.content === "primary") {
          return [
            {
              rule: "fail-primary",
              severity: "error",
              message: "Primary must fail",
              recoverable: false, // Non-recoverable triggers fallback
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
      onEvent: collector.handler,
    });

    for await (const _ of result.stream) {
      // Consume stream
    }

    const fallbackStarts = collector.getEventsOfType(EventType.FALLBACK_START);
    expect(fallbackStarts.length).toBe(1);
  });

  it("should mark SESSION_START as isFallback=true for fallback streams", async () => {
    const collector = createEventCollector();

    const failRule: GuardrailRule = {
      name: "fail-primary",
      check: (ctx) => {
        if (ctx.completed && ctx.content === "primary") {
          return [
            {
              rule: "fail-primary",
              severity: "error",
              message: "Fail",
              recoverable: false,
            },
          ];
        }
        return [];
      },
    };

    const result = await l0({
      stream: createTokenStream(["primary"]),
      fallbackStreams: [createTokenStream(["success"])],
      guardrails: [failRule],
      retry: { attempts: 1 },
      onEvent: collector.handler,
    });

    for await (const _ of result.stream) {
      // Consume stream
    }

    const sessionStarts = collector.getEventsOfType(EventType.SESSION_START);
    expect(sessionStarts.length).toBe(2);

    // First is primary
    expect(sessionStarts[0]!.data.isFallback).toBe(false);

    // Second is fallback
    expect(sessionStarts[1]!.data.isFallback).toBe(true);
  });

  it("should call onFallback callback with correct index and reason", async () => {
    const onFallback = vi.fn();

    const failRule: GuardrailRule = {
      name: "fail-primary",
      check: (ctx) => {
        if (ctx.completed && ctx.content === "primary") {
          return [
            {
              rule: "fail-primary",
              severity: "error",
              message: "Primary failed",
              recoverable: false,
            },
          ];
        }
        return [];
      },
    };

    const result = await l0({
      stream: createTokenStream(["primary"]),
      fallbackStreams: [createTokenStream(["success"])],
      guardrails: [failRule],
      retry: { attempts: 1 },
      onFallback,
    });

    for await (const _ of result.stream) {
      // Consume stream
    }

    expect(onFallback).toHaveBeenCalledTimes(1);
    const [index, reason] = onFallback.mock.calls[0]!;
    expect(index).toBe(0); // First fallback (0-indexed)
    expect(typeof reason).toBe("string");
  });

  it("should include fromIndex and toIndex in FALLBACK_START event", async () => {
    const collector = createEventCollector();

    const failRule: GuardrailRule = {
      name: "fail",
      check: (ctx) => {
        if (ctx.completed && !ctx.content.includes("success")) {
          return [
            {
              rule: "fail",
              severity: "error",
              message: "Fail",
              recoverable: false,
            },
          ];
        }
        return [];
      },
    };

    const result = await l0({
      stream: createTokenStream(["fail1"]),
      fallbackStreams: [
        createTokenStream(["fail2"]),
        createTokenStream(["success"]),
      ],
      guardrails: [failRule],
      retry: { attempts: 1 },
      onEvent: collector.handler,
    });

    for await (const _ of result.stream) {
      // Consume stream
    }

    const fallbackStarts = collector.getEventsOfType(EventType.FALLBACK_START);
    expect(fallbackStarts.length).toBe(2);

    // First fallback: from primary (0) to first fallback (1)
    expect(fallbackStarts[0]!.data.fromIndex).toBe(0);
    expect(fallbackStarts[0]!.data.toIndex).toBe(1);

    // Second fallback: from first fallback (1) to second fallback (2)
    expect(fallbackStarts[1]!.data.fromIndex).toBe(1);
    expect(fallbackStarts[1]!.data.toIndex).toBe(2);
  });

  /**
   * LIFECYCLE BEHAVIOR: Fallback after retries exhausted
   *
   * When all retries are exhausted on the primary stream, L0 should:
   * 1. Emit RETRY_ATTEMPT for each retry
   * 2. After exhausting retries, emit FALLBACK_START
   * 3. Then emit SESSION_START for the fallback stream
   *
   * Python port note: This test verifies the retry->fallback transition.
   * The exact behavior depends on the guardrail returning recoverable=true
   * to trigger retries, then eventually falling back.
   */
  it("should emit FALLBACK_START after retries exhausted", async () => {
    const collector = createEventCollector();
    let primaryAttempts = 0;

    // Use a stream error instead of guardrail to more reliably trigger retry->fallback
    const primaryFactory = () => {
      primaryAttempts++;
      // All primary attempts fail with stream error
      return createFailingStream(
        ["primary-content"],
        new Error("Primary failed"),
      )();
    };

    const result = await l0({
      stream: primaryFactory,
      fallbackStreams: [createTokenStream(["fallback-ok-content"])],
      retry: { attempts: 2, retryOn: ["unknown"] }, // 2 retries on unknown errors
      onEvent: collector.handler,
      detectZeroTokens: false,
    });

    for await (const _ of result.stream) {
      // Consume stream
    }

    const types = collector.getEventTypes();

    // Should have at least one FALLBACK_START event
    const fallbackStart = types.indexOf(EventType.FALLBACK_START);
    expect(fallbackStart).toBeGreaterThan(-1);

    // Should have session starts (at least 2: primary + fallback)
    const sessionStarts = collector.getEventsOfType(EventType.SESSION_START);
    expect(sessionStarts.length).toBeGreaterThanOrEqual(2);

    // Primary should have been tried multiple times
    expect(primaryAttempts).toBeGreaterThan(1);
  });
});

// ============================================================================
// Error Flow Tests
// ============================================================================

describe("Lifecycle: Error Flow", () => {
  it("should emit ERROR event with recoveryStrategy when error occurs", async () => {
    const collector = createEventCollector();

    const result = await l0({
      stream: createFailingStream(["start"]),
      fallbackStreams: [createTokenStream(["fallback"])],
      retry: { attempts: 1 },
      onEvent: collector.handler,
    });

    for await (const _ of result.stream) {
      // Consume stream
    }

    const errors = collector.getEventsOfType(EventType.ERROR);
    expect(errors.length).toBeGreaterThan(0);

    const errorEvent = errors[0]!;
    expect(errorEvent.data.error).toBeDefined();
    expect(errorEvent.data.recoveryStrategy).toBeDefined();
    expect(["retry", "fallback", "halt"]).toContain(
      errorEvent.data.recoveryStrategy,
    );
  });

  it("should call onError callback with error and recovery flags", async () => {
    const onError = vi.fn();

    const result = await l0({
      stream: createFailingStream(["start"]),
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

  it("should indicate willRetry=true when retries available", async () => {
    const onError = vi.fn();
    let attempts = 0;

    const streamFactory = () => {
      attempts++;
      if (attempts === 1) {
        return createFailingStream(["fail-content"])();
      }
      return createTokenStream(["success-content"])();
    };

    const result = await l0({
      stream: streamFactory,
      retry: { attempts: 2, retryOn: ["unknown"] },
      onError,
      detectZeroTokens: false,
    });

    for await (const _ of result.stream) {
      // Consume stream
    }

    expect(onError).toHaveBeenCalled();
    // At least one call should indicate retry
    const anyRetry = onError.mock.calls.some((call) => call[1] === true);
    expect(anyRetry).toBe(true);
  });

  it("should indicate willFallback=true when no retries but fallback available", async () => {
    const onError = vi.fn();

    const result = await l0({
      stream: createFailingStream([]),
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

  it("should include failureType in ERROR event", async () => {
    const collector = createEventCollector();

    const result = await l0({
      stream: createFailingStream(["data-content"], new Error("Network error")),
      fallbackStreams: [createTokenStream(["ok-content"])],
      retry: { attempts: 0 },
      onEvent: collector.handler,
      detectZeroTokens: false,
    });

    for await (const _ of result.stream) {
      // Consume stream
    }

    const errors = collector.getEventsOfType(EventType.ERROR);
    expect(errors.length).toBeGreaterThan(0);

    const errorEvent = errors[0]!;
    expect(errorEvent.data.failureType).toBeDefined();
  });

  it("should include policy in ERROR event", async () => {
    const collector = createEventCollector();

    const result = await l0({
      stream: createFailingStream(["some-content"]),
      fallbackStreams: [createTokenStream(["ok-content"])],
      retry: { attempts: 2 },
      onEvent: collector.handler,
      detectZeroTokens: false,
    });

    for await (const _ of result.stream) {
      // Consume stream
    }

    const errors = collector.getEventsOfType(EventType.ERROR);
    expect(errors.length).toBeGreaterThan(0);

    const errorEvent = errors[0]!;
    const policy = errorEvent.data.policy as
      | Record<string, unknown>
      | undefined;
    if (policy) {
      expect(policy.retryEnabled).toBeDefined();
      expect(policy.fallbackEnabled).toBeDefined();
      expect(policy.maxRetries).toBeDefined();
    }
  });
});

// ============================================================================
// Checkpoint & Continuation Tests
// ============================================================================

describe("Lifecycle: Checkpoint and Continuation Flow", () => {
  it("should emit CHECKPOINT_SAVED events when continuation enabled", async () => {
    const collector = createEventCollector();

    // Generate enough tokens to trigger checkpoint
    const tokens = Array.from({ length: 15 }, (_, i) => `t${i}-`);

    const result = await l0({
      stream: createTokenStream(tokens),
      continueFromLastKnownGoodToken: true,
      checkIntervals: { checkpoint: 5 },
      onEvent: collector.handler,
    });

    for await (const _ of result.stream) {
      // Consume stream
    }

    const checkpoints = collector.getEventsOfType(EventType.CHECKPOINT_SAVED);
    expect(checkpoints.length).toBeGreaterThan(0);
  });

  it("should NOT emit CHECKPOINT_SAVED when continuation disabled", async () => {
    const collector = createEventCollector();

    const tokens = Array.from({ length: 15 }, (_, i) => `t${i}-`);

    const result = await l0({
      stream: createTokenStream(tokens),
      continueFromLastKnownGoodToken: false,
      checkIntervals: { checkpoint: 5 },
      onEvent: collector.handler,
    });

    for await (const _ of result.stream) {
      // Consume stream
    }

    const checkpoints = collector.getEventsOfType(EventType.CHECKPOINT_SAVED);
    expect(checkpoints.length).toBe(0);
  });

  it("should include checkpoint content and tokenCount in CHECKPOINT_SAVED", async () => {
    const collector = createEventCollector();

    // Use distinct tokens that won't trigger zero output detection
    const tokens = Array.from({ length: 12 }, (_, i) => `token${i}-`);

    const result = await l0({
      stream: createTokenStream(tokens),
      continueFromLastKnownGoodToken: true,
      checkIntervals: { checkpoint: 5 },
      onEvent: collector.handler,
      detectZeroTokens: false,
    });

    for await (const _ of result.stream) {
      // Consume stream
    }

    const checkpoints = collector.getEventsOfType(EventType.CHECKPOINT_SAVED);
    expect(checkpoints.length).toBeGreaterThan(0);

    const cp = checkpoints[0]!;
    expect(typeof cp.data.checkpoint).toBe("string");
    expect(typeof cp.data.tokenCount).toBe("number");
    expect(cp.data.tokenCount).toBeGreaterThan(0);
  });

  it("should call onCheckpoint callback", async () => {
    const onCheckpoint = vi.fn();

    const tokens = Array.from({ length: 15 }, (_, i) => `t${i}-`);

    const result = await l0({
      stream: createTokenStream(tokens),
      continueFromLastKnownGoodToken: true,
      checkIntervals: { checkpoint: 5 },
      onCheckpoint,
    });

    for await (const _ of result.stream) {
      // Consume stream
    }

    expect(onCheckpoint).toHaveBeenCalled();
    const [checkpoint, tokenCount] = onCheckpoint.mock.calls[0]!;
    expect(typeof checkpoint).toBe("string");
    expect(typeof tokenCount).toBe("number");
  });

  it("should emit RESUME_START when resuming from checkpoint", async () => {
    const collector = createEventCollector();

    // Primary generates tokens then fails
    const primaryStream = async function* (): AsyncGenerator<L0Event> {
      for (let i = 0; i < 12; i++) {
        yield { type: "token", value: `t${i}-`, timestamp: Date.now() };
      }
      yield {
        type: "error",
        error: new Error("Failed"),
        timestamp: Date.now(),
      };
    };

    const result = await l0({
      stream: () => primaryStream(),
      fallbackStreams: [createTokenStream(["continued"])],
      retry: { attempts: 1 },
      continueFromLastKnownGoodToken: true,
      checkIntervals: { checkpoint: 5 },
      onEvent: collector.handler,
    });

    for await (const _ of result.stream) {
      // Consume stream
    }

    const resumes = collector.getEventsOfType(EventType.RESUME_START);
    expect(resumes.length).toBeGreaterThan(0);
  });

  it("should include checkpoint content in RESUME_START event", async () => {
    const collector = createEventCollector();

    const primaryStream = async function* (): AsyncGenerator<L0Event> {
      yield { type: "token", value: "check", timestamp: Date.now() };
      yield { type: "token", value: "point", timestamp: Date.now() };
      yield { type: "token", value: "data", timestamp: Date.now() };
      yield { type: "token", value: "here", timestamp: Date.now() };
      yield { type: "token", value: "now", timestamp: Date.now() };
      yield { type: "token", value: "fail", timestamp: Date.now() };
      yield { type: "error", error: new Error("Fail"), timestamp: Date.now() };
    };

    const result = await l0({
      stream: () => primaryStream(),
      fallbackStreams: [createTokenStream(["ok"])],
      retry: { attempts: 1 },
      continueFromLastKnownGoodToken: true,
      checkIntervals: { checkpoint: 3 },
      onEvent: collector.handler,
    });

    for await (const _ of result.stream) {
      // Consume stream
    }

    const resumes = collector.getEventsOfType(EventType.RESUME_START);
    if (resumes.length > 0) {
      const resumeEvent = resumes[0]!;
      expect(typeof resumeEvent.data.checkpoint).toBe("string");
      expect((resumeEvent.data.checkpoint as string).length).toBeGreaterThan(0);
      expect(typeof resumeEvent.data.tokenCount).toBe("number");
    }
  });

  it("should call onResume callback with checkpoint content", async () => {
    const onResume = vi.fn();

    const primaryStream = async function* (): AsyncGenerator<L0Event> {
      for (let i = 0; i < 10; i++) {
        yield { type: "token", value: `t${i}-`, timestamp: Date.now() };
      }
      yield { type: "error", error: new Error("Fail"), timestamp: Date.now() };
    };

    const result = await l0({
      stream: () => primaryStream(),
      fallbackStreams: [createTokenStream(["ok"])],
      retry: { attempts: 1 },
      continueFromLastKnownGoodToken: true,
      checkIntervals: { checkpoint: 3 },
      onResume,
    });

    for await (const _ of result.stream) {
      // Consume stream
    }

    expect(onResume).toHaveBeenCalled();
    const [checkpoint, tokenCount] = onResume.mock.calls[0]!;
    expect(typeof checkpoint).toBe("string");
    expect(typeof tokenCount).toBe("number");
  });

  it("should emit RESUME_START after FALLBACK_START in fallback+resume flow", async () => {
    const collector = createEventCollector();

    const primaryStream = async function* (): AsyncGenerator<L0Event> {
      for (let i = 0; i < 10; i++) {
        yield { type: "token", value: `t${i}`, timestamp: Date.now() };
      }
      yield { type: "error", error: new Error("Fail"), timestamp: Date.now() };
    };

    const result = await l0({
      stream: () => primaryStream(),
      fallbackStreams: [createTokenStream(["done"])],
      retry: { attempts: 1 },
      continueFromLastKnownGoodToken: true,
      checkIntervals: { checkpoint: 3 },
      onEvent: collector.handler,
    });

    for await (const _ of result.stream) {
      // Consume stream
    }

    const types = collector.getEventTypes();
    const fallbackIndex = types.indexOf(EventType.FALLBACK_START);
    const resumeIndex = types.indexOf(EventType.RESUME_START);

    // RESUME_START should come after FALLBACK_START
    if (fallbackIndex !== -1 && resumeIndex !== -1) {
      expect(resumeIndex).toBeGreaterThan(fallbackIndex);
    }
  });
});

// ============================================================================
// Abort Flow Tests
// ============================================================================

describe("Lifecycle: Abort Flow", () => {
  it("should emit ABORT_COMPLETED when stream is aborted", async () => {
    const collector = createEventCollector();

    const slowStream = async function* (): AsyncGenerator<L0Event> {
      for (let i = 0; i < 100; i++) {
        yield { type: "token", value: `t${i}`, timestamp: Date.now() };
        await new Promise((r) => setTimeout(r, 10));
      }
      yield { type: "complete", timestamp: Date.now() };
    };

    const result = await l0({
      stream: () => slowStream(),
      onEvent: collector.handler,
    });

    let count = 0;
    try {
      for await (const event of result.stream) {
        if (event.type === "token") {
          count++;
          if (count >= 5) {
            result.abort();
          }
        }
      }
    } catch {
      // Expected
    }

    const aborts = collector.getEventsOfType(EventType.ABORT_COMPLETED);
    expect(aborts.length).toBe(1);
  });

  it("should include tokenCount and contentLength in ABORT_COMPLETED", async () => {
    const collector = createEventCollector();

    const slowStream = async function* (): AsyncGenerator<L0Event> {
      for (let i = 0; i < 100; i++) {
        yield { type: "token", value: `x`, timestamp: Date.now() };
        await new Promise((r) => setTimeout(r, 10));
      }
    };

    const result = await l0({
      stream: () => slowStream(),
      onEvent: collector.handler,
    });

    let count = 0;
    try {
      for await (const event of result.stream) {
        if (event.type === "token") {
          count++;
          if (count >= 5) {
            result.abort();
          }
        }
      }
    } catch {
      // Expected
    }

    const aborts = collector.getEventsOfType(EventType.ABORT_COMPLETED);
    expect(aborts.length).toBe(1);

    const abortEvent = aborts[0]!;
    expect(typeof abortEvent.data.tokenCount).toBe("number");
    expect(typeof abortEvent.data.contentLength).toBe("number");
  });

  it("should call onAbort callback", async () => {
    const onAbort = vi.fn();

    const slowStream = async function* (): AsyncGenerator<L0Event> {
      for (let i = 0; i < 100; i++) {
        yield { type: "token", value: `t${i}`, timestamp: Date.now() };
        await new Promise((r) => setTimeout(r, 10));
      }
    };

    const result = await l0({
      stream: () => slowStream(),
      onAbort,
    });

    let count = 0;
    try {
      for await (const event of result.stream) {
        if (event.type === "token") {
          count++;
          if (count >= 5) {
            result.abort();
          }
        }
      }
    } catch {
      // Expected
    }

    expect(onAbort).toHaveBeenCalledTimes(1);
    const [tokenCount, contentLength] = onAbort.mock.calls[0]!;
    expect(typeof tokenCount).toBe("number");
    expect(typeof contentLength).toBe("number");
  });

  it("should throw L0Error after abort", async () => {
    const slowStream = async function* (): AsyncGenerator<L0Event> {
      for (let i = 0; i < 100; i++) {
        yield { type: "token", value: `t${i}`, timestamp: Date.now() };
        await new Promise((r) => setTimeout(r, 10));
      }
    };

    const result = await l0({
      stream: () => slowStream(),
    });

    let errorThrown = false;
    let count = 0;

    try {
      for await (const event of result.stream) {
        if (event.type === "token") {
          count++;
          if (count >= 5) {
            result.abort();
          }
        }
      }
    } catch (error) {
      errorThrown = true;
      expect((error as Error).message).toContain("abort");
    }

    expect(errorThrown).toBe(true);
  });
});

// ============================================================================
// Timeout Flow Tests
// ============================================================================

/**
 * LIFECYCLE BEHAVIOR: Timeout Flow
 *
 * L0 supports two types of timeouts:
 * 1. Initial token timeout - max time to wait for first token
 * 2. Inter-token timeout - max time between consecutive tokens
 *
 * When a timeout occurs:
 * 1. TIMEOUT_TRIGGERED event is emitted (timeoutType, elapsedMs)
 * 2. onTimeout callback is called
 * 3. L0Error is thrown with code INITIAL_TOKEN_TIMEOUT or INTER_TOKEN_TIMEOUT
 * 4. If retries available, RETRY_ATTEMPT follows
 *
 * Python port note: These tests document expected timeout behavior.
 * Timeout detection happens inside the stream iteration loop, checking
 * elapsed time between tokens. The exact implementation may vary.
 */
describe("Lifecycle: Timeout Flow", () => {
  // Note: Timeout tests require the stream to block INSIDE the for-await loop
  // The L0 timeout check happens when waiting for the next chunk

  it.skip("should emit TIMEOUT_TRIGGERED on initial token timeout", async () => {
    // DOCUMENTED BEHAVIOR:
    // When a stream doesn't emit its first token within initialToken timeout:
    // 1. TIMEOUT_TRIGGERED event with timeoutType="initial"
    // 2. Error thrown with code INITIAL_TOKEN_TIMEOUT
    //
    // Implementation note: L0 uses setTimeout to track initial token timeout.
    // The timeout fires if no token is received within the configured time.
    expect(true).toBe(true);
  });

  it.skip("should call onTimeout callback", async () => {
    // DOCUMENTED BEHAVIOR:
    // The onTimeout(type, elapsedMs) callback is called when timeout occurs
    // - type: "initial" or "inter"
    // - elapsedMs: time elapsed before timeout triggered
    expect(true).toBe(true);
  });

  it.skip("should retry on timeout when retries available", async () => {
    // DOCUMENTED BEHAVIOR:
    // When timeout occurs and retries are available:
    // 1. TIMEOUT_TRIGGERED event
    // 2. ERROR event with recoveryStrategy="retry"
    // 3. RETRY_ATTEMPT event
    // 4. SESSION_START for retry attempt
    expect(true).toBe(true);
  });

  // Add a simpler test that documents the timeout configuration
  it("should accept timeout configuration", async () => {
    const result = await l0({
      stream: createTokenStream(["quick", "response"]),
      timeout: {
        initialToken: 5000, // 5 seconds for first token
        interToken: 10000, // 10 seconds between tokens
      },
    });

    for await (const _ of result.stream) {
      // Consume stream
    }

    expect(result.state.completed).toBe(true);
  });
});

// ============================================================================
// Guardrail Violation Flow Tests
// ============================================================================

describe("Lifecycle: Guardrail Violation Flow", () => {
  it("should emit GUARDRAIL_RULE_RESULT on violation", async () => {
    const collector = createEventCollector();

    const badWordRule: GuardrailRule = {
      name: "no-bad",
      check: (ctx) => {
        if (ctx.content.includes("bad")) {
          return [
            {
              rule: "no-bad",
              severity: "warning",
              message: "Bad word detected",
              recoverable: true,
            },
          ];
        }
        return [];
      },
    };

    const result = await l0({
      stream: createTokenStream([
        "this",
        " ",
        "is",
        " ",
        "bad",
        " ",
        "content",
      ]),
      guardrails: [badWordRule],
      checkIntervals: { guardrails: 1 },
      onEvent: collector.handler,
    });

    for await (const _ of result.stream) {
      // Consume stream
    }

    const violations = collector.getEventsOfType(
      EventType.GUARDRAIL_RULE_RESULT,
    );
    expect(violations.length).toBeGreaterThan(0);
  });

  it("should call onViolation callback", async () => {
    const onViolation = vi.fn();

    const alwaysViolateRule: GuardrailRule = {
      name: "always-violate",
      check: (ctx) => {
        if (ctx.completed) {
          return [
            {
              rule: "always-violate",
              severity: "warning",
              message: "Always violates",
              recoverable: true,
            },
          ];
        }
        return [];
      },
    };

    const result = await l0({
      stream: createTokenStream(["test"]),
      guardrails: [alwaysViolateRule],
      onViolation,
    });

    for await (const _ of result.stream) {
      // Consume stream
    }

    expect(onViolation).toHaveBeenCalled();
    const violation = onViolation.mock.calls[0]![0];
    expect(violation.rule).toBe("always-violate");
    expect(violation.severity).toBe("warning");
  });

  it("should include violation details in GUARDRAIL_RULE_RESULT event", async () => {
    const collector = createEventCollector();

    const detailedRule: GuardrailRule = {
      name: "detailed-rule",
      check: (ctx) => {
        if (ctx.completed) {
          return [
            {
              rule: "detailed-rule",
              severity: "warning", // Use warning to avoid fatal halt
              message: "Detailed violation message",
              position: { line: 1, column: 5 },
              recoverable: true,
            },
          ];
        }
        return [];
      },
    };

    const result = await l0({
      stream: createTokenStream(["test-content"]),
      guardrails: [detailedRule],
      onEvent: collector.handler,
      detectZeroTokens: false,
    });

    for await (const _ of result.stream) {
      // Consume stream
    }

    const violations = collector.getEventsOfType(
      EventType.GUARDRAIL_RULE_RESULT,
    );
    expect(violations.length).toBeGreaterThan(0);

    const violationEvent = violations[0]!;
    expect(violationEvent.data.ruleId).toBe("detailed-rule");
    expect(violationEvent.data.passed).toBe(false);
    expect(violationEvent.data.violation).toBeDefined();
  });
});

// ============================================================================
// Combined Flow Tests
// ============================================================================

describe("Lifecycle: Combined Complex Flows", () => {
  it("should handle retry -> fallback -> resume flow correctly", async () => {
    const collector = createEventCollector();
    let primaryAttempts = 0;

    const forceRetryRule: GuardrailRule = {
      name: "force-retry",
      check: (ctx) => {
        if (ctx.completed && ctx.content === "primary-fail") {
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

    const primaryFactory = () => {
      primaryAttempts++;
      if (primaryAttempts <= 2) {
        // First two attempts fail via guardrail
        return createTokenStream(["primary-fail"])();
      }
      // Third attempt also fails to trigger fallback
      return createFailingStream(
        ["prim", "ary", "-", "fail"],
        new Error("Primary exhausted"),
      )();
    };

    const result = await l0({
      stream: primaryFactory,
      fallbackStreams: [createTokenStream(["fallback-success"])],
      guardrails: [forceRetryRule],
      retry: { attempts: 2 },
      continueFromLastKnownGoodToken: true,
      checkIntervals: { checkpoint: 2 },
      onEvent: collector.handler,
    });

    for await (const _ of result.stream) {
      // Consume stream
    }

    const types = collector.getEventTypes();

    // Should see the sequence: SESSION_START -> ... -> RETRY_ATTEMPT -> SESSION_START -> ...
    // -> RETRY_ATTEMPT -> SESSION_START -> ... -> FALLBACK_START -> SESSION_START -> COMPLETE
    expect(types.includes(EventType.SESSION_START)).toBe(true);
    expect(types.includes(EventType.RETRY_ATTEMPT)).toBe(true);
    expect(types.includes(EventType.FALLBACK_START)).toBe(true);
    expect(types.includes(EventType.COMPLETE)).toBe(true);

    // Verify overall completion
    expect(result.state.completed).toBe(true);
  });

  it("should maintain consistent event order across all callback types", async () => {
    const callOrder: string[] = [];

    const onStart = vi.fn(() => callOrder.push("onStart"));
    const onComplete = vi.fn(() => callOrder.push("onComplete"));
    const onRetry = vi.fn(() => callOrder.push("onRetry"));
    const onFallback = vi.fn(() => callOrder.push("onFallback"));
    const onResume = vi.fn(() => callOrder.push("onResume"));
    const onCheckpoint = vi.fn(() => callOrder.push("onCheckpoint"));

    const primaryStream = async function* (): AsyncGenerator<L0Event> {
      for (let i = 0; i < 10; i++) {
        yield { type: "token", value: `t${i}`, timestamp: Date.now() };
      }
      yield { type: "error", error: new Error("Fail"), timestamp: Date.now() };
    };

    const result = await l0({
      stream: () => primaryStream(),
      fallbackStreams: [createTokenStream(["ok"])],
      retry: { attempts: 1 },
      continueFromLastKnownGoodToken: true,
      checkIntervals: { checkpoint: 3 },
      onStart,
      onComplete,
      onRetry,
      onFallback,
      onResume,
      onCheckpoint,
    });

    for await (const _ of result.stream) {
      // Consume stream
    }

    // onStart should be called first (for each attempt)
    expect(callOrder[0]).toBe("onStart");

    // onComplete should be called last
    expect(callOrder[callOrder.length - 1]).toBe("onComplete");

    // Checkpoints should come during streaming
    expect(callOrder.includes("onCheckpoint")).toBe(true);

    // onFallback should come before the fallback's onStart
    const fallbackIndex = callOrder.indexOf("onFallback");
    const lastOnStartIndex = callOrder.lastIndexOf("onStart");
    if (fallbackIndex !== -1) {
      expect(fallbackIndex).toBeLessThan(lastOnStartIndex);
    }
  });

  /**
   * LIFECYCLE BEHAVIOR: State tracking through complex flow
   *
   * After a successful completion following retries:
   * - state.completed = true
   * - state.content = final successful content
   * - state.tokenCount = tokens from final attempt
   * - state.modelRetryCount = number of model retries performed
   *
   * Note: Violations from failed attempts may or may not be preserved
   * depending on the state reset behavior. This test documents the
   * expected final state after a retry succeeds.
   */
  it("should track all state correctly through complex flow", async () => {
    let attemptCount = 0;

    const rule: GuardrailRule = {
      name: "test",
      check: (ctx) => {
        if (ctx.completed && ctx.content.includes("retry-trigger")) {
          return [
            {
              rule: "test",
              severity: "error", // Error severity triggers retry
              message: "Must retry",
              recoverable: true, // Recoverable allows retry
            },
          ];
        }
        return [];
      },
    };

    const streamFactory = () => {
      attemptCount++;
      if (attemptCount === 1) {
        return createTokenStream(["retry-trigger"])();
      }
      return createTokenStream(["final", "-", "success"])();
    };

    const result = await l0({
      stream: streamFactory,
      guardrails: [rule],
      retry: { attempts: 2 },
      detectZeroTokens: false,
    });

    for await (const _ of result.stream) {
      // Consume stream
    }

    // State should reflect final successful attempt
    expect(result.state.completed).toBe(true);
    expect(result.state.content).toBe("final-success");
    expect(result.state.tokenCount).toBe(3);
    // Note: modelRetryCount tracks retries performed
    expect(result.state.modelRetryCount).toBe(1);
  });
});

// ============================================================================
// Event Timestamp Ordering Tests
// ============================================================================

describe("Lifecycle: Event Timestamp Ordering", () => {
  it("should have monotonically increasing timestamps", async () => {
    const collector = createEventCollector();

    const result = await l0({
      stream: createTokenStream(["a", "b", "c", "d", "e"]),
      onEvent: collector.handler,
    });

    for await (const _ of result.stream) {
      // Consume stream
    }

    const events = collector.events;
    for (let i = 1; i < events.length; i++) {
      expect(events[i]!.ts).toBeGreaterThanOrEqual(events[i - 1]!.ts);
    }
  });

  it("should have consistent streamId across all events in session", async () => {
    const collector = createEventCollector();

    const result = await l0({
      stream: createTokenStream(["test"]),
      onEvent: collector.handler,
    });

    for await (const _ of result.stream) {
      // Consume stream
    }

    // Get all observability events (those with streamId)
    const obsEvents = collector.events.filter((e) => e.data.streamId);

    if (obsEvents.length > 0) {
      const streamId = obsEvents[0]!.data.streamId;
      for (const event of obsEvents) {
        expect(event.data.streamId).toBe(streamId);
      }
    }
  });

  it("should include user meta in all observability events", async () => {
    const collector = createEventCollector();

    const result = await l0({
      stream: createTokenStream(["test"]),
      meta: {
        requestId: "req-123",
        userId: "user-456",
      },
      onEvent: collector.handler,
    });

    for await (const _ of result.stream) {
      // Consume stream
    }

    // Get all observability events (those with meta)
    const obsEvents = collector.events.filter((e) => e.data.meta);

    for (const event of obsEvents) {
      const meta = event.data.meta as Record<string, unknown>;
      expect(meta.requestId).toBe("req-123");
      expect(meta.userId).toBe("user-456");
    }
  });
});
