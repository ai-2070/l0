// Zod schemas for L0 Guardrail types

import { z } from "zod";
import type {
  GuardrailRule,
  GuardrailContext,
  GuardrailViolation,
  GuardrailState,
  GuardrailConfig,
  GuardrailResult,
  JsonStructure,
  MarkdownStructure,
  LatexStructure,
  PatternConfig,
  DriftConfig,
  FunctionCallStructure,
  SchemaValidation,
} from "../types/guardrails";

/**
 * Guardrail violation schema
 */
export const GuardrailViolationSchema = z.object({
  rule: z.string(),
  message: z.string(),
  severity: z.enum(["warning", "error", "fatal"]),
  position: z.number().optional(),
  recoverable: z.boolean(),
  timestamp: z.number().optional(),
  context: z.record(z.unknown()).optional(),
  suggestion: z.string().optional(),
}) satisfies z.ZodType<GuardrailViolation>;

/**
 * Guardrail context schema
 */
export const GuardrailContextSchema = z.object({
  content: z.string(),
  checkpoint: z.string().optional(),
  delta: z.string().optional(),
  tokenCount: z.number(),
  completed: z.boolean(),
  metadata: z.record(z.any()).optional(),
  previousViolations: z.array(GuardrailViolationSchema).optional(),
}) satisfies z.ZodType<GuardrailContext>;

/**
 * Guardrail rule schema
 * Note: check function cannot be validated with zod, using z.function()
 */
export const GuardrailRuleSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  check: z.function().args(GuardrailContextSchema).returns(z.array(GuardrailViolationSchema)),
  streaming: z.boolean().optional(),
  severity: z.enum(["warning", "error", "fatal"]).optional(),
  recoverable: z.boolean().optional(),
}) satisfies z.ZodType<GuardrailRule>;

/**
 * Guardrail state schema
 */
export const GuardrailStateSchema = z.object({
  violations: z.array(GuardrailViolationSchema),
  violationsByRule: z.map(z.string(), z.array(GuardrailViolationSchema)),
  hasFatalViolations: z.boolean(),
  hasErrorViolations: z.boolean(),
  violationCount: z.number(),
  lastCheckTime: z.number().optional(),
}) satisfies z.ZodType<GuardrailState>;

/**
 * Guardrail config schema
 */
export const GuardrailConfigSchema = z.object({
  rules: z.array(GuardrailRuleSchema),
  stopOnFatal: z.boolean().optional(),
  enableStreaming: z.boolean().optional(),
  checkInterval: z.number().optional(),
  onViolation: z.function().args(GuardrailViolationSchema).returns(z.void()).optional(),
  onPhaseStart: z
    .function()
    .args(z.enum(["pre", "post"]), z.number(), z.number())
    .returns(z.void())
    .optional(),
  onPhaseEnd: z
    .function()
    .args(z.enum(["pre", "post"]), z.boolean(), z.array(GuardrailViolationSchema), z.number())
    .returns(z.void())
    .optional(),
  onRuleStart: z.function().args(z.number(), z.string(), z.string()).returns(z.void()).optional(),
  onRuleEnd: z
    .function()
    .args(z.number(), z.string(), z.boolean(), z.string(), z.number())
    .returns(z.void())
    .optional(),
}) satisfies z.ZodType<GuardrailConfig>;

/**
 * Guardrail result schema
 */
export const GuardrailResultSchema = z.object({
  passed: z.boolean(),
  violations: z.array(GuardrailViolationSchema),
  shouldRetry: z.boolean(),
  shouldHalt: z.boolean(),
  summary: z.object({
    total: z.number(),
    fatal: z.number(),
    errors: z.number(),
    warnings: z.number(),
  }),
}) satisfies z.ZodType<GuardrailResult>;

/**
 * JSON structure tracking schema
 */
export const JsonStructureSchema = z.object({
  openBraces: z.number(),
  closeBraces: z.number(),
  openBrackets: z.number(),
  closeBrackets: z.number(),
  inString: z.boolean(),
  isBalanced: z.boolean(),
  issues: z.array(z.string()),
}) satisfies z.ZodType<JsonStructure>;

/**
 * Markdown structure tracking schema
 */
export const MarkdownStructureSchema = z.object({
  openFences: z.number(),
  fenceLanguages: z.array(z.string()),
  inFence: z.boolean(),
  headers: z.array(z.number()),
  listDepth: z.number(),
  issues: z.array(z.string()),
}) satisfies z.ZodType<MarkdownStructure>;

/**
 * LaTeX structure tracking schema
 */
export const LatexStructureSchema = z.object({
  openEnvironments: z.array(z.string()),
  isBalanced: z.boolean(),
  issues: z.array(z.string()),
}) satisfies z.ZodType<LatexStructure>;

/**
 * Pattern config schema
 */
export const PatternConfigSchema = z.object({
  patterns: z.array(z.union([z.string(), z.instanceof(RegExp)])),
  isBadPattern: z.boolean(),
  message: z.string().optional(),
  fatal: z.boolean().optional(),
}) satisfies z.ZodType<PatternConfig>;

/**
 * Drift config schema
 */
export const DriftConfigSchema = z.object({
  detectToneShift: z.boolean().optional(),
  detectMetaCommentary: z.boolean().optional(),
  detectRepetition: z.boolean().optional(),
  detectEntropySpike: z.boolean().optional(),
  entropyThreshold: z.number().optional(),
  repetitionThreshold: z.number().optional(),
}) satisfies z.ZodType<DriftConfig>;

/**
 * Function call structure schema
 */
export const FunctionCallStructureSchema = z.object({
  name: z.string().optional(),
  arguments: z.string().optional(),
  parsedArguments: z.record(z.any()).optional(),
  isValid: z.boolean(),
  errors: z.array(z.string()),
}) satisfies z.ZodType<FunctionCallStructure>;

/**
 * Schema validation result schema
 */
export const SchemaValidationSchema = z.object({
  valid: z.boolean(),
  errors: z.array(z.string()),
  parsed: z.any().optional(),
}) satisfies z.ZodType<SchemaValidation>;
