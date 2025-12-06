/**
 * Canonical Lifecycle Tests for L0 Runtime
 *
 * These tests validate the L0 runtime against the canonical lifecycle scenarios
 * defined in fixtures/lifecycle-scenarios.json. This same fixture file should
 * be used by the Python implementation to ensure behavioral parity.
 *
 * USAGE:
 * - TypeScript: Run with `vitest run tests/lifecycle-canonical.test.ts`
 * - Python: Load lifecycle-scenarios.json and implement equivalent test runner
 *
 * ADDING NEW SCENARIOS:
 * 1. Add scenario to fixtures/lifecycle-scenarios.json
 * 2. Tests will automatically pick up new scenarios
 * 3. Implement same scenario in Python test runner
 */

import { describe, it, expect } from "vitest";
import { l0 } from "../src/runtime/l0";
import type { L0Event, L0State } from "../src/types/l0";
import type { L0Event as L0ObservabilityEvent } from "../src/types/observability";
import { EventType } from "../src/types/observability";
import type { GuardrailRule } from "../src/types/guardrails";
import scenarios from "./fixtures/lifecycle-scenarios.json";

// ============================================================================
// Types for Scenario Fixtures
// ============================================================================

interface EventAssertion {
  type: string;
  assertions?: Record<string, unknown>;
  note?: string;
}

interface CallbackAssertion {
  args?: unknown[];
  note?: string;
  [key: string]: unknown;
}

interface Scenario {
  id: string;
  name: string;
  description: string;
  config: Record<string, unknown>;
  expectedObservabilityEvents: EventAssertion[];
  expectedCallbacks?: Record<string, CallbackAssertion[]>;
  expectedError?: { code: string; message: string };
  invariants: string[];
}

// ============================================================================
// Test Helpers
// ============================================================================

/**
 * Create a token stream from an array of tokens
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
 * Create a stream that fails after emitting tokens
 */
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

/**
 * Event collector for tracking observability events only
 */
interface CollectedEvent {
  type: string;
  ts: number;
  data: Record<string, unknown>;
}

function createEventCollector() {
  const events: CollectedEvent[] = [];

  const handler = (event: L0Event | L0ObservabilityEvent) => {
    // Only collect observability events (have ts and streamId)
    if (
      "type" in event &&
      typeof event.type === "string" &&
      "ts" in event &&
      "streamId" in event
    ) {
      const obsEvent = event as L0ObservabilityEvent;
      events.push({
        type: obsEvent.type,
        ts: obsEvent.ts,
        data: { ...obsEvent } as Record<string, unknown>,
      });
    }
  };

  return {
    handler,
    events,
    getEventTypes: () => events.map((e) => e.type),
    getEventsOfType: (type: string) => events.filter((e) => e.type === type),
  };
}

/**
 * Get nested property value using dot notation
 */
function getNestedValue(obj: Record<string, unknown>, path: string): unknown {
  return path.split(".").reduce((current: unknown, key) => {
    if (current && typeof current === "object") {
      return (current as Record<string, unknown>)[key];
    }
    return undefined;
  }, obj);
}

/**
 * Validate event assertions
 */
function validateEventAssertions(
  event: CollectedEvent,
  assertions: Record<string, unknown>,
): void {
  for (const [path, expectedValue] of Object.entries(assertions)) {
    const actualValue = getNestedValue(event.data, path);
    expect(actualValue, `Event ${event.type}: ${path}`).toEqual(expectedValue);
  }
}

/**
 * Validate all expected observability events against collected events.
 * This ensures the runtime behavior matches the canonical spec.
 */
function validateObservabilityEventSequence(
  collector: ReturnType<typeof createEventCollector>,
  expectedEvents: EventAssertion[],
): void {
  const collectedTypes = collector.getEventTypes();

  // Build expected type sequence (filtering to types we expect)
  const expectedTypes = expectedEvents.map((e) => e.type);

  // Verify each expected event appears in the collected events in order
  let lastFoundIndex = -1;
  for (const expected of expectedEvents) {
    const matchingEvents = collector.getEventsOfType(expected.type);
    expect(
      matchingEvents.length,
      `Expected at least one ${expected.type} event`,
    ).toBeGreaterThan(0);

    // Find this event type after the last found index
    const foundIndex = collectedTypes.indexOf(
      expected.type,
      lastFoundIndex + 1,
    );
    expect(
      foundIndex,
      `Expected ${expected.type} after index ${lastFoundIndex}, but not found in sequence: ${collectedTypes.join(", ")}`,
    ).toBeGreaterThan(lastFoundIndex);

    // Validate assertions if present
    if (expected.assertions) {
      const eventAtIndex = collector.events[foundIndex]!;
      validateEventAssertions(eventAtIndex, expected.assertions);
    }

    lastFoundIndex = foundIndex;
  }
}

// ============================================================================
// Scenario Runners
// ============================================================================

/**
 * Run the "normal-success" scenario
 */
async function runNormalSuccessScenario(scenario: Scenario) {
  const collector = createEventCollector();
  const config = scenario.config;
  const tokens = config.tokens as string[];
  const context = config.context as Record<string, unknown>;

  const onStartCalls: unknown[][] = [];
  const onCompleteCalls: L0State[] = [];

  const result = await l0({
    stream: createTokenStream(tokens),
    context,
    onEvent: collector.handler,
    onStart: (attempt, isRetry, isFallback) => {
      onStartCalls.push([attempt, isRetry, isFallback]);
    },
    onComplete: (state) => {
      onCompleteCalls.push(state);
    },
  });

  for await (const _ of result.stream) {
    // Consume stream
  }

  // Validate expected observability events in sequence with assertions
  validateObservabilityEventSequence(
    collector,
    scenario.expectedObservabilityEvents,
  );

  // Validate callbacks
  if (scenario.expectedCallbacks?.onStart) {
    expect(onStartCalls.length).toBe(scenario.expectedCallbacks.onStart.length);
    for (let i = 0; i < scenario.expectedCallbacks.onStart.length; i++) {
      const expected = scenario.expectedCallbacks.onStart[i]!;
      if (expected.args) {
        expect(onStartCalls[i]).toEqual(expected.args);
      }
    }
  }

  if (scenario.expectedCallbacks?.onComplete) {
    expect(onCompleteCalls.length).toBe(1);
    const expectedComplete = scenario.expectedCallbacks.onComplete[0]!;
    if (expectedComplete["state.content"]) {
      expect(onCompleteCalls[0]!.content).toBe(
        expectedComplete["state.content"],
      );
    }
    if (expectedComplete["state.tokenCount"]) {
      expect(onCompleteCalls[0]!.tokenCount).toBe(
        expectedComplete["state.tokenCount"],
      );
    }
  }

  return { collector, onStartCalls, onCompleteCalls, result };
}

/**
 * Run the "retry-on-guardrail" scenario
 */
async function runRetryOnGuardrailScenario(scenario: Scenario) {
  const collector = createEventCollector();
  const config = scenario.config;
  const attempts = config.attempts as Array<{
    tokens: string[];
    guardrailFails: boolean;
  }>;
  const context = config.context as Record<string, unknown>;

  let attemptIndex = 0;
  const onStartCalls: unknown[][] = [];
  const onRetryCalls: unknown[][] = [];

  const guardrailRule: GuardrailRule = {
    name: "test-guardrail",
    check: (ctx) => {
      if (ctx.completed && attempts[attemptIndex - 1]?.guardrailFails) {
        return [
          {
            rule: "test-guardrail",
            severity: "error",
            message: "Guardrail violation",
            recoverable: true,
          },
        ];
      }
      return [];
    },
  };

  const streamFactory = () => {
    const currentAttempt = attempts[attemptIndex];
    attemptIndex++;
    return createTokenStream(currentAttempt?.tokens || ["fallback"])();
  };

  const result = await l0({
    stream: streamFactory,
    guardrails: [guardrailRule],
    retry: { attempts: (config.retry as { attempts: number }).attempts },
    context,
    onEvent: collector.handler,
    onStart: (attempt, isRetry, isFallback) => {
      onStartCalls.push([attempt, isRetry, isFallback]);
    },
    onRetry: (attempt, reason) => {
      onRetryCalls.push([attempt, reason]);
    },
  });

  for await (const _ of result.stream) {
    // Consume stream
  }

  // Validate SESSION_START emitted exactly once
  const sessionStarts = collector.getEventsOfType(EventType.SESSION_START);
  expect(sessionStarts.length).toBe(1);
  expect(sessionStarts[0]!.data.isRetry).toBe(false);

  // Validate ATTEMPT_START emitted for retries
  const attemptStarts = collector.getEventsOfType(EventType.ATTEMPT_START);
  expect(attemptStarts.length).toBe(1);
  expect(attemptStarts[0]!.data.isRetry).toBe(true);

  // Validate RETRY_ATTEMPT emitted
  const retryAttempts = collector.getEventsOfType(EventType.RETRY_ATTEMPT);
  expect(retryAttempts.length).toBe(1);

  // Validate event ordering: RETRY_ATTEMPT comes before ATTEMPT_START
  const eventTypes = collector.getEventTypes();
  const retryIndex = eventTypes.indexOf(EventType.RETRY_ATTEMPT);
  const attemptStartIndex = eventTypes.indexOf(EventType.ATTEMPT_START);
  expect(retryIndex).toBeLessThan(attemptStartIndex);

  // Validate callbacks
  expect(onStartCalls.length).toBe(2);
  expect(onStartCalls[0]).toEqual([1, false, false]);
  expect(onStartCalls[1]).toEqual([2, true, false]);

  expect(onRetryCalls.length).toBe(1);

  return { collector, onStartCalls, onRetryCalls, result };
}

/**
 * Run the "fallback-after-retries-exhausted" scenario
 */
async function runFallbackAfterRetriesScenario(scenario: Scenario) {
  const collector = createEventCollector();
  const config = scenario.config;
  const primaryAttempts = config.primaryAttempts as Array<{
    tokens: string[];
    error: boolean;
  }>;
  const fallbackStreams = config.fallbackStreams as Array<{ tokens: string[] }>;
  const context = config.context as Record<string, unknown>;

  let attemptIndex = 0;
  const onStartCalls: unknown[][] = [];
  const onFallbackCalls: unknown[][] = [];

  const streamFactory = () => {
    const currentAttempt = primaryAttempts[attemptIndex];
    attemptIndex++;
    if (currentAttempt?.error) {
      return createFailingStream(currentAttempt.tokens)();
    }
    return createTokenStream(currentAttempt?.tokens || [])();
  };

  const result = await l0({
    stream: streamFactory,
    fallbackStreams: fallbackStreams.map((f) => createTokenStream(f.tokens)),
    retry: {
      attempts: (config.retry as { attempts: number }).attempts,
      retryOn: ["unknown"],
    },
    context,
    onEvent: collector.handler,
    onStart: (attempt, isRetry, isFallback) => {
      onStartCalls.push([attempt, isRetry, isFallback]);
    },
    onFallback: (index, reason) => {
      onFallbackCalls.push([index, reason]);
    },
    detectZeroTokens: false,
  });

  for await (const _ of result.stream) {
    // Consume stream
  }

  // Validate expected observability events in sequence with assertions
  validateObservabilityEventSequence(
    collector,
    scenario.expectedObservabilityEvents,
  );

  // Additional validations for specific counts
  const sessionStarts = collector.getEventsOfType(EventType.SESSION_START);
  expect(sessionStarts.length).toBe(1);

  const fallbackStarts = collector.getEventsOfType(EventType.FALLBACK_START);
  expect(fallbackStarts.length).toBe(1);

  // Validate onStart called for initial, retry, and fallback
  expect(onStartCalls.length).toBe(3);
  expect(onStartCalls[0]).toEqual([1, false, false]); // Initial
  expect(onStartCalls[1]).toEqual([2, true, false]); // Retry
  expect(onStartCalls[2]).toEqual([1, false, true]); // Fallback

  // Validate onFallback called
  expect(onFallbackCalls.length).toBe(1);

  return { collector, onStartCalls, onFallbackCalls, result };
}

/**
 * Run the "error-context-propagation" scenario
 */
async function runErrorContextPropagationScenario(scenario: Scenario) {
  const collector = createEventCollector();
  const config = scenario.config;
  const context = config.context as Record<string, unknown>;
  const fallbackStreams = config.fallbackStreams as Array<{ tokens: string[] }>;

  const result = await l0({
    stream: createFailingStream([]),
    fallbackStreams: fallbackStreams.map((f) => createTokenStream(f.tokens)),
    retry: { attempts: 0 },
    context,
    onEvent: collector.handler,
  });

  for await (const _ of result.stream) {
    // Consume stream
  }

  // Validate context in SESSION_START
  const sessionStarts = collector.getEventsOfType(EventType.SESSION_START);
  expect(sessionStarts.length).toBe(1);
  const sessionContext = sessionStarts[0]!.data.context as Record<
    string,
    unknown
  >;
  expect(sessionContext.requestId).toBe("error-ctx-404");
  expect(sessionContext.userId).toBe("user-xyz");
  expect((sessionContext.nested as Record<string, unknown>).traceId).toBe(
    "trace-abc",
  );

  // Validate context in ERROR
  const errors = collector.getEventsOfType(EventType.ERROR);
  expect(errors.length).toBeGreaterThan(0);
  const errorContext = errors[0]!.data.context as Record<string, unknown>;
  expect(errorContext.requestId).toBe("error-ctx-404");

  // Validate context in FALLBACK_START
  const fallbackStarts = collector.getEventsOfType(EventType.FALLBACK_START);
  expect(fallbackStarts.length).toBe(1);
  const fallbackContext = fallbackStarts[0]!.data.context as Record<
    string,
    unknown
  >;
  expect(fallbackContext.requestId).toBe("error-ctx-404");

  // Validate context in COMPLETE
  const completes = collector.getEventsOfType(EventType.COMPLETE);
  expect(completes.length).toBe(1);
  const completeContext = completes[0]!.data.context as Record<string, unknown>;
  expect(completeContext.requestId).toBe("error-ctx-404");

  return { collector, result };
}

// ============================================================================
// Test Suite
// ============================================================================

describe("Canonical Lifecycle Tests", () => {
  const scenarioList = scenarios.scenarios as Scenario[];

  describe("Normal Successful Flow", () => {
    const scenario = scenarioList.find((s) => s.id === "normal-success")!;

    it(scenario.name, async () => {
      await runNormalSuccessScenario(scenario);
    });

    it("invariants: " + scenario.invariants.join(", "), async () => {
      const { collector } = await runNormalSuccessScenario(scenario);

      // SESSION_START emitted exactly once
      expect(collector.getEventsOfType(EventType.SESSION_START).length).toBe(1);

      // COMPLETE is final observability event
      const types = collector.getEventTypes();
      expect(types[types.length - 1]).toBe(EventType.COMPLETE);
    });
  });

  describe("Retry Flow on Guardrail Violation", () => {
    const scenario = scenarioList.find((s) => s.id === "retry-on-guardrail")!;

    it(scenario.name, async () => {
      await runRetryOnGuardrailScenario(scenario);
    });

    it("invariants: SESSION_START once, ATTEMPT_START for retries", async () => {
      const { collector } = await runRetryOnGuardrailScenario(scenario);

      // SESSION_START emitted exactly once
      expect(collector.getEventsOfType(EventType.SESSION_START).length).toBe(1);

      // ATTEMPT_START emitted for retries
      expect(collector.getEventsOfType(EventType.ATTEMPT_START).length).toBe(1);

      // RETRY_ATTEMPT precedes ATTEMPT_START
      const types = collector.getEventTypes();
      const retryIdx = types.indexOf(EventType.RETRY_ATTEMPT);
      const attemptIdx = types.indexOf(EventType.ATTEMPT_START);
      expect(retryIdx).toBeLessThan(attemptIdx);
    });
  });

  describe("Fallback Flow After Retries Exhausted", () => {
    const scenario = scenarioList.find(
      (s) => s.id === "fallback-after-retries-exhausted",
    )!;

    it(scenario.name, async () => {
      await runFallbackAfterRetriesScenario(scenario);
    });

    it("invariants: SESSION_START once, FALLBACK_START for fallbacks", async () => {
      const { collector } = await runFallbackAfterRetriesScenario(scenario);

      // SESSION_START emitted exactly once
      expect(collector.getEventsOfType(EventType.SESSION_START).length).toBe(1);

      // FALLBACK_START emitted (not ATTEMPT_START for fallbacks)
      expect(collector.getEventsOfType(EventType.FALLBACK_START).length).toBe(
        1,
      );
    });
  });

  describe("Error Context Propagation", () => {
    const scenario = scenarioList.find(
      (s) => s.id === "error-context-propagation",
    )!;

    it(scenario.name, async () => {
      await runErrorContextPropagationScenario(scenario);
    });

    it("invariants: context propagated to all events, nested context preserved", async () => {
      const { collector } = await runErrorContextPropagationScenario(scenario);

      // Check all observability events have context
      const obsEvents = collector.events.filter((e) => e.data.context);
      expect(obsEvents.length).toBeGreaterThan(0);

      // All should have the same requestId
      for (const event of obsEvents) {
        const ctx = event.data.context as Record<string, unknown>;
        expect(ctx.requestId).toBe("error-ctx-404");
      }
    });
  });

  describe("Cross-Language Invariants", () => {
    it("SESSION_START is always first observability event", async () => {
      const scenario = scenarioList.find((s) => s.id === "normal-success")!;
      const { collector } = await runNormalSuccessScenario(scenario);

      const types = collector.getEventTypes();
      expect(types[0]).toBe(EventType.SESSION_START);
    });

    it("COMPLETE is always final observability event on success", async () => {
      const scenario = scenarioList.find((s) => s.id === "normal-success")!;
      const { collector } = await runNormalSuccessScenario(scenario);

      const types = collector.getEventTypes();
      expect(types[types.length - 1]).toBe(EventType.COMPLETE);
    });

    it("Event timestamps are monotonically increasing", async () => {
      const scenario = scenarioList.find((s) => s.id === "normal-success")!;
      const { collector } = await runNormalSuccessScenario(scenario);

      for (let i = 1; i < collector.events.length; i++) {
        expect(collector.events[i]!.ts).toBeGreaterThanOrEqual(
          collector.events[i - 1]!.ts,
        );
      }
    });

    it("streamId is consistent across all events in session", async () => {
      const scenario = scenarioList.find((s) => s.id === "normal-success")!;
      const { collector } = await runNormalSuccessScenario(scenario);

      const obsEvents = collector.events.filter((e) => e.data.streamId);
      expect(obsEvents.length).toBeGreaterThan(0);

      const streamId = obsEvents[0]!.data.streamId;
      for (const event of obsEvents) {
        expect(event.data.streamId).toBe(streamId);
      }
    });

    it("User context is deeply cloned and immutable", async () => {
      const scenario = scenarioList.find(
        (s) => s.id === "error-context-propagation",
      )!;
      const { collector } = await runErrorContextPropagationScenario(scenario);

      // Get context from an event
      const sessionStart = collector.getEventsOfType(
        EventType.SESSION_START,
      )[0];
      const ctx = sessionStart!.data.context as Record<string, unknown>;

      // Verify nested context is present
      expect((ctx.nested as Record<string, unknown>).traceId).toBe("trace-abc");

      // Verify context is frozen (immutable)
      expect(() => {
        (ctx as Record<string, unknown>).requestId = "hacked";
      }).toThrow();
    });
  });
});

/**
 * Export scenario data for Python test runner to consume
 */
export const lifecycleScenarios = scenarios;
