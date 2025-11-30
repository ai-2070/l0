// L0 Adapter Helpers
// Utilities for building custom adapters

import type { L0Event } from "../types/l0";

/**
 * Convert any async iterable stream to L0Events.
 *
 * This helper makes it harder to write incorrect adapters by handling:
 * - Error conversion to L0 error events
 * - Automatic done event emission
 * - Timestamp generation
 *
 * You only need to provide an extraction function that pulls text from chunks.
 *
 * @typeParam T - The chunk type from the source stream
 * @param stream - The source async iterable stream
 * @param extractText - Function to extract text from a chunk (return null/undefined to skip)
 * @returns Async generator of L0Events
 *
 * @example
 * ```typescript
 * // Simple adapter using toL0Events
 * const myAdapter: L0Adapter<MyStream> = {
 *   name: "myai",
 *   detect(input): input is MyStream {
 *     return input?.type === "myai-stream";
 *   },
 *   wrap(stream) {
 *     return toL0Events(stream, (chunk) => chunk.text);
 *   },
 * };
 * ```
 *
 * @example
 * ```typescript
 * // Handle different chunk types
 * const complexAdapter: L0Adapter<ComplexStream> = {
 *   name: "complex",
 *   wrap(stream) {
 *     return toL0Events(stream, (chunk) => {
 *       if (chunk.type === "text") return chunk.content;
 *       if (chunk.type === "delta") return chunk.delta;
 *       return null; // Skip non-text chunks
 *     });
 *   },
 * };
 * ```
 */
export async function* toL0Events<T>(
  stream: AsyncIterable<T>,
  extractText: (chunk: T) => string | null | undefined,
): AsyncGenerator<L0Event> {
  try {
    for await (const chunk of stream) {
      const text = extractText(chunk);
      if (text != null) {
        yield {
          type: "token",
          value: text,
          timestamp: Date.now(),
        };
      }
    }
    yield {
      type: "done",
      timestamp: Date.now(),
    };
  } catch (err) {
    yield {
      type: "error",
      error: err instanceof Error ? err : new Error(String(err)),
      timestamp: Date.now(),
    };
  }
}

/**
 * Convert a stream with message events to L0Events.
 *
 * Use this when your stream emits both text tokens and structured messages
 * (e.g., tool calls, function calls).
 *
 * @typeParam T - The chunk type from the source stream
 * @param stream - The source async iterable stream
 * @param handlers - Object with handlers for different event types
 * @returns Async generator of L0Events
 *
 * @example
 * ```typescript
 * const toolAdapter: L0Adapter<ToolStream> = {
 *   name: "tool-ai",
 *   wrap(stream) {
 *     return toL0EventsWithMessages(stream, {
 *       extractText: (chunk) => chunk.type === "text" ? chunk.content : null,
 *       extractMessage: (chunk) => {
 *         if (chunk.type === "tool_call") {
 *           return {
 *             value: JSON.stringify(chunk.toolCall),
 *             role: "assistant",
 *           };
 *         }
 *         return null;
 *       },
 *     });
 *   },
 * };
 * ```
 */
export async function* toL0EventsWithMessages<T>(
  stream: AsyncIterable<T>,
  handlers: {
    /** Extract text content from a chunk (return null to skip) */
    extractText: (chunk: T) => string | null | undefined;
    /** Extract message content from a chunk (return null to skip) */
    extractMessage?: (chunk: T) => { value: string; role?: string } | null;
  },
): AsyncGenerator<L0Event> {
  try {
    for await (const chunk of stream) {
      // Check for text content
      const text = handlers.extractText(chunk);
      if (text != null) {
        yield {
          type: "token",
          value: text,
          timestamp: Date.now(),
        };
        continue;
      }

      // Check for message content
      if (handlers.extractMessage) {
        const message = handlers.extractMessage(chunk);
        if (message != null) {
          yield {
            type: "message",
            value: message.value,
            role: message.role,
            timestamp: Date.now(),
          };
        }
      }
    }
    yield {
      type: "done",
      timestamp: Date.now(),
    };
  } catch (err) {
    yield {
      type: "error",
      error: err instanceof Error ? err : new Error(String(err)),
      timestamp: Date.now(),
    };
  }
}

/**
 * Create an L0 token event.
 * Ensures timestamp is always present.
 *
 * @param value - The token text
 * @returns L0Event of type "token"
 */
export function createAdapterTokenEvent(value: string): L0Event {
  return {
    type: "token",
    value,
    timestamp: Date.now(),
  };
}

/**
 * Create an L0 done event.
 * Ensures timestamp is always present.
 *
 * @returns L0Event of type "done"
 */
export function createAdapterDoneEvent(): L0Event {
  return {
    type: "done",
    timestamp: Date.now(),
  };
}

/**
 * Create an L0 error event.
 * Ensures error is properly wrapped and timestamp is present.
 *
 * @param err - The error (will be wrapped if not an Error instance)
 * @returns L0Event of type "error"
 */
export function createAdapterErrorEvent(err: unknown): L0Event {
  return {
    type: "error",
    error: err instanceof Error ? err : new Error(String(err)),
    timestamp: Date.now(),
  };
}

/**
 * Create an L0 message event.
 * Ensures timestamp is always present.
 *
 * @param value - The message content (typically JSON stringified)
 * @param role - Optional role (e.g., "assistant")
 * @returns L0Event of type "message"
 */
export function createAdapterMessageEvent(value: string, role?: string): L0Event {
  return {
    type: "message",
    value,
    role,
    timestamp: Date.now(),
  };
}
