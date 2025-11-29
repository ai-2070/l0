// Top-level L0 runtime types

import type { GuardrailRule, GuardrailViolation } from "./guardrails";

// Re-export for convenience
export type { GuardrailRule, GuardrailViolation } from "./guardrails";

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
 * Unified event format that L0 normalizes all streaming events into
 */
export interface L0Event {
  type: "token" | "message" | "error" | "done";
  value?: string;
  role?: string;
  error?: Error;
  timestamp?: number;
}

/**
 * Configuration for the main l0() wrapper
 */
export interface L0Options {
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
   */
  checkIntervals?: {
    /**
     * Run guardrail checks every N tokens (default: 5)
     * Lower values = more frequent checks, higher CPU usage
     * Higher values = less frequent checks, potential for more content before violation detected
     */
    guardrails?: number;

    /**
     * Run drift detection every N tokens (default: 10)
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
 */
export interface L0Result {
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
   * Retry attempts made (only counts model failures)
   */
  retryAttempts: number;

  /**
   * Network retry attempts (doesn't count toward limit)
   */
  networkRetries: number;

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
   * Whether continuation from checkpoint was used
   */
  continuedFromCheckpoint: boolean;

  /**
   * The checkpoint content that was used for continuation (if any)
   */
  continuationCheckpoint?: string;
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
     * Network retries (doesn't count toward limit)
     */
    networkRetries: number;

    /**
     * Model retries (counts toward limit)
     */
    modelRetries: number;
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
   * Maximum retry attempts for model failures (default: 2)
   * Network and transient errors do not count toward this limit.
   */
  attempts?: number;

  /**
   * Absolute maximum number of retries across ALL error types (default: unlimited)
   * This is a hard cap that includes network errors, transient errors, and model errors.
   * When set, no more than this many total retries will be attempted regardless of error type.
   * Useful for preventing infinite retry loops in degraded network conditions.
   *
   * @example
   * ```typescript
   * // Allow up to 10 total retries, then fail
   * retry: { maxRetries: 10 }
   *
   * // Allow 2 model retries, but cap total at 5 (including network retries)
   * retry: { attempts: 2, maxRetries: 5 }
   * ```
   */
  maxRetries?: number;

  /**
   * Backoff strategy
   */
  backoff?: "exponential" | "linear" | "fixed" | "full-jitter";

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
   * Default: all error types (zero_output, guardrail_violation, drift, malformed, incomplete, network_error, timeout, rate_limit, server_error)
   */
  retryOn?: Array<
    | "zero_output"
    | "guardrail_violation"
    | "drift"
    | "malformed"
    | "incomplete"
    | "network_error"
    | "timeout"
    | "rate_limit"
    | "server_error"
  >;

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
}

/**
 * Error classification for retry logic
 */
export type ErrorCategory =
  | "network" // Network failures - retry forever with backoff
  | "transient" // 429, 503, timeouts - retry forever with backoff
  | "model" // Model failures - count toward retry limit
  | "fatal"; // Don't retry

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
  attempts: 1,
};

export const recommendedRetry: RetryOptions = {
  attempts: 2,
  backoff: "exponential",
  baseDelay: 1000,
  maxDelay: 10000,
  retryOn: [
      "zero_output", "guardrail_violation", "drift", "malformed", "incomplete", "network_error", "timeout", "rate_limit", "server_error",
    ],
};

export const strictRetry: RetryOptions = {
  attempts: 3,
  backoff: "full-jitter",
  baseDelay: 1000,
  maxDelay: 10000,
  retryOn: [
      "zero_output", "guardrail_violation", "drift", "malformed", "incomplete", "network_error", "timeout", "rate_limit", "server_error",
    ],
};
