// Zod schemas for core L0 types

import { z } from "zod4";
import type {
  CheckpointValidationResult,
  L0ContentType,
  L0DataPayload,
  L0Progress,
  L0Event,
  L0Options,
  L0Adapter,
  L0Interceptor,
  L0Result,
  L0State,
  L0Telemetry,
  CategorizedNetworkError,
  RetryOptions,
} from "../types/l0";
import { GuardrailViolationSchema, GuardrailRuleSchema } from "./guardrails";
import {
  BackoffStrategySchema,
  RetryReasonSchema,
  ErrorCategorySchema,
} from "./retry";

/**
 * L0 content type schema
 */
export const L0ContentTypeSchema = z.enum([
  "text",
  "image",
  "audio",
  "video",
  "file",
  "json",
  "binary",
]) satisfies z.ZodType<L0ContentType>;

/**
 * L0 data payload schema
 */
export const L0DataPayloadSchema = z.object({
  contentType: L0ContentTypeSchema,
  mimeType: z.string().optional(),
  base64: z.string().optional(),
  url: z.string().optional(),
  bytes: z.instanceof(Uint8Array).optional(),
  json: z.unknown().optional(),
  metadata: z
    .object({
      width: z.number().optional(),
      height: z.number().optional(),
      duration: z.number().optional(),
      size: z.number().optional(),
      filename: z.string().optional(),
      seed: z.number().optional(),
      model: z.string().optional(),
    })
    .catchall(z.unknown())
    .optional(),
}) satisfies z.ZodType<L0DataPayload>;

/**
 * L0 progress schema
 */
export const L0ProgressSchema = z.object({
  percent: z.number().optional(),
  step: z.number().optional(),
  totalSteps: z.number().optional(),
  message: z.string().optional(),
  eta: z.number().optional(),
}) satisfies z.ZodType<L0Progress>;

/**
 * L0 event schema
 */
export const L0EventSchema = z.object({
  type: z.enum(["token", "message", "data", "progress", "error", "complete"]),
  value: z.string().optional(),
  role: z.string().optional(),
  data: L0DataPayloadSchema.optional(),
  progress: L0ProgressSchema.optional(),
  error: z.instanceof(Error).optional(),
  reason: ErrorCategorySchema.optional(),
  timestamp: z.number().optional(),
  usage: z
    .object({
      input_tokens: z.number().optional(),
      output_tokens: z.number().optional(),
      cost: z.number().optional(),
    })
    .catchall(z.unknown())
    .optional(),
}) satisfies z.ZodType<L0Event>;

/**
 * Categorized network error schema
 */
export const CategorizedNetworkErrorSchema = z.object({
  type: z.string(),
  message: z.string(),
  timestamp: z.number(),
  retried: z.boolean(),
  delay: z.number().optional(),
  attempt: z.number().optional(),
}) satisfies z.ZodType<CategorizedNetworkError>;

/**
 * L0 state schema
 */
export const L0StateSchema = z.object({
  content: z.string(),
  checkpoint: z.string(),
  tokenCount: z.number(),
  modelRetryCount: z.number(),
  networkRetryCount: z.number(),
  fallbackIndex: z.number(),
  violations: z.array(GuardrailViolationSchema),
  driftDetected: z.boolean(),
  completed: z.boolean(),
  firstTokenAt: z.number().optional(),
  lastTokenAt: z.number().optional(),
  duration: z.number().optional(),
  networkErrors: z.array(CategorizedNetworkErrorSchema),
  resumed: z.boolean(),
  resumePoint: z.string().optional(),
  resumeFrom: z.number().optional(),
  dataOutputs: z.array(L0DataPayloadSchema),
  lastProgress: L0ProgressSchema.optional(),
  toolCallStartTimes: z.map(z.string(), z.number()).optional(),
  toolCallNames: z.map(z.string(), z.string()).optional(),
}) satisfies z.ZodType<L0State>;

/**
 * L0 telemetry schema
 */
export const L0TelemetrySchema = z.object({
  sessionId: z.string(),
  startTime: z.number(),
  endTime: z.number().optional(),
  duration: z.number().optional(),
  metrics: z.object({
    timeToFirstToken: z.number().optional(),
    avgInterTokenTime: z.number().optional(),
    tokensPerSecond: z.number().optional(),
    totalTokens: z.number(),
    totalRetries: z.number(),
    networkRetryCount: z.number(),
    modelRetryCount: z.number(),
  }),
  network: z.object({
    errorCount: z.number(),
    errorsByType: z.record(z.number()),
    errors: z
      .array(
        z.object({
          type: z.string(),
          message: z.string(),
          timestamp: z.number(),
          retried: z.boolean(),
          delay: z.number().optional(),
        }),
      )
      .optional(),
  }),
  guardrails: z
    .object({
      violationCount: z.number(),
      violationsByRule: z.record(z.number()),
      violationsByRuleAndSeverity: z.record(
        z.object({
          warning: z.number(),
          error: z.number(),
          fatal: z.number(),
        }),
      ),
      violationsBySeverity: z.object({
        warning: z.number(),
        error: z.number(),
        fatal: z.number(),
      }),
    })
    .optional(),
  drift: z
    .object({
      detected: z.boolean(),
      types: z.array(z.string()),
    })
    .optional(),
  continuation: z
    .object({
      enabled: z.boolean(),
      used: z.boolean(),
      checkpointContent: z.string().optional(),
      checkpointLength: z.number().optional(),
      continuationCount: z.number().optional(),
    })
    .optional(),
  metadata: z.record(z.any()).optional(),
}) satisfies z.ZodType<L0Telemetry>;

/**
 * Checkpoint validation result schema
 */
export const CheckpointValidationResultSchema = z.object({
  skipContinuation: z.boolean(),
  violations: z.array(GuardrailViolationSchema),
  driftDetected: z.boolean(),
  driftTypes: z.array(z.string()),
}) satisfies z.ZodType<CheckpointValidationResult>;

/**
 * Retry options schema
 */
export const RetryOptionsSchema = z.object({
  attempts: z.number().optional(),
  maxRetries: z.number().optional(),
  backoff: BackoffStrategySchema.optional(),
  baseDelay: z.number().optional(),
  maxDelay: z.number().optional(),
  retryOn: z.array(RetryReasonSchema).optional(),
  errorTypeDelays: z
    .object({
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
    })
    .optional(),
  calculateDelay: z
    .function()
    .args(
      z.object({
        attempt: z.number(),
        totalAttempts: z.number(),
        category: ErrorCategorySchema,
        reason: z.string(),
        error: z.instanceof(Error),
        defaultDelay: z.number(),
      }),
    )
    .returns(z.union([z.number(), z.undefined()]))
    .optional(),
  shouldRetry: z
    .function()
    .args(z.instanceof(Error), L0StateSchema, z.number(), ErrorCategorySchema)
    .returns(z.promise(z.boolean()))
    .optional(),
}) satisfies z.ZodType<RetryOptions>;

/**
 * L0 adapter schema
 */
export const L0AdapterSchema = z.object({
  name: z.string(),
  detect: z.function().args(z.unknown()).returns(z.boolean()).optional(),
  wrap: z.function().args(z.unknown(), z.unknown().optional()).returns(z.any()),
}) satisfies z.ZodType<L0Adapter>;

/**
 * L0 interceptor schema
 */
export const L0InterceptorSchema = z.object({
  name: z.string().optional(),
  before: z.function().args(z.any()).returns(z.any()).optional(),
  after: z.function().args(z.any()).returns(z.any()).optional(),
  onError: z
    .function()
    .args(z.instanceof(Error), z.any())
    .returns(z.any())
    .optional(),
}) satisfies z.ZodType<L0Interceptor>;

/**
 * L0 options schema
 */
export const L0OptionsSchema = z.object({
  __outputType: z.unknown().optional(),
  stream: z.function().returns(z.any()),
  context: z.record(z.unknown()).optional(),
  fallbackStreams: z.array(z.function().returns(z.any())).optional(),
  guardrails: z.array(GuardrailRuleSchema).optional(),
  retry: RetryOptionsSchema.optional(),
  timeout: z
    .object({
      initialToken: z.number().optional(),
      interToken: z.number().optional(),
    })
    .optional(),
  signal: z.instanceof(AbortSignal).optional(),
  monitoring: z
    .object({
      enabled: z.boolean().optional(),
      sampleRate: z.number().optional(),
      includeNetworkDetails: z.boolean().optional(),
      includeTimings: z.boolean().optional(),
      metadata: z.record(z.any()).optional(),
    })
    .optional(),
  checkIntervals: z
    .object({
      guardrails: z.number().optional(),
      drift: z.number().optional(),
      checkpoint: z.number().optional(),
    })
    .optional(),
  detectDrift: z.boolean().optional(),
  detectZeroTokens: z.boolean().optional(),
  continueFromLastKnownGoodToken: z.boolean().optional(),
  buildContinuationPrompt: z
    .function()
    .args(z.string())
    .returns(z.string())
    .optional(),
  deduplicateContinuation: z.boolean().optional(),
  deduplicationOptions: z
    .object({
      minOverlap: z.number().optional(),
      maxOverlap: z.number().optional(),
      caseSensitive: z.boolean().optional(),
      normalizeWhitespace: z.boolean().optional(),
    })
    .optional(),
  onStart: z
    .function()
    .args(z.number(), z.boolean(), z.boolean())
    .returns(z.void())
    .optional(),
  onComplete: z.function().args(L0StateSchema).returns(z.void()).optional(),
  onError: z
    .function()
    .args(z.instanceof(Error), z.boolean(), z.boolean())
    .returns(z.void())
    .optional(),
  onEvent: z.function().args(z.any()).returns(z.void()).optional(),
  onViolation: z
    .function()
    .args(GuardrailViolationSchema)
    .returns(z.void())
    .optional(),
  onRetry: z
    .function()
    .args(z.number(), z.string())
    .returns(z.void())
    .optional(),
  onFallback: z
    .function()
    .args(z.number(), z.string())
    .returns(z.void())
    .optional(),
  onResume: z
    .function()
    .args(z.string(), z.number())
    .returns(z.void())
    .optional(),
  onCheckpoint: z
    .function()
    .args(z.string(), z.number())
    .returns(z.void())
    .optional(),
  onTimeout: z
    .function()
    .args(z.enum(["initial", "inter"]), z.number())
    .returns(z.void())
    .optional(),
  onAbort: z
    .function()
    .args(z.number(), z.number())
    .returns(z.void())
    .optional(),
  onDrift: z
    .function()
    .args(z.array(z.string()), z.number().optional())
    .returns(z.void())
    .optional(),
  onToolCall: z
    .function()
    .args(z.string(), z.string(), z.record(z.unknown()))
    .returns(z.void())
    .optional(),
  interceptors: z.array(L0InterceptorSchema).optional(),
  adapter: z.union([L0AdapterSchema, z.string()]).optional(),
  adapterOptions: z.unknown().optional(),
}) satisfies z.ZodType<L0Options>;

/**
 * L0 result schema
 */
export const L0ResultSchema = z.object({
  __outputType: z.unknown().optional(),
  stream: z.any(),
  text: z.string().optional(),
  state: L0StateSchema,
  errors: z.array(z.instanceof(Error)),
  telemetry: L0TelemetrySchema.optional(),
  abort: z.function().returns(z.void()),
}) satisfies z.ZodType<L0Result>;
