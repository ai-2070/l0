// L0 Adapter Registry
// Manages registration and auto-detection of stream adapters

import type { L0Adapter } from "../types/l0";

/**
 * Internal adapter entry with priority.
 * Higher priority adapters are checked first during detection.
 */
interface AdapterEntry {
  adapter: L0Adapter;
  priority: number;
}

/**
 * Internal registry of adapters.
 * Adapters are sorted by priority (higher first) for auto-detection.
 */
const registeredAdapters: AdapterEntry[] = [];

/**
 * Default priority for adapters.
 * Built-in adapters use 0, specialized adapters should use higher values.
 */
export const DEFAULT_ADAPTER_PRIORITY = 0;

/**
 * Register an adapter for auto-detection.
 *
 * The adapter MUST implement detect() to be registered for auto-detection.
 * If you don't need auto-detection, use explicit `adapter: myAdapter` instead.
 *
 * @param adapter - The adapter to register
 * @param options - Registration options
 * @throws If adapter with same name is already registered
 *
 * @example
 * ```typescript
 * const myAdapter: L0Adapter<MyStream> = {
 *   name: "myai",
 *   detect(input): input is MyStream {
 *     return input && typeof input === "object" && "myMarker" in input;
 *   },
 *   async *wrap(stream) {
 *     // ...
 *   },
 * };
 *
 * registerAdapter(myAdapter);
 * ```
 */
export function registerAdapter(
  adapter: L0Adapter,
  options: { silent?: boolean; priority?: number } = {},
): void {
  const { silent = false, priority = DEFAULT_ADAPTER_PRIORITY } = options;

  if (!adapter.detect) {
    if (
      !silent &&
      typeof process !== "undefined" &&
      process.env?.NODE_ENV !== "production"
    ) {
      console.warn(
        `⚠️  Adapter "${adapter.name}" has no detect() method.\n` +
          `   It will not be used for auto-detection.\n` +
          `   Use explicit \`adapter: myAdapter\` instead, or add a detect() method.`,
      );
    }
  }
  if (registeredAdapters.some((entry) => entry.adapter.name === adapter.name)) {
    throw new Error(`Adapter "${adapter.name}" is already registered`);
  }

  // Insert in priority order (higher priority first)
  const entry: AdapterEntry = { adapter, priority };
  const insertIndex = registeredAdapters.findIndex(
    (e) => e.priority < priority,
  );
  if (insertIndex === -1) {
    registeredAdapters.push(entry);
  } else {
    registeredAdapters.splice(insertIndex, 0, entry);
  }
}

/**
 * Unregister an adapter by name.
 *
 * @param name - The adapter name to unregister
 * @returns True if adapter was found and removed, false otherwise
 *
 * @example
 * ```typescript
 * // Clean up in tests
 * afterEach(() => {
 *   unregisterAdapter("myai");
 * });
 * ```
 */
export function unregisterAdapter(name: string): boolean {
  const index = registeredAdapters.findIndex(
    (entry) => entry.adapter.name === name,
  );
  if (index === -1) return false;
  registeredAdapters.splice(index, 1);
  return true;
}

/**
 * Get a registered adapter by name.
 *
 * @param name - The adapter name to look up
 * @returns The adapter if found, undefined otherwise
 */
export function getAdapter(name: string): L0Adapter | undefined {
  const entry = registeredAdapters.find((e) => e.adapter.name === name);
  return entry?.adapter;
}

/**
 * Get all registered stream adapter names.
 *
 * @returns Array of registered adapter names
 */
export function getRegisteredStreamAdapters(): string[] {
  return registeredAdapters.map((entry) => entry.adapter.name);
}

/**
 * Clear all registered adapters.
 * Primarily useful for testing.
 */
export function clearAdapters(): void {
  registeredAdapters.length = 0;
}

/**
 * Unregister all adapters except those specified.
 *
 * Useful for testing when you want to isolate a specific adapter
 * without interference from others.
 *
 * @param except - Array of adapter names to keep registered
 * @returns Array of adapter names that were unregistered
 *
 * @example
 * ```typescript
 * // Keep only vercel-ai adapter, unregister all others
 * const removed = unregisterAllExcept(["vercel-ai"]);
 * console.log(removed); // ["openai", "anthropic", "mastra"]
 * ```
 */
export function unregisterAllExcept(except: string[] = []): string[] {
  const exceptSet = new Set(except);
  const toRemove = registeredAdapters
    .filter((entry) => !exceptSet.has(entry.adapter.name))
    .map((entry) => entry.adapter.name);

  for (const name of toRemove) {
    unregisterAdapter(name);
  }

  return toRemove;
}

/**
 * Auto-detect the appropriate adapter for a stream.
 *
 * Iterates through registered adapters in registration order.
 * Throws if zero or multiple adapters match.
 *
 * @param input - The stream to detect an adapter for
 * @returns The matching adapter
 * @throws If no adapter matches
 * @throws If multiple adapters match (ambiguous)
 *
 * @example
 * ```typescript
 * const adapter = detectAdapter(streamResult);
 * const events = adapter.wrap(streamResult);
 * ```
 */
export function detectAdapter(input: unknown): L0Adapter {
  // Only consider adapters that have detect() implemented
  // Adapters are already sorted by priority (higher first)
  const detectableAdapters = registeredAdapters.filter(
    (entry) => entry.adapter.detect,
  );
  const matches = detectableAdapters.filter((entry) =>
    entry.adapter.detect!(input),
  );

  if (matches.length === 0) {
    const registered = getRegisteredStreamAdapters();
    const detectable = detectableAdapters.map((entry) => entry.adapter.name);
    const adapterList =
      detectable.length > 0 ? `[${detectable.join(", ")}]` : "(none)";
    const hint =
      registered.length > detectable.length
        ? ` (${registered.length - detectable.length} adapter(s) without detect() were skipped)`
        : "";
    throw new Error(
      `No registered adapter detected for stream. ` +
        `Detectable adapters: ${adapterList}${hint}. ` +
        `Use explicit \`adapter: myAdapter\` or register an adapter with detect().`,
    );
  }

  // Return the highest priority match (first in the sorted list)
  // If multiple adapters match, use the one with highest priority
  return matches[0]!.adapter;
}

/**
 * Check if an input matches any registered adapter.
 *
 * Unlike detectAdapter(), this is a simple boolean check.
 * Only considers adapters that have detect() implemented.
 *
 * @param input - The stream to check
 * @returns True if at least one adapter matches
 */
export function hasMatchingAdapter(input: unknown): boolean {
  const detectableAdapters = registeredAdapters.filter(
    (entry) => entry.adapter.detect,
  );
  const matches = detectableAdapters.filter((entry) =>
    entry.adapter.detect!(input),
  );
  return matches.length >= 1;
}
