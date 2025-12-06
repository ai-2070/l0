/**
 * Tests for Event Handler Utilities
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  combineEvents,
  filterEvents,
  excludeEvents,
  debounceEvents,
  batchEvents,
  type EventHandler,
} from "../src/runtime/event-handlers";
import type { L0Event } from "../src/types/observability";
import { EventType } from "../src/types/observability";

// Helper to create mock events
function createMockEvent(
  type: string,
  overrides: Partial<L0Event> = {},
): L0Event {
  return {
    type,
    ts: Date.now(),
    streamId: "test-stream-id",
    context: {},
    ...overrides,
  } as L0Event;
}

describe("combineEvents", () => {
  it("should return no-op handler when no handlers provided", () => {
    const combined = combineEvents();
    const event = createMockEvent(EventType.SESSION_START);

    // Should not throw
    expect(() => combined(event)).not.toThrow();
  });

  it("should return no-op handler when only invalid handlers provided", () => {
    const combined = combineEvents(
      null as unknown as EventHandler,
      undefined as unknown as EventHandler,
    );
    const event = createMockEvent(EventType.SESSION_START);

    // Should not throw
    expect(() => combined(event)).not.toThrow();
  });

  it("should return single handler directly when only one provided", () => {
    const handler = vi.fn();
    const combined = combineEvents(handler);
    const event = createMockEvent(EventType.SESSION_START);

    combined(event);

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith(event);
  });

  it("should call all handlers with the event", () => {
    const handler1 = vi.fn();
    const handler2 = vi.fn();
    const handler3 = vi.fn();
    const combined = combineEvents(handler1, handler2, handler3);
    const event = createMockEvent(EventType.COMPLETE);

    combined(event);

    expect(handler1).toHaveBeenCalledWith(event);
    expect(handler2).toHaveBeenCalledWith(event);
    expect(handler3).toHaveBeenCalledWith(event);
  });

  it("should filter out null/undefined handlers", () => {
    const handler1 = vi.fn();
    const handler2 = vi.fn();
    const combined = combineEvents(
      handler1,
      null as unknown as EventHandler,
      handler2,
      undefined as unknown as EventHandler,
    );
    const event = createMockEvent(EventType.TOKEN);

    combined(event);

    expect(handler1).toHaveBeenCalledWith(event);
    expect(handler2).toHaveBeenCalledWith(event);
  });

  it("should continue calling handlers even if one throws", () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const handler1 = vi.fn();
    const throwingHandler = vi.fn(() => {
      throw new Error("Handler error");
    });
    const handler3 = vi.fn();

    const combined = combineEvents(handler1, throwingHandler, handler3);
    const event = createMockEvent(EventType.ERROR);

    combined(event);

    expect(handler1).toHaveBeenCalled();
    expect(throwingHandler).toHaveBeenCalled();
    expect(handler3).toHaveBeenCalled();
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("Event handler error"),
      expect.any(String),
    );

    consoleSpy.mockRestore();
  });

  it("should log non-Error throws correctly", () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const normalHandler = vi.fn();
    const throwingHandler = vi.fn(() => {
      throw "string error";
    });

    // Need at least 2 handlers to trigger the combined path with try-catch
    const combined = combineEvents(throwingHandler, normalHandler);
    const event = createMockEvent(EventType.ERROR);

    combined(event);

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("Event handler error"),
      "string error",
    );
    expect(normalHandler).toHaveBeenCalled();

    consoleSpy.mockRestore();
  });
});

describe("filterEvents", () => {
  it("should only call handler for matching event types", () => {
    const handler = vi.fn();
    const filtered = filterEvents(
      [EventType.ERROR, EventType.COMPLETE],
      handler,
    );

    filtered(createMockEvent(EventType.ERROR));
    filtered(createMockEvent(EventType.TOKEN));
    filtered(createMockEvent(EventType.COMPLETE));
    filtered(createMockEvent(EventType.SESSION_START));

    expect(handler).toHaveBeenCalledTimes(2);
  });

  it("should pass the event to the handler", () => {
    const handler = vi.fn();
    const filtered = filterEvents([EventType.ERROR], handler);
    const event = createMockEvent(EventType.ERROR, {
      error: "test error",
    } as any);

    filtered(event);

    expect(handler).toHaveBeenCalledWith(event);
  });

  it("should not call handler for non-matching types", () => {
    const handler = vi.fn();
    const filtered = filterEvents([EventType.ERROR], handler);

    filtered(createMockEvent(EventType.TOKEN));
    filtered(createMockEvent(EventType.COMPLETE));

    expect(handler).not.toHaveBeenCalled();
  });

  it("should work with empty filter list", () => {
    const handler = vi.fn();
    const filtered = filterEvents([], handler);

    filtered(createMockEvent(EventType.ERROR));
    filtered(createMockEvent(EventType.TOKEN));

    expect(handler).not.toHaveBeenCalled();
  });

  it("should work with single filter type", () => {
    const handler = vi.fn();
    const filtered = filterEvents([EventType.COMPLETE], handler);

    filtered(createMockEvent(EventType.COMPLETE));

    expect(handler).toHaveBeenCalledTimes(1);
  });
});

describe("excludeEvents", () => {
  it("should call handler for non-excluded event types", () => {
    const handler = vi.fn();
    const excluded = excludeEvents([EventType.TOKEN], handler);

    excluded(createMockEvent(EventType.ERROR));
    excluded(createMockEvent(EventType.TOKEN));
    excluded(createMockEvent(EventType.COMPLETE));

    expect(handler).toHaveBeenCalledTimes(2);
  });

  it("should not call handler for excluded types", () => {
    const handler = vi.fn();
    const excluded = excludeEvents(
      [EventType.TOKEN, EventType.SESSION_START],
      handler,
    );

    excluded(createMockEvent(EventType.TOKEN));
    excluded(createMockEvent(EventType.SESSION_START));

    expect(handler).not.toHaveBeenCalled();
  });

  it("should pass the event to the handler", () => {
    const handler = vi.fn();
    const excluded = excludeEvents([EventType.TOKEN], handler);
    const event = createMockEvent(EventType.COMPLETE);

    excluded(event);

    expect(handler).toHaveBeenCalledWith(event);
  });

  it("should call handler for all events when exclude list is empty", () => {
    const handler = vi.fn();
    const excluded = excludeEvents([], handler);

    excluded(createMockEvent(EventType.TOKEN));
    excluded(createMockEvent(EventType.ERROR));
    excluded(createMockEvent(EventType.COMPLETE));

    expect(handler).toHaveBeenCalledTimes(3);
  });
});

describe("debounceEvents", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("should debounce events within the interval", () => {
    const handler = vi.fn();
    const debounced = debounceEvents(100, handler);

    debounced(createMockEvent(EventType.TOKEN, { value: "1" } as any));
    debounced(createMockEvent(EventType.TOKEN, { value: "2" } as any));
    debounced(createMockEvent(EventType.TOKEN, { value: "3" } as any));

    expect(handler).not.toHaveBeenCalled();

    vi.advanceTimersByTime(100);

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({ value: "3" }),
    );
  });

  it("should call handler with latest event after timeout", () => {
    const handler = vi.fn();
    const debounced = debounceEvents(50, handler);
    const latestEvent = createMockEvent(EventType.COMPLETE);

    debounced(createMockEvent(EventType.TOKEN));
    debounced(latestEvent);

    vi.advanceTimersByTime(50);

    expect(handler).toHaveBeenCalledWith(latestEvent);
  });

  it("should allow multiple debounce cycles", () => {
    const handler = vi.fn();
    const debounced = debounceEvents(100, handler);

    // First cycle
    debounced(createMockEvent(EventType.TOKEN, { value: "a" } as any));
    vi.advanceTimersByTime(100);
    expect(handler).toHaveBeenCalledTimes(1);

    // Second cycle
    debounced(createMockEvent(EventType.TOKEN, { value: "b" } as any));
    vi.advanceTimersByTime(100);
    expect(handler).toHaveBeenCalledTimes(2);
  });

  it("should not call handler if no events received", () => {
    const handler = vi.fn();
    debounceEvents(100, handler);

    vi.advanceTimersByTime(200);

    expect(handler).not.toHaveBeenCalled();
  });
});

describe("batchEvents", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("should flush when batch size is reached", () => {
    const handler = vi.fn();
    const batched = batchEvents(3, 1000, handler);

    batched(createMockEvent(EventType.TOKEN, { value: "1" } as any));
    batched(createMockEvent(EventType.TOKEN, { value: "2" } as any));
    expect(handler).not.toHaveBeenCalled();

    batched(createMockEvent(EventType.TOKEN, { value: "3" } as any));
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ value: "1" }),
        expect.objectContaining({ value: "2" }),
        expect.objectContaining({ value: "3" }),
      ]),
    );
  });

  it("should flush after max wait time", () => {
    const handler = vi.fn();
    const batched = batchEvents(10, 500, handler);

    batched(createMockEvent(EventType.TOKEN, { value: "1" } as any));
    batched(createMockEvent(EventType.TOKEN, { value: "2" } as any));

    expect(handler).not.toHaveBeenCalled();

    vi.advanceTimersByTime(500);

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ value: "1" }),
        expect.objectContaining({ value: "2" }),
      ]),
    );
  });

  it("should not flush if no events received", () => {
    const handler = vi.fn();
    batchEvents(5, 100, handler);

    vi.advanceTimersByTime(200);

    expect(handler).not.toHaveBeenCalled();
  });

  it("should clear timer after size-based flush", () => {
    const handler = vi.fn();
    const batched = batchEvents(2, 1000, handler);

    batched(createMockEvent(EventType.TOKEN));
    batched(createMockEvent(EventType.TOKEN));

    expect(handler).toHaveBeenCalledTimes(1);

    // Timer should be cleared, so advancing time shouldn't trigger another call
    vi.advanceTimersByTime(1000);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("should handle multiple batches", () => {
    const handler = vi.fn();
    const batched = batchEvents(2, 1000, handler);

    // First batch
    batched(createMockEvent(EventType.TOKEN, { value: "1" } as any));
    batched(createMockEvent(EventType.TOKEN, { value: "2" } as any));
    expect(handler).toHaveBeenCalledTimes(1);

    // Second batch
    batched(createMockEvent(EventType.TOKEN, { value: "3" } as any));
    batched(createMockEvent(EventType.TOKEN, { value: "4" } as any));
    expect(handler).toHaveBeenCalledTimes(2);
  });

  it("should pass a copy of the batch array", () => {
    const handler = vi.fn();
    const batched = batchEvents(2, 1000, handler);

    batched(createMockEvent(EventType.TOKEN));
    batched(createMockEvent(EventType.TOKEN));

    const firstBatch = handler.mock.calls[0][0];

    // Add more events
    batched(createMockEvent(EventType.COMPLETE));
    batched(createMockEvent(EventType.COMPLETE));

    // First batch should not be modified
    expect(firstBatch.length).toBe(2);
  });

  it("should flush partial batch on timeout even with pending timer", () => {
    const handler = vi.fn();
    const batched = batchEvents(5, 200, handler);

    batched(createMockEvent(EventType.TOKEN));

    vi.advanceTimersByTime(100);
    expect(handler).not.toHaveBeenCalled();

    batched(createMockEvent(EventType.TOKEN));

    vi.advanceTimersByTime(100);
    // Timer was set on first event, so should flush now
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith(expect.any(Array));
    expect(handler.mock.calls[0][0].length).toBe(2);
  });
});

describe("Integration: combining utilities", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("should work with combineEvents and filterEvents", () => {
    const errorHandler = vi.fn();
    const completeHandler = vi.fn();

    const combined = combineEvents(
      filterEvents([EventType.ERROR], errorHandler),
      filterEvents([EventType.COMPLETE], completeHandler),
    );

    combined(createMockEvent(EventType.TOKEN));
    combined(createMockEvent(EventType.ERROR));
    combined(createMockEvent(EventType.COMPLETE));

    expect(errorHandler).toHaveBeenCalledTimes(1);
    expect(completeHandler).toHaveBeenCalledTimes(1);
  });

  it("should work with combineEvents and excludeEvents", () => {
    const quietHandler = vi.fn();
    const allHandler = vi.fn();

    const combined = combineEvents(
      excludeEvents([EventType.TOKEN], quietHandler),
      allHandler,
    );

    combined(createMockEvent(EventType.TOKEN));
    combined(createMockEvent(EventType.ERROR));

    expect(quietHandler).toHaveBeenCalledTimes(1);
    expect(allHandler).toHaveBeenCalledTimes(2);
  });

  it("should work with filterEvents and debounceEvents", () => {
    const handler = vi.fn();
    const filtered = filterEvents(
      [EventType.TOKEN],
      debounceEvents(100, handler),
    );

    filtered(createMockEvent(EventType.TOKEN));
    filtered(createMockEvent(EventType.ERROR)); // Should be filtered out
    filtered(createMockEvent(EventType.TOKEN));

    vi.advanceTimersByTime(100);

    expect(handler).toHaveBeenCalledTimes(1);
  });
});
