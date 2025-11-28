// Format utility helpers for trimming and escaping

/**
 * Trim whitespace from string
 * @param str - String to trim
 * @returns Trimmed string
 */
export function trim(str: string): string {
  if (!str) return str;
  return str.trim();
}

/**
 * Escape special characters for safe inclusion in prompts
 * @param str - String to escape
 * @returns Escaped string
 */
export function escape(str: string): string {
  if (!str) return str;

  return str
    .replace(/\\/g, "\\\\") // Escape backslashes
    .replace(/"/g, '\\"') // Escape double quotes
    .replace(/'/g, "\\'") // Escape single quotes
    .replace(/\n/g, "\\n") // Escape newlines
    .replace(/\r/g, "\\r") // Escape carriage returns
    .replace(/\t/g, "\\t"); // Escape tabs
}

/**
 * Unescape previously escaped characters
 * @param str - String to unescape
 * @returns Unescaped string
 */
export function unescape(str: string): string {
  if (!str) return str;

  // Use placeholder to handle escaped backslashes correctly
  const BACKSLASH_PLACEHOLDER = "\x00BACKSLASH\x00";

  return str
    .replace(/\\\\/g, BACKSLASH_PLACEHOLDER)
    .replace(/\\t/g, "\t")
    .replace(/\\r/g, "\r")
    .replace(/\\n/g, "\n")
    .replace(/\\'/g, "'")
    .replace(/\\"/g, '"')
    .replace(new RegExp(BACKSLASH_PLACEHOLDER, "g"), "\\");
}

/**
 * Escape HTML entities
 * @param str - String to escape
 * @returns HTML-escaped string
 */
export function escapeHtml(str: string): string {
  if (!str) return str;

  const entities: Record<string, string> = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  };

  return str.replace(/[&<>"']/g, (char) => entities[char] || char);
}

/**
 * Unescape HTML entities
 * @param str - String to unescape
 * @returns HTML-unescaped string
 */
export function unescapeHtml(str: string): string {
  if (!str) return str;

  const entities: Record<string, string> = {
    "&amp;": "&",
    "&lt;": "<",
    "&gt;": ">",
    "&quot;": '"',
    "&#39;": "'",
    "&#x27;": "'",
  };

  return str.replace(
    /&(?:amp|lt|gt|quot|#39|#x27);/g,
    (entity) => entities[entity] || entity,
  );
}

/**
 * Escape regex special characters
 * @param str - String to escape
 * @returns Regex-escaped string
 */
export function escapeRegex(str: string): string {
  if (!str) return str;

  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Sanitize string for use in prompts (remove control characters)
 * @param str - String to sanitize
 * @returns Sanitized string
 */
export function sanitize(str: string): string {
  if (!str) return str;

  // Remove control characters except newline and tab
  return str.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "");
}

/**
 * Truncate string to maximum length with optional suffix
 * @param str - String to truncate
 * @param maxLength - Maximum length
 * @param suffix - Suffix to add if truncated (default: "...")
 * @returns Truncated string
 */
export function truncate(
  str: string,
  maxLength: number,
  suffix: string = "...",
): string {
  if (!str || str.length <= maxLength) {
    return str;
  }

  const truncateAt = maxLength - suffix.length;
  return str.slice(0, truncateAt) + suffix;
}

/**
 * Truncate string at word boundary
 * @param str - String to truncate
 * @param maxLength - Maximum length
 * @param suffix - Suffix to add if truncated (default: "...")
 * @returns Truncated string
 */
export function truncateWords(
  str: string,
  maxLength: number,
  suffix: string = "...",
): string {
  if (!str || str.length <= maxLength) {
    return str;
  }

  const truncateAt = maxLength - suffix.length;
  const truncated = str.slice(0, truncateAt);

  // Find last space
  const lastSpace = truncated.lastIndexOf(" ");
  if (lastSpace > 0) {
    return truncated.slice(0, lastSpace) + suffix;
  }

  return truncated + suffix;
}

/**
 * Wrap text to specified width
 * @param str - String to wrap
 * @param width - Maximum line width
 * @returns Wrapped string
 */
export function wrap(str: string, width: number): string {
  if (!str) return str;

  const words = str.split(/\s+/);
  const lines: string[] = [];
  let currentLine = "";

  for (const word of words) {
    if (currentLine.length + word.length + 1 <= width) {
      currentLine += (currentLine ? " " : "") + word;
    } else {
      if (currentLine) {
        lines.push(currentLine);
      }
      currentLine = word;
    }
  }

  if (currentLine) {
    lines.push(currentLine);
  }

  return lines.join("\n");
}

/**
 * Pad string to specified length
 * @param str - String to pad
 * @param length - Target length
 * @param char - Character to pad with (default: " ")
 * @param align - Alignment: "left", "right", or "center" (default: "left")
 * @returns Padded string
 */
export function pad(
  str: string,
  length: number,
  char: string = " ",
  align: "left" | "right" | "center" = "left",
): string {
  if (!str) str = "";
  if (str.length >= length) return str;

  const padLength = length - str.length;

  switch (align) {
    case "right":
      return char.repeat(padLength) + str;
    case "center": {
      const leftPad = Math.floor(padLength / 2);
      const rightPad = padLength - leftPad;
      return char.repeat(leftPad) + str + char.repeat(rightPad);
    }
    case "left":
    default:
      return str + char.repeat(padLength);
  }
}

/**
 * Remove ANSI color codes from string
 * @param str - String to clean
 * @returns String without ANSI codes
 */
export function removeAnsi(str: string): string {
  if (!str) return str;

  // Remove ANSI escape codes
  return str.replace(
    /[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g,
    "",
  );
}
