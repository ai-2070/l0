// Zod schemas for L0 Evaluation types

import { z } from "zod4";
import type {
  ComparisonStyle,
  EvaluationResult,
  EvaluationDetails,
  ComparisonType,
  Difference,
  DifferenceType,
  DifferenceSeverity,
  EvaluationTest,
  BatchEvaluationResult,
  EvaluationTestResult,
  StringComparisonOptions,
  SchemaValidationResult,
  EvaluationPreset,
} from "../types/evaluate";

/**
 * Comparison style schema
 */
export const ComparisonStyleSchema: z.ZodType<ComparisonStyle> = z.enum([
  "strict",
  "lenient",
]);

/**
 * Comparison type schema
 */
export const ComparisonTypeSchema: z.ZodType<ComparisonType> = z.enum([
  "exact",
  "schema",
  "structural",
  "fuzzy",
  "numeric",
  "mixed",
]);

/**
 * Difference type schema
 */
export const DifferenceTypeSchema: z.ZodType<DifferenceType> = z.enum([
  "missing",
  "extra",
  "different",
  "type-mismatch",
  "structure-mismatch",
  "schema-violation",
]);

/**
 * Difference severity schema
 */
export const DifferenceSeveritySchema: z.ZodType<DifferenceSeverity> = z.enum([
  "error",
  "warning",
  "info",
]);

/**
 * Comparison function schema
 * Note: Function type - no explicit type annotation
 */
export const ComparisonFunctionSchema = z.function();

/**
 * Difference schema
 */
export const DifferenceSchema: z.ZodType<Difference> = z.object({
  path: z.string(),
  expected: z.any(),
  actual: z.any(),
  type: DifferenceTypeSchema,
  severity: DifferenceSeveritySchema,
  message: z.string(),
  similarity: z.number().optional(),
});

/**
 * Evaluation details schema
 */
export const EvaluationDetailsSchema: z.ZodType<EvaluationDetails> = z.object({
  exactMatch: z.boolean(),
  schemaValid: z.boolean(),
  structureMatch: z.boolean(),
  contentSimilarity: z.number(),
  fieldsCompared: z.number(),
  fieldsMatched: z.number(),
  comparisonType: ComparisonTypeSchema,
});

/**
 * Evaluation result schema
 */
export const EvaluationResultSchema: z.ZodType<EvaluationResult> = z.object({
  match: z.boolean(),
  score: z.number(),
  differences: z.array(DifferenceSchema),
  details: EvaluationDetailsSchema,
  metadata: z.record(z.string(), z.any()).optional(),
});

/**
 * Evaluation options schema
 * Note: Contains function properties - no explicit type annotation
 */
export const EvaluationOptionsSchema = z.object({
  expected: z.any(),
  actual: z.any(),
  style: ComparisonStyleSchema.optional(),
  threshold: z.number().optional(),
  numericTolerance: z.number().optional(),
  ignoreArrayOrder: z.boolean().optional(),
  ignoreExtraFields: z.boolean().optional(),
  customComparisons: z.record(z.string(), ComparisonFunctionSchema).optional(),
  metadata: z.record(z.string(), z.any()).optional(),
});

/**
 * Evaluation test schema
 */
export const EvaluationTestSchema: z.ZodType<EvaluationTest> = z.object({
  name: z.string(),
  expected: z.any(),
  actual: z.any(),
  style: ComparisonStyleSchema.optional(),
  threshold: z.number().optional(),
  metadata: z.record(z.string(), z.any()).optional(),
});

/**
 * Evaluation test result schema
 */
export const EvaluationTestResultSchema: z.ZodType<EvaluationTestResult> =
  z.object({
    name: z.string(),
    passed: z.boolean(),
    result: EvaluationResultSchema,
    metadata: z.record(z.string(), z.any()).optional(),
  });

/**
 * Batch evaluation result schema
 */
export const BatchEvaluationResultSchema: z.ZodType<BatchEvaluationResult> =
  z.object({
    passed: z.boolean(),
    passCount: z.number(),
    failCount: z.number(),
    total: z.number(),
    averageScore: z.number(),
    results: z.array(EvaluationTestResultSchema),
    summary: z.object({
      exactMatches: z.number(),
      schemaValid: z.number(),
      fuzzyMatches: z.number(),
      totalDifferences: z.number(),
    }),
  });

/**
 * String comparison options schema
 */
export const StringComparisonOptionsSchema: z.ZodType<StringComparisonOptions> =
  z.object({
    caseSensitive: z.boolean().optional(),
    normalizeWhitespace: z.boolean().optional(),
    algorithm: z.enum(["levenshtein", "jaro-winkler", "cosine"]).optional(),
    threshold: z.number().optional(),
  });

/**
 * Object comparison options schema
 * Note: Contains function properties - no explicit type annotation
 */
export const ObjectComparisonOptionsSchema = z.object({
  style: ComparisonStyleSchema,
  ignoreExtraFields: z.boolean(),
  ignoreArrayOrder: z.boolean(),
  numericTolerance: z.number(),
  customComparisons: z.record(z.string(), ComparisonFunctionSchema).optional(),
});

/**
 * Schema validation result schema
 */
export const SchemaValidationResultSchema: z.ZodType<SchemaValidationResult> =
  z.object({
    valid: z.boolean(),
    data: z.any().optional(),
    errors: z.any().optional(), // z.ZodError
    differences: z.array(DifferenceSchema),
  });

/**
 * Evaluation preset schema
 */
export const EvaluationPresetSchema: z.ZodType<EvaluationPreset> = z.object({
  name: z.string(),
  style: ComparisonStyleSchema,
  threshold: z.number(),
  ignoreArrayOrder: z.boolean(),
  ignoreExtraFields: z.boolean(),
  numericTolerance: z.number(),
});
