// Stream types for L0

/**
 * Normalized stream event from Vercel AI SDK or other providers
 */
export interface StreamEvent {
  type: "text-delta" | "finish" | "error" | "content-delta" | "tool-call";
  textDelta?: string;
  finishReason?: string;
  error?: Error;
  content?: string;
  toolCall?: any;
}

/**
 * Stream normalizer configuration
 */
export interface StreamNormalizerOptions {
  /**
   * Whether to accumulate text deltas
   */
  accumulate?: boolean;

  /**
   * Whether to emit checkpoints
   */
  checkpoint?: boolean;

  /**
   * Checkpoint interval (in tokens or milliseconds)
   */
  checkpointInterval?: number;
}

/**
 * Stream wrapper that handles cancellation and timeouts
 */
export interface StreamWrapper {
  /**
   * The underlying async iterator
   */
  stream: AsyncIterable<any>;

  /**
   * Abort signal for cancellation
   */
  signal?: AbortSignal;

  /**
   * Initial token timeout in milliseconds
   */
  initialTimeout?: number;

  /**
   * Inter-token timeout in milliseconds
   */
  interTokenTimeout?: number;
}

/**
 * Stream state for tracking progress
 */
export interface StreamState {
  /**
   * Whether the stream has started
   */
  started: boolean;

  /**
   * Whether the first token has been received
   */
  firstTokenReceived: boolean;

  /**
   * Timestamp of stream start
   */
  startTime?: number;

  /**
   * Timestamp of first token
   */
  firstTokenTime?: number;

  /**
   * Timestamp of last token
   */
  lastTokenTime?: number;

  /**
   * Total tokens received
   */
  tokenCount: number;

  /**
   * Whether stream is complete
   */
  complete: boolean;

  /**
   * Whether stream was aborted
   */
  aborted: boolean;

  /**
   * Any error that occurred
   */
  error?: Error;
}

/**
 * Stream chunk with metadata
 */
export interface StreamChunk {
  /**
   * The text content
   */
  content: string;

  /**
   * Whether this is the final chunk
   */
  done: boolean;

  /**
   * Timestamp of this chunk
   */
  timestamp: number;

  /**
   * Accumulated content so far
   */
  accumulated?: string;

  /**
   * Token index
   */
  index: number;
}

/**
 * Handler function for stream chunks
 */
export type StreamHandler = (chunk: StreamChunk) => void | Promise<void>;

/**
 * Stream error types
 */
export type StreamErrorType =
  | "timeout"
  | "abort"
  | "network"
  | "parse"
  | "unknown";

/**
 * Stream error with categorization
 */
export interface StreamError extends Error {
  type: StreamErrorType;
  recoverable: boolean;
  timestamp: number;
}

/**
 * Stream resumption state for recovery
 */
export interface StreamResumptionState {
  /**
   * Last successfully accumulated content
   */
  lastContent: string;

  /**
   * Last token index
   */
  lastTokenIndex: number;

  /**
   * Timestamp of last successful token
   */
  lastTokenTime: number;

  /**
   * Whether resumption is possible
   */
  canResume: boolean;
}
