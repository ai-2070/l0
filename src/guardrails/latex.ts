// LaTeX environment validation for L0

import type {
  GuardrailRule,
  GuardrailContext,
  GuardrailViolation,
  LatexStructure,
} from "../types/guardrails";

// Pre-compiled regex patterns for performance
const BEGIN_PATTERN = /\\begin\{(\w+)\}/g;
const END_PATTERN = /\\end\{(\w+)\}/g;
const DISPLAY_MATH_OPEN = /\\\[/g;
const DISPLAY_MATH_CLOSE = /\\\]/g;
const DOUBLE_DOLLAR = /\$\$/g;

// LaTeX detection patterns
const LATEX_PATTERNS = [
  /\\begin\{/,
  /\\end\{/,
  /\\\[/, // Display math
  /\\\]/, // Display math
  /\$\$/, // Display math
  /\\[a-zA-Z]+\{/, // Commands with arguments
  /\\section/,
  /\\subsection/,
  /\\textbf/,
  /\\textit/,
  /\\frac/,
  /\\sum/,
  /\\int/,
];

/**
 * Analyze LaTeX structure in content
 * @param content - Content to analyze
 * @returns LaTeX structure analysis
 */
export function analyzeLatexStructure(content: string): LatexStructure {
  const issues: string[] = [];
  const openEnvironments: string[] = [];
  const envStack: string[] = [];

  // Match \begin{env} and \end{env}
  // Reset lastIndex for global patterns
  BEGIN_PATTERN.lastIndex = 0;
  END_PATTERN.lastIndex = 0;

  // Find all begins and ends with positions
  const begins: Array<{ env: string; pos: number }> = [];
  const ends: Array<{ env: string; pos: number }> = [];

  let match;
  while ((match = BEGIN_PATTERN.exec(content)) !== null) {
    begins.push({ env: match[1]!, pos: match.index });
  }

  while ((match = END_PATTERN.exec(content)) !== null) {
    ends.push({ env: match[1]!, pos: match.index });
  }

  // Merge and sort by position
  const events = [
    ...begins.map((b) => ({ ...b, type: "begin" as const })),
    ...ends.map((e) => ({ ...e, type: "end" as const })),
  ].sort((a, b) => a.pos - b.pos);

  // Process events in order
  for (const event of events) {
    if (event.type === "begin") {
      envStack.push(event.env);
    } else {
      // end event
      if (envStack.length === 0) {
        issues.push(
          `\\end{${event.env}} without matching \\begin{${event.env}}`,
        );
      } else {
        const last = envStack[envStack.length - 1];
        if (last === event.env) {
          envStack.pop();
        } else {
          issues.push(
            `Environment mismatch: \\begin{${last}} closed with \\end{${event.env}}`,
          );
          envStack.pop();
        }
      }
    }
  }

  // Remaining items in stack are unclosed
  for (const env of envStack) {
    openEnvironments.push(env);
    issues.push(`Unclosed environment: \\begin{${env}}`);
  }

  const isBalanced = envStack.length === 0 && issues.length === 0;

  return {
    openEnvironments,
    isBalanced,
    issues,
  };
}

/**
 * Check if content contains LaTeX formatting
 * @param content - Content to check
 * @returns True if content appears to contain LaTeX
 */
export function looksLikeLatex(content: string): boolean {
  if (!content) return false;

  // Check for common LaTeX patterns
  return LATEX_PATTERNS.some((pattern) => pattern.test(content));
}

/**
 * Validate LaTeX environment balance
 * @param context - Guardrail context
 * @returns Array of violations
 */
export function validateLatexEnvironments(
  context: GuardrailContext,
): GuardrailViolation[] {
  const { content, completed } = context;
  const violations: GuardrailViolation[] = [];

  // Skip if doesn't look like LaTeX
  if (!looksLikeLatex(content)) {
    return violations;
  }

  const structure = analyzeLatexStructure(content);

  // If streaming and not complete, only warn about severe issues
  if (!completed) {
    // Check for mismatched environments (not just unclosed)
    const mismatchIssues = structure.issues.filter((issue) =>
      issue.includes("mismatch"),
    );
    for (const issue of mismatchIssues) {
      violations.push({
        rule: "latex-environments",
        message: issue,
        severity: "error",
        recoverable: true,
      });
    }

    // Warn if too many unclosed environments
    if (structure.openEnvironments.length > 5) {
      violations.push({
        rule: "latex-environments",
        message: `Excessive unclosed environments: ${structure.openEnvironments.length}`,
        severity: "warning",
        recoverable: true,
      });
    }
  } else {
    // Stream is complete, check for full balance
    if (!structure.isBalanced) {
      for (const issue of structure.issues) {
        violations.push({
          rule: "latex-environments",
          message: issue,
          severity: "error",
          recoverable: true,
          suggestion: "Retry generation to properly balance LaTeX environments",
        });
      }
    }
  }

  return violations;
}

/**
 * Validate LaTeX math mode balance
 * @param context - Guardrail context
 * @returns Array of violations
 */
export function validateLatexMath(
  context: GuardrailContext,
): GuardrailViolation[] {
  const { content, completed } = context;
  const violations: GuardrailViolation[] = [];

  // Skip if doesn't look like LaTeX
  if (!looksLikeLatex(content)) {
    return violations;
  }

  // Count display math delimiters - reset lastIndex for global patterns
  DISPLAY_MATH_OPEN.lastIndex = 0;
  DISPLAY_MATH_CLOSE.lastIndex = 0;
  DOUBLE_DOLLAR.lastIndex = 0;

  const displayMathOpen = (content.match(DISPLAY_MATH_OPEN) || []).length;
  const displayMathClose = (content.match(DISPLAY_MATH_CLOSE) || []).length;

  // Count $$ delimiters (should be even)
  const doubleDollar = (content.match(DOUBLE_DOLLAR) || []).length;

  // Count inline math $ (should be even, but harder to detect due to escaping)
  let singleDollarCount = 0;
  let escapeNext = false;
  for (let i = 0; i < content.length; i++) {
    if (escapeNext) {
      escapeNext = false;
      continue;
    }
    if (content[i] === "\\") {
      escapeNext = true;
      continue;
    }
    if (
      content[i] === "$" &&
      (i + 1 >= content.length || content[i + 1] !== "$")
    ) {
      singleDollarCount++;
    }
  }

  // Check display math balance
  if (completed) {
    if (displayMathOpen !== displayMathClose) {
      violations.push({
        rule: "latex-math",
        message: `Unbalanced display math: ${displayMathOpen} \\[ and ${displayMathClose} \\]`,
        severity: "error",
        recoverable: true,
        suggestion: "Ensure all \\[ have matching \\]",
      });
    }

    if (doubleDollar % 2 !== 0) {
      violations.push({
        rule: "latex-math",
        message: `Unbalanced $$ delimiters: ${doubleDollar} found (should be even)`,
        severity: "error",
        recoverable: true,
        suggestion: "Ensure all $$ are paired",
      });
    }

    if (singleDollarCount % 2 !== 0) {
      violations.push({
        rule: "latex-math",
        message: `Unbalanced inline math: ${singleDollarCount} $ found (should be even)`,
        severity: "warning",
        recoverable: true,
        suggestion: "Check inline math delimiters",
      });
    }
  }

  return violations;
}

/**
 * Check for common LaTeX errors
 * @param context - Guardrail context
 * @returns Array of violations
 */
export function validateLatexCommon(
  context: GuardrailContext,
): GuardrailViolation[] {
  const { content, completed } = context;
  const violations: GuardrailViolation[] = [];

  // Skip if doesn't look like LaTeX
  if (!looksLikeLatex(content)) {
    return violations;
  }

  // Only check complete output for these
  if (!completed) {
    return violations;
  }

  // Check for unmatched braces in commands
  const commandPattern = /\\[a-zA-Z]+/g;
  let match;
  while ((match = commandPattern.exec(content)) !== null) {
    const afterCommand = content.slice(match.index + match[0].length);

    // If command is followed by {, check for balance
    if (afterCommand.startsWith("{")) {
      let depth = 0;
      let found = false;
      for (let i = 0; i < afterCommand.length; i++) {
        if (afterCommand[i] === "{") depth++;
        if (afterCommand[i] === "}") {
          depth--;
          if (depth === 0) {
            found = true;
            break;
          }
        }
      }

      if (!found && depth > 0) {
        violations.push({
          rule: "latex-common",
          message: `Unclosed braces after command ${match[0]}`,
          severity: "warning",
          recoverable: true,
        });
      }
    }
  }

  return violations;
}

/**
 * Create LaTeX environment validation guardrail rule
 */
export function latexRule(): GuardrailRule {
  return {
    name: "latex-environments",
    description: "Validates LaTeX environment balance and structure",
    streaming: true,
    severity: "error",
    recoverable: true,
    check: (context: GuardrailContext) => {
      const violations: GuardrailViolation[] = [];

      // Skip if doesn't look like LaTeX
      if (!looksLikeLatex(context.content) && context.content.length > 50) {
        return violations;
      }

      // Check environment balance
      violations.push(...validateLatexEnvironments(context));

      // Check math mode balance
      violations.push(...validateLatexMath(context));

      // Check common errors (only on complete)
      if (context.completed) {
        violations.push(...validateLatexCommon(context));
      }

      return violations;
    },
  };
}

/**
 * LaTeX guardrail class for compatibility
 */
export class LatexGuardrail {
  private rule: GuardrailRule;

  constructor() {
    this.rule = latexRule();
  }

  check(context: GuardrailContext): GuardrailViolation[] {
    return this.rule.check(context);
  }

  get name(): string {
    return this.rule.name;
  }
}
