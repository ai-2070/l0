// Format context helper for wrapping documents and instructions

import { normalizeForModel, dedent } from "../utils/normalize";

/**
 * Format options for context
 */
export interface FormatContextOptions {
  /**
   * Label for the context section (default: "Context")
   */
  label?: string;

  /**
   * Whether to dedent the content (default: true)
   */
  dedent?: boolean;

  /**
   * Whether to normalize whitespace (default: true)
   */
  normalize?: boolean;

  /**
   * Delimiter style
   */
  delimiter?: "xml" | "markdown" | "brackets" | "none";

  /**
   * Custom delimiter start (overrides delimiter style)
   */
  customDelimiterStart?: string;

  /**
   * Custom delimiter end (overrides delimiter style)
   */
  customDelimiterEnd?: string;
}

/**
 * Format context content with proper delimiters and normalization
 * Useful for wrapping uploaded documents or instructions safely
 *
 * @param content - Context content to format
 * @param options - Formatting options
 * @returns Formatted context string
 *
 * @example
 * ```typescript
 * const context = formatContext("User manual content here...", {
 *   label: "Documentation",
 *   delimiter: "xml"
 * });
 * // Returns:
 * // <documentation>
 * // User manual content here...
 * // </documentation>
 * ```
 */
export function formatContext(
  content: string,
  options: FormatContextOptions = {},
): string {
  if (!content || content.trim().length === 0) {
    return "";
  }

  const {
    label = "Context",
    dedent: shouldDedent = true,
    normalize = true,
    delimiter = "xml",
    customDelimiterStart,
    customDelimiterEnd,
  } = options;

  // Normalize content
  let processed = content;
  if (normalize) {
    processed = normalizeForModel(processed);
  }
  if (shouldDedent) {
    processed = dedent(processed);
  }

  // Apply delimiters
  if (customDelimiterStart && customDelimiterEnd) {
    return `${customDelimiterStart}\n${processed}\n${customDelimiterEnd}`;
  }

  switch (delimiter) {
    case "xml":
      return formatXmlContext(processed, label);
    case "markdown":
      return formatMarkdownContext(processed, label);
    case "brackets":
      return formatBracketContext(processed, label);
    case "none":
      return processed;
    default:
      return formatXmlContext(processed, label);
  }
}

/**
 * Format context with XML-style tags
 */
function formatXmlContext(content: string, label: string): string {
  const tag = label.toLowerCase().replace(/\s+/g, "_");
  return `<${tag}>\n${content}\n</${tag}>`;
}

/**
 * Format context with Markdown-style
 */
function formatMarkdownContext(content: string, label: string): string {
  return `# ${label}\n\n${content}`;
}

/**
 * Format context with bracket delimiters
 */
function formatBracketContext(content: string, label: string): string {
  const delimiter = "=".repeat(Math.max(20, label.length + 10));
  return `[${label.toUpperCase()}]\n${delimiter}\n${content}\n${delimiter}`;
}

/**
 * Format multiple context items
 *
 * @param items - Array of context items with content and optional labels
 * @param options - Formatting options
 * @returns Formatted context string with all items
 *
 * @example
 * ```typescript
 * const contexts = formatMultipleContexts([
 *   { content: "Document 1", label: "Doc1" },
 *   { content: "Document 2", label: "Doc2" }
 * ]);
 * ```
 */
export function formatMultipleContexts(
  items: Array<{ content: string; label?: string }>,
  options: FormatContextOptions = {},
): string {
  const formatted = items
    .filter((item) => item.content && item.content.trim().length > 0)
    .map((item) =>
      formatContext(item.content, {
        ...options,
        label: item.label || options.label,
      }),
    );

  return formatted.join("\n\n");
}

/**
 * Format a document with metadata
 *
 * @param content - Document content
 * @param metadata - Document metadata (title, author, date, etc.)
 * @param options - Formatting options
 * @returns Formatted document string
 */
export function formatDocument(
  content: string,
  metadata?: Record<string, string>,
  options: FormatContextOptions = {},
): string {
  if (!content || content.trim().length === 0) {
    return "";
  }

  let result = "";

  // Add metadata if provided
  if (metadata && Object.keys(metadata).length > 0) {
    const metaLines = Object.entries(metadata)
      .filter(([_, value]) => value && value.trim().length > 0)
      .map(([key, value]) => `${key}: ${value}`);

    if (metaLines.length > 0) {
      result += metaLines.join("\n") + "\n\n";
    }
  }

  // Add content
  result += content;

  // Wrap with context formatter
  return formatContext(result, {
    label: metadata?.title || "Document",
    ...options,
  });
}

/**
 * Format instructions or system prompt with clear boundaries
 *
 * @param instructions - Instructions text
 * @param options - Formatting options
 * @returns Formatted instructions
 */
export function formatInstructions(
  instructions: string,
  options: FormatContextOptions = {},
): string {
  return formatContext(instructions, {
    label: "Instructions",
    delimiter: "xml",
    ...options,
  });
}

/**
 * Escape special delimiters in content to prevent injection
 *
 * @param content - Content to escape
 * @param delimiter - Delimiter type to escape
 * @returns Escaped content
 */
export function escapeDelimiters(
  content: string,
  delimiter: "xml" | "markdown" | "brackets" = "xml",
): string {
  if (!content) return content;

  switch (delimiter) {
    case "xml":
      // Escape XML tags
      return content.replace(/</g, "&lt;").replace(/>/g, "&gt;");
    case "markdown":
      // Escape markdown headers
      return content.replace(/^(#{1,6})\s/gm, "\\$1 ");
    case "brackets":
      // Escape bracket delimiters
      return content.replace(/\[/g, "\\[").replace(/\]/g, "\\]");
    default:
      return content;
  }
}

/**
 * Unescape delimiters (reverse of escapeDelimiters)
 *
 * @param content - Content to unescape
 * @param delimiter - Delimiter type to unescape
 * @returns Unescaped content
 */
export function unescapeDelimiters(
  content: string,
  delimiter: "xml" | "markdown" | "brackets" = "xml",
): string {
  if (!content) return content;

  switch (delimiter) {
    case "xml":
      return content.replace(/&lt;/g, "<").replace(/&gt;/g, ">");
    case "markdown":
      return content.replace(/\\(#{1,6})\s/g, "$1 ");
    case "brackets":
      return content.replace(/\\\[/g, "[").replace(/\\\]/g, "]");
    default:
      return content;
  }
}
