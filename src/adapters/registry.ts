// L0 Adapter Registry
// Manages registration and auto-detection of stream adapters

import type { L0Adapter } from "../types/l0";

/**
 * Internal registry of adapters.
 * Adapters are checked in registration order for auto-detection.
 */
const registeredAdapters: L0Adapter[] = [];

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
  options: { silent?: boolean } = {},
): void {
  if (!adapter.detect) {
    if (
      !options.silent &&
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
  if (registeredAdapters.some((a) => a.name === adapter.name)) {
    throw new Error(`Adapter "${adapter.name}" is already registered`);
  }
  registeredAdapters.push(adapter);
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
  const index = registeredAdapters.findIndex((a) => a.name === name);
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
  return registeredAdapters.find((a) => a.name === name);
}

/**
 * Get all registered stream adapter names.
 *
 * @returns Array of registered adapter names
 */
export function getRegisteredStreamAdapters(): string[] {
  return registeredAdapters.map((a) => a.name);
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
    .filter((a) => !exceptSet.has(a.name))
    .map((a) => a.name);

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
  const detectableAdapters = registeredAdapters.filter((a) => a.detect);
  const matches = detectableAdapters.filter((a) => a.detect!(input));

  if (matches.length === 0) {
    const registered = getRegisteredStreamAdapters();
    const detectable = detectableAdapters.map((a) => a.name);
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

  if (matches.length > 1) {
    throw new Error(
      `Multiple adapters detected for stream: [${matches.map((a) => a.name).join(", ")}]. ` +
        `Use explicit \`adapter: myAdapter\` to disambiguate.`,
    );
  }

  return matches[0]!;
}

/**
 * Check if an input matches any registered adapter.
 *
 * Unlike detectAdapter(), this does not throw on zero or multiple matches.
 * Only considers adapters that have detect() implemented.
 *
 * @param input - The stream to check
 * @returns True if exactly one adapter matches
 */
export function hasMatchingAdapter(input: unknown): boolean {
  const detectableAdapters = registeredAdapters.filter((a) => a.detect);
  const matches = detectableAdapters.filter((a) => a.detect!(input));
  return matches.length === 1;
}
