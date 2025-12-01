import { describe, it, expect } from "vitest";
import {
  compareStrings,
  levenshteinSimilarity,
  levenshteinDistance,
  jaroWinklerSimilarity,
  cosineSimilarity,
  compareNumbers,
  compareArrays,
  compareObjects,
  compareValues,
  getType,
  deepEqual,
  calculateSimilarityScore,
  countFields,
} from "../src/utils/comparison";
import type {
  ObjectComparisonOptions,
  Difference,
} from "../src/types/evaluate";

describe("Comparison Utilities", () => {
  describe("compareStrings", () => {
    it("should return 1.0 for identical strings", () => {
      expect(compareStrings("hello", "hello")).toBe(1.0);
    });

    it("should be case sensitive by default", () => {
      const similarity = compareStrings("Hello", "hello");
      expect(similarity).toBeLessThan(1.0);
    });

    it("should support case insensitive comparison", () => {
      const similarity = compareStrings("Hello", "hello", {
        caseSensitive: false,
      });
      expect(similarity).toBe(1.0);
    });

    it("should normalize whitespace by default", () => {
      const similarity = compareStrings("hello  world", "hello world");
      expect(similarity).toBe(1.0);
    });

    it("should support disabling whitespace normalization", () => {
      const similarity = compareStrings("hello  world", "hello world", {
        normalizeWhitespace: false,
      });
      expect(similarity).toBeLessThan(1.0);
    });

    it("should use levenshtein by default", () => {
      const similarity = compareStrings("kitten", "sitting");
      expect(similarity).toBeGreaterThan(0.5);
    });

    it("should support jaro-winkler algorithm", () => {
      const similarity = compareStrings("hello", "hallo", {
        algorithm: "jaro-winkler",
      });
      expect(similarity).toBeGreaterThan(0.8);
    });

    it("should support cosine algorithm", () => {
      const similarity = compareStrings("hello world", "world hello", {
        algorithm: "cosine",
      });
      expect(similarity).toBeCloseTo(1.0, 5); // Same words, order doesn't matter
    });
  });

  describe("levenshteinSimilarity", () => {
    it("should return 1.0 for identical strings", () => {
      expect(levenshteinSimilarity("test", "test")).toBe(1.0);
    });

    it("should return 0.0 for empty string comparison", () => {
      expect(levenshteinSimilarity("test", "")).toBe(0.0);
      expect(levenshteinSimilarity("", "test")).toBe(0.0);
    });

    it("should calculate similarity correctly", () => {
      const similarity = levenshteinSimilarity("kitten", "sitting");
      expect(similarity).toBeCloseTo(0.571, 2);
    });
  });

  describe("levenshteinDistance", () => {
    it("should return 0 for identical strings", () => {
      expect(levenshteinDistance("test", "test")).toBe(0);
    });

    it("should calculate edit distance", () => {
      expect(levenshteinDistance("kitten", "sitting")).toBe(3);
      expect(levenshteinDistance("", "abc")).toBe(3);
      expect(levenshteinDistance("abc", "")).toBe(3);
    });
  });

  describe("jaroWinklerSimilarity", () => {
    it("should return 1.0 for identical strings", () => {
      expect(jaroWinklerSimilarity("test", "test")).toBe(1.0);
    });

    it("should return 0.0 for empty strings", () => {
      expect(jaroWinklerSimilarity("test", "")).toBe(0.0);
      expect(jaroWinklerSimilarity("", "test")).toBe(0.0);
    });

    it("should give bonus for common prefix", () => {
      const withPrefix = jaroWinklerSimilarity("prefix_abc", "prefix_xyz");
      const withoutPrefix = jaroWinklerSimilarity("abc_prefix", "xyz_prefix");
      expect(withPrefix).toBeGreaterThan(withoutPrefix);
    });

    it("should handle strings with no matches", () => {
      expect(jaroWinklerSimilarity("abc", "xyz")).toBe(0.0);
    });
  });

  describe("cosineSimilarity", () => {
    it("should return 1.0 for identical strings", () => {
      expect(cosineSimilarity("hello world", "hello world")).toBeCloseTo(
        1.0,
        5,
      );
    });

    it("should return 1.0 for same words different order", () => {
      expect(cosineSimilarity("hello world", "world hello")).toBeCloseTo(
        1.0,
        5,
      );
    });

    it("should return 0.0 for completely different strings", () => {
      expect(cosineSimilarity("abc", "xyz")).toBe(0.0);
    });

    it("should handle empty strings", () => {
      expect(cosineSimilarity("", "test")).toBe(0);
      expect(cosineSimilarity("test", "")).toBe(0);
    });
  });

  describe("compareNumbers", () => {
    it("should return true for equal numbers", () => {
      expect(compareNumbers(5, 5)).toBe(true);
    });

    it("should return true for numbers within tolerance", () => {
      expect(compareNumbers(5.0, 5.0005, 0.001)).toBe(true);
    });

    it("should return false for numbers outside tolerance", () => {
      expect(compareNumbers(5, 6, 0.001)).toBe(false);
    });

    it("should use default tolerance", () => {
      expect(compareNumbers(1.0, 1.0005)).toBe(true);
      expect(compareNumbers(1.0, 1.01)).toBe(false);
    });
  });

  describe("compareArrays", () => {
    const defaultOptions: ObjectComparisonOptions = {
      style: "strict",
      ignoreExtraFields: false,
      ignoreArrayOrder: false,
      numericTolerance: 0.001,
    };

    it("should find no differences for identical arrays", () => {
      const diffs = compareArrays([1, 2, 3], [1, 2, 3], defaultOptions);
      expect(diffs).toHaveLength(0);
    });

    it("should find missing items", () => {
      const diffs = compareArrays([1, 2, 3], [1, 2], defaultOptions);
      expect(diffs).toHaveLength(1);
      expect(diffs[0]!.type).toBe("missing");
    });

    it("should find extra items", () => {
      const diffs = compareArrays([1, 2], [1, 2, 3], defaultOptions);
      expect(diffs).toHaveLength(1);
      expect(diffs[0]!.type).toBe("extra");
    });

    it("should compare ignoring order when enabled", () => {
      const options: ObjectComparisonOptions = {
        ...defaultOptions,
        ignoreArrayOrder: true,
      };
      const diffs = compareArrays([1, 2, 3], [3, 2, 1], options);
      expect(diffs).toHaveLength(0);
    });

    it("should find missing items with ignoreArrayOrder", () => {
      const options: ObjectComparisonOptions = {
        ...defaultOptions,
        ignoreArrayOrder: true,
      };
      const diffs = compareArrays([1, 2, 3], [1, 2], options);
      expect(diffs.some((d) => d.type === "missing")).toBe(true);
    });

    it("should find extra items with ignoreArrayOrder", () => {
      const options: ObjectComparisonOptions = {
        ...defaultOptions,
        ignoreArrayOrder: true,
      };
      const diffs = compareArrays([1, 2], [1, 2, 3], options);
      expect(diffs.some((d) => d.type === "extra")).toBe(true);
    });
  });

  describe("compareObjects", () => {
    const defaultOptions: ObjectComparisonOptions = {
      style: "strict",
      ignoreExtraFields: false,
      ignoreArrayOrder: false,
      numericTolerance: 0.001,
    };

    it("should find no differences for identical objects", () => {
      const diffs = compareObjects(
        { a: 1, b: 2 },
        { a: 1, b: 2 },
        defaultOptions,
      );
      expect(diffs).toHaveLength(0);
    });

    it("should find missing fields", () => {
      const diffs = compareObjects({ a: 1, b: 2 }, { a: 1 }, defaultOptions);
      expect(diffs).toHaveLength(1);
      expect(diffs[0]!.type).toBe("missing");
    });

    it("should find extra fields", () => {
      const diffs = compareObjects({ a: 1 }, { a: 1, b: 2 }, defaultOptions);
      expect(diffs).toHaveLength(1);
      expect(diffs[0]!.type).toBe("extra");
    });

    it("should ignore extra fields when enabled", () => {
      const options: ObjectComparisonOptions = {
        ...defaultOptions,
        ignoreExtraFields: true,
      };
      const diffs = compareObjects({ a: 1 }, { a: 1, b: 2 }, options);
      expect(diffs).toHaveLength(0);
    });

    it("should find value differences", () => {
      const diffs = compareObjects({ a: 1 }, { a: 2 }, defaultOptions);
      expect(diffs).toHaveLength(1);
      expect(diffs[0]!.type).toBe("different");
    });

    it("should use custom comparisons", () => {
      const options: ObjectComparisonOptions = {
        ...defaultOptions,
        customComparisons: {
          score: (a, b) => Math.abs(a - b) <= 5,
        },
      };
      const diffs = compareObjects({ score: 100 }, { score: 103 }, options);
      expect(diffs).toHaveLength(0);
    });

    it("should report custom comparison failure", () => {
      const options: ObjectComparisonOptions = {
        ...defaultOptions,
        customComparisons: {
          score: () => false,
        },
      };
      const diffs = compareObjects({ score: 100 }, { score: 100 }, options);
      expect(diffs).toHaveLength(1);
    });

    it("should report low custom comparison score", () => {
      const options: ObjectComparisonOptions = {
        ...defaultOptions,
        customComparisons: {
          text: () => 0.5, // Below 0.8 threshold
        },
      };
      const diffs = compareObjects({ text: "a" }, { text: "b" }, options);
      expect(diffs).toHaveLength(1);
      expect(diffs[0]!.severity).toBe("warning");
    });
  });

  describe("compareValues", () => {
    const defaultOptions: ObjectComparisonOptions = {
      style: "strict",
      ignoreExtraFields: false,
      ignoreArrayOrder: false,
      numericTolerance: 0.001,
    };

    it("should return empty for identical values", () => {
      expect(compareValues(1, 1, defaultOptions)).toHaveLength(0);
      expect(compareValues("test", "test", defaultOptions)).toHaveLength(0);
      expect(compareValues(null, null, defaultOptions)).toHaveLength(0);
    });

    it("should detect type mismatches", () => {
      const diffs = compareValues(1, "1", defaultOptions);
      expect(diffs).toHaveLength(1);
      expect(diffs[0]!.type).toBe("type-mismatch");
    });

    it("should compare numbers with tolerance", () => {
      const options: ObjectComparisonOptions = {
        ...defaultOptions,
        numericTolerance: 0.1,
      };
      expect(compareValues(1.0, 1.05, options)).toHaveLength(0);
    });

    it("should compare strings with similarity in lenient mode", () => {
      const options: ObjectComparisonOptions = {
        ...defaultOptions,
        style: "lenient",
      };
      // Use more similar strings to trigger warning (>= 0.8 similarity)
      const diffs = compareValues(
        "hello world test",
        "hello world tset",
        options,
      );
      // Similar strings should be warning in lenient mode
      expect(diffs[0]?.severity).toBe("warning");
    });

    it("should compare booleans", () => {
      const diffs = compareValues(true, false, defaultOptions);
      expect(diffs).toHaveLength(1);
    });

    it("should compare nested objects", () => {
      const diffs = compareValues(
        { nested: { a: 1 } },
        { nested: { a: 2 } },
        defaultOptions,
      );
      expect(diffs).toHaveLength(1);
    });

    it("should compare arrays", () => {
      const diffs = compareValues([1, 2], [1, 3], defaultOptions);
      expect(diffs).toHaveLength(1);
    });

    it("should handle undefined values", () => {
      expect(compareValues(undefined, undefined, defaultOptions)).toHaveLength(
        0,
      );
      const diffs = compareValues(undefined, null, defaultOptions);
      expect(diffs).toHaveLength(1);
    });
  });

  describe("getType", () => {
    it("should identify null", () => {
      expect(getType(null)).toBe("null");
    });

    it("should identify undefined", () => {
      expect(getType(undefined)).toBe("undefined");
    });

    it("should identify arrays", () => {
      expect(getType([])).toBe("array");
      expect(getType([1, 2, 3])).toBe("array");
    });

    it("should identify objects", () => {
      expect(getType({})).toBe("object");
      expect(getType({ a: 1 })).toBe("object");
    });

    it("should identify primitives", () => {
      expect(getType("string")).toBe("string");
      expect(getType(123)).toBe("number");
      expect(getType(true)).toBe("boolean");
    });
  });

  describe("deepEqual", () => {
    it("should return true for reference equality", () => {
      const obj = { a: 1 };
      expect(deepEqual(obj, obj)).toBe(true);
    });

    it("should return true for identical primitives", () => {
      expect(deepEqual(1, 1)).toBe(true);
      expect(deepEqual("test", "test")).toBe(true);
      expect(deepEqual(true, true)).toBe(true);
    });

    it("should return false for null comparisons", () => {
      expect(deepEqual(null, {})).toBe(false);
      expect(deepEqual({}, null)).toBe(false);
    });

    it("should return false for undefined comparisons", () => {
      expect(deepEqual(undefined, {})).toBe(false);
      expect(deepEqual({}, undefined)).toBe(false);
    });

    it("should return false for type mismatches", () => {
      expect(deepEqual(1, "1")).toBe(false);
      expect(deepEqual([], {})).toBe(false);
    });

    it("should compare arrays deeply", () => {
      expect(deepEqual([1, 2, 3], [1, 2, 3])).toBe(true);
      expect(deepEqual([1, 2], [1, 2, 3])).toBe(false);
      expect(deepEqual([1, [2, 3]], [1, [2, 3]])).toBe(true);
    });

    it("should compare objects deeply", () => {
      expect(deepEqual({ a: 1, b: 2 }, { a: 1, b: 2 })).toBe(true);
      expect(deepEqual({ a: 1 }, { a: 1, b: 2 })).toBe(false);
      expect(deepEqual({ a: { b: 1 } }, { a: { b: 1 } })).toBe(true);
    });

    it("should return false for missing keys", () => {
      expect(deepEqual({ a: 1, b: 2 }, { a: 1 })).toBe(false);
    });
  });

  describe("calculateSimilarityScore", () => {
    it("should return 1.0 for no differences", () => {
      expect(calculateSimilarityScore([], 5)).toBe(1.0);
    });

    it("should return 1.0 for zero total fields", () => {
      expect(calculateSimilarityScore([], 0)).toBe(1.0);
    });

    it("should penalize errors more than warnings", () => {
      const errorDiff: Difference[] = [
        {
          path: "a",
          expected: 1,
          actual: 2,
          type: "different",
          severity: "error",
          message: "",
        },
      ];
      const warningDiff: Difference[] = [
        {
          path: "a",
          expected: 1,
          actual: 2,
          type: "different",
          severity: "warning",
          message: "",
        },
      ];

      const errorScore = calculateSimilarityScore(errorDiff, 2);
      const warningScore = calculateSimilarityScore(warningDiff, 2);

      expect(warningScore).toBeGreaterThan(errorScore);
    });

    it("should handle info severity", () => {
      const infoDiff: Difference[] = [
        {
          path: "a",
          expected: 1,
          actual: 2,
          type: "extra",
          severity: "info",
          message: "",
        },
      ];
      const score = calculateSimilarityScore(infoDiff, 10);
      expect(score).toBeGreaterThan(0.9);
    });
  });

  describe("countFields", () => {
    it("should count primitive as 1", () => {
      expect(countFields("string")).toBe(1);
      expect(countFields(123)).toBe(1);
      expect(countFields(true)).toBe(1);
    });

    it("should count object fields recursively", () => {
      expect(countFields({ a: 1, b: 2 })).toBe(4); // 2 keys + 2 values
    });

    it("should count nested objects", () => {
      expect(countFields({ a: { b: 1 } })).toBe(3); // a + b + 1
    });

    it("should count array items", () => {
      expect(countFields([1, 2, 3])).toBe(3);
    });

    it("should count nested arrays", () => {
      expect(countFields([1, [2, 3]])).toBe(3);
    });
  });
});
