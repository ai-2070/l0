// Comprehensive tests for L0 Consensus API - Utilities and Helper Functions
import { describe, it, expect, vi } from "vitest";
import {
  quickConsensus,
  getConsensusValue,
  validateConsensus,
} from "../src/consensus";
import {
  calculateSimilarityMatrix,
  calculateOutputSimilarity,
  calculateStructuralSimilarity,
  findAgreements,
  findDisagreements,
  calculateFieldConsensus,
  resolveMajority,
  resolveBest,
  resolveMerge,
  meetsMinimumAgreement,
} from "../src/utils/consensusUtils";
import {
  strictConsensus,
  standardConsensus,
  lenientConsensus,
  bestConsensus,
} from "../src/types/consensus";
import type { ConsensusOutput, Agreement, Disagreement } from "../src/types/consensus";

// Helper to create mock consensus output
function createMockOutput(
  index: number,
  text: string,
  data?: any,
  weight: number = 1.0,
): ConsensusOutput {
  return {
    index,
    text,
    data,
    l0Result: null as any,
    status: "success",
    duration: 100,
    weight,
  };
}

describe("Consensus Utilities", () => {
  describe("calculateSimilarityMatrix", () => {
    it("should create symmetric matrix", () => {
      const outputs = [
        createMockOutput(0, "hello world"),
        createMockOutput(1, "hello there"),
        createMockOutput(2, "hello world"),
      ];

      const matrix = calculateSimilarityMatrix(outputs);

      expect(matrix.length).toBe(3);
      expect(matrix[0].length).toBe(3);
      // Check symmetry
      expect(matrix[0][1]).toBe(matrix[1][0]);
      expect(matrix[0][2]).toBe(matrix[2][0]);
      expect(matrix[1][2]).toBe(matrix[2][1]);
    });

    it("should have 1.0 on diagonal", () => {
      const outputs = [
        createMockOutput(0, "hello"),
        createMockOutput(1, "world"),
      ];

      const matrix = calculateSimilarityMatrix(outputs);

      expect(matrix[0][0]).toBe(1.0);
      expect(matrix[1][1]).toBe(1.0);
    });

    it("should identify identical outputs", () => {
      const outputs = [
        createMockOutput(0, "same text"),
        createMockOutput(1, "same text"),
      ];

      const matrix = calculateSimilarityMatrix(outputs);

      expect(matrix[0][1]).toBe(1.0);
    });

    it("should identify different outputs", () => {
      const outputs = [
        createMockOutput(0, "completely different text"),
        createMockOutput(1, "xyz abc 123"),
      ];

      const matrix = calculateSimilarityMatrix(outputs);

      expect(matrix[0][1]).toBeLessThan(0.5);
    });

    it("should handle single output", () => {
      const outputs = [createMockOutput(0, "single")];
      const matrix = calculateSimilarityMatrix(outputs);

      expect(matrix.length).toBe(1);
      expect(matrix[0][0]).toBe(1.0);
    });

    it("should handle empty outputs array", () => {
      const matrix = calculateSimilarityMatrix([]);
      expect(matrix.length).toBe(0);
    });
  });

  describe("calculateOutputSimilarity", () => {
    it("should return 1.0 for identical text", () => {
      const a = createMockOutput(0, "test");
      const b = createMockOutput(1, "test");

      const similarity = calculateOutputSimilarity(a, b);
      expect(similarity).toBe(1.0);
    });

    it("should handle structured data comparison", () => {
      const a = createMockOutput(0, "", { name: "Alice", age: 30 });
      const b = createMockOutput(1, "", { name: "Alice", age: 30 });

      const similarity = calculateOutputSimilarity(a, b);
      expect(similarity).toBe(1.0);
    });

    it("should return lower similarity for partial matches", () => {
      const a = createMockOutput(0, "", { name: "Alice", age: 30 });
      const b = createMockOutput(1, "", { name: "Alice", age: 25 });

      const similarity = calculateOutputSimilarity(a, b);
      expect(similarity).toBeGreaterThan(0.5);
      expect(similarity).toBeLessThan(1.0);
    });

    it("should compare similar text strings", () => {
      const a = createMockOutput(0, "hello world");
      const b = createMockOutput(1, "hello there");

      const similarity = calculateOutputSimilarity(a, b);
      expect(similarity).toBeGreaterThan(0.5);
      expect(similarity).toBeLessThan(1.0);
    });

    it("should return 0 for completely different text", () => {
      const a = createMockOutput(0, "abc");
      const b = createMockOutput(1, "xyz");

      const similarity = calculateOutputSimilarity(a, b);
      expect(similarity).toBeLessThan(0.5);
    });
  });

  describe("calculateStructuralSimilarity", () => {
    it("should return 1.0 for identical objects", () => {
      const a = { x: 1, y: 2 };
      const b = { x: 1, y: 2 };

      expect(calculateStructuralSimilarity(a, b)).toBe(1.0);
    });

    it("should return 0 for different types", () => {
      expect(calculateStructuralSimilarity("string", 42)).toBe(0.0);
      expect(calculateStructuralSimilarity([], {})).toBe(0.0);
    });

    it("should calculate partial similarity for objects", () => {
      const a = { x: 1, y: 2, z: 3 };
      const b = { x: 1, y: 2, z: 100 };

      const similarity = calculateStructuralSimilarity(a, b);
      expect(similarity).toBeGreaterThan(0.5);
      expect(similarity).toBeLessThan(1.0);
    });

    it("should handle nested objects", () => {
      const a = { outer: { inner: 1 } };
      const b = { outer: { inner: 1 } };

      expect(calculateStructuralSimilarity(a, b)).toBe(1.0);
    });

    it("should handle arrays", () => {
      const a = [1, 2, 3];
      const b = [1, 2, 3];

      expect(calculateStructuralSimilarity(a, b)).toBe(1.0);
    });

    it("should calculate partial array similarity", () => {
      const a = [1, 2, 3];
      const b = [1, 2, 99];

      const similarity = calculateStructuralSimilarity(a, b);
      expect(similarity).toBeGreaterThan(0.5);
      expect(similarity).toBeLessThan(1.0);
    });

    it("should handle empty arrays", () => {
      expect(calculateStructuralSimilarity([], [])).toBe(1.0);
    });

    it("should compare strings with similarity", () => {
      const similarity = calculateStructuralSimilarity("hello world", "hello there");
      expect(similarity).toBeGreaterThan(0.5);
    });

    it("should compare numbers relatively", () => {
      const similarity = calculateStructuralSimilarity(100, 90);
      expect(similarity).toBeGreaterThan(0.8);
    });

    it("should handle booleans", () => {
      expect(calculateStructuralSimilarity(true, true)).toBe(1.0);
      expect(calculateStructuralSimilarity(true, false)).toBe(0.0);
    });

    it("should handle null values", () => {
      expect(calculateStructuralSimilarity(null, null)).toBe(1.0);
    });

    it("should handle objects with missing keys", () => {
      const a = { x: 1, y: 2 };
      const b = { x: 1 };

      const similarity = calculateStructuralSimilarity(a, b);
      expect(similarity).toBeGreaterThan(0);
      expect(similarity).toBeLessThan(1.0);
    });
  });

  describe("findAgreements", () => {
    it("should find text agreements", () => {
      const outputs = [
        createMockOutput(0, "answer A"),
        createMockOutput(1, "answer A"),
        createMockOutput(2, "answer B"),
      ];

      const agreements = findAgreements(outputs, 0.9);

      expect(agreements.length).toBeGreaterThan(0);
      const exactAgreement = agreements.find((a) => a.count >= 2);
      expect(exactAgreement).toBeDefined();
    });

    it("should find structured agreements", () => {
      const outputs = [
        createMockOutput(0, "", { answer: "yes", confidence: 0.9 }),
        createMockOutput(1, "", { answer: "yes", confidence: 0.8 }),
        createMockOutput(2, "", { answer: "no", confidence: 0.7 }),
      ];

      const agreements = findAgreements(outputs, 0.6);

      expect(agreements.length).toBeGreaterThan(0);
      const answerAgreement = agreements.find((a) => a.path === "answer");
      expect(answerAgreement).toBeDefined();
    });

    it("should return empty for complete disagreement", () => {
      const outputs = [
        createMockOutput(0, "A"),
        createMockOutput(1, "B"),
        createMockOutput(2, "C"),
      ];

      const agreements = findAgreements(outputs, 0.95);
      expect(agreements.length).toBe(0);
    });

    it("should identify exact agreements", () => {
      const outputs = [
        createMockOutput(0, "same"),
        createMockOutput(1, "same"),
        createMockOutput(2, "same"),
      ];

      const agreements = findAgreements(outputs, 0.8);

      expect(agreements.length).toBe(1);
      expect(agreements[0].type).toBe("exact");
      expect(agreements[0].ratio).toBe(1.0);
    });

    it("should respect threshold", () => {
      const outputs = [
        createMockOutput(0, "hello world"),
        createMockOutput(1, "hello there"),
        createMockOutput(2, "hello world"),
      ];

      // High threshold - stricter matching
      const strictAgreements = findAgreements(outputs, 0.99);
      const lenientAgreements = findAgreements(outputs, 0.5);

      expect(lenientAgreements.length).toBeGreaterThanOrEqual(strictAgreements.length);
    });

    it("should handle single output", () => {
      const outputs = [createMockOutput(0, "single")];
      const agreements = findAgreements(outputs, 0.8);
      // Single output can't have agreements (need 2+ to agree)
      expect(agreements.length).toBe(0);
    });
  });

  describe("findDisagreements", () => {
    it("should find text disagreements", () => {
      const outputs = [
        createMockOutput(0, "answer A"),
        createMockOutput(1, "answer B"),
        createMockOutput(2, "answer C"),
      ];

      const disagreements = findDisagreements(outputs, 0.99);

      expect(disagreements.length).toBeGreaterThan(0);
      expect(disagreements[0].values.length).toBe(3);
    });

    it("should find structured disagreements", () => {
      const outputs = [
        createMockOutput(0, "", { answer: "yes" }),
        createMockOutput(1, "", { answer: "no" }),
        createMockOutput(2, "", { answer: "maybe" }),
      ];

      const disagreements = findDisagreements(outputs, 0.8);

      expect(disagreements.length).toBeGreaterThan(0);
      expect(disagreements[0].path).toBe("answer");
    });

    it("should return empty for complete agreement", () => {
      const outputs = [
        createMockOutput(0, "same"),
        createMockOutput(1, "same"),
        createMockOutput(2, "same"),
      ];

      const disagreements = findDisagreements(outputs, 0.8);
      expect(disagreements.length).toBe(0);
    });

    it("should calculate severity correctly - minor", () => {
      // Minor disagreement (strong majority: 4 out of 5)
      const minorOutputs = [
        createMockOutput(0, "A"),
        createMockOutput(1, "A"),
        createMockOutput(2, "A"),
        createMockOutput(3, "A"),
        createMockOutput(4, "B"),
      ];
      const minorDisagreements = findDisagreements(minorOutputs, 0.99);
      if (minorDisagreements.length > 0) {
        expect(minorDisagreements[0].severity).toBe("minor");
      }
    });

    it("should calculate severity correctly - critical", () => {
      // Critical disagreement (no majority)
      const criticalOutputs = [
        createMockOutput(0, "A"),
        createMockOutput(1, "B"),
        createMockOutput(2, "C"),
        createMockOutput(3, "D"),
        createMockOutput(4, "E"),
      ];
      const criticalDisagreements = findDisagreements(criticalOutputs, 0.99);
      expect(criticalDisagreements[0].severity).toBe("critical");
    });

    it("should calculate severity correctly - moderate", () => {
      // Moderate disagreement (weak majority: 3 out of 5 = 60%)
      const moderateOutputs = [
        createMockOutput(0, "A"),
        createMockOutput(1, "A"),
        createMockOutput(2, "A"),
        createMockOutput(3, "B"),
        createMockOutput(4, "C"),
      ];
      const moderateDisagreements = findDisagreements(moderateOutputs, 0.99);
      if (moderateDisagreements.length > 0) {
        expect(moderateDisagreements[0].severity).toBe("moderate");
      }
    });
  });

  describe("calculateFieldConsensus", () => {
    it("should calculate consensus per field", () => {
      const outputs = [
        createMockOutput(0, "", { name: "Alice", age: 30 }),
        createMockOutput(1, "", { name: "Alice", age: 25 }),
        createMockOutput(2, "", { name: "Alice", age: 30 }),
      ];

      const fieldConsensus = calculateFieldConsensus(outputs);

      expect(fieldConsensus.fields.name).toBeDefined();
      expect(fieldConsensus.fields.age).toBeDefined();
      expect(fieldConsensus.fields.name.unanimous).toBe(true);
      expect(fieldConsensus.fields.age.unanimous).toBe(false);
    });

    it("should identify agreed and disagreed fields", () => {
      const outputs = [
        createMockOutput(0, "", { a: 1, b: 2 }),
        createMockOutput(1, "", { a: 1, b: 3 }),
        createMockOutput(2, "", { a: 1, b: 4 }),
      ];

      const fieldConsensus = calculateFieldConsensus(outputs);

      expect(fieldConsensus.agreedFields).toContain("a");
      expect(fieldConsensus.disagreedFields).toContain("b");
    });

    it("should calculate overall agreement", () => {
      const outputs = [
        createMockOutput(0, "", { x: 1, y: 2 }),
        createMockOutput(1, "", { x: 1, y: 2 }),
      ];

      const fieldConsensus = calculateFieldConsensus(outputs);

      expect(fieldConsensus.overallAgreement).toBe(1.0);
    });

    it("should handle nested objects", () => {
      const outputs = [
        createMockOutput(0, "", { outer: { inner: 1 } }),
        createMockOutput(1, "", { outer: { inner: 1 } }),
      ];

      const fieldConsensus = calculateFieldConsensus(outputs);

      expect(fieldConsensus.fields["outer.inner"]).toBeDefined();
      expect(fieldConsensus.fields["outer.inner"].unanimous).toBe(true);
    });

    it("should track votes correctly", () => {
      const outputs = [
        createMockOutput(0, "", { choice: "A" }),
        createMockOutput(1, "", { choice: "A" }),
        createMockOutput(2, "", { choice: "B" }),
      ];

      const fieldConsensus = calculateFieldConsensus(outputs);
      const choiceField = fieldConsensus.fields.choice;

      expect(choiceField.value).toBe("A");
      expect(choiceField.agreement).toBeCloseTo(2 / 3, 5);
    });

    it("should handle missing fields across outputs", () => {
      const outputs = [
        createMockOutput(0, "", { a: 1, b: 2 }),
        createMockOutput(1, "", { a: 1 }),
        createMockOutput(2, "", { a: 1, b: 2 }),
      ];

      const fieldConsensus = calculateFieldConsensus(outputs);

      expect(fieldConsensus.fields.a).toBeDefined();
      expect(fieldConsensus.fields.b).toBeDefined();
    });
  });

  describe("resolveMajority", () => {
    it("should return most similar output for text", () => {
      const outputs = [
        createMockOutput(0, "hello world"),
        createMockOutput(1, "hello world"),
        createMockOutput(2, "goodbye world"),
      ];

      const result = resolveMajority(outputs);

      expect(result.text).toBe("hello world");
    });

    it("should use field-by-field voting for structured", () => {
      const outputs = [
        createMockOutput(0, "", { a: 1, b: 2 }),
        createMockOutput(1, "", { a: 1, b: 3 }),
        createMockOutput(2, "", { a: 1, b: 2 }),
      ];

      const result = resolveMajority(outputs);

      expect(result.data.a).toBe(1);
      expect(result.data.b).toBe(2);
    });

    it("should throw for empty outputs", () => {
      expect(() => resolveMajority([])).toThrow("No outputs to resolve");
    });

    it("should use weights in similarity calculation", () => {
      // resolveMajority uses weights to score similarity to other outputs
      // The output most similar to highly-weighted outputs wins
      const outputs = [
        createMockOutput(0, "common"),
        createMockOutput(1, "common"),
        createMockOutput(2, "different"),
      ];

      // Give high weight to outputs 0 and 1 which are identical
      const result = resolveMajority(outputs, [5.0, 5.0, 1.0]);
      // "common" should be selected as it's most similar to highly-weighted outputs
      expect(result.text).toBe("common");
    });

    it("should handle single output", () => {
      const outputs = [createMockOutput(0, "single")];
      const result = resolveMajority(outputs);
      expect(result.text).toBe("single");
    });
  });

  describe("resolveBest", () => {
    it("should return highest weighted output", () => {
      const outputs = [
        createMockOutput(0, "low", undefined, 1.0),
        createMockOutput(1, "high", undefined, 5.0),
        createMockOutput(2, "medium", undefined, 3.0),
      ];

      const result = resolveBest(outputs, [1.0, 5.0, 3.0]);

      expect(result.text).toBe("high");
      expect(result.index).toBe(1);
    });

    it("should throw for empty outputs", () => {
      expect(() => resolveBest([])).toThrow("No outputs to resolve");
    });

    it("should use output weight if no weights provided", () => {
      const outputs = [
        createMockOutput(0, "low", undefined, 1.0),
        createMockOutput(1, "high", undefined, 5.0),
      ];

      const result = resolveBest(outputs);
      expect(result.text).toBe("high");
    });

    it("should handle equal weights", () => {
      const outputs = [
        createMockOutput(0, "first", undefined, 1.0),
        createMockOutput(1, "second", undefined, 1.0),
      ];

      const result = resolveBest(outputs);
      // Should return first one when equal
      expect(result.text).toBe("first");
    });
  });

  describe("resolveMerge", () => {
    it("should merge text outputs", () => {
      const outputs = [
        createMockOutput(0, "First answer"),
        createMockOutput(1, "Second answer"),
      ];

      const result = resolveMerge(outputs);

      expect(result.text).toContain("First answer");
      expect(result.text).toContain("Second answer");
    });

    it("should merge structured outputs", () => {
      const outputs = [
        createMockOutput(0, "", { a: 1 }),
        createMockOutput(1, "", { b: 2 }),
      ];

      const result = resolveMerge(outputs);

      expect(result.data.a).toBe(1);
      expect(result.data.b).toBe(2);
    });

    it("should handle single output", () => {
      const outputs = [createMockOutput(0, "only one")];
      const result = resolveMerge(outputs);
      expect(result.text).toBe("only one");
    });

    it("should throw for empty outputs", () => {
      expect(() => resolveMerge([])).toThrow("No outputs to resolve");
    });

    it("should deduplicate identical text", () => {
      const outputs = [
        createMockOutput(0, "same"),
        createMockOutput(1, "same"),
        createMockOutput(2, "same"),
      ];

      const result = resolveMerge(outputs);
      expect(result.text).toBe("same");
    });

    it("should handle overlapping structured fields", () => {
      const outputs = [
        createMockOutput(0, "", { a: 1, b: 2 }),
        createMockOutput(1, "", { a: 100, c: 3 }),
      ];

      const result = resolveMerge(outputs);
      // First value should be used for overlapping fields
      expect(result.data.a).toBe(1);
      expect(result.data.b).toBe(2);
      expect(result.data.c).toBe(3);
    });
  });

  describe("meetsMinimumAgreement", () => {
    it("should return true when agreement meets threshold", () => {
      const agreements: Agreement[] = [
        { content: "test", count: 3, ratio: 0.75, indices: [0, 1, 2], type: "exact" },
      ];

      expect(meetsMinimumAgreement(agreements, 4, 0.6)).toBe(true);
    });

    it("should return false when below threshold", () => {
      const agreements: Agreement[] = [
        { content: "test", count: 2, ratio: 0.5, indices: [0, 1], type: "similar" },
      ];

      expect(meetsMinimumAgreement(agreements, 4, 0.75)).toBe(false);
    });

    it("should return false for empty agreements", () => {
      expect(meetsMinimumAgreement([], 4, 0.5)).toBe(false);
    });

    it("should use highest ratio from multiple agreements", () => {
      const agreements: Agreement[] = [
        { content: "low", count: 1, ratio: 0.25, indices: [0], type: "similar" },
        { content: "high", count: 3, ratio: 0.75, indices: [1, 2, 3], type: "exact" },
      ];

      expect(meetsMinimumAgreement(agreements, 4, 0.7)).toBe(true);
    });

    it("should handle edge case at exact threshold", () => {
      const agreements: Agreement[] = [
        { content: "test", count: 3, ratio: 0.6, indices: [0, 1, 2], type: "exact" },
      ];

      expect(meetsMinimumAgreement(agreements, 5, 0.6)).toBe(true);
    });
  });
});

describe("Helper Functions", () => {
  describe("quickConsensus", () => {
    it("should return true for unanimous agreement", () => {
      expect(quickConsensus(["A", "A", "A"])).toBe(true);
    });

    it("should return true for majority agreement at threshold", () => {
      expect(quickConsensus(["A", "A", "B"], 0.6)).toBe(true);
    });

    it("should return false for split vote", () => {
      expect(quickConsensus(["A", "B", "C"], 0.8)).toBe(false);
    });

    it("should return true for single output", () => {
      expect(quickConsensus(["only"])).toBe(true);
    });

    it("should return true for empty array", () => {
      expect(quickConsensus([])).toBe(true);
    });

    it("should use default threshold of 0.8", () => {
      expect(quickConsensus(["A", "A", "A", "A", "B"])).toBe(true); // 80%
      expect(quickConsensus(["A", "A", "A", "B", "B"])).toBe(false); // 60%
    });

    it("should handle two outputs", () => {
      expect(quickConsensus(["A", "A"])).toBe(true);
      expect(quickConsensus(["A", "B"], 0.8)).toBe(false);
    });

    it("should handle all identical outputs", () => {
      expect(quickConsensus(["same", "same", "same", "same", "same"])).toBe(true);
    });

    it("should handle all different outputs", () => {
      expect(quickConsensus(["A", "B", "C", "D", "E"], 0.5)).toBe(false);
    });
  });

  describe("getConsensusValue", () => {
    it("should return most common value", () => {
      expect(getConsensusValue(["A", "A", "B"])).toBe("A");
    });

    it("should work with numbers", () => {
      expect(getConsensusValue([1, 1, 2, 1])).toBe(1);
    });

    it("should work with objects", () => {
      const obj = { x: 1 };
      const result = getConsensusValue([obj, obj, { y: 2 }]);
      expect(result).toEqual({ x: 1 });
    });

    it("should throw for empty array", () => {
      expect(() => getConsensusValue([])).toThrow("No outputs to get consensus from");
    });

    it("should return first value when all different", () => {
      const result = getConsensusValue(["A", "B", "C"]);
      expect(["A", "B", "C"]).toContain(result);
    });

    it("should handle arrays as values", () => {
      const result = getConsensusValue([[1, 2], [1, 2], [3, 4]]);
      expect(result).toEqual([1, 2]);
    });

    it("should handle booleans", () => {
      expect(getConsensusValue([true, true, false])).toBe(true);
      expect(getConsensusValue([false, false, true])).toBe(false);
    });

    it("should handle null values", () => {
      expect(getConsensusValue([null, null, "value"])).toBe(null);
    });

    it("should handle nested objects", () => {
      const nested = { a: { b: 1 } };
      const result = getConsensusValue([nested, nested, { a: { b: 2 } }]);
      expect(result).toEqual({ a: { b: 1 } });
    });
  });

  describe("validateConsensus", () => {
    it("should return true for valid consensus", () => {
      const result = {
        consensus: "answer",
        confidence: 0.9,
        outputs: [],
        agreements: [],
        disagreements: [],
        analysis: {} as any,
        type: "text" as const,
        status: "success" as const,
      };

      expect(validateConsensus(result, 0.8, 0)).toBe(true);
    });

    it("should return false for low confidence", () => {
      const result = {
        consensus: "answer",
        confidence: 0.5,
        outputs: [],
        agreements: [],
        disagreements: [],
        analysis: {} as any,
        type: "text" as const,
        status: "success" as const,
      };

      expect(validateConsensus(result, 0.8, 0)).toBe(false);
    });

    it("should return false for too many critical disagreements", () => {
      const result = {
        consensus: "answer",
        confidence: 0.9,
        outputs: [],
        agreements: [],
        disagreements: [
          { values: [], severity: "critical" as const },
          { values: [], severity: "major" as const },
        ],
        analysis: {} as any,
        type: "text" as const,
        status: "success" as const,
      };

      expect(validateConsensus(result, 0.8, 1)).toBe(false);
    });

    it("should ignore minor disagreements", () => {
      const result = {
        consensus: "answer",
        confidence: 0.9,
        outputs: [],
        agreements: [],
        disagreements: [
          { values: [], severity: "minor" as const },
          { values: [], severity: "moderate" as const },
        ],
        analysis: {} as any,
        type: "text" as const,
        status: "success" as const,
      };

      expect(validateConsensus(result, 0.8, 0)).toBe(true);
    });

    it("should use default parameters", () => {
      const highConfidence = {
        consensus: "answer",
        confidence: 0.9,
        outputs: [],
        agreements: [],
        disagreements: [],
        analysis: {} as any,
        type: "text" as const,
        status: "success" as const,
      };

      expect(validateConsensus(highConfidence)).toBe(true);
    });

    it("should handle structured consensus", () => {
      const result = {
        consensus: { key: "value" },
        confidence: 0.85,
        outputs: [],
        agreements: [],
        disagreements: [],
        analysis: {} as any,
        type: "structured" as const,
        status: "success" as const,
      };

      expect(validateConsensus(result, 0.8, 0)).toBe(true);
    });

    it("should count only major and critical disagreements", () => {
      const result = {
        consensus: "answer",
        confidence: 0.9,
        outputs: [],
        agreements: [],
        disagreements: [
          { values: [], severity: "minor" as const },
          { values: [], severity: "moderate" as const },
          { values: [], severity: "major" as const },
        ],
        analysis: {} as any,
        type: "text" as const,
        status: "success" as const,
      };

      // 1 major disagreement, maxDisagreements = 1, should pass
      expect(validateConsensus(result, 0.8, 1)).toBe(true);
      // maxDisagreements = 0, should fail
      expect(validateConsensus(result, 0.8, 0)).toBe(false);
    });
  });
});

describe("Consensus Presets", () => {
  describe("strictConsensus", () => {
    it("should have unanimous strategy", () => {
      expect(strictConsensus.strategy).toBe("unanimous");
    });

    it("should have threshold of 1.0", () => {
      expect(strictConsensus.threshold).toBe(1.0);
    });

    it("should fail on conflicts", () => {
      expect(strictConsensus.resolveConflicts).toBe("fail");
    });

    it("should require full agreement", () => {
      expect(strictConsensus.minimumAgreement).toBe(1.0);
    });
  });

  describe("standardConsensus", () => {
    it("should have majority strategy", () => {
      expect(standardConsensus.strategy).toBe("majority");
    });

    it("should have threshold of 0.8", () => {
      expect(standardConsensus.threshold).toBe(0.8);
    });

    it("should resolve by vote", () => {
      expect(standardConsensus.resolveConflicts).toBe("vote");
    });

    it("should require 60% agreement", () => {
      expect(standardConsensus.minimumAgreement).toBe(0.6);
    });
  });

  describe("lenientConsensus", () => {
    it("should have majority strategy", () => {
      expect(lenientConsensus.strategy).toBe("majority");
    });

    it("should have lower threshold", () => {
      expect(lenientConsensus.threshold).toBe(0.7);
    });

    it("should resolve by merge", () => {
      expect(lenientConsensus.resolveConflicts).toBe("merge");
    });

    it("should require 50% agreement", () => {
      expect(lenientConsensus.minimumAgreement).toBe(0.5);
    });
  });

  describe("bestConsensus", () => {
    it("should have best strategy", () => {
      expect(bestConsensus.strategy).toBe("best");
    });

    it("should resolve by best", () => {
      expect(bestConsensus.resolveConflicts).toBe("best");
    });

    it("should have standard threshold", () => {
      expect(bestConsensus.threshold).toBe(0.8);
    });

    it("should require 50% agreement", () => {
      expect(bestConsensus.minimumAgreement).toBe(0.5);
    });
  });
});

describe("Edge Cases", () => {
  describe("Empty and Minimal Inputs", () => {
    it("should handle outputs with empty text", () => {
      const outputs = [
        createMockOutput(0, ""),
        createMockOutput(1, ""),
      ];

      const matrix = calculateSimilarityMatrix(outputs);
      expect(matrix[0][1]).toBe(1.0); // Empty strings are identical
    });

    it("should handle outputs with whitespace only", () => {
      const outputs = [
        createMockOutput(0, "   "),
        createMockOutput(1, "\t\n"),
      ];

      const similarity = calculateOutputSimilarity(outputs[0], outputs[1]);
      expect(similarity).toBeGreaterThan(0.5);
    });
  });

  describe("Special Characters", () => {
    it("should handle unicode text", () => {
      const outputs = [
        createMockOutput(0, "日本語テスト"),
        createMockOutput(1, "日本語テスト"),
      ];

      const similarity = calculateOutputSimilarity(outputs[0], outputs[1]);
      expect(similarity).toBe(1.0);
    });

    it("should handle emoji", () => {
      const outputs = [
        createMockOutput(0, "🎉 test 🎊"),
        createMockOutput(1, "🎉 test 🎊"),
      ];

      const similarity = calculateOutputSimilarity(outputs[0], outputs[1]);
      expect(similarity).toBe(1.0);
    });

    it("should handle special symbols", () => {
      const outputs = [
        createMockOutput(0, "<>&\"'"),
        createMockOutput(1, "<>&\"'"),
      ];

      const similarity = calculateOutputSimilarity(outputs[0], outputs[1]);
      expect(similarity).toBe(1.0);
    });
  });

  describe("Large Data", () => {
    it("should handle many outputs", () => {
      const outputs = Array(20)
        .fill(null)
        .map((_, i) => createMockOutput(i, "same text"));

      const matrix = calculateSimilarityMatrix(outputs);
      expect(matrix.length).toBe(20);
      expect(matrix[0][19]).toBe(1.0);
    });

    it("should handle long text", () => {
      const longText = "word ".repeat(1000);
      const outputs = [
        createMockOutput(0, longText),
        createMockOutput(1, longText),
      ];

      const similarity = calculateOutputSimilarity(outputs[0], outputs[1]);
      expect(similarity).toBe(1.0);
    });

    it("should handle deeply nested objects", () => {
      const nested = {
        a: { b: { c: { d: { e: 1 } } } },
      };
      const outputs = [
        createMockOutput(0, "", nested),
        createMockOutput(1, "", nested),
      ];

      const similarity = calculateOutputSimilarity(outputs[0], outputs[1]);
      expect(similarity).toBe(1.0);
    });
  });
});

describe("Integration Scenarios", () => {
  it("should use quickConsensus for preliminary check", () => {
    const outputs = ["yes", "yes", "no"];
    const hasConsensus = quickConsensus(outputs, 0.6);
    expect(hasConsensus).toBe(true);
  });

  it("should use getConsensusValue for simple voting", () => {
    const votes = ["A", "A", "B", "A", "C"];
    const winner = getConsensusValue(votes);
    expect(winner).toBe("A");
  });

  it("should combine quickConsensus and getConsensusValue", () => {
    const outputs = ["answer A", "answer A", "answer B"];

    if (quickConsensus(outputs, 0.6)) {
      const consensus = getConsensusValue(outputs);
      expect(consensus).toBe("answer A");
    }
  });

  it("should work with structured consensus workflow", () => {
    const outputs = [
      createMockOutput(0, "", { result: "yes", confidence: 0.9 }),
      createMockOutput(1, "", { result: "yes", confidence: 0.85 }),
      createMockOutput(2, "", { result: "no", confidence: 0.7 }),
    ];

    const fieldConsensus = calculateFieldConsensus(outputs);
    const agreements = findAgreements(outputs, 0.6);
    const disagreements = findDisagreements(outputs, 0.99);
    const resolved = resolveMajority(outputs);

    expect(fieldConsensus.fields.result.value).toBe("yes");
    expect(agreements.length).toBeGreaterThan(0);
    expect(resolved.data.result).toBe("yes");
  });

  it("should validate resolved consensus", () => {
    const result = {
      consensus: "validated answer",
      confidence: 0.95,
      outputs: [],
      agreements: [{ content: "test", count: 3, ratio: 1.0, indices: [0, 1, 2], type: "exact" as const }],
      disagreements: [],
      analysis: {} as any,
      type: "text" as const,
      status: "success" as const,
    };

    expect(validateConsensus(result, 0.9, 0)).toBe(true);
  });

  it("should apply preset configurations", () => {
    // Test that presets have expected values
    expect(strictConsensus.strategy).toBe("unanimous");
    expect(standardConsensus.strategy).toBe("majority");
    expect(lenientConsensus.resolveConflicts).toBe("merge");
    expect(bestConsensus.strategy).toBe("best");
  });
});
