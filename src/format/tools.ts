// Format tool/function call definitions for LLM consumption

import { normalizeForModel } from "../utils/normalize";

/**
 * Tool parameter definition
 */
export interface ToolParameter {
  name: string;
  type: string;
  description?: string;
  required?: boolean;
  enum?: string[];
  default?: any;
}

/**
 * Tool definition structure
 */
export interface ToolDefinition {
  name: string;
  description: string;
  parameters: ToolParameter[];
}

/**
 * Options for formatting tool definitions
 */
export interface FormatToolOptions {
  /**
   * Format style for tool definitions
   */
  style?: "json-schema" | "typescript" | "natural" | "xml";

  /**
   * Whether to include examples
   */
  includeExamples?: boolean;

  /**
   * Whether to normalize whitespace
   */
  normalize?: boolean;

  /**
   * Whether to include parameter types
   */
  includeTypes?: boolean;
}

/**
 * Format tool/function call definition in a model-friendly way
 * Provides stable tool-call definitions with valid JSON schema
 *
 * @param tool - Tool definition
 * @param options - Formatting options
 * @returns Formatted tool definition string
 *
 * @example
 * ```typescript
 * const tool = formatTool({
 *   name: "get_weather",
 *   description: "Get weather for a location",
 *   parameters: [
 *     { name: "location", type: "string", required: true }
 *   ]
 * });
 * ```
 */
export function formatTool(
  tool: ToolDefinition,
  options: FormatToolOptions = {},
): string {
  const {
    style = "json-schema",
    includeExamples = false,
    normalize = true,
    includeTypes = true,
  } = options;

  switch (style) {
    case "json-schema":
      return formatToolJsonSchema(tool, includeTypes);
    case "typescript":
      return formatToolTypeScript(tool);
    case "natural":
      return formatToolNatural(tool, includeExamples);
    case "xml":
      return formatToolXml(tool);
    default:
      return formatToolJsonSchema(tool, includeTypes);
  }
}

/**
 * Format tool as JSON Schema (OpenAI function calling format)
 */
function formatToolJsonSchema(
  tool: ToolDefinition,
  includeTypes: boolean,
): string {
  const properties: Record<string, any> = {};
  const required: string[] = [];

  for (const param of tool.parameters) {
    properties[param.name] = {
      type: param.type,
      description: param.description || "",
    };

    if (param.enum) {
      properties[param.name].enum = param.enum;
    }

    if (param.default !== undefined) {
      properties[param.name].default = param.default;
    }

    if (param.required) {
      required.push(param.name);
    }
  }

  const schema = {
    name: tool.name,
    description: tool.description,
    parameters: {
      type: "object",
      properties,
      required: required.length > 0 ? required : undefined,
    },
  };

  return JSON.stringify(schema, null, 2);
}

/**
 * Format tool as TypeScript function signature
 */
function formatToolTypeScript(tool: ToolDefinition): string {
  const params = tool.parameters
    .map((p) => {
      const optional = p.required ? "" : "?";
      const type = p.type === "integer" ? "number" : p.type;
      return `${p.name}${optional}: ${type}`;
    })
    .join(", ");

  let result = `/**\n * ${tool.description}\n`;

  for (const param of tool.parameters) {
    result += ` * @param ${param.name}`;
    if (param.description) {
      result += ` - ${param.description}`;
    }
    result += "\n";
  }

  result += ` */\nfunction ${tool.name}(${params}): void;`;

  return result;
}

/**
 * Format tool as natural language description
 */
function formatToolNatural(
  tool: ToolDefinition,
  includeExamples: boolean,
): string {
  const lines: string[] = [];

  lines.push(`Tool: ${tool.name}`);
  lines.push(`Description: ${tool.description}`);
  lines.push("");
  lines.push("Parameters:");

  for (const param of tool.parameters) {
    const required = param.required ? "(required)" : "(optional)";
    let line = `  - ${param.name} ${required}: ${param.type}`;

    if (param.description) {
      line += ` - ${param.description}`;
    }

    if (param.enum) {
      line += ` [Options: ${param.enum.join(", ")}]`;
    }

    if (param.default !== undefined) {
      line += ` [Default: ${param.default}]`;
    }

    lines.push(line);
  }

  if (includeExamples) {
    lines.push("");
    lines.push("Example usage:");
    const exampleArgs = tool.parameters
      .filter((p) => p.required)
      .map((p) => {
        const value = p.enum ? `"${p.enum[0]}"` : getExampleValue(p.type);
        return `"${p.name}": ${value}`;
      })
      .join(", ");
    lines.push(`  ${tool.name}({ ${exampleArgs} })`);
  }

  return lines.join("\n");
}

/**
 * Format tool as XML structure
 */
function formatToolXml(tool: ToolDefinition): string {
  const lines: string[] = [];

  lines.push(`<tool name="${tool.name}">`);
  lines.push(`  <description>${escapeXml(tool.description)}</description>`);
  lines.push(`  <parameters>`);

  for (const param of tool.parameters) {
    const attrs: string[] = [
      `name="${param.name}"`,
      `type="${param.type}"`,
      param.required ? 'required="true"' : 'required="false"',
    ];

    if (param.default !== undefined) {
      attrs.push(`default="${param.default}"`);
    }

    lines.push(`    <parameter ${attrs.join(" ")}>`);

    if (param.description) {
      lines.push(
        `      <description>${escapeXml(param.description)}</description>`,
      );
    }

    if (param.enum) {
      lines.push(`      <enum>${param.enum.join(", ")}</enum>`);
    }

    lines.push(`    </parameter>`);
  }

  lines.push(`  </parameters>`);
  lines.push(`</tool>`);

  return lines.join("\n");
}

/**
 * Format multiple tools
 *
 * @param tools - Array of tool definitions
 * @param options - Formatting options
 * @returns Formatted tools string
 */
export function formatTools(
  tools: ToolDefinition[],
  options: FormatToolOptions = {},
): string {
  const { style = "json-schema" } = options;

  if (style === "json-schema") {
    // For JSON schema, wrap in array
    return JSON.stringify(
      tools.map((tool) => JSON.parse(formatToolJsonSchema(tool, true))),
      null,
      2,
    );
  }

  // For other formats, join with separators
  return tools
    .map((tool) => formatTool(tool, options))
    .join("\n\n" + "=".repeat(50) + "\n\n");
}

/**
 * Create a tool definition from a simple object
 *
 * @param name - Tool name
 * @param description - Tool description
 * @param parameters - Parameter definitions
 * @returns Tool definition
 */
export function createTool(
  name: string,
  description: string,
  parameters: ToolParameter[],
): ToolDefinition {
  return {
    name,
    description,
    parameters,
  };
}

/**
 * Create a parameter definition
 *
 * @param name - Parameter name
 * @param type - Parameter type
 * @param description - Parameter description
 * @param required - Whether parameter is required
 * @returns Parameter definition
 */
export function createParameter(
  name: string,
  type: string,
  description?: string,
  required: boolean = false,
): ToolParameter {
  return {
    name,
    type,
    description,
    required,
  };
}

/**
 * Validate tool definition
 *
 * @param tool - Tool to validate
 * @returns Validation errors (empty if valid)
 */
export function validateTool(tool: ToolDefinition): string[] {
  const errors: string[] = [];

  if (!tool.name || tool.name.trim().length === 0) {
    errors.push("Tool name is required");
  }

  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(tool.name)) {
    errors.push("Tool name must be a valid identifier");
  }

  if (!tool.description || tool.description.trim().length === 0) {
    errors.push("Tool description is required");
  }

  if (!tool.parameters || !Array.isArray(tool.parameters)) {
    errors.push("Tool parameters must be an array");
  } else {
    for (let i = 0; i < tool.parameters.length; i++) {
      const param = tool.parameters[i];

      if (!param.name || param.name.trim().length === 0) {
        errors.push(`Parameter ${i} is missing a name`);
      }

      if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(param.name)) {
        errors.push(`Parameter ${param.name} must be a valid identifier`);
      }

      if (!param.type) {
        errors.push(`Parameter ${param.name} is missing a type`);
      }

      const validTypes = [
        "string",
        "number",
        "integer",
        "boolean",
        "array",
        "object",
      ];
      if (!validTypes.includes(param.type)) {
        errors.push(`Parameter ${param.name} has invalid type: ${param.type}`);
      }
    }
  }

  return errors;
}

/**
 * Get example value for a type
 */
function getExampleValue(type: string): string {
  switch (type) {
    case "string":
      return '"example"';
    case "number":
    case "integer":
      return "42";
    case "boolean":
      return "true";
    case "array":
      return "[]";
    case "object":
      return "{}";
    default:
      return '""';
  }
}

/**
 * Escape XML special characters
 */
function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * Format function call arguments for validation
 *
 * @param args - Function arguments object
 * @param pretty - Whether to pretty-print
 * @returns Formatted arguments string
 */
export function formatFunctionArguments(
  args: Record<string, any>,
  pretty: boolean = false,
): string {
  return JSON.stringify(args, null, pretty ? 2 : 0);
}

/**
 * Parse function call from model output
 *
 * @param output - Model output containing function call
 * @returns Parsed function call or null
 */
export function parseFunctionCall(output: string): {
  name: string;
  arguments: Record<string, any>;
} | null {
  // Try to match function call patterns
  const patterns = [
    // JSON format: {"name": "func", "arguments": {...}}
    /\{\s*"name"\s*:\s*"([^"]+)"\s*,\s*"arguments"\s*:\s*(\{[^}]*\})\s*\}/,
    // Function call format: func_name({...})
    /([a-zA-Z_][a-zA-Z0-9_]*)\s*\(\s*(\{[^}]*\})\s*\)/,
  ];

  for (const pattern of patterns) {
    const match = output.match(pattern);
    if (match) {
      try {
        const name = match[1];
        const args = JSON.parse(match[2]);
        return { name, arguments: args };
      } catch {
        continue;
      }
    }
  }

  return null;
}
