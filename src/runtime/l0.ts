// Main L0 runtime wrapper - streaming, guardrails, retry, and reliability layer

import type { L0Options, L0Result, L0State, L0Event } from "../types/l0";
import type { GuardrailContext } from "../types/guardrails";
import { GuardrailEngine } from "../guardrails/engine";
import { RetryManager } from "./retry";
import { DriftDetector } from "./drift";
import { detectZeroToken } from "./zeroToken";
import { normalizeStreamEvent } from "./events";
import { hasMeaningfulContent } from "../utils/tokens";

/**
 * Main L0 wrapper function
 * Provides streaming runtime with guardrails, drift detection, retry logic,
 * and network protections
 *
 * @param options - L0 configuration options
 * @returns L0 result with streaming interface
 *
 * @example
 * ```typescript
 * const result = await l0({
 *   stream: () => streamText({ model, prompt }),
 *   guardrails: [jsonRule(), markdownRule()],
 *   retry: { attempts: 2, backoff: "exponential" }
 * });
 *
 * for await (const event of result.stream) {
 *   console.log(event);
 * }
 * ```
 */
export async function l0(options: L0Options): Promise<L0Result> {
  const {
    stream: streamFactory,
    guardrails = [],
    retry = {},
    timeout = {},
    signal,
    detectDrift: enableDrift = false,
    detectZeroTokens = true,
    onEvent,
    onViolation,
    onRetry,
  } = options;

  // Initialize state
  const state: L0State = createInitialState();
  const errors: Error[] = [];

  // Initialize engines
  const guardrailEngine =
    guardrails.length > 0
      ? new GuardrailEngine({
          rules: guardrails,
          stopOnFatal: true,
          enableStreaming: true,
          onViolation,
        })
      : null;

  const retryManager = new RetryManager({
    maxAttempts: retry.attempts ?? 2,
    baseDelay: retry.baseDelay ?? 1000,
    maxDelay: retry.maxDelay ?? 10000,
    backoff: retry.backoff ?? "exponential",
    retryOn: retry.retryOn ?? [
      "zero_output",
      "guardrail_violation",
      "drift",
      "network_error",
      "timeout",
      "rate_limit",
    ],
  });

  const driftDetector = enableDrift ? new DriftDetector() : null;

  // Create async generator for streaming
  const streamGenerator = async function* (): AsyncGenerator<L0Event> {
    let retryAttempt = 0;
    const maxRetries = retry.attempts ?? 2;

    while (retryAttempt <= maxRetries) {
      try {
        // Reset state for retry
        if (retryAttempt > 0) {
          state.content = "";
          state.tokenCount = 0;
          state.violations = [];
          state.driftDetected = false;
        }

        // Get stream from factory
        const streamResult = await streamFactory();

        // Handle different stream result types
        let sourceStream: AsyncIterable<any>;
        if (streamResult.textStream) {
          sourceStream = streamResult.textStream;
        } else if (streamResult.fullStream) {
          sourceStream = streamResult.fullStream;
        } else if (Symbol.asyncIterator in streamResult) {
          sourceStream = streamResult;
        } else {
          throw new Error("Invalid stream result - no iterable stream found");
        }

        // Track timing
        const startTime = Date.now();
        state.firstTokenAt = undefined;
        state.lastTokenAt = undefined;

        let firstTokenReceived = false;
        let lastTokenTime = startTime;

        // Initial token timeout
        const initialTimeout = timeout.initialToken ?? 2000;
        let initialTimeoutId: NodeJS.Timeout | null = null;
        let initialTimeoutReached = false;

        if (!signal?.aborted) {
          initialTimeoutId = setTimeout(() => {
            initialTimeoutReached = true;
          }, initialTimeout);
        }

        // Stream processing
        for await (const chunk of sourceStream) {
          // Check abort signal
          if (signal?.aborted) {
            throw new Error("Stream aborted by signal");
          }

          // Clear initial timeout on first chunk
          if (initialTimeoutId && !firstTokenReceived) {
            clearTimeout(initialTimeoutId);
            initialTimeoutId = null;
            initialTimeoutReached = false;
          }

          // Check initial timeout
          if (initialTimeoutReached && !firstTokenReceived) {
            throw new Error("Initial token timeout reached");
          }

          // Normalize event
          const event = normalizeStreamEvent(chunk);

          if (event.type === "token" && event.value) {
            const token = event.value;

            // Track first token
            if (!firstTokenReceived) {
              firstTokenReceived = true;
              state.firstTokenAt = Date.now();
            }

            // Update state
            state.content += token;
            state.tokenCount++;
            state.lastTokenAt = Date.now();
            lastTokenTime = state.lastTokenAt;

            // Check inter-token timeout
            const interTimeout = timeout.interToken ?? 5000;
            const timeSinceLastToken = Date.now() - lastTokenTime;
            if (timeSinceLastToken > interTimeout) {
              throw new Error("Inter-token timeout reached");
            }

            // Update checkpoint periodically
            if (state.tokenCount % 10 === 0) {
              state.checkpoint = state.content;
            }

            // Run streaming guardrails
            if (guardrailEngine && state.tokenCount % 5 === 0) {
              const context: GuardrailContext = {
                content: state.content,
                checkpoint: state.checkpoint,
                delta: token,
                tokenCount: state.tokenCount,
                isComplete: false,
              };

              const result = guardrailEngine.check(context);
              if (result.violations.length > 0) {
                state.violations.push(...result.violations);
              }

              // Check for fatal violations
              if (result.shouldHalt) {
                throw new Error(
                  `Fatal guardrail violation: ${result.violations[0]?.message}`,
                );
              }
            }

            // Check drift
            if (driftDetector && state.tokenCount % 10 === 0) {
              const drift = driftDetector.check(state.content, token);
              if (drift.detected) {
                state.driftDetected = true;
              }
            }

            // Emit event
            const l0Event: L0Event = {
              type: "token",
              value: token,
              timestamp: Date.now(),
            };

            if (onEvent) onEvent(l0Event);
            yield l0Event;
          } else if (event.type === "error") {
            throw event.error || new Error("Stream error");
          } else if (event.type === "done") {
            break;
          }
        }

        // Clear any remaining timeout
        if (initialTimeoutId) {
          clearTimeout(initialTimeoutId);
        }

        // Check for zero output
        if (detectZeroTokens && detectZeroToken(state.content)) {
          throw new Error("Zero output detected - no meaningful content");
        }

        // Run final guardrails
        if (guardrailEngine) {
          const context: GuardrailContext = {
            content: state.content,
            checkpoint: state.checkpoint,
            tokenCount: state.tokenCount,
            isComplete: true,
          };

          const result = guardrailEngine.check(context);
          if (result.violations.length > 0) {
            state.violations.push(...result.violations);
          }

          // Check if should retry
          if (result.shouldRetry && retryAttempt < maxRetries) {
            const violation = result.violations[0];
            if (onRetry) {
              onRetry(
                retryAttempt + 1,
                `Guardrail violation: ${violation?.message}`,
              );
            }
            retryAttempt++;
            state.retryAttempts++;
            continue;
          }

          // Fatal violations
          if (result.shouldHalt) {
            throw new Error(
              `Fatal guardrail violation: ${result.violations[0]?.message}`,
            );
          }
        }

        // Check drift
        if (driftDetector) {
          const finalDrift = driftDetector.check(state.content);
          if (finalDrift.detected && retryAttempt < maxRetries) {
            state.driftDetected = true;
            if (onRetry) {
              onRetry(retryAttempt + 1, "Drift detected");
            }
            retryAttempt++;
            state.retryAttempts++;
            continue;
          }
        }

        // Success - mark as completed
        state.completed = true;

        // Emit done event
        const doneEvent: L0Event = {
          type: "done",
          timestamp: Date.now(),
        };
        if (onEvent) onEvent(doneEvent);
        yield doneEvent;

        break; // Exit retry loop on success
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        errors.push(err);

        // Categorize error
        const categorized = retryManager.categorizeError(err);
        const decision = retryManager.shouldRetry(err);

        // Check if should retry
        if (decision.shouldRetry) {
          if (decision.countsTowardLimit) {
            retryAttempt++;
            state.retryAttempts++;
          } else {
            state.networkRetries++;
          }

          if (onRetry) {
            onRetry(retryAttempt, decision.reason);
          }

          // Record retry and wait
          await retryManager.recordRetry(categorized, decision);
          continue;
        }

        // Not retryable - emit error and throw
        const errorEvent: L0Event = {
          type: "error",
          error: err,
          timestamp: Date.now(),
        };
        if (onEvent) onEvent(errorEvent);
        yield errorEvent;

        throw err;
      }
    }

    // If we exhausted retries
    if (!state.completed) {
      const exhaustedError = new Error(
        `Maximum retry attempts (${maxRetries}) reached`,
      );
      errors.push(exhaustedError);

      const errorEvent: L0Event = {
        type: "error",
        error: exhaustedError,
        timestamp: Date.now(),
      };
      if (onEvent) onEvent(errorEvent);
      yield errorEvent;

      throw exhaustedError;
    }
  };

  // Return L0 result
  return {
    stream: streamGenerator(),
    state,
    errors,
  };
}

/**
 * Create initial L0 state
 */
function createInitialState(): L0State {
  return {
    content: "",
    checkpoint: "",
    tokenCount: 0,
    retryAttempts: 0,
    networkRetries: 0,
    violations: [],
    driftDetected: false,
    completed: false,
  };
}

/**
 * Helper to consume stream and get final text
 */
export async function getText(result: L0Result): Promise<string> {
  for await (const event of result.stream) {
    // Just consume the stream
  }
  return result.state.content;
}

/**
 * Helper to consume stream with callback
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
