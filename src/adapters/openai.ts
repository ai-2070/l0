// OpenAI SDK adapter for L0
// Allows using OpenAI SDK directly instead of Vercel AI SDK
//
// This adapter works with the `openai` package.
// Install it with: npm install openai

import type { L0Event } from "../types/l0";
import type OpenAI from "openai";
import type { Stream } from "openai/streaming";
import type {
  ChatCompletionChunk,
  ChatCompletionCreateParamsStreaming,
  ChatCompletionTool,
  ChatCompletionMessageParam,
} from "openai/resources/chat/completions";

/**
 * Options for wrapping OpenAI streams
 */
export interface OpenAIAdapterOptions {
  /**
   * Include usage information in done event
   * @default true
   */
  includeUsage?: boolean;

  /**
   * Include tool calls as events
   * @default true
   */
  includeToolCalls?: boolean;

  /**
   * Emit function call content as tokens
   * @default false
   */
  emitFunctionCallsAsTokens?: boolean;

  /**
   * Which choice index to use when n > 1
   * Set to 'all' to emit events for all choices (prefixed with choice index)
   * @default 0
   */
  choiceIndex?: number | "all";
}

/**
 * Wrap an OpenAI SDK stream for use with L0
 *
 * Works with streams from `openai.chat.completions.create({ stream: true })`
 *
 * @param stream - OpenAI streaming response (Stream<ChatCompletionChunk>)
 * @param options - Adapter options
 * @returns Async generator of L0 events
 *
 * @example
 * ```typescript
 * import OpenAI from 'openai';
 * import { l0, wrapOpenAIStream } from 'l0';
 *
 * const openai = new OpenAI();
 *
 * const result = await l0({
 *   stream: async () => {
 *     const stream = await openai.chat.completions.create({
 *       model: 'gpt-4o',
 *       messages: [{ role: 'user', content: 'Hello!' }],
 *       stream: true
 *     });
 *     return wrapOpenAIStream(stream);
 *   }
 * });
 * ```
 */
export async function* wrapOpenAIStream(
  stream: Stream<ChatCompletionChunk> | AsyncIterable<ChatCompletionChunk>,
  options: OpenAIAdapterOptions = {},
): AsyncGenerator<L0Event> {
  const {
    includeUsage = true,
    includeToolCalls = true,
    emitFunctionCallsAsTokens = false,
    choiceIndex = 0,
  } = options;

  let usage: ChatCompletionChunk["usage"];

  // Track state per choice index for n > 1 scenarios
  const choiceState = new Map<
    number,
    {
      functionCallAccumulator: { name: string; arguments: string } | null;
      toolCallsAccumulator: Map<
        number,
        { id: string; name: string; arguments: string }
      >;
      finished: boolean;
    }
  >();

  const getChoiceState = (index: number) => {
    if (!choiceState.has(index)) {
      choiceState.set(index, {
        functionCallAccumulator: null,
        toolCallsAccumulator: new Map(),
        finished: false,
      });
    }
    return choiceState.get(index)!;
  };

  try {
    for await (const chunk of stream) {
      // Handle OpenAI ChatCompletionChunk format
      const choices = chunk.choices;
      if (!choices || choices.length === 0) {
        continue;
      }

      // Store usage if available
      if (chunk.usage) {
        usage = chunk.usage;
      }

      // Process each choice
      for (const choice of choices) {
        if (!choice) continue;

        const idx = choice.index;

        // Skip if not the requested choice index (unless 'all')
        if (choiceIndex !== "all" && idx !== choiceIndex) {
          continue;
        }

        const state = getChoiceState(idx);
        const delta = choice.delta;
        if (!delta) continue;

        // Prefix for multi-choice scenarios
        const choicePrefix =
          choiceIndex === "all" && choices.length > 1 ? `[choice:${idx}]` : "";

        // Handle text content
        if (delta.content) {
          yield {
            type: "token",
            value: choicePrefix
              ? `${choicePrefix}${delta.content}`
              : delta.content,
            timestamp: Date.now(),
          };
        }

        // Handle function calls (legacy)
        if (delta.function_call) {
          if (delta.function_call.name) {
            state.functionCallAccumulator = {
              name: delta.function_call.name,
              arguments: delta.function_call.arguments || "",
            };
          } else if (
            delta.function_call.arguments &&
            state.functionCallAccumulator
          ) {
            state.functionCallAccumulator.arguments +=
              delta.function_call.arguments;
          }

          // Emit function call arguments as tokens (independent of includeToolCalls)
          if (emitFunctionCallsAsTokens && delta.function_call.arguments) {
            yield {
              type: "token",
              value: delta.function_call.arguments,
              timestamp: Date.now(),
            };
          }
        }

        // Handle tool calls - always track them for emitFunctionCallsAsTokens
        if (delta.tool_calls) {
          for (const toolCall of delta.tool_calls) {
            const existing = state.toolCallsAccumulator.get(toolCall.index);

            if (toolCall.id || toolCall.function?.name) {
              // New tool call
              state.toolCallsAccumulator.set(toolCall.index, {
                id: toolCall.id || existing?.id || "",
                name: toolCall.function?.name || existing?.name || "",
                arguments: toolCall.function?.arguments || "",
              });
            } else if (toolCall.function?.arguments && existing) {
              // Append to existing tool call
              existing.arguments += toolCall.function.arguments;
            }

            // Emit tool call arguments as tokens (independent of includeToolCalls)
            if (emitFunctionCallsAsTokens && toolCall.function?.arguments) {
              yield {
                type: "token",
                value: toolCall.function.arguments,
                timestamp: Date.now(),
              };
            }
          }
        }

        // Handle finish reason
        if (choice.finish_reason && !state.finished) {
          state.finished = true;

          // Emit function call as message if present
          if (state.functionCallAccumulator && includeToolCalls) {
            yield {
              type: "message",
              value: JSON.stringify({
                type: "function_call",
                function_call: state.functionCallAccumulator,
                ...(choiceIndex === "all" ? { choiceIndex: idx } : {}),
              }),
              role: "assistant",
              timestamp: Date.now(),
            };
          }

          // Emit tool calls as message if present
          if (state.toolCallsAccumulator.size > 0 && includeToolCalls) {
            const toolCalls = Array.from(state.toolCallsAccumulator.values());
            yield {
              type: "message",
              value: JSON.stringify({
                type: "tool_calls",
                tool_calls: toolCalls,
                ...(choiceIndex === "all" ? { choiceIndex: idx } : {}),
              }),
              role: "assistant",
              timestamp: Date.now(),
            };
          }
        }
      }
    }

    // Emit done event with usage (once, after all choices processed)
    yield {
      type: "done",
      timestamp: Date.now(),
      ...(includeUsage && usage ? { usage } : {}),
    } as L0Event;
  } catch (error) {
    yield {
      type: "error",
      error: error instanceof Error ? error : new Error(String(error)),
      timestamp: Date.now(),
    };
  }
}

/**
 * Create a stream factory for OpenAI SDK
 *
 * @param client - OpenAI client instance (from `new OpenAI()`)
 * @param params - Chat completion parameters (stream: true is added automatically)
 * @param options - Adapter options
 * @returns Stream factory function for use with L0
 *
 * @example
 * ```typescript
 * import OpenAI from 'openai';
 * import { l0, openaiStream } from 'l0';
 *
 * const openai = new OpenAI();
 *
 * const result = await l0({
 *   stream: openaiStream(openai, {
 *     model: 'gpt-4o',
 *     messages: [{ role: 'user', content: 'Hello!' }]
 *   })
 * });
 * ```
 */
export function openaiStream(
  client: OpenAI,
  params: Omit<ChatCompletionCreateParamsStreaming, "stream">,
  options?: OpenAIAdapterOptions,
): () => Promise<AsyncGenerator<L0Event>> {
  return async () => {
    const stream = await client.chat.completions.create({
      ...params,
      stream: true,
    });
    return wrapOpenAIStream(stream, options);
  };
}

/**
 * Create a simple text stream from OpenAI
 *
 * @param client - OpenAI client instance
 * @param model - Model name
 * @param prompt - User prompt (string or messages array)
 * @param options - Additional options
 * @returns Stream factory function for use with L0
 *
 * @example
 * ```typescript
 * import OpenAI from 'openai';
 * import { l0, openaiText } from 'l0';
 *
 * const openai = new OpenAI();
 *
 * const result = await l0({
 *   stream: openaiText(openai, 'gpt-4o', 'Write a haiku about coding')
 * });
 * ```
 */
export function openaiText(
  client: OpenAI,
  model: string,
  prompt: string | ChatCompletionMessageParam[],
  options?: Omit<
    ChatCompletionCreateParamsStreaming,
    "model" | "messages" | "stream"
  > &
    OpenAIAdapterOptions,
): () => Promise<AsyncGenerator<L0Event>> {
  const messages: ChatCompletionMessageParam[] =
    typeof prompt === "string" ? [{ role: "user", content: prompt }] : prompt;

  const {
    includeUsage,
    includeToolCalls,
    emitFunctionCallsAsTokens,
    ...chatParams
  } = options || {};

  return openaiStream(
    client,
    { model, messages, ...chatParams },
    { includeUsage, includeToolCalls, emitFunctionCallsAsTokens },
  );
}

/**
 * Create a JSON output stream from OpenAI
 *
 * @param client - OpenAI client instance
 * @param model - Model name
 * @param prompt - User prompt
 * @param options - Additional options
 * @returns Stream factory function for use with L0
 *
 * @example
 * ```typescript
 * import OpenAI from 'openai';
 * import { structured, openaiJSON } from 'l0';
 * import { z } from 'zod';
 *
 * const openai = new OpenAI();
 *
 * const result = await structured({
 *   schema: z.object({ name: z.string(), age: z.number() }),
 *   stream: openaiJSON(openai, 'gpt-4o', 'Generate user data')
 * });
 * ```
 */
export function openaiJSON(
  client: OpenAI,
  model: string,
  prompt: string | ChatCompletionMessageParam[],
  options?: Omit<
    ChatCompletionCreateParamsStreaming,
    "model" | "messages" | "stream" | "response_format"
  > &
    OpenAIAdapterOptions,
): () => Promise<AsyncGenerator<L0Event>> {
  const messages: ChatCompletionMessageParam[] =
    typeof prompt === "string" ? [{ role: "user", content: prompt }] : prompt;

  const {
    includeUsage,
    includeToolCalls,
    emitFunctionCallsAsTokens,
    ...chatParams
  } = options || {};

  return openaiStream(
    client,
    {
      model,
      messages,
      response_format: { type: "json_object" },
      ...chatParams,
    },
    { includeUsage, includeToolCalls, emitFunctionCallsAsTokens },
  );
}

/**
 * Adapter for using OpenAI with tool/function calling
 *
 * @param client - OpenAI client instance
 * @param model - Model name
 * @param messages - Messages array
 * @param tools - Tool definitions
 * @param options - Additional options
 * @returns Stream factory function for use with L0
 *
 * @example
 * ```typescript
 * import OpenAI from 'openai';
 * import { l0, openaiWithTools } from 'l0';
 *
 * const openai = new OpenAI();
 *
 * const result = await l0({
 *   stream: openaiWithTools(openai, 'gpt-4o', messages, [
 *     {
 *       type: 'function',
 *       function: {
 *         name: 'get_weather',
 *         description: 'Get weather for a location',
 *         parameters: {
 *           type: 'object',
 *           properties: { location: { type: 'string' } },
 *           required: ['location']
 *         }
 *       }
 *     }
 *   ])
 * });
 * ```
 */
export function openaiWithTools(
  client: OpenAI,
  model: string,
  messages: ChatCompletionMessageParam[],
  tools: ChatCompletionTool[],
  options?: Omit<
    ChatCompletionCreateParamsStreaming,
    "model" | "messages" | "stream" | "tools"
  > &
    OpenAIAdapterOptions,
): () => Promise<AsyncGenerator<L0Event>> {
  const {
    includeUsage,
    includeToolCalls,
    emitFunctionCallsAsTokens,
    ...chatParams
  } = options || {};

  return openaiStream(
    client,
    { model, messages, tools, ...chatParams },
    {
      includeUsage,
      includeToolCalls: includeToolCalls ?? true,
      emitFunctionCallsAsTokens,
    },
  );
}

/**
 * Type guard to check if an object is an OpenAI ChatCompletionChunk
 */
export function isOpenAIChunk(obj: unknown): obj is ChatCompletionChunk {
  if (!obj || typeof obj !== "object" || !("choices" in obj)) {
    return false;
  }
  const chunk = obj as ChatCompletionChunk;
  if (!Array.isArray(chunk.choices) || chunk.choices.length === 0) {
    return false;
  }
  const firstChoice = chunk.choices[0];
  return firstChoice !== undefined && "delta" in firstChoice;
}

/**
 * Extract text content from an OpenAI stream
 */
export async function extractOpenAIText(
  stream: Stream<ChatCompletionChunk> | AsyncIterable<ChatCompletionChunk>,
): Promise<string> {
  let text = "";
  for await (const chunk of stream) {
    const content = chunk.choices?.[0]?.delta?.content;
    if (content) {
      text += content;
    }
  }
  return text;
}

// Re-export useful OpenAI types for convenience
export type {
  ChatCompletionChunk,
  ChatCompletionCreateParamsStreaming,
  ChatCompletionTool,
  ChatCompletionMessageParam,
};
