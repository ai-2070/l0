// Zod schemas for L0 Retry types

import { z } from "zod4";
import type {
  ErrorTypeDelays,
  RetryConfig,
  RetryReason,
  BackoffStrategy,
  RetryState,
  CategorizedError,
  BackoffResult,
  RetryDecision,
  ErrorClassification,
  RetryContext,
} from "../types/retry";
import { ErrorCategory } from "../types/retry";

/**
 * Per-error-type delay configuration schema
 */
export const ErrorTypeDelaysSchema: z.ZodType<ErrorTypeDelays> = z.object({
  connectionDropped: z.number().optional(),
  fetchError: z.number().optional(),
  econnreset: z.number().optional(),
  econnrefused: z.number().optional(),
  sseAborted: z.number().optional(),
  noBytes: z.number().optional(),
  partialChunks: z.number().optional(),
  runtimeKilled: z.number().optional(),
  backgroundThrottle: z.number().optional(),
  dnsError: z.number().optional(),
  timeout: z.number().optional(),
  unknown: z.number().optional(),
});

/**
 * Retry reason schema
 */
export const RetryReasonSchema: z.ZodType<RetryReason> = z.enum([
  "zero_output",
  "guardrail_violation",
  "drift",
  "unknown",
  "incomplete",
  "network_error",
  "timeout",
  "rate_limit",
  "server_error",
]);

/**
 * Backoff strategy schema
 */
export const BackoffStrategySchema: z.ZodType<BackoffStrategy> = z.enum([
  "exponential",
  "linear",
  "fixed",
  "full-jitter",
  "fixed-jitter",
]);

/**
 * Error category schema
 */
export const ErrorCategorySchema = z.nativeEnum(ErrorCategory);

/**
 * Retry configuration schema
 */
export const RetryConfigSchema: z.ZodType<RetryConfig> = z.object({
  attempts: z.number(),
  maxRetries: z.number().optional(),
  baseDelay: z.number(),
  maxDelay: z.number().optional(),
  backoff: BackoffStrategySchema,
  retryOn: z.array(RetryReasonSchema),
  errorTypeDelays: ErrorTypeDelaysSchema.optional(),
  maxErrorHistory: z.number().optional(),
});

/**
 * Categorized error schema
 */
export const CategorizedErrorSchema: z.ZodType<CategorizedError> = z.object({
  error: z.instanceof(Error),
  category: ErrorCategorySchema,
  reason: RetryReasonSchema,
  countsTowardLimit: z.boolean(),
  retryable: z.boolean(),
  timestamp: z.number(),
  statusCode: z.number().optional(),
});

/**
 * Retry state schema
 */
export const RetryStateSchema: z.ZodType<RetryState> = z.object({
  attempt: z.number(),
  networkRetryCount: z.number(),
  transientRetries: z.number(),
  lastError: CategorizedErrorSchema.optional(),
  errorHistory: z.array(CategorizedErrorSchema),
  totalDelay: z.number(),
  limitReached: z.boolean(),
});

/**
 * Backoff result schema
 */
export const BackoffResultSchema: z.ZodType<BackoffResult> = z.object({
  delay: z.number(),
  cappedAtMax: z.boolean(),
  rawDelay: z.number(),
});

/**
 * Retry decision schema
 */
export const RetryDecisionSchema: z.ZodType<RetryDecision> = z.object({
  shouldRetry: z.boolean(),
  delay: z.number(),
  reason: z.string(),
  category: ErrorCategorySchema,
  countsTowardLimit: z.boolean(),
});

/**
 * Error classification schema
 */
export const ErrorClassificationSchema: z.ZodType<ErrorClassification> =
  z.object({
    isNetwork: z.boolean(),
    isRateLimit: z.boolean(),
    isServerError: z.boolean(),
    isTimeout: z.boolean(),
    isAuthError: z.boolean(),
    isClientError: z.boolean(),
    statusCode: z.number().optional(),
  });

/**
 * Retry context schema
 */
export const RetryContextSchema: z.ZodType<RetryContext> = z.object({
  state: RetryStateSchema,
  config: RetryConfigSchema,
  error: CategorizedErrorSchema,
  backoff: BackoffResultSchema,
});
