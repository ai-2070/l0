import { describe, it, expect } from "vitest";
import { z } from "zod";
import {
  evaluate,
  evaluateBatch,
  validateSchema,
  assertMatch,
  similarity,
  matches,
  getDifferences,
  createMatcher,
  snapshot,
} from "../src/evaluate";

describe("Evaluate API", () => {
  describe("evaluate", () => {
    describe("exact matching", () => {
      it("should match identical primitives", () => {
        expect(evaluate({ expected: "hello", actual: "hello" }).match).toBe(
          true,
        );
        expect(evaluate({ expected: 42, actual: 42 }).match).toBe(true);
        expect(evaluate({ expected: true, actual: true }).match).toBe(true);
      });

      it("should match identical objects", () => {
        const result = evaluate({
          expected: { a: 1, b: 2 },
          actual: { a: 1, b: 2 },
        });

        expect(result.match).toBe(true);
        expect(result.score).toBe(1.0);
        expect(result.details.exactMatch).toBe(true);
      });

      it("should match identical arrays", () => {
        const result = evaluate({
          expected: [1, 2, 3],
          actual: [1, 2, 3],
        });

        expect(result.match).toBe(true);
        expect(result.details.exactMatch).toBe(true);
      });

      it("should not match different values", () => {
        const result = evaluate({
          expected: { a: 1 },
          actual: { a: 2 },
        });

        expect(result.match).toBe(false);
        expect(result.differences.length).toBeGreaterThan(0);
      });
    });

    describe("fuzzy string matching", () => {
      it("should calculate string similarity", () => {
        const result = evaluate({
          expected: "hello world",
          actual: "hello there",
          style: "lenient",
        });

        expect(result.details.comparisonType).toBe("fuzzy");
        expect(result.details.contentSimilarity).toBeGreaterThan(0.5);
      });

      it("should calculate similarity for similar strings in lenient mode", () => {
        const result = evaluate({
          expected: "hello world test",
          actual: "hello world tset",
          style: "lenient",
          threshold: 0.5,
        });

        // Similar strings get compared with levenshtein
        expect(result.details.comparisonType).toBe("fuzzy");
        expect(result.details.contentSimilarity).toBeGreaterThan(0.8);
        // Score may differ from contentSimilarity due to penalty calculation
        expect(result.match).toBe(true);
      });

      it("should fail similar strings in strict mode", () => {
        const result = evaluate({
          expected: "hello",
          actual: "hallo",
          style: "strict",
        });

        expect(result.match).toBe(false);
      });
    });

    describe("numeric comparison", () => {
      it("should match identical numbers", () => {
        const result = evaluate({
          expected: 42,
          actual: 42,
        });

        expect(result.match).toBe(true);
        expect(result.details.exactMatch).toBe(true);
      });

      it("should fail different numbers in strict mode", () => {
        const result = evaluate({
          expected: 1.0,
          actual: 1.1,
        });

        expect(result.match).toBe(false);
      });
    });

    describe("structural comparison", () => {
      it("should find missing fields", () => {
        const result = evaluate({
          expected: { a: 1, b: 2 },
          actual: { a: 1 },
        });

        expect(result.match).toBe(false);
        expect(result.differences.some((d) => d.type === "missing")).toBe(true);
      });

      it("should find extra fields", () => {
        const result = evaluate({
          expected: { a: 1 },
          actual: { a: 1, b: 2 },
        });

        expect(result.match).toBe(false);
        expect(result.differences.some((d) => d.type === "extra")).toBe(true);
      });

      it("should ignore extra fields in lenient mode", () => {
        const result = evaluate({
          expected: { a: 1 },
          actual: { a: 1, b: 2 },
          style: "lenient",
        });

        // Lenient mode ignores extra fields by default
        expect(result.match).toBe(true);
      });

      it("should compare arrays with order", () => {
        const result = evaluate({
          expected: [1, 2, 3],
          actual: [3, 2, 1],
        });

        expect(result.match).toBe(false);
      });

      it("should detect array order differences", () => {
        const result = evaluate({
          expected: [1, 2, 3],
          actual: [3, 2, 1],
        });

        // In strict mode, order matters
        expect(result.match).toBe(false);
        expect(result.differences.length).toBeGreaterThan(0);
      });
    });

    describe("schema validation", () => {
      it("should validate against Zod schema", () => {
        const schema = z.object({
          name: z.string(),
          age: z.number(),
        });

        const result = evaluate({
          expected: schema,
          actual: { name: "Alice", age: 30 },
        });

        expect(result.match).toBe(true);
        expect(result.details.schemaValid).toBe(true);
        expect(result.details.comparisonType).toBe("schema");
      });

      it("should fail invalid schema", () => {
        const schema = z.object({
          name: z.string(),
          age: z.number(),
        });

        const result = evaluate({
          expected: schema,
          actual: { name: "Alice", age: "thirty" },
        });

        expect(result.match).toBe(false);
        expect(result.details.schemaValid).toBe(false);
      });
    });

    describe("type mismatch", () => {
      it("should detect type mismatch", () => {
        const result = evaluate({
          expected: { a: 1 },
          actual: "string",
        });

        expect(result.match).toBe(false);
        expect(result.details.comparisonType).toBe("mixed");
      });
    });

    describe("metadata", () => {
      it("should pass through metadata", () => {
        const result = evaluate({
          expected: "test",
          actual: "test",
          metadata: { testId: "123" },
        });

        expect(result.metadata).toEqual({ testId: "123" });
      });
    });
  });

  describe("evaluateBatch", () => {
    it("should evaluate multiple tests", () => {
      const result = evaluateBatch([
        { name: "Test 1", expected: 1, actual: 1 },
        { name: "Test 2", expected: "a", actual: "a" },
        { name: "Test 3", expected: true, actual: true },
      ]);

      expect(result.passed).toBe(true);
      expect(result.passCount).toBe(3);
      expect(result.failCount).toBe(0);
      expect(result.total).toBe(3);
    });

    it("should track failures", () => {
      const result = evaluateBatch([
        { name: "Pass", expected: 1, actual: 1 },
        { name: "Fail", expected: 1, actual: 2 },
      ]);

      expect(result.passed).toBe(false);
      expect(result.passCount).toBe(1);
      expect(result.failCount).toBe(1);
    });

    it("should calculate average score", () => {
      const result = evaluateBatch([
        { name: "Perfect", expected: "test", actual: "test" },
        { name: "Perfect 2", expected: 42, actual: 42 },
      ]);

      expect(result.averageScore).toBe(1.0);
    });

    it("should provide summary", () => {
      const result = evaluateBatch([
        { name: "Exact", expected: { a: 1 }, actual: { a: 1 } },
        {
          name: "Fuzzy",
          expected: "hello world",
          actual: "hello there",
          style: "lenient",
          threshold: 0.5,
        },
      ]);

      expect(result.summary.exactMatches).toBe(1);
    });
  });

  describe("validateSchema", () => {
    it("should validate valid data", () => {
      const schema = z.object({ x: z.number() });
      const result = validateSchema(schema, { x: 42 });

      expect(result.valid).toBe(true);
      expect(result.data).toEqual({ x: 42 });
      expect(result.differences).toHaveLength(0);
    });

    it("should return errors for invalid data", () => {
      const schema = z.object({ x: z.number() });
      const result = validateSchema(schema, { x: "not a number" });

      expect(result.valid).toBe(false);
      expect(result.errors).toBeDefined();
      expect(result.differences.length).toBeGreaterThan(0);
    });
  });

  describe("assertMatch", () => {
    it("should not throw for matching values", () => {
      expect(() =>
        assertMatch({ expected: "test", actual: "test" }),
      ).not.toThrow();
    });

    it("should throw for non-matching values", () => {
      expect(() =>
        assertMatch({ expected: "test", actual: "different" }),
      ).toThrow("Evaluation failed");
    });
  });

  describe("similarity", () => {
    it("should return 1.0 for identical strings", () => {
      expect(similarity("hello world", "hello world")).toBe(1.0);
    });

    it("should return 1.0 for identical values", () => {
      expect(similarity("test", "test")).toBe(1.0);
      expect(similarity({ a: 1 }, { a: 1 })).toBe(1.0);
    });

    it("should return lower score for different values", () => {
      const score = similarity({ a: 1 }, { a: 2 });
      expect(score).toBeLessThan(1.0);
    });
  });

  describe("matches", () => {
    it("should return true for matching values", () => {
      expect(matches("test", "test")).toBe(true);
      expect(matches({ a: 1 }, { a: 1 })).toBe(true);
    });

    it("should return false for non-matching values", () => {
      expect(matches("test", "different")).toBe(false);
    });

    it("should respect style option", () => {
      // Lenient mode ignores extra fields
      expect(matches({ a: 1 }, { a: 1, b: 2 }, { style: "lenient" })).toBe(
        true,
      );
    });
  });

  describe("getDifferences", () => {
    it("should return empty array for matching values", () => {
      const diffs = getDifferences({ a: 1 }, { a: 1 });
      expect(diffs).toHaveLength(0);
    });

    it("should return differences for non-matching values", () => {
      const diffs = getDifferences({ a: 1, b: 2 }, { a: 1, b: 3 });
      expect(diffs.length).toBeGreaterThan(0);
      expect(diffs[0]!.path).toBe("b");
    });
  });

  describe("createMatcher", () => {
    it("should create a matcher function", () => {
      const matchesNumber = createMatcher(42);

      expect(matchesNumber(42)).toBe(true);
      expect(matchesNumber(43)).toBe(false);
    });

    it("should work with schema", () => {
      const schema = z.object({ name: z.string() });
      const matchesUser = createMatcher(schema);

      expect(matchesUser({ name: "Alice" })).toBe(true);
      expect(matchesUser({ name: 123 })).toBe(false);
    });
  });

  describe("snapshot", () => {
    it("should create snapshot on first run", () => {
      const snapshots = new Map();
      const result = snapshot("test1", { x: 1 }, snapshots);

      expect(result.match).toBe(true);
      expect(result.metadata?.snapshot).toBe("created");
      expect(snapshots.has("test1")).toBe(true);
    });

    it("should compare against snapshot on subsequent runs", () => {
      const snapshots = new Map();

      // First run - create
      snapshot("test1", { x: 1 }, snapshots);

      // Second run - compare (same value)
      const result = snapshot("test1", { x: 1 }, snapshots);
      expect(result.match).toBe(true);
      expect(result.metadata?.snapshot).toBe("compared");
    });

    it("should detect snapshot differences", () => {
      const snapshots = new Map();

      // First run - create
      snapshot("test1", { x: 1 }, snapshots);

      // Second run - compare (different value)
      const result = snapshot("test1", { x: 2 }, snapshots);
      expect(result.match).toBe(false);
    });
  });
});
