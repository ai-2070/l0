// Types for L0 Evaluation API - Deterministic comparisons for testing

import type { z } from "zod";

/**
 * Evaluation options
 */
export interface EvaluationOptions<T = any> {
  /**
   * Expected value or schema
   */
  expected: T | z.ZodTypeAny;

  /**
   * Actual value to compare
   */
  actual: any;

  /**
   * Comparison style
   * - 'strict': Exact match required
   * - 'lenient': Allows extra fields, flexible matching
   * @default 'strict'
   */
  style?: ComparisonStyle;

  /**
   * Similarity threshold for fuzzy matching (0-1)
   * Only used in lenient mode
   * @default 0.8
   */
  threshold?: number;

  /**
   * Numeric tolerance for floating point comparisons
   * @default 0.001
   */
  numericTolerance?: number;

  /**
   * Whether to ignore array order in lenient mode
   * @default false
   */
  ignoreArrayOrder?: boolean;

  /**
   * Whether to ignore extra fields in lenient mode
   * @default true
   */
  ignoreExtraFields?: boolean;

  /**
   * Custom comparison function for specific paths
   */
  customComparisons?: Record<string, ComparisonFunction>;

  /**
   * Metadata to attach to result
   */
  metadata?: Record<string, any>;
}

/**
 * Comparison style
 */
export type ComparisonStyle = "strict" | "lenient";

/**
 * Custom comparison function
 */
export type ComparisonFunction = (
  expected: any,
  actual: any,
) => boolean | number;

/**
 * Evaluation result
 */
export interface EvaluationResult {
  /**
   * Whether values match according to style and threshold
   */
  match: boolean;

  /**
   * Similarity score (0-1)
   * 1.0 = perfect match
   * 0.0 = completely different
   */
  score: number;

  /**
   * List of differences found
   */
  differences: Difference[];

  /**
   * Detailed breakdown
   */
  details: EvaluationDetails;

  /**
   * Metadata from options
   */
  metadata?: Record<string, any>;
}

/**
 * Detailed evaluation breakdown
 */
export interface EvaluationDetails {
  /**
   * Whether values are exactly equal (===)
   */
  exactMatch: boolean;

  /**
   * Whether actual matches expected schema (if schema provided)
   */
  schemaValid: boolean;

  /**
   * Whether structure (keys, types) matches
   */
  structureMatch: boolean;

  /**
   * Content similarity score (0-1)
   */
  contentSimilarity: number;

  /**
   * Number of fields compared
   */
  fieldsCompared: number;

  /**
   * Number of fields that matched
   */
  fieldsMatched: number;

  /**
   * Type of comparison performed
   */
  comparisonType: ComparisonType;
}

/**
 * Type of comparison
 */
export type ComparisonType =
  | "exact" // === comparison
  | "schema" // Zod schema validation
  | "structural" // Deep object comparison
  | "fuzzy" // String similarity
  | "numeric" // Number with tolerance
  | "mixed"; // Multiple types

/**
 * A single difference between expected and actual
 */
export interface Difference {
  /**
   * Path to the difference (e.g., "data.user.age")
   */
  path: string;

  /**
   * Expected value
   */
  expected: any;

  /**
   * Actual value
   */
  actual: any;

  /**
   * Type of difference
   */
  type: DifferenceType;

  /**
   * Severity of difference
   */
  severity: DifferenceSeverity;

  /**
   * Human-readable message
   */
  message: string;

  /**
   * Similarity score for this field (0-1)
   */
  similarity?: number;
}

/**
 * Type of difference
 */
export type DifferenceType =
  | "missing" // Field missing in actual
  | "extra" // Extra field in actual
  | "different" // Different value
  | "type-mismatch" // Different types
  | "structure-mismatch" // Different structure (object vs array, etc.)
  | "schema-violation"; // Fails schema validation

/**
 * Severity of difference
 */
export type DifferenceSeverity =
  | "error" // Critical difference
  | "warning" // Minor difference (in lenient mode)
  | "info"; // Informational (e.g., extra fields in lenient mode)

/**
 * Batch evaluation test
 */
export interface EvaluationTest<T = any> {
  /**
   * Test name (for reporting)
   */
  name: string;

  /**
   * Expected value or schema
   */
  expected: T | z.ZodTypeAny;

  /**
   * Actual value to compare
   */
  actual: any;

  /**
   * Comparison style
   */
  style?: ComparisonStyle;

  /**
   * Similarity threshold
   */
  threshold?: number;

  /**
   * Metadata
   */
  metadata?: Record<string, any>;
}

/**
 * Batch evaluation result
 */
export interface BatchEvaluationResult {
  /**
   * Overall pass/fail
   */
  passed: boolean;

  /**
   * Number of tests passed
   */
  passCount: number;

  /**
   * Number of tests failed
   */
  failCount: number;

  /**
   * Total number of tests
   */
  total: number;

  /**
   * Average score across all tests
   */
  averageScore: number;

  /**
   * Individual test results
   */
  results: EvaluationTestResult[];

  /**
   * Summary statistics
   */
  summary: {
    exactMatches: number;
    schemaValid: number;
    fuzzyMatches: number;
    totalDifferences: number;
  };
}

/**
 * Result from a single test in batch
 */
export interface EvaluationTestResult {
  /**
   * Test name
   */
  name: string;

  /**
   * Whether test passed
   */
  passed: boolean;

  /**
   * Evaluation result
   */
  result: EvaluationResult;

  /**
   * Test metadata
   */
  metadata?: Record<string, any>;
}

/**
 * String comparison options
 */
export interface StringComparisonOptions {
  /**
   * Case sensitive comparison
   * @default true
   */
  caseSensitive?: boolean;

  /**
   * Normalize whitespace before comparison
   * @default true
   */
  normalizeWhitespace?: boolean;

  /**
   * Similarity algorithm
   * @default 'levenshtein'
   */
  algorithm?: "levenshtein" | "jaro-winkler" | "cosine";

  /**
   * Minimum similarity threshold (0-1)
   * @default 0.8
   */
  threshold?: number;
}

/**
 * Object comparison options
 */
export interface ObjectComparisonOptions {
  /**
   * Comparison style
   */
  style: ComparisonStyle;

  /**
   * Ignore extra fields in actual
   */
  ignoreExtraFields: boolean;

  /**
   * Ignore array order
   */
  ignoreArrayOrder: boolean;

  /**
   * Numeric tolerance
   */
  numericTolerance: number;

  /**
   * Custom comparisons for specific paths
   */
  customComparisons?: Record<string, ComparisonFunction>;
}

/**
 * Schema validation result
 */
export interface SchemaValidationResult {
  /**
   * Whether value is valid
   */
  valid: boolean;

  /**
   * Zod parse result (if valid)
   */
  data?: any;

  /**
   * Validation errors (if invalid)
   */
  errors?: z.ZodError;

  /**
   * List of differences as Difference objects
   */
  differences: Difference[];
}

/**
 * Preset evaluation configurations
 */
export interface EvaluationPreset {
  name: string;
  style: ComparisonStyle;
  threshold: number;
  ignoreArrayOrder: boolean;
  ignoreExtraFields: boolean;
  numericTolerance: number;
}

/**
 * Strict preset - exact matching required
 */
export const strictEvaluation: Partial<EvaluationOptions> = {
  style: "strict",
  threshold: 1.0,
  ignoreArrayOrder: false,
  ignoreExtraFields: false,
  numericTolerance: 0,
};

/**
 * Lenient preset - flexible matching
 */
export const lenientEvaluation: Partial<EvaluationOptions> = {
  style: "lenient",
  threshold: 0.8,
  ignoreArrayOrder: true,
  ignoreExtraFields: true,
  numericTolerance: 0.001,
};

/**
 * Testing preset - balanced for unit tests
 */
export const testingEvaluation: Partial<EvaluationOptions> = {
  style: "lenient",
  threshold: 0.9,
  ignoreArrayOrder: false,
  ignoreExtraFields: true,
  numericTolerance: 0.0001,
};
