// Top-level L0 runtime types

import type { GuardrailRule, GuardrailViolation } from "./guardrails";
import type { BackoffStrategy, RetryReason } from "./retry";
import { RETRY_DEFAULTS, ErrorCategory } from "./retry";

// Re-export for convenience
export type { GuardrailRule, GuardrailViolation } from "./guardrails";
export type { BackoffStrategy, RetryReason } from "./retry";
export { RETRY_DEFAULTS, ErrorCategory } from "./retry";

/**
 * Result of checkpoint validation for continuation
 */
export interface CheckpointValidationResult {
  /** Whether to skip continuation and start fresh */
  skipContinuation: boolean;
  /** Guardrail violations found in checkpoint */
  violations: GuardrailViolation[];
  /** Whether drift was detected */
  driftDetected: boolean;
  /** Drift types if detected */
  driftTypes: string[];
}

/**
 * Multimodal content types supported by L0
 */
export type L0ContentType =
  | "text"
  | "image"
  | "audio"
  | "video"
  | "file"
  | "json"
  | "binary";

/**
 * Multimodal data payload for non-text content
 */
export interface L0DataPayload {
  /**
   * Content type of the data
   */
  contentType: L0ContentType;

  /**
   * MIME type (e.g., "image/png", "audio/mp3")
   */
  mimeType?: string;

  /**
   * Data as base64 string (for binary content)
   */
  base64?: string;

  /**
   * Data as URL (for remote content)
   */
  url?: string;

  /**
   * Data as raw bytes (for binary content in Node.js)
   */
  bytes?: Uint8Array;

  /**
   * Structured data (for JSON content type)
   */
  json?: unknown;

  /**
   * Optional metadata about the content
   */
  metadata?: {
    /** Width in pixels (for images/video) */
    width?: number;
    /** Height in pixels (for images/video) */
    height?: number;
    /** Duration in seconds (for audio/video) */
    duration?: number;
    /** File size in bytes */
    size?: number;
    /** Original filename */
    filename?: string;
    /** Generation seed (for reproducibility) */
    seed?: number;
    /** Model used for generation */
    model?: string;
    /** Additional provider-specific metadata */
    [key: string]: unknown;
  };
}

/**
 * Progress information for long-running operations
 */
export interface L0Progress {
  /** Progress percentage (0-100) */
  percent?: number;
  /** Current step number */
  step?: number;
  /** Total steps */
  totalSteps?: number;
  /** Status message */
  message?: string;
  /** Estimated time remaining in ms */
  eta?: number;
}

/**
 * Unified event format that L0 normalizes all streaming events into
 */
export interface L0Event {
  /**
   * Event type:
   * - "token": Text token (for LLM streaming)
   * - "message": Structured message (tool calls, etc.)
   * - "data": Multimodal data (images, audio, etc.)
   * - "progress": Progress update for long-running operations
   * - "error": Error event
   * - "complete": Stream completion
   */
  type: "token" | "message" | "data" | "progress" | "error" | "complete";

  /** Text value (for token/message events) */
  value?: string;

  /** Role (for message events) */
  role?: string;

  /** Multimodal data payload (for data events) */
  data?: L0DataPayload;

  /** Progress information (for progress events) */
  progress?: L0Progress;

  /** Error (for error events) */
  error?: Error;

  /** Error category/reason (for error events) */
  reason?: ErrorCategory;

  /** Event timestamp */
  timestamp?: number;

  /**
   * Usage information (typically on complete event)
   */
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    /** Cost in USD (if available from provider) */
    cost?: number;
    /** Provider-specific usage details */
    [key: string]: unknown;
  };
}

/**
 * Configuration for the main l0() wrapper
 *
 * @typeParam TOutput - Optional type for the expected output (for type forwarding)
 */
export interface L0Options<TOutput = unknown> {
  /**
   * Phantom type parameter for output type inference
   * This field is never used at runtime - it only helps TypeScript infer the output type
   */
  __outputType?: TOutput;
  /**
   * Function that returns a streamText() result from Vercel AI SDK
   */
  stream: () => Promise<any> | any;

  /**
   * Optional fallback stream functions to try if primary stream fails
   * after exhausting retries. Useful for falling back to cheaper models.
   *
   * @example
   * ```typescript
   * {
   *   stream: () => streamText({ model: openai('gpt-4o'), prompt }),
   *   fallbackStreams: [
   *     () => streamText({ model: openai('gpt-5-mini'), prompt }),
   *     () => streamText({ model: openai('gpt-3.5-turbo'), prompt })
   *   ]
   * }
   * ```
   */
  fallbackStreams?: Array<() => Promise<any> | any>;

  /**
   * Array of guardrail rules to apply during streaming
   */
  guardrails?: GuardrailRule[];

  /**
   * Retry configuration
   */
  retry?: RetryOptions;

  /**
   * Timeout configuration (in milliseconds)
   */
  timeout?: {
    /**
     * Maximum time to wait for the first token (default: 5000ms)
     */
    initialToken?: number;
    /**
     * Maximum time between tokens (default: 10,000ms)
     */
    interToken?: number;
  };

  /**
   * Optional abort signal for cancellation
   */
  signal?: AbortSignal;

  /**
   * Enable built-in monitoring and telemetry
   */
  monitoring?: {
    /**
     * Enable telemetry collection (default: false)
     */
    enabled?: boolean;

    /**
     * Sample rate for telemetry (0-1, default: 1.0)
     */
    sampleRate?: number;

    /**
     * Include detailed network error information
     */
    includeNetworkDetails?: boolean;

    /**
     * Include timing metrics
     */
    includeTimings?: boolean;

    /**
     * Custom metadata to attach to all events
     */
    metadata?: Record<string, any>;
  };

  /**
   * Configure check intervals for streaming operations
   *
   * **Performance Note:** Both guardrails and drift detection scan the accumulated
   * content at each check interval. For very long outputs (multi-MB), this becomes
   * O(n) per check. Consider:
   * - Increasing intervals for long-form content
   * - Using streaming-optimized guardrail rules that only check the delta
   * - Setting a maximum content length before disabling checks
   */
  checkIntervals?: {
    /**
     * Run guardrail checks every N tokens (default: 5)
     *
     * **Performance Warning:** If guardrail rules include expensive operations
     * (regex on full content, JSON parsing), lower values can cause significant
     * CPU overhead. For rules that scan full content, each check is O(n) where
     * n is content length.
     *
     * Recommendations:
     * - For simple delta-only rules: 1-5 tokens
     * - For rules scanning full content: 10-50 tokens
     * - For very long outputs (>100KB): 50-100 tokens
     */
    guardrails?: number;

    /**
     * Run drift detection every N tokens (default: 10)
     *
     * **Performance Warning:** Drift detection scans the entire accumulated
     * content at each interval, making it O(n) per check. For multi-MB outputs,
     * consider increasing this interval or disabling drift detection.
     */
    drift?: number;

    /**
     * Save checkpoint every N tokens (default: 10)
     * Checkpoints are used for recovery if a violation is detected
     */
    checkpoint?: number;
  };

  /**
   * Enable drift detection
   *
   * **Performance Warning:** Drift detection scans the entire accumulated content
   * at regular intervals (configured via checkIntervals.drift). For very long
   * streaming outputs, this can become expensive. The check is O(n) where n is
   * the content length at each interval.
   *
   * For long-form content generation, consider:
   * - Increasing checkIntervals.drift to reduce frequency
   * - Disabling drift detection and validating at completion only
   */
  detectDrift?: boolean;

  /**
   * Enable zero-token detection and auto-retry
   */
  detectZeroTokens?: boolean;

  /**
   * Continue generation from the last known good checkpoint on retry/fallback.
   *
   * When enabled, if a stream fails (network error, timeout, guardrail violation),
   * L0 will prepend the checkpoint content to the prompt for the retry/fallback,
   * allowing the model to continue from where it left off.
   *
   * **Important:** This option is explicitly opt-in because:
   * - It modifies your prompt by prepending checkpoint content
   * - It may not work well with all prompt structures
   * - Structured output (JSON) should NOT use this - use schema validation instead
   *
   * @default false
   *
   * @example
   * ```typescript
   * const result = await l0({
   *   stream: () => streamText({
   *     model: openai('gpt-4o'),
   *     prompt: 'Write a long essay about climate change'
   *   }),
   *   continueFromLastKnownGoodToken: true,
   *   retry: { attempts: 3 }
   * });
   * ```
   */
  continueFromLastKnownGoodToken?: boolean;

  /**
   * Custom function to build the continuation prompt.
   * Only used when continueFromLastKnownGoodToken is true.
   *
   * When a retry or fallback occurs with a checkpoint, this function is called
   * to build a prompt that tells the LLM to continue from where it left off.
   * The returned string should be used as the new prompt for the retry.
   *
   * Note: Since L0 receives stream factories (not prompts directly), you must
   * provide a stream factory that uses this modified prompt. The onContinuation
   * callback can be used to update external state before the retry.
   *
   * @param checkpoint - The last known good content to continue from
   * @returns The continuation prompt to use for the retry
   *
   * @example
   * ```typescript
   * let continuationPrompt = "";
   * const result = await l0({
   *   stream: () => streamText({
   *     model,
   *     prompt: continuationPrompt || originalPrompt,
   *   }),
   *   continueFromLastKnownGoodToken: true,
   *   buildContinuationPrompt: (checkpoint) => {
   *     continuationPrompt = `${originalPrompt}\n\nContinue from:\n${checkpoint}`;
   *     return continuationPrompt;
   *   },
   * });
   * ```
   */
  buildContinuationPrompt?: (checkpoint: string) => string;

  /**
   * Enable automatic deduplication of overlapping content when continuing from checkpoint.
   * Only used when continueFromLastKnownGoodToken is true.
   *
   * When LLMs continue from a checkpoint, they often repeat some words from the end
   * of the checkpoint at the beginning of their continuation. When this option is enabled,
   * L0 will detect and remove this overlapping content automatically.
   *
   * @default true (when continueFromLastKnownGoodToken is enabled)
   *
   * @example
   * ```typescript
   * // Checkpoint: "Hello world"
   * // LLM continues with: "world is great"
   * // Without deduplication: "Hello worldworld is great"
   * // With deduplication: "Hello world is great"
   *
   * const result = await l0({
   *   stream: () => streamText({ model, prompt }),
   *   continueFromLastKnownGoodToken: true,
   *   deduplicateContinuation: true, // default when continuation is enabled
   * });
   * ```
   */
  deduplicateContinuation?: boolean;

  /**
   * Options for continuation deduplication.
   * Only used when deduplicateContinuation is true.
   */
  deduplicationOptions?: {
    /**
     * Minimum overlap length in characters to consider for deduplication.
     * Shorter overlaps are ignored to avoid false positives.
     * @default 2
     */
    minOverlap?: number;

    /**
     * Maximum overlap length in characters to check.
     * Limits the search space for performance.
     * @default 500
     */
    maxOverlap?: number;

    /**
     * Whether to use case-sensitive matching.
     * @default true
     */
    caseSensitive?: boolean;

    /**
     * Whether to normalize whitespace when detecting overlap.
     * When true, "Hello  world" and "Hello world" are considered matching.
     * @default false
     */
    normalizeWhitespace?: boolean;
  };

  /**
   * Optional callback for each event
   */
  onEvent?: (event: L0Event) => void;

  /**
   * Optional callback for guardrail violations
   */
  onViolation?: (violation: GuardrailViolation) => void;

  /**
   * Optional callback for retry attempts
   */
  onRetry?: (attempt: number, reason: string) => void;

  /**
   * Interceptors for preprocessing and postprocessing
   */
  interceptors?: L0Interceptor[];

  /**
   * Custom adapter for wrapping the stream.
   *
   * Use this for SDKs not natively supported by L0.
   * Can be an adapter object or a registered adapter name.
   *
   * When specified, this adapter is used instead of:
   * - Native L0 stream detection (textStream, fullStream)
   * - Auto-detection via registered adapters
   *
   * @example
   * ```typescript
   * // Explicit adapter object
   * const result = await l0({
   *   stream: () => myCoolAI.generate("Hello"),
   *   adapter: myCoolAdapter,
   * });
   *
   * // Registered adapter by name
   * registerAdapter(myCoolAdapter);
   * const result = await l0({
   *   stream: () => myCoolAI.generate("Hello"),
   *   adapter: "mycoolai",
   * });
   * ```
   */
  adapter?: L0Adapter | string;

  /**
   * Options to pass to the adapter's wrap() function.
   * Used with both explicit adapters and auto-detected adapters.
   */
  adapterOptions?: unknown;
}

/**
 * Interface for custom stream adapters.
 * Adapters normalize foreign SDK streams → L0Events.
 *
 * Adapters MUST NOT:
 * - Modify, sanitize, or transform content
 * - Buffer, batch, or collapse tokens
 * - Retry internally or apply guardrails
 * - Alter timing or ordering
 *
 * L0 handles all of that.
 *
 * @typeParam StreamType - The type of stream this adapter handles
 * @typeParam Options - Optional configuration for the adapter
 *
 * @example
 * ```typescript
 * const myCoolAdapter: L0Adapter<MyCoolStream, { verbose?: boolean }> = {
 *   name: "mycoolai",
 *
 *   detect(input): input is MyCoolStream {
 *     return input && typeof input === "object" && "myCoolMarker" in input;
 *   },
 *
 *   async *wrap(stream, options = {}) {
 *     try {
 *       for await (const chunk of stream) {
 *         if (chunk.type === "text") {
 *           yield { type: "token", value: chunk.content, timestamp: Date.now() };
 *         }
 *       }
 *       yield { type: "done", timestamp: Date.now() };
 *     } catch (err) {
 *       yield {
 *         type: "error",
 *         error: err instanceof Error ? err : new Error(String(err)),
 *         timestamp: Date.now(),
 *       };
 *     }
 *   },
 * };
 * ```
 */
export interface L0Adapter<StreamType = unknown, Options = unknown> {
  /**
   * Unique identifier for this adapter.
   * Used for registration and lookup by name.
   */
  name: string;

  /**
   * Optional type guard for auto-detection.
   *
   * Required ONLY if you want auto-detection via registerAdapter().
   * Not needed for explicit `adapter: myAdapter` usage.
   *
   * Must return true ONLY for streams this adapter can handle.
   * Must be fast (no async, no I/O).
   *
   * @param input - Unknown input to test
   * @returns True if this adapter can handle the input
   */
  detect?(input: unknown): input is StreamType;

  /**
   * Convert provider stream → L0Events.
   *
   * MUST:
   * - Yield events in exact order received
   * - Include timestamp on every event
   * - Convert errors to { type: "error" } events (never throw)
   * - Yield { type: "done" } exactly once at end
   *
   * MUST NOT:
   * - Modify text content in any way
   * - Buffer or batch chunks
   * - Perform retries or async operations besides iteration
   *
   * @param stream - The provider's stream to wrap
   * @param options - Optional adapter-specific configuration
   * @returns Async generator yielding L0Events
   */
  wrap(stream: StreamType, options?: Options): AsyncGenerator<L0Event>;
}

/**
 * Interceptor for preprocessing (before) and postprocessing (after) L0 execution
 */
export interface L0Interceptor {
  /**
   * Optional name for the interceptor
   */
  name?: string;

  /**
   * Before hook - runs before stream starts
   * Can modify options, inject metadata, add authentication, etc.
   */
  before?: (options: L0Options) => L0Options | Promise<L0Options>;

  /**
   * After hook - runs after stream completes
   * Can inspect output, post-process content, log results, etc.
   */
  after?: (result: L0Result) => L0Result | Promise<L0Result>;

  /**
   * Error hook - runs if an error occurs
   */
  onError?: (error: Error, options: L0Options) => void | Promise<void>;
}

/**
 * Result from l0() execution
 *
 * @typeParam TOutput - Optional type for the expected output (for type forwarding)
 */
export interface L0Result<TOutput = unknown> {
  /**
   * Phantom type for output type inference (never used at runtime)
   */
  __outputType?: TOutput;
  /**
   * Async iterator for streaming events
   */
  stream: AsyncIterable<L0Event>;

  /**
   * Full accumulated text (available after stream completes)
   */
  text?: string;

  /**
   * State and metadata from the execution
   */
  state: L0State;

  /**
   * Any errors that occurred
   */
  errors: Error[];

  /**
   * Telemetry data (if monitoring enabled)
   */
  telemetry?: L0Telemetry;

  /**
   * Abort controller for canceling the stream
   */
  abort: () => void;
}

/**
 * Internal state tracking for L0 runtime
 */
export interface L0State {
  /**
   * Current accumulated output
   */
  content: string;

  /**
   * Last known good checkpoint
   */
  checkpoint: string;

  /**
   * Total tokens received
   */
  tokenCount: number;

  /**
   * Model retry attempts made (counts toward retry limit)
   */
  modelRetryCount: number;

  /**
   * Network retry attempts (doesn't count toward limit)
   */
  networkRetryCount: number;

  /**
   * Index of current fallback stream being used (0 = primary, 1+ = fallback)
   */
  fallbackIndex: number;

  /**
   * Guardrail violations encountered
   */
  violations: GuardrailViolation[];

  /**
   * Whether drift was detected
   */
  driftDetected: boolean;

  /**
   * Whether stream completed successfully
   */
  completed: boolean;

  /**
   * Timestamp of first token
   */
  firstTokenAt?: number;

  /**
   * Timestamp of last token
   */
  lastTokenAt?: number;

  /**
   * Total duration in milliseconds
   */
  duration?: number;

  /**
   * Network errors encountered (categorized)
   */
  networkErrors: CategorizedNetworkError[];

  /**
   * Whether continuation from checkpoint was used (resumed from prior content)
   */
  resumed: boolean;

  /**
   * The checkpoint content that was used for continuation (if any)
   */
  resumePoint?: string;

  /**
   * Character offset where resume occurred (length of checkpoint content)
   * Useful for debugging and telemetry
   */
  resumeFrom?: number;

  /**
   * Multimodal data outputs collected during streaming.
   * Each entry corresponds to a "data" event received.
   */
  dataOutputs: L0DataPayload[];

  /**
   * Last progress update received (for long-running operations)
   */
  lastProgress?: L0Progress;
}

/**
 * Telemetry data collected during L0 execution
 */
export interface L0Telemetry {
  /**
   * Session ID for this execution
   */
  sessionId: string;

  /**
   * Timestamp when execution started
   */
  startTime: number;

  /**
   * Timestamp when execution ended
   */
  endTime?: number;

  /**
   * Total duration in milliseconds
   */
  duration?: number;

  /**
   * Performance metrics
   */
  metrics: {
    /**
     * Time to first token (ms)
     */
    timeToFirstToken?: number;

    /**
     * Average time between tokens (ms)
     */
    avgInterTokenTime?: number;

    /**
     * Tokens per second
     */
    tokensPerSecond?: number;

    /**
     * Total tokens received
     */
    totalTokens: number;

    /**
     * Total retries (all types)
     */
    totalRetries: number;

    /**
     * Network retry count (doesn't count toward limit)
     */
    networkRetryCount: number;

    /**
     * Model retry count (counts toward limit)
     */
    modelRetryCount: number;
  };

  /**
   * Network events and errors
   */
  network: {
    /**
     * Total network errors encountered
     */
    errorCount: number;

    /**
     * Network errors by type
     */
    errorsByType: Record<string, number>;

    /**
     * Network error details (if includeNetworkDetails enabled)
     */
    errors?: Array<{
      type: string;
      message: string;
      timestamp: number;
      retried: boolean;
      delay?: number;
    }>;
  };

  /**
   * Guardrail events
   */
  guardrails?: {
    /**
     * Total violations
     */
    violationCount: number;

    /**
     * Violations by rule (count only)
     */
    violationsByRule: Record<string, number>;

    /**
     * Violations by rule with severity breakdown
     */
    violationsByRuleAndSeverity: Record<
      string,
      { warning: number; error: number; fatal: number }
    >;

    /**
     * Violations by severity
     */
    violationsBySeverity: {
      warning: number;
      error: number;
      fatal: number;
    };
  };

  /**
   * Drift detection results
   */
  drift?: {
    /**
     * Whether drift was detected
     */
    detected: boolean;

    /**
     * Types of drift detected
     */
    types: string[];
  };

  /**
   * Continuation from checkpoint data
   */
  continuation?: {
    /**
     * Whether continuation from checkpoint was enabled
     */
    enabled: boolean;

    /**
     * Whether continuation was actually used (checkpoint existed and was applied)
     */
    used: boolean;

    /**
     * The checkpoint content that was continued from (if used)
     */
    checkpointContent?: string;

    /**
     * Length of the checkpoint content in characters
     */
    checkpointLength?: number;

    /**
     * Number of times continuation was applied (across retries/fallbacks)
     */
    continuationCount?: number;
  };

  /**
   * Custom metadata
   */
  metadata?: Record<string, any>;
}

/**
 * Categorized network error for telemetry
 */
export interface CategorizedNetworkError {
  type: string;
  message: string;
  timestamp: number;
  retried: boolean;
  delay?: number;
  attempt?: number;
}

/**
 * Retry configuration options
 */
export interface RetryOptions {
  /**
   * Maximum retry attempts for model failures (default: 3)
   * Network and transient errors do not count toward this limit.
   */
  attempts?: number;

  /**
   * Absolute maximum number of retries across ALL error types (default: 6)
   * This is a hard cap that includes network errors, transient errors, and model errors.
   * When set, no more than this many total retries will be attempted regardless of error type.
   * Useful for preventing infinite retry loops in degraded network conditions.
   *
   * @example
   * ```typescript
   * // Allow up to 10 total retries, then fail
   * retry: { maxRetries: 10 }
   *
   * // Allow 3 model retries, but cap total at 5 (including network retries)
   * retry: { attempts: 3, maxRetries: 5 }
   * ```
   */
  maxRetries?: number;

  /**
   * Backoff strategy (default: "fixed-jitter")
   */
  backoff?: BackoffStrategy;

  /**
   * Base delay in milliseconds (default: 1000)
   */
  baseDelay?: number;

  /**
   * Maximum delay cap in milliseconds (default: 10000)
   */
  maxDelay?: number;

  /**
   * What types of errors to retry on.
   * Default: zero_output, guardrail_violation, drift, incomplete, network_error, timeout, rate_limit, server_error
   * Note: "unknown" errors are NOT retried by default (opt-in only)
   */
  retryOn?: RetryReason[];

  /**
   * Custom delays for specific network error types (optional)
   * Overrides baseDelay for specific errors
   *
   * @example
   * ```typescript
   * {
   *   connectionDropped: 2000,  // 2 seconds for connection drops
   *   fetchError: 500,           // 0.5 seconds for fetch errors
   *   runtimeKilled: 5000        // 5 seconds for runtime kills
   * }
   * ```
   */
  errorTypeDelays?: {
    connectionDropped?: number;
    fetchError?: number;
    econnreset?: number;
    econnrefused?: number;
    sseAborted?: number;
    noBytes?: number;
    partialChunks?: number;
    runtimeKilled?: number;
    backgroundThrottle?: number;
    dnsError?: number;
    timeout?: number;
    unknown?: number;
  };

  /**
   * Custom retry function to override default retry behavior.
   * Return `true` to retry, `false` to stop retrying.
   * This function is called before the default retry logic.
   *
   * @param error - The error that occurred
   * @param context - Context about the current retry state
   * @returns Whether to retry (true) or stop (false), or undefined to use default behavior
   *
   * @example
   * ```typescript
   * {
   *   retry: {
   *     attempts: 3,
   *     shouldRetry: (error, context) => {
   *       // Never retry after 5 total attempts
   *       if (context.totalAttempts >= 5) return false;
   *       // Always retry rate limits
   *       if (error.message.includes('rate limit')) return true;
   *       // Use default behavior for everything else
   *       return undefined;
   *     }
   *   }
   * }
   * ```
   */
  shouldRetry?: (
    error: Error,
    context: {
      /** Current retry attempt (0-based) */
      attempt: number;
      /** Total attempts including network retries */
      totalAttempts: number;
      /** Error category: network, transient, model, or fatal */
      category: ErrorCategory;
      /** Reason for the error */
      reason: string;
      /** Accumulated content so far */
      content: string;
      /** Token count so far */
      tokenCount: number;
    },
  ) => boolean | undefined;

  /**
   * Custom delay calculation function to override default backoff behavior.
   * Return a delay in milliseconds, or undefined to use the default backoff strategy.
   *
   * @param context - Context about the current retry state
   * @returns Delay in milliseconds, or undefined to use default behavior
   *
   * @example
   * ```typescript
   * {
   *   retry: {
   *     // Custom exponential backoff with decorrelated jitter
   *     calculateDelay: (context) => {
   *       const base = 1000;
   *       const cap = 30000;
   *       const temp = Math.min(cap, base * Math.pow(2, context.attempt));
   *       return Math.random() * temp;
   *     }
   *   }
   * }
   * ```
   *
   * @example
   * ```typescript
   * {
   *   retry: {
   *     // Fixed delay with custom jitter range
   *     calculateDelay: (context) => {
   *       const base = 2000;
   *       const jitter = Math.random() * 1000; // 0-1000ms jitter
   *       return base + jitter;
   *     }
   *   }
   * }
   * ```
   *
   * @example
   * ```typescript
   * {
   *   retry: {
   *     // Different delays based on error type
   *     calculateDelay: (context) => {
   *       if (context.category === 'network') return 500;
   *       if (context.reason === 'rate_limit') return 5000;
   *       return undefined; // use default
   *     }
   *   }
   * }
   * ```
   */
  calculateDelay?: (context: {
    /** Current retry attempt (0-based) */
    attempt: number;
    /** Total attempts including network retries */
    totalAttempts: number;
    /** Error category: network, transient, model, or fatal */
    category: ErrorCategory;
    /** Reason for the error */
    reason: string;
    /** The error that occurred */
    error: Error;
    /** Default delay that would be used */
    defaultDelay: number;
  }) => number | undefined;
}

/**
 * Preset guardrail configurations
 */
export const minimalGuardrails: GuardrailRule[] = [];
export const recommendedGuardrails: GuardrailRule[] = [];
export const strictGuardrails: GuardrailRule[] = [];

/**
 * Preset retry configurations
 */
export const minimalRetry: RetryOptions = {
  attempts: 2,
  maxRetries: 4,
  backoff: "linear",
  baseDelay: RETRY_DEFAULTS.baseDelay,
  maxDelay: RETRY_DEFAULTS.maxDelay,
  retryOn: [...RETRY_DEFAULTS.retryOn],
};

export const recommendedRetry: RetryOptions = {
  attempts: RETRY_DEFAULTS.attempts,
  maxRetries: RETRY_DEFAULTS.maxRetries,
  backoff: RETRY_DEFAULTS.backoff,
  baseDelay: RETRY_DEFAULTS.baseDelay,
  maxDelay: RETRY_DEFAULTS.maxDelay,
  retryOn: [...RETRY_DEFAULTS.retryOn],
};

export const strictRetry: RetryOptions = {
  attempts: RETRY_DEFAULTS.attempts,
  maxRetries: RETRY_DEFAULTS.maxRetries,
  backoff: "full-jitter",
  baseDelay: RETRY_DEFAULTS.baseDelay,
  maxDelay: RETRY_DEFAULTS.maxDelay,
  retryOn: [...RETRY_DEFAULTS.retryOn],
};

export const exponentialRetry: RetryOptions = {
  attempts: 4,
  maxRetries: 8,
  backoff: "exponential",
  baseDelay: RETRY_DEFAULTS.baseDelay,
  maxDelay: RETRY_DEFAULTS.maxDelay,
  retryOn: [...RETRY_DEFAULTS.retryOn],
};
