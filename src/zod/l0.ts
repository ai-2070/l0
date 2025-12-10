// Zod schemas for core L0 types

import { z } from "zod4";
import type {
  CheckpointValidationResult,
  L0ContentType,
  L0DataPayload,
  L0Progress,
  L0Event,
  L0State,
  L0Telemetry,
  CategorizedNetworkError,
} from "../types/l0";
import { GuardrailViolationSchema } from "./guardrails";
import {
  BackoffStrategySchema,
  RetryReasonSchema,
  ErrorCategorySchema,
} from "./retry";

/**
 * L0 content type schema
 */
export const L0ContentTypeSchema: z.ZodType<L0ContentType> = z.enum([
  "text",
  "image",
  "audio",
  "video",
  "file",
  "json",
  "binary",
]);

/**
 * L0 data payload schema
 */
export const L0DataPayloadSchema: z.ZodType<L0DataPayload> = z.object({
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
});

/**
 * L0 progress schema
 */
export const L0ProgressSchema: z.ZodType<L0Progress> = z.object({
  percent: z.number().optional(),
  step: z.number().optional(),
  totalSteps: z.number().optional(),
  message: z.string().optional(),
  eta: z.number().optional(),
});

/**
 * L0 event schema
 */
export const L0EventSchema: z.ZodType<L0Event> = z.object({
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
});

/**
 * Categorized network error schema
 */
export const CategorizedNetworkErrorSchema: z.ZodType<CategorizedNetworkError> =
  z.object({
    type: z.string(),
    message: z.string(),
    timestamp: z.number(),
    retried: z.boolean(),
    delay: z.number().optional(),
    attempt: z.number().optional(),
  });

/**
 * L0 state schema
 */
export const L0StateSchema: z.ZodType<L0State> = z.object({
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
});

/**
 * L0 telemetry schema
 */
export const L0TelemetrySchema: z.ZodType<L0Telemetry> = z.object({
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
    errorsByType: z.record(z.string(), z.number()),
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
      violationsByRule: z.record(z.string(), z.number()),
      violationsByRuleAndSeverity: z.record(
        z.string(),
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
  metadata: z.record(z.string(), z.any()).optional(),
});

/**
 * Checkpoint validation result schema
 */
export const CheckpointValidationResultSchema: z.ZodType<CheckpointValidationResult> =
  z.object({
    skipContinuation: z.boolean(),
    violations: z.array(GuardrailViolationSchema),
    driftDetected: z.boolean(),
    driftTypes: z.array(z.string()),
  });

/**
 * Retry options schema
 * Note: Contains function properties - no explicit type annotation to avoid Zod 4 function type issues
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
  calculateDelay: z.function().optional(),
  shouldRetry: z.function().optional(),
});

/**
 * L0 adapter schema
 * Note: Contains function properties - no explicit type annotation
 */
export const L0AdapterSchema = z.object({
  name: z.string(),
  detect: z.function().optional(),
  wrap: z.function(),
});

/**
 * L0 interceptor schema
 * Note: Contains function properties - no explicit type annotation
 */
export const L0InterceptorSchema = z.object({
  name: z.string().optional(),
  before: z.function().optional(),
  after: z.function().optional(),
  onError: z.function().optional(),
});

/**
 * L0 options schema
 * Note: Contains function properties - no explicit type annotation
 */
export const L0OptionsSchema = z.object({
  __outputType: z.unknown().optional(),
  stream: z.function(),
  context: z.record(z.string(), z.unknown()).optional(),
  fallbackStreams: z.array(z.function()).optional(),
  guardrails: z.array(z.any()).optional(), // GuardrailRule has function, use any
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
      metadata: z.record(z.string(), z.any()).optional(),
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
  buildContinuationPrompt: z.function().optional(),
  deduplicateContinuation: z.boolean().optional(),
  deduplicationOptions: z
    .object({
      minOverlap: z.number().optional(),
      maxOverlap: z.number().optional(),
      caseSensitive: z.boolean().optional(),
      normalizeWhitespace: z.boolean().optional(),
    })
    .optional(),
  onStart: z.function().optional(),
  onComplete: z.function().optional(),
  onError: z.function().optional(),
  onEvent: z.function().optional(),
  onViolation: z.function().optional(),
  onRetry: z.function().optional(),
  onFallback: z.function().optional(),
  onResume: z.function().optional(),
  onCheckpoint: z.function().optional(),
  onTimeout: z.function().optional(),
  onAbort: z.function().optional(),
  onDrift: z.function().optional(),
  onToolCall: z.function().optional(),
  interceptors: z.array(L0InterceptorSchema).optional(),
  adapter: z.union([L0AdapterSchema, z.string()]).optional(),
  adapterOptions: z.unknown().optional(),
});

/**
 * L0 result schema
 * Note: Contains function properties - no explicit type annotation
 */
export const L0ResultSchema = z.object({
  __outputType: z.unknown().optional(),
  stream: z.any(), // AsyncIterable can't be validated
  text: z.string().optional(),
  state: L0StateSchema,
  errors: z.array(z.instanceof(Error)),
  telemetry: L0TelemetrySchema.optional(),
  abort: z.function(),
});
