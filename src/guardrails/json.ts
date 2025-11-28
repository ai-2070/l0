// JSON structure and balance rules for L0

import type {
  GuardrailRule,
  GuardrailContext,
  GuardrailViolation,
  JsonStructure,
} from "../types/guardrails";

/**
 * Analyze JSON structure in content
 * @param content - Content to analyze
 * @returns JSON structure analysis
 */
export function analyzeJsonStructure(content: string): JsonStructure {
  let openBraces = 0;
  let closeBraces = 0;
  let openBrackets = 0;
  let closeBrackets = 0;
  let inString = false;
  let escapeNext = false;
  const issues: string[] = [];

  for (let i = 0; i < content.length; i++) {
    const char = content[i];

    if (escapeNext) {
      escapeNext = false;
      continue;
    }

    if (char === "\\") {
      escapeNext = true;
      continue;
    }

    if (char === '"') {
      inString = !inString;
      continue;
    }

    if (!inString) {
      if (char === "{") openBraces++;
      if (char === "}") closeBraces++;
      if (char === "[") openBrackets++;
      if (char === "]") closeBrackets++;
    }
  }

  // Check for unclosed string
  if (inString) {
    issues.push("Unclosed string detected");
  }

  // Check for imbalanced braces
  if (openBraces !== closeBraces) {
    issues.push(`Unbalanced braces: ${openBraces} open, ${closeBraces} close`);
  }

  // Check for imbalanced brackets
  if (openBrackets !== closeBrackets) {
    issues.push(
      `Unbalanced brackets: ${openBrackets} open, ${closeBrackets} close`,
    );
  }

  const isBalanced =
    openBraces === closeBraces && openBrackets === closeBrackets && !inString;

  return {
    openBraces,
    closeBraces,
    openBrackets,
    closeBrackets,
    inString,
    isBalanced,
    issues,
  };
}

/**
 * Check if content looks like JSON (starts with { or [)
 * @param content - Content to check
 * @returns True if content appears to be JSON
 */
export function looksLikeJson(content: string): boolean {
  if (!content) return false;

  const trimmed = content.trim();
  return trimmed.startsWith("{") || trimmed.startsWith("[");
}

/**
 * Validate JSON structure - checks for balanced braces, brackets, and quotes
 * @param context - Guardrail context
 * @returns Array of violations
 */
export function validateJsonStructure(
  context: GuardrailContext,
): GuardrailViolation[] {
  const { content, isComplete } = context;
  const violations: GuardrailViolation[] = [];

  // Only check if content looks like JSON
  if (!looksLikeJson(content)) {
    return violations;
  }

  const structure = analyzeJsonStructure(content);

  // If streaming and not complete, only flag severe issues
  if (!isComplete) {
    // Check for premature closing (more closes than opens)
    if (structure.closeBraces > structure.openBraces) {
      violations.push({
        rule: "json-structure",
        message: `Too many closing braces: ${structure.closeBraces} close, ${structure.openBraces} open`,
        severity: "error",
        recoverable: true,
      });
    }

    if (structure.closeBrackets > structure.openBrackets) {
      violations.push({
        rule: "json-structure",
        message: `Too many closing brackets: ${structure.closeBrackets} close, ${structure.openBrackets} open`,
        severity: "error",
        recoverable: true,
      });
    }
  } else {
    // Stream is complete, check for full balance
    if (!structure.isBalanced) {
      for (const issue of structure.issues) {
        violations.push({
          rule: "json-structure",
          message: issue,
          severity: "error",
          recoverable: true,
          suggestion: "Retry generation to get properly balanced JSON",
        });
      }
    }
  }

  return violations;
}

/**
 * Check for malformed JSON chunks during streaming
 * @param context - Guardrail context
 * @returns Array of violations
 */
export function validateJsonChunks(
  context: GuardrailContext,
): GuardrailViolation[] {
  const { content, delta } = context;
  const violations: GuardrailViolation[] = [];

  if (!delta || !looksLikeJson(content)) {
    return violations;
  }

  // Check for common malformed patterns in the delta
  const malformedPatterns = [
    { pattern: /,,+/, message: "Multiple consecutive commas" },
    { pattern: /\{\s*,/, message: "Comma immediately after opening brace" },
    { pattern: /\[\s*,/, message: "Comma immediately after opening bracket" },
    { pattern: /:\s*,/, message: "Comma immediately after colon" },
  ];

  for (const { pattern, message } of malformedPatterns) {
    if (pattern.test(content)) {
      violations.push({
        rule: "json-chunks",
        message: `Malformed JSON: ${message}`,
        severity: "error",
        recoverable: true,
      });
    }
  }

  return violations;
}

/**
 * Attempt to parse JSON and report issues
 * @param context - Guardrail context
 * @returns Array of violations
 */
export function validateJsonParseable(
  context: GuardrailContext,
): GuardrailViolation[] {
  const { content, isComplete } = context;
  const violations: GuardrailViolation[] = [];

  // Only validate if complete and looks like JSON
  if (!isComplete || !looksLikeJson(content)) {
    return violations;
  }

  try {
    JSON.parse(content.trim());
  } catch (error) {
    violations.push({
      rule: "json-parseable",
      message: `JSON is not parseable: ${error instanceof Error ? error.message : "Unknown error"}`,
      severity: "error",
      recoverable: true,
      suggestion: "Retry generation to get valid JSON",
    });
  }

  return violations;
}

/**
 * Create JSON structure guardrail rule
 * Checks for balanced braces, brackets, proper structure
 */
export function jsonRule(): GuardrailRule {
  return {
    name: "json-structure",
    description: "Validates JSON structure and balance",
    streaming: true,
    severity: "error",
    recoverable: true,
    check: (context: GuardrailContext) => {
      const violations: GuardrailViolation[] = [];

      // Check structure
      violations.push(...validateJsonStructure(context));

      // Check for malformed chunks
      violations.push(...validateJsonChunks(context));

      // If complete, check parseability
      if (context.isComplete) {
        violations.push(...validateJsonParseable(context));
      }

      return violations;
    },
  };
}

/**
 * Create strict JSON guardrail that also validates content structure
 */
export function strictJsonRule(): GuardrailRule {
  return {
    name: "json-strict",
    description: "Strict JSON validation including structure and parseability",
    streaming: false,
    severity: "error",
    recoverable: true,
    check: (context: GuardrailContext) => {
      const violations: GuardrailViolation[] = [];

      // Only run on complete output
      if (!context.isComplete) {
        return violations;
      }

      const { content } = context;

      // Must look like JSON
      if (!looksLikeJson(content)) {
        violations.push({
          rule: "json-strict",
          message:
            "Content does not appear to be JSON (must start with { or [)",
          severity: "error",
          recoverable: true,
        });
        return violations;
      }

      // Must be parseable
      violations.push(...validateJsonParseable(context));

      // If parseable, validate it's an object or array at root
      if (violations.length === 0) {
        try {
          const parsed = JSON.parse(content.trim());
          if (typeof parsed !== "object" || parsed === null) {
            violations.push({
              rule: "json-strict",
              message: "JSON root must be an object or array",
              severity: "error",
              recoverable: true,
            });
          }
        } catch {
          // Already caught by validateJsonParseable
        }
      }

      return violations;
    },
  };
}

/**
 * JSON guardrail class for compatibility
 */
export class JsonGuardrail {
  private rule: GuardrailRule;

  constructor(strict: boolean = false) {
    this.rule = strict ? strictJsonRule() : jsonRule();
  }

  check(context: GuardrailContext): GuardrailViolation[] {
    return this.rule.check(context);
  }

  get name(): string {
    return this.rule.name;
  }
}
