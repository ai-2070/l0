// Zero output detection guardrail for L0

import type {
  GuardrailRule,
  GuardrailContext,
  GuardrailViolation,
} from "../types/guardrails";
import { hasMeaningfulContent } from "../utils/tokens";

// Pre-compiled regex patterns for performance
const PUNCTUATION_ONLY = /^[^\w\s]+$/;
const REPEATED_CHARS = /^(.)\1+$/;
const ALPHANUMERIC = /[a-zA-Z0-9]/;

/**
 * Check if content is empty or only whitespace
 * @param content - Content to check
 * @returns True if content is effectively empty
 */
export function isZeroOutput(content: string): boolean {
  if (!content || content.length === 0) {
    return true;
  }

  // Check if only whitespace
  return !hasMeaningfulContent(content);
}

/**
 * Check if content is only noise/filler
 * @param content - Content to check
 * @returns True if content is only noise
 */
export function isNoiseOnly(content: string): boolean {
  if (!content || content.length === 0) {
    return true;
  }

  const trimmed = content.trim();

  // Check for only punctuation
  if (PUNCTUATION_ONLY.test(trimmed)) {
    return true;
  }

  // Check for only repeated characters
  if (REPEATED_CHARS.test(trimmed)) {
    return true;
  }

  // Check for very short meaningless content
  if (trimmed.length < 3 && !ALPHANUMERIC.test(trimmed)) {
    return true;
  }

  return false;
}

/**
 * Validate that output contains meaningful content
 * @param context - Guardrail context
 * @returns Array of violations
 */
export function validateZeroOutput(
  context: GuardrailContext,
): GuardrailViolation[] {
  const { content, completed, tokenCount } = context;
  const violations: GuardrailViolation[] = [];

  // Only check if we have some indication of completion
  // or if we have tokens but no meaningful content
  if (!completed && tokenCount < 5) {
    return violations;
  }

  // Check for zero output
  if (isZeroOutput(content)) {
    violations.push({
      rule: "zero-output",
      message: "No meaningful output generated (empty or whitespace only)",
      severity: "error",
      recoverable: false, // This is a transport/network issue
      suggestion: "Retry - likely network or model initialization issue",
    });
    return violations;
  }

  // Check for noise only
  if (isNoiseOnly(content)) {
    violations.push({
      rule: "zero-output",
      message: "Output contains only noise or filler characters",
      severity: "error",
      recoverable: false,
      suggestion: "Retry - output is not meaningful",
    });
    return violations;
  }

  // Check if stream finished instantly with very little content
  if (completed && content.trim().length < 10) {
    violations.push({
      rule: "zero-output",
      message: `Output too short: ${content.trim().length} characters`,
      severity: "warning",
      recoverable: false,
      suggestion: "Retry - output may be truncated",
    });
  }

  return violations;
}

/**
 * Check if output was instantaneous (possible error indicator)
 * @param context - Guardrail context
 * @returns Array of violations
 */
export function validateInstantOutput(
  context: GuardrailContext,
): GuardrailViolation[] {
  const { completed, tokenCount, metadata } = context;
  const violations: GuardrailViolation[] = [];

  // Only check if complete
  if (!completed) {
    return violations;
  }

  // Check metadata for timing if available
  const startTime = metadata?.startTime;
  const endTime = metadata?.endTime;

  if (startTime && endTime) {
    const duration = endTime - startTime;

    // If completed in less than 100ms with few tokens, suspicious
    if (duration < 100 && tokenCount < 5) {
      violations.push({
        rule: "zero-output",
        message: `Stream completed instantly (${duration}ms) with minimal output`,
        severity: "error",
        recoverable: false,
        suggestion: "Retry - possible network or transport failure",
      });
    }
  }

  return violations;
}

/**
 * Create zero output detection guardrail rule
 */
export function zeroOutputRule(): GuardrailRule {
  return {
    name: "zero-output",
    description: "Detects zero or meaningless output",
    streaming: true,
    severity: "error",
    recoverable: false, // Zero output is a transport issue, not model issue
    check: (context: GuardrailContext) => {
      const violations: GuardrailViolation[] = [];

      // Check for zero output
      violations.push(...validateZeroOutput(context));

      // Check for instant completion
      violations.push(...validateInstantOutput(context));

      return violations;
    },
  };
}

/**
 * Zero output guardrail class for compatibility
 */
export class ZeroOutputGuardrail {
  private rule: GuardrailRule;

  constructor() {
    this.rule = zeroOutputRule();
  }

  check(context: GuardrailContext): GuardrailViolation[] {
    return this.rule.check(context);
  }

  get name(): string {
    return this.rule.name;
  }
}
