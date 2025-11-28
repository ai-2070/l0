// Format memory helper for session memory formatting

import { normalizeForModel } from "../utils/normalize";

/**
 * Memory entry structure
 */
export interface MemoryEntry {
  role: "user" | "assistant" | "system";
  content: string;
  timestamp?: number;
  metadata?: Record<string, any>;
}

/**
 * Format options for memory
 */
export interface FormatMemoryOptions {
  /**
   * Maximum number of entries to include (default: all)
   */
  maxEntries?: number;

  /**
   * Whether to include timestamps (default: false)
   */
  includeTimestamps?: boolean;

  /**
   * Whether to include metadata (default: false)
   */
  includeMetadata?: boolean;

  /**
   * Format style
   */
  style?: "conversational" | "structured" | "compact";

  /**
   * Whether to normalize content (default: true)
   */
  normalize?: boolean;
}

/**
 * Format session memory in a clean, model-friendly way
 *
 * @param memory - Array of memory entries or conversation history
 * @param options - Formatting options
 * @returns Formatted memory string
 *
 * @example
 * ```typescript
 * const memory = formatMemory([
 *   { role: "user", content: "Hello" },
 *   { role: "assistant", content: "Hi there!" }
 * ]);
 * ```
 */
export function formatMemory(
  memory: MemoryEntry[] | string,
  options: FormatMemoryOptions = {},
): string {
  // Handle string input
  if (typeof memory === "string") {
    return formatMemoryString(memory, options);
  }

  // Handle empty memory
  if (!memory || memory.length === 0) {
    return "";
  }

  const {
    maxEntries,
    includeTimestamps = false,
    includeMetadata = false,
    style = "conversational",
    normalize = true,
  } = options;

  // Limit entries if maxEntries is specified
  const entries = maxEntries ? memory.slice(-maxEntries) : memory;

  // Format based on style
  switch (style) {
    case "conversational":
      return formatConversationalMemory(
        entries,
        includeTimestamps,
        includeMetadata,
        normalize,
      );
    case "structured":
      return formatStructuredMemory(
        entries,
        includeTimestamps,
        includeMetadata,
        normalize,
      );
    case "compact":
      return formatCompactMemory(entries, normalize);
    default:
      return formatConversationalMemory(
        entries,
        includeTimestamps,
        includeMetadata,
        normalize,
      );
  }
}

/**
 * Format memory as conversational dialogue
 */
function formatConversationalMemory(
  entries: MemoryEntry[],
  includeTimestamps: boolean,
  includeMetadata: boolean,
  normalize: boolean,
): string {
  const lines: string[] = [];

  for (const entry of entries) {
    const content = normalize
      ? normalizeForModel(entry.content)
      : entry.content;

    // Role label
    const roleLabel = getRoleLabel(entry.role);
    let line = `${roleLabel}: ${content}`;

    // Add timestamp if requested
    if (includeTimestamps && entry.timestamp) {
      const date = new Date(entry.timestamp);
      line = `[${date.toISOString()}] ${line}`;
    }

    // Add metadata if requested
    if (includeMetadata && entry.metadata) {
      const meta = Object.entries(entry.metadata)
        .map(([k, v]) => `${k}=${v}`)
        .join(", ");
      if (meta) {
        line += ` (${meta})`;
      }
    }

    lines.push(line);
  }

  return lines.join("\n\n");
}

/**
 * Format memory as structured XML/tags
 */
function formatStructuredMemory(
  entries: MemoryEntry[],
  includeTimestamps: boolean,
  includeMetadata: boolean,
  normalize: boolean,
): string {
  const lines: string[] = ["<conversation_history>"];

  for (const entry of entries) {
    const content = normalize
      ? normalizeForModel(entry.content)
      : entry.content;

    let attrs = `role="${entry.role}"`;

    if (includeTimestamps && entry.timestamp) {
      attrs += ` timestamp="${entry.timestamp}"`;
    }

    if (includeMetadata && entry.metadata) {
      const metaStr = JSON.stringify(entry.metadata);
      attrs += ` metadata='${metaStr}'`;
    }

    lines.push(`  <message ${attrs}>`);
    lines.push(`    ${content}`);
    lines.push(`  </message>`);
  }

  lines.push("</conversation_history>");
  return lines.join("\n");
}

/**
 * Format memory in compact format (minimal spacing)
 */
function formatCompactMemory(
  entries: MemoryEntry[],
  normalize: boolean,
): string {
  return entries
    .map((entry) => {
      const content = normalize
        ? normalizeForModel(entry.content)
        : entry.content;
      const role = entry.role[0].toUpperCase(); // U/A/S
      return `${role}: ${content}`;
    })
    .join("\n");
}

/**
 * Format memory string with options
 */
function formatMemoryString(
  memory: string,
  options: FormatMemoryOptions,
): string {
  const { normalize = true } = options;

  if (normalize) {
    return normalizeForModel(memory);
  }

  return memory;
}

/**
 * Get human-readable role label
 */
function getRoleLabel(role: string): string {
  switch (role) {
    case "user":
      return "User";
    case "assistant":
      return "Assistant";
    case "system":
      return "System";
    default:
      return role.charAt(0).toUpperCase() + role.slice(1);
  }
}

/**
 * Create memory entry
 */
export function createMemoryEntry(
  role: "user" | "assistant" | "system",
  content: string,
  metadata?: Record<string, any>,
): MemoryEntry {
  return {
    role,
    content,
    timestamp: Date.now(),
    metadata,
  };
}

/**
 * Merge multiple memory arrays
 */
export function mergeMemory(...memories: MemoryEntry[][]): MemoryEntry[] {
  return memories.flat().sort((a, b) => {
    const timeA = a.timestamp || 0;
    const timeB = b.timestamp || 0;
    return timeA - timeB;
  });
}

/**
 * Filter memory by role
 */
export function filterMemoryByRole(
  memory: MemoryEntry[],
  role: "user" | "assistant" | "system",
): MemoryEntry[] {
  return memory.filter((entry) => entry.role === role);
}

/**
 * Get last N entries from memory
 */
export function getLastNEntries(
  memory: MemoryEntry[],
  n: number,
): MemoryEntry[] {
  return memory.slice(-n);
}

/**
 * Calculate memory size (approximate character count)
 */
export function calculateMemorySize(memory: MemoryEntry[]): number {
  return memory.reduce((sum, entry) => sum + entry.content.length, 0);
}

/**
 * Truncate memory to fit within size limit
 */
export function truncateMemory(
  memory: MemoryEntry[],
  maxSize: number,
): MemoryEntry[] {
  const result: MemoryEntry[] = [];
  let currentSize = 0;

  // Start from most recent
  for (let i = memory.length - 1; i >= 0; i--) {
    const entry = memory[i];
    const entrySize = entry.content.length;

    if (currentSize + entrySize <= maxSize) {
      result.unshift(entry);
      currentSize += entrySize;
    } else {
      break;
    }
  }

  return result;
}
