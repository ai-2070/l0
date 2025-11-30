// Zod v3/v4 Compatibility Layer
//
// L0 supports both Zod v3 and Zod v4. This module provides type-safe
// abstractions that work with both versions.
//
// Key differences between v3 and v4:
// - v4 has `z.core` namespace for core types
// - v4 ZodError has slightly different structure
// - v4 adds new methods but maintains backward compatibility for common APIs
//
// L0 uses Zod only for:
// 1. Type inference (z.infer<T>)
// 2. Schema validation (schema.parse/safeParse)
// 3. ZodError handling
//
// All of these APIs are compatible between v3 and v4.

import type { z } from "zod";

/**
 * Type alias for any Zod schema type.
 * Works with both Zod v3 and v4.
 */
export type AnyZodSchema = z.ZodTypeAny;

/**
 * Type alias for Zod object schema.
 * Works with both Zod v3 and v4.
 */
export type ZodObjectSchema<T extends z.ZodRawShape = z.ZodRawShape> =
  z.ZodObject<T>;

/**
 * Type alias for Zod array schema.
 * Works with both Zod v3 and v4.
 */
export type ZodArraySchema<T extends z.ZodTypeAny = z.ZodTypeAny> = z.ZodArray<T>;

/**
 * Type alias for Zod error.
 * Works with both Zod v3 and v4.
 */
export type ZodValidationError = z.ZodError;

/**
 * Infer the output type from a Zod schema.
 * Works with both Zod v3 and v4.
 */
export type InferSchema<T extends z.ZodTypeAny> = z.infer<T>;

/**
 * Check if a value is a Zod schema.
 * Works with both Zod v3 and v4.
 */
export function isZodSchema(value: unknown): value is z.ZodTypeAny {
  if (!value || typeof value !== "object") return false;

  // Check for v3/v4 common properties
  const schema = value as Record<string, unknown>;
  return (
    typeof schema.parse === "function" &&
    typeof schema.safeParse === "function" &&
    "_def" in schema
  );
}

/**
 * Check if an error is a ZodError.
 * Works with both Zod v3 and v4.
 */
export function isZodError(error: unknown): error is z.ZodError {
  if (!error || typeof error !== "object") return false;

  const err = error as Record<string, unknown>;
  return (
    err.name === "ZodError" &&
    Array.isArray(err.issues) &&
    typeof err.format === "function"
  );
}

/**
 * Safely parse data with a Zod schema.
 * Returns a normalized result that works with both v3 and v4.
 */
export function safeParse<T extends z.ZodTypeAny>(
  schema: T,
  data: unknown,
): { success: true; data: z.infer<T> } | { success: false; error: z.ZodError } {
  const result = schema.safeParse(data);
  return result;
}

/**
 * Get formatted error messages from a ZodError.
 * Works with both Zod v3 and v4.
 */
export function getZodErrorMessages(error: z.ZodError): string[] {
  return error.issues.map((issue) => {
    const path = issue.path.length > 0 ? `${issue.path.join(".")}: ` : "";
    return `${path}${issue.message}`;
  });
}

/**
 * Get a flattened error object from a ZodError.
 * Works with both Zod v3 and v4.
 */
export function flattenZodError(error: z.ZodError): {
  formErrors: string[];
  fieldErrors: Record<string, string[]>;
} {
  const flat = error.flatten();
  return {
    formErrors: flat.formErrors,
    fieldErrors: flat.fieldErrors as Record<string, string[]>,
  };
}
