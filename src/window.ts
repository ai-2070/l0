// L0 Document Window - Chunking and navigation for long documents

import type {
  WindowOptions,
  DocumentWindow,
  DocumentChunk,
  WindowStats,
  WindowProcessResult,
  L0WindowOptions,
} from "./types/window";
import type { L0Options } from "./types/l0";
import { l0 } from "./runtime/l0";
import {
  chunkDocument,
  estimateTokenCount,
  mergeChunks,
} from "./utils/chunking";

/**
 * Default window options
 */
const DEFAULT_OPTIONS: Required<WindowOptions> = {
  size: 2000,
  overlap: 200,
  strategy: "token",
  estimateTokens: estimateTokenCount,
  preserveParagraphs: true,
  preserveSentences: false,
  metadata: {},
};

/**
 * DocumentWindow implementation
 * Manages chunked documents with navigation and batch processing
 */
export class DocumentWindowImpl implements DocumentWindow {
  public readonly document: string;
  public readonly options: Required<WindowOptions>;
  private chunks: DocumentChunk[];
  private _currentIndex: number = 0;

  constructor(document: string, options: WindowOptions = {}) {
    this.document = document;
    this.options = { ...DEFAULT_OPTIONS, ...options };

    // Generate chunks
    this.chunks = chunkDocument(document, this.options);

    if (this.chunks.length === 0) {
      throw new Error("Document resulted in zero chunks");
    }
  }

  /**
   * Get total number of chunks
   */
  get totalChunks(): number {
    return this.chunks.length;
  }

  /**
   * Get current chunk index
   */
  get currentIndex(): number {
    return this._currentIndex;
  }

  /**
   * Get a specific chunk by index
   */
  get(index: number): DocumentChunk | null {
    if (index < 0 || index >= this.chunks.length) {
      return null;
    }
    return this.chunks[index] ?? null;
  }

  /**
   * Get current chunk
   */
  current(): DocumentChunk | null {
    return this.get(this._currentIndex);
  }

  /**
   * Move to next chunk
   */
  next(): DocumentChunk | null {
    if (this._currentIndex < this.chunks.length - 1) {
      this._currentIndex++;
      return this.current();
    }
    return null;
  }

  /**
   * Move to previous chunk
   */
  prev(): DocumentChunk | null {
    if (this._currentIndex > 0) {
      this._currentIndex--;
      return this.current();
    }
    return null;
  }

  /**
   * Jump to specific chunk
   */
  jump(index: number): DocumentChunk | null {
    if (index < 0 || index >= this.chunks.length) {
      return null;
    }
    this._currentIndex = index;
    return this.current();
  }

  /**
   * Reset to first chunk
   */
  reset(): DocumentChunk | null {
    this._currentIndex = 0;
    return this.current();
  }

  /**
   * Get all chunks
   */
  getAllChunks(): DocumentChunk[] {
    return [...this.chunks];
  }

  /**
   * Get a range of chunks
   */
  getRange(start: number, end: number): DocumentChunk[] {
    const validStart = Math.max(0, start);
    const validEnd = Math.min(this.chunks.length, end);
    return this.chunks.slice(validStart, validEnd);
  }

  /**
   * Check if has next chunk
   */
  hasNext(): boolean {
    return this._currentIndex < this.chunks.length - 1;
  }

  /**
   * Check if has previous chunk
   */
  hasPrev(): boolean {
    return this._currentIndex > 0;
  }

  /**
   * Process all chunks with L0 (parallel by default)
   */
  async processAll(
    processFn: (chunk: DocumentChunk) => L0Options,
  ): Promise<WindowProcessResult[]> {
    return this.processParallel(processFn);
  }

  /**
   * Process chunks sequentially (one at a time)
   */
  async processSequential(
    processFn: (chunk: DocumentChunk) => L0Options,
  ): Promise<WindowProcessResult[]> {
    const results: WindowProcessResult[] = [];

    for (const chunk of this.chunks) {
      const startTime = Date.now();

      try {
        const options = processFn(chunk);
        const result = await l0(options);

        // Consume stream
        for await (const _event of result.stream) {
          // Process events if needed
        }

        results.push({
          chunk,
          result,
          status: "success",
          duration: Date.now() - startTime,
        });
      } catch (error) {
        results.push({
          chunk,
          result: null as any,
          status: "error",
          error: error instanceof Error ? error : new Error(String(error)),
          duration: Date.now() - startTime,
        });
      }
    }

    return results;
  }

  /**
   * Process chunks in parallel with concurrency control
   */
  async processParallel(
    processFn: (chunk: DocumentChunk) => L0Options,
    options: { concurrency?: number } = {},
  ): Promise<WindowProcessResult[]> {
    const { concurrency = 5 } = options;
    const results: WindowProcessResult[] = new Array(this.chunks.length);
    const queue = [...this.chunks];
    let activeCount = 0;
    let index = 0;

    return new Promise((resolve, _reject) => {
      const processNext = () => {
        while (activeCount < concurrency && queue.length > 0) {
          const chunk = queue.shift()!;
          const chunkIndex = index++;
          activeCount++;

          const startTime = Date.now();

          (async () => {
            try {
              const l0Options = processFn(chunk);
              const result = await l0(l0Options);

              // Consume stream
              for await (const _event of result.stream) {
                // Process events if needed
              }

              results[chunkIndex] = {
                chunk,
                result,
                status: "success",
                duration: Date.now() - startTime,
              };
            } catch (error) {
              results[chunkIndex] = {
                chunk,
                result: null as any,
                status: "error",
                error:
                  error instanceof Error ? error : new Error(String(error)),
                duration: Date.now() - startTime,
              };
            } finally {
              activeCount--;
              if (queue.length > 0) {
                processNext();
              } else if (activeCount === 0) {
                resolve(results);
              }
            }
          })();
        }
      };

      processNext();
    });
  }

  /**
   * Get window statistics
   */
  getStats(): WindowStats {
    const totalChars = this.document.length;
    const totalTokens = this.options.estimateTokens(this.document);
    const avgChunkSize =
      this.chunks.reduce((sum, c) => sum + c.charCount, 0) / this.chunks.length;
    const avgChunkTokens =
      this.chunks.reduce((sum, c) => sum + c.tokenCount, 0) /
      this.chunks.length;

    return {
      totalChunks: this.chunks.length,
      totalChars,
      totalTokens,
      avgChunkSize: Math.round(avgChunkSize),
      avgChunkTokens: Math.round(avgChunkTokens),
      overlapSize: this.options.overlap,
      strategy: this.options.strategy,
    };
  }

  /**
   * Get context for a chunk with optional surrounding context
   */
  getContext(
    index: number,
    options: { before?: number; after?: number } = {},
  ): string {
    const { before = 0, after = 0 } = options;

    const start = Math.max(0, index - before);
    const end = Math.min(this.chunks.length, index + after + 1);

    const contextChunks = this.chunks.slice(start, end);
    return mergeChunks(contextChunks, false);
  }

  /**
   * Find chunks containing specific text
   */
  findChunks(
    searchText: string,
    caseSensitive: boolean = false,
  ): DocumentChunk[] {
    const search = caseSensitive ? searchText : searchText.toLowerCase();

    return this.chunks.filter((chunk) => {
      const content = caseSensitive
        ? chunk.content
        : chunk.content.toLowerCase();
      return content.includes(search);
    });
  }

  /**
   * Get chunks within a character range
   */
  getChunksInRange(startPos: number, endPos: number): DocumentChunk[] {
    return this.chunks.filter(
      (chunk) =>
        (chunk.startPos >= startPos && chunk.startPos < endPos) ||
        (chunk.endPos > startPos && chunk.endPos <= endPos) ||
        (chunk.startPos <= startPos && chunk.endPos >= endPos),
    );
  }
}

/**
 * Create a document window
 *
 * @param document - Full document text
 * @param options - Window options
 * @returns DocumentWindow instance
 *
 * @example
 * ```typescript
 * const window = createWindow(document, {
 *   size: 2000,
 *   overlap: 200,
 *   strategy: 'token'
 * });
 *
 * // Navigate chunks
 * console.log(window.current());
 * window.next();
 * console.log(window.current());
 * ```
 */
export function createWindow(
  document: string,
  options?: WindowOptions,
): DocumentWindow {
  return new DocumentWindowImpl(document, options);
}

/**
 * Process a document with L0 using a sliding window
 *
 * @param document - Document to process
 * @param processFn - Function to process each chunk
 * @param options - Window options
 * @returns Array of process results
 *
 * @example
 * ```typescript
 * const results = await processWithWindow(
 *   document,
 *   (chunk) => ({
 *     stream: () => streamText({
 *       model,
 *       prompt: `Summarize: ${chunk.content}`
 *     })
 *   }),
 *   { size: 2000, overlap: 200 }
 * );
 * ```
 */
export async function processWithWindow(
  document: string,
  processFn: (chunk: DocumentChunk) => L0Options,
  options?: WindowOptions,
): Promise<WindowProcessResult[]> {
  const window = createWindow(document, options);
  return window.processAll(processFn);
}

/**
 * Process a document with L0 and context restoration on drift
 *
 * @param document - Document to process
 * @param options - L0 window options with context restoration
 * @returns L0 result
 *
 * @example
 * ```typescript
 * const result = await l0WithWindow({
 *   window: createWindow(document, { size: 2000 }),
 *   chunkIndex: 0,
 *   stream: () => streamText({ model, prompt }),
 *   contextRestoration: {
 *     enabled: true,
 *     strategy: 'adjacent'
 *   }
 * });
 * ```
 */
export async function l0WithWindow(options: L0WindowOptions) {
  const { window, chunkIndex = 0, contextRestoration, ...l0Options } = options;

  if (!window) {
    throw new Error("Window is required");
  }

  const chunk = window.get(chunkIndex);
  if (!chunk) {
    throw new Error(`Invalid chunk index: ${chunkIndex}`);
  }

  // Context restoration logic
  const {
    enabled = true,
    strategy = "adjacent",
    maxAttempts = 2,
    onRestore,
  } = contextRestoration || {};

  let currentChunkIndex = chunkIndex;
  let attempts = 0;

  while (attempts <= maxAttempts) {
    try {
      const result = await l0(l0Options);

      // Check for drift in result
      if (result.state.driftDetected && enabled && attempts < maxAttempts) {
        // Try context restoration
        let nextChunkIndex: number | null = null;

        switch (strategy) {
          case "adjacent":
            // Try next chunk, then previous
            if (window.hasNext()) {
              nextChunkIndex = currentChunkIndex + 1;
            } else if (currentChunkIndex > 0) {
              nextChunkIndex = currentChunkIndex - 1;
            }
            break;

          case "overlap":
            // Get chunk with more overlap
            if (window.hasNext()) {
              nextChunkIndex = currentChunkIndex + 1;
            }
            break;

          case "full":
            // Get surrounding context and merge chunks for expanded context
            // This strategy works by getting adjacent chunks to provide more context
            // The merged content is available via window.getContext()
            // For restoration, we try the next chunk first, then previous
            if (window.hasNext()) {
              nextChunkIndex = currentChunkIndex + 1;
            } else if (currentChunkIndex > 0) {
              nextChunkIndex = currentChunkIndex - 1;
            }
            break;
        }

        if (nextChunkIndex !== null) {
          currentChunkIndex = nextChunkIndex;
          attempts++;

          if (onRestore) {
            onRestore(chunkIndex, nextChunkIndex);
          }

          continue;
        }
      }

      return result;
    } catch (error) {
      if (attempts >= maxAttempts) {
        throw error;
      }
      attempts++;
    }
  }

  throw new Error("Context restoration failed after max attempts");
}

/**
 * Merge results from multiple chunk processing into a single text
 *
 * @param results - Array of process results
 * @param separator - Separator between chunks (default: "\n\n")
 * @returns Merged text from all successful results
 */
export function mergeResults(
  results: WindowProcessResult[],
  separator: string = "\n\n",
): string {
  return results
    .filter((r) => r.status === "success" && r.result?.state?.content)
    .map((r) => r.result.state.content)
    .join(separator);
}

/**
 * Get processing statistics from results
 *
 * @param results - Array of process results
 * @returns Processing statistics
 */
export function getProcessingStats(results: WindowProcessResult[]): {
  total: number;
  successful: number;
  failed: number;
  successRate: number;
  avgDuration: number;
  totalDuration: number;
} {
  const total = results.length;
  const successful = results.filter((r) => r.status === "success").length;
  const failed = results.filter((r) => r.status === "error").length;
  const successRate = total > 0 ? (successful / total) * 100 : 0;
  const totalDuration = results.reduce((sum, r) => sum + r.duration, 0);
  const avgDuration = total > 0 ? totalDuration / total : 0;

  return {
    total,
    successful,
    failed,
    successRate,
    avgDuration: Math.round(avgDuration),
    totalDuration,
  };
}
