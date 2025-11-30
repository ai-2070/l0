// JSON Schema Compatibility Tests

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  isJSONSchema,
  registerJSONSchemaAdapter,
  unregisterJSONSchemaAdapter,
  hasJSONSchemaAdapter,
  getJSONSchemaAdapter,
  validateJSONSchema,
  wrapJSONSchema,
  createSimpleJSONSchemaAdapter,
  type JSONSchemaDefinition,
} from "../src/utils/jsonSchemaCompat";

describe("JSON Schema Compatibility Layer", () => {
  beforeEach(() => {
    registerJSONSchemaAdapter(createSimpleJSONSchemaAdapter());
  });

  afterEach(() => {
    unregisterJSONSchemaAdapter();
  });

  describe("isJSONSchema", () => {
    it("should detect schemas with type property", () => {
      expect(isJSONSchema({ type: "object" })).toBe(true);
      expect(isJSONSchema({ type: "string" })).toBe(true);
      expect(isJSONSchema({ type: "number" })).toBe(true);
      expect(isJSONSchema({ type: "array" })).toBe(true);
    });

    it("should detect schemas with properties", () => {
      expect(
        isJSONSchema({
          properties: { name: { type: "string" } },
        }),
      ).toBe(true);
    });

    it("should detect schemas with $schema", () => {
      expect(
        isJSONSchema({
          $schema: "https://json-schema.org/draft/2020-12/schema",
        }),
      ).toBe(true);
    });

    it("should detect schemas with $ref", () => {
      expect(isJSONSchema({ $ref: "#/definitions/User" })).toBe(true);
    });

    it("should detect schemas with composition keywords", () => {
      expect(isJSONSchema({ allOf: [{ type: "string" }] })).toBe(true);
      expect(isJSONSchema({ anyOf: [{ type: "string" }] })).toBe(true);
      expect(isJSONSchema({ oneOf: [{ type: "string" }] })).toBe(true);
    });

    it("should return false for non-schema values", () => {
      expect(isJSONSchema(null)).toBe(false);
      expect(isJSONSchema(undefined)).toBe(false);
      expect(isJSONSchema({})).toBe(false);
      expect(isJSONSchema({ name: "test" })).toBe(false);
      expect(isJSONSchema("string")).toBe(false);
      expect(isJSONSchema(123)).toBe(false);
    });
  });

  describe("Adapter registration", () => {
    it("should register adapter", () => {
      expect(hasJSONSchemaAdapter()).toBe(true);
    });

    it("should unregister adapter", () => {
      unregisterJSONSchemaAdapter();
      expect(hasJSONSchemaAdapter()).toBe(false);
    });

    it("should throw when getting unregistered adapter", () => {
      unregisterJSONSchemaAdapter();
      expect(() => getJSONSchemaAdapter()).toThrow(
        /JSON Schema adapter not registered/,
      );
    });

    it("should return registered adapter", () => {
      const adapter = getJSONSchemaAdapter();
      expect(adapter).toBeDefined();
      expect(typeof adapter.validate).toBe("function");
      expect(typeof adapter.formatErrors).toBe("function");
    });
  });

  describe("validateJSONSchema", () => {
    it("should validate simple string schema", () => {
      const schema: JSONSchemaDefinition = { type: "string" };
      const result = validateJSONSchema(schema, "hello");
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toBe("hello");
      }
    });

    it("should reject invalid type", () => {
      const schema: JSONSchemaDefinition = { type: "string" };
      const result = validateJSONSchema(schema, 123);
      expect(result.success).toBe(false);
    });

    it("should validate object with properties", () => {
      const schema: JSONSchemaDefinition = {
        type: "object",
        properties: {
          name: { type: "string" },
          age: { type: "number" },
        },
        required: ["name", "age"],
      };

      const result = validateJSONSchema(schema, { name: "Alice", age: 30 });
      expect(result.success).toBe(true);
    });

    it("should reject missing required properties", () => {
      const schema: JSONSchemaDefinition = {
        type: "object",
        properties: {
          name: { type: "string" },
          age: { type: "number" },
        },
        required: ["name", "age"],
      };

      const result = validateJSONSchema(schema, { name: "Alice" });
      expect(result.success).toBe(false);
    });

    it("should validate arrays", () => {
      const schema: JSONSchemaDefinition = {
        type: "array",
        items: { type: "string" },
      };

      const result = validateJSONSchema(schema, ["a", "b", "c"]);
      expect(result.success).toBe(true);
    });

    it("should reject invalid array items", () => {
      const schema: JSONSchemaDefinition = {
        type: "array",
        items: { type: "string" },
      };

      const result = validateJSONSchema(schema, ["a", 123, "c"]);
      expect(result.success).toBe(false);
    });

    it("should validate enum values", () => {
      const schema: JSONSchemaDefinition = {
        type: "string",
        enum: ["red", "green", "blue"],
      };

      expect(validateJSONSchema(schema, "red").success).toBe(true);
      expect(validateJSONSchema(schema, "yellow").success).toBe(false);
    });

    it("should validate const values", () => {
      const schema: JSONSchemaDefinition = {
        const: "fixed",
      };

      expect(validateJSONSchema(schema, "fixed").success).toBe(true);
      expect(validateJSONSchema(schema, "other").success).toBe(false);
    });
  });

  describe("String validation", () => {
    it("should validate minLength", () => {
      const schema: JSONSchemaDefinition = {
        type: "string",
        minLength: 3,
      };

      expect(validateJSONSchema(schema, "abc").success).toBe(true);
      expect(validateJSONSchema(schema, "ab").success).toBe(false);
    });

    it("should validate maxLength", () => {
      const schema: JSONSchemaDefinition = {
        type: "string",
        maxLength: 5,
      };

      expect(validateJSONSchema(schema, "abc").success).toBe(true);
      expect(validateJSONSchema(schema, "abcdef").success).toBe(false);
    });

    it("should validate pattern", () => {
      const schema: JSONSchemaDefinition = {
        type: "string",
        pattern: "^[a-z]+$",
      };

      expect(validateJSONSchema(schema, "abc").success).toBe(true);
      expect(validateJSONSchema(schema, "ABC").success).toBe(false);
      expect(validateJSONSchema(schema, "abc123").success).toBe(false);
    });
  });

  describe("Number validation", () => {
    it("should validate minimum", () => {
      const schema: JSONSchemaDefinition = {
        type: "number",
        minimum: 0,
      };

      expect(validateJSONSchema(schema, 5).success).toBe(true);
      expect(validateJSONSchema(schema, 0).success).toBe(true);
      expect(validateJSONSchema(schema, -1).success).toBe(false);
    });

    it("should validate maximum", () => {
      const schema: JSONSchemaDefinition = {
        type: "number",
        maximum: 100,
      };

      expect(validateJSONSchema(schema, 50).success).toBe(true);
      expect(validateJSONSchema(schema, 100).success).toBe(true);
      expect(validateJSONSchema(schema, 101).success).toBe(false);
    });

    it("should validate range", () => {
      const schema: JSONSchemaDefinition = {
        type: "number",
        minimum: 0,
        maximum: 100,
      };

      expect(validateJSONSchema(schema, 50).success).toBe(true);
      expect(validateJSONSchema(schema, -1).success).toBe(false);
      expect(validateJSONSchema(schema, 101).success).toBe(false);
    });
  });

  describe("wrapJSONSchema", () => {
    it("should create unified schema wrapper", () => {
      const schema: JSONSchemaDefinition = {
        type: "object",
        properties: { name: { type: "string" } },
        required: ["name"],
      };
      const wrapped = wrapJSONSchema(schema);

      expect(wrapped._tag).toBe("jsonschema");
      expect(typeof wrapped.parse).toBe("function");
      expect(typeof wrapped.safeParse).toBe("function");
    });

    it("should parse valid data", () => {
      const schema: JSONSchemaDefinition = {
        type: "object",
        properties: { name: { type: "string" } },
        required: ["name"],
      };
      const wrapped = wrapJSONSchema<{ name: string }>(schema);

      const result = wrapped.parse({ name: "Alice" });
      expect(result).toEqual({ name: "Alice" });
    });

    it("should throw on invalid data with parse", () => {
      const schema: JSONSchemaDefinition = {
        type: "object",
        properties: { name: { type: "string" } },
        required: ["name"],
      };
      const wrapped = wrapJSONSchema(schema);

      expect(() => wrapped.parse({ name: 123 })).toThrow();
    });

    it("should return success with safeParse for valid data", () => {
      const schema: JSONSchemaDefinition = {
        type: "object",
        properties: { name: { type: "string" } },
        required: ["name"],
      };
      const wrapped = wrapJSONSchema<{ name: string }>(schema);

      const result = wrapped.safeParse({ name: "Alice" });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual({ name: "Alice" });
      }
    });

    it("should return error with safeParse for invalid data", () => {
      const schema: JSONSchemaDefinition = {
        type: "object",
        properties: { name: { type: "string" } },
        required: ["name"],
      };
      const wrapped = wrapJSONSchema(schema);

      const result = wrapped.safeParse({ name: 123 });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toBeInstanceOf(Error);
      }
    });
  });

  describe("Complex schemas", () => {
    it("should validate nested objects", () => {
      const schema: JSONSchemaDefinition = {
        type: "object",
        properties: {
          user: {
            type: "object",
            properties: {
              name: { type: "string" },
              email: { type: "string" },
            },
            required: ["name", "email"],
          },
        },
        required: ["user"],
      };

      const validData = {
        user: {
          name: "Alice",
          email: "alice@example.com",
        },
      };

      expect(validateJSONSchema(schema, validData).success).toBe(true);
    });

    it("should validate array of objects", () => {
      const schema: JSONSchemaDefinition = {
        type: "array",
        items: {
          type: "object",
          properties: {
            id: { type: "number" },
            name: { type: "string" },
          },
          required: ["id", "name"],
        },
      };

      const validData = [
        { id: 1, name: "Alice" },
        { id: 2, name: "Bob" },
      ];

      expect(validateJSONSchema(schema, validData).success).toBe(true);
    });

    it("should validate multiple types", () => {
      const schema: JSONSchemaDefinition = {
        type: ["string", "number"],
      };

      expect(validateJSONSchema(schema, "test").success).toBe(true);
      expect(validateJSONSchema(schema, 123).success).toBe(true);
      expect(validateJSONSchema(schema, true).success).toBe(false);
    });
  });

  describe("Error formatting", () => {
    it("should format single error", () => {
      const schema: JSONSchemaDefinition = {
        type: "string",
      };

      const result = validateJSONSchema(schema, 123);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.message).toContain("Expected string");
      }
    });

    it("should format multiple errors", () => {
      const schema: JSONSchemaDefinition = {
        type: "object",
        properties: {
          name: { type: "string" },
          age: { type: "number" },
        },
        required: ["name", "age"],
      };

      const result = validateJSONSchema(schema, {});
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.message).toContain("name");
        expect(result.error.message).toContain("age");
      }
    });
  });

  describe("createSimpleJSONSchemaAdapter", () => {
    it("should create working adapter", () => {
      const adapter = createSimpleJSONSchemaAdapter();

      expect(typeof adapter.validate).toBe("function");
      expect(typeof adapter.formatErrors).toBe("function");
    });

    it("should validate with created adapter", () => {
      const adapter = createSimpleJSONSchemaAdapter();
      const schema: JSONSchemaDefinition = { type: "string" };

      const result = adapter.validate(schema, "hello");
      expect(result.valid).toBe(true);
    });

    it("should format errors with created adapter", () => {
      const adapter = createSimpleJSONSchemaAdapter();
      const errors = [
        { path: "/name", message: "Required" },
        { path: "/age", message: "Must be number" },
      ];

      const formatted = adapter.formatErrors(errors);
      expect(formatted).toContain("/name");
      expect(formatted).toContain("/age");
    });
  });
});
