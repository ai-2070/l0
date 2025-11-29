// Comparison utilities for evaluation API

import type {
  Difference,
  StringComparisonOptions,
  ObjectComparisonOptions,
} from "../types/evaluate";

/**
 * Compare two strings with similarity scoring
 *
 * @param a - First string
 * @param b - Second string
 * @param options - Comparison options
 * @returns Similarity score (0-1)
 */
export function compareStrings(
  a: string,
  b: string,
  options: StringComparisonOptions = {},
): number {
  const {
    caseSensitive = true,
    normalizeWhitespace = true,
    algorithm = "levenshtein",
  } = options;

  let str1 = a;
  let str2 = b;

  // Normalize
  if (!caseSensitive) {
    str1 = str1.toLowerCase();
    str2 = str2.toLowerCase();
  }

  if (normalizeWhitespace) {
    str1 = str1.replace(/\s+/g, " ").trim();
    str2 = str2.replace(/\s+/g, " ").trim();
  }

  // Exact match
  if (str1 === str2) return 1.0;

  // Choose algorithm
  switch (algorithm) {
    case "levenshtein":
      return levenshteinSimilarity(str1, str2);
    case "jaro-winkler":
      return jaroWinklerSimilarity(str1, str2);
    case "cosine":
      return cosineSimilarity(str1, str2);
    default:
      return levenshteinSimilarity(str1, str2);
  }
}

/**
 * Levenshtein distance similarity (0-1)
 */
export function levenshteinSimilarity(a: string, b: string): number {
  if (a === b) return 1.0;
  if (a.length === 0 || b.length === 0) return 0.0;

  const distance = levenshteinDistance(a, b);
  const maxLength = Math.max(a.length, b.length);

  return 1 - distance / maxLength;
}

/**
 * Levenshtein distance (edit distance)
 */
export function levenshteinDistance(a: string, b: string): number {
  const matrix: number[][] = [];

  // Initialize matrix
  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i];
  }

  for (let j = 0; j <= a.length; j++) {
    matrix[0]![j] = j;
  }

  // Fill matrix
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i]![j] = matrix[i - 1]![j - 1]!;
      } else {
        matrix[i]![j] = Math.min(
          matrix[i - 1]![j - 1]! + 1, // substitution
          matrix[i]![j - 1]! + 1, // insertion
          matrix[i - 1]![j]! + 1, // deletion
        );
      }
    }
  }

  return matrix[b.length]![a.length]!;
}

/**
 * Jaro-Winkler similarity (0-1)
 */
export function jaroWinklerSimilarity(a: string, b: string): number {
  if (a === b) return 1.0;
  if (a.length === 0 || b.length === 0) return 0.0;

  // Jaro similarity
  const jaroSim = jaroSimilarity(a, b);

  // Jaro-Winkler adds bonus for matching prefix
  const prefixLength = commonPrefixLength(a, b, 4);
  const prefixScale = 0.1;

  return jaroSim + prefixLength * prefixScale * (1 - jaroSim);
}

/**
 * Jaro similarity
 */
function jaroSimilarity(a: string, b: string): number {
  const matchWindow = Math.floor(Math.max(a.length, b.length) / 2) - 1;
  const aMatches = new Array(a.length).fill(false);
  const bMatches = new Array(b.length).fill(false);

  let matches = 0;
  let transpositions = 0;

  // Find matches
  for (let i = 0; i < a.length; i++) {
    const start = Math.max(0, i - matchWindow);
    const end = Math.min(i + matchWindow + 1, b.length);

    for (let j = start; j < end; j++) {
      if (bMatches[j] || a[i] !== b[j]) continue;
      aMatches[i] = true;
      bMatches[j] = true;
      matches++;
      break;
    }
  }

  if (matches === 0) return 0.0;

  // Find transpositions
  let k = 0;
  for (let i = 0; i < a.length; i++) {
    if (!aMatches[i]) continue;
    while (!bMatches[k]) k++;
    if (a[i] !== b[k]) transpositions++;
    k++;
  }

  return (
    (matches / a.length +
      matches / b.length +
      (matches - transpositions / 2) / matches) /
    3
  );
}

/**
 * Get common prefix length
 */
function commonPrefixLength(a: string, b: string, maxLength: number): number {
  let length = 0;
  const max = Math.min(a.length, b.length, maxLength);

  for (let i = 0; i < max; i++) {
    if (a[i] === b[i]) {
      length++;
    } else {
      break;
    }
  }

  return length;
}

/**
 * Cosine similarity (0-1)
 */
export function cosineSimilarity(a: string, b: string): number {
  const vectorA = stringToVector(a);
  const vectorB = stringToVector(b);

  const dotProduct = Object.keys(vectorA).reduce((sum, key) => {
    return sum + (vectorA[key] || 0) * (vectorB[key] || 0);
  }, 0);

  const magnitudeA = Math.sqrt(
    Object.values(vectorA).reduce((sum, val) => sum + val * val, 0),
  );
  const magnitudeB = Math.sqrt(
    Object.values(vectorB).reduce((sum, val) => sum + val * val, 0),
  );

  if (magnitudeA === 0 || magnitudeB === 0) return 0;

  return dotProduct / (magnitudeA * magnitudeB);
}

/**
 * Convert string to term frequency vector
 */
function stringToVector(str: string): Record<string, number> {
  const words = str.toLowerCase().split(/\s+/);
  const vector: Record<string, number> = {};

  for (const word of words) {
    vector[word] = (vector[word] || 0) + 1;
  }

  return vector;
}

/**
 * Compare two numbers with tolerance
 *
 * @param a - First number
 * @param b - Second number
 * @param tolerance - Acceptable difference
 * @returns Whether numbers are equal within tolerance
 */
export function compareNumbers(
  a: number,
  b: number,
  tolerance: number = 0.001,
): boolean {
  return Math.abs(a - b) <= tolerance;
}

/**
 * Compare two arrays
 *
 * @param a - First array
 * @param b - Second array
 * @param options - Comparison options
 * @param path - Current path (for recursion)
 * @returns Array of differences
 */
export function compareArrays(
  a: any[],
  b: any[],
  options: ObjectComparisonOptions,
  path: string = "",
): Difference[] {
  const differences: Difference[] = [];

  if (options.ignoreArrayOrder) {
    // Compare as sets (order doesn't matter)
    const aSet = new Set(a.map((item) => JSON.stringify(item)));
    const bSet = new Set(b.map((item) => JSON.stringify(item)));

    // Find items in a but not in b
    for (const item of aSet) {
      if (!bSet.has(item)) {
        differences.push({
          path: `${path}[]`,
          expected: JSON.parse(item),
          actual: undefined,
          type: "missing",
          severity: options.style === "strict" ? "error" : "warning",
          message: `Item missing in actual array`,
        });
      }
    }

    // Find items in b but not in a
    for (const item of bSet) {
      if (!aSet.has(item)) {
        differences.push({
          path: `${path}[]`,
          expected: undefined,
          actual: JSON.parse(item),
          type: "extra",
          severity: options.ignoreExtraFields ? "info" : "warning",
          message: `Extra item in actual array`,
        });
      }
    }
  } else {
    // Compare with order
    const maxLength = Math.max(a.length, b.length);

    for (let i = 0; i < maxLength; i++) {
      const itemPath = `${path}[${i}]`;

      if (i >= a.length) {
        differences.push({
          path: itemPath,
          expected: undefined,
          actual: b[i],
          type: "extra",
          severity: options.ignoreExtraFields ? "info" : "warning",
          message: `Extra item at index ${i}`,
        });
      } else if (i >= b.length) {
        differences.push({
          path: itemPath,
          expected: a[i],
          actual: undefined,
          type: "missing",
          severity: "error",
          message: `Missing item at index ${i}`,
        });
      } else {
        // Compare items
        const itemDiffs = compareValues(a[i], b[i], options, itemPath);
        differences.push(...itemDiffs);
      }
    }
  }

  return differences;
}

/**
 * Compare two objects deeply
 *
 * @param expected - Expected object
 * @param actual - Actual object
 * @param options - Comparison options
 * @param path - Current path (for recursion)
 * @returns Array of differences
 */
export function compareObjects(
  expected: Record<string, any>,
  actual: Record<string, any>,
  options: ObjectComparisonOptions,
  path: string = "",
): Difference[] {
  const differences: Difference[] = [];

  // Get all keys
  const expectedKeys = Object.keys(expected);
  const actualKeys = Object.keys(actual);
  const allKeys = new Set([...expectedKeys, ...actualKeys]);

  for (const key of allKeys) {
    const fieldPath = path ? `${path}.${key}` : key;
    const hasExpected = key in expected;
    const hasActual = key in actual;

    // Check for custom comparison
    if (options.customComparisons?.[fieldPath]) {
      const customResult = options.customComparisons[fieldPath](
        expected[key],
        actual[key],
      );

      if (typeof customResult === "boolean" && !customResult) {
        differences.push({
          path: fieldPath,
          expected: expected[key],
          actual: actual[key],
          type: "different",
          severity: "error",
          message: `Custom comparison failed for ${fieldPath}`,
        });
      } else if (typeof customResult === "number" && customResult < 0.8) {
        differences.push({
          path: fieldPath,
          expected: expected[key],
          actual: actual[key],
          type: "different",
          severity: "warning",
          message: `Custom comparison score too low: ${customResult.toFixed(2)}`,
          similarity: customResult,
        });
      }
      continue;
    }

    if (!hasExpected && hasActual) {
      // Extra field in actual
      if (!options.ignoreExtraFields) {
        differences.push({
          path: fieldPath,
          expected: undefined,
          actual: actual[key],
          type: "extra",
          severity: options.style === "strict" ? "error" : "info",
          message: `Extra field: ${key}`,
        });
      }
    } else if (hasExpected && !hasActual) {
      // Missing field in actual
      differences.push({
        path: fieldPath,
        expected: expected[key],
        actual: undefined,
        type: "missing",
        severity: "error",
        message: `Missing field: ${key}`,
      });
    } else {
      // Both exist, compare values
      const valueDiffs = compareValues(
        expected[key],
        actual[key],
        options,
        fieldPath,
      );
      differences.push(...valueDiffs);
    }
  }

  return differences;
}

/**
 * Compare two values (generic)
 *
 * @param expected - Expected value
 * @param actual - Actual value
 * @param options - Comparison options
 * @param path - Current path
 * @returns Array of differences
 */
export function compareValues(
  expected: any,
  actual: any,
  options: ObjectComparisonOptions,
  path: string = "",
): Difference[] {
  // Exact match
  if (expected === actual) {
    return [];
  }

  // Type mismatch
  const expectedType = getType(expected);
  const actualType = getType(actual);

  if (expectedType !== actualType) {
    return [
      {
        path,
        expected,
        actual,
        type: "type-mismatch",
        severity: "error",
        message: `Type mismatch: expected ${expectedType}, got ${actualType}`,
      },
    ];
  }

  // Type-specific comparison
  switch (expectedType) {
    case "null":
    case "undefined":
      return expected === actual
        ? []
        : [
            {
              path,
              expected,
              actual,
              type: "different",
              severity: "error",
              message: `Expected ${expected}, got ${actual}`,
            },
          ];

    case "number":
      if (compareNumbers(expected, actual, options.numericTolerance)) {
        return [];
      }
      return [
        {
          path,
          expected,
          actual,
          type: "different",
          severity: "error",
          message: `Numbers differ: ${expected} vs ${actual}`,
        },
      ];

    case "string":
      if (expected === actual) return [];

      const similarity = compareStrings(expected, actual, {
        caseSensitive: true,
        normalizeWhitespace: true,
        algorithm: "levenshtein",
      });

      if (options.style === "lenient" && similarity >= 0.8) {
        return [
          {
            path,
            expected,
            actual,
            type: "different",
            severity: "warning",
            message: `Strings differ but similar (${(similarity * 100).toFixed(0)}%)`,
            similarity,
          },
        ];
      }

      return [
        {
          path,
          expected,
          actual,
          type: "different",
          severity: "error",
          message: `Strings differ`,
          similarity,
        },
      ];

    case "boolean":
      return [
        {
          path,
          expected,
          actual,
          type: "different",
          severity: "error",
          message: `Boolean mismatch: ${expected} vs ${actual}`,
        },
      ];

    case "array":
      return compareArrays(expected, actual, options, path);

    case "object":
      return compareObjects(expected, actual, options, path);

    default:
      return [
        {
          path,
          expected,
          actual,
          type: "different",
          severity: "error",
          message: `Values differ`,
        },
      ];
  }
}

/**
 * Get type of value
 */
export function getType(value: any): string {
  if (value === null) return "null";
  if (value === undefined) return "undefined";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

/**
 * Deep equality check
 */
export function deepEqual(a: any, b: any): boolean {
  if (a === b) return true;

  const typeA = getType(a);
  const typeB = getType(b);

  if (typeA !== typeB) return false;

  if (typeA === "array") {
    if (a.length !== b.length) return false;
    return a.every((item: any, i: number) => deepEqual(item, b[i]));
  }

  if (typeA === "object") {
    const keysA = Object.keys(a);
    const keysB = Object.keys(b);

    if (keysA.length !== keysB.length) return false;

    return keysA.every((key) => deepEqual(a[key], b[key]));
  }

  return false;
}

/**
 * Calculate overall similarity score from differences
 *
 * @param differences - Array of differences
 * @param totalFields - Total number of fields compared
 * @returns Similarity score (0-1)
 */
export function calculateSimilarityScore(
  differences: Difference[],
  totalFields: number,
): number {
  if (totalFields === 0) return 1.0;

  // Weight differences by severity
  const weights = {
    error: 1.0,
    warning: 0.5,
    info: 0.1,
  };

  const totalPenalty = differences.reduce((sum, diff) => {
    return sum + weights[diff.severity];
  }, 0);

  const maxPenalty = totalFields;
  return Math.max(0, 1 - totalPenalty / maxPenalty);
}

/**
 * Count total fields in a value (for scoring)
 */
export function countFields(value: any): number {
  const type = getType(value);

  if (type === "object") {
    return Object.keys(value).reduce((sum, key) => {
      return sum + 1 + countFields(value[key]);
    }, 0);
  }

  if (type === "array") {
    return value.reduce((sum: number, item: any) => {
      return sum + countFields(item);
    }, 0);
  }

  return 1;
}
