/**
 * L0 Event Dispatcher
 *
 * Centralized event emission for all L0 lifecycle events.
 * - Adds ts, streamId, meta automatically to all events
 * - Calls handlers via microtasks (fire-and-forget)
 * - Never throws from handler failures
 */

import { v7 as uuidv7 } from "uuid";
import type {
  L0ObservabilityEvent,
  L0EventHandler,
  EventType,
} from "../types/observability";

export class EventDispatcher {
  private handlers: L0EventHandler[] = [];
  private readonly streamId: string;
  private readonly meta: Record<string, unknown>;

  constructor(meta: Record<string, unknown> = {}) {
    this.streamId = uuidv7();
    this.meta = Object.freeze({ ...meta }); // Immutable
  }

  /**
   * Register an event handler
   */
  onEvent(handler: L0EventHandler): void {
    this.handlers.push(handler);
  }

  /**
   * Remove an event handler
   */
  offEvent(handler: L0EventHandler): void {
    const index = this.handlers.indexOf(handler);
    if (index !== -1) {
      this.handlers.splice(index, 1);
    }
  }

  /**
   * Emit an event to all handlers
   * - Adds ts, streamId, meta automatically
   * - Calls handlers via microtasks (fire-and-forget)
   * - Never throws from handler failures
   */
  emit<T extends Record<string, unknown>>(
    type: EventType,
    payload?: Omit<T, "type" | "ts" | "streamId" | "meta">,
  ): void {
    const event: L0ObservabilityEvent = {
      type,
      ts: Date.now(),
      streamId: this.streamId,
      meta: this.meta,
      ...payload,
    };

    // Fire handlers asynchronously via microtasks
    for (const handler of this.handlers) {
      queueMicrotask(() => {
        try {
          handler(event);
        } catch {
          // Silently ignore handler errors - fire and forget
        }
      });
    }
  }

  /**
   * Emit an event synchronously (for critical path events)
   * Use sparingly - prefer emit() for most cases
   */
  emitSync<T extends Record<string, unknown>>(
    type: EventType,
    payload?: Omit<T, "type" | "ts" | "streamId" | "meta">,
  ): void {
    const event: L0ObservabilityEvent = {
      type,
      ts: Date.now(),
      streamId: this.streamId,
      meta: this.meta,
      ...payload,
    };

    for (const handler of this.handlers) {
      try {
        handler(event);
      } catch {
        // Silently ignore handler errors
      }
    }
  }

  /**
   * Get the stream ID for this session
   */
  getStreamId(): string {
    return this.streamId;
  }

  /**
   * Get the meta for this session
   */
  getMeta(): Record<string, unknown> {
    return this.meta;
  }

  /**
   * Get the number of registered handlers
   */
  getHandlerCount(): number {
    return this.handlers.length;
  }
}

/**
 * Create an event dispatcher with the given meta
 */
export function createEventDispatcher(
  meta: Record<string, unknown> = {},
): EventDispatcher {
  return new EventDispatcher(meta);
}
