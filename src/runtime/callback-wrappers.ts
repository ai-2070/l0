/**
 * Callback Wrappers
 *
 * Maps legacy L0Options callbacks to the unified observability event system.
 * Each legacy callback (onStart, onToken, etc.) becomes a filtered wrapper
 * around the EventDispatcher.
 */

import type { EventDispatcher } from "./event-dispatcher";
import type { L0Options } from "../types/l0";
import { EventType } from "../types/observability";
import type {
  SessionStartEvent,
  ErrorEvent,
  GuardrailRuleResultEvent,
  GuardrailPhaseEndEvent,
  RetryAttemptEvent,
  RetryStartEvent,
  RetryEndEvent,
  FallbackStartEvent,
  CheckpointRestoredEvent,
  CheckpointSavedEvent,
  DriftCheckStartEvent,
  DriftCheckEndEvent,
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

  // Note: onComplete is handled directly in l0.ts because it needs the full L0State object

  // onError -> ERROR
  if (options.onError) {
    const callback = options.onError;
    dispatcher.onEvent((event: L0ObservabilityEvent) => {
      if (event.type === EventType.ERROR) {
        const e = event as ErrorEvent;
        callback(new Error(e.error), e.willRetry, e.willFallback);
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
  if (options.onFallback) {
    const callback = options.onFallback;
    dispatcher.onEvent((event: L0ObservabilityEvent) => {
      if (event.type === EventType.FALLBACK_START) {
        const e = event as FallbackStartEvent;
        callback(e.toIndex, e.reason);
      }
    });
  }

  // onResume -> CHECKPOINT_RESTORED
  if (options.onResume) {
    const callback = options.onResume;
    dispatcher.onEvent((event: L0ObservabilityEvent) => {
      if (event.type === EventType.CHECKPOINT_RESTORED) {
        const e = event as CheckpointRestoredEvent;
        callback(e.checkpoint, e.tokenCount);
      }
    });
  }
}

/**
 * Type for extended callback options that include new observability callbacks
 */
export interface ObservabilityCallbacks {
  /** Called for every observability event */
  onObservabilityEvent?: (event: L0ObservabilityEvent) => void;

  /** Called when guardrail evaluation starts */
  onGuardrailStart?: (event: GuardrailPhaseEndEvent) => void;

  /** Called for each guardrail rule result */
  onGuardrail?: (event: GuardrailRuleResultEvent) => void;

  /** Called when all guardrail rules complete */
  onGuardrailEnd?: (event: GuardrailPhaseEndEvent) => void;

  /** Called when drift check starts */
  onDriftCheckStart?: (event: DriftCheckStartEvent) => void;

  /** Called when drift check ends */
  onDriftCheckEnd?: (event: DriftCheckEndEvent) => void;

  /** Called when a checkpoint is saved */
  onCheckpoint?: (event: CheckpointSavedEvent) => void;

  /** Called when retry phase starts */
  onRetryStart?: (event: RetryStartEvent) => void;

  /** Called when retry phase ends */
  onRetryEnd?: (event: RetryEndEvent) => void;

  /** Called when fallback starts */
  onFallbackStart?: (event: FallbackStartEvent) => void;
}

/**
 * Register extended observability callbacks
 */
export function registerObservabilityCallbacks(
  dispatcher: EventDispatcher,
  callbacks: ObservabilityCallbacks,
): void {
  // Main event handler
  if (callbacks.onObservabilityEvent) {
    dispatcher.onEvent(callbacks.onObservabilityEvent);
  }

  // Guardrail callbacks
  if (callbacks.onGuardrail) {
    const callback = callbacks.onGuardrail;
    dispatcher.onEvent((event: L0ObservabilityEvent) => {
      if (event.type === EventType.GUARDRAIL_RULE_RESULT) {
        callback(event as GuardrailRuleResultEvent);
      }
    });
  }

  if (callbacks.onGuardrailEnd) {
    const callback = callbacks.onGuardrailEnd;
    dispatcher.onEvent((event: L0ObservabilityEvent) => {
      if (event.type === EventType.GUARDRAIL_PHASE_END) {
        callback(event as GuardrailPhaseEndEvent);
      }
    });
  }

  // Drift callbacks
  if (callbacks.onDriftCheckStart) {
    const callback = callbacks.onDriftCheckStart;
    dispatcher.onEvent((event: L0ObservabilityEvent) => {
      if (event.type === EventType.DRIFT_CHECK_START) {
        callback(event as DriftCheckStartEvent);
      }
    });
  }

  if (callbacks.onDriftCheckEnd) {
    const callback = callbacks.onDriftCheckEnd;
    dispatcher.onEvent((event: L0ObservabilityEvent) => {
      if (event.type === EventType.DRIFT_CHECK_END) {
        callback(event as DriftCheckEndEvent);
      }
    });
  }

  // Checkpoint callback
  if (callbacks.onCheckpoint) {
    const callback = callbacks.onCheckpoint;
    dispatcher.onEvent((event: L0ObservabilityEvent) => {
      if (event.type === EventType.CHECKPOINT_SAVED) {
        callback(event as CheckpointSavedEvent);
      }
    });
  }

  // Retry callbacks
  if (callbacks.onRetryStart) {
    const callback = callbacks.onRetryStart;
    dispatcher.onEvent((event: L0ObservabilityEvent) => {
      if (event.type === EventType.RETRY_START) {
        callback(event as RetryStartEvent);
      }
    });
  }

  if (callbacks.onRetryEnd) {
    const callback = callbacks.onRetryEnd;
    dispatcher.onEvent((event: L0ObservabilityEvent) => {
      if (event.type === EventType.RETRY_END) {
        callback(event as RetryEndEvent);
      }
    });
  }

  // Fallback callback
  if (callbacks.onFallbackStart) {
    const callback = callbacks.onFallbackStart;
    dispatcher.onEvent((event: L0ObservabilityEvent) => {
      if (event.type === EventType.FALLBACK_START) {
        callback(event as FallbackStartEvent);
      }
    });
  }
}
