// Zod schemas for L0 Structured Output types

import { z } from "zod4";
import type {
  StructuredState,
  StructuredTelemetry,
  CorrectionInfo,
  CorrectionType,
  AutoCorrectOptions,
  AutoCorrectResult,
} from "../types/structured";

/**
 * Correction type schema
 */
export const CorrectionTypeSchema: z.ZodType<CorrectionType> = z.enum([
  "close_brace",
  "close_bracket",
  "remove_trailing_comma",
  "strip_markdown_fence",
  "strip_json_prefix",
  "remove_prefix_text",
  "remove_suffix_text",
  "fix_quotes",
  "remove_comments",
  "escape_control_chars",
  "fill_missing_fields",
  "remove_unknown_fields",
  "coerce_types",
  "extract_json",
]);

/**
 * Correction info schema
 */
export const CorrectionInfoSchema: z.ZodType<CorrectionInfo> = z.object({
  original: z.string(),
  corrected: z.string(),
  corrections: z.array(CorrectionTypeSchema),
  success: z.boolean(),
});

/**
 * Auto-correct options schema
 */
export const AutoCorrectOptionsSchema: z.ZodType<AutoCorrectOptions> = z.object(
  {
    structural: z.boolean().optional(),
    stripFormatting: z.boolean().optional(),
    schemaBased: z.boolean().optional(),
    strict: z.boolean().optional(),
  },
);

/**
 * Auto-correct result schema
 */
export const AutoCorrectResultSchema: z.ZodType<AutoCorrectResult> = z.object({
  corrected: z.string(),
  success: z.boolean(),
  corrections: z.array(CorrectionTypeSchema),
  error: z.instanceof(Error).optional(),
});

/**
 * Structured state schema (extends L0State)
 */
export const StructuredStateSchema: z.ZodType<StructuredState> = z.object({
  // L0State fields
  content: z.string(),
  checkpoint: z.string(),
  tokenCount: z.number(),
  modelRetryCount: z.number(),
  networkRetryCount: z.number(),
  fallbackIndex: z.number(),
  violations: z.array(z.any()), // GuardrailViolation[]
  driftDetected: z.boolean(),
  completed: z.boolean(),
  firstTokenAt: z.number().optional(),
  lastTokenAt: z.number().optional(),
  duration: z.number().optional(),
  networkErrors: z.array(z.any()),
  resumed: z.boolean(),
  resumePoint: z.string().optional(),
  resumeFrom: z.number().optional(),
  dataOutputs: z.array(z.any()),
  lastProgress: z.any().optional(),
  toolCallStartTimes: z.map(z.string(), z.number()).optional(),
  toolCallNames: z.map(z.string(), z.string()).optional(),
  // StructuredState additions
  validationFailures: z.number(),
  autoCorrections: z.number(),
  validationErrors: z.array(z.any()), // z.ZodError instances
});

/**
 * Structured telemetry schema (extends L0Telemetry)
 */
export const StructuredTelemetrySchema: z.ZodType<StructuredTelemetry> =
  z.object({
    // L0Telemetry fields
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
      errors: z.array(z.any()).optional(),
    }),
    guardrails: z.any().optional(),
    drift: z.any().optional(),
    continuation: z.any().optional(),
    metadata: z.record(z.string(), z.any()).optional(),
    // StructuredTelemetry additions
    structured: z.object({
      schemaName: z.string().optional(),
      validationAttempts: z.number(),
      validationFailures: z.number(),
      autoCorrections: z.number(),
      correctionTypes: z.array(z.string()),
      validationSuccess: z.boolean(),
      validationTime: z.number().optional(),
    }),
  });

/**
 * Structured options schema
 * Note: Contains function properties - no explicit type annotation
 */
export const StructuredOptionsSchema = z.object({
  schema: z.any(), // z.ZodTypeAny - cannot be validated at runtime
  stream: z.function(),
  fallbackStreams: z.array(z.function()).optional(),
  retry: z.any().optional(), // RetryOptions has functions
  autoCorrect: z.boolean().optional(),
  strictMode: z.boolean().optional(),
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
      metadata: z.record(z.string(), z.any()).optional(),
    })
    .optional(),
  detectZeroTokens: z.boolean().optional(),
  onValidationError: z.function().optional(),
  onAutoCorrect: z.function().optional(),
  onRetry: z.function().optional(),
});

/**
 * Structured result schema
 * Note: Contains function property (abort) - no explicit type annotation
 */
export const StructuredResultSchema = z.object({
  data: z.any(),
  raw: z.string(),
  corrected: z.boolean(),
  corrections: z.array(z.string()),
  state: StructuredStateSchema,
  telemetry: StructuredTelemetrySchema.optional(),
  errors: z.array(z.instanceof(Error)),
  abort: z.function(),
});

/**
 * Structured preset schema
 * Note: Contains RetryOptions which has functions - no explicit type annotation
 */
export const StructuredPresetSchema = z.object({
  name: z.string(),
  autoCorrect: z.boolean(),
  strictMode: z.boolean(),
  retry: z.any(), // RetryOptions has functions
});
