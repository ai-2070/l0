// Zod schemas for L0 Window types

import { z } from "zod4";
import type {
  ChunkStrategy,
  DocumentChunk,
  WindowProcessResult,
  WindowStats,
  ContextRestorationStrategy,
  WindowPreset,
} from "../types/window";
import { L0ResultSchema } from "./l0";

/**
 * Chunk strategy schema
 */
export const ChunkStrategySchema: z.ZodType<ChunkStrategy> = z.enum([
  "token",
  "char",
  "paragraph",
  "sentence",
]);

/**
 * Context restoration strategy schema
 */
export const ContextRestorationStrategySchema: z.ZodType<ContextRestorationStrategy> =
  z.enum(["adjacent", "overlap", "full"]);

/**
 * Window options schema
 * Note: Contains function property - no explicit type annotation
 */
export const WindowOptionsSchema = z.object({
  size: z.number().optional(),
  overlap: z.number().optional(),
  strategy: ChunkStrategySchema.optional(),
  estimateTokens: z.function().optional(),
  preserveParagraphs: z.boolean().optional(),
  preserveSentences: z.boolean().optional(),
  metadata: z.record(z.string(), z.any()).optional(),
});

/**
 * Document chunk schema
 */
export const DocumentChunkSchema: z.ZodType<DocumentChunk> = z.object({
  index: z.number(),
  content: z.string(),
  startPos: z.number(),
  endPos: z.number(),
  tokenCount: z.number(),
  charCount: z.number(),
  isFirst: z.boolean(),
  isLast: z.boolean(),
  totalChunks: z.number(),
  metadata: z.record(z.string(), z.any()).optional(),
});

/**
 * Window process result schema
 */
export const WindowProcessResultSchema: z.ZodType<WindowProcessResult> =
  z.object({
    chunk: DocumentChunkSchema,
    result: L0ResultSchema.optional(),
    status: z.enum(["success", "error"]),
    error: z.instanceof(Error).optional(),
    duration: z.number(),
  });

/**
 * Window stats schema
 */
export const WindowStatsSchema: z.ZodType<WindowStats> = z.object({
  totalChunks: z.number(),
  totalChars: z.number(),
  totalTokens: z.number(),
  avgChunkSize: z.number(),
  avgChunkTokens: z.number(),
  overlapSize: z.number(),
  strategy: ChunkStrategySchema,
});

/**
 * Document window schema
 * Note: This is an interface with methods - no explicit type annotation
 */
export const DocumentWindowSchema = z.object({
  document: z.string(),
  totalChunks: z.number(),
  currentIndex: z.number(),
  options: z.any(), // Required<WindowOptions>
  get: z.function(),
  current: z.function(),
  next: z.function(),
  prev: z.function(),
  jump: z.function(),
  reset: z.function(),
  getAllChunks: z.function(),
  getRange: z.function(),
  hasNext: z.function(),
  hasPrev: z.function(),
  processAll: z.function(),
  processSequential: z.function(),
  processParallel: z.function(),
  getStats: z.function(),
});

/**
 * Context restoration options schema
 * Note: Contains function property - no explicit type annotation
 */
export const ContextRestorationOptionsSchema = z.object({
  enabled: z.boolean().optional(),
  strategy: ContextRestorationStrategySchema.optional(),
  maxAttempts: z.number().optional(),
  onRestore: z.function().optional(),
});

/**
 * L0 window options schema (extends L0Options)
 * Note: Contains function properties - no explicit type annotation
 */
export const L0WindowOptionsSchema = z.object({
  // L0Options fields (simplified - actual L0Options has many function fields)
  __outputType: z.unknown().optional(),
  stream: z.function(),
  context: z.record(z.string(), z.unknown()).optional(),
  fallbackStreams: z.array(z.function()).optional(),
  guardrails: z.array(z.any()).optional(),
  retry: z.any().optional(),
  timeout: z
    .object({
      initialToken: z.number().optional(),
      interToken: z.number().optional(),
    })
    .optional(),
  signal: z.instanceof(AbortSignal).optional(),
  monitoring: z.any().optional(),
  checkIntervals: z.any().optional(),
  detectDrift: z.boolean().optional(),
  detectZeroTokens: z.boolean().optional(),
  continueFromLastKnownGoodToken: z.boolean().optional(),
  buildContinuationPrompt: z.function().optional(),
  deduplicateContinuation: z.boolean().optional(),
  deduplicationOptions: z.any().optional(),
  onStart: z.function().optional(),
  onComplete: z.function().optional(),
  onError: z.function().optional(),
  onEvent: z.function().optional(),
  onViolation: z.function().optional(),
  onRetry: z.function().optional(),
  onFallback: z.function().optional(),
  onResume: z.function().optional(),
  onCheckpoint: z.function().optional(),
  onTimeout: z.function().optional(),
  onAbort: z.function().optional(),
  onDrift: z.function().optional(),
  onToolCall: z.function().optional(),
  interceptors: z.array(z.any()).optional(),
  adapter: z.any().optional(),
  adapterOptions: z.unknown().optional(),
  // L0WindowOptions additions
  window: DocumentWindowSchema.optional(),
  chunkIndex: z.number().optional(),
  contextRestoration: ContextRestorationOptionsSchema.optional(),
});

/**
 * Window preset schema
 */
export const WindowPresetSchema: z.ZodType<WindowPreset> = z.object({
  name: z.string(),
  size: z.number(),
  overlap: z.number(),
  strategy: ChunkStrategySchema,
});
