/**
 * Callback Wrappers
 *
 * Maps legacy L0Options callbacks to the unified observability event system.
 * Each callback (onStart, onComplete, etc.) becomes a filtered wrapper
 * around the EventDispatcher.
 */

import type { EventDispatcher } from "./event-dispatcher";
import type { L0Options } from "../types/l0";
import { EventType } from "../types/observability";
import type {
  SessionStartEvent,
  CompleteEvent,
  ErrorEvent,
  GuardrailRuleResultEvent,
  RetryAttemptEvent,
  FallbackStartEvent,
  ResumeStartEvent,
  CheckpointSavedEvent,
  DriftCheckResultEvent,
  TimeoutTriggeredEvent,
  AbortCompletedEvent,
  ToolRequestedEvent,
  L0ObservabilityEvent,
} from "../types/observability";

/**
 * Register legacy callbacks as onEvent wrappers
 *
 * This allows users to continue using the familiar callback API
 * while internally everything flows through the unified event system.
 */
export function registerCallbackWrappers(
  dispatcher: EventDispatcher,
  options: L0Options,
): void {
  // onStart -> SESSION_START
  if (options.onStart) {
    const callback = options.onStart;
    dispatcher.onEvent((event: L0ObservabilityEvent) => {
      if (event.type === EventType.SESSION_START) {
        const e = event as SessionStartEvent;
        callback(e.attempt, e.isRetry, e.isFallback);
      }
    });
  }

  // onComplete -> COMPLETE (with full L0State)
  if (options.onComplete) {
    const callback = options.onComplete;
    dispatcher.onEvent((event: L0ObservabilityEvent) => {
      if (event.type === EventType.COMPLETE) {
        const e = event as CompleteEvent;
        if (e.state) {
          callback(e.state);
        }
      }
    });
  }

  // onError -> ERROR
  // Legacy callback signature: (error, willRetry, willFallback)
  // Derived from new recoveryStrategy field
  if (options.onError) {
    const callback = options.onError;
    dispatcher.onEvent((event: L0ObservabilityEvent) => {
      if (event.type === EventType.ERROR) {
        const e = event as ErrorEvent;
        const willRetry = e.recoveryStrategy === "retry";
        const willFallback = e.recoveryStrategy === "fallback";
        callback(new Error(e.error), willRetry, willFallback);
      }
    });
  }

  // onViolation -> GUARDRAIL_RULE_RESULT (when violation exists)
  if (options.onViolation) {
    const callback = options.onViolation;
    dispatcher.onEvent((event: L0ObservabilityEvent) => {
      if (event.type === EventType.GUARDRAIL_RULE_RESULT) {
        const e = event as GuardrailRuleResultEvent;
        if (e.violation) {
          callback(e.violation);
        }
      }
    });
  }

  // onRetry -> RETRY_ATTEMPT
  if (options.onRetry) {
    const callback = options.onRetry;
    dispatcher.onEvent((event: L0ObservabilityEvent) => {
      if (event.type === EventType.RETRY_ATTEMPT) {
        const e = event as RetryAttemptEvent;
        callback(e.attempt, e.reason);
      }
    });
  }

  // onFallback -> FALLBACK_START
  // Note: toIndex is 1-based (index in allStreams), but callback expects 0-based fallback index
  if (options.onFallback) {
    const callback = options.onFallback;
    dispatcher.onEvent((event: L0ObservabilityEvent) => {
      if (event.type === EventType.FALLBACK_START) {
        const e = event as FallbackStartEvent;
        callback(e.toIndex - 1, e.reason); // Convert to 0-based fallback index
      }
    });
  }

  // onResume -> RESUME_START
  if (options.onResume) {
    const callback = options.onResume;
    dispatcher.onEvent((event: L0ObservabilityEvent) => {
      if (event.type === EventType.RESUME_START) {
        const e = event as ResumeStartEvent;
        callback(e.checkpoint, e.tokenCount);
      }
    });
  }

  // onCheckpoint -> CHECKPOINT_SAVED
  if (options.onCheckpoint) {
    const callback = options.onCheckpoint;
    dispatcher.onEvent((event: L0ObservabilityEvent) => {
      if (event.type === EventType.CHECKPOINT_SAVED) {
        const e = event as CheckpointSavedEvent;
        callback(e.checkpoint, e.tokenCount);
      }
    });
  }

  // onTimeout -> TIMEOUT_TRIGGERED
  if (options.onTimeout) {
    const callback = options.onTimeout;
    dispatcher.onEvent((event: L0ObservabilityEvent) => {
      if (event.type === EventType.TIMEOUT_TRIGGERED) {
        const e = event as TimeoutTriggeredEvent;
        callback(e.timeoutType, e.elapsedMs);
      }
    });
  }

  // onAbort -> ABORT_COMPLETED
  if (options.onAbort) {
    const callback = options.onAbort;
    dispatcher.onEvent((event: L0ObservabilityEvent) => {
      if (event.type === EventType.ABORT_COMPLETED) {
        const e = event as AbortCompletedEvent;
        callback(e.tokenCount, e.contentLength);
      }
    });
  }

  // onDrift -> DRIFT_CHECK_RESULT (when detected)
  if (options.onDrift) {
    const callback = options.onDrift;
    dispatcher.onEvent((event: L0ObservabilityEvent) => {
      if (event.type === EventType.DRIFT_CHECK_RESULT) {
        const e = event as DriftCheckResultEvent;
        if (e.detected) {
          callback(e.types, e.confidence);
        }
      }
    });
  }

  // onToolCall -> TOOL_REQUESTED
  if (options.onToolCall) {
    const callback = options.onToolCall;
    dispatcher.onEvent((event: L0ObservabilityEvent) => {
      if (event.type === EventType.TOOL_REQUESTED) {
        const e = event as ToolRequestedEvent;
        callback(e.toolName, e.toolCallId, e.arguments);
      }
    });
  }
}
