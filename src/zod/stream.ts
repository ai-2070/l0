// Zod schemas for L0 Stream types

import { z } from "zod4";
import type {
  StreamEvent,
  StreamNormalizerOptions,
  StreamWrapper,
  StreamState,
  StreamChunk,
  StreamErrorType,
  StreamError,
  StreamResumptionState,
} from "../types/stream";

/**
 * Stream event schema
 */
export const StreamEventSchema: z.ZodType<StreamEvent> = z.object({
  type: z.enum(["text-delta", "finish", "error", "content-delta", "tool-call"]),
  textDelta: z.string().optional(),
  finishReason: z.string().optional(),
  error: z.instanceof(Error).optional(),
  content: z.string().optional(),
  toolCall: z.any().optional(),
});

/**
 * Stream normalizer options schema
 */
export const StreamNormalizerOptionsSchema: z.ZodType<StreamNormalizerOptions> =
  z.object({
    accumulate: z.boolean().optional(),
    checkpoint: z.boolean().optional(),
    checkpointInterval: z.number().optional(),
  });

/**
 * Stream wrapper schema
 */
export const StreamWrapperSchema: z.ZodType<StreamWrapper> = z.object({
  stream: z.any(), // AsyncIterable<any>
  signal: z.instanceof(AbortSignal).optional(),
  initialTimeout: z.number().optional(),
  interTokenTimeout: z.number().optional(),
});

/**
 * Stream state schema
 */
export const StreamStateSchema: z.ZodType<StreamState> = z.object({
  started: z.boolean(),
  firstTokenReceived: z.boolean(),
  startTime: z.number().optional(),
  firstTokenTime: z.number().optional(),
  lastTokenTime: z.number().optional(),
  tokenCount: z.number(),
  complete: z.boolean(),
  aborted: z.boolean(),
  error: z.instanceof(Error).optional(),
});

/**
 * Stream chunk schema
 */
export const StreamChunkSchema: z.ZodType<StreamChunk> = z.object({
  content: z.string(),
  done: z.boolean(),
  timestamp: z.number(),
  accumulated: z.string().optional(),
  index: z.number(),
});

/**
 * Stream handler schema
 * Note: Function type - no explicit type annotation
 */
export const StreamHandlerSchema = z.function();

/**
 * Stream error type schema
 */
export const StreamErrorTypeSchema: z.ZodType<StreamErrorType> = z.enum([
  "timeout",
  "abort",
  "network",
  "parse",
  "unknown",
]);

/**
 * Stream error schema
 * Note: StreamError extends Error, so we validate the properties
 */
export const StreamErrorSchema: z.ZodType<StreamError> = z.object({
  name: z.string(),
  message: z.string(),
  stack: z.string().optional(),
  type: StreamErrorTypeSchema,
  recoverable: z.boolean(),
  timestamp: z.number(),
});

/**
 * Stream resumption state schema
 */
export const StreamResumptionStateSchema: z.ZodType<StreamResumptionState> =
  z.object({
    lastContent: z.string(),
    lastTokenIndex: z.number(),
    lastTokenTime: z.number(),
    canResume: z.boolean(),
  });
