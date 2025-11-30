// Callback utilities for L0 runtime

import type { L0Monitor } from "./monitor";

/**
 * Safely invoke a user callback, catching and logging any errors
 * This prevents callback errors from crashing the stream
 *
 * @param callback - The callback function to invoke
 * @param arg - The argument to pass to the callback
 * @param monitor - The L0 monitor for logging warnings
 * @param callbackName - Name of the callback for error messages
 */
export function safeInvokeCallback<T>(
  callback: ((arg: T) => void) | undefined,
  arg: T,
  monitor: L0Monitor,
  callbackName: string = "callback",
): void {
  if (!callback) return;
  try {
    callback(arg);
  } catch (error) {
    monitor.logEvent({
      type: "warning",
      message: `${callbackName} threw: ${error instanceof Error ? error.message : String(error)}`,
    });
  }
}
