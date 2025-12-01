import { describe, it, expect } from "vitest";
import { shallowClone, shallowCopy } from "../src/utils/shallow";

describe("Shallow Utilities", () => {
  describe("shallowClone", () => {
    it("should return null for null input", () => {
      expect(shallowClone(null)).toBe(null);
    });

    it("should return undefined for undefined input", () => {
      expect(shallowClone(undefined)).toBe(undefined);
    });

    it("should return primitives unchanged", () => {
      expect(shallowClone("hello")).toBe("hello");
      expect(shallowClone(42)).toBe(42);
      expect(shallowClone(true)).toBe(true);
      expect(shallowClone(false)).toBe(false);
      const sym = Symbol("test");
      expect(shallowClone(sym)).toBe(sym);
      expect(shallowClone(BigInt(123))).toBe(BigInt(123));
    });

    it("should clone arrays", () => {
      const original = [1, 2, 3];
      const cloned = shallowClone(original);

      expect(cloned).toEqual([1, 2, 3]);
      expect(cloned).not.toBe(original);
    });

    it("should create shallow copy of arrays (nested refs shared)", () => {
      const nested = { a: 1 };
      const original = [nested, 2];
      const cloned = shallowClone(original);

      expect(cloned[0]).toBe(nested); // Same reference
    });

    it("should clone plain objects", () => {
      const original = { a: 1, b: 2 };
      const cloned = shallowClone(original);

      expect(cloned).toEqual({ a: 1, b: 2 });
      expect(cloned).not.toBe(original);
    });

    it("should create shallow copy of objects (nested refs shared)", () => {
      const nested = { x: 1 };
      const original = { a: nested, b: 2 };
      const cloned = shallowClone(original);

      expect(cloned.a).toBe(nested); // Same reference
    });

    it("should handle empty arrays", () => {
      const cloned = shallowClone([]);
      expect(cloned).toEqual([]);
    });

    it("should handle empty objects", () => {
      const cloned = shallowClone({});
      expect(cloned).toEqual({});
    });
  });

  describe("shallowCopy", () => {
    it("should copy properties from source to target", () => {
      const source = { a: 1, b: 2 };
      const target = { c: 3 };

      shallowCopy(source, target as any);

      expect(target).toEqual({ a: 1, b: 2, c: 3 });
    });

    it("should overwrite existing properties", () => {
      const source = { a: 10 };
      const target = { a: 1, b: 2 };

      shallowCopy(source, target as any);

      expect(target).toEqual({ a: 10, b: 2 });
    });

    it("should handle empty source", () => {
      const source = {};
      const target = { a: 1 };

      shallowCopy(source, target);

      expect(target).toEqual({ a: 1 });
    });
  });
});
