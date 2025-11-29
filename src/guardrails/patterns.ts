// Pattern-based guardrail for detecting known bad outputs in L0

import type {
  GuardrailRule,
  GuardrailContext,
  GuardrailViolation,
  PatternConfig,
} from "../types/guardrails";

/**
 * Known bad patterns that indicate model issues
 */
export const BAD_PATTERNS = {
  // Meta commentary patterns
  META_COMMENTARY: [
    /as an ai language model/i,
    /as an ai assistant/i,
    /i'm an ai/i,
    /i am an ai/i,
    /i don't have personal/i,
    /i cannot actually/i,
    /i apologize, but i/i,
    /i'm sorry, but i/i,
  ],

  // Hedging patterns (excessive)
  EXCESSIVE_HEDGING: [
    /^sure!?\s*$/im,
    /^certainly!?\s*$/im,
    /^of course!?\s*$/im,
    /^absolutely!?\s*$/im,
  ],

  // Refusal patterns
  REFUSAL: [
    /i cannot provide/i,
    /i'm not able to/i,
    /i can't assist with/i,
    /i'm unable to/i,
    /that would be inappropriate/i,
  ],

  // Instruction leakage
  INSTRUCTION_LEAK: [
    /\[system\]/i,
    /\[user\]/i,
    /\[assistant\]/i,
    /<\|im_start\|>/i,
    /<\|im_end\|>/i,
    /###\s*instruction/i,
    /###\s*system/i,
  ],

  // Placeholder patterns
  PLACEHOLDERS: [
    /\[insert .+?\]/i,
    /\[todo:?\]/i,
    /\[placeholder\]/i,
    /\[your .+? here\]/i,
    /\{\{.+?\}\}/,
  ],

  // Format collapse (mixing instruction with output)
  FORMAT_COLLAPSE: [
    /here is the .+?:/i,
    /here's the .+?:/i,
    /let me .+? for you/i,
    /i'll .+? for you/i,
  ],
};

/**
 * Check content for known bad patterns
 * @param content - Content to check
 * @param patterns - Array of regex patterns
 * @returns Matches found
 */
export function findBadPatterns(
  content: string,
  patterns: RegExp[],
): Array<{ pattern: RegExp; match: string; index: number }> {
  const matches: Array<{ pattern: RegExp; match: string; index: number }> = [];

  for (const pattern of patterns) {
    const match = content.match(pattern);
    if (match) {
      matches.push({
        pattern,
        match: match[0],
        index: match.index ?? 0,
      });
    }
  }

  return matches;
}

/**
 * Detect meta commentary in output
 * @param context - Guardrail context
 * @returns Array of violations
 */
export function detectMetaCommentary(
  context: GuardrailContext,
): GuardrailViolation[] {
  const { content } = context;
  const violations: GuardrailViolation[] = [];

  const matches = findBadPatterns(content, BAD_PATTERNS.META_COMMENTARY);

  for (const match of matches) {
    violations.push({
      rule: "pattern-meta-commentary",
      message: `Meta commentary detected: "${match.match}"`,
      severity: "error",
      position: match.index,
      recoverable: true,
      suggestion: "Retry generation without meta commentary",
    });
  }

  return violations;
}

/**
 * Detect excessive hedging
 * @param context - Guardrail context
 * @returns Array of violations
 */
export function detectExcessiveHedging(
  context: GuardrailContext,
): GuardrailViolation[] {
  const { content } = context;
  const violations: GuardrailViolation[] = [];

  // Check if content starts with hedging
  const firstLine = content.trim().split("\n")[0] ?? "";
  const matches = findBadPatterns(firstLine, BAD_PATTERNS.EXCESSIVE_HEDGING);

  if (matches.length > 0 && matches[0]) {
    violations.push({
      rule: "pattern-hedging",
      message: `Excessive hedging at start: "${matches[0].match}"`,
      severity: "warning",
      position: matches[0].index,
      recoverable: true,
      suggestion: "Content should start directly without hedging",
    });
  }

  return violations;
}

/**
 * Detect refusal patterns
 * @param context - Guardrail context
 * @returns Array of violations
 */
export function detectRefusal(context: GuardrailContext): GuardrailViolation[] {
  const { content } = context;
  const violations: GuardrailViolation[] = [];

  const matches = findBadPatterns(content, BAD_PATTERNS.REFUSAL);

  for (const match of matches) {
    violations.push({
      rule: "pattern-refusal",
      message: `Refusal pattern detected: "${match.match}"`,
      severity: "error",
      position: match.index,
      recoverable: false,
      suggestion: "Model refused to complete the task",
    });
  }

  return violations;
}

/**
 * Detect instruction leakage
 * @param context - Guardrail context
 * @returns Array of violations
 */
export function detectInstructionLeakage(
  context: GuardrailContext,
): GuardrailViolation[] {
  const { content } = context;
  const violations: GuardrailViolation[] = [];

  const matches = findBadPatterns(content, BAD_PATTERNS.INSTRUCTION_LEAK);

  for (const match of matches) {
    violations.push({
      rule: "pattern-instruction-leak",
      message: `Instruction leakage detected: "${match.match}"`,
      severity: "error",
      position: match.index,
      recoverable: true,
      suggestion: "Retry generation without system tokens",
    });
  }

  return violations;
}

/**
 * Detect placeholder patterns
 * @param context - Guardrail context
 * @returns Array of violations
 */
export function detectPlaceholders(
  context: GuardrailContext,
): GuardrailViolation[] {
  const { content, completed } = context;
  const violations: GuardrailViolation[] = [];

  // Only check complete output
  if (!completed) {
    return violations;
  }

  const matches = findBadPatterns(content, BAD_PATTERNS.PLACEHOLDERS);

  for (const match of matches) {
    violations.push({
      rule: "pattern-placeholders",
      message: `Placeholder detected: "${match.match}"`,
      severity: "error",
      position: match.index,
      recoverable: true,
      suggestion: "Output contains incomplete placeholders",
    });
  }

  return violations;
}

/**
 * Detect format collapse (mixing instructions with output)
 * @param context - Guardrail context
 * @returns Array of violations
 */
export function detectFormatCollapse(
  context: GuardrailContext,
): GuardrailViolation[] {
  const { content } = context;
  const violations: GuardrailViolation[] = [];

  // Only check beginning of content
  const firstLines = content.split("\n").slice(0, 3).join("\n");
  const matches = findBadPatterns(firstLines, BAD_PATTERNS.FORMAT_COLLAPSE);

  if (matches.length > 0 && matches[0]) {
    violations.push({
      rule: "pattern-format-collapse",
      message: `Format collapse detected: "${matches[0].match}"`,
      severity: "warning",
      position: matches[0].index,
      recoverable: true,
      suggestion: "Output should not mix meta-instructions with content",
    });
  }

  return violations;
}

/**
 * Detect repeated sentences or paragraphs
 * @param context - Guardrail context
 * @returns Array of violations
 */
export function detectRepetition(
  context: GuardrailContext,
  threshold: number = 2,
): GuardrailViolation[] {
  const { content, completed } = context;
  const violations: GuardrailViolation[] = [];

  // Only check complete output
  if (!completed) {
    return violations;
  }

  // Split into sentences
  const sentences = content
    .split(/[.!?]+/)
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s.length > 20); // Only check substantial sentences

  // Count occurrences
  const counts = new Map<string, number>();
  for (const sentence of sentences) {
    counts.set(sentence, (counts.get(sentence) || 0) + 1);
  }

  // Find repeated sentences
  for (const [sentence, count] of counts.entries()) {
    if (count > threshold) {
      violations.push({
        rule: "pattern-repetition",
        message: `Sentence repeated ${count} times: "${sentence.slice(0, 50)}..."`,
        severity: "error",
        recoverable: true,
        suggestion: "Content contains repeated sentences",
      });
    }
  }

  return violations;
}

/**
 * Detect duplicated first and last sentence
 * @param context - Guardrail context
 * @returns Array of violations
 */
export function detectFirstLastDuplicate(
  context: GuardrailContext,
): GuardrailViolation[] {
  const { content, completed } = context;
  const violations: GuardrailViolation[] = [];

  // Only check complete output with sufficient content
  if (!completed || content.length < 100) {
    return violations;
  }

  const sentences = content
    .split(/[.!?]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 10);

  if (sentences.length < 2) {
    return violations;
  }

  const first = sentences[0]!.toLowerCase();
  const last = sentences[sentences.length - 1]!.toLowerCase();

  if (first === last) {
    violations.push({
      rule: "pattern-first-last-duplicate",
      message: "First and last sentences are identical",
      severity: "error",
      recoverable: true,
      suggestion: "Retry generation - possible loop detected",
    });
  }

  return violations;
}

/**
 * Create pattern-based guardrail rule
 */
export function patternRule(_config?: Partial<PatternConfig>): GuardrailRule {
  return {
    name: "pattern-detection",
    description: "Detects known bad patterns in model output",
    streaming: false,
    severity: "error",
    recoverable: true,
    check: (context: GuardrailContext) => {
      const violations: GuardrailViolation[] = [];

      // Run all pattern checks
      violations.push(...detectMetaCommentary(context));
      violations.push(...detectExcessiveHedging(context));
      violations.push(...detectRefusal(context));
      violations.push(...detectInstructionLeakage(context));
      violations.push(...detectPlaceholders(context));
      violations.push(...detectFormatCollapse(context));
      violations.push(...detectRepetition(context));
      violations.push(...detectFirstLastDuplicate(context));

      return violations;
    },
  };
}

/**
 * Create custom pattern guardrail with specific patterns
 */
export function customPatternRule(
  patterns: RegExp[],
  message: string = "Custom pattern detected",
  severity: "warning" | "error" | "fatal" = "error",
): GuardrailRule {
  return {
    name: "pattern-custom",
    description: "Custom pattern matching",
    streaming: false,
    severity,
    recoverable: severity !== "fatal",
    check: (context: GuardrailContext) => {
      const violations: GuardrailViolation[] = [];
      const matches = findBadPatterns(context.content, patterns);

      for (const match of matches) {
        violations.push({
          rule: "pattern-custom",
          message: `${message}: "${match.match}"`,
          severity,
          position: match.index,
          recoverable: severity !== "fatal",
        });
      }

      return violations;
    },
  };
}

/**
 * Pattern guardrail class for compatibility
 */
export class PatternGuardrail {
  private rule: GuardrailRule;

  constructor(config?: Partial<PatternConfig>) {
    this.rule = patternRule(config);
  }

  check(context: GuardrailContext): GuardrailViolation[] {
    return this.rule.check(context);
  }

  get name(): string {
    return this.rule.name;
  }
}
