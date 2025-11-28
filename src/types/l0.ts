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
}

/**
 * Retry configuration options
 */
export interface RetryOptions {
  /**
   * Maximum retry attempts for model failures (default: 2)
   */
  attempts?: number;

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
