// Top-level L0 runtime types

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
   *     () => streamText({ model: openai('gpt-4o-mini'), prompt }),
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
     * Maximum time to wait for the first token (default: 2000ms)
     */
    initialToken?: number;
    /**
     * Maximum time between tokens (default: 5000ms)
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
   * Enable drift detection
   */
  detectDrift?: boolean;

  /**
   * Enable zero-token detection and auto-retry
   */
  detectZeroTokens?: boolean;

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
     * Violations by rule
     */
    violationsByRule: Record<string, number>;

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
   * What types of errors to retry on
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
 * Guardrail rule interface
 */
export interface GuardrailRule {
  name: string;
  check: (state: L0State) => GuardrailViolation[];
}

/**
 * Guardrail violation
 */
export interface GuardrailViolation {
  rule: string;
  message: string;
  severity: "warning" | "error" | "fatal";
  position?: number;
  recoverable: boolean;
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
  attempts: 1,
};

export const recommendedRetry: RetryOptions = {
  attempts: 2,
  backoff: "exponential",
  baseDelay: 1000,
  maxDelay: 10000,
  retryOn: ["zero_output", "guardrail_violation", "drift"],
};

export const strictRetry: RetryOptions = {
  attempts: 3,
  backoff: "full-jitter",
  baseDelay: 1000,
  maxDelay: 10000,
  retryOn: ["zero_output", "drift", "malformed", "incomplete"],
};
