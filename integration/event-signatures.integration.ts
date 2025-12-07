/**
 * Integration test for event signature validation against canonical-spec.json
 *
 * This test makes live LLM calls and validates that ALL emitted observability
 * events have correct field signatures matching the canonical specification.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import OpenAI from "openai";

import { l0, recommendedGuardrails } from "../src";
import { EventType, type L0Event } from "../src/types/observability";
import {
  describeIf,
  hasOpenAI,
  LLM_TIMEOUT,
  expectValidResponse,
} from "./setup";

// Load canonical spec
const canonicalSpec = JSON.parse(
  readFileSync(
    join(__dirname, "../tests/fixtures/canonical-spec.json"),
    "utf8",
  ),
);

// Extract event specs from canonical spec
const eventSpecs = canonicalSpec.monitoring.observabilityEvents
  .events as Record<
  string,
  { fields: Array<{ name: string; type: string; required: boolean }> }
>;

// Base fields that ALL events must have (from observabilityEvents.baseShape)
const BASE_FIELDS = ["type", "ts", "streamId", "context"];

/**
 * Event collector that captures all emitted events
 */
function createEventCollector() {
  const events: L0Event[] = [];

  return {
    handler: (event: L0Event) => {
      events.push(event);
    },
    getEvents: () => events,
    getEventsOfType: <T extends L0Event>(type: EventType): T[] =>
      events.filter((e) => e.type === type) as T[],
    clear: () => {
      events.length = 0;
    },
  };
}

/**
 * Validates that an event has all required fields from the canonical spec
 */
function validateEventSignature(event: L0Event, errors: string[]): void {
  const eventType = event.type;
  const spec = eventSpecs[eventType];

  // Check base fields
  for (const field of BASE_FIELDS) {
    if (!(field in event)) {
      errors.push(`${eventType}: Missing base field '${field}'`);
    }
  }

  // Validate ts is a number
  if (typeof event.ts !== "number") {
    errors.push(`${eventType}: 'ts' should be number, got ${typeof event.ts}`);
  }

  // Validate streamId is a string
  if (typeof event.streamId !== "string") {
    errors.push(
      `${eventType}: 'streamId' should be string, got ${typeof event.streamId}`,
    );
  }

  // Validate context is an object
  if (typeof event.context !== "object" || event.context === null) {
    errors.push(
      `${eventType}: 'context' should be object, got ${typeof event.context}`,
    );
  }

  // If spec exists, validate required fields
  if (spec && spec.fields) {
    for (const fieldSpec of spec.fields) {
      if (fieldSpec.required) {
        const eventData = event as Record<string, unknown>;
        if (!(fieldSpec.name in eventData)) {
          errors.push(
            `${eventType}: Missing required field '${fieldSpec.name}'`,
          );
        }
      }
    }
  }
}

// Stream events are yielded to consumers but are NOT observability events
// They don't have the base shape (ts, streamId, context)
const STREAM_EVENTS = new Set(["token", "complete", "tool_call"]);

/**
 * Checks if an event is an observability event (has base fields)
 * vs a stream event (yielded to consumer)
 */
function isObservabilityEvent(event: L0Event): boolean {
  // Observability events are uppercase, stream events are lowercase
  return !STREAM_EVENTS.has(event.type);
}

/**
 * Validates all captured events against the canonical spec
 */
function validateAllEvents(events: L0Event[]): {
  valid: boolean;
  errors: string[];
  eventCounts: Record<string, number>;
} {
  const errors: string[] = [];
  const eventCounts: Record<string, number> = {};

  for (const event of events) {
    // Count events by type
    eventCounts[event.type] = (eventCounts[event.type] || 0) + 1;

    // Only validate observability events (not stream events like token/complete)
    if (isObservabilityEvent(event)) {
      validateEventSignature(event, errors);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    eventCounts,
  };
}

describeIf(hasOpenAI)("Event Signature Validation (Live LLM)", () => {
  const client = new OpenAI();

  it(
    "should emit events with correct signatures for basic streaming",
    async () => {
      const collector = createEventCollector();

      const result = await l0({
        stream: () =>
          client.chat.completions.create({
            model: "gpt-4o-mini",
            messages: [
              { role: "user", content: "Say 'hello' and nothing else." },
            ],
            stream: true,
            max_tokens: 10,
          }),
        onEvent: collector.handler,
      });

      // Consume the stream
      let content = "";
      for await (const chunk of result.stream) {
        content += chunk;
      }

      expectValidResponse(content);

      // Validate all event signatures
      const validation = validateAllEvents(collector.getEvents());

      if (!validation.valid) {
        console.error("Event signature errors:", validation.errors);
      }

      expect(validation.errors).toEqual([]);
      expect(validation.valid).toBe(true);

      // Verify key events were emitted
      expect(validation.eventCounts["SESSION_START"]).toBe(1);
      expect(validation.eventCounts["COMPLETE"]).toBe(1);
    },
    LLM_TIMEOUT,
  );

  it(
    "should emit events with correct signatures when using timeouts",
    async () => {
      const collector = createEventCollector();

      const result = await l0({
        stream: () =>
          client.chat.completions.create({
            model: "gpt-4o-mini",
            messages: [{ role: "user", content: "Count from 1 to 5." }],
            stream: true,
            max_tokens: 50,
          }),
        timeout: {
          initialToken: 30000,
          interToken: 5000,
        },
        onEvent: collector.handler,
      });

      let content = "";
      for await (const chunk of result.stream) {
        content += chunk;
      }

      expectValidResponse(content);

      const validation = validateAllEvents(collector.getEvents());

      if (!validation.valid) {
        console.error("Event signature errors:", validation.errors);
      }

      expect(validation.errors).toEqual([]);

      // Timeout events should have been emitted
      expect(validation.eventCounts["TIMEOUT_START"]).toBeGreaterThan(0);
    },
    LLM_TIMEOUT,
  );

  it(
    "should emit events with correct signatures when using guardrails",
    async () => {
      const collector = createEventCollector();

      const result = await l0({
        stream: () =>
          client.chat.completions.create({
            model: "gpt-4o-mini",
            messages: [{ role: "user", content: "Say 'test message'." }],
            stream: true,
            max_tokens: 20,
          }),
        guardrails: recommendedGuardrails,
        onEvent: collector.handler,
      });

      let content = "";
      for await (const chunk of result.stream) {
        content += chunk;
      }

      expectValidResponse(content);

      const validation = validateAllEvents(collector.getEvents());

      if (!validation.valid) {
        console.error("Event signature errors:", validation.errors);
      }

      expect(validation.errors).toEqual([]);

      // Guardrail events should have been emitted
      expect(validation.eventCounts["GUARDRAIL_PHASE_START"]).toBeGreaterThan(
        0,
      );
      expect(validation.eventCounts["GUARDRAIL_PHASE_END"]).toBeGreaterThan(0);
    },
    LLM_TIMEOUT,
  );

  it(
    "should emit events with correct signatures when using checkpoints",
    async () => {
      const collector = createEventCollector();

      const result = await l0({
        stream: () =>
          client.chat.completions.create({
            model: "gpt-4o-mini",
            messages: [
              { role: "user", content: "Write a short paragraph about cats." },
            ],
            stream: true,
            max_tokens: 100,
          }),
        // Checkpoints only fire when continuation is enabled
        continueFromLastKnownGoodToken: true,
        checkpoints: {
          interval: 5, // Checkpoint every 5 tokens
        },
        onEvent: collector.handler,
      });

      let content = "";
      for await (const chunk of result.stream) {
        content += chunk;
      }

      expectValidResponse(content);

      const validation = validateAllEvents(collector.getEvents());

      if (!validation.valid) {
        console.error("Event signature errors:", validation.errors);
      }

      expect(validation.errors).toEqual([]);

      // Checkpoint events should have been emitted
      expect(validation.eventCounts["CHECKPOINT_SAVED"]).toBeGreaterThan(0);
    },
    LLM_TIMEOUT,
  );

  it(
    "should propagate user context in all events",
    async () => {
      const collector = createEventCollector();
      const userContext = {
        requestId: "test-req-123",
        userId: "user-456",
        sessionId: "session-789",
      };

      const result = await l0({
        stream: () =>
          client.chat.completions.create({
            model: "gpt-4o-mini",
            messages: [{ role: "user", content: "Say 'hi'." }],
            stream: true,
            max_tokens: 5,
          }),
        context: userContext,
        onEvent: collector.handler,
      });

      let content = "";
      for await (const chunk of result.stream) {
        content += chunk;
      }

      expectValidResponse(content);

      const events = collector.getEvents();

      // Verify context is present in all observability events (not stream events)
      const observabilityEvents = events.filter(isObservabilityEvent);
      for (const event of observabilityEvents) {
        expect(event.context).toBeDefined();
        expect(event.context).toEqual(userContext);
      }

      // Also run standard validation
      const validation = validateAllEvents(events);
      expect(validation.errors).toEqual([]);
    },
    LLM_TIMEOUT,
  );

  it(
    "should emit adapter events with correct signatures",
    async () => {
      const collector = createEventCollector();

      const result = await l0({
        stream: () =>
          client.chat.completions.create({
            model: "gpt-4o-mini",
            messages: [{ role: "user", content: "Say 'adapter test'." }],
            stream: true,
            max_tokens: 10,
          }),
        onEvent: collector.handler,
      });

      let content = "";
      for await (const chunk of result.stream) {
        content += chunk;
      }

      expectValidResponse(content);

      const validation = validateAllEvents(collector.getEvents());

      if (!validation.valid) {
        console.error("Event signature errors:", validation.errors);
      }

      expect(validation.errors).toEqual([]);

      // Adapter detection should have happened
      expect(validation.eventCounts["ADAPTER_DETECTED"]).toBe(1);
    },
    LLM_TIMEOUT,
  );

  it(
    "should have consistent streamId across all events",
    async () => {
      const collector = createEventCollector();

      const result = await l0({
        stream: () =>
          client.chat.completions.create({
            model: "gpt-4o-mini",
            messages: [{ role: "user", content: "Say 'stream id test'." }],
            stream: true,
            max_tokens: 15,
          }),
        onEvent: collector.handler,
      });

      let content = "";
      for await (const chunk of result.stream) {
        content += chunk;
      }

      expectValidResponse(content);

      const events = collector.getEvents();

      // All observability events should have the same streamId
      const observabilityEvents = events.filter(isObservabilityEvent);
      const streamIds = new Set(observabilityEvents.map((e) => e.streamId));
      expect(streamIds.size).toBe(1);

      // StreamId should be a valid UUID v7 format
      const streamId = observabilityEvents[0]!.streamId;
      expect(streamId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
      );
    },
    LLM_TIMEOUT,
  );

  it(
    "should have monotonically increasing timestamps",
    async () => {
      const collector = createEventCollector();

      const result = await l0({
        stream: () =>
          client.chat.completions.create({
            model: "gpt-4o-mini",
            messages: [{ role: "user", content: "Count from 1 to 3." }],
            stream: true,
            max_tokens: 30,
          }),
        onEvent: collector.handler,
      });

      let content = "";
      for await (const chunk of result.stream) {
        content += chunk;
      }

      expectValidResponse(content);

      const events = collector.getEvents();

      // Timestamps should be monotonically increasing for observability events
      const observabilityEvents = events.filter(isObservabilityEvent);
      for (let i = 1; i < observabilityEvents.length; i++) {
        expect(observabilityEvents[i]!.ts).toBeGreaterThanOrEqual(
          observabilityEvents[i - 1]!.ts,
        );
      }
    },
    LLM_TIMEOUT,
  );

  describe("comprehensive event coverage", () => {
    it(
      "should validate all observed event types have correct signatures",
      async () => {
        const collector = createEventCollector();

        // Run a comprehensive scenario that exercises many features
        const result = await l0({
          stream: () =>
            client.chat.completions.create({
              model: "gpt-4o-mini",
              messages: [
                {
                  role: "user",
                  content:
                    "Write a short story in exactly 3 sentences about a robot.",
                },
              ],
              stream: true,
              max_tokens: 150,
            }),
          timeout: {
            initialToken: 30000,
            interToken: 5000,
          },
          guardrails: recommendedGuardrails,
          checkpoints: {
            interval: 10,
          },
          context: { testId: "comprehensive-coverage" },
          onEvent: collector.handler,
        });

        let content = "";
        for await (const chunk of result.stream) {
          content += chunk;
        }

        expectValidResponse(content);

        const validation = validateAllEvents(collector.getEvents());

        // Log all captured event types for visibility
        console.log(
          "Captured event types:",
          Object.keys(validation.eventCounts),
        );
        console.log("Event counts:", validation.eventCounts);

        if (!validation.valid) {
          console.error("Event signature errors:", validation.errors);
        }

        expect(validation.errors).toEqual([]);
        expect(validation.valid).toBe(true);

        // Verify we captured a good variety of events
        expect(Object.keys(validation.eventCounts).length).toBeGreaterThan(5);
      },
      LLM_TIMEOUT * 2,
    );
  });
});
