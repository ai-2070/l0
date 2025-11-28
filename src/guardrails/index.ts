// Guardrails module exports
export * from "./engine";
export * from "./types";
export * from "./json";
export * from "./markdown";
export * from "./latex";
export * from "./patterns";
export * from "./zeroOutput";

// Import rule creators for presets
import { jsonRule } from "./json";
import { markdownRule } from "./markdown";
import { latexRule } from "./latex";
import { patternRule } from "./patterns";
import { zeroOutputRule } from "./zeroOutput";
import type { GuardrailRule } from "../types/guardrails";

/**
 * Minimal guardrail preset
 * Only checks for critical issues
 */
export const minimalGuardrails: GuardrailRule[] = [
  jsonRule(),
  zeroOutputRule(),
];

/**
 * Recommended guardrail preset
 * Balanced approach for most use cases
 */
export const recommendedGuardrails: GuardrailRule[] = [
  jsonRule(),
  markdownRule(),
  zeroOutputRule(),
  patternRule(),
];

/**
 * Strict guardrail preset
 * Comprehensive checking for production systems
 */
export const strictGuardrails: GuardrailRule[] = [
  jsonRule(),
  markdownRule(),
  latexRule(),
  patternRule(),
  zeroOutputRule(),
];

/**
 * JSON-only guardrails preset
 * For JSON output requirements
 */
export const jsonOnlyGuardrails: GuardrailRule[] = [
  jsonRule(),
  zeroOutputRule(),
];

/**
 * Markdown-only guardrails preset
 * For Markdown output requirements
 */
export const markdownOnlyGuardrails: GuardrailRule[] = [
  markdownRule(),
  zeroOutputRule(),
];

/**
 * LaTeX-only guardrails preset
 * For LaTeX output requirements
 */
export const latexOnlyGuardrails: GuardrailRule[] = [
  latexRule(),
  zeroOutputRule(),
];
