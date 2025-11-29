// L0 Evaluation API - Deterministic comparisons for testing LLM outputs

import type { z } from "zod";
import type {
  EvaluationOptions,
  EvaluationResult,
  EvaluationDetails,
  EvaluationTest,
  BatchEvaluationResult,
  EvaluationTestResult,
  Difference,
  ComparisonType,
  SchemaValidationResult,
  ObjectComparisonOptions,
} from "./types/evaluate";
import {
  compareStrings,
  compareValues,
  deepEqual,
  calculateSimilarityScore,
  countFields,
} from "./utils/comparison";

/**
 * Evaluate actual output against expected value or schema
 *
 * @param options - Evaluation options
 * @returns Evaluation result with match status, score, and differences
 *
 * @example
 * ```typescript
 * // Exact match
 * const result = evaluate({
 *   expected: { name: "Alice", age: 30 },
 *   actual: { name: "Alice", age: 30 }
 * });
 *
 * // Schema validation
 * const result = evaluate({
 *   expected: z.object({ name: z.string(), age: z.number() }),
 *   actual: { name: "Alice", age: 30 }
 * });
 *
 * // Fuzzy matching
 * const result = evaluate({
 *   expected: "The quick brown fox",
 *   actual: "The quick brown fox jumped",
 *   style: "lenient",
 *   threshold: 0.8
 * });
 * ```
 */
export function evaluate<T = any>(
  options: EvaluationOptions<T>,
): EvaluationResult {
  const {
    expected,
    actual,
    style = "strict",
    threshold = 0.8,
    numericTolerance = 0.001,
    ignoreArrayOrder = false,
    ignoreExtraFields = style === "lenient",
    customComparisons,
    metadata,
  } = options;

  // Check if expected is a Zod schema
  const isSchema = isZodSchema(expected);

  let differences: Difference[] = [];
  let comparisonType: ComparisonType = "exact";
  let schemaValid = false;
  let exactMatch = false;
  let structureMatch = false;
  let contentSimilarity = 0;
  let fieldsCompared = 0;
  let fieldsMatched = 0;

  if (isSchema) {
    // Schema validation
    comparisonType = "schema";
    const schemaResult = validateSchema(expected as z.ZodTypeAny, actual);
    schemaValid = schemaResult.valid;
    differences = schemaResult.differences;
    fieldsCompared = countFields(actual);
    fieldsMatched = schemaValid ? fieldsCompared : 0;
    contentSimilarity = schemaValid ? 1.0 : 0;
    exactMatch = schemaValid;
    structureMatch = schemaValid;
  } else {
    // Value comparison
    exactMatch = deepEqual(expected, actual);

    if (exactMatch) {
      comparisonType = "exact";
      schemaValid = true;
      structureMatch = true;
      contentSimilarity = 1.0;
      fieldsCompared = countFields(expected);
      fieldsMatched = fieldsCompared;
    } else {
      // Determine comparison type
      const expectedType = typeof expected;
      const actualType = typeof actual;

      if (expectedType === "string" && actualType === "string") {
        comparisonType = "fuzzy";
        contentSimilarity = compareStrings(
          expected as string,
          actual as string,
          {
            caseSensitive: true,
            normalizeWhitespace: true,
            algorithm: "levenshtein",
          },
        );
        fieldsCompared = 1;
        fieldsMatched = contentSimilarity >= threshold ? 1 : 0;

        if (contentSimilarity < 1.0) {
          differences.push({
            path: "",
            expected,
            actual,
            type: "different",
            severity: contentSimilarity >= threshold ? "warning" : "error",
            message: `Strings differ (${(contentSimilarity * 100).toFixed(0)}% similar)`,
            similarity: contentSimilarity,
          });
        }
      } else if (expectedType === "number" && actualType === "number") {
        comparisonType = "numeric";
        const numericMatch =
          Math.abs((expected as number) - (actual as number)) <=
          numericTolerance;
        contentSimilarity = numericMatch ? 1.0 : 0;
        fieldsCompared = 1;
        fieldsMatched = numericMatch ? 1 : 0;

        if (!numericMatch) {
          differences.push({
            path: "",
            expected,
            actual,
            type: "different",
            severity: "error",
            message: `Numbers differ: ${expected} vs ${actual}`,
          });
        }
      } else if (
        (expectedType === "object" && actualType === "object") ||
        (Array.isArray(expected) && Array.isArray(actual))
      ) {
        comparisonType = "structural";

        const compOptions: ObjectComparisonOptions = {
          style,
          ignoreExtraFields,
          ignoreArrayOrder,
          numericTolerance,
          customComparisons,
        };

        differences = compareValues(expected, actual, compOptions, "");
        fieldsCompared = countFields(expected);

        // Count matched fields
        const errorDiffs = differences.filter((d) => d.severity === "error");
        fieldsMatched = fieldsCompared - errorDiffs.length;

        structureMatch = errorDiffs.length === 0;
        contentSimilarity = calculateSimilarityScore(
          differences,
          fieldsCompared,
        );
      } else {
        comparisonType = "mixed";
        differences.push({
          path: "",
          expected,
          actual,
          type: "type-mismatch",
          severity: "error",
          message: `Type mismatch: expected ${expectedType}, got ${actualType}`,
        });
        fieldsCompared = 1;
        fieldsMatched = 0;
        contentSimilarity = 0;
      }
    }
  }

  // Calculate overall score
  const score =
    differences.length === 0
      ? 1.0
      : calculateSimilarityScore(differences, fieldsCompared);

  // Determine if it's a match based on style and threshold
  const match =
    style === "strict"
      ? exactMatch && differences.length === 0
      : score >= threshold;

  const details: EvaluationDetails = {
    exactMatch,
    schemaValid,
    structureMatch,
    contentSimilarity,
    fieldsCompared,
    fieldsMatched,
    comparisonType,
  };

  return {
    match,
    score,
    differences,
    details,
    metadata,
  };
}

/**
 * Evaluate multiple tests in batch
 *
 * @param tests - Array of evaluation tests
 * @returns Batch evaluation result
 *
 * @example
 * ```typescript
 * const results = evaluateBatch([
 *   {
 *     name: "Test 1",
 *     expected: { x: 1 },
 *     actual: { x: 1 }
 *   },
 *   {
 *     name: "Test 2",
 *     expected: "hello",
 *     actual: "hello world",
 *     style: "lenient"
 *   }
 * ]);
 *
 * console.log(`${results.passCount}/${results.total} tests passed`);
 * ```
 */
export function evaluateBatch(tests: EvaluationTest[]): BatchEvaluationResult {
  const results: EvaluationTestResult[] = [];

  for (const test of tests) {
    const result = evaluate({
      expected: test.expected,
      actual: test.actual,
      style: test.style,
      threshold: test.threshold,
      metadata: test.metadata,
    });

    results.push({
      name: test.name,
      passed: result.match,
      result,
      metadata: test.metadata,
    });
  }

  const passCount = results.filter((r) => r.passed).length;
  const failCount = results.length - passCount;
  const passed = failCount === 0;

  const averageScore =
    results.reduce((sum, r) => sum + r.result.score, 0) / results.length;

  const summary = {
    exactMatches: results.filter((r) => r.result.details.exactMatch).length,
    schemaValid: results.filter((r) => r.result.details.schemaValid).length,
    fuzzyMatches: results.filter(
      (r) =>
        r.passed &&
        !r.result.details.exactMatch &&
        r.result.details.comparisonType === "fuzzy",
    ).length,
    totalDifferences: results.reduce(
      (sum, r) => sum + r.result.differences.length,
      0,
    ),
  };

  return {
    passed,
    passCount,
    failCount,
    total: results.length,
    averageScore,
    results,
    summary,
  };
}

/**
 * Validate value against Zod schema
 *
 * @param schema - Zod schema
 * @param value - Value to validate
 * @returns Schema validation result
 */
export function validateSchema(
  schema: z.ZodTypeAny,
  value: any,
): SchemaValidationResult {
  const result = schema.safeParse(value);

  if (result.success) {
    return {
      valid: true,
      data: result.data,
      differences: [],
    };
  }

  // Convert Zod errors to Difference objects
  const differences: Difference[] = result.error.errors.map((err) => ({
    path: err.path.join("."),
    expected: err.message,
    actual: value,
    type: "schema-violation",
    severity: "error",
    message: `${err.path.join(".")}: ${err.message}`,
  }));

  return {
    valid: false,
    errors: result.error,
    differences,
  };
}

/**
 * Check if value is a Zod schema
 */
function isZodSchema(value: any): value is z.ZodTypeAny {
  return (
    value &&
    typeof value === "object" &&
    "_def" in value &&
    "parse" in value &&
    "safeParse" in value
  );
}

/**
 * Assert that actual matches expected (throws on mismatch)
 *
 * @param options - Evaluation options
 * @throws Error if values don't match
 *
 * @example
 * ```typescript
 * // In tests
 * assertMatch({
 *   expected: { name: "Alice" },
 *   actual: result.data
 * });
 * ```
 */
export function assertMatch<T = any>(options: EvaluationOptions<T>): void {
  const result = evaluate(options);

  if (!result.match) {
    const errorMsg = [
      "Evaluation failed:",
      `Score: ${(result.score * 100).toFixed(1)}%`,
      `Differences (${result.differences.length}):`,
      ...result.differences.map((d) => `  - ${d.path}: ${d.message}`),
    ].join("\n");

    throw new Error(errorMsg);
  }
}

/**
 * Compare two values and return similarity score (0-1)
 *
 * @param a - First value
 * @param b - Second value
 * @param options - Comparison options
 * @returns Similarity score
 *
 * @example
 * ```typescript
 * const score = similarity("hello world", "hello worlds");
 * console.log(score); // 0.92
 * ```
 */
export function similarity(
  a: any,
  b: any,
  options: Partial<EvaluationOptions> = {},
): number {
  const result = evaluate({
    expected: a,
    actual: b,
    style: "lenient",
    ...options,
  });

  return result.score;
}

/**
 * Check if two values match (boolean)
 *
 * @param a - First value
 * @param b - Second value
 * @param options - Comparison options
 * @returns Whether values match
 *
 * @example
 * ```typescript
 * if (matches(expected, actual, { style: 'lenient' })) {
 *   console.log('Match!');
 * }
 * ```
 */
export function matches(
  a: any,
  b: any,
  options: Partial<EvaluationOptions> = {},
): boolean {
  const result = evaluate({
    expected: a,
    actual: b,
    ...options,
  });

  return result.match;
}

/**
 * Get differences between two values
 *
 * @param expected - Expected value
 * @param actual - Actual value
 * @param options - Comparison options
 * @returns Array of differences
 *
 * @example
 * ```typescript
 * const diffs = getDifferences(
 *   { a: 1, b: 2 },
 *   { a: 1, b: 3, c: 4 }
 * );
 *
 * console.log(diffs);
 * // [
 * //   { path: 'b', expected: 2, actual: 3, type: 'different' },
 * //   { path: 'c', expected: undefined, actual: 4, type: 'extra' }
 * // ]
 * ```
 */
export function getDifferences(
  expected: any,
  actual: any,
  options: Partial<EvaluationOptions> = {},
): Difference[] {
  const result = evaluate({
    expected,
    actual,
    ...options,
  });

  return result.differences;
}

/**
 * Create a matcher function for testing
 *
 * @param expected - Expected value or schema
 * @param options - Evaluation options
 * @returns Matcher function
 *
 * @example
 * ```typescript
 * const matchesUser = createMatcher(
 *   z.object({ name: z.string(), age: z.number() })
 * );
 *
 * if (matchesUser(result.data)) {
 *   console.log('Valid user!');
 * }
 * ```
 */
export function createMatcher<T = any>(
  expected: T | z.ZodTypeAny,
  options: Partial<EvaluationOptions> = {},
): (actual: any) => boolean {
  return (actual: any) => {
    return matches(expected, actual, options);
  };
}

/**
 * Snapshot testing helper - compare against saved snapshot
 *
 * @param name - Snapshot name
 * @param actual - Actual value
 * @param snapshots - Snapshot store
 * @param options - Evaluation options
 * @returns Evaluation result
 *
 * @example
 * ```typescript
 * const snapshots = new Map();
 *
 * // First run: saves snapshot
 * snapshot('test1', { x: 1 }, snapshots);
 *
 * // Subsequent runs: compares against snapshot
 * const result = snapshot('test1', { x: 1 }, snapshots);
 * console.log(result.match); // true
 * ```
 */
export function snapshot(
  name: string,
  actual: any,
  snapshots: Map<string, any>,
  options: Partial<EvaluationOptions> = {},
): EvaluationResult {
  if (!snapshots.has(name)) {
    // First run - save snapshot
    snapshots.set(name, actual);
    return {
      match: true,
      score: 1.0,
      differences: [],
      details: {
        exactMatch: true,
        schemaValid: true,
        structureMatch: true,
        contentSimilarity: 1.0,
        fieldsCompared: countFields(actual),
        fieldsMatched: countFields(actual),
        comparisonType: "exact",
      },
      metadata: { snapshot: "created", name },
    };
  }

  // Compare against snapshot
  const expected = snapshots.get(name);
  return evaluate({
    expected,
    actual,
    ...options,
    metadata: { ...options.metadata, snapshot: "compared", name },
  });
}
