// Format JSON output and other output types

// normalizeForModel available for future use
// import { normalizeForModel } from "../utils/normalize";

/**
 * Options for formatting JSON output
 */
export interface FormatJsonOutputOptions {
  /**
   * Whether to include instructions about JSON-only output
   */
  includeInstructions?: boolean;

  /**
   * Whether to specify strict mode (no extra text)
   */
  strict?: boolean;

  /**
   * Schema description (optional)
   */
  schema?: string;

  /**
   * Example output (optional)
   */
  example?: string;
}

/**
 * Format instructions to request JSON-only output from the model
 * Provides clear boundaries and prevents model from adding extra text
 *
 * @param options - Formatting options
 * @returns Formatted instruction string
 *
 * @example
 * ```typescript
 * const instruction = formatJsonOutput({ strict: true });
 * // Use in prompt: prompt + "\n\n" + instruction
 * ```
 */
export function formatJsonOutput(
  options: FormatJsonOutputOptions = {},
): string {
  const {
    includeInstructions = true,
    strict = true,
    schema,
    example,
  } = options;

  const parts: string[] = [];

  if (includeInstructions) {
    if (strict) {
      parts.push(
        "Respond with valid JSON only. Do not include any text before or after the JSON object.",
      );
      parts.push("Do not wrap the JSON in markdown code blocks or backticks.");
      parts.push("Start your response with { and end with }.");
    } else {
      parts.push("Respond with valid JSON.");
    }
  }

  if (schema) {
    parts.push("");
    parts.push("Expected JSON schema:");
    parts.push(schema);
  }

  if (example) {
    parts.push("");
    parts.push("Example output:");
    parts.push(example);
  }

  return parts.join("\n");
}

/**
 * Format instructions for structured output with specific format
 *
 * @param format - Output format (json, yaml, xml, markdown, etc.)
 * @param options - Additional options
 * @returns Formatted instruction string
 */
export function formatStructuredOutput(
  format: "json" | "yaml" | "xml" | "markdown" | "plain",
  options: {
    strict?: boolean;
    schema?: string;
    example?: string;
  } = {},
): string {
  const { strict = true, schema, example } = options;

  const parts: string[] = [];

  switch (format) {
    case "json":
      return formatJsonOutput({
        includeInstructions: true,
        strict,
        schema,
        example,
      });

    case "yaml":
      if (strict) {
        parts.push("Respond with valid YAML only.");
        parts.push("Do not include any text before or after the YAML.");
      } else {
        parts.push("Respond with valid YAML.");
      }
      break;

    case "xml":
      if (strict) {
        parts.push("Respond with valid XML only.");
        parts.push("Start with an XML declaration or root element.");
        parts.push("Do not include any text before or after the XML.");
      } else {
        parts.push("Respond with valid XML.");
      }
      break;

    case "markdown":
      parts.push("Respond with well-formatted Markdown.");
      if (strict) {
        parts.push("Use proper Markdown syntax for all formatting.");
      }
      break;

    case "plain":
      parts.push("Respond with plain text only.");
      if (strict) {
        parts.push(
          "Do not use any formatting, markdown, or special characters.",
        );
      }
      break;
  }

  if (schema) {
    parts.push("");
    parts.push(`Expected ${format.toUpperCase()} schema:`);
    parts.push(schema);
  }

  if (example) {
    parts.push("");
    parts.push("Example output:");
    parts.push(example);
  }

  return parts.join("\n");
}

/**
 * Format instructions for requesting output with specific constraints
 *
 * @param constraints - Output constraints
 * @returns Formatted instruction string
 */
export function formatOutputConstraints(constraints: {
  maxLength?: number;
  minLength?: number;
  noCodeBlocks?: boolean;
  noMarkdown?: boolean;
  language?: string;
  tone?: string;
}): string {
  const parts: string[] = [];

  if (constraints.maxLength) {
    parts.push(`Keep your response under ${constraints.maxLength} characters.`);
  }

  if (constraints.minLength) {
    parts.push(
      `Provide at least ${constraints.minLength} characters in your response.`,
    );
  }

  if (constraints.noCodeBlocks) {
    parts.push("Do not use code blocks or backticks.");
  }

  if (constraints.noMarkdown) {
    parts.push("Do not use Markdown formatting.");
  }

  if (constraints.language) {
    parts.push(`Respond in ${constraints.language}.`);
  }

  if (constraints.tone) {
    parts.push(`Use a ${constraints.tone} tone.`);
  }

  return parts.join("\n");
}

/**
 * Wrap output instruction in clear delimiter
 *
 * @param instruction - Instruction text
 * @returns Wrapped instruction
 */
export function wrapOutputInstruction(instruction: string): string {
  return `<output_format>\n${instruction}\n</output_format>`;
}

/**
 * Create a complete output format section for prompts
 *
 * @param format - Desired output format
 * @param options - Format options and constraints
 * @returns Complete formatted instruction block
 */
export function createOutputFormatSection(
  format: "json" | "yaml" | "xml" | "markdown" | "plain",
  options: {
    strict?: boolean;
    schema?: string;
    example?: string;
    constraints?: Parameters<typeof formatOutputConstraints>[0];
    wrap?: boolean;
  } = {},
): string {
  const { wrap = true, constraints } = options;

  const parts: string[] = [];

  // Add format instructions
  parts.push(formatStructuredOutput(format, options));

  // Add constraints if provided
  if (constraints) {
    parts.push("");
    parts.push(formatOutputConstraints(constraints));
  }

  const instruction = parts.join("\n");

  return wrap ? wrapOutputInstruction(instruction) : instruction;
}

/**
 * Extract JSON from model output that might contain extra text
 * Useful when model didn't follow strict JSON-only instructions
 *
 * @param output - Model output
 * @returns Extracted JSON string or null
 */
export function extractJsonFromOutput(output: string): string | null {
  if (!output) return null;

  // Try to find JSON in code blocks first
  const codeBlockMatch = output.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (codeBlockMatch && codeBlockMatch[1]) {
    return codeBlockMatch[1].trim();
  }

  // Try to find JSON by looking for { or [
  const jsonMatch = output.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
  if (jsonMatch && jsonMatch[1]) {
    return jsonMatch[1].trim();
  }

  return null;
}

/**
 * Clean model output by removing common wrapper text
 *
 * @param output - Model output
 * @returns Cleaned output
 */
export function cleanOutput(output: string): string {
  if (!output) return output;

  let cleaned = output.trim();

  // Remove common prefixes
  const prefixes = [
    /^here is the .+?:?\s*/i,
    /^here's the .+?:?\s*/i,
    /^sure,?\s*/i,
    /^certainly,?\s*/i,
    /^of course,?\s*/i,
  ];

  for (const prefix of prefixes) {
    cleaned = cleaned.replace(prefix, "");
  }

  // Remove markdown code block wrappers
  cleaned = cleaned.replace(/^```(?:\w+)?\s*\n?/, "");
  cleaned = cleaned.replace(/\n?```\s*$/, "");

  return cleaned.trim();
}
