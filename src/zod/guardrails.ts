// Zod schemas for L0 Guardrail types

import { z } from "zod4";
import type {
  GuardrailViolation,
  GuardrailContext,
  GuardrailState,
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
export const GuardrailViolationSchema: z.ZodType<GuardrailViolation> = z.object(
  {
    rule: z.string(),
    message: z.string(),
    severity: z.enum(["warning", "error", "fatal"]),
    position: z.number().optional(),
    recoverable: z.boolean(),
    timestamp: z.number().optional(),
    context: z.record(z.string(), z.unknown()).optional(),
    suggestion: z.string().optional(),
  },
);

/**
 * Guardrail context schema
 */
export const GuardrailContextSchema: z.ZodType<GuardrailContext> = z.object({
  content: z.string(),
  checkpoint: z.string().optional(),
  delta: z.string().optional(),
  tokenCount: z.number(),
  completed: z.boolean(),
  metadata: z.record(z.string(), z.any()).optional(),
  previousViolations: z
    .array(z.lazy(() => GuardrailViolationSchema))
    .optional(),
});

/**
 * Guardrail rule schema
 * Note: Contains function properties - no explicit type annotation
 */
export const GuardrailRuleSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  check: z.function(),
  streaming: z.boolean().optional(),
  severity: z.enum(["warning", "error", "fatal"]).optional(),
  recoverable: z.boolean().optional(),
});

/**
 * Guardrail state schema
 */
export const GuardrailStateSchema: z.ZodType<GuardrailState> = z.object({
  violations: z.array(GuardrailViolationSchema),
  violationsByRule: z.map(z.string(), z.array(GuardrailViolationSchema)),
  hasFatalViolations: z.boolean(),
  hasErrorViolations: z.boolean(),
  violationCount: z.number(),
  lastCheckTime: z.number().optional(),
});

/**
 * Guardrail config schema
 * Note: Contains function properties - no explicit type annotation
 */
export const GuardrailConfigSchema = z.object({
  rules: z.array(GuardrailRuleSchema),
  stopOnFatal: z.boolean().optional(),
  enableStreaming: z.boolean().optional(),
  checkInterval: z.number().optional(),
  onViolation: z.function().optional(),
  onPhaseStart: z.function().optional(),
  onPhaseEnd: z.function().optional(),
  onRuleStart: z.function().optional(),
  onRuleEnd: z.function().optional(),
});

/**
 * Guardrail result schema
 */
export const GuardrailResultSchema: z.ZodType<GuardrailResult> = z.object({
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
});

/**
 * JSON structure tracking schema
 */
export const JsonStructureSchema: z.ZodType<JsonStructure> = z.object({
  openBraces: z.number(),
  closeBraces: z.number(),
  openBrackets: z.number(),
  closeBrackets: z.number(),
  inString: z.boolean(),
  isBalanced: z.boolean(),
  issues: z.array(z.string()),
});

/**
 * Markdown structure tracking schema
 */
export const MarkdownStructureSchema: z.ZodType<MarkdownStructure> = z.object({
  openFences: z.number(),
  fenceLanguages: z.array(z.string()),
  inFence: z.boolean(),
  headers: z.array(z.number()),
  listDepth: z.number(),
  issues: z.array(z.string()),
});

/**
 * LaTeX structure tracking schema
 */
export const LatexStructureSchema: z.ZodType<LatexStructure> = z.object({
  openEnvironments: z.array(z.string()),
  isBalanced: z.boolean(),
  issues: z.array(z.string()),
});

/**
 * Pattern config schema
 */
export const PatternConfigSchema: z.ZodType<PatternConfig> = z.object({
  patterns: z.array(z.union([z.string(), z.instanceof(RegExp)])),
  isBadPattern: z.boolean(),
  message: z.string().optional(),
  fatal: z.boolean().optional(),
});

/**
 * Drift config schema
 */
export const DriftConfigSchema: z.ZodType<DriftConfig> = z.object({
  detectToneShift: z.boolean().optional(),
  detectMetaCommentary: z.boolean().optional(),
  detectRepetition: z.boolean().optional(),
  detectEntropySpike: z.boolean().optional(),
  entropyThreshold: z.number().optional(),
  repetitionThreshold: z.number().optional(),
});

/**
 * Function call structure schema
 */
export const FunctionCallStructureSchema: z.ZodType<FunctionCallStructure> =
  z.object({
    name: z.string().optional(),
    arguments: z.string().optional(),
    parsedArguments: z.record(z.string(), z.any()).optional(),
    isValid: z.boolean(),
    errors: z.array(z.string()),
  });

/**
 * Schema validation result schema
 */
export const SchemaValidationSchema: z.ZodType<SchemaValidation> = z.object({
  valid: z.boolean(),
  errors: z.array(z.string()),
  parsed: z.any().optional(),
});
