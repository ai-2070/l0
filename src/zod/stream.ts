// Zod schemas for L0 Stream types

import { z } from "zod4";
import type {
  StreamEvent,
  StreamNormalizerOptions,
  StreamWrapper,
  StreamState,
  StreamChunk,
  StreamHandler,
  StreamErrorType,
  StreamError,
  StreamResumptionState,
} from "../types/stream";

/**
 * Stream event schema
 */
export const StreamEventSchema = z.object({
  type: z.enum(["text-delta", "finish", "error", "content-delta", "tool-call"]),
  textDelta: z.string().optional(),
  finishReason: z.string().optional(),
  error: z.instanceof(Error).optional(),
  content: z.string().optional(),
  toolCall: z.any().optional(),
}) satisfies z.ZodType<StreamEvent>;

/**
 * Stream normalizer options schema
 */
export const StreamNormalizerOptionsSchema = z.object({
  accumulate: z.boolean().optional(),
  checkpoint: z.boolean().optional(),
  checkpointInterval: z.number().optional(),
}) satisfies z.ZodType<StreamNormalizerOptions>;

/**
 * Stream wrapper schema
 */
export const StreamWrapperSchema = z.object({
  stream: z.any(), // AsyncIterable<any>
  signal: z.instanceof(AbortSignal).optional(),
  initialTimeout: z.number().optional(),
  interTokenTimeout: z.number().optional(),
}) satisfies z.ZodType<StreamWrapper>;

/**
 * Stream state schema
 */
export const StreamStateSchema = z.object({
  started: z.boolean(),
  firstTokenReceived: z.boolean(),
  startTime: z.number().optional(),
  firstTokenTime: z.number().optional(),
  lastTokenTime: z.number().optional(),
  tokenCount: z.number(),
  complete: z.boolean(),
  aborted: z.boolean(),
  error: z.instanceof(Error).optional(),
}) satisfies z.ZodType<StreamState>;

/**
 * Stream chunk schema
 */
export const StreamChunkSchema = z.object({
  content: z.string(),
  done: z.boolean(),
  timestamp: z.number(),
  accumulated: z.string().optional(),
  index: z.number(),
}) satisfies z.ZodType<StreamChunk>;

/**
 * Stream handler schema
 */
export const StreamHandlerSchema = z
  .function()
  .args(StreamChunkSchema)
  .returns(
    z.union([z.void(), z.promise(z.void())]),
  ) satisfies z.ZodType<StreamHandler>;

/**
 * Stream error type schema
 */
export const StreamErrorTypeSchema = z.enum([
  "timeout",
  "abort",
  "network",
  "parse",
  "unknown",
]) satisfies z.ZodType<StreamErrorType>;

/**
 * Stream error schema
 * Note: StreamError extends Error, so we validate the properties
 */
export const StreamErrorSchema = z.object({
  name: z.string(),
  message: z.string(),
  stack: z.string().optional(),
  type: StreamErrorTypeSchema,
  recoverable: z.boolean(),
  timestamp: z.number(),
}) satisfies z.ZodType<StreamError>;

/**
 * Stream resumption state schema
 */
export const StreamResumptionStateSchema = z.object({
  lastContent: z.string(),
  lastTokenIndex: z.number(),
  lastTokenTime: z.number(),
  canResume: z.boolean(),
}) satisfies z.ZodType<StreamResumptionState>;
