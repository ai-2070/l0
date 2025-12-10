// Zod schemas for L0 Structured Output types

import { z } from "zod4";
import type {
  StructuredOptions,
  StructuredResult,
  StructuredState,
  StructuredTelemetry,
  CorrectionInfo,
  CorrectionType,
  AutoCorrectOptions,
  AutoCorrectResult,
  StructuredPreset,
} from "../types/structured";
import { L0StateSchema, L0TelemetrySchema, RetryOptionsSchema } from "./l0";

/**
 * Correction type schema
 */
export const CorrectionTypeSchema = z.enum([
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
]) satisfies z.ZodType<CorrectionType>;

/**
 * Correction info schema
 */
export const CorrectionInfoSchema = z.object({
  original: z.string(),
  corrected: z.string(),
  corrections: z.array(CorrectionTypeSchema),
  success: z.boolean(),
}) satisfies z.ZodType<CorrectionInfo>;

/**
 * Auto-correct options schema
 */
export const AutoCorrectOptionsSchema = z.object({
  structural: z.boolean().optional(),
  stripFormatting: z.boolean().optional(),
  schemaBased: z.boolean().optional(),
  strict: z.boolean().optional(),
}) satisfies z.ZodType<AutoCorrectOptions>;

/**
 * Auto-correct result schema
 */
export const AutoCorrectResultSchema = z.object({
  corrected: z.string(),
  success: z.boolean(),
  corrections: z.array(CorrectionTypeSchema),
  error: z.instanceof(Error).optional(),
}) satisfies z.ZodType<AutoCorrectResult>;

/**
 * Structured state schema (extends L0State)
 */
export const StructuredStateSchema = L0StateSchema.extend({
  validationFailures: z.number(),
  autoCorrections: z.number(),
  validationErrors: z.array(z.any()), // z.ZodError instances
}) satisfies z.ZodType<StructuredState>;

/**
 * Structured telemetry schema (extends L0Telemetry)
 */
export const StructuredTelemetrySchema = L0TelemetrySchema.extend({
  structured: z.object({
    schemaName: z.string().optional(),
    validationAttempts: z.number(),
    validationFailures: z.number(),
    autoCorrections: z.number(),
    correctionTypes: z.array(z.string()),
    validationSuccess: z.boolean(),
    validationTime: z.number().optional(),
  }),
}) satisfies z.ZodType<StructuredTelemetry>;

/**
 * Structured options schema
 * Note: schema field is a Zod schema, which can be any z.ZodTypeAny
 */
export const StructuredOptionsSchema = z.object({
  schema: z.any(), // z.ZodTypeAny - cannot be validated at runtime
  stream: z.function().returns(z.any()),
  fallbackStreams: z.array(z.function().returns(z.any())).optional(),
  retry: RetryOptionsSchema.optional(),
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
      metadata: z.record(z.any()).optional(),
    })
    .optional(),
  detectZeroTokens: z.boolean().optional(),
  onValidationError: z
    .function()
    .args(z.any(), z.number())
    .returns(z.void())
    .optional(),
  onAutoCorrect: z
    .function()
    .args(CorrectionInfoSchema)
    .returns(z.void())
    .optional(),
  onRetry: z
    .function()
    .args(z.number(), z.string())
    .returns(z.void())
    .optional(),
}) satisfies z.ZodType<StructuredOptions>;

/**
 * Structured result schema
 */
export const StructuredResultSchema = z.object({
  data: z.any(),
  raw: z.string(),
  corrected: z.boolean(),
  corrections: z.array(z.string()),
  state: StructuredStateSchema,
  telemetry: StructuredTelemetrySchema.optional(),
  errors: z.array(z.instanceof(Error)),
  abort: z.function().returns(z.void()),
}) satisfies z.ZodType<StructuredResult<unknown>>;

/**
 * Structured preset schema
 */
export const StructuredPresetSchema = z.object({
  name: z.string(),
  autoCorrect: z.boolean(),
  strictMode: z.boolean(),
  retry: RetryOptionsSchema,
}) satisfies z.ZodType<StructuredPreset>;
