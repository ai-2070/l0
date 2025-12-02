/**
 * Tests for EventDispatcher
 *
 * The EventDispatcher is the centralized event emission system for L0.
 * It handles:
 * - Automatic event metadata (ts, streamId, meta)
 * - Async (microtask) and sync event emission
 * - Handler registration and removal
 * - Error isolation (handlers can't crash the runtime)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  EventDispatcher,
  createEventDispatcher,
} from "../src/runtime/event-dispatcher";
import { EventType } from "../src/types/observability";

describe("EventDispatcher", () => {
  describe("constructor", () => {
    it("should create dispatcher with empty meta by default", () => {
      const dispatcher = new EventDispatcher();
      expect(dispatcher.getMeta()).toEqual({});
    });

    it("should create dispatcher with provided meta", () => {
      const meta = { userId: "123", sessionId: "abc" };
      const dispatcher = new EventDispatcher(meta);
      expect(dispatcher.getMeta()).toEqual(meta);
    });

    it("should freeze meta to prevent mutation", () => {
      const meta = { key: "value" };
      const dispatcher = new EventDispatcher(meta);
      const retrievedMeta = dispatcher.getMeta();

      expect(() => {
        (retrievedMeta as Record<string, unknown>).newKey = "newValue";
      }).toThrow();
    });

    it("should generate unique streamId", () => {
      const dispatcher1 = new EventDispatcher();
      const dispatcher2 = new EventDispatcher();
      expect(dispatcher1.getStreamId()).not.toBe(dispatcher2.getStreamId());
    });
  });

  describe("onEvent / offEvent", () => {
    it("should register handlers", () => {
      const dispatcher = new EventDispatcher();
      const handler = vi.fn();

      dispatcher.onEvent(handler);
      expect(dispatcher.getHandlerCount()).toBe(1);
    });

    it("should register multiple handlers", () => {
      const dispatcher = new EventDispatcher();
      const handler1 = vi.fn();
      const handler2 = vi.fn();

      dispatcher.onEvent(handler1);
      dispatcher.onEvent(handler2);
      expect(dispatcher.getHandlerCount()).toBe(2);
    });

    it("should remove handlers with offEvent", () => {
      const dispatcher = new EventDispatcher();
      const handler = vi.fn();

      dispatcher.onEvent(handler);
      expect(dispatcher.getHandlerCount()).toBe(1);

      dispatcher.offEvent(handler);
      expect(dispatcher.getHandlerCount()).toBe(0);
    });

    it("should only remove the specified handler", () => {
      const dispatcher = new EventDispatcher();
      const handler1 = vi.fn();
      const handler2 = vi.fn();

      dispatcher.onEvent(handler1);
      dispatcher.onEvent(handler2);
      dispatcher.offEvent(handler1);

      expect(dispatcher.getHandlerCount()).toBe(1);
    });

    it("should do nothing when removing non-existent handler", () => {
      const dispatcher = new EventDispatcher();
      const handler1 = vi.fn();
      const handler2 = vi.fn();

      dispatcher.onEvent(handler1);
      dispatcher.offEvent(handler2); // Not registered

      expect(dispatcher.getHandlerCount()).toBe(1);
    });
  });

  describe("emit (async)", () => {
    it("should skip event creation when no handlers registered", async () => {
      const dispatcher = new EventDispatcher();

      // Should not throw and return immediately
      expect(() => dispatcher.emit(EventType.SESSION_START)).not.toThrow();

      // Verify no handlers were called (none registered)
      expect(dispatcher.getHandlerCount()).toBe(0);

      // Even after microtask, nothing should happen
      await Promise.resolve();
    });

    it("should call handlers asynchronously via microtask", async () => {
      const dispatcher = new EventDispatcher();
      const handler = vi.fn();

      dispatcher.onEvent(handler);
      dispatcher.emit(EventType.SESSION_START);

      // Handler not called synchronously
      expect(handler).not.toHaveBeenCalled();

      // Wait for microtask
      await Promise.resolve();

      expect(handler).toHaveBeenCalledTimes(1);
    });

    it("should include type, ts, streamId, and meta in event", async () => {
      const meta = { userId: "test" };
      const dispatcher = new EventDispatcher(meta);
      const handler = vi.fn();

      dispatcher.onEvent(handler);
      dispatcher.emit(EventType.SESSION_START);

      await Promise.resolve();

      const event = handler.mock.calls[0][0];
      expect(event.type).toBe(EventType.SESSION_START);
      expect(typeof event.ts).toBe("number");
      expect(event.streamId).toBe(dispatcher.getStreamId());
      expect(event.meta).toEqual(meta);
    });

    it("should include payload in event", async () => {
      const dispatcher = new EventDispatcher();
      const handler = vi.fn();

      dispatcher.onEvent(handler);
      dispatcher.emit(EventType.COMPLETE, { content: "hello", tokenCount: 5 });

      await Promise.resolve();

      const event = handler.mock.calls[0][0];
      expect(event.content).toBe("hello");
      expect(event.tokenCount).toBe(5);
    });

    it("should call all registered handlers", async () => {
      const dispatcher = new EventDispatcher();
      const handler1 = vi.fn();
      const handler2 = vi.fn();
      const handler3 = vi.fn();

      dispatcher.onEvent(handler1);
      dispatcher.onEvent(handler2);
      dispatcher.onEvent(handler3);

      dispatcher.emit(EventType.SESSION_START);

      await Promise.resolve();

      expect(handler1).toHaveBeenCalledTimes(1);
      expect(handler2).toHaveBeenCalledTimes(1);
      expect(handler3).toHaveBeenCalledTimes(1);
    });

    it("should not throw when sync handler throws", async () => {
      const dispatcher = new EventDispatcher();
      const throwingHandler = vi.fn(() => {
        throw new Error("Handler error");
      });
      const normalHandler = vi.fn();

      dispatcher.onEvent(throwingHandler);
      dispatcher.onEvent(normalHandler);

      // Should not throw
      expect(() => dispatcher.emit(EventType.SESSION_START)).not.toThrow();

      await Promise.resolve();

      // Both handlers should have been called
      expect(throwingHandler).toHaveBeenCalled();
      expect(normalHandler).toHaveBeenCalled();
    });

    it("should not throw when async handler rejects", async () => {
      const dispatcher = new EventDispatcher();
      const rejectingHandler = vi.fn(async () => {
        throw new Error("Async handler error");
      });
      const normalHandler = vi.fn();

      dispatcher.onEvent(rejectingHandler);
      dispatcher.onEvent(normalHandler);

      // Should not throw
      expect(() => dispatcher.emit(EventType.SESSION_START)).not.toThrow();

      // Wait for handlers and promise rejection handling
      await Promise.resolve();
      await Promise.resolve();

      // Both handlers should have been called
      expect(rejectingHandler).toHaveBeenCalled();
      expect(normalHandler).toHaveBeenCalled();
    });

    it("should snapshot handlers to prevent modification during dispatch", async () => {
      const dispatcher = new EventDispatcher();
      const events: string[] = [];

      const handler1 = vi.fn(() => {
        events.push("handler1");
        // Try to add new handler during dispatch
        dispatcher.onEvent(newHandler);
      });

      const newHandler = vi.fn(() => {
        events.push("newHandler");
      });

      dispatcher.onEvent(handler1);
      dispatcher.emit(EventType.SESSION_START);

      await Promise.resolve();

      // Only handler1 should have been called for this emit
      expect(events).toEqual(["handler1"]);
      expect(newHandler).not.toHaveBeenCalled();

      // But newHandler is registered for future emits
      expect(dispatcher.getHandlerCount()).toBe(2);
    });
  });

  describe("emitSync", () => {
    it("should skip event creation when no handlers registered", () => {
      const dispatcher = new EventDispatcher();

      // Should not throw and return immediately
      expect(() => dispatcher.emitSync(EventType.SESSION_START)).not.toThrow();

      // Verify no handlers were called (none registered)
      expect(dispatcher.getHandlerCount()).toBe(0);
    });

    it("should call handlers synchronously", () => {
      const dispatcher = new EventDispatcher();
      const handler = vi.fn();

      dispatcher.onEvent(handler);
      dispatcher.emitSync(EventType.SESSION_START);

      // Handler called immediately
      expect(handler).toHaveBeenCalledTimes(1);
    });

    it("should include type, ts, streamId, and meta in event", () => {
      const meta = { userId: "test" };
      const dispatcher = new EventDispatcher(meta);
      const handler = vi.fn();

      dispatcher.onEvent(handler);
      dispatcher.emitSync(EventType.SESSION_START);

      const event = handler.mock.calls[0][0];
      expect(event.type).toBe(EventType.SESSION_START);
      expect(typeof event.ts).toBe("number");
      expect(event.streamId).toBe(dispatcher.getStreamId());
      expect(event.meta).toEqual(meta);
    });

    it("should include payload in event", () => {
      const dispatcher = new EventDispatcher();
      const handler = vi.fn();

      dispatcher.onEvent(handler);
      dispatcher.emitSync(EventType.COMPLETE, {
        content: "world",
        tokenCount: 10,
      });

      const event = handler.mock.calls[0][0];
      expect(event.content).toBe("world");
      expect(event.tokenCount).toBe(10);
    });

    it("should call all registered handlers", () => {
      const dispatcher = new EventDispatcher();
      const handler1 = vi.fn();
      const handler2 = vi.fn();

      dispatcher.onEvent(handler1);
      dispatcher.onEvent(handler2);

      dispatcher.emitSync(EventType.SESSION_START);

      expect(handler1).toHaveBeenCalledTimes(1);
      expect(handler2).toHaveBeenCalledTimes(1);
    });

    it("should not throw when sync handler throws", () => {
      const dispatcher = new EventDispatcher();
      const throwingHandler = vi.fn(() => {
        throw new Error("Handler error");
      });
      const normalHandler = vi.fn();

      dispatcher.onEvent(throwingHandler);
      dispatcher.onEvent(normalHandler);

      // Should not throw
      expect(() => dispatcher.emitSync(EventType.SESSION_START)).not.toThrow();

      // Both handlers should have been called
      expect(throwingHandler).toHaveBeenCalled();
      expect(normalHandler).toHaveBeenCalled();
    });

    it("should not throw when async handler rejects", async () => {
      const dispatcher = new EventDispatcher();
      const rejectingHandler = vi.fn(async () => {
        throw new Error("Async handler error");
      });
      const normalHandler = vi.fn();

      dispatcher.onEvent(rejectingHandler);
      dispatcher.onEvent(normalHandler);

      // Should not throw
      expect(() => dispatcher.emitSync(EventType.SESSION_START)).not.toThrow();

      // Both handlers called synchronously
      expect(rejectingHandler).toHaveBeenCalled();
      expect(normalHandler).toHaveBeenCalled();

      // Wait for promise rejection to be handled
      await Promise.resolve();
    });

    it("should snapshot handlers to prevent modification during dispatch", () => {
      const dispatcher = new EventDispatcher();
      const events: string[] = [];

      const handler1 = vi.fn(() => {
        events.push("handler1");
        dispatcher.onEvent(newHandler);
      });

      const newHandler = vi.fn(() => {
        events.push("newHandler");
      });

      dispatcher.onEvent(handler1);
      dispatcher.emitSync(EventType.SESSION_START);

      // Only handler1 should have been called
      expect(events).toEqual(["handler1"]);
      expect(newHandler).not.toHaveBeenCalled();

      // But newHandler is registered for future emits
      expect(dispatcher.getHandlerCount()).toBe(2);
    });
  });

  describe("getStreamId", () => {
    it("should return consistent streamId", () => {
      const dispatcher = new EventDispatcher();
      const id1 = dispatcher.getStreamId();
      const id2 = dispatcher.getStreamId();
      expect(id1).toBe(id2);
    });

    it("should return valid UUID v7 format", () => {
      const dispatcher = new EventDispatcher();
      const streamId = dispatcher.getStreamId();
      // UUID v7 format: xxxxxxxx-xxxx-7xxx-xxxx-xxxxxxxxxxxx
      expect(streamId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
      );
    });
  });

  describe("getMeta", () => {
    it("should return the meta object", () => {
      const meta = { env: "test", version: "1.0" };
      const dispatcher = new EventDispatcher(meta);
      expect(dispatcher.getMeta()).toEqual(meta);
    });

    it("should return empty object when no meta provided", () => {
      const dispatcher = new EventDispatcher();
      expect(dispatcher.getMeta()).toEqual({});
    });
  });

  describe("getHandlerCount", () => {
    it("should return 0 when no handlers registered", () => {
      const dispatcher = new EventDispatcher();
      expect(dispatcher.getHandlerCount()).toBe(0);
    });

    it("should return correct count after adding handlers", () => {
      const dispatcher = new EventDispatcher();
      dispatcher.onEvent(vi.fn());
      dispatcher.onEvent(vi.fn());
      dispatcher.onEvent(vi.fn());
      expect(dispatcher.getHandlerCount()).toBe(3);
    });

    it("should return correct count after removing handlers", () => {
      const dispatcher = new EventDispatcher();
      const handler1 = vi.fn();
      const handler2 = vi.fn();

      dispatcher.onEvent(handler1);
      dispatcher.onEvent(handler2);
      dispatcher.offEvent(handler1);

      expect(dispatcher.getHandlerCount()).toBe(1);
    });
  });

  describe("createEventDispatcher factory", () => {
    it("should create EventDispatcher instance", () => {
      const dispatcher = createEventDispatcher();
      expect(dispatcher).toBeInstanceOf(EventDispatcher);
    });

    it("should pass meta to constructor", () => {
      const meta = { factory: true };
      const dispatcher = createEventDispatcher(meta);
      expect(dispatcher.getMeta()).toEqual(meta);
    });

    it("should work with empty meta", () => {
      const dispatcher = createEventDispatcher({});
      expect(dispatcher.getMeta()).toEqual({});
    });
  });
});
