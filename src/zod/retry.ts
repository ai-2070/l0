// Zod schemas for L0 Retry types

import { z } from "zod";
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
export const ErrorTypeDelaysSchema = z.object({
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
}) satisfies z.ZodType<ErrorTypeDelays>;

/**
 * Retry reason schema
 */
export const RetryReasonSchema = z.enum([
  "zero_output",
  "guardrail_violation",
  "drift",
  "unknown",
  "incomplete",
  "network_error",
  "timeout",
  "rate_limit",
  "server_error",
]) satisfies z.ZodType<RetryReason>;

/**
 * Backoff strategy schema
 */
export const BackoffStrategySchema = z.enum([
  "exponential",
  "linear",
  "fixed",
  "full-jitter",
  "fixed-jitter",
]) satisfies z.ZodType<BackoffStrategy>;

/**
 * Error category schema
 */
export const ErrorCategorySchema = z.nativeEnum(ErrorCategory);

/**
 * Retry configuration schema
 */
export const RetryConfigSchema = z.object({
  attempts: z.number(),
  maxRetries: z.number().optional(),
  baseDelay: z.number(),
  maxDelay: z.number().optional(),
  backoff: BackoffStrategySchema,
  retryOn: z.array(RetryReasonSchema),
  errorTypeDelays: ErrorTypeDelaysSchema.optional(),
  maxErrorHistory: z.number().optional(),
}) satisfies z.ZodType<RetryConfig>;

/**
 * Categorized error schema
 */
export const CategorizedErrorSchema = z.object({
  error: z.instanceof(Error),
  category: ErrorCategorySchema,
  reason: RetryReasonSchema,
  countsTowardLimit: z.boolean(),
  retryable: z.boolean(),
  timestamp: z.number(),
  statusCode: z.number().optional(),
}) satisfies z.ZodType<CategorizedError>;

/**
 * Retry state schema
 */
export const RetryStateSchema = z.object({
  attempt: z.number(),
  networkRetryCount: z.number(),
  transientRetries: z.number(),
  lastError: CategorizedErrorSchema.optional(),
  errorHistory: z.array(CategorizedErrorSchema),
  totalDelay: z.number(),
  limitReached: z.boolean(),
}) satisfies z.ZodType<RetryState>;

/**
 * Backoff result schema
 */
export const BackoffResultSchema = z.object({
  delay: z.number(),
  cappedAtMax: z.boolean(),
  rawDelay: z.number(),
}) satisfies z.ZodType<BackoffResult>;

/**
 * Retry decision schema
 */
export const RetryDecisionSchema = z.object({
  shouldRetry: z.boolean(),
  delay: z.number(),
  reason: z.string(),
  category: ErrorCategorySchema,
  countsTowardLimit: z.boolean(),
}) satisfies z.ZodType<RetryDecision>;

/**
 * Error classification schema
 */
export const ErrorClassificationSchema = z.object({
  isNetwork: z.boolean(),
  isRateLimit: z.boolean(),
  isServerError: z.boolean(),
  isTimeout: z.boolean(),
  isAuthError: z.boolean(),
  isClientError: z.boolean(),
  statusCode: z.number().optional(),
}) satisfies z.ZodType<ErrorClassification>;

/**
 * Retry context schema
 */
export const RetryContextSchema = z.object({
  state: RetryStateSchema,
  config: RetryConfigSchema,
  error: CategorizedErrorSchema,
  backoff: BackoffResultSchema,
}) satisfies z.ZodType<RetryContext>;
