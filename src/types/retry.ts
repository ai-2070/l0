// Retry types and error categorization for L0

/**
 * Per-error-type delay configuration
 */
export interface ErrorTypeDelays {
  /**
   * Connection dropped delay (default: 1000ms)
   */
  connectionDropped?: number;

  /**
   * fetch() TypeError delay (default: 500ms)
   */
  fetchError?: number;

  /**
   * ECONNRESET delay (default: 1000ms)
   */
  econnreset?: number;

  /**
   * ECONNREFUSED delay (default: 2000ms)
   */
  econnrefused?: number;

  /**
   * SSE aborted delay (default: 500ms)
   */
  sseAborted?: number;

  /**
   * No bytes arrived delay (default: 500ms)
   */
  noBytes?: number;

  /**
   * Partial chunks delay (default: 500ms)
   */
  partialChunks?: number;

  /**
   * Runtime killed delay (default: 2000ms)
   */
  runtimeKilled?: number;

  /**
   * Background throttle delay (default: 5000ms)
   */
  backgroundThrottle?: number;

  /**
   * DNS error delay (default: 3000ms)
   */
  dnsError?: number;

  /**
   * Timeout delay (default: 1000ms)
   */
  timeout?: number;

  /**
   * Unknown network error delay (default: 1000ms)
   */
  unknown?: number;
}

/**
 * Retry configuration
 */
export interface RetryConfig {
  /**
   * Maximum retry attempts for model failures (default: 2)
   * Network and transient errors do not count toward this limit.
   */
  maxAttempts: number;

  /**
   * Absolute maximum number of retries across ALL error types (default: undefined = unlimited)
   * This is a hard cap that includes network errors, transient errors, and model errors.
   * When set, no more than this many total retries will be attempted regardless of error type.
   * Useful for preventing infinite retry loops in degraded network conditions.
   */
  maxRetries?: number;

  /**
   * Base delay in milliseconds (default: 1000)
   */
  baseDelay: number;

  /**
   * Maximum delay cap in milliseconds (default: 10000)
   */
  maxDelay?: number;

  /**
   * Backoff strategy
   */
  backoff: "exponential" | "linear" | "fixed" | "full-jitter";

  /**
   * What types of errors to retry on
   */
  retryOn: RetryReason[];

  /**
   * Custom delays for specific error types (optional)
   * Overrides baseDelay for specific network errors
   */
  errorTypeDelays?: ErrorTypeDelays;

  /**
   * Maximum number of errors to keep in history (default: unlimited)
   * Set this to a number (e.g., 100) to prevent memory leaks in long-running
   * processes with many retries. Older errors are evicted when limit is reached.
   */
  maxErrorHistory?: number;
}

/**
 * Reasons to trigger a retry
 */
export type RetryReason =
  | "zero_output"
  | "guardrail_violation"
  | "drift"
  | "malformed"
  | "incomplete"
  | "network_error"
  | "timeout"
  | "rate_limit"
  | "server_error"
  | "pattern_violation";

/**
 * Error categories for retry decision-making
 */
export enum ErrorCategory {
  /**
   * Network failures - retry forever with backoff, doesn't count
   */
  NETWORK = "network",

  /**
   * Transient errors (429, 503, timeouts) - retry forever, doesn't count
   */
  TRANSIENT = "transient",

  /**
   * Model-side errors - count toward retry limit
   */
  MODEL = "model",

  /**
   * Fatal errors - don't retry
   */
  FATAL = "fatal",
}

/**
 * Retry state tracking
 */
export interface RetryState {
  /**
   * Current attempt number (model failures only)
   */
  attempt: number;

  /**
   * Network retry attempts (doesn't count toward limit)
   */
  networkRetries: number;

  /**
   * Transient retry attempts (doesn't count toward limit)
   */
  transientRetries: number;

  /**
   * Last error encountered
   */
  lastError?: CategorizedError;

  /**
   * History of all errors
   */
  errorHistory: CategorizedError[];

  /**
   * Total delay accumulated (ms)
   */
  totalDelay: number;

  /**
   * Whether retry limit has been reached
   */
  limitReached: boolean;
}

/**
 * Error with category classification
 */
export interface CategorizedError {
  /**
   * The original error
   */
  error: Error;

  /**
   * Error category
   */
  category: ErrorCategory;

  /**
   * The reason for retry
   */
  reason: RetryReason;

  /**
   * Whether this error counts toward retry limit
   */
  countsTowardLimit: boolean;

  /**
   * Whether this error is retryable
   */
  retryable: boolean;

  /**
   * Timestamp when error occurred
   */
  timestamp: number;

  /**
   * HTTP status code if applicable
   */
  statusCode?: number;
}

/**
 * Backoff calculation result
 */
export interface BackoffResult {
  /**
   * Delay in milliseconds
   */
  delay: number;

  /**
   * Whether backoff has reached max delay
   */
  cappedAtMax: boolean;

  /**
   * Calculated base delay before cap
   */
  rawDelay: number;
}

/**
 * Retry decision result
 */
export interface RetryDecision {
  /**
   * Whether to retry
   */
  shouldRetry: boolean;

  /**
   * Delay before retry (ms)
   */
  delay: number;

  /**
   * Reason for the decision
   */
  reason: string;

  /**
   * Error category
   */
  category: ErrorCategory;

  /**
   * Whether this retry counts toward limit
   */
  countsTowardLimit: boolean;
}

/**
 * Error classification for common cases
 */
export interface ErrorClassification {
  /**
   * Whether this is a network error
   */
  isNetwork: boolean;

  /**
   * Whether this is a rate limit error
   */
  isRateLimit: boolean;

  /**
   * Whether this is a server error (5xx)
   */
  isServerError: boolean;

  /**
   * Whether this is a timeout
   */
  isTimeout: boolean;

  /**
   * Whether this is an authentication error
   */
  isAuthError: boolean;

  /**
   * Whether this is a client error (4xx, non-429)
   */
  isClientError: boolean;

  /**
   * HTTP status code if applicable
   */
  statusCode?: number;
}

/**
 * Retry context passed to retry handlers
 */
export interface RetryContext {
  /**
   * Current retry state
   */
  state: RetryState;

  /**
   * Retry configuration
   */
  config: RetryConfig;

  /**
   * The error that triggered retry
   */
  error: CategorizedError;

  /**
   * Calculated backoff delay
   */
  backoff: BackoffResult;
}
