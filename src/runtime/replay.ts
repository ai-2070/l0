// Pure Replay Runtime for L0 Event Sourcing
//
// In replay mode, L0 becomes a faucet over stored events.
// No network calls, no retries, no timeouts, no fallbacks,
// no guardrail evaluations, no drift detection.
//
// Key insight: This is exactly like Kafka's read-your-own-history.
// The stream() function is IGNORED - we only emit stored events.
//
// Monitoring callbacks STILL fire (!!!!) - this enables:
// - Deterministic tests
// - Step-debugging
// - Time-travel
// - Reproduction of production failures
// - Safe bug replaying
// - Ability to "rewind an LLM"

import type { L0Event, L0Result, L0State } from "../types/l0";
import type {
  L0EventStore,
  L0ReplayOptions,
  SerializedOptions,
} from "../types/events";
import { deserializeError } from "../types/events";
import { L0Monitor } from "./monitoring";

/**
 * Replay an L0 stream from stored events
 *
 * This is a PURE replay - no network calls, no live computation.
 * All events come from the event store.
 *
 * @example
 * ```typescript
 * // Record a stream
 * const store = createInMemoryEventStore();
 * const result = await l0({
 *   stream: () => streamText({ model, prompt }),
 *   record: { eventStore: store },
 * });
 *
 * // Later, replay it
 * const replayed = await replay({
 *   streamId: result.streamId,
 *   eventStore: store,
 *   fireCallbacks: true, // onToken, onViolation, etc. still fire
 * });
 *
 * for await (const event of replayed.stream) {
 *   // Exact same events as original
 * }
 * ```
 */
export async function replay(
  options: L0ReplayOptions,
): Promise<L0ReplayResult> {
  const {
    streamId,
    eventStore,
    speed = 0,
    fireCallbacks = true,
    fromSeq = 0,
    toSeq = Infinity,
  } = options;

  // Verify stream exists
  const exists = await eventStore.exists(streamId);
  if (!exists) {
    throw new Error(`Stream not found: ${streamId}`);
  }

  // Get all events
  const envelopes = await eventStore.getEvents(streamId);
  if (envelopes.length === 0) {
    throw new Error(`Stream has no events: ${streamId}`);
  }

  // Extract original options from START event
  const startEvent = envelopes.find((e) => e.event.type === "START");
  const originalOptions: SerializedOptions = startEvent
    ? (startEvent.event as { type: "START"; options: SerializedOptions })
        .options
    : {};

  // Initialize state
  const state: L0State = createInitialState();
  const errors: Error[] = [];

  // Create abort controller for compatibility
  const abortController = new AbortController();

  // Initialize monitoring (still fires callbacks during replay!)
  const monitor = new L0Monitor({
    enabled: true,
    includeTimings: true,
  });
  monitor.start();

  // Callback holders (populated if fireCallbacks is true)
  let onToken: ((token: string) => void) | undefined;
  let onViolation: ((violation: any) => void) | undefined;
  let onRetry: ((attempt: number, reason: string) => void) | undefined;
  let onEvent: ((event: L0Event) => void) | undefined;

  // Create the replay generator
  const streamGenerator = async function* (): AsyncGenerator<L0Event> {
    let lastTs: number | null = null;

    for (const envelope of envelopes) {
      // Skip events outside range
      if (envelope.seq < fromSeq) continue;
      if (envelope.seq > toSeq) break;

      // Check abort
      if (abortController.signal.aborted) {
        break;
      }

      const event = envelope.event;

      // Simulate timing if speed > 0
      if (speed > 0 && lastTs !== null) {
        const delay = (event.ts - lastTs) / speed;
        if (delay > 0) {
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }
      lastTs = event.ts;

      // Process each event type
      switch (event.type) {
        case "START":
          // Nothing to emit, just metadata
          break;

        case "TOKEN": {
          // Update state
          state.content += event.value;
          state.tokenCount = event.index + 1;

          // Record in monitor
          monitor.recordToken(event.ts);

          // Create L0Event
          const tokenEvent: L0Event = {
            type: "token",
            value: event.value,
            timestamp: event.ts,
          };

          // Fire callbacks
          if (fireCallbacks) {
            if (onToken) onToken(event.value);
            if (onEvent) onEvent(tokenEvent);
          }

          yield tokenEvent;
          break;
        }

        case "CHECKPOINT":
          state.checkpoint = event.content;
          break;

        case "GUARDRAIL": {
          // Add violations to state
          state.violations.push(...event.result.violations);
          monitor.recordGuardrailViolations(event.result.violations);

          // Fire violation callbacks
          if (fireCallbacks && onViolation) {
            for (const violation of event.result.violations) {
              onViolation(violation);
            }
          }
          break;
        }

        case "DRIFT":
          if (event.result.detected) {
            state.driftDetected = true;
            monitor.recordDrift(true, event.result.types);
          }
          break;

        case "RETRY": {
          if (event.countsTowardLimit) {
            state.modelRetryCount++;
          } else {
            state.networkRetryCount++;
          }
          monitor.recordRetry(!event.countsTowardLimit);

          // Fire retry callback
          if (fireCallbacks && onRetry) {
            onRetry(event.attempt, event.reason);
          }
          break;
        }

        case "FALLBACK":
          state.fallbackIndex = event.to;
          break;

        case "CONTINUATION":
          state.resumed = true;
          state.resumePoint = event.checkpoint;
          monitor.recordContinuation(true, true, event.checkpoint);
          break;

        case "COMPLETE": {
          state.completed = true;
          state.content = event.content;
          state.tokenCount = event.tokenCount;
          monitor.complete();

          // Emit complete event
          const completeEvent: L0Event = {
            type: "complete",
            timestamp: event.ts,
          };

          if (fireCallbacks && onEvent) {
            onEvent(completeEvent);
          }

          yield completeEvent;
          break;
        }

        case "ERROR": {
          const error = deserializeError(event.error);
          errors.push(error);

          // Emit error event
          const errorEvent: L0Event = {
            type: "error",
            error,
            timestamp: event.ts,
          };

          if (fireCallbacks && onEvent) {
            onEvent(errorEvent);
          }

          yield errorEvent;
          break;
        }
      }
    }
  };

  // Build result
  const result: L0ReplayResult = {
    stream: streamGenerator(),
    state,
    errors,
    telemetry: monitor.export(),
    abort: () => abortController.abort(),
    streamId,
    isReplay: true,
    originalOptions,

    // Allow setting callbacks before iteration
    setCallbacks(callbacks: ReplayCallbacks) {
      onToken = callbacks.onToken;
      onViolation = callbacks.onViolation;
      onRetry = callbacks.onRetry;
      onEvent = callbacks.onEvent;
    },
  };

  return result;
}

/**
 * Create initial L0 state for replay
 */
function createInitialState(): L0State {
  return {
    content: "",
    checkpoint: "",
    tokenCount: 0,
    modelRetryCount: 0,
    networkRetryCount: 0,
    fallbackIndex: 0,
    violations: [],
    driftDetected: false,
    completed: false,
    networkErrors: [],
    resumed: false,
    dataOutputs: [],
  };
}

/**
 * Callbacks that fire during replay
 */
export interface ReplayCallbacks {
  onToken?: (token: string) => void;
  onViolation?: (violation: any) => void;
  onRetry?: (attempt: number, reason: string) => void;
  onEvent?: (event: L0Event) => void;
}

/**
 * Result from replay operation
 */
export interface L0ReplayResult extends L0Result {
  /** The stream ID that was replayed */
  streamId: string;
  /** Indicates this is a replay, not a live stream */
  isReplay: true;
  /** Original options from the recorded stream */
  originalOptions: SerializedOptions;
  /** Set callbacks before iterating */
  setCallbacks(callbacks: ReplayCallbacks): void;
}

/**
 * Compare two replay results for equality
 * Useful for testing determinism
 */
export function compareReplays(a: L0State, b: L0State): ReplayComparison {
  const differences: string[] = [];

  if (a.content !== b.content) {
    differences.push(
      `content: "${a.content.slice(0, 50)}..." vs "${b.content.slice(0, 50)}..."`,
    );
  }
  if (a.tokenCount !== b.tokenCount) {
    differences.push(`tokenCount: ${a.tokenCount} vs ${b.tokenCount}`);
  }
  if (a.completed !== b.completed) {
    differences.push(`completed: ${a.completed} vs ${b.completed}`);
  }
  if (a.modelRetryCount !== b.modelRetryCount) {
    differences.push(
      `modelRetryCount: ${a.modelRetryCount} vs ${b.modelRetryCount}`,
    );
  }
  if (a.fallbackIndex !== b.fallbackIndex) {
    differences.push(`fallbackIndex: ${a.fallbackIndex} vs ${b.fallbackIndex}`);
  }
  if (a.violations.length !== b.violations.length) {
    differences.push(
      `violations: ${a.violations.length} vs ${b.violations.length}`,
    );
  }
  if (a.driftDetected !== b.driftDetected) {
    differences.push(`driftDetected: ${a.driftDetected} vs ${b.driftDetected}`);
  }

  return {
    identical: differences.length === 0,
    differences,
  };
}

/**
 * Result of comparing two replays
 */
export interface ReplayComparison {
  identical: boolean;
  differences: string[];
}

/**
 * Get stream metadata without full replay
 */
export async function getStreamMetadata(
  eventStore: L0EventStore,
  streamId: string,
): Promise<StreamMetadata | null> {
  const exists = await eventStore.exists(streamId);
  if (!exists) return null;

  const events = await eventStore.getEvents(streamId);
  if (events.length === 0) return null;

  const startEvent = events.find((e) => e.event.type === "START");
  const completeEvent = events.find((e) => e.event.type === "COMPLETE");
  const errorEvent = events.find((e) => e.event.type === "ERROR");
  const tokenEvents = events.filter((e) => e.event.type === "TOKEN");

  return {
    streamId,
    eventCount: events.length,
    tokenCount: tokenEvents.length,
    startTs: startEvent?.event.ts ?? events[0]!.event.ts,
    endTs: (completeEvent ?? errorEvent ?? events[events.length - 1])!.event.ts,
    completed: !!completeEvent,
    hasError: !!errorEvent,
    options: startEvent
      ? (startEvent.event as { type: "START"; options: SerializedOptions })
          .options
      : {},
  };
}

/**
 * Metadata about a stored stream
 */
export interface StreamMetadata {
  streamId: string;
  eventCount: number;
  tokenCount: number;
  startTs: number;
  endTs: number;
  completed: boolean;
  hasError: boolean;
  options: SerializedOptions;
}
