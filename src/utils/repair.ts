// Optional output repair helpers (tiny, non-AI syntactic repairs)

/**
 * Attempt to repair malformed JSON by fixing common issues
 * @param json - JSON string to repair
 * @returns Repaired JSON string
 */
export function repairJson(json: string): string {
  if (!json || json.trim().length === 0) {
    return json;
  }

  let repaired = json.trim();

  // Fix unbalanced braces
  repaired = balanceBraces(repaired);

  // Fix unbalanced brackets
  repaired = balanceBrackets(repaired);

  // Fix trailing commas
  repaired = removeTrailingCommas(repaired);

  // Fix unclosed strings (basic heuristic)
  repaired = fixUnclosedStrings(repaired);

  return repaired;
}

/**
 * Balance opening and closing braces in JSON
 * @param json - JSON string
 * @returns JSON with balanced braces
 */
export function balanceBraces(json: string): string {
  if (!json) return json;

  let openCount = 0;
  let closeCount = 0;
  let inString = false;
  let escapeNext = false;

  // Count braces outside of strings
  for (let i = 0; i < json.length; i++) {
    const char = json[i];

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
      if (char === "{") openCount++;
      if (char === "}") closeCount++;
    }
  }

  // Add missing closing braces
  if (openCount > closeCount) {
    return json + "}".repeat(openCount - closeCount);
  }

  // Remove extra closing braces (trim from end)
  if (closeCount > openCount) {
    let result = json;
    let toRemove = closeCount - openCount;
    for (let i = result.length - 1; i >= 0 && toRemove > 0; i--) {
      if (result[i] === "}") {
        result = result.slice(0, i) + result.slice(i + 1);
        toRemove--;
      }
    }
    return result;
  }

  return json;
}

/**
 * Balance opening and closing brackets in JSON
 * @param json - JSON string
 * @returns JSON with balanced brackets
 */
export function balanceBrackets(json: string): string {
  if (!json) return json;

  let openCount = 0;
  let closeCount = 0;
  let inString = false;
  let escapeNext = false;

  // Count brackets outside of strings
  for (let i = 0; i < json.length; i++) {
    const char = json[i];

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
      if (char === "[") openCount++;
      if (char === "]") closeCount++;
    }
  }

  // Add missing closing brackets
  if (openCount > closeCount) {
    return json + "]".repeat(openCount - closeCount);
  }

  // Remove extra closing brackets (trim from end)
  if (closeCount > openCount) {
    let result = json;
    let toRemove = closeCount - openCount;
    for (let i = result.length - 1; i >= 0 && toRemove > 0; i--) {
      if (result[i] === "]") {
        result = result.slice(0, i) + result.slice(i + 1);
        toRemove--;
      }
    }
    return result;
  }

  return json;
}

/**
 * Remove trailing commas in JSON (before closing braces/brackets)
 * @param json - JSON string
 * @returns JSON without trailing commas
 */
export function removeTrailingCommas(json: string): string {
  if (!json) return json;

  // Remove commas before closing braces/brackets
  // Simple regex approach (not perfect but handles common cases)
  return json.replace(/,(\s*})/g, "$1").replace(/,(\s*])/g, "$1");
}

/**
 * Attempt to fix unclosed strings in JSON
 * Basic heuristic - adds closing quote if unbalanced
 * @param json - JSON string
 * @returns JSON with balanced quotes
 */
export function fixUnclosedStrings(json: string): string {
  if (!json) return json;

  let quoteCount = 0;
  let escapeNext = false;

  for (let i = 0; i < json.length; i++) {
    const char = json[i];

    if (escapeNext) {
      escapeNext = false;
      continue;
    }

    if (char === "\\") {
      escapeNext = true;
      continue;
    }

    if (char === '"') {
      quoteCount++;
    }
  }

  // If odd number of quotes, add closing quote
  if (quoteCount % 2 !== 0) {
    return json + '"';
  }

  return json;
}

/**
 * Repair incomplete markdown code fences
 * @param markdown - Markdown string
 * @returns Markdown with closed fences
 */
export function repairMarkdownFences(markdown: string): string {
  if (!markdown) return markdown;

  const fencePattern = /```/g;
  const matches = markdown.match(fencePattern);

  if (!matches) return markdown;

  // If odd number of fences, add closing fence
  if (matches.length % 2 !== 0) {
    return markdown + "\n```";
  }

  return markdown;
}

/**
 * Repair unclosed LaTeX environments
 * @param latex - LaTeX string
 * @returns LaTeX with closed environments
 */
export function repairLatexEnvironments(latex: string): string {
  if (!latex) return latex;

  const beginPattern = /\\begin\{(\w+)\}/g;
  const endPattern = /\\end\{(\w+)\}/g;

  const begins = Array.from(latex.matchAll(beginPattern));
  const ends = Array.from(latex.matchAll(endPattern));

  // Track unclosed environments
  const stack: string[] = [];

  // Simple matching algorithm
  for (const begin of begins) {
    stack.push(begin[1]!);
  }

  for (const end of ends) {
    const env = end[1]!;
    const lastIndex = stack.lastIndexOf(env);
    if (lastIndex !== -1) {
      stack.splice(lastIndex, 1);
    }
  }

  // Add missing \end{} for unclosed environments
  let result = latex;
  for (const env of stack.reverse()) {
    result += `\n\\end{${env}}`;
  }

  return result;
}

/**
 * Trim malformed tool call arguments
 * Ensures JSON-like structure for tool calls
 * @param args - Tool call arguments string
 * @returns Repaired arguments
 */
export function repairToolCallArguments(args: string): string {
  if (!args) return args;

  let repaired = args.trim();

  // Ensure it starts and ends like JSON
  if (!repaired.startsWith("{") && !repaired.startsWith("[")) {
    repaired = "{" + repaired;
  }

  // Balance and repair JSON
  repaired = repairJson(repaired);

  return repaired;
}

/**
 * Check if JSON is structurally valid (can be parsed)
 * @param json - JSON string
 * @returns True if valid JSON
 */
export function isValidJson(json: string): boolean {
  if (!json || json.trim().length === 0) {
    return false;
  }

  try {
    JSON.parse(json);
    return true;
  } catch {
    return false;
  }
}

/**
 * Try to parse JSON, return repaired version if needed
 * @param json - JSON string
 * @returns Parsed object or null if unrepairable
 */
export function parseOrRepairJson(json: string): any {
  if (!json) return null;

  // Try parsing as-is
  try {
    return JSON.parse(json);
  } catch {
    // Try repairing
    const repaired = repairJson(json);
    try {
      return JSON.parse(repaired);
    } catch {
      return null;
    }
  }
}

/**
 * Extract JSON from text that might contain other content
 * Looks for first { or [ and tries to extract valid JSON
 * @param text - Text containing JSON
 * @returns Extracted JSON string or null
 */
export function extractJson(text: string): string | null {
  if (!text) return null;

  // Find first { or [
  const startBrace = text.indexOf("{");
  const startBracket = text.indexOf("[");

  let start = -1;
  if (startBrace !== -1 && startBracket !== -1) {
    start = Math.min(startBrace, startBracket);
  } else if (startBrace !== -1) {
    start = startBrace;
  } else if (startBracket !== -1) {
    start = startBracket;
  }

  if (start === -1) return null;

  // Try to find matching end
  const startChar = text[start];
  const endChar = startChar === "{" ? "}" : "]";

  let depth = 0;
  let inString = false;
  let escapeNext = false;

  for (let i = start; i < text.length; i++) {
    const char = text[i];

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
      if (char === startChar) depth++;
      if (char === endChar) {
        depth--;
        if (depth === 0) {
          return text.slice(start, i + 1);
        }
      }
    }
  }

  // If we couldn't find the end, try repairing from start to end
  return repairJson(text.slice(start));
}

/**
 * Wrap content in JSON object with key
 * @param key - Object key
 * @param content - Content to wrap
 * @returns JSON string
 */
export function wrapInJson(key: string, content: string): string {
  return JSON.stringify({ [key]: content });
}

/**
 * Ensure content is valid JSON, wrap if necessary
 * @param content - Content to ensure is JSON
 * @param wrapKey - Key to use if wrapping (default: "content")
 * @returns Valid JSON string
 */
export function ensureJson(
  content: string,
  wrapKey: string = "content",
): string {
  if (!content) return "{}";

  // Check if already valid JSON
  if (isValidJson(content)) {
    return content;
  }

  // Try repairing
  const repaired = repairJson(content);
  if (isValidJson(repaired)) {
    return repaired;
  }

  // Wrap as string value
  return wrapInJson(wrapKey, content);
}
