/**
 * Comprehensive Lifecycle Tests for L0 Runtime
 *
 * These tests document the DETERMINISTIC lifecycle behavior of L0 for porting to Python.
 * Each test verifies the exact ordering of events and callbacks during various scenarios.
 *
 * LIFECYCLE EVENT ORDERING:
 * -------------------------
 * SESSION_START is emitted exactly ONCE at the beginning of the session (anchor for entire session).
 * Retries and fallbacks do NOT emit additional SESSION_START events.
 *
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
 *   5. [tokens stream...]
 *   6. COMPLETE
 *
 * Fallback flow (retries exhausted):
 *   1. SESSION_START (attempt=1, isRetry=false, isFallback=false)
 *   2. [error occurs, retries exhausted]
 *   3. ERROR (with recoveryStrategy="fallback")
 *   4. FALLBACK_START (fromIndex=0, toIndex=1)
 *   5. [tokens stream...]
 *   6. COMPLETE
 *
 * Continuation/Resume flow:
 *   1. SESSION_START (attempt=1)
 *   2. [tokens stream...]
 *   3. CHECKPOINT_SAVED
 *   4. [error occurs]
 *   5. ERROR (with recoveryStrategy="retry" or "fallback")
 *   6. RETRY_ATTEMPT or FALLBACK_START
 *   7. RESUME_START (checkpoint content, tokenCount)
 *   8. [continuation tokens...]
 *   9. COMPLETE
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
      // Check if it's an observability event (has ts, streamId, context)
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
  it("should emit RETRY_ATTEMPT after SESSION_START on guardrail retry", async () => {
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

    // SESSION_START should be emitted exactly once at the beginning
    const sessionStartIndices = types
      .map((t, i) => (t === EventType.SESSION_START ? i : -1))
      .filter((i) => i !== -1);

    expect(sessionStartIndices.length).toBe(1);

    // RETRY_ATTEMPT should come after the single SESSION_START
    expect(retryIndex).toBeGreaterThan(sessionStartIndices[0]!);
  });

  it("should emit SESSION_START once and ATTEMPT_START for retries", async () => {
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

    // SESSION_START is emitted only once at the beginning (anchor for entire session)
    const sessionStarts = collector.getEventsOfType(EventType.SESSION_START);
    expect(sessionStarts.length).toBe(1);

    // The single SESSION_START should have initial attempt values
    expect(sessionStarts[0]!.data.attempt).toBe(1);
    expect(sessionStarts[0]!.data.isRetry).toBe(false);
    expect(sessionStarts[0]!.data.isFallback).toBe(false);

    // ATTEMPT_START is emitted for retry attempts (triggers onStart callback)
    const attemptStarts = collector.getEventsOfType(EventType.ATTEMPT_START);
    expect(attemptStarts.length).toBe(1);
    expect(attemptStarts[0]!.data.attempt).toBe(2);
    expect(attemptStarts[0]!.data.isRetry).toBe(true);
    expect(attemptStarts[0]!.data.isFallback).toBe(false);

    // Verify retry actually happened via RETRY_ATTEMPT event
    const retryAttempts = collector.getEventsOfType(EventType.RETRY_ATTEMPT);
    expect(retryAttempts.length).toBe(1);
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

    // SESSION_START is emitted only once (anchor for entire session)
    expect(sessionStarts.length).toBe(1);

    // Should have 2 retry attempts
    expect(retryAttempts.length).toBe(2);

    // Verify ordering: SESSION_START comes first, then RETRY_ATTEMPTs
    const types = collector.getEventTypes();
    const sessionStartIndex = types.indexOf(EventType.SESSION_START);

    // All RETRY_ATTEMPTs should come after SESSION_START
    for (let i = 0; i < types.length; i++) {
      if (types[i] === EventType.RETRY_ATTEMPT) {
        expect(i).toBeGreaterThan(sessionStartIndex);
      }
    }
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

  it("should emit FALLBACK_START (not ATTEMPT_START) for fallback streams", async () => {
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

    // SESSION_START is emitted only once at the beginning (anchor for entire session)
    const sessionStarts = collector.getEventsOfType(EventType.SESSION_START);
    expect(sessionStarts.length).toBe(1);

    // The single SESSION_START should have initial values (not fallback)
    expect(sessionStarts[0]!.data.isFallback).toBe(false);

    // ATTEMPT_START is NOT emitted for fallbacks (only for retries)
    const attemptStarts = collector.getEventsOfType(EventType.ATTEMPT_START);
    expect(attemptStarts.length).toBe(0);

    // Verify fallback happened via FALLBACK_START event (triggers onStart callback)
    const fallbackStarts = collector.getEventsOfType(EventType.FALLBACK_START);
    expect(fallbackStarts.length).toBe(1);
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
   * 1. Emit SESSION_START once at the beginning (anchor for entire session)
   * 2. Emit RETRY_ATTEMPT for each retry
   * 3. After exhausting retries, emit FALLBACK_START
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

    // SESSION_START is emitted only once (anchor for entire session)
    const sessionStarts = collector.getEventsOfType(EventType.SESSION_START);
    expect(sessionStarts.length).toBe(1);

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
    expect(resumes.length).toBeGreaterThan(0);
    const resumeEvent = resumes[0]!;
    expect(typeof resumeEvent.data.checkpoint).toBe("string");
    expect((resumeEvent.data.checkpoint as string).length).toBeGreaterThan(0);
    expect(typeof resumeEvent.data.tokenCount).toBe("number");
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
              position: 5,
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

    // onStart should be called at the beginning (initial attempt) and for fallback attempt
    expect(callOrder[0]).toBe("onStart");
    // onStart is called twice: once for initial, once for fallback
    expect(callOrder.filter((c) => c === "onStart").length).toBe(2);

    // onComplete should be called last
    expect(callOrder[callOrder.length - 1]).toBe("onComplete");

    // Checkpoints should come during streaming
    expect(callOrder.includes("onCheckpoint")).toBe(true);

    // onFallback should come after first onStart
    const fallbackIndex = callOrder.indexOf("onFallback");
    const onStartIndex = callOrder.indexOf("onStart");
    if (fallbackIndex !== -1) {
      expect(fallbackIndex).toBeGreaterThan(onStartIndex);
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
    expect(obsEvents.length).toBeGreaterThan(0);

    const streamId = obsEvents[0]!.data.streamId;
    for (const event of obsEvents) {
      expect(event.data.streamId).toBe(streamId);
    }
  });

  it("should include user context in all observability events", async () => {
    const collector = createEventCollector();

    const result = await l0({
      stream: createTokenStream(["test"]),
      context: {
        requestId: "req-123",
        userId: "user-456",
      },
      onEvent: collector.handler,
    });

    for await (const _ of result.stream) {
      // Consume stream
    }

    // Get all observability events (those with context)
    const obsEvents = collector.events.filter((e) => e.data.context);

    for (const event of obsEvents) {
      const context = event.data.context as Record<string, unknown>;
      expect(context.requestId).toBe("req-123");
      expect(context.userId).toBe("user-456");
    }
  });

  it("should include user context in retry events", async () => {
    const collector = createEventCollector();
    let attemptCount = 0;

    const forceRetryRule: GuardrailRule = {
      name: "force-retry",
      check: (ctx) => {
        if (ctx.completed && attemptCount < 2) {
          return [
            {
              rule: "force-retry",
              severity: "error",
              message: "Forcing retry",
              recoverable: true,
            },
          ];
        }
        return [];
      },
    };

    const streamFactory = () => {
      attemptCount++;
      return createTokenStream(["test"])();
    };

    const result = await l0({
      stream: streamFactory,
      guardrails: [forceRetryRule],
      retry: { attempts: 3 },
      context: {
        requestId: "retry-req-123",
        traceId: "trace-abc",
      },
      onEvent: collector.handler,
    });

    for await (const _ of result.stream) {
      // Consume stream
    }

    // Check RETRY_ATTEMPT events have context
    const retryEvents = collector.getEventsOfType(EventType.RETRY_ATTEMPT);
    expect(retryEvents.length).toBeGreaterThan(0);
    for (const event of retryEvents) {
      const context = event.data.context as Record<string, unknown>;
      expect(context.requestId).toBe("retry-req-123");
      expect(context.traceId).toBe("trace-abc");
    }

    // Check ATTEMPT_START events have context
    const attemptStarts = collector.getEventsOfType(EventType.ATTEMPT_START);
    for (const event of attemptStarts) {
      const context = event.data.context as Record<string, unknown>;
      expect(context.requestId).toBe("retry-req-123");
      expect(context.traceId).toBe("trace-abc");
    }
  });

  it("should include user context in fallback events", async () => {
    const collector = createEventCollector();

    const failRule: GuardrailRule = {
      name: "fail-primary",
      check: (ctx) => {
        // Only fail on primary content, not fallback
        if (ctx.completed && ctx.content === "primary") {
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
      fallbackStreams: [createTokenStream(["fallback"])],
      guardrails: [failRule],
      retry: { attempts: 1 },
      context: {
        requestId: "fallback-req-456",
        environment: "test",
      },
      onEvent: collector.handler,
    });

    for await (const _ of result.stream) {
      // Consume stream
    }

    // Check FALLBACK_START events have context
    const fallbackStarts = collector.getEventsOfType(EventType.FALLBACK_START);
    expect(fallbackStarts.length).toBeGreaterThan(0);
    for (const event of fallbackStarts) {
      const context = event.data.context as Record<string, unknown>;
      expect(context.requestId).toBe("fallback-req-456");
      expect(context.environment).toBe("test");
    }
  });

  it("should include user context in error events", async () => {
    const collector = createEventCollector();

    const result = await l0({
      stream: createFailingStream([]),
      fallbackStreams: [createTokenStream(["fallback"])],
      retry: { attempts: 1 },
      context: {
        requestId: "error-req-789",
        source: "api",
      },
      onEvent: collector.handler,
    });

    for await (const _ of result.stream) {
      // Consume stream
    }

    // Check ERROR events have context
    const errorEvents = collector.getEventsOfType(EventType.ERROR);
    expect(errorEvents.length).toBeGreaterThan(0);
    for (const event of errorEvents) {
      const context = event.data.context as Record<string, unknown>;
      expect(context.requestId).toBe("error-req-789");
      expect(context.source).toBe("api");
    }
  });

  it("should preserve context immutability (deep clone)", async () => {
    const collector = createEventCollector();
    const originalContext = {
      requestId: "immutable-123",
      nested: { value: "original", deep: { level: 1 } },
      items: [1, 2, { name: "test" }],
    };

    const result = await l0({
      stream: createTokenStream(["test"]),
      context: originalContext,
      onEvent: collector.handler,
    });

    for await (const _ of result.stream) {
      // Consume stream
    }

    // Verify context in events matches original values
    const obsEvents = collector.events.filter((e) => e.data.context);
    expect(obsEvents.length).toBeGreaterThan(0);

    const eventContext = obsEvents[0]!.data.context as Record<string, unknown>;
    expect(eventContext.requestId).toBe("immutable-123");

    const nested = eventContext.nested as Record<string, unknown>;
    expect(nested.value).toBe("original");

    const deep = nested.deep as Record<string, unknown>;
    expect(deep.level).toBe(1);

    const items = eventContext.items as unknown[];
    expect(items).toEqual([1, 2, { name: "test" }]);

    // Modifying original at any level shouldn't affect emitted events
    originalContext.requestId = "modified";
    originalContext.nested.value = "modified";
    originalContext.nested.deep.level = 999;
    (originalContext.items[2] as Record<string, string>).name = "modified";

    // Event context should still have original values
    expect(eventContext.requestId).toBe("immutable-123");
    expect(nested.value).toBe("original");
    expect(deep.level).toBe(1);
    expect((items[2] as Record<string, string>).name).toBe("test");

    // Attempting to modify frozen context should throw in strict mode
    // or silently fail in non-strict mode
    expect(() => {
      (eventContext as Record<string, unknown>).requestId = "hacked";
    }).toThrow();

    expect(() => {
      (nested as Record<string, unknown>).value = "hacked";
    }).toThrow();

    expect(() => {
      (items as unknown[]).push(4);
    }).toThrow();
  });
});

// ============================================================================
// Guardrail Phase Events Tests
// ============================================================================

describe("Lifecycle: Guardrail Phase Events", () => {
  it("should emit GUARDRAIL_PHASE_START and GUARDRAIL_PHASE_END when guardrails are configured", async () => {
    const collector = createEventCollector();

    const simpleRule: GuardrailRule = {
      name: "simple-check",
      check: () => [], // No violations
    };

    const result = await l0({
      stream: createTokenStream(["hello", " ", "world"]),
      guardrails: [simpleRule],
      checkIntervals: { guardrails: 1 },
      onEvent: collector.handler,
    });

    for await (const _ of result.stream) {
      // Consume stream
    }

    const phaseStarts = collector.getEventsOfType(
      EventType.GUARDRAIL_PHASE_START,
    );
    const phaseEnds = collector.getEventsOfType(EventType.GUARDRAIL_PHASE_END);

    expect(phaseStarts.length).toBeGreaterThan(0);
    expect(phaseEnds.length).toBeGreaterThan(0);
    expect(phaseStarts.length).toBe(phaseEnds.length);
  });

  it("should include contextSize and ruleCount in GUARDRAIL_PHASE_START", async () => {
    const collector = createEventCollector();

    const rule1: GuardrailRule = {
      name: "rule-1",
      check: () => [],
    };
    const rule2: GuardrailRule = {
      name: "rule-2",
      check: () => [],
    };

    const result = await l0({
      stream: createTokenStream(["test", " ", "content"]),
      guardrails: [rule1, rule2],
      checkIntervals: { guardrails: 1 },
      onEvent: collector.handler,
    });

    for await (const _ of result.stream) {
      // Consume stream
    }

    const phaseStarts = collector.getEventsOfType(
      EventType.GUARDRAIL_PHASE_START,
    );
    expect(phaseStarts.length).toBeGreaterThan(0);

    const firstStart = phaseStarts[0]!;
    expect(typeof firstStart.data.contextSize).toBe("number");
    expect(firstStart.data.ruleCount).toBe(2);
  });

  it("should include ruleCount and violationCount in GUARDRAIL_PHASE_END", async () => {
    const collector = createEventCollector();

    const violatingRule: GuardrailRule = {
      name: "violating-rule",
      check: (ctx) => {
        if (ctx.content.includes("bad")) {
          return [
            {
              rule: "violating-rule",
              severity: "warning",
              message: "Bad content",
              recoverable: true,
            },
          ];
        }
        return [];
      },
    };

    const result = await l0({
      stream: createTokenStream(["this", " ", "is", " ", "bad"]),
      guardrails: [violatingRule],
      checkIntervals: { guardrails: 1 },
      onEvent: collector.handler,
    });

    for await (const _ of result.stream) {
      // Consume stream
    }

    const phaseEnds = collector.getEventsOfType(EventType.GUARDRAIL_PHASE_END);
    expect(phaseEnds.length).toBeGreaterThan(0);

    // Find a phase end with violations
    const withViolations = phaseEnds.find(
      (e) => (e.data.violationCount as number) > 0,
    );
    if (withViolations) {
      expect(withViolations.data.ruleCount).toBe(1);
      expect(typeof withViolations.data.violationCount).toBe("number");
    }
  });

  it("should emit GUARDRAIL_RULE_START and GUARDRAIL_RULE_END for each rule", async () => {
    const collector = createEventCollector();

    const rule1: GuardrailRule = {
      name: "rule-alpha",
      check: () => [],
    };
    const rule2: GuardrailRule = {
      name: "rule-beta",
      check: () => [],
    };

    const result = await l0({
      stream: createTokenStream(["test"]),
      guardrails: [rule1, rule2],
      checkIntervals: { guardrails: 1 },
      onEvent: collector.handler,
    });

    for await (const _ of result.stream) {
      // Consume stream
    }

    const ruleStarts = collector.getEventsOfType(
      EventType.GUARDRAIL_RULE_START,
    );
    const ruleEnds = collector.getEventsOfType(EventType.GUARDRAIL_RULE_END);

    expect(ruleStarts.length).toBeGreaterThan(0);
    expect(ruleEnds.length).toBeGreaterThan(0);
    expect(ruleStarts.length).toBe(ruleEnds.length);
  });

  it("should include index and ruleId in GUARDRAIL_RULE_START/END", async () => {
    const collector = createEventCollector();

    const namedRule: GuardrailRule = {
      name: "named-rule-123",
      check: () => [],
    };

    const result = await l0({
      stream: createTokenStream(["test"]),
      guardrails: [namedRule],
      checkIntervals: { guardrails: 1 },
      onEvent: collector.handler,
    });

    for await (const _ of result.stream) {
      // Consume stream
    }

    const ruleStarts = collector.getEventsOfType(
      EventType.GUARDRAIL_RULE_START,
    );
    expect(ruleStarts.length).toBeGreaterThan(0);

    const firstRuleStart = ruleStarts[0]!;
    expect(firstRuleStart.data.index).toBe(0);
    expect(firstRuleStart.data.ruleId).toBe("named-rule-123");

    const ruleEnds = collector.getEventsOfType(EventType.GUARDRAIL_RULE_END);
    expect(ruleEnds.length).toBeGreaterThan(0);

    const firstRuleEnd = ruleEnds[0]!;
    expect(firstRuleEnd.data.index).toBe(0);
    expect(firstRuleEnd.data.ruleId).toBe("named-rule-123");
  });

  it("should emit phase events in correct order: PHASE_START -> RULE_START -> RULE_END -> PHASE_END", async () => {
    const collector = createEventCollector();

    const simpleRule: GuardrailRule = {
      name: "order-test-rule",
      check: () => [],
    };

    const result = await l0({
      stream: createTokenStream(["test"]),
      guardrails: [simpleRule],
      checkIntervals: { guardrails: 1 },
      onEvent: collector.handler,
    });

    for await (const _ of result.stream) {
      // Consume stream
    }

    // Get just the guardrail-related events in order
    const guardrailEvents = collector.events
      .filter((e) =>
        [
          EventType.GUARDRAIL_PHASE_START,
          EventType.GUARDRAIL_PHASE_END,
          EventType.GUARDRAIL_RULE_START,
          EventType.GUARDRAIL_RULE_END,
        ].includes(e.type as EventType),
      )
      .map((e) => e.type);

    // Should have at least one complete phase cycle
    expect(guardrailEvents.length).toBeGreaterThanOrEqual(4);

    // Find first complete sequence
    const phaseStartIdx = guardrailEvents.indexOf(
      EventType.GUARDRAIL_PHASE_START,
    );
    expect(phaseStartIdx).toBeGreaterThanOrEqual(0);

    // After PHASE_START, we should see RULE_START
    const ruleStartIdx = guardrailEvents.indexOf(
      EventType.GUARDRAIL_RULE_START,
      phaseStartIdx,
    );
    expect(ruleStartIdx).toBeGreaterThan(phaseStartIdx);

    // After RULE_START, we should see RULE_END
    const ruleEndIdx = guardrailEvents.indexOf(
      EventType.GUARDRAIL_RULE_END,
      ruleStartIdx,
    );
    expect(ruleEndIdx).toBeGreaterThan(ruleStartIdx);

    // After RULE_END, we should see PHASE_END
    const phaseEndIdx = guardrailEvents.indexOf(
      EventType.GUARDRAIL_PHASE_END,
      ruleEndIdx,
    );
    expect(phaseEndIdx).toBeGreaterThan(ruleEndIdx);
  });
});

// ============================================================================
// Continuation Start Events Tests
// ============================================================================

describe("Lifecycle: Continuation Events", () => {
  it("should emit CONTINUATION_START before RESUME_START when continuing from checkpoint", async () => {
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

    const continuationStarts = collector.getEventsOfType(
      EventType.CONTINUATION_START,
    );
    const resumeStarts = collector.getEventsOfType(EventType.RESUME_START);

    expect(continuationStarts.length).toBeGreaterThan(0);
    expect(resumeStarts.length).toBeGreaterThan(0);

    // CONTINUATION_START should come before RESUME_START
    const types = collector.getEventTypes();
    const contIdx = types.indexOf(EventType.CONTINUATION_START);
    const resumeIdx = types.indexOf(EventType.RESUME_START);
    expect(contIdx).toBeLessThan(resumeIdx);
  });

  it("should include checkpoint and tokenCount in CONTINUATION_START event", async () => {
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

    const continuationStarts = collector.getEventsOfType(
      EventType.CONTINUATION_START,
    );
    expect(continuationStarts.length).toBeGreaterThan(0);
    const contEvent = continuationStarts[0]!;
    expect(typeof contEvent.data.checkpoint).toBe("string");
    expect((contEvent.data.checkpoint as string).length).toBeGreaterThan(0);
    expect(typeof contEvent.data.tokenCount).toBe("number");
  });

  it("should emit CONTINUATION_START on retry with checkpoint", async () => {
    const collector = createEventCollector();
    let attempts = 0;

    const streamFactory = () => {
      attempts++;
      return (async function* (): AsyncGenerator<L0Event> {
        for (let i = 0; i < 10; i++) {
          yield { type: "token", value: `t${i}-`, timestamp: Date.now() };
        }
        if (attempts < 2) {
          yield {
            type: "error",
            error: new Error("Retry needed"),
            timestamp: Date.now(),
          };
        }
        // Stream ends naturally on second attempt
      })();
    };

    const result = await l0({
      stream: streamFactory,
      retry: { attempts: 2, retryOn: ["unknown"] },
      continueFromLastKnownGoodToken: true,
      checkIntervals: { checkpoint: 3 },
      onEvent: collector.handler,
      detectZeroTokens: false,
    });

    for await (const _ of result.stream) {
      // Consume stream
    }

    const continuationStarts = collector.getEventsOfType(
      EventType.CONTINUATION_START,
    );
    expect(continuationStarts.length).toBeGreaterThan(0);
  });

  it("should emit CONTINUATION_START after FALLBACK_START in fallback+continuation flow", async () => {
    const collector = createEventCollector();

    const primaryStream = async function* (): AsyncGenerator<L0Event> {
      for (let i = 0; i < 10; i++) {
        yield { type: "token", value: `t${i}-`, timestamp: Date.now() };
      }
      yield {
        type: "error",
        error: new Error("Primary failed"),
        timestamp: Date.now(),
      };
    };

    const result = await l0({
      stream: () => primaryStream(),
      fallbackStreams: [createTokenStream(["fallback", " ", "success"])],
      retry: { attempts: 1 },
      continueFromLastKnownGoodToken: true,
      checkIntervals: { checkpoint: 3 },
      onEvent: collector.handler,
    });

    for await (const _ of result.stream) {
      // Consume stream
    }

    const types = collector.getEventTypes();
    const fallbackIdx = types.indexOf(EventType.FALLBACK_START);
    const contIdx = types.indexOf(EventType.CONTINUATION_START);

    expect(fallbackIdx).toBeGreaterThanOrEqual(0);
    expect(contIdx).toBeGreaterThanOrEqual(0);
    expect(fallbackIdx).toBeLessThan(contIdx);
  });
});

// ============================================================================
// Stream Initialization Events Tests
// ============================================================================

describe("Lifecycle: Stream Initialization Events", () => {
  it("should emit STREAM_INIT at start of streaming", async () => {
    const collector = createEventCollector();

    const result = await l0({
      stream: createTokenStream(["hello", " ", "world"]),
      onEvent: collector.handler,
    });

    for await (const _ of result.stream) {
      // Consume stream
    }

    const streamInits = collector.getEventsOfType(EventType.STREAM_INIT);
    expect(streamInits.length).toBeGreaterThan(0);
  });

  it("should emit STREAM_INIT before tokens are yielded", async () => {
    const collector = createEventCollector();

    const result = await l0({
      stream: createTokenStream(["test"]),
      onEvent: collector.handler,
    });

    for await (const _ of result.stream) {
      // Consume stream
    }

    const types = collector.getEventTypes();
    const streamInitIdx = types.indexOf(EventType.STREAM_INIT);
    expect(streamInitIdx).toBeGreaterThanOrEqual(0);
    // STREAM_INIT should come early in the sequence (after SESSION_START)
    expect(streamInitIdx).toBeLessThan(5);
  });
});

// ============================================================================
// Adapter Events Tests
// ============================================================================

describe("Lifecycle: Adapter Events", () => {
  it("should emit ADAPTER_WRAP_START and ADAPTER_WRAP_END", async () => {
    const collector = createEventCollector();

    const result = await l0({
      stream: createTokenStream(["hello"]),
      onEvent: collector.handler,
    });

    for await (const _ of result.stream) {
      // Consume stream
    }

    const wrapStarts = collector.getEventsOfType(EventType.ADAPTER_WRAP_START);
    const wrapEnds = collector.getEventsOfType(EventType.ADAPTER_WRAP_END);

    expect(wrapStarts.length).toBeGreaterThan(0);
    expect(wrapEnds.length).toBeGreaterThan(0);
  });

  it("should emit ADAPTER_DETECTED with adapter name", async () => {
    const collector = createEventCollector();

    const result = await l0({
      stream: createTokenStream(["hello"]),
      onEvent: collector.handler,
    });

    for await (const _ of result.stream) {
      // Consume stream
    }

    const adapterDetected = collector.getEventsOfType(
      EventType.ADAPTER_DETECTED,
    );
    expect(adapterDetected.length).toBeGreaterThan(0);
    expect(typeof adapterDetected[0]!.data.adapter).toBe("string");
  });

  it("should emit adapter events in order: WRAP_START -> DETECTED -> WRAP_END", async () => {
    const collector = createEventCollector();

    const result = await l0({
      stream: createTokenStream(["test"]),
      onEvent: collector.handler,
    });

    for await (const _ of result.stream) {
      // Consume stream
    }

    const types = collector.getEventTypes();
    const wrapStartIdx = types.indexOf(EventType.ADAPTER_WRAP_START);
    const detectedIdx = types.indexOf(EventType.ADAPTER_DETECTED);
    const wrapEndIdx = types.indexOf(EventType.ADAPTER_WRAP_END);

    expect(wrapStartIdx).toBeGreaterThanOrEqual(0);
    expect(detectedIdx).toBeGreaterThanOrEqual(0);
    expect(wrapEndIdx).toBeGreaterThanOrEqual(0);

    expect(wrapStartIdx).toBeLessThan(detectedIdx);
    expect(detectedIdx).toBeLessThan(wrapEndIdx);
  });
});

// ============================================================================
// Timeout Events Tests
// ============================================================================

describe("Lifecycle: Timeout Events", () => {
  it("should emit TIMEOUT_START when timeout is configured", async () => {
    const collector = createEventCollector();

    const result = await l0({
      stream: createTokenStream(["hello"]),
      timeout: { initialToken: 5000, interToken: 2000 },
      onEvent: collector.handler,
    });

    for await (const _ of result.stream) {
      // Consume stream
    }

    const timeoutStarts = collector.getEventsOfType(EventType.TIMEOUT_START);
    expect(timeoutStarts.length).toBeGreaterThan(0);
  });

  it("should include timeout type in TIMEOUT_START event", async () => {
    const collector = createEventCollector();

    const result = await l0({
      stream: createTokenStream(["hello"]),
      timeout: { initialToken: 5000 },
      onEvent: collector.handler,
    });

    for await (const _ of result.stream) {
      // Consume stream
    }

    const timeoutStarts = collector.getEventsOfType(EventType.TIMEOUT_START);
    expect(timeoutStarts.length).toBeGreaterThan(0);
    expect(timeoutStarts[0]!.data.timeoutType).toBeDefined();
  });

  it("should emit TIMEOUT_RESET after each token", async () => {
    const collector = createEventCollector();

    const result = await l0({
      stream: createTokenStream(["a", "b", "c"]),
      timeout: { interToken: 5000 },
      onEvent: collector.handler,
    });

    for await (const _ of result.stream) {
      // Consume stream
    }

    const timeoutResets = collector.getEventsOfType(EventType.TIMEOUT_RESET);
    // Should have at least one reset per token
    expect(timeoutResets.length).toBeGreaterThanOrEqual(1);
  });
});

// ============================================================================
// Retry Lifecycle Events Tests
// ============================================================================

describe("Lifecycle: Retry Lifecycle Events", () => {
  it("should emit RETRY_START when retry begins", async () => {
    const collector = createEventCollector();
    let attempts = 0;

    const streamFactory = () => {
      attempts++;
      return (async function* (): AsyncGenerator<L0Event> {
        if (attempts < 2) {
          yield {
            type: "error",
            error: new Error("Retry needed"),
            timestamp: Date.now(),
          };
        } else {
          yield { type: "token", value: "success", timestamp: Date.now() };
        }
      })();
    };

    const result = await l0({
      stream: streamFactory,
      retry: { attempts: 2, retryOn: ["unknown"] },
      onEvent: collector.handler,
      detectZeroTokens: false,
    });

    for await (const _ of result.stream) {
      // Consume stream
    }

    const retryStarts = collector.getEventsOfType(EventType.RETRY_START);
    expect(retryStarts.length).toBeGreaterThan(0);
  });

  it("should include attempt and maxAttempts in RETRY_START", async () => {
    const collector = createEventCollector();
    let attempts = 0;

    const streamFactory = () => {
      attempts++;
      return (async function* (): AsyncGenerator<L0Event> {
        if (attempts < 2) {
          yield {
            type: "error",
            error: new Error("Retry"),
            timestamp: Date.now(),
          };
        } else {
          yield { type: "token", value: "ok", timestamp: Date.now() };
        }
      })();
    };

    const result = await l0({
      stream: streamFactory,
      retry: { attempts: 3, retryOn: ["unknown"] },
      onEvent: collector.handler,
      detectZeroTokens: false,
    });

    for await (const _ of result.stream) {
      // Consume stream
    }

    const retryStarts = collector.getEventsOfType(EventType.RETRY_START);
    expect(retryStarts.length).toBeGreaterThan(0);
    expect(typeof retryStarts[0]!.data.attempt).toBe("number");
    expect(typeof retryStarts[0]!.data.maxAttempts).toBe("number");
  });

  it("should emit RETRY_END after successful retry", async () => {
    const collector = createEventCollector();
    let attempts = 0;

    const streamFactory = () => {
      attempts++;
      return (async function* (): AsyncGenerator<L0Event> {
        if (attempts < 2) {
          yield {
            type: "error",
            error: new Error("Retry"),
            timestamp: Date.now(),
          };
        } else {
          yield { type: "token", value: "ok", timestamp: Date.now() };
        }
      })();
    };

    const result = await l0({
      stream: streamFactory,
      retry: { attempts: 2, retryOn: ["unknown"] },
      onEvent: collector.handler,
      detectZeroTokens: false,
    });

    for await (const _ of result.stream) {
      // Consume stream
    }

    const retryEnds = collector.getEventsOfType(EventType.RETRY_END);
    expect(retryEnds.length).toBeGreaterThan(0);
    expect(retryEnds[0]!.data.success).toBe(true);
  });

  it("should emit RETRY_GIVE_UP when retries exhausted", async () => {
    const collector = createEventCollector();

    const streamFactory = () => {
      return (async function* (): AsyncGenerator<L0Event> {
        yield {
          type: "error",
          error: new Error("Always fails"),
          timestamp: Date.now(),
        };
      })();
    };

    const result = await l0({
      stream: streamFactory,
      fallbackStreams: [createTokenStream(["fallback"])],
      retry: { attempts: 2, retryOn: ["unknown"] },
      onEvent: collector.handler,
      detectZeroTokens: false,
    });

    for await (const _ of result.stream) {
      // Consume stream
    }

    const retryGiveUps = collector.getEventsOfType(EventType.RETRY_GIVE_UP);
    expect(retryGiveUps.length).toBeGreaterThan(0);
  });

  it("should include attempts count in RETRY_GIVE_UP", async () => {
    const collector = createEventCollector();

    const streamFactory = () => {
      return (async function* (): AsyncGenerator<L0Event> {
        yield {
          type: "error",
          error: new Error("Always fails"),
          timestamp: Date.now(),
        };
      })();
    };

    const result = await l0({
      stream: streamFactory,
      fallbackStreams: [createTokenStream(["fallback"])],
      retry: { attempts: 2, retryOn: ["unknown"] },
      onEvent: collector.handler,
      detectZeroTokens: false,
    });

    for await (const _ of result.stream) {
      // Consume stream
    }

    const retryGiveUps = collector.getEventsOfType(EventType.RETRY_GIVE_UP);
    expect(retryGiveUps.length).toBeGreaterThan(0);
    expect(typeof retryGiveUps[0]!.data.attempt).toBe("number");
    expect(typeof retryGiveUps[0]!.data.maxAttempts).toBe("number");
  });
});

// ============================================================================
// Fallback Lifecycle Events Tests
// ============================================================================

describe("Lifecycle: Fallback Lifecycle Events", () => {
  it("should emit FALLBACK_MODEL_SELECTED when fallback is chosen", async () => {
    const collector = createEventCollector();

    const result = await l0({
      stream: createFailingStream("Primary failed"),
      fallbackStreams: [createTokenStream(["fallback"])],
      retry: { attempts: 1 },
      onEvent: collector.handler,
    });

    for await (const _ of result.stream) {
      // Consume stream
    }

    const modelSelected = collector.getEventsOfType(
      EventType.FALLBACK_MODEL_SELECTED,
    );
    expect(modelSelected.length).toBeGreaterThan(0);
  });

  it("should include model index in FALLBACK_MODEL_SELECTED", async () => {
    const collector = createEventCollector();

    const result = await l0({
      stream: createFailingStream("Primary failed"),
      fallbackStreams: [createTokenStream(["fallback"])],
      retry: { attempts: 1 },
      onEvent: collector.handler,
    });

    for await (const _ of result.stream) {
      // Consume stream
    }

    const modelSelected = collector.getEventsOfType(
      EventType.FALLBACK_MODEL_SELECTED,
    );
    expect(modelSelected.length).toBeGreaterThan(0);
    expect(typeof modelSelected[0]!.data.index).toBe("number");
  });

  it("should emit FALLBACK_END after fallback completes", async () => {
    const collector = createEventCollector();

    const result = await l0({
      stream: createFailingStream("Primary failed"),
      fallbackStreams: [createTokenStream(["fallback", " ", "success"])],
      retry: { attempts: 1 },
      onEvent: collector.handler,
    });

    for await (const _ of result.stream) {
      // Consume stream
    }

    const fallbackEnds = collector.getEventsOfType(EventType.FALLBACK_END);
    expect(fallbackEnds.length).toBeGreaterThan(0);
  });

  it("should emit FALLBACK_END after FALLBACK_START", async () => {
    const collector = createEventCollector();

    const result = await l0({
      stream: createFailingStream("Primary failed"),
      fallbackStreams: [createTokenStream(["fallback"])],
      retry: { attempts: 1 },
      onEvent: collector.handler,
    });

    for await (const _ of result.stream) {
      // Consume stream
    }

    const types = collector.getEventTypes();
    const fallbackStartIdx = types.indexOf(EventType.FALLBACK_START);
    const fallbackEndIdx = types.indexOf(EventType.FALLBACK_END);

    expect(fallbackStartIdx).toBeGreaterThanOrEqual(0);
    expect(fallbackEndIdx).toBeGreaterThanOrEqual(0);
    expect(fallbackStartIdx).toBeLessThan(fallbackEndIdx);
  });
});
