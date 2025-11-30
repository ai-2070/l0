// Helper utilities for L0 runtime

import type { L0Result } from "../types/l0";

/**
 * Helper to consume stream and get final text
 *
 * @param result - The L0Result containing the stream to consume
 * @returns The final accumulated content
 */
export async function getText(result: L0Result): Promise<string> {
  for await (const _event of result.stream) {
    // Just consume the stream
  }
  return result.state.content;
}

/**
 * Helper to consume stream with callback
 *
 * @param result - The L0Result containing the stream to consume
 * @param onToken - Callback invoked for each token
 * @returns The final accumulated content
 */
export async function consumeStream(
  result: L0Result,
  onToken: (token: string) => void,
): Promise<string> {
  for await (const event of result.stream) {
    if (event.type === "token" && event.value) {
      onToken(event.value);
    }
  }
  return result.state.content;
}
