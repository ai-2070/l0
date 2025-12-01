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
      type: "complete",
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
      type: "complete",
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
 * Create an L0 complete event.
 * Ensures timestamp is always present.
 *
 * @returns L0Event of type "complete"
 */
export function createAdapterDoneEvent(): L0Event {
  return {
    type: "complete",
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
export function createAdapterMessageEvent(
  value: string,
  role?: string,
): L0Event {
  return {
    type: "message",
    value,
    role,
    timestamp: Date.now(),
  };
}

// ============================================================================
// Multimodal Adapter Helpers
// ============================================================================

import type { L0DataPayload, L0Progress } from "../types/l0";

/**
 * Create an L0 data event for multimodal content (images, audio, etc.)
 *
 * @param payload - The data payload containing the multimodal content
 * @returns L0Event of type "data"
 *
 * @example
 * ```typescript
 * // Image from URL
 * yield createAdapterDataEvent({
 *   contentType: "image",
 *   mimeType: "image/png",
 *   url: "https://example.com/image.png",
 *   metadata: { width: 1024, height: 1024 }
 * });
 *
 * // Image from base64
 * yield createAdapterDataEvent({
 *   contentType: "image",
 *   mimeType: "image/png",
 *   base64: "iVBORw0KGgo...",
 *   metadata: { width: 512, height: 512, seed: 12345 }
 * });
 * ```
 */
export function createAdapterDataEvent(payload: L0DataPayload): L0Event {
  return {
    type: "data",
    data: payload,
    timestamp: Date.now(),
  };
}

/**
 * Create an L0 progress event for long-running operations.
 *
 * @param progress - Progress information
 * @returns L0Event of type "progress"
 *
 * @example
 * ```typescript
 * // Percentage-based progress
 * yield createAdapterProgressEvent({ percent: 50, message: "Generating image..." });
 *
 * // Step-based progress
 * yield createAdapterProgressEvent({ step: 3, totalSteps: 10, message: "Diffusion step 3/10" });
 * ```
 */
export function createAdapterProgressEvent(progress: L0Progress): L0Event {
  return {
    type: "progress",
    progress,
    timestamp: Date.now(),
  };
}

/**
 * Create an image data event with convenience parameters.
 *
 * @param options - Image data options
 * @returns L0Event of type "data" with image content
 *
 * @example
 * ```typescript
 * // From URL
 * yield createImageEvent({ url: "https://example.com/image.png" });
 *
 * // From base64 with metadata
 * yield createImageEvent({
 *   base64: "iVBORw0KGgo...",
 *   mimeType: "image/png",
 *   width: 1024,
 *   height: 1024,
 *   seed: 42,
 *   model: "flux-schnell"
 * });
 * ```
 */
export function createImageEvent(options: {
  url?: string;
  base64?: string;
  bytes?: Uint8Array;
  mimeType?: string;
  width?: number;
  height?: number;
  seed?: number;
  model?: string;
}): L0Event {
  const payload: L0DataPayload = {
    contentType: "image",
    mimeType: options.mimeType ?? "image/png",
    url: options.url,
    base64: options.base64,
    bytes: options.bytes,
    metadata: {
      width: options.width,
      height: options.height,
      seed: options.seed,
      model: options.model,
    },
  };

  // Remove undefined metadata fields
  if (payload.metadata) {
    payload.metadata = Object.fromEntries(
      Object.entries(payload.metadata).filter(([_, v]) => v !== undefined),
    );
    if (Object.keys(payload.metadata).length === 0) {
      delete payload.metadata;
    }
  }

  return createAdapterDataEvent(payload);
}

/**
 * Create an audio data event with convenience parameters.
 *
 * @param options - Audio data options
 * @returns L0Event of type "data" with audio content
 */
export function createAudioEvent(options: {
  url?: string;
  base64?: string;
  bytes?: Uint8Array;
  mimeType?: string;
  duration?: number;
  model?: string;
}): L0Event {
  const payload: L0DataPayload = {
    contentType: "audio",
    mimeType: options.mimeType ?? "audio/mp3",
    url: options.url,
    base64: options.base64,
    bytes: options.bytes,
    metadata: {
      duration: options.duration,
      model: options.model,
    },
  };

  // Remove undefined metadata fields
  if (payload.metadata) {
    payload.metadata = Object.fromEntries(
      Object.entries(payload.metadata).filter(([_, v]) => v !== undefined),
    );
    if (Object.keys(payload.metadata).length === 0) {
      delete payload.metadata;
    }
  }

  return createAdapterDataEvent(payload);
}

/**
 * Create a JSON data event for structured non-text responses.
 *
 * @param data - The JSON data
 * @param metadata - Optional metadata
 * @returns L0Event of type "data" with JSON content
 */
export function createJsonDataEvent(
  data: unknown,
  metadata?: Record<string, unknown>,
): L0Event {
  return createAdapterDataEvent({
    contentType: "json",
    mimeType: "application/json",
    json: data,
    metadata,
  });
}

/**
 * Convert multimodal stream to L0Events with support for both text and data.
 *
 * @typeParam T - The chunk type from the source stream
 * @param stream - The source async iterable stream
 * @param handlers - Handlers for extracting different content types
 * @returns Async generator of L0Events
 *
 * @example
 * ```typescript
 * // Flux image generation adapter
 * const fluxAdapter: L0Adapter<FluxStream> = {
 *   name: "flux",
 *   wrap(stream) {
 *     return toMultimodalL0Events(stream, {
 *       extractData: (chunk) => {
 *         if (chunk.type === "image") {
 *           return {
 *             contentType: "image",
 *             mimeType: "image/png",
 *             base64: chunk.image,
 *             metadata: { width: chunk.width, height: chunk.height, seed: chunk.seed }
 *           };
 *         }
 *         return null;
 *       },
 *       extractProgress: (chunk) => {
 *         if (chunk.type === "progress") {
 *           return { percent: chunk.percent, message: chunk.status };
 *         }
 *         return null;
 *       }
 *     });
 *   },
 * };
 * ```
 */
export async function* toMultimodalL0Events<T>(
  stream: AsyncIterable<T>,
  handlers: {
    /** Extract text from chunk (for token events) */
    extractText?: (chunk: T) => string | null | undefined;
    /** Extract multimodal data from chunk */
    extractData?: (chunk: T) => L0DataPayload | null | undefined;
    /** Extract progress from chunk */
    extractProgress?: (chunk: T) => L0Progress | null | undefined;
    /** Extract message from chunk */
    extractMessage?: (
      chunk: T,
    ) => { value: string; role?: string } | null | undefined;
  },
): AsyncGenerator<L0Event> {
  try {
    for await (const chunk of stream) {
      // Try each extractor in order

      // Text tokens
      if (handlers.extractText) {
        const text = handlers.extractText(chunk);
        if (text != null) {
          yield createAdapterTokenEvent(text);
          continue;
        }
      }

      // Multimodal data
      if (handlers.extractData) {
        const data = handlers.extractData(chunk);
        if (data != null) {
          yield createAdapterDataEvent(data);
          continue;
        }
      }

      // Progress updates
      if (handlers.extractProgress) {
        const progress = handlers.extractProgress(chunk);
        if (progress != null) {
          yield createAdapterProgressEvent(progress);
          continue;
        }
      }

      // Messages
      if (handlers.extractMessage) {
        const message = handlers.extractMessage(chunk);
        if (message != null) {
          yield createAdapterMessageEvent(message.value, message.role);
          continue;
        }
      }
    }

    yield createAdapterDoneEvent();
  } catch (err) {
    yield createAdapterErrorEvent(err);
  }
}
