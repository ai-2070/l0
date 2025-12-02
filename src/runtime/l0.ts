// Main L0 runtime wrapper - streaming, guardrails, retry, and reliability layer

import type {
  L0Options,
  L0Result,
  L0State,
  L0Event,
  L0Adapter,
} from "../types/l0";
import { GuardrailEngine } from "../guardrails/engine";
import type { GuardrailContext } from "../types/guardrails";
import { RetryManager } from "./retry";
import { detectZeroToken } from "./zeroToken";
import { normalizeStreamEvent } from "./events";
import { detectOverlap } from "../utils/tokens";
import {
  isNetworkError,
  L0Error,
  ErrorCategory,
  L0ErrorCodes,
} from "../utils/errors";
import { EventDispatcher } from "./event-dispatcher";
import { registerCallbackWrappers } from "./callback-wrappers";
import { EventType } from "../types/observability";

// Type-only imports for optional modules (injected at runtime)
import type { DriftDetector as DriftDetectorType } from "./drift";
import type { L0Monitor as L0MonitorType } from "./monitoring";
import type { InterceptorManager as InterceptorManagerType } from "./interceptors";

// Optional feature loaders - these are set by calling enableXxx() functions
// This allows the features to be tree-shaken when not used
let _driftDetectorFactory: (() => DriftDetectorType) | null = null;
let _monitorFactory: ((config: unknown) => L0MonitorType) | null = null;
let _interceptorManagerFactory:
  | ((interceptors: unknown[]) => InterceptorManagerType)
  | null = null;
let _adapterRegistry: {
  getAdapter: (name: string) => L0Adapter | undefined;
  hasMatchingAdapter: (stream: unknown) => boolean;
  detectAdapter: (stream: unknown) => L0Adapter;
} | null = null;

/**
 * Enable drift detection feature. Call this once before using detectDrift option.
 * @example
 * ```typescript
 * import { enableDriftDetection } from "@ai2070/l0";
 * enableDriftDetection();
 * ```
 */
export function enableDriftDetection(factory: () => DriftDetectorType): void {
  _driftDetectorFactory = factory;
}

/**
 * Enable monitoring feature. Call this once before using monitoring option.
 * @example
 * ```typescript
 * import { enableMonitoring } from "@ai2070/l0";
 * enableMonitoring();
 * ```
 */
export function enableMonitoring(
  factory: (config: unknown) => L0MonitorType,
): void {
  _monitorFactory = factory;
}

/**
 * Enable interceptors feature. Call this once before using interceptors option.
 * @example
 * ```typescript
 * import { enableInterceptors } from "@ai2070/l0";
 * enableInterceptors();
 * ```
 */
export function enableInterceptors(
  factory: (interceptors: unknown[]) => InterceptorManagerType,
): void {
  _interceptorManagerFactory = factory;
}

/**
 * Enable adapter registry for auto-detection of SDK streams.
 * @example
 * ```typescript
 * import { enableAdapterRegistry } from "@ai2070/l0";
 * enableAdapterRegistry();
 * ```
 */
export function enableAdapterRegistry(registry: {
  getAdapter: (name: string) => L0Adapter | undefined;
  hasMatchingAdapter: (stream: unknown) => boolean;
  detectAdapter: (stream: unknown) => L0Adapter;
}): void {
  _adapterRegistry = registry;
}

// Import from extracted modules
import { createInitialState, resetStateForRetry } from "./state";
import { validateCheckpointForContinuation } from "./checkpoint";
import { safeInvokeCallback } from "./callbacks";
import { StateMachine, RuntimeStates } from "./state-machine";
import { Metrics } from "./metrics";

// Re-export helpers for backward compatibility
export { getText, consumeStream } from "./helpers";

// Re-export new modules for advanced usage
export { StateMachine, RuntimeStates } from "./state-machine";
export type { RuntimeState } from "./state-machine";
export { Metrics } from "./metrics";

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
 *   retry: { attempts: 3, backoff: "fixed-jitter" }
 * });
 *
 * for await (const event of result.stream) {
 *   console.log(event);
 * }
 * ```
 */
export async function l0<TOutput = unknown>(
  options: L0Options<TOutput>,
): Promise<L0Result<TOutput>> {
  const { signal: externalSignal, interceptors = [] } = options;

  // Use interceptor manager if interceptors provided AND feature is enabled
  let interceptorManager: InterceptorManagerType | null = null;
  let processedOptions: L0Options<TOutput> = options;

  if (interceptors.length > 0) {
    if (!_interceptorManagerFactory) {
      throw new L0Error(
        "Interceptors require enableInterceptors() to be called first. " +
          'Import and call: import { enableInterceptors } from "@ai2070/l0"; enableInterceptors();',
        { code: L0ErrorCodes.FEATURE_NOT_ENABLED, recoverable: false },
      );
    }
    interceptorManager = _interceptorManagerFactory(interceptors);

    // Execute "before" interceptors
    try {
      processedOptions = (await interceptorManager.executeBefore(
        options,
      )) as L0Options<TOutput>;
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      await interceptorManager.executeError(err, options);
      throw err;
    }
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
    onComplete: processedOnComplete,
    onError: processedOnError,
    onEvent: processedOnEvent,
    onViolation: processedOnViolation,
    continueFromLastKnownGoodToken: processedContinueFromCheckpoint = false,
    buildContinuationPrompt: processedBuildContinuationPrompt,
    deduplicateContinuation: processedDeduplicateContinuation,
    deduplicationOptions: processedDeduplicationOptions = {},
    meta: processedMeta = {},
  } = processedOptions;

  // Initialize event dispatcher for observability
  const dispatcher = new EventDispatcher(processedMeta);

  // Register legacy callback wrappers
  registerCallbackWrappers(dispatcher, processedOptions);

  // Deduplication is enabled by default when continuation is enabled
  const shouldDeduplicateContinuation =
    processedDeduplicateContinuation ?? processedContinueFromCheckpoint;

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

  // Use monitoring if enabled AND feature is loaded
  let monitor: L0MonitorType | null = null;
  if (processedMonitoring?.enabled) {
    if (!_monitorFactory) {
      throw new L0Error(
        "Monitoring requires enableMonitoring() to be called first. " +
          'Import and call: import { enableMonitoring } from "@ai2070/l0"; enableMonitoring();',
        { code: L0ErrorCodes.FEATURE_NOT_ENABLED, recoverable: false },
      );
    }
    monitor = _monitorFactory({
      enabled: true,
      sampleRate: processedMonitoring?.sampleRate ?? 1.0,
      includeNetworkDetails: processedMonitoring?.includeNetworkDetails ?? true,
      includeTimings: processedMonitoring?.includeTimings ?? true,
      metadata: processedMonitoring?.metadata,
    });
    monitor.start();
    monitor.recordContinuation(processedContinueFromCheckpoint, false);
  }

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
    backoff: processedRetry.backoff ?? "fixed-jitter",
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

  // Use drift detector if enabled AND feature is loaded
  let driftDetector: DriftDetectorType | null = null;
  if (processedDetectDrift) {
    if (!_driftDetectorFactory) {
      throw new L0Error(
        "Drift detection requires enableDriftDetection() to be called first. " +
          'Import and call: import { enableDriftDetection } from "@ai2070/l0"; enableDriftDetection();',
        { code: L0ErrorCodes.FEATURE_NOT_ENABLED, recoverable: false },
      );
    }
    driftDetector = _driftDetectorFactory();
  }

  // Initialize state machine and metrics
  const stateMachine = new StateMachine();
  const metrics = new Metrics();
  metrics.requests++;

  // Create async generator for streaming
  const streamGenerator = async function* (): AsyncGenerator<L0Event> {
    let fallbackIndex = 0;
    const allStreams = [processedStream, ...processedFallbackStreams];

    // Token buffer for O(n) accumulation instead of O(n²) string concatenation
    let tokenBuffer: string[] = [];

    // Track checkpoint for continuation
    let checkpointForContinuation = "";

    // Overlap matching state for continuation
    // LLMs often repeat content when continuing, so we buffer and match overlaps
    let overlapBuffer = "";
    let overlapResolved = false;

    // Try primary stream first, then fallbacks if exhausted
    while (fallbackIndex < allStreams.length) {
      const currentStreamFactory = allStreams[fallbackIndex]!;
      let retryAttempt = 0;
      // Track if this is a retry (network errors don't increment retryAttempt but still need state reset)
      let isRetryAttempt = false;
      // Model failure retry limit (network errors don't count toward this)
      const modelRetryLimit = processedRetry.attempts ?? 2;

      // Update state with current fallback index
      state.fallbackIndex = fallbackIndex;

      while (retryAttempt <= modelRetryLimit) {
        // Transition to init state at start of each attempt
        stateMachine.transition(RuntimeStates.INIT);

        // Emit SESSION_START event (callback wrappers handle legacy onStart)
        const isRetry = retryAttempt > 0 || isRetryAttempt;
        const isFallback = fallbackIndex > 0;
        dispatcher.emit(EventType.SESSION_START, {
          attempt: retryAttempt + 1,
          isRetry,
          isFallback,
        });

        try {
          // Reset state for retry (but preserve checkpoint if continuation enabled)
          // retryAttempt > 0: guardrail/drift retries increment this directly
          // isRetryAttempt: network retries set this flag (don't count toward limit)
          if (retryAttempt > 0 || isRetryAttempt) {
            // Check if we should continue from checkpoint
            if (
              processedContinueFromCheckpoint &&
              state.checkpoint.length > 0
            ) {
              checkpointForContinuation = state.checkpoint;
              stateMachine.transition(RuntimeStates.CHECKPOINT_VERIFYING);

              // Validate checkpoint content before continuation
              const validation = validateCheckpointForContinuation(
                checkpointForContinuation,
                guardrailEngine,
                driftDetector,
              );

              // Record any violations found
              if (validation.violations.length > 0) {
                state.violations.push(...validation.violations);
                monitor?.recordGuardrailViolations(validation.violations);
              }

              // Record drift if detected
              if (validation.driftDetected) {
                state.driftDetected = true;
                monitor?.recordDrift(true, validation.driftTypes);
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
                resetStateForRetry(state);
                continue;
              }

              state.resumed = true;
              state.resumePoint = checkpointForContinuation;
              state.resumeFrom = checkpointForContinuation.length;

              // Reset overlap matching state for the new continuation
              overlapBuffer = "";
              overlapResolved = false;

              // Emit RESUME_START event (callback wrappers handle legacy onResume)
              dispatcher.emit(EventType.RESUME_START, {
                checkpoint: checkpointForContinuation,
                tokenCount: state.tokenCount,
              });

              // Call buildContinuationPrompt if provided (allows user to update prompt for retry)
              if (processedBuildContinuationPrompt) {
                processedBuildContinuationPrompt(checkpointForContinuation);
              }

              // Record continuation in monitoring
              monitor?.recordContinuation(
                true,
                true,
                checkpointForContinuation,
              );

              // Emit the checkpoint content as tokens first
              // This ensures consumers see the full accumulated content
              const checkpointEvent: L0Event = {
                type: "token",
                value: checkpointForContinuation,
                timestamp: Date.now(),
              };
              safeInvokeCallback(
                processedOnEvent,
                checkpointEvent,
                monitor,
                "onEvent",
              );
              yield checkpointEvent;

              // Initialize token buffer with checkpoint
              tokenBuffer = [checkpointForContinuation];
              state.content = checkpointForContinuation;
              state.tokenCount = 1; // Count checkpoint as one token
              // Reset other state fields
              resetStateForRetry(state, {
                checkpoint: state.checkpoint,
                resumed: true,
                resumePoint: checkpointForContinuation,
                resumeFrom: checkpointForContinuation.length,
              });
              // Restore values that resetStateForRetry cleared
              state.content = checkpointForContinuation;
              state.tokenCount = 1;
            } else {
              tokenBuffer = [];
              resetStateForRetry(state);
            }
          }

          // Get stream from factory
          const streamResult = await currentStreamFactory();

          // Handle different stream result types
          let sourceStream: AsyncIterable<any>;

          // 1. Explicit adapter (highest priority)
          if (processedOptions.adapter) {
            let adapter: L0Adapter | undefined;

            if (typeof processedOptions.adapter === "string") {
              // Lookup by name from adapter registry
              if (!_adapterRegistry) {
                throw new L0Error(
                  "String adapter names require enableAdapterRegistry() to be called first. " +
                    'Import and call: import { enableAdapterRegistry } from "@ai2070/l0"; enableAdapterRegistry();',
                  {
                    code: L0ErrorCodes.FEATURE_NOT_ENABLED,
                    recoverable: false,
                  },
                );
              }
              adapter = _adapterRegistry.getAdapter(processedOptions.adapter);
              if (!adapter) {
                throw new L0Error(
                  `Adapter "${processedOptions.adapter}" not found. ` +
                    `Use registerAdapter() to register it first.`,
                  {
                    code: L0ErrorCodes.ADAPTER_NOT_FOUND,
                    modelRetryCount: state.modelRetryCount,
                    networkRetryCount: state.networkRetryCount,
                    fallbackIndex,
                    recoverable: false,
                  },
                );
              }
            } else {
              // Direct adapter object
              adapter = processedOptions.adapter;
            }

            sourceStream = adapter.wrap(
              streamResult,
              processedOptions.adapterOptions,
            );
          }
          // 2. Native L0-compatible streams (Vercel AI SDK pattern)
          else if (streamResult.textStream) {
            sourceStream = streamResult.textStream;
          } else if (streamResult.fullStream) {
            sourceStream = streamResult.fullStream;
          }
          // 3. Auto-detection via registered adapters (if registry enabled)
          // MUST come before generic Symbol.asyncIterator check!
          // Provider streams are async iterables but need adapters to convert to L0Events
          else if (_adapterRegistry?.hasMatchingAdapter(streamResult)) {
            const adapter = _adapterRegistry.detectAdapter(streamResult);
            sourceStream = adapter.wrap(
              streamResult,
              processedOptions.adapterOptions,
            );
          }
          // 4. Generic async iterable (already L0Events or compatible)
          else if (Symbol.asyncIterator in streamResult) {
            sourceStream = streamResult;
          }
          // 5. No valid stream found
          else {
            throw new L0Error(
              "Invalid stream result - no iterable stream found and no adapter matched. " +
                "Use explicit `adapter: myAdapter` or register an adapter with detect().",
              {
                code: L0ErrorCodes.INVALID_STREAM,
                modelRetryCount: state.modelRetryCount,
                networkRetryCount: state.networkRetryCount,
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
          stateMachine.transition(RuntimeStates.WAITING_FOR_TOKEN);

          // Track time of last token emission for inter-token timeout
          // This is set BEFORE reading each chunk, so the timeout check
          // measures time waiting for the next token, not time since processing
          let lastTokenEmissionTime = startTime;

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
              dispatcher.emit(EventType.ABORT_COMPLETED, {
                tokenCount: state.tokenCount,
                contentLength: state.content.length,
              });
              throw new L0Error("Stream aborted by signal", {
                code: L0ErrorCodes.STREAM_ABORTED,
                checkpoint: state.checkpoint,
                tokenCount: state.tokenCount,
                contentLength: state.content.length,
                modelRetryCount: state.modelRetryCount,
                networkRetryCount: state.networkRetryCount,
                fallbackIndex,
                recoverable: state.checkpoint.length > 0,
              });
            }

            // Check inter-token timeout BEFORE processing this chunk
            // This measures how long we waited for this token
            if (firstTokenReceived) {
              const interTimeout = processedTimeout.interToken ?? 10000;
              const timeSinceLastToken = Date.now() - lastTokenEmissionTime;
              if (timeSinceLastToken > interTimeout) {
                metrics.timeouts++;
                throw new L0Error("Inter-token timeout reached", {
                  code: L0ErrorCodes.INTER_TOKEN_TIMEOUT,
                  checkpoint: state.checkpoint,
                  tokenCount: state.tokenCount,
                  contentLength: state.content.length,
                  modelRetryCount: state.modelRetryCount,
                  networkRetryCount: state.networkRetryCount,
                  fallbackIndex,
                  recoverable: state.checkpoint.length > 0,
                  metadata: { timeout: interTimeout, timeSinceLastToken },
                });
              }
            }

            // Clear initial timeout on first chunk
            if (initialTimeoutId && !firstTokenReceived) {
              clearTimeout(initialTimeoutId);
              initialTimeoutId = null;
              initialTimeoutReached = false;
            }

            // Check initial timeout
            if (initialTimeoutReached && !firstTokenReceived) {
              metrics.timeouts++;
              throw new L0Error("Initial token timeout reached", {
                code: L0ErrorCodes.INITIAL_TOKEN_TIMEOUT,
                checkpoint: state.checkpoint,
                tokenCount: 0,
                contentLength: 0,
                modelRetryCount: state.modelRetryCount,
                networkRetryCount: state.networkRetryCount,
                fallbackIndex,
                recoverable: true,
                metadata: {
                  timeout:
                    processedTimeout.initialToken ?? defaultInitialTokenTimeout,
                },
              });
            }

            // Normalize event with safety wrapper
            let event: L0Event;
            try {
              event = normalizeStreamEvent(chunk);
            } catch (normalizeError) {
              // Malformed input from stream - log and skip this chunk
              const errMsg =
                normalizeError instanceof Error
                  ? normalizeError.message
                  : String(normalizeError);
              monitor?.logEvent({
                type: "warning",
                message: `Failed to normalize stream chunk: ${errMsg}`,
                chunk:
                  typeof chunk === "object" ? JSON.stringify(chunk) : chunk,
              });
              continue;
            }

            if (event.type === "token" && event.value) {
              let token = event.value;

              // Track first token
              if (!firstTokenReceived) {
                firstTokenReceived = true;
                state.firstTokenAt = Date.now();
                stateMachine.transition(RuntimeStates.STREAMING);
              }

              metrics.tokens++;

              // Handle deduplication for continuation
              // LLMs stream tokens one at a time, so we need to accumulate tokens
              // until we can detect where the overlap ends
              if (
                state.resumed &&
                shouldDeduplicateContinuation &&
                checkpointForContinuation.length > 0 &&
                !overlapResolved
              ) {
                // Transition to deduplicating state on first buffer
                if (overlapBuffer.length === 0) {
                  stateMachine.transition(RuntimeStates.CONTINUATION_MATCHING);
                }

                // Accumulate tokens in the deduplication buffer
                overlapBuffer += token;

                // Check if we've accumulated enough to detect overlap
                // We check after each token to find the overlap boundary
                const overlapResult = detectOverlap(
                  checkpointForContinuation,
                  overlapBuffer,
                  {
                    minOverlap: processedDeduplicationOptions.minOverlap ?? 2,
                    maxOverlap: processedDeduplicationOptions.maxOverlap ?? 500,
                    caseSensitive:
                      processedDeduplicationOptions.caseSensitive ?? true,
                    normalizeWhitespace:
                      processedDeduplicationOptions.normalizeWhitespace ??
                      false,
                  },
                );

                // Check if we should finalize deduplication:
                // 1. We found overlap and have content beyond it
                // 2. Buffer exceeds max possible overlap (no overlap found)
                // 3. Buffer has grown large enough that we're confident there's no more overlap
                const maxOverlapLen =
                  processedDeduplicationOptions.maxOverlap ?? 500;
                const shouldFinalize =
                  (overlapResult.hasOverlap &&
                    overlapResult.deduplicatedContinuation.length > 0) ||
                  overlapBuffer.length > maxOverlapLen;

                if (shouldFinalize) {
                  overlapResolved = true;
                  stateMachine.transition(RuntimeStates.STREAMING);

                  if (overlapResult.hasOverlap) {
                    // Emit only the non-overlapping portion
                    token = overlapResult.deduplicatedContinuation;
                    if (token.length === 0) {
                      // Entire buffer was overlap, wait for next token
                      continue;
                    }
                  } else {
                    // No overlap found, emit the entire buffer
                    token = overlapBuffer;
                  }
                } else {
                  // Still accumulating, don't emit yet
                  continue;
                }
              }

              // Update state - use buffer for O(n) accumulation
              tokenBuffer.push(token);
              state.tokenCount++;
              state.lastTokenAt = Date.now();

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
              monitor?.recordToken(state.lastTokenAt);

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
                  monitor?.recordGuardrailViolations(result.violations);
                }

                // Check for fatal violations
                if (result.shouldHalt) {
                  throw new L0Error(
                    `Fatal guardrail violation: ${result.violations[0]?.message}`,
                    {
                      code: L0ErrorCodes.FATAL_GUARDRAIL_VIOLATION,
                      checkpoint: state.checkpoint,
                      tokenCount: state.tokenCount,
                      contentLength: state.content.length,
                      modelRetryCount: state.modelRetryCount,
                      networkRetryCount: state.networkRetryCount,
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
                  monitor?.recordDrift(true, drift.types);
                }
              }

              // Emit event
              const l0Event: L0Event = {
                type: "token",
                value: token,
                timestamp: Date.now(),
              };

              safeInvokeCallback(processedOnEvent, l0Event, monitor, "onEvent");
              yield l0Event;

              // Update emission time AFTER yielding for accurate inter-token timeout measurement
              lastTokenEmissionTime = Date.now();
            } else if (event.type === "message") {
              // Pass through message events (e.g., tool calls, function calls)
              // Preserve all original event properties including role
              const messageEvent: L0Event = {
                type: "message",
                value: event.value,
                role: event.role,
                timestamp: Date.now(),
              };
              safeInvokeCallback(
                processedOnEvent,
                messageEvent,
                monitor,
                "onEvent",
              );
              yield messageEvent;
            } else if (event.type === "data") {
              // Handle multimodal data events (images, audio, etc.)
              if (event.data) {
                state.dataOutputs.push(event.data);
              }
              const dataEvent: L0Event = {
                type: "data",
                data: event.data,
                timestamp: Date.now(),
              };
              safeInvokeCallback(
                processedOnEvent,
                dataEvent,
                monitor,
                "onEvent",
              );
              yield dataEvent;
            } else if (event.type === "progress") {
              // Handle progress events for long-running operations
              state.lastProgress = event.progress;
              const progressEvent: L0Event = {
                type: "progress",
                progress: event.progress,
                timestamp: Date.now(),
              };
              safeInvokeCallback(
                processedOnEvent,
                progressEvent,
                monitor,
                "onEvent",
              );
              yield progressEvent;
            } else if (event.type === "error") {
              throw event.error || new Error("Stream error");
            } else if (event.type === "complete") {
              break;
            }
          }

          // Clear any remaining timeout
          if (initialTimeoutId) {
            clearTimeout(initialTimeoutId);
          }

          // Flush any remaining deduplication buffer content
          // This handles the case where the stream ends before we could finalize deduplication
          if (
            state.resumed &&
            shouldDeduplicateContinuation &&
            !overlapResolved &&
            overlapBuffer.length > 0
          ) {
            // Stream ended, finalize deduplication with whatever we have
            const overlapResult = detectOverlap(
              checkpointForContinuation,
              overlapBuffer,
              {
                minOverlap: processedDeduplicationOptions.minOverlap ?? 2,
                maxOverlap: processedDeduplicationOptions.maxOverlap ?? 500,
                caseSensitive:
                  processedDeduplicationOptions.caseSensitive ?? true,
                normalizeWhitespace:
                  processedDeduplicationOptions.normalizeWhitespace ?? false,
              },
            );

            let flushedToken: string;
            if (overlapResult.hasOverlap) {
              // Add only the non-overlapping portion
              flushedToken = overlapResult.deduplicatedContinuation;
            } else {
              // No overlap found, add the entire buffer
              flushedToken = overlapBuffer;
            }

            // Only emit and add to buffer if there's content
            if (flushedToken.length > 0) {
              tokenBuffer.push(flushedToken);
              state.tokenCount++;

              // Update content for guardrail/drift checks
              state.content = tokenBuffer.join("");

              // Run guardrails on the flushed content
              if (guardrailEngine) {
                const context: GuardrailContext = {
                  content: state.content,
                  checkpoint: state.checkpoint,
                  delta: flushedToken,
                  tokenCount: state.tokenCount,
                  completed: false,
                };

                const result = guardrailEngine.check(context);
                if (result.violations.length > 0) {
                  state.violations.push(...result.violations);
                  monitor?.recordGuardrailViolations(result.violations);
                }

                // Check for fatal violations
                if (result.shouldHalt) {
                  throw new L0Error(
                    `Fatal guardrail violation: ${result.violations[0]?.message}`,
                    {
                      code: L0ErrorCodes.FATAL_GUARDRAIL_VIOLATION,
                      checkpoint: state.checkpoint,
                      tokenCount: state.tokenCount,
                      contentLength: state.content.length,
                      modelRetryCount: state.modelRetryCount,
                      networkRetryCount: state.networkRetryCount,
                      fallbackIndex,
                      recoverable: false,
                      metadata: { violation: result.violations[0] },
                    },
                  );
                }
              }

              // Run drift detection on flushed content
              if (driftDetector) {
                const drift = driftDetector.check(state.content, flushedToken);
                if (drift.detected) {
                  state.driftDetected = true;
                  monitor?.recordDrift(true, drift.types);
                }
              }

              // Emit the flushed token to the stream
              const flushedEvent: L0Event = {
                type: "token",
                value: flushedToken,
                timestamp: Date.now(),
              };
              safeInvokeCallback(
                processedOnEvent,
                flushedEvent,
                monitor,
                "onEvent",
              );
              yield flushedEvent;
            }

            overlapResolved = true;
          }

          // Finalize content from buffer
          state.content = tokenBuffer.join("");

          // Check for zero output
          if (processedDetectZeroTokens && detectZeroToken(state.content)) {
            throw new L0Error("Zero output detected - no meaningful content", {
              code: L0ErrorCodes.ZERO_OUTPUT,
              checkpoint: state.checkpoint,
              tokenCount: state.tokenCount,
              contentLength: state.content.length,
              modelRetryCount: state.modelRetryCount,
              networkRetryCount: state.networkRetryCount,
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
              monitor?.recordGuardrailViolations(result.violations);
            }

            // Check if should retry
            if (result.shouldRetry && retryAttempt < modelRetryLimit) {
              const violation = result.violations[0];
              const reason = `Guardrail violation: ${violation?.message}`;
              dispatcher.emit(EventType.RETRY_ATTEMPT, {
                attempt: retryAttempt + 1,
                maxAttempts: modelRetryLimit,
                reason,
                delayMs: 0,
              });
              retryAttempt++;
              state.modelRetryCount++;
              continue;
            }

            // Fatal violations
            if (result.shouldHalt) {
              throw new L0Error(
                `Fatal guardrail violation: ${result.violations[0]?.message}`,
                {
                  code: L0ErrorCodes.FATAL_GUARDRAIL_VIOLATION,
                  checkpoint: state.checkpoint,
                  tokenCount: state.tokenCount,
                  contentLength: state.content.length,
                  modelRetryCount: state.modelRetryCount,
                  networkRetryCount: state.networkRetryCount,
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
              monitor?.recordDrift(true, finalDrift.types);
              dispatcher.emit(EventType.RETRY_ATTEMPT, {
                attempt: retryAttempt + 1,
                maxAttempts: modelRetryLimit,
                reason: "Drift detected",
                delayMs: 0,
              });
              monitor?.recordRetry(false);
              retryAttempt++;
              state.modelRetryCount++;
              continue;
            }
          }

          // Success - mark as completed
          stateMachine.transition(RuntimeStates.FINALIZING);
          state.completed = true;
          monitor?.complete();
          metrics.completions++;

          // Calculate duration
          if (state.firstTokenAt) {
            state.duration = Date.now() - state.firstTokenAt;
          }

          // Emit complete event
          const completeEvent: L0Event = {
            type: "complete",
            timestamp: Date.now(),
          };
          safeInvokeCallback(
            processedOnEvent,
            completeEvent,
            monitor,
            "onEvent",
          );
          yield completeEvent;

          stateMachine.transition(RuntimeStates.COMPLETE);

          // Emit COMPLETE event
          dispatcher.emit(EventType.COMPLETE, {
            tokenCount: state.tokenCount,
            contentLength: state.content.length,
            durationMs: state.duration ?? 0,
          });

          // Call onComplete callback directly (needs full L0State)
          if (processedOnComplete) {
            processedOnComplete(state);
          }

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
              monitor?.recordGuardrailViolations(partialResult.violations);

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
              monitor?.recordDrift(true, partialDrift.types);
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
          let decision = retryManager.shouldRetry(err);

          // Check custom shouldRetry function if provided
          if (processedRetry.shouldRetry) {
            const customDecision = processedRetry.shouldRetry(err, {
              attempt: retryAttempt,
              totalAttempts: retryAttempt + state.networkRetryCount,
              category: categorized.category,
              reason: categorized.reason,
              content: state.content,
              tokenCount: state.tokenCount,
            });
            // If custom function returns boolean, override default decision
            if (customDecision === true) {
              decision = { ...decision, shouldRetry: true };
            } else if (customDecision === false) {
              decision = { ...decision, shouldRetry: false };
            }
            // If undefined, use default decision
          }

          // Check custom calculateDelay function if provided
          if (processedRetry.calculateDelay && decision.shouldRetry) {
            const customDelay = processedRetry.calculateDelay({
              attempt: retryAttempt,
              totalAttempts: retryAttempt + state.networkRetryCount,
              category: categorized.category,
              reason: categorized.reason,
              error: err,
              defaultDelay: decision.delay,
            });
            // If custom function returns a number, override default delay
            if (typeof customDelay === "number") {
              decision = { ...decision, delay: customDelay };
            }
          }

          // Record network error in monitoring
          const isNetError = isNetworkError(err);
          if (isNetError) {
            monitor?.recordNetworkError(
              err,
              decision.shouldRetry,
              decision.delay,
            );
          }

          // Emit ERROR event before retry/fallback decision is acted upon
          const willRetry = decision.shouldRetry;
          const willFallback =
            !decision.shouldRetry && fallbackIndex < allStreams.length - 1;
          dispatcher.emit(EventType.ERROR, {
            error: err.message,
            errorCode: (err as any).code,
            recoverable: willRetry || willFallback,
            willRetry,
            willFallback,
          });

          // Call onError callback directly (needs full Error object)
          if (processedOnError) {
            processedOnError(err, willRetry, willFallback);
          }

          // Check if should retry
          if (decision.shouldRetry) {
            if (decision.countsTowardLimit) {
              retryAttempt++;
              state.modelRetryCount++;
            } else {
              state.networkRetryCount++;
            }
            // Mark that next iteration is a retry (for state reset)
            isRetryAttempt = true;
            stateMachine.transition(RuntimeStates.RETRYING);
            metrics.retries++;
            if (isNetError) {
              metrics.networkRetryCount++;
            }

            // Record in monitoring
            monitor?.recordRetry(isNetError);

            // Emit RETRY_ATTEMPT event
            dispatcher.emit(EventType.RETRY_ATTEMPT, {
              attempt: retryAttempt,
              maxAttempts: modelRetryLimit,
              reason: decision.reason,
              delayMs: decision.delay ?? 0,
            });

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
          const errorCategory =
            err instanceof L0Error ? err.category : ErrorCategory.INTERNAL;
          const errorEvent: L0Event = {
            type: "error",
            error: err,
            reason: errorCategory,
            timestamp: Date.now(),
          };
          safeInvokeCallback(processedOnEvent, errorEvent, monitor, "onEvent");
          yield errorEvent;

          // Execute error interceptors
          await interceptorManager?.executeError(err, processedOptions);

          stateMachine.transition(RuntimeStates.ERROR);
          metrics.errors++;
          throw err;
        }
      }

      // If we exhausted retries for this stream (or error not retryable), try fallback
      if (!state.completed) {
        if (fallbackIndex < allStreams.length - 1) {
          // Move to next fallback
          fallbackIndex++;
          stateMachine.transition(RuntimeStates.FALLBACK);
          metrics.fallbacks++;
          const fallbackMessage = `Retries exhausted for stream ${fallbackIndex}, falling back to stream ${fallbackIndex + 1}`;

          monitor?.logEvent({
            type: "fallback",
            message: fallbackMessage,
            fromIndex: fallbackIndex - 1,
            toIndex: fallbackIndex,
          });

          // Emit FALLBACK_START event
          dispatcher.emit(EventType.FALLBACK_START, {
            fromIndex: fallbackIndex - 1,
            toIndex: fallbackIndex,
            reason: fallbackMessage,
          });

          // Reset state for fallback attempt (but preserve checkpoint if continuation enabled)
          if (processedContinueFromCheckpoint && state.checkpoint.length > 0) {
            checkpointForContinuation = state.checkpoint;
            stateMachine.transition(RuntimeStates.CHECKPOINT_VERIFYING);

            // Validate checkpoint content before continuation
            const validation = validateCheckpointForContinuation(
              checkpointForContinuation,
              guardrailEngine,
              driftDetector,
            );

            // Record any violations found
            if (validation.violations.length > 0) {
              state.violations.push(...validation.violations);
              monitor?.recordGuardrailViolations(validation.violations);
            }

            // Record drift if detected
            if (validation.driftDetected) {
              state.driftDetected = true;
              monitor?.recordDrift(true, validation.driftTypes);
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
              state.resumed = true;
              state.resumePoint = checkpointForContinuation;
              state.resumeFrom = checkpointForContinuation.length;

              // Reset overlap matching state for the new continuation
              overlapBuffer = "";
              overlapResolved = false;

              // Emit RESUME_START event (callback wrappers handle legacy onResume)
              dispatcher.emit(EventType.RESUME_START, {
                checkpoint: checkpointForContinuation,
                tokenCount: state.tokenCount,
              });

              // Call buildContinuationPrompt if provided (allows user to update prompt for fallback)
              if (processedBuildContinuationPrompt) {
                processedBuildContinuationPrompt(checkpointForContinuation);
              }

              // Record continuation in monitoring
              monitor?.recordContinuation(
                true,
                true,
                checkpointForContinuation,
              );

              // Emit the checkpoint content as tokens first
              const checkpointEvent: L0Event = {
                type: "token",
                value: checkpointForContinuation,
                timestamp: Date.now(),
              };
              safeInvokeCallback(
                processedOnEvent,
                checkpointEvent,
                monitor,
                "onEvent",
              );
              yield checkpointEvent;

              // Initialize with checkpoint
              tokenBuffer = [checkpointForContinuation];
              resetStateForRetry(state, {
                checkpoint: state.checkpoint,
                resumed: true,
                resumePoint: checkpointForContinuation,
                resumeFrom: checkpointForContinuation.length,
                fallbackIndex,
              });
              state.content = checkpointForContinuation;
              state.tokenCount = 1;
            } else {
              // Fatal violation in checkpoint, start fresh
              tokenBuffer = [];
              resetStateForRetry(state, { fallbackIndex });
            }
          } else {
            tokenBuffer = [];
            resetStateForRetry(state, { fallbackIndex });
          }

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
            reason: ErrorCategory.INTERNAL,
            timestamp: Date.now(),
          };
          safeInvokeCallback(processedOnEvent, errorEvent, monitor, "onEvent");
          yield errorEvent;

          // Execute error interceptors
          await interceptorManager?.executeError(
            exhaustedError,
            processedOptions,
          );

          stateMachine.transition(RuntimeStates.ERROR);
          metrics.errors++;
          throw exhaustedError;
        }
      }

      // Success - break out of fallback loop
      break;
    }
  };

  // Create abort function that emits events
  const abort = () => {
    dispatcher.emit(EventType.ABORT_REQUESTED);
    abortController.abort();
  };

  // Create initial result
  let result: L0Result<TOutput> = {
    stream: streamGenerator(),
    state,
    errors,
    telemetry: monitor?.export(),
    abort,
  };

  // Execute "after" interceptors
  if (interceptorManager) {
    try {
      result = (await interceptorManager.executeAfter(
        result,
      )) as L0Result<TOutput>;
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      await interceptorManager.executeError(err, processedOptions);
      throw err;
    }
  }

  // Return processed result
  return result;
}
