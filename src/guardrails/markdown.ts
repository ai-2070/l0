// Markdown structure validation for L0

import type {
  GuardrailRule,
  GuardrailContext,
  GuardrailViolation,
  MarkdownStructure,
} from "../types/guardrails";

// Pre-compiled regex patterns for performance
const HEADER_PATTERN = /^(#{1,6})\s+/;
const LIST_PATTERN = /^(\s*)([-*+]|\d+\.)\s+/;
const TABLE_SEPARATOR = /^\|?[\s-:|]+\|[\s-:|]*$/;
const PIPE_COUNT = /\|/g;
const UNORDERED_LIST = /^(\s*)([-*+])\s+/;
const ORDERED_LIST = /^(\s*)(\d+)\.\s+/;
const WHITESPACE_ONLY = /^\s*$/;
const SENTENCE_END = /[.!?;:\]})"`']$/;
const HEADER_LINE = /^#{1,6}\s+/;
const UNORDERED_LIST_LINE = /^[-*+]\s+/;
const ORDERED_LIST_LINE = /^\d+\.\s+/;

// Markdown detection patterns
const MARKDOWN_PATTERNS = [
  /^#{1,6}\s+/m, // Headers
  /```/, // Code fences
  /^\s*[-*+]\s+/m, // Unordered lists
  /^\s*\d+\.\s+/m, // Ordered lists
  /\*\*.*\*\*/, // Bold
  /\*.*\*/, // Italic
  /\[.*\]\(.*\)/, // Links
  /^>\s+/m, // Blockquotes
];

/**
 * Analyze Markdown structure in content
 * @param content - Content to analyze
 * @returns Markdown structure analysis
 */
export function analyzeMarkdownStructure(content: string): MarkdownStructure {
  const issues: string[] = [];
  const lines = content.split("\n");
  const fenceLanguages: string[] = [];
  const headers: number[] = [];
  let openFences = 0;
  let inFence = false;
  let listDepth = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;

    // Check for code fences (```)
    if (line.trimStart().startsWith("```")) {
      inFence = !inFence;
      if (inFence) {
        openFences++;
        // Extract language if specified
        const lang = line.trim().slice(3).trim();
        if (lang) {
          fenceLanguages.push(lang);
        }
      } else {
        openFences--;
      }
    }

    // Check for headers (only outside fences)
    if (!inFence) {
      const headerMatch = line.match(HEADER_PATTERN);
      if (headerMatch && headerMatch[1]) {
        headers.push(headerMatch[1].length);
      }

      // Check list depth
      const listMatch = line.match(LIST_PATTERN);
      if (listMatch && listMatch[1] !== undefined) {
        const indent = listMatch[1].length;
        const currentDepth = Math.floor(indent / 2) + 1;
        listDepth = Math.max(listDepth, currentDepth);
      }
    }
  }

  // Check for imbalanced fences
  if (inFence || openFences !== 0) {
    issues.push(`Unbalanced code fences: ${Math.abs(openFences)} unclosed`);
  }

  return {
    openFences: Math.max(0, openFences),
    fenceLanguages,
    inFence,
    headers,
    listDepth,
    issues,
  };
}

/**
 * Check if content contains Markdown formatting
 * @param content - Content to check
 * @returns True if content appears to contain Markdown
 */
export function looksLikeMarkdown(content: string): boolean {
  if (!content) return false;

  // Check for common Markdown patterns
  return MARKDOWN_PATTERNS.some((pattern) => pattern.test(content));
}

/**
 * Validate Markdown fence balance
 * @param context - Guardrail context
 * @returns Array of violations
 */
export function validateMarkdownFences(
  context: GuardrailContext,
): GuardrailViolation[] {
  const { content, completed } = context;
  const violations: GuardrailViolation[] = [];

  const structure = analyzeMarkdownStructure(content);

  // Only check fence balance when stream is complete
  // During streaming, being inside a fence is expected and normal
  if (completed && (structure.inFence || structure.openFences !== 0)) {
    // Stream is complete but fences aren't balanced
    violations.push({
      rule: "markdown-fences",
      message: `Unclosed code fences: ${structure.openFences} fence(s) not closed`,
      severity: "error",
      recoverable: true,
      suggestion: "Retry generation to properly close code fences",
    });
  }

  return violations;
}

/**
 * Validate Markdown table structure
 * @param context - Guardrail context
 * @returns Array of violations
 */
export function validateMarkdownTables(
  context: GuardrailContext,
): GuardrailViolation[] {
  const { content, completed } = context;
  const violations: GuardrailViolation[] = [];

  // Only check complete output
  if (!completed) {
    return violations;
  }

  const lines = content.split("\n");
  let inTable = false;
  let columnCount = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;

    // Check for table separator line (|---|---|)
    if (TABLE_SEPARATOR.test(line)) {
      inTable = true;
      columnCount = (line.match(PIPE_COUNT) || []).length;
      continue;
    }

    if (inTable) {
      // Check if still in table (line contains |)
      if (line.includes("|")) {
        const cols = (line.match(PIPE_COUNT) || []).length;
        if (cols !== columnCount) {
          violations.push({
            rule: "markdown-tables",
            message: `Inconsistent table columns at line ${i + 1}: expected ${columnCount}, got ${cols}`,
            severity: "warning",
            recoverable: true,
          });
        }
      } else if (line.trim().length > 0) {
        // End of table
        inTable = false;
      }
    }
  }

  return violations;
}

/**
 * Validate Markdown list consistency
 * @param context - Guardrail context
 * @returns Array of violations
 */
export function validateMarkdownLists(
  context: GuardrailContext,
): GuardrailViolation[] {
  const { content, completed } = context;
  const violations: GuardrailViolation[] = [];

  // Only check complete output
  if (!completed) {
    return violations;
  }

  const lines = content.split("\n");
  let lastListType: "ordered" | "unordered" | null = null;
  let lastIndent = -1;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;

    // Check for unordered list
    const unorderedMatch = line.match(UNORDERED_LIST);
    if (unorderedMatch && unorderedMatch[1] !== undefined) {
      const indent = unorderedMatch[1].length;

      // Check for mixed list types at same level
      if (lastListType === "ordered" && lastIndent === indent) {
        violations.push({
          rule: "markdown-lists",
          message: `Mixed list types at line ${i + 1}: switching from ordered to unordered at same level`,
          severity: "warning",
          recoverable: true,
        });
      }

      lastListType = "unordered";
      lastIndent = indent;
      continue;
    }

    // Check for ordered list
    const orderedMatch = line.match(ORDERED_LIST);
    if (orderedMatch && orderedMatch[1] !== undefined) {
      const indent = orderedMatch[1].length;

      // Check for mixed list types at same level
      if (lastListType === "unordered" && lastIndent === indent) {
        violations.push({
          rule: "markdown-lists",
          message: `Mixed list types at line ${i + 1}: switching from unordered to ordered at same level`,
          severity: "warning",
          recoverable: true,
        });
      }

      lastListType = "ordered";
      lastIndent = indent;
      continue;
    }

    // Non-list line, reset
    if (line.trim().length > 0 && !WHITESPACE_ONLY.test(line)) {
      lastListType = null;
      lastIndent = -1;
    }
  }

  return violations;
}

/**
 * Check for incomplete Markdown blocks
 * @param context - Guardrail context
 * @returns Array of violations
 */
export function validateMarkdownComplete(
  context: GuardrailContext,
): GuardrailViolation[] {
  const { content, completed } = context;
  const violations: GuardrailViolation[] = [];

  // Only check when complete
  if (!completed) {
    return violations;
  }

  // Check if ends mid-fence
  const structure = analyzeMarkdownStructure(content);
  if (structure.inFence) {
    violations.push({
      rule: "markdown-complete",
      message: "Content ends inside code fence",
      severity: "error",
      recoverable: true,
      suggestion: "Retry to complete the code fence",
    });
  }

  // Check if ends mid-sentence (very basic heuristic)
  const trimmed = content.trim();

  // If last line looks like it's in the middle of something
  const lines = trimmed.split("\n");
  const lastLine = lines[lines.length - 1] ?? "";

  // Check if last line ends abruptly without punctuation (but not in code)
  if (
    !structure.inFence &&
    lastLine.trim().length > 0 &&
    !SENTENCE_END.test(lastLine) &&
    !HEADER_LINE.test(lastLine) && // Not a header
    !UNORDERED_LIST_LINE.test(lastLine) && // Not a list item
    !ORDERED_LIST_LINE.test(lastLine) // Not an ordered list
  ) {
    violations.push({
      rule: "markdown-complete",
      message: "Content appears to end abruptly mid-sentence",
      severity: "warning",
      recoverable: true,
    });
  }

  return violations;
}

/**
 * Create Markdown structure guardrail rule
 */
export function markdownRule(): GuardrailRule {
  return {
    name: "markdown-structure",
    description: "Validates Markdown fences, blocks, and structure",
    streaming: true,
    severity: "error",
    recoverable: true,
    check: (context: GuardrailContext) => {
      const violations: GuardrailViolation[] = [];

      // Skip if doesn't look like Markdown
      if (!looksLikeMarkdown(context.content) && context.content.length > 50) {
        return violations;
      }

      // Check fences
      violations.push(...validateMarkdownFences(context));

      // Check tables (only on complete)
      if (context.completed) {
        violations.push(...validateMarkdownTables(context));
        violations.push(...validateMarkdownLists(context));
        violations.push(...validateMarkdownComplete(context));
      }

      return violations;
    },
  };
}

/**
 * Markdown guardrail class for compatibility
 */
export class MarkdownGuardrail {
  private rule: GuardrailRule;

  constructor() {
    this.rule = markdownRule();
  }

  check(context: GuardrailContext): GuardrailViolation[] {
    return this.rule.check(context);
  }

  get name(): string {
    return this.rule.name;
  }
}
