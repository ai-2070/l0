/**
 * L0 Event Dispatcher
 *
 * Centralized event emission for all L0 lifecycle events.
 * - Adds ts, streamId, context automatically to all events
 * - Calls handlers via microtasks (fire-and-forget)
 * - Never throws from handler failures
 */

import { uuidv7 } from "../utils/uuid";
import type {
  L0ObservabilityEvent,
  L0Event,
  L0EventHandler,
  EventType,
} from "../types/observability";

/**
 * Deep clone and freeze an object to ensure complete immutability.
 * Handles nested objects and arrays.
 */
function deepCloneAndFreeze<T>(obj: T): T {
  if (obj === null || typeof obj !== "object") {
    return obj;
  }

  if (Array.isArray(obj)) {
    const cloned = obj.map((item) => deepCloneAndFreeze(item)) as T;
    return Object.freeze(cloned);
  }

  const cloned: Record<string, unknown> = {};
  for (const key of Object.keys(obj)) {
    cloned[key] = deepCloneAndFreeze((obj as Record<string, unknown>)[key]);
  }
  return Object.freeze(cloned) as T;
}

export class EventDispatcher {
  private handlers: L0EventHandler[] = [];
  private readonly streamId: string;
  private readonly _context: Record<string, unknown>;

  constructor(context: Record<string, unknown> = {}) {
    this.streamId = uuidv7();
    this._context = deepCloneAndFreeze(context);
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
   * - Adds ts, streamId, context automatically
   * - Calls handlers via microtasks (fire-and-forget)
   * - Never throws from handler failures
   */
  emit<T extends Record<string, unknown>>(
    type: EventType,
    payload?: Omit<T, "type" | "ts" | "streamId" | "context">,
  ): void {
    // Skip event creation if no handlers registered (zero overhead when observability unused)
    if (this.handlers.length === 0) return;

    const event: L0ObservabilityEvent = {
      type,
      ts: Date.now(),
      streamId: this.streamId,
      context: this._context,
      ...payload,
    };

    // Fire handlers asynchronously via microtasks
    // Snapshot handlers to avoid issues if handlers modify the list during dispatch
    for (const handler of [...this.handlers]) {
      queueMicrotask(() => {
        try {
          // Cast to L0Event - the constructed event matches one of the union members
          const result = handler(event as L0Event) as unknown;
          // Handle async handlers that return promises
          if (result && typeof result === "object" && "catch" in result) {
            (result as Promise<void>).catch(() => {
              // Silently ignore async handler errors - fire and forget
            });
          }
        } catch {
          // Silently ignore sync handler errors - fire and forget
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
    payload?: Omit<T, "type" | "ts" | "streamId" | "context">,
  ): void {
    // Skip event creation if no handlers registered (zero overhead when observability unused)
    if (this.handlers.length === 0) return;

    const event: L0ObservabilityEvent = {
      type,
      ts: Date.now(),
      streamId: this.streamId,
      context: this._context,
      ...payload,
    };

    // Snapshot handlers to avoid issues if handlers modify the list during dispatch
    for (const handler of [...this.handlers]) {
      try {
        // Cast to L0Event - the constructed event matches one of the union members
        const result = handler(event as L0Event) as unknown;
        // Handle async handlers that return promises
        if (result && typeof result === "object" && "catch" in result) {
          (result as Promise<void>).catch(() => {
            // Silently ignore async handler errors - fire and forget
          });
        }
      } catch {
        // Silently ignore sync handler errors
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
   * Get the context for this session
   */
  getContext(): Record<string, unknown> {
    return this._context;
  }

  /**
   * Get the number of registered handlers
   */
  getHandlerCount(): number {
    return this.handlers.length;
  }
}

/**
 * Create an event dispatcher with the given context
 */
export function createEventDispatcher(
  context: Record<string, unknown> = {},
): EventDispatcher {
  return new EventDispatcher(context);
}
