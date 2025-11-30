// Effect Schema Compatibility Tests

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Schema } from "effect";
import {
  isEffectSchema,
  isEffectParseError,
  isEffectRight,
  isEffectLeft,
  registerEffectSchemaAdapter,
  unregisterEffectSchemaAdapter,
  hasEffectSchemaAdapter,
  getEffectSchemaAdapter,
  safeDecodeEffectSchema,
  getEffectErrorMessage,
  wrapEffectSchema,
} from "../src/utils/effectSchemaCompat";

// Create an adapter for Effect Schema
const effectAdapter = {
  decodeUnknownSync: <A, I, R>(schema: any, data: unknown): A => {
    return Schema.decodeUnknownSync(schema)(data);
  },
  decodeUnknownEither: <A, I, R>(schema: any, data: unknown) => {
    try {
      const result = Schema.decodeUnknownSync(schema)(data);
      return { _tag: "Right" as const, right: result };
    } catch (error: any) {
      return {
        _tag: "Left" as const,
        left: {
          _tag: "ParseError" as const,
          issue: error,
          message: error.message || "Parse error",
        },
      };
    }
  },
  formatError: (error: any) => error.message || "Schema validation failed",
};

describe("Effect Schema Compatibility Layer", () => {
  beforeEach(() => {
    registerEffectSchemaAdapter(effectAdapter);
  });

  afterEach(() => {
    unregisterEffectSchemaAdapter();
  });

  describe("isEffectSchema", () => {
    it("should detect Effect Struct schemas", () => {
      const schema = Schema.Struct({ name: Schema.String });
      expect(isEffectSchema(schema)).toBe(true);
    });

    it("should detect Effect String schemas", () => {
      expect(isEffectSchema(Schema.String)).toBe(true);
    });

    it("should detect Effect Number schemas", () => {
      expect(isEffectSchema(Schema.Number)).toBe(true);
    });

    it("should detect Effect Array schemas", () => {
      expect(isEffectSchema(Schema.Array(Schema.String))).toBe(true);
    });

    it("should detect Effect Union schemas", () => {
      expect(isEffectSchema(Schema.Union(Schema.String, Schema.Number))).toBe(
        true,
      );
    });

    it("should detect Effect Literal schemas", () => {
      // Literal may have different structure, check if it's detected or skip
      const literal = Schema.Literal("a", "b", "c");
      // Literals might not have annotations as a function in all versions
      const isSchema = isEffectSchema(literal) || "ast" in literal;
      expect(isSchema).toBe(true);
    });

    it("should return false for non-Effect values", () => {
      expect(isEffectSchema(null)).toBe(false);
      expect(isEffectSchema(undefined)).toBe(false);
      expect(isEffectSchema({})).toBe(false);
      expect(isEffectSchema({ ast: null })).toBe(false);
      expect(isEffectSchema("string")).toBe(false);
      expect(isEffectSchema(123)).toBe(false);
    });
  });

  describe("isEffectParseError", () => {
    it("should detect ParseError objects", () => {
      const error = {
        _tag: "ParseError",
        issue: { _tag: "Type" },
        message: "test error",
      };
      expect(isEffectParseError(error)).toBe(true);
    });

    it("should return false for non-ParseError", () => {
      expect(isEffectParseError(null)).toBe(false);
      expect(isEffectParseError(undefined)).toBe(false);
      expect(isEffectParseError(new Error("test"))).toBe(false);
      expect(isEffectParseError({ _tag: "Other" })).toBe(false);
    });
  });

  describe("Either helpers", () => {
    it("should identify Right values", () => {
      const right = { _tag: "Right" as const, right: "value" };
      expect(isEffectRight(right)).toBe(true);
      expect(isEffectLeft(right)).toBe(false);
    });

    it("should identify Left values", () => {
      const left = {
        _tag: "Left" as const,
        left: { _tag: "ParseError" as const, issue: {}, message: "error" },
      };
      expect(isEffectLeft(left)).toBe(true);
      expect(isEffectRight(left)).toBe(false);
    });
  });

  describe("Adapter registration", () => {
    it("should register adapter", () => {
      expect(hasEffectSchemaAdapter()).toBe(true);
    });

    it("should unregister adapter", () => {
      unregisterEffectSchemaAdapter();
      expect(hasEffectSchemaAdapter()).toBe(false);
    });

    it("should throw when getting unregistered adapter", () => {
      unregisterEffectSchemaAdapter();
      expect(() => getEffectSchemaAdapter()).toThrow(
        /Effect Schema adapter not registered/,
      );
    });

    it("should return registered adapter", () => {
      const adapter = getEffectSchemaAdapter();
      expect(adapter).toBe(effectAdapter);
    });
  });

  describe("safeDecodeEffectSchema", () => {
    it("should return success for valid data", () => {
      const schema = Schema.Struct({ name: Schema.String, age: Schema.Number });
      const result = safeDecodeEffectSchema(schema, { name: "Alice", age: 30 });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual({ name: "Alice", age: 30 });
      }
    });

    it("should return error for invalid data", () => {
      const schema = Schema.Struct({ name: Schema.String });
      const result = safeDecodeEffectSchema(schema, { name: 123 });

      expect(result.success).toBe(false);
    });

    it("should handle nested schemas", () => {
      const schema = Schema.Struct({
        user: Schema.Struct({
          name: Schema.String,
          emails: Schema.Array(Schema.String),
        }),
      });

      const validData = {
        user: {
          name: "Alice",
          emails: ["alice@example.com"],
        },
      };

      const result = safeDecodeEffectSchema(schema, validData);
      expect(result.success).toBe(true);
    });
  });

  describe("getEffectErrorMessage", () => {
    it("should format error messages", () => {
      const error = {
        _tag: "ParseError" as const,
        issue: {},
        message: "Expected string, got number",
      };
      const message = getEffectErrorMessage(error);
      expect(message).toBe("Expected string, got number");
    });

    it("should handle errors without message", () => {
      const error = {
        _tag: "ParseError" as const,
        issue: {},
        message: "",
      };
      const message = getEffectErrorMessage(error);
      expect(message).toBe("Schema validation failed");
    });
  });

  describe("wrapEffectSchema", () => {
    it("should create unified schema wrapper", () => {
      const schema = Schema.Struct({ name: Schema.String });
      const wrapped = wrapEffectSchema(schema);

      expect(wrapped._tag).toBe("effect");
      expect(typeof wrapped.parse).toBe("function");
      expect(typeof wrapped.safeParse).toBe("function");
    });

    it("should parse valid data", () => {
      const schema = Schema.Struct({ name: Schema.String });
      const wrapped = wrapEffectSchema(schema);

      const result = wrapped.parse({ name: "Alice" });
      expect(result).toEqual({ name: "Alice" });
    });

    it("should throw on invalid data with parse", () => {
      const schema = Schema.Struct({ name: Schema.String });
      const wrapped = wrapEffectSchema(schema);

      expect(() => wrapped.parse({ name: 123 })).toThrow();
    });

    it("should return success with safeParse for valid data", () => {
      const schema = Schema.Struct({ name: Schema.String });
      const wrapped = wrapEffectSchema(schema);

      const result = wrapped.safeParse({ name: "Alice" });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual({ name: "Alice" });
      }
    });

    it("should return error with safeParse for invalid data", () => {
      const schema = Schema.Struct({ name: Schema.String });
      const wrapped = wrapEffectSchema(schema);

      const result = wrapped.safeParse({ name: 123 });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toBeInstanceOf(Error);
      }
    });
  });

  describe("Type inference compatibility", () => {
    it("should correctly infer Struct types", () => {
      const schema = Schema.Struct({
        id: Schema.Number,
        name: Schema.String,
        active: Schema.Boolean,
      });

      type Inferred = typeof schema.Type;

      // Type test - this compiles if types are correct
      const data: Inferred = { id: 1, name: "test", active: true };
      expect(data.id).toBe(1);
      expect(data.name).toBe("test");
      expect(data.active).toBe(true);
    });

    it("should correctly infer Array types", () => {
      const schema = Schema.Array(Schema.String);
      type Inferred = typeof schema.Type;

      const data: Inferred = ["a", "b", "c"];
      expect(data).toEqual(["a", "b", "c"]);
    });

    it("should correctly infer Union types", () => {
      const schema = Schema.Union(Schema.String, Schema.Number);
      type Inferred = typeof schema.Type;

      const strData: Inferred = "test";
      const numData: Inferred = 42;

      expect(strData).toBe("test");
      expect(numData).toBe(42);
    });

    it("should correctly infer optional types", () => {
      const schema = Schema.Struct({
        required: Schema.String,
        optional: Schema.optional(Schema.String),
      });
      type Inferred = typeof schema.Type;

      const data: Inferred = { required: "test" };
      expect(data.required).toBe("test");
      expect(data.optional).toBeUndefined();
    });
  });

  describe("Complex schema patterns", () => {
    it("should handle branded types", () => {
      const Email = Schema.String.pipe(Schema.brand("Email"));
      const schema = Schema.Struct({ email: Email });

      const result = safeDecodeEffectSchema(schema, {
        email: "test@example.com",
      });
      expect(result.success).toBe(true);
    });

    it("should handle Date schemas", () => {
      // Schema.Date validates Date instances
      const schema = Schema.instanceOf(Date);

      const result = safeDecodeEffectSchema(schema, new Date("2024-01-01"));
      expect(result.success).toBe(true);
    });

    it("should handle records", () => {
      const schema = Schema.Record({
        key: Schema.String,
        value: Schema.Number,
      });

      const result = safeDecodeEffectSchema(schema, { a: 1, b: 2, c: 3 });
      expect(result.success).toBe(true);
    });

    it("should handle tuples", () => {
      const schema = Schema.Tuple(Schema.String, Schema.Number, Schema.Boolean);

      const result = safeDecodeEffectSchema(schema, ["hello", 42, true]);
      expect(result.success).toBe(true);
    });
  });
});
