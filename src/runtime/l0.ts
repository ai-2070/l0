// Main L0 runtime wrapper - streaming, guardrails, retry, and reliability layer

import type {
  L0Options,
  L0Result,
  L0State,
  L0Event,
  CheckpointValidationResult,
} from "../types/l0";
import type { GuardrailContext } from "../types/guardrails";
import { GuardrailEngine } from "../guardrails/engine";
import { RetryManager } from "./retry";
import { DriftDetector } from "./drift";
import { detectZeroToken } from "./zeroToken";
import { normalizeStreamEvent } from "./events";
// hasMeaningfulContent available for future use
// import { hasMeaningfulContent } from "../utils/tokens";
import { L0Monitor } from "./monitoring";
import { isNetworkError, L0Error } from "../utils/errors";
import { InterceptorManager } from "./interceptors";

/**
 * Validate checkpoint content before using for continuation
 * This ensures all protections apply to the resumed content
 */
function validateCheckpointForContinuation(
  checkpointContent: string,
  guardrailEngine: GuardrailEngine | null,
  driftDetector: DriftDetector | null,
): CheckpointValidationResult {
  const result: CheckpointValidationResult = {
    skipContinuation: false,
    violations: [],
    driftDetected: false,
    driftTypes: [],
  };

  // Run guardrails on checkpoint content
  if (guardrailEngine) {
    const checkpointContext: GuardrailContext = {
      content: checkpointContent,
      checkpoint: "",
      delta: checkpointContent,
      tokenCount: 1,
      completed: false,
    };
    const checkpointResult = guardrailEngine.check(checkpointContext);
    if (checkpointResult.violations.length > 0) {
      result.violations = checkpointResult.violations;
      // Check for fatal violations - if any, skip continuation
      const hasFatal = checkpointResult.violations.some(
        (v) => v.severity === "fatal",
      );
      if (hasFatal) {
        result.skipContinuation = true;
      }
    }
  }

  // Run drift detection on checkpoint content (only if not already skipping)
  if (!result.skipContinuation && driftDetector) {
    const driftResult = driftDetector.check(checkpointContent);
    if (driftResult.detected) {
      result.driftDetected = true;
      result.driftTypes = driftResult.types;
    }
  }

  return result;
}

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
  const { signal: externalSignal, interceptors = [] } = options;

  // Initialize interceptor manager
  const interceptorManager = new InterceptorManager(interceptors);

  // Execute "before" interceptors
  let processedOptions = options;
  try {
    processedOptions = await interceptorManager.executeBefore(options);
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    await interceptorManager.executeError(err, options);
    throw err;
  }

  // Use processed options for the rest of execution
  const {
    stream: processedStream,
    fallbackStreams: processedFallbackStreams = [],
    guardrails: processedGuardrails = [],
    retry: processedRetry = {},
    timeout: processedTimeout = {},
    signal: processedSignal,
    monitoring: processedMonitoring,
    detectDrift: processedDetectDrift = false,
    detectZeroTokens: processedDetectZeroTokens = true,
    checkIntervals: processedCheckIntervals = {},
    onEvent: processedOnEvent,
    onViolation: processedOnViolation,
    onRetry: processedOnRetry,
    continueFromLastKnownGoodToken: processedContinueFromCheckpoint = false,
    buildContinuationPrompt: processedBuildContinuationPrompt,
  } = processedOptions;

  // Configure check intervals with defaults
  const guardrailCheckInterval = processedCheckIntervals.guardrails ?? 5;
  const driftCheckInterval = processedCheckIntervals.drift ?? 10;
  const checkpointInterval = processedCheckIntervals.checkpoint ?? 10;

  // Initialize state
  const state: L0State = createInitialState();
  const errors: Error[] = [];

  // Initialize built-in abort controller
  const abortController = new AbortController();
  const signal = processedSignal || externalSignal || abortController.signal;

  // Initialize monitoring
  const monitor = new L0Monitor({
    enabled: processedMonitoring?.enabled ?? false,
    sampleRate: processedMonitoring?.sampleRate ?? 1.0,
    includeNetworkDetails: processedMonitoring?.includeNetworkDetails ?? true,
    includeTimings: processedMonitoring?.includeTimings ?? true,
    metadata: processedMonitoring?.metadata,
  });

  monitor.start();

  // Record continuation setting in monitoring
  monitor.recordContinuation(processedContinueFromCheckpoint, false);

  // Initialize engines
  const guardrailEngine =
    processedGuardrails.length > 0
      ? new GuardrailEngine({
          rules: processedGuardrails,
          stopOnFatal: true,
          enableStreaming: true,
          onViolation: processedOnViolation,
        })
      : null;

  const retryManager = new RetryManager({
    attempts: processedRetry.attempts ?? 2,
    maxRetries: processedRetry.maxRetries,
    baseDelay: processedRetry.baseDelay ?? 1000,
    maxDelay: processedRetry.maxDelay ?? 10000,
    backoff: processedRetry.backoff ?? "exponential",
    retryOn: processedRetry.retryOn ?? [
      "zero_output",
      "guardrail_violation",
      "drift",
      "incomplete",
      "network_error",
      "timeout",
      "rate_limit",
      "server_error",
    ],
  });

  const driftDetector = processedDetectDrift ? new DriftDetector() : null;

  // Create async generator for streaming
  const streamGenerator = async function* (): AsyncGenerator<L0Event> {
    let fallbackIndex = 0;
    const allStreams = [processedStream, ...processedFallbackStreams];

    // Token buffer for O(n) accumulation instead of O(n²) string concatenation
    let tokenBuffer: string[] = [];

    // Track checkpoint for continuation
    let checkpointForContinuation = "";

    // Try primary stream first, then fallbacks if exhausted
    while (fallbackIndex < allStreams.length) {
      const currentStreamFactory = allStreams[fallbackIndex]!;
      let retryAttempt = 0;
      // Model failure retry limit (network errors don't count toward this)
      const modelRetryLimit = processedRetry.attempts ?? 2;

      // Update state with current fallback index
      state.fallbackIndex = fallbackIndex;

      while (retryAttempt <= modelRetryLimit) {
        try {
          // Reset state for retry (but preserve checkpoint if continuation enabled)
          if (retryAttempt > 0) {
            // Check if we should continue from checkpoint
            if (
              processedContinueFromCheckpoint &&
              state.checkpoint.length > 0
            ) {
              checkpointForContinuation = state.checkpoint;

              // Validate checkpoint content before continuation
              const validation = validateCheckpointForContinuation(
                checkpointForContinuation,
                guardrailEngine,
                driftDetector,
              );

              // Record any violations found
              if (validation.violations.length > 0) {
                state.violations.push(...validation.violations);
                monitor.recordGuardrailViolations(validation.violations);
              }

              // Record drift if detected
              if (validation.driftDetected) {
                state.driftDetected = true;
                monitor.recordDrift(true, validation.driftTypes);
                if (processedOnViolation) {
                  processedOnViolation({
                    rule: "drift",
                    severity: "warning",
                    message: `Drift detected in checkpoint: ${validation.driftTypes.join(", ")}`,
                    recoverable: true,
                  });
                }
              }

              if (validation.skipContinuation) {
                // Fatal violation in checkpoint, start fresh
                tokenBuffer = [];
                state.content = "";
                state.tokenCount = 0;
                state.violations = [];
                state.driftDetected = false;
                continue;
              }

              state.continuedFromCheckpoint = true;
              state.continuationCheckpoint = checkpointForContinuation;

              // Call buildContinuationPrompt if provided (allows user to update prompt for retry)
              if (processedBuildContinuationPrompt) {
                processedBuildContinuationPrompt(checkpointForContinuation);
              }

              // Record continuation in monitoring
              monitor.recordContinuation(true, true, checkpointForContinuation);

              // Emit the checkpoint content as tokens first
              // This ensures consumers see the full accumulated content
              const checkpointEvent: L0Event = {
                type: "token",
                value: checkpointForContinuation,
                timestamp: Date.now(),
              };
              if (processedOnEvent) processedOnEvent(checkpointEvent);
              yield checkpointEvent;

              // Initialize token buffer with checkpoint
              tokenBuffer = [checkpointForContinuation];
              state.content = checkpointForContinuation;
              state.tokenCount = 1; // Count checkpoint as one token
            } else {
              tokenBuffer = [];
              state.content = "";
              state.tokenCount = 0;
            }
            state.violations = [];
            state.driftDetected = false;
          }

          // Get stream from factory
          const streamResult = await currentStreamFactory();

          // Handle different stream result types
          let sourceStream: AsyncIterable<any>;
          if (streamResult.textStream) {
            sourceStream = streamResult.textStream;
          } else if (streamResult.fullStream) {
            sourceStream = streamResult.fullStream;
          } else if (Symbol.asyncIterator in streamResult) {
            sourceStream = streamResult;
          } else {
            throw new L0Error(
              "Invalid stream result - no iterable stream found",
              {
                code: "INVALID_STREAM",
                retryAttempts: state.retryAttempts,
                networkRetries: state.networkRetries,
                fallbackIndex,
                recoverable: true,
              },
            );
          }

          // Track timing
          const startTime = Date.now();
          state.firstTokenAt = undefined;
          state.lastTokenAt = undefined;

          let firstTokenReceived = false;
          let lastTokenTime = startTime;

          const defaultInitialTokenTimeout = 5000;

          // Initial token timeout
          const initialTimeout =
            processedTimeout.initialToken ?? defaultInitialTokenTimeout;
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
              throw new L0Error("Stream aborted by signal", {
                code: "STREAM_ABORTED",
                checkpoint: state.checkpoint,
                tokenCount: state.tokenCount,
                contentLength: state.content.length,
                retryAttempts: state.retryAttempts,
                networkRetries: state.networkRetries,
                fallbackIndex,
                recoverable: state.checkpoint.length > 0,
              });
            }

            // Clear initial timeout on first chunk
            if (initialTimeoutId && !firstTokenReceived) {
              clearTimeout(initialTimeoutId);
              initialTimeoutId = null;
              initialTimeoutReached = false;
            }

            // Check initial timeout
            if (initialTimeoutReached && !firstTokenReceived) {
              throw new L0Error("Initial token timeout reached", {
                code: "INITIAL_TOKEN_TIMEOUT",
                checkpoint: state.checkpoint,
                tokenCount: 0,
                contentLength: 0,
                retryAttempts: state.retryAttempts,
                networkRetries: state.networkRetries,
                fallbackIndex,
                recoverable: true,
                metadata: {
                  timeout:
                    processedTimeout.initialToken ?? defaultInitialTokenTimeout,
                },
              });
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

              // Update state - use buffer for O(n) accumulation
              tokenBuffer.push(token);
              state.tokenCount++;
              state.lastTokenAt = Date.now();
              lastTokenTime = state.lastTokenAt;

              // Build content string only when needed (for guardrails/drift checks)
              // This is O(n) total instead of O(n²) from repeated concatenation
              const needsContent =
                (guardrailEngine &&
                  state.tokenCount % guardrailCheckInterval === 0) ||
                (driftDetector &&
                  state.tokenCount % driftCheckInterval === 0) ||
                state.tokenCount % checkpointInterval === 0; // checkpoint

              if (needsContent) {
                state.content = tokenBuffer.join("");
              }

              // Record token in monitoring
              monitor.recordToken(state.lastTokenAt);

              // Check inter-token timeout
              const interTimeout = processedTimeout.interToken ?? 10000;
              const timeSinceLastToken = Date.now() - lastTokenTime;
              if (timeSinceLastToken > interTimeout) {
                throw new L0Error("Inter-token timeout reached", {
                  code: "INTER_TOKEN_TIMEOUT",
                  checkpoint: state.checkpoint,
                  tokenCount: state.tokenCount,
                  contentLength: state.content.length,
                  retryAttempts: state.retryAttempts,
                  networkRetries: state.networkRetries,
                  fallbackIndex,
                  recoverable: state.checkpoint.length > 0,
                  metadata: { timeout: interTimeout, timeSinceLastToken },
                });
              }

              // Update checkpoint periodically
              if (state.tokenCount % checkpointInterval === 0) {
                state.checkpoint = state.content;
              }

              // Run streaming guardrails
              if (
                guardrailEngine &&
                state.tokenCount % guardrailCheckInterval === 0
              ) {
                const context: GuardrailContext = {
                  content: state.content,
                  checkpoint: state.checkpoint,
                  delta: token,
                  tokenCount: state.tokenCount,
                  completed: false,
                };

                const result = guardrailEngine.check(context);
                if (result.violations.length > 0) {
                  state.violations.push(...result.violations);
                  monitor.recordGuardrailViolations(result.violations);
                }

                // Check for fatal violations
                if (result.shouldHalt) {
                  throw new L0Error(
                    `Fatal guardrail violation: ${result.violations[0]?.message}`,
                    {
                      code: "FATAL_GUARDRAIL_VIOLATION",
                      checkpoint: state.checkpoint,
                      tokenCount: state.tokenCount,
                      contentLength: state.content.length,
                      retryAttempts: state.retryAttempts,
                      networkRetries: state.networkRetries,
                      fallbackIndex,
                      recoverable: false,
                      metadata: { violation: result.violations[0] },
                    },
                  );
                }
              }

              // Check drift
              if (
                driftDetector &&
                state.tokenCount % driftCheckInterval === 0
              ) {
                const drift = driftDetector.check(state.content, token);
                if (drift.detected) {
                  state.driftDetected = true;
                  monitor.recordDrift(true, drift.types);
                }
              }

              // Emit event
              const l0Event: L0Event = {
                type: "token",
                value: token,
                timestamp: Date.now(),
              };

              if (processedOnEvent) processedOnEvent(l0Event);
              yield l0Event;
            } else if (event.type === "message") {
              // Pass through message events (e.g., tool calls, function calls)
              // Preserve all original event properties including role
              const messageEvent: L0Event = {
                type: "message",
                value: event.value,
                role: event.role,
                timestamp: Date.now(),
              };
              if (processedOnEvent) processedOnEvent(messageEvent);
              yield messageEvent;
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

          // Finalize content from buffer
          state.content = tokenBuffer.join("");

          // Check for zero output
          if (processedDetectZeroTokens && detectZeroToken(state.content)) {
            throw new L0Error("Zero output detected - no meaningful content", {
              code: "ZERO_OUTPUT",
              checkpoint: state.checkpoint,
              tokenCount: state.tokenCount,
              contentLength: state.content.length,
              retryAttempts: state.retryAttempts,
              networkRetries: state.networkRetries,
              fallbackIndex,
              recoverable: true,
            });
          }

          // Run final guardrails
          if (guardrailEngine) {
            const context: GuardrailContext = {
              content: state.content,
              checkpoint: state.checkpoint,
              tokenCount: state.tokenCount,
              completed: true,
            };

            const result = guardrailEngine.check(context);
            if (result.violations.length > 0) {
              state.violations.push(...result.violations);
              monitor.recordGuardrailViolations(result.violations);
            }

            // Check if should retry
            if (result.shouldRetry && retryAttempt < modelRetryLimit) {
              const violation = result.violations[0];
              if (processedOnRetry) {
                processedOnRetry(
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
              throw new L0Error(
                `Fatal guardrail violation: ${result.violations[0]?.message}`,
                {
                  code: "FATAL_GUARDRAIL_VIOLATION",
                  checkpoint: state.checkpoint,
                  tokenCount: state.tokenCount,
                  contentLength: state.content.length,
                  retryAttempts: state.retryAttempts,
                  networkRetries: state.networkRetries,
                  fallbackIndex,
                  recoverable: false,
                  metadata: { violation: result.violations[0] },
                },
              );
            }
          }

          // Check drift
          if (driftDetector) {
            const finalDrift = driftDetector.check(state.content);
            if (finalDrift.detected && retryAttempt < modelRetryLimit) {
              state.driftDetected = true;
              monitor.recordDrift(true, finalDrift.types);
              if (processedOnRetry) {
                processedOnRetry(retryAttempt + 1, "Drift detected");
              }
              monitor.recordRetry(false);
              retryAttempt++;
              state.retryAttempts++;
              continue;
            }
          }

          // Success - mark as completed
          state.completed = true;
          monitor.complete();

          // Calculate duration
          if (state.firstTokenAt) {
            state.duration = Date.now() - state.firstTokenAt;
          }

          // Emit done event
          const doneEvent: L0Event = {
            type: "done",
            timestamp: Date.now(),
          };
          if (processedOnEvent) processedOnEvent(doneEvent);
          yield doneEvent;

          break; // Exit retry loop on success
        } catch (error) {
          const err = error instanceof Error ? error : new Error(String(error));
          errors.push(err);

          // Run final guardrails on partial stream content before retry/fallback
          // This validates the accumulated content and updates checkpoint if valid
          if (guardrailEngine && state.tokenCount > 0) {
            // Ensure content is up to date
            if (tokenBuffer.length > 0) {
              state.content = tokenBuffer.join("");
            }

            const partialContext: GuardrailContext = {
              content: state.content,
              checkpoint: state.checkpoint,
              delta: "",
              tokenCount: state.tokenCount,
              completed: false, // Stream didn't complete normally
            };

            const partialResult = guardrailEngine.check(partialContext);
            if (partialResult.violations.length > 0) {
              state.violations.push(...partialResult.violations);
              monitor.recordGuardrailViolations(partialResult.violations);

              // Notify about violations
              for (const violation of partialResult.violations) {
                if (processedOnViolation) {
                  processedOnViolation(violation);
                }
              }

              // If fatal violation in partial content, clear checkpoint to prevent
              // corrupted content from being used in continuation
              const hasFatal = partialResult.violations.some(
                (v) => v.severity === "fatal",
              );
              if (hasFatal) {
                state.checkpoint = "";
              }
            }

            // If no fatal violations and we have content, update checkpoint
            // so continuation can use the validated partial content
            if (
              !partialResult.violations.some((v) => v.severity === "fatal") &&
              state.content.length > 0
            ) {
              state.checkpoint = state.content;
            }
          }

          // Run drift detection on partial content
          if (driftDetector && state.tokenCount > 0) {
            if (tokenBuffer.length > 0) {
              state.content = tokenBuffer.join("");
            }
            const partialDrift = driftDetector.check(state.content);
            if (partialDrift.detected) {
              state.driftDetected = true;
              monitor.recordDrift(true, partialDrift.types);
              if (processedOnViolation) {
                processedOnViolation({
                  rule: "drift",
                  severity: "warning",
                  message: `Drift detected in partial stream: ${partialDrift.types.join(", ")}`,
                  recoverable: true,
                });
              }
            }
          }

          // Categorize error
          const categorized = retryManager.categorizeError(err);
          const decision = retryManager.shouldRetry(err);

          // Record network error in monitoring
          const isNetError = isNetworkError(err);
          if (isNetError) {
            monitor.recordNetworkError(
              err,
              decision.shouldRetry,
              decision.delay,
            );
          }

          // Check if should retry
          if (decision.shouldRetry) {
            if (decision.countsTowardLimit) {
              retryAttempt++;
              state.retryAttempts++;
            } else {
              state.networkRetries++;
            }

            // Record in monitoring
            monitor.recordRetry(isNetError);

            if (processedOnRetry) {
              processedOnRetry(retryAttempt, decision.reason);
            }

            // Record retry and wait
            await retryManager.recordRetry(categorized, decision);
            continue;
          }

          // Not retryable - check if we have fallbacks available
          if (fallbackIndex < allStreams.length - 1) {
            // Break out of retry loop to try fallback
            break;
          }

          // No fallbacks available - emit error and throw
          const errorEvent: L0Event = {
            type: "error",
            error: err,
            timestamp: Date.now(),
          };
          if (processedOnEvent) processedOnEvent(errorEvent);
          yield errorEvent;

          // Execute error interceptors
          await interceptorManager.executeError(err, processedOptions);

          throw err;
        }
      }

      // If we exhausted retries for this stream (or error not retryable), try fallback
      if (!state.completed) {
        if (fallbackIndex < allStreams.length - 1) {
          // Move to next fallback
          fallbackIndex++;
          const fallbackMessage = `Retries exhausted for stream ${fallbackIndex}, falling back to stream ${fallbackIndex + 1}`;

          monitor.logEvent({
            type: "fallback",
            message: fallbackMessage,
            fromIndex: fallbackIndex - 1,
            toIndex: fallbackIndex,
          });

          if (processedOnRetry) {
            processedOnRetry(0, fallbackMessage);
          }

          // Reset state for fallback attempt (but preserve checkpoint if continuation enabled)
          if (processedContinueFromCheckpoint && state.checkpoint.length > 0) {
            checkpointForContinuation = state.checkpoint;

            // Validate checkpoint content before continuation
            const validation = validateCheckpointForContinuation(
              checkpointForContinuation,
              guardrailEngine,
              driftDetector,
            );

            // Record any violations found
            if (validation.violations.length > 0) {
              state.violations.push(...validation.violations);
              monitor.recordGuardrailViolations(validation.violations);
            }

            // Record drift if detected
            if (validation.driftDetected) {
              state.driftDetected = true;
              monitor.recordDrift(true, validation.driftTypes);
              if (processedOnViolation) {
                processedOnViolation({
                  rule: "drift",
                  severity: "warning",
                  message: `Drift detected in checkpoint: ${validation.driftTypes.join(", ")}`,
                  recoverable: true,
                });
              }
            }

            if (!validation.skipContinuation) {
              state.continuedFromCheckpoint = true;
              state.continuationCheckpoint = checkpointForContinuation;

              // Call buildContinuationPrompt if provided (allows user to update prompt for fallback)
              if (processedBuildContinuationPrompt) {
                processedBuildContinuationPrompt(checkpointForContinuation);
              }

              // Record continuation in monitoring
              monitor.recordContinuation(true, true, checkpointForContinuation);

              // Emit the checkpoint content as tokens first
              const checkpointEvent: L0Event = {
                type: "token",
                value: checkpointForContinuation,
                timestamp: Date.now(),
              };
              if (processedOnEvent) processedOnEvent(checkpointEvent);
              yield checkpointEvent;

              // Initialize with checkpoint
              tokenBuffer = [checkpointForContinuation];
              state.content = checkpointForContinuation;
              state.tokenCount = 1;
            } else {
              // Fatal violation in checkpoint, start fresh
              tokenBuffer = [];
              state.content = "";
              state.tokenCount = 0;
            }
          } else {
            tokenBuffer = [];
            state.content = "";
            state.tokenCount = 0;
          }
          state.violations = [];
          state.driftDetected = false;
          state.retryAttempts = 0;

          // Continue to next fallback
          continue;
        } else {
          // All streams exhausted
          const exhaustedError = new Error(
            `All streams exhausted (primary + ${processedFallbackStreams.length} fallbacks)`,
          );
          errors.push(exhaustedError);

          const errorEvent: L0Event = {
            type: "error",
            error: exhaustedError,
            timestamp: Date.now(),
          };
          if (processedOnEvent) processedOnEvent(errorEvent);
          yield errorEvent;

          // Execute error interceptors
          await interceptorManager.executeError(
            exhaustedError,
            processedOptions,
          );

          throw exhaustedError;
        }
      }

      // Success - break out of fallback loop
      break;
    }
  };

  // Create initial result
  let result: L0Result = {
    stream: streamGenerator(),
    state,
    errors,
    telemetry: monitor.export(),
    abort: () => abortController.abort(),
  };

  // Execute "after" interceptors
  try {
    result = await interceptorManager.executeAfter(result);
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    await interceptorManager.executeError(err, processedOptions);
    throw err;
  }

  // Return processed result
  return result;
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
    fallbackIndex: 0,
    violations: [],
    driftDetected: false,
    completed: false,
    networkErrors: [],
    continuedFromCheckpoint: false,
  };
}

/**
 * Helper to consume stream and get final text
 */
export async function getText(result: L0Result): Promise<string> {
  for await (const _event of result.stream) {
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
