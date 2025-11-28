// Newline and whitespace normalization utilities for L0

/**
 * Normalize newlines to \n (Unix-style)
 * Converts \r\n (Windows) and \r (old Mac) to \n
 * @param text - Text to normalize
 * @returns Text with normalized newlines
 */
export function normalizeNewlines(text: string): string {
  if (!text) return text;

  // Replace \r\n with \n, then replace remaining \r with \n
  return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

/**
 * Normalize whitespace (collapse multiple spaces, trim lines)
 * @param text - Text to normalize
 * @param options - Normalization options
 * @returns Text with normalized whitespace
 */
export function normalizeWhitespace(
  text: string,
  options: {
    collapseSpaces?: boolean;
    trimLines?: boolean;
    removeEmptyLines?: boolean;
  } = {},
): string {
  if (!text) return text;

  const {
    collapseSpaces = false,
    trimLines = false,
    removeEmptyLines = false,
  } = options;

  let result = text;

  // Normalize newlines first
  result = normalizeNewlines(result);

  // Collapse multiple spaces into one
  if (collapseSpaces) {
    result = result.replace(/ {2,}/g, " ");
  }

  // Trim each line
  if (trimLines) {
    result = result
      .split("\n")
      .map((line) => line.trim())
      .join("\n");
  }

  // Remove empty lines
  if (removeEmptyLines) {
    result = result
      .split("\n")
      .filter((line) => line.trim().length > 0)
      .join("\n");
  }

  return result;
}

/**
 * Normalize indentation (convert tabs to spaces or vice versa)
 * @param text - Text to normalize
 * @param mode - 'spaces' or 'tabs'
 * @param spacesPerTab - Number of spaces per tab (default: 2)
 * @returns Text with normalized indentation
 */
export function normalizeIndentation(
  text: string,
  mode: "spaces" | "tabs" = "spaces",
  spacesPerTab: number = 2,
): string {
  if (!text) return text;

  const lines = normalizeNewlines(text).split("\n");

  if (mode === "spaces") {
    // Convert tabs to spaces
    return lines
      .map((line) => line.replace(/\t/g, " ".repeat(spacesPerTab)))
      .join("\n");
  } else {
    // Convert spaces to tabs
    const spacePattern = new RegExp(`^ {${spacesPerTab}}`, "gm");
    return lines
      .map((line) => {
        let converted = line;
        // Only convert leading spaces
        const leadingSpaces = line.match(/^ +/);
        if (leadingSpaces) {
          const spaces = leadingSpaces[0].length;
          const tabs = Math.floor(spaces / spacesPerTab);
          const remainingSpaces = spaces % spacesPerTab;
          converted =
            "\t".repeat(tabs) +
            " ".repeat(remainingSpaces) +
            line.slice(spaces);
        }
        return converted;
      })
      .join("\n");
  }
}

/**
 * Remove common leading indentation from all lines
 * Useful for normalizing code blocks
 * @param text - Text to dedent
 * @returns Dedented text
 */
export function dedent(text: string): string {
  if (!text) return text;

  const lines = normalizeNewlines(text).split("\n");

  // Find minimum indentation (excluding empty lines)
  let minIndent = Infinity;
  for (const line of lines) {
    if (line.trim().length === 0) continue;

    const indent = line.match(/^[ \t]*/)?.[0].length ?? 0;
    minIndent = Math.min(minIndent, indent);
  }

  // If no indentation found, return as-is
  if (minIndent === Infinity || minIndent === 0) {
    return text;
  }

  // Remove the common indentation
  return lines
    .map((line) => {
      if (line.trim().length === 0) return line;
      return line.slice(minIndent);
    })
    .join("\n");
}

/**
 * Add indentation to all lines
 * @param text - Text to indent
 * @param indent - Indentation to add (string or number of spaces)
 * @returns Indented text
 */
export function indent(text: string, indent: string | number = 2): string {
  if (!text) return text;

  const indentStr = typeof indent === "number" ? " ".repeat(indent) : indent;
  const lines = normalizeNewlines(text).split("\n");

  return lines
    .map((line) => (line.trim().length > 0 ? indentStr + line : line))
    .join("\n");
}

/**
 * Trim whitespace from start and end of text
 * Also removes leading/trailing empty lines
 * @param text - Text to trim
 * @returns Trimmed text
 */
export function trimText(text: string): string {
  if (!text) return text;

  const lines = normalizeNewlines(text).split("\n");

  // Remove leading empty lines
  while (lines.length > 0 && lines[0].trim().length === 0) {
    lines.shift();
  }

  // Remove trailing empty lines
  while (lines.length > 0 && lines[lines.length - 1].trim().length === 0) {
    lines.pop();
  }

  return lines.join("\n").trim();
}

/**
 * Normalize all whitespace aspects of text
 * Combines multiple normalization operations
 * @param text - Text to normalize
 * @param options - Normalization options
 * @returns Fully normalized text
 */
export function normalizeText(
  text: string,
  options: {
    newlines?: boolean;
    whitespace?: boolean;
    indentation?: "spaces" | "tabs" | false;
    spacesPerTab?: number;
    dedent?: boolean;
    trim?: boolean;
  } = {},
): string {
  if (!text) return text;

  const {
    newlines = true,
    whitespace = false,
    indentation = false,
    spacesPerTab = 2,
    dedent: shouldDedent = false,
    trim = false,
  } = options;

  let result = text;

  // Normalize newlines
  if (newlines) {
    result = normalizeNewlines(result);
  }

  // Normalize whitespace
  if (whitespace) {
    result = normalizeWhitespace(result, {
      collapseSpaces: true,
      trimLines: false,
      removeEmptyLines: false,
    });
  }

  // Normalize indentation
  if (indentation) {
    result = normalizeIndentation(result, indentation, spacesPerTab);
  }

  // Dedent
  if (shouldDedent) {
    result = dedent(result);
  }

  // Trim
  if (trim) {
    result = trimText(result);
  }

  return result;
}

/**
 * Ensure text ends with a single newline
 * @param text - Text to normalize
 * @returns Text with single trailing newline
 */
export function ensureTrailingNewline(text: string): string {
  if (!text) return text;

  const normalized = normalizeNewlines(text);

  // Remove any trailing newlines
  const trimmed = normalized.replace(/\n+$/, "");

  // Add single newline
  return trimmed + "\n";
}

/**
 * Remove all trailing whitespace from each line
 * @param text - Text to process
 * @returns Text with trailing whitespace removed
 */
export function removeTrailingWhitespace(text: string): string {
  if (!text) return text;

  return normalizeNewlines(text)
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/, ""))
    .join("\n");
}

/**
 * Normalize line endings and ensure consistent formatting
 * Good for preparing text for model consumption
 * @param text - Text to normalize
 * @returns Normalized text
 */
export function normalizeForModel(text: string): string {
  if (!text) return text;

  return normalizeText(text, {
    newlines: true,
    whitespace: true,
    trim: true,
  });
}

/**
 * Check if text contains only whitespace
 * @param text - Text to check
 * @returns True if text is empty or only whitespace
 */
export function isWhitespaceOnly(text: string): boolean {
  if (!text) return true;
  return /^[\s\r\n\t]*$/.test(text);
}

/**
 * Count lines in text
 * @param text - Text to count lines in
 * @returns Number of lines
 */
export function countLines(text: string): number {
  if (!text) return 0;
  return normalizeNewlines(text).split("\n").length;
}

/**
 * Get line at specific index
 * @param text - Text to extract from
 * @param lineIndex - Zero-based line index
 * @returns Line content or null if out of bounds
 */
export function getLine(text: string, lineIndex: number): string | null {
  if (!text) return null;

  const lines = normalizeNewlines(text).split("\n");
  if (lineIndex < 0 || lineIndex >= lines.length) {
    return null;
  }

  return lines[lineIndex];
}

/**
 * Replace line at specific index
 * @param text - Text to modify
 * @param lineIndex - Zero-based line index
 * @param newLine - New line content
 * @returns Modified text
 */
export function replaceLine(
  text: string,
  lineIndex: number,
  newLine: string,
): string {
  if (!text) return text;

  const lines = normalizeNewlines(text).split("\n");
  if (lineIndex < 0 || lineIndex >= lines.length) {
    return text;
  }

  lines[lineIndex] = newLine;
  return lines.join("\n");
}
