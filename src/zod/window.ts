// Zod schemas for L0 Window types

import { z } from "zod4";
import type {
  WindowOptions,
  ChunkStrategy,
  DocumentChunk,
  DocumentWindow,
  WindowProcessResult,
  WindowStats,
  ContextRestorationOptions,
  ContextRestorationStrategy,
  L0WindowOptions,
  WindowPreset,
} from "../types/window";
import { L0OptionsSchema, L0ResultSchema } from "./l0";

/**
 * Chunk strategy schema
 */
export const ChunkStrategySchema = z.enum([
  "token",
  "char",
  "paragraph",
  "sentence",
]) satisfies z.ZodType<ChunkStrategy>;

/**
 * Context restoration strategy schema
 */
export const ContextRestorationStrategySchema = z.enum([
  "adjacent",
  "overlap",
  "full",
]) satisfies z.ZodType<ContextRestorationStrategy>;

/**
 * Window options schema
 */
export const WindowOptionsSchema = z.object({
  size: z.number().optional(),
  overlap: z.number().optional(),
  strategy: ChunkStrategySchema.optional(),
  estimateTokens: z.function().args(z.string()).returns(z.number()).optional(),
  preserveParagraphs: z.boolean().optional(),
  preserveSentences: z.boolean().optional(),
  metadata: z.record(z.any()).optional(),
}) satisfies z.ZodType<WindowOptions>;

/**
 * Document chunk schema
 */
export const DocumentChunkSchema = z.object({
  index: z.number(),
  content: z.string(),
  startPos: z.number(),
  endPos: z.number(),
  tokenCount: z.number(),
  charCount: z.number(),
  isFirst: z.boolean(),
  isLast: z.boolean(),
  totalChunks: z.number(),
  metadata: z.record(z.any()).optional(),
}) satisfies z.ZodType<DocumentChunk>;

/**
 * Window process result schema
 */
export const WindowProcessResultSchema = z.object({
  chunk: DocumentChunkSchema,
  result: L0ResultSchema.optional(),
  status: z.enum(["success", "error"]),
  error: z.instanceof(Error).optional(),
  duration: z.number(),
}) satisfies z.ZodType<WindowProcessResult>;

/**
 * Window stats schema
 */
export const WindowStatsSchema = z.object({
  totalChunks: z.number(),
  totalChars: z.number(),
  totalTokens: z.number(),
  avgChunkSize: z.number(),
  avgChunkTokens: z.number(),
  overlapSize: z.number(),
  strategy: ChunkStrategySchema,
}) satisfies z.ZodType<WindowStats>;

/**
 * Document window schema
 * Note: This is an interface with methods, so we use a partial validation
 */
export const DocumentWindowSchema = z.object({
  document: z.string(),
  totalChunks: z.number(),
  currentIndex: z.number(),
  options: WindowOptionsSchema.required(),
  get: z.function().args(z.number()).returns(DocumentChunkSchema.nullable()),
  current: z.function().returns(DocumentChunkSchema.nullable()),
  next: z.function().returns(DocumentChunkSchema.nullable()),
  prev: z.function().returns(DocumentChunkSchema.nullable()),
  jump: z.function().args(z.number()).returns(DocumentChunkSchema.nullable()),
  reset: z.function().returns(DocumentChunkSchema.nullable()),
  getAllChunks: z.function().returns(z.array(DocumentChunkSchema)),
  getRange: z
    .function()
    .args(z.number(), z.number())
    .returns(z.array(DocumentChunkSchema)),
  hasNext: z.function().returns(z.boolean()),
  hasPrev: z.function().returns(z.boolean()),
  processAll: z
    .function()
    .args(z.any())
    .returns(z.promise(z.array(WindowProcessResultSchema))),
  processSequential: z
    .function()
    .args(z.any())
    .returns(z.promise(z.array(WindowProcessResultSchema))),
  processParallel: z
    .function()
    .args(z.any(), z.any().optional())
    .returns(z.promise(z.array(WindowProcessResultSchema))),
  getStats: z.function().returns(WindowStatsSchema),
}) satisfies z.ZodType<DocumentWindow>;

/**
 * Context restoration options schema
 */
export const ContextRestorationOptionsSchema = z.object({
  enabled: z.boolean().optional(),
  strategy: ContextRestorationStrategySchema.optional(),
  maxAttempts: z.number().optional(),
  onRestore: z
    .function()
    .args(z.number(), z.number())
    .returns(z.void())
    .optional(),
}) satisfies z.ZodType<ContextRestorationOptions>;

/**
 * L0 window options schema (extends L0Options)
 */
export const L0WindowOptionsSchema = L0OptionsSchema.extend({
  window: DocumentWindowSchema.optional(),
  chunkIndex: z.number().optional(),
  contextRestoration: ContextRestorationOptionsSchema.optional(),
}) satisfies z.ZodType<L0WindowOptions>;

/**
 * Window preset schema
 */
export const WindowPresetSchema = z.object({
  name: z.string(),
  size: z.number(),
  overlap: z.number(),
  strategy: ChunkStrategySchema,
}) satisfies z.ZodType<WindowPreset>;
