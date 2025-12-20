// Vercel AI SDK adapter for streamObject() results
// Handles structured object streaming without ReadableStream locking issues
//
// This adapter works with the `ai` package from Vercel.
// Install it with: npm install ai

import type { L0Event, L0Adapter } from "../types/l0";

/**
 * Vercel AI SDK StreamObjectResult type
 * Using a minimal interface to avoid importing the full ai package
 */
export interface VercelStreamObjectResult<T = unknown> {
  /** AsyncIterable of raw JSON text chunks */
  textStream: AsyncIterable<string>;
  /** AsyncIterable of partial objects as they stream */
  partialObjectStream: AsyncIterable<T>;
  /** Promise that resolves to the final parsed object */
  object: Promise<T>;
  /** Promise that resolves to usage information */
  usage: Promise<unknown>;
  /** Promise that resolves to finish reason */
  finishReason?: Promise<string>;
}

/**
 * Options for wrapping Vercel AI object streams
 */
export interface VercelAIObjectAdapterOptions {
  /**
   * Include usage information in complete event
   * @default true
   */
  includeUsage?: boolean;
}

/**
 * Wrap a Vercel AI SDK StreamObjectResult for use with L0
 *
 * Uses textStream to get raw JSON tokens - this is what structured() expects.
 * textStream is a simple AsyncIterable<string>, avoiding the ReadableStream
 * locking issues that occur with fullStream.getReader().
 *
 * @param streamResult - Vercel AI SDK StreamObjectResult from streamObject()
 * @param options - Adapter options
 * @returns Async generator of L0 events
 *
 * @example
 * ```typescript
 * import { streamObject } from 'ai';
 * import { openai } from '@ai-sdk/openai';
 * import { structured, vercelAIObjectAdapter } from 'l0';
 * import { z } from 'zod';
 *
 * const result = await structured({
 *   schema: z.object({ name: z.string(), age: z.number() }),
 *   stream: () => streamObject({
 *     model: openai('gpt-4o'),
 *     prompt: 'Generate a person',
 *     schema: z.object({ name: z.string(), age: z.number() }),
 *   }),
 *   adapter: vercelAIObjectAdapter,
 * });
 * ```
 */
export async function* wrapVercelAIObjectStream(
  streamResult: VercelStreamObjectResult,
  options: VercelAIObjectAdapterOptions = {},
): AsyncGenerator<L0Event> {
  const { includeUsage = true } = options;

  try {
    // Use textStream for raw JSON tokens - this is what structured() expects
    // textStream is a simple AsyncIterable<string>, no locking issues
    for await (const chunk of streamResult.textStream) {
      yield {
        type: "token",
        value: chunk,
        timestamp: Date.now(),
      };
    }

    // Emit completion with usage
    let usage: { [key: string]: unknown } | undefined;
    if (includeUsage) {
      try {
        const rawUsage = await streamResult.usage;
        if (rawUsage && typeof rawUsage === "object") {
          usage = rawUsage as { [key: string]: unknown };
        }
      } catch {
        // Usage may not be available
      }
    }

    yield {
      type: "complete",
      timestamp: Date.now(),
      ...(usage ? { usage } : {}),
    };
  } catch (error) {
    yield {
      type: "error",
      error: error instanceof Error ? error : new Error(String(error)),
      timestamp: Date.now(),
    };
  }
}

/**
 * Type guard to check if an object is a Vercel AI SDK StreamObjectResult
 *
 * Distinguishes streamObject() from streamText() by checking for:
 * - partialObjectStream: Only exists on streamObject() results
 * - object: Promise for the final object, only on streamObject()
 * - textStream: Both have this, but we need it for streaming
 * - Absence of toolCalls: streamText() has this, streamObject() doesn't
 */
export function isVercelAIObjectStream(
  obj: unknown,
): obj is VercelStreamObjectResult {
  if (!obj || typeof obj !== "object") {
    return false;
  }
  const stream = obj as Record<string, unknown>;

  // streamObject has these properties that streamText doesn't have:
  // - partialObjectStream: AsyncIterable of partial objects
  // - object: Promise that resolves to the final object
  // streamText has toolCalls, streamObject doesn't
  return (
    "partialObjectStream" in stream &&
    "object" in stream &&
    "textStream" in stream &&
    !("toolCalls" in stream)
  );
}

/**
 * Vercel AI SDK adapter for streamObject() results
 *
 * Use this adapter when using Vercel AI SDK's streamObject() function
 * with L0's structured() function. It avoids the "ReadableStream is locked"
 * error that occurs when using the standard vercel-ai adapter.
 *
 * The key difference from vercel-ai adapter:
 * - Uses textStream (AsyncIterable) instead of fullStream.getReader()
 * - No ReadableStream locking issues
 * - Outputs raw JSON text tokens that structured() expects
 *
 * @example
 * ```typescript
 * import { streamObject } from 'ai';
 * import { openai } from '@ai-sdk/openai';
 * import { structured, vercelAIObjectAdapter } from 'l0';
 * import { z } from 'zod';
 *
 * const schema = z.object({
 *   name: z.string(),
 *   age: z.number(),
 * });
 *
 * const result = await structured({
 *   schema,
 *   stream: () => streamObject({
 *     model: openai('gpt-4o'),
 *     prompt: 'Generate a random person',
 *     schema,
 *   }),
 *   adapter: vercelAIObjectAdapter,
 * });
 *
 * console.log(result.data); // { name: "Alice", age: 30 }
 * ```
 */
export const vercelAIObjectAdapter: L0Adapter<
  VercelStreamObjectResult,
  VercelAIObjectAdapterOptions
> = {
  name: "vercel-ai-object",
  detect: isVercelAIObjectStream,
  wrap: wrapVercelAIObjectStream,
};

// Auto-register for detection when this module is imported
// Register BEFORE vercel-ai adapter so it gets priority for streamObject() results
import { registerAdapter, unregisterAdapter } from "./registry";
try {
  // Ensure this adapter is registered first for proper priority
  // If vercel-ai is already registered, we need to re-register it after us
  const vercelAIWasRegistered = unregisterAdapter("vercel-ai");

  registerAdapter(vercelAIObjectAdapter, { silent: true });

  // Re-register vercel-ai after us if it was registered
  if (vercelAIWasRegistered) {
    // Import dynamically to avoid circular dependency issues
    import("./vercel-ai").then(({ vercelAIAdapter }) => {
      try {
        registerAdapter(vercelAIAdapter, { silent: true });
      } catch {
        // Already registered, ignore
      }
    });
  }
} catch {
  // Already registered, ignore
}
