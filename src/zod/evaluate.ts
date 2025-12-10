// Zod schemas for L0 Evaluation types

import { z } from "zod";
import type {
  EvaluationOptions,
  ComparisonStyle,
  ComparisonFunction,
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
  ObjectComparisonOptions,
  SchemaValidationResult,
  EvaluationPreset,
} from "../types/evaluate";

/**
 * Comparison style schema
 */
export const ComparisonStyleSchema = z.enum([
  "strict",
  "lenient",
]) satisfies z.ZodType<ComparisonStyle>;

/**
 * Comparison type schema
 */
export const ComparisonTypeSchema = z.enum([
  "exact",
  "schema",
  "structural",
  "fuzzy",
  "numeric",
  "mixed",
]) satisfies z.ZodType<ComparisonType>;

/**
 * Difference type schema
 */
export const DifferenceTypeSchema = z.enum([
  "missing",
  "extra",
  "different",
  "type-mismatch",
  "structure-mismatch",
  "schema-violation",
]) satisfies z.ZodType<DifferenceType>;

/**
 * Difference severity schema
 */
export const DifferenceSeveritySchema = z.enum([
  "error",
  "warning",
  "info",
]) satisfies z.ZodType<DifferenceSeverity>;

/**
 * Comparison function schema
 */
export const ComparisonFunctionSchema = z.function()
  .args(z.any(), z.any())
  .returns(z.union([z.boolean(), z.number()])) satisfies z.ZodType<ComparisonFunction>;

/**
 * Difference schema
 */
export const DifferenceSchema = z.object({
  path: z.string(),
  expected: z.any(),
  actual: z.any(),
  type: DifferenceTypeSchema,
  severity: DifferenceSeveritySchema,
  message: z.string(),
  similarity: z.number().optional(),
}) satisfies z.ZodType<Difference>;

/**
 * Evaluation details schema
 */
export const EvaluationDetailsSchema = z.object({
  exactMatch: z.boolean(),
  schemaValid: z.boolean(),
  structureMatch: z.boolean(),
  contentSimilarity: z.number(),
  fieldsCompared: z.number(),
  fieldsMatched: z.number(),
  comparisonType: ComparisonTypeSchema,
}) satisfies z.ZodType<EvaluationDetails>;

/**
 * Evaluation result schema
 */
export const EvaluationResultSchema = z.object({
  match: z.boolean(),
  score: z.number(),
  differences: z.array(DifferenceSchema),
  details: EvaluationDetailsSchema,
  metadata: z.record(z.any()).optional(),
}) satisfies z.ZodType<EvaluationResult>;

/**
 * Evaluation options schema
 */
export const EvaluationOptionsSchema = z.object({
  expected: z.any(),
  actual: z.any(),
  style: ComparisonStyleSchema.optional(),
  threshold: z.number().optional(),
  numericTolerance: z.number().optional(),
  ignoreArrayOrder: z.boolean().optional(),
  ignoreExtraFields: z.boolean().optional(),
  customComparisons: z.record(ComparisonFunctionSchema).optional(),
  metadata: z.record(z.any()).optional(),
}) satisfies z.ZodType<EvaluationOptions>;

/**
 * Evaluation test schema
 */
export const EvaluationTestSchema = z.object({
  name: z.string(),
  expected: z.any(),
  actual: z.any(),
  style: ComparisonStyleSchema.optional(),
  threshold: z.number().optional(),
  metadata: z.record(z.any()).optional(),
}) satisfies z.ZodType<EvaluationTest>;

/**
 * Evaluation test result schema
 */
export const EvaluationTestResultSchema = z.object({
  name: z.string(),
  passed: z.boolean(),
  result: EvaluationResultSchema,
  metadata: z.record(z.any()).optional(),
}) satisfies z.ZodType<EvaluationTestResult>;

/**
 * Batch evaluation result schema
 */
export const BatchEvaluationResultSchema = z.object({
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
}) satisfies z.ZodType<BatchEvaluationResult>;

/**
 * String comparison options schema
 */
export const StringComparisonOptionsSchema = z.object({
  caseSensitive: z.boolean().optional(),
  normalizeWhitespace: z.boolean().optional(),
  algorithm: z.enum(["levenshtein", "jaro-winkler", "cosine"]).optional(),
  threshold: z.number().optional(),
}) satisfies z.ZodType<StringComparisonOptions>;

/**
 * Object comparison options schema
 */
export const ObjectComparisonOptionsSchema = z.object({
  style: ComparisonStyleSchema,
  ignoreExtraFields: z.boolean(),
  ignoreArrayOrder: z.boolean(),
  numericTolerance: z.number(),
  customComparisons: z.record(ComparisonFunctionSchema).optional(),
}) satisfies z.ZodType<ObjectComparisonOptions>;

/**
 * Schema validation result schema
 */
export const SchemaValidationResultSchema = z.object({
  valid: z.boolean(),
  data: z.any().optional(),
  errors: z.any().optional(), // z.ZodError
  differences: z.array(DifferenceSchema),
}) satisfies z.ZodType<SchemaValidationResult>;

/**
 * Evaluation preset schema
 */
export const EvaluationPresetSchema = z.object({
  name: z.string(),
  style: ComparisonStyleSchema,
  threshold: z.number(),
  ignoreArrayOrder: z.boolean(),
  ignoreExtraFields: z.boolean(),
  numericTolerance: z.number(),
}) satisfies z.ZodType<EvaluationPreset>;
