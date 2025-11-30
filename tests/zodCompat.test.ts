// Zod v3/v4 Compatibility Tests

import { describe, it, expect } from "vitest";
import { z } from "zod";
import {
  isZodSchema,
  isZodError,
  safeParse,
  getZodErrorMessages,
  flattenZodError,
} from "../src/utils/zodCompat";

describe("Zod Compatibility Layer", () => {
  describe("isZodSchema", () => {
    it("should detect Zod object schemas", () => {
      const schema = z.object({ name: z.string() });
      expect(isZodSchema(schema)).toBe(true);
    });

    it("should detect Zod string schemas", () => {
      expect(isZodSchema(z.string())).toBe(true);
    });

    it("should detect Zod number schemas", () => {
      expect(isZodSchema(z.number())).toBe(true);
    });

    it("should detect Zod array schemas", () => {
      expect(isZodSchema(z.array(z.string()))).toBe(true);
    });

    it("should detect Zod union schemas", () => {
      expect(isZodSchema(z.union([z.string(), z.number()]))).toBe(true);
    });

    it("should detect Zod enum schemas", () => {
      expect(isZodSchema(z.enum(["a", "b", "c"]))).toBe(true);
    });

    it("should return false for non-Zod values", () => {
      expect(isZodSchema(null)).toBe(false);
      expect(isZodSchema(undefined)).toBe(false);
      expect(isZodSchema({})).toBe(false);
      expect(isZodSchema({ parse: () => {} })).toBe(false);
      expect(isZodSchema("string")).toBe(false);
      expect(isZodSchema(123)).toBe(false);
    });
  });

  describe("isZodError", () => {
    it("should detect ZodError from failed parse", () => {
      const schema = z.object({ name: z.string() });
      try {
        schema.parse({ name: 123 });
      } catch (error) {
        expect(isZodError(error)).toBe(true);
      }
    });

    it("should detect ZodError from safeParse", () => {
      const schema = z.string();
      const result = schema.safeParse(123);
      if (!result.success) {
        expect(isZodError(result.error)).toBe(true);
      }
    });

    it("should return false for non-ZodError", () => {
      expect(isZodError(null)).toBe(false);
      expect(isZodError(undefined)).toBe(false);
      expect(isZodError(new Error("test"))).toBe(false);
      expect(isZodError({ name: "ZodError" })).toBe(false);
    });
  });

  describe("safeParse", () => {
    it("should return success for valid data", () => {
      const schema = z.object({ name: z.string(), age: z.number() });
      const result = safeParse(schema, { name: "Alice", age: 30 });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual({ name: "Alice", age: 30 });
      }
    });

    it("should return error for invalid data", () => {
      const schema = z.object({ name: z.string() });
      const result = safeParse(schema, { name: 123 });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(isZodError(result.error)).toBe(true);
      }
    });

    it("should handle complex nested schemas", () => {
      const schema = z.object({
        user: z.object({
          name: z.string(),
          emails: z.array(z.string().email()),
        }),
        settings: z.record(z.boolean()),
      });

      const validData = {
        user: {
          name: "Alice",
          emails: ["alice@example.com"],
        },
        settings: { darkMode: true },
      };

      const result = safeParse(schema, validData);
      expect(result.success).toBe(true);
    });
  });

  describe("getZodErrorMessages", () => {
    it("should extract error messages from ZodError", () => {
      const schema = z.object({
        name: z.string(),
        age: z.number(),
      });
      const result = schema.safeParse({ name: 123, age: "invalid" });

      if (!result.success) {
        const messages = getZodErrorMessages(result.error);
        expect(messages.length).toBe(2);
        expect(messages.some((m) => m.includes("name"))).toBe(true);
        expect(messages.some((m) => m.includes("age"))).toBe(true);
      }
    });

    it("should handle root-level errors", () => {
      const schema = z.string();
      const result = schema.safeParse(123);

      if (!result.success) {
        const messages = getZodErrorMessages(result.error);
        expect(messages.length).toBeGreaterThan(0);
      }
    });
  });

  describe("flattenZodError", () => {
    it("should flatten nested errors", () => {
      const schema = z.object({
        name: z.string(),
        email: z.string().email(),
      });
      const result = schema.safeParse({ name: 123, email: "invalid" });

      if (!result.success) {
        const flat = flattenZodError(result.error);
        expect(flat.fieldErrors.name).toBeDefined();
        expect(flat.fieldErrors.email).toBeDefined();
      }
    });

    it("should capture form-level errors", () => {
      const schema = z
        .object({
          password: z.string(),
          confirm: z.string(),
        })
        .refine((data) => data.password === data.confirm, {
          message: "Passwords must match",
        });

      const result = schema.safeParse({
        password: "abc",
        confirm: "xyz",
      });

      if (!result.success) {
        const flat = flattenZodError(result.error);
        expect(flat.formErrors.length).toBeGreaterThan(0);
      }
    });
  });

  describe("Type inference compatibility", () => {
    it("should correctly infer object types", () => {
      const schema = z.object({
        id: z.number(),
        name: z.string(),
        active: z.boolean(),
      });

      type Inferred = z.infer<typeof schema>;

      // Type test - this compiles if types are correct
      const data: Inferred = { id: 1, name: "test", active: true };
      expect(data.id).toBe(1);
      expect(data.name).toBe("test");
      expect(data.active).toBe(true);
    });

    it("should correctly infer array types", () => {
      const schema = z.array(z.string());
      type Inferred = z.infer<typeof schema>;

      const data: Inferred = ["a", "b", "c"];
      expect(data).toEqual(["a", "b", "c"]);
    });

    it("should correctly infer union types", () => {
      const schema = z.union([z.string(), z.number()]);
      type Inferred = z.infer<typeof schema>;

      const strData: Inferred = "test";
      const numData: Inferred = 42;

      expect(strData).toBe("test");
      expect(numData).toBe(42);
    });

    it("should correctly infer optional types", () => {
      const schema = z.object({
        required: z.string(),
        optional: z.string().optional(),
      });
      type Inferred = z.infer<typeof schema>;

      const data: Inferred = { required: "test" };
      expect(data.required).toBe("test");
      expect(data.optional).toBeUndefined();
    });
  });
});
