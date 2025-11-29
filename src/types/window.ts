// Types for L0 Document Window API

import type { L0Options, L0Result } from "./l0";

/**
 * Options for creating a document window
 */
export interface WindowOptions {
  /**
   * Size of each chunk (in tokens or characters)
   * @default 2000
   */
  size?: number;

  /**
   * Overlap between chunks (in tokens or characters)
   * @default 200
   */
  overlap?: number;

  /**
   * Chunking strategy
   * @default 'token'
   */
  strategy?: ChunkStrategy;

  /**
   * Custom token estimator function
   * If not provided, uses rough estimate (1 token ≈ 4 chars)
   */
  estimateTokens?: (text: string) => number;

  /**
   * Preserve paragraph boundaries when chunking
   * @default true
   */
  preserveParagraphs?: boolean;

  /**
   * Preserve sentence boundaries when chunking
   * @default false
   */
  preserveSentences?: boolean;

  /**
   * Custom metadata to attach to each chunk
   */
  metadata?: Record<string, any>;
}

/**
 * Chunking strategy
 */
export type ChunkStrategy =
  | "token" // Chunk by estimated token count
  | "char" // Chunk by character count
  | "paragraph" // Chunk by paragraphs (with max size)
  | "sentence"; // Chunk by sentences (with max size)

/**
 * A single document chunk
 */
export interface DocumentChunk {
  /**
   * Chunk index (0-based)
   */
  index: number;

  /**
   * Content of the chunk
   */
  content: string;

  /**
   * Start position in original document (character index)
   */
  startPos: number;

  /**
   * End position in original document (character index)
   */
  endPos: number;

  /**
   * Estimated token count
   */
  tokenCount: number;

  /**
   * Character count
   */
  charCount: number;

  /**
   * Whether this is the first chunk
   */
  isFirst: boolean;

  /**
   * Whether this is the last chunk
   */
  isLast: boolean;

  /**
   * Total number of chunks
   */
  totalChunks: number;

  /**
   * Custom metadata
   */
  metadata?: Record<string, any>;
}

/**
 * Document window for managing chunked documents
 */
export interface DocumentWindow {
  /**
   * Original document text
   */
  readonly document: string;

  /**
   * Total number of chunks
   */
  readonly totalChunks: number;

  /**
   * Current chunk index
   */
  readonly currentIndex: number;

  /**
   * Window options
   */
  readonly options: Required<WindowOptions>;

  /**
   * Get a specific chunk by index
   */
  get(index: number): DocumentChunk | null;

  /**
   * Get current chunk
   */
  current(): DocumentChunk | null;

  /**
   * Move to next chunk
   */
  next(): DocumentChunk | null;

  /**
   * Move to previous chunk
   */
  prev(): DocumentChunk | null;

  /**
   * Jump to specific chunk
   */
  jump(index: number): DocumentChunk | null;

  /**
   * Reset to first chunk
   */
  reset(): DocumentChunk | null;

  /**
   * Get all chunks
   */
  getAllChunks(): DocumentChunk[];

  /**
   * Get a range of chunks
   */
  getRange(start: number, end: number): DocumentChunk[];

  /**
   * Check if has next chunk
   */
  hasNext(): boolean;

  /**
   * Check if has previous chunk
   */
  hasPrev(): boolean;

  /**
   * Process all chunks with L0
   */
  processAll(
    processFn: (chunk: DocumentChunk) => L0Options,
  ): Promise<WindowProcessResult[]>;

  /**
   * Process chunks sequentially
   */
  processSequential(
    processFn: (chunk: DocumentChunk) => L0Options,
  ): Promise<WindowProcessResult[]>;

  /**
   * Process chunks in parallel with concurrency control
   */
  processParallel(
    processFn: (chunk: DocumentChunk) => L0Options,
    options?: { concurrency?: number },
  ): Promise<WindowProcessResult[]>;

  /**
   * Get window statistics
   */
  getStats(): WindowStats;
}

/**
 * Result from processing a chunk
 */
export interface WindowProcessResult {
  /**
   * Chunk that was processed
   */
  chunk: DocumentChunk;

  /**
   * L0 result (undefined on error)
   */
  result?: L0Result;

  /**
   * Processing status
   */
  status: "success" | "error";

  /**
   * Error if processing failed
   */
  error?: Error;

  /**
   * Duration in milliseconds
   */
  duration: number;
}

/**
 * Window statistics
 */
export interface WindowStats {
  /**
   * Total chunks
   */
  totalChunks: number;

  /**
   * Total document length (characters)
   */
  totalChars: number;

  /**
   * Estimated total tokens
   */
  totalTokens: number;

  /**
   * Average chunk size (characters)
   */
  avgChunkSize: number;

  /**
   * Average chunk tokens
   */
  avgChunkTokens: number;

  /**
   * Overlap size (characters)
   */
  overlapSize: number;

  /**
   * Chunking strategy used
   */
  strategy: ChunkStrategy;
}

/**
 * Options for context restoration on drift
 */
export interface ContextRestorationOptions {
  /**
   * Enable automatic context restoration on drift
   * @default true
   */
  enabled?: boolean;

  /**
   * Strategy for context restoration
   * @default 'adjacent'
   */
  strategy?: ContextRestorationStrategy;

  /**
   * Maximum number of context restoration attempts
   * @default 2
   */
  maxAttempts?: number;

  /**
   * Callback when context is restored
   */
  onRestore?: (from: number, to: number) => void;
}

/**
 * Context restoration strategy
 */
export type ContextRestorationStrategy =
  | "adjacent" // Try adjacent chunks (prev/next)
  | "overlap" // Try chunks with more overlap
  | "full"; // Retry with full surrounding context

/**
 * Options for L0 with document window integration
 */
export interface L0WindowOptions extends L0Options {
  /**
   * Document window to use
   */
  window?: DocumentWindow;

  /**
   * Chunk index to use (if window provided)
   */
  chunkIndex?: number;

  /**
   * Context restoration options
   */
  contextRestoration?: ContextRestorationOptions;
}

/**
 * Preset window configurations
 */
export interface WindowPreset {
  name: string;
  size: number;
  overlap: number;
  strategy: ChunkStrategy;
}

/**
 * Small documents preset (articles, emails)
 */
export const smallWindow: WindowPreset = {
  name: "small",
  size: 1000,
  overlap: 100,
  strategy: "token",
};

/**
 * Medium documents preset (reports, chapters)
 */
export const mediumWindow: WindowPreset = {
  name: "medium",
  size: 2000,
  overlap: 200,
  strategy: "token",
};

/**
 * Large documents preset (books, transcripts)
 */
export const largeWindow: WindowPreset = {
  name: "large",
  size: 4000,
  overlap: 400,
  strategy: "token",
};

/**
 * Paragraph-based preset (structured documents)
 */
export const paragraphWindow: WindowPreset = {
  name: "paragraph",
  size: 2000,
  overlap: 200,
  strategy: "paragraph",
};

/**
 * Sentence-based preset (precise chunking)
 */
export const sentenceWindow: WindowPreset = {
  name: "sentence",
  size: 1500,
  overlap: 150,
  strategy: "sentence",
};
