// Types for L0 Structured Output API

import type { z } from "zod";
import type { L0State, L0Telemetry, RetryOptions } from "./l0";

/**
 * Options for structured output generation
 */
export interface StructuredOptions<T extends z.ZodTypeAny = z.ZodTypeAny> {
  /**
   * Zod schema to validate output against
   */
  schema: T;

  /**
   * Function that returns a streamText() result from Vercel AI SDK
   */
  stream: () => Promise<any> | any;

  /**
   * Optional fallback stream functions to try if primary stream fails
   */
  fallbackStreams?: Array<() => Promise<any> | any>;

  /**
   * Retry configuration
   */
  retry?: RetryOptions;

  /**
   * Enable automatic correction of common JSON issues
   * @default true
   */
  autoCorrect?: boolean;

  /**
   * Strict mode: reject unknown fields in output
   * @default false
   */
  strictMode?: boolean;

  /**
   * Timeout configuration (in milliseconds)
   */
  timeout?: {
    /**
     * Maximum time to wait for the first token (default: 6000ms)
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
     * Custom metadata to attach to all events
     */
    metadata?: Record<string, any>;
  };

  /**
   * Detect zero-token outputs (likely API issues)
   * @default true
   */
  detectZeroTokens?: boolean;

  /**
   * Optional callback for validation errors (before retry)
   */
  onValidationError?: (error: z.ZodError, attempt: number) => void;

  /**
   * Optional callback for auto-correction events
   */
  onAutoCorrect?: (corrections: CorrectionInfo) => void;

  /**
   * Optional callback for retry attempts
   */
  onRetry?: (attempt: number, reason: string) => void;
}

/**
 * Result from structured output generation
 */
export interface StructuredResult<T> {
  /**
   * Validated and typed data matching the schema
   */
  data: T;

  /**
   * Raw JSON string before parsing
   */
  raw: string;

  /**
   * Whether auto-correction was applied
   */
  corrected: boolean;

  /**
   * List of corrections that were applied
   */
  corrections: string[];

  /**
   * L0 runtime state
   */
  state: StructuredState;

  /**
   * Telemetry data (if monitoring enabled)
   */
  telemetry?: StructuredTelemetry;

  /**
   * Any errors that occurred during retries
   */
  errors: Error[];

  /**
   * Abort controller for canceling the stream
   */
  abort: () => void;
}

/**
 * Extended state for structured output
 */
export interface StructuredState extends L0State {
  /**
   * Number of validation failures
   */
  validationFailures: number;

  /**
   * Number of auto-corrections applied
   */
  autoCorrections: number;

  /**
   * Schema validation errors encountered
   */
  validationErrors: z.ZodError[];
}

/**
 * Extended telemetry for structured output
 */
export interface StructuredTelemetry extends L0Telemetry {
  /**
   * Structured output specific metrics
   */
  structured: {
    /**
     * Schema name or description
     */
    schemaName?: string;

    /**
     * Number of validation attempts
     */
    validationAttempts: number;

    /**
     * Number of validation failures
     */
    validationFailures: number;

    /**
     * Number of auto-corrections applied
     */
    autoCorrections: number;

    /**
     * Types of corrections applied
     */
    correctionTypes: string[];

    /**
     * Final validation success
     */
    validationSuccess: boolean;

    /**
     * Time spent on validation (ms)
     */
    validationTime?: number;
  };
}

/**
 * Information about auto-corrections applied
 */
export interface CorrectionInfo {
  /**
   * Original raw output
   */
  original: string;

  /**
   * Corrected output
   */
  corrected: string;

  /**
   * List of corrections applied
   */
  corrections: CorrectionType[];

  /**
   * Whether all corrections were successful
   */
  success: boolean;
}

/**
 * Types of corrections that can be applied
 */
export type CorrectionType =
  | "close_brace"
  | "close_bracket"
  | "remove_trailing_comma"
  | "strip_markdown_fence"
  | "strip_json_prefix"
  | "remove_prefix_text"
  | "remove_suffix_text"
  | "fix_quotes"
  | "remove_comments"
  | "escape_control_chars"
  | "fill_missing_fields"
  | "remove_unknown_fields"
  | "coerce_types"
  | "extract_json";

/**
 * Auto-correction options
 */
export interface AutoCorrectOptions {
  /**
   * Enable structural fixes (braces, brackets, commas)
   * @default true
   */
  structural?: boolean;

  /**
   * Enable stripping markdown and prefixes
   * @default true
   */
  stripFormatting?: boolean;

  /**
   * Enable schema-based corrections (fill missing fields, etc.)
   * @default true
   */
  schemaBased?: boolean;

  /**
   * Strict mode: reject unknown fields
   * @default false
   */
  strict?: boolean;
}

/**
 * Result of auto-correction attempt
 */
export interface AutoCorrectResult {
  /**
   * Corrected JSON string
   */
  corrected: string;

  /**
   * Whether correction was successful
   */
  success: boolean;

  /**
   * List of corrections applied
   */
  corrections: CorrectionType[];

  /**
   * Error if correction failed
   */
  error?: Error;
}

/**
 * Preset structured output configurations
 */
export interface StructuredPreset {
  /**
   * Name of the preset
   */
  name: string;

  /**
   * Auto-correction enabled
   */
  autoCorrect: boolean;

  /**
   * Strict mode
   */
  strictMode: boolean;

  /**
   * Retry configuration
   */
  retry: RetryOptions;
}

/**
 * Minimal preset - fast failure, minimal corrections
 */
export const minimalStructured: Partial<StructuredOptions> = {
  autoCorrect: false,
  strictMode: false,
  retry: {
    attempts: 1,
    backoff: "fixed",
    baseDelay: 500,
  },
};

/**
 * Recommended preset - balanced reliability and performance
 */
export const recommendedStructured: Partial<StructuredOptions> = {
  autoCorrect: true,
  strictMode: false,
  retry: {
    attempts: 2,
    backoff: "exponential",
    baseDelay: 1000,
    maxDelay: 5000,
  },
};

/**
 * Strict preset - maximum validation, auto-correction, retries
 */
export const strictStructured: Partial<StructuredOptions> = {
  autoCorrect: true,
  strictMode: true,
  retry: {
    attempts: 3,
    backoff: "exponential",
    baseDelay: 1000,
    maxDelay: 10000,
  },
};
