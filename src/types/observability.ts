/**
 * L0 Observability Event System
 *
 * Unified event types for all L0 lifecycle events.
 * All events include: type, ts (Unix ms), streamId (UUID v7), meta (user metadata)
 */

import type { GuardrailViolation } from "./guardrails";

// ============================================================================
// Event Categories
// ============================================================================

export const EventCategory = {
  SESSION: "SESSION",
  STREAM: "STREAM",
  ADAPTER: "ADAPTER",
  TIMEOUT: "TIMEOUT",
  NETWORK: "NETWORK",
  ABORT: "ABORT",
  GUARDRAIL: "GUARDRAIL",
  DRIFT: "DRIFT",
  CHECKPOINT: "CHECKPOINT",
  RETRY: "RETRY",
  FALLBACK: "FALLBACK",
  STRUCTURED: "STRUCTURED",
  CONTINUATION: "CONTINUATION",
  TOOL: "TOOL",
  COMPLETION: "COMPLETION",
} as const;

export type EventCategory = (typeof EventCategory)[keyof typeof EventCategory];

// ============================================================================
// Event Types by Category
// ============================================================================

/** Session lifecycle events */
export const SessionEvents = {
  SESSION_START: "SESSION_START",
  SESSION_END: "SESSION_END",
  SESSION_SUMMARY: "SESSION_SUMMARY",
} as const;

/** Stream initialization events */
export const StreamEvents = {
  STREAM_INIT: "STREAM_INIT",
  STREAM_READY: "STREAM_READY",
} as const;

/** Adapter events */
export const AdapterEvents = {
  ADAPTER_DETECTED: "ADAPTER_DETECTED",
  ADAPTER_WRAP_START: "ADAPTER_WRAP_START",
  ADAPTER_WRAP_END: "ADAPTER_WRAP_END",
} as const;

/** Timeout events */
export const TimeoutEvents = {
  TIMEOUT_START: "TIMEOUT_START",
  TIMEOUT_RESET: "TIMEOUT_RESET",
  TIMEOUT_TRIGGERED: "TIMEOUT_TRIGGERED",
} as const;

/** Network events */
export const NetworkEvents = {
  NETWORK_ERROR: "NETWORK_ERROR",
  NETWORK_RECOVERY: "NETWORK_RECOVERY",
  CONNECTION_DROPPED: "CONNECTION_DROPPED",
  CONNECTION_RESTORED: "CONNECTION_RESTORED",
} as const;

/** Abort events */
export const AbortEvents = {
  ABORT_REQUESTED: "ABORT_REQUESTED",
  ABORT_COMPLETED: "ABORT_COMPLETED",
} as const;

/** Guardrail events */
export const GuardrailEvents = {
  GUARDRAIL_PHASE_START: "GUARDRAIL_PHASE_START",
  GUARDRAIL_RULE_START: "GUARDRAIL_RULE_START",
  GUARDRAIL_RULE_RESULT: "GUARDRAIL_RULE_RESULT",
  GUARDRAIL_RULE_END: "GUARDRAIL_RULE_END",
  GUARDRAIL_PHASE_END: "GUARDRAIL_PHASE_END",
  GUARDRAIL_CALLBACK_START: "GUARDRAIL_CALLBACK_START",
  GUARDRAIL_CALLBACK_END: "GUARDRAIL_CALLBACK_END",
} as const;

/** Drift detection events */
export const DriftEvents = {
  DRIFT_CHECK_START: "DRIFT_CHECK_START",
  DRIFT_CHECK_RESULT: "DRIFT_CHECK_RESULT",
  DRIFT_CHECK_END: "DRIFT_CHECK_END",
  DRIFT_CHECK_SKIPPED: "DRIFT_CHECK_SKIPPED",
} as const;

/** Checkpoint events */
export const CheckpointEvents = {
  CHECKPOINT_START: "CHECKPOINT_START",
  CHECKPOINT_END: "CHECKPOINT_END",
  CHECKPOINT_SAVED: "CHECKPOINT_SAVED",
  CHECKPOINT_RESTORED: "CHECKPOINT_RESTORED",
} as const;

/** Retry events */
export const RetryEvents = {
  RETRY_START: "RETRY_START",
  RETRY_ATTEMPT: "RETRY_ATTEMPT",
  RETRY_END: "RETRY_END",
  RETRY_GIVE_UP: "RETRY_GIVE_UP",
} as const;

/** Fallback events */
export const FallbackEvents = {
  FALLBACK_START: "FALLBACK_START",
  FALLBACK_MODEL_SELECTED: "FALLBACK_MODEL_SELECTED",
  FALLBACK_END: "FALLBACK_END",
} as const;

/** Structured output events */
export const StructuredEvents = {
  STRUCTURED_PARSE_START: "STRUCTURED_PARSE_START",
  STRUCTURED_PARSE_END: "STRUCTURED_PARSE_END",
  STRUCTURED_PARSE_ERROR: "STRUCTURED_PARSE_ERROR",
  STRUCTURED_VALIDATION_START: "STRUCTURED_VALIDATION_START",
  STRUCTURED_VALIDATION_END: "STRUCTURED_VALIDATION_END",
  STRUCTURED_VALIDATION_ERROR: "STRUCTURED_VALIDATION_ERROR",
  STRUCTURED_AUTO_CORRECT_START: "STRUCTURED_AUTO_CORRECT_START",
  STRUCTURED_AUTO_CORRECT_END: "STRUCTURED_AUTO_CORRECT_END",
} as const;

/** Continuation events */
export const ContinuationEvents = {
  CONTINUATION_START: "CONTINUATION_START",
  CONTINUATION_END: "CONTINUATION_END",
  CONTINUATION_DEDUPLICATION_START: "CONTINUATION_DEDUPLICATION_START",
  CONTINUATION_DEDUPLICATION_END: "CONTINUATION_DEDUPLICATION_END",
} as const;

/** Tool use events */
export const ToolEvents = {
  TOOL_REQUESTED: "TOOL_REQUESTED",
  TOOL_START: "TOOL_START",
  TOOL_RESULT: "TOOL_RESULT",
  TOOL_ERROR: "TOOL_ERROR",
  TOOL_COMPLETED: "TOOL_COMPLETED",
} as const;

/** Completion events */
export const CompletionEvents = {
  TOKEN: "TOKEN",
  COMPLETE: "COMPLETE",
  ERROR: "ERROR",
} as const;

// ============================================================================
// Combined Event Type
// ============================================================================

/** All event types */
export const EventType = {
  ...SessionEvents,
  ...StreamEvents,
  ...AdapterEvents,
  ...TimeoutEvents,
  ...NetworkEvents,
  ...AbortEvents,
  ...GuardrailEvents,
  ...DriftEvents,
  ...CheckpointEvents,
  ...RetryEvents,
  ...FallbackEvents,
  ...StructuredEvents,
  ...ContinuationEvents,
  ...ToolEvents,
  ...CompletionEvents,
} as const;

export type EventType = (typeof EventType)[keyof typeof EventType];

/** Map of category to its event types */
export const EventTypesByCategory = {
  [EventCategory.SESSION]: SessionEvents,
  [EventCategory.STREAM]: StreamEvents,
  [EventCategory.ADAPTER]: AdapterEvents,
  [EventCategory.TIMEOUT]: TimeoutEvents,
  [EventCategory.NETWORK]: NetworkEvents,
  [EventCategory.ABORT]: AbortEvents,
  [EventCategory.GUARDRAIL]: GuardrailEvents,
  [EventCategory.DRIFT]: DriftEvents,
  [EventCategory.CHECKPOINT]: CheckpointEvents,
  [EventCategory.RETRY]: RetryEvents,
  [EventCategory.FALLBACK]: FallbackEvents,
  [EventCategory.STRUCTURED]: StructuredEvents,
  [EventCategory.CONTINUATION]: ContinuationEvents,
  [EventCategory.TOOL]: ToolEvents,
  [EventCategory.COMPLETION]: CompletionEvents,
} as const;

// ============================================================================
// Base Event Interface
// ============================================================================

/**
 * Base event structure - all events include these fields
 */
export interface L0ObservabilityEvent {
  /** Event type identifier */
  type: EventType;
  /** Unix epoch milliseconds */
  ts: number;
  /** UUID v7 stream identifier */
  streamId: string;
  /** User-provided metadata (immutable for session) */
  meta: Record<string, unknown>;
}

/**
 * Event handler type
 */
export type L0EventHandler = (event: L0ObservabilityEvent) => void;

// ============================================================================
// Session Events
// ============================================================================

export interface SessionStartEvent extends L0ObservabilityEvent {
  type: "SESSION_START";
  attempt: number;
  isRetry: boolean;
  isFallback: boolean;
}

export interface SessionEndEvent extends L0ObservabilityEvent {
  type: "SESSION_END";
  durationMs: number;
  success: boolean;
  tokenCount: number;
}

export interface SessionSummaryEvent extends L0ObservabilityEvent {
  type: "SESSION_SUMMARY";
  totalTokens: number;
  totalRetries: number;
  totalFallbacks: number;
  violations: number;
  driftDetected: boolean;
}

// ============================================================================
// Stream Events
// ============================================================================

export interface StreamInitEvent extends L0ObservabilityEvent {
  type: "STREAM_INIT";
}

export interface StreamReadyEvent extends L0ObservabilityEvent {
  type: "STREAM_READY";
  adapterName?: string;
}

// ============================================================================
// Adapter Events
// ============================================================================

export interface AdapterDetectedEvent extends L0ObservabilityEvent {
  type: "ADAPTER_DETECTED";
  adapterName: string;
}

export interface AdapterWrapStartEvent extends L0ObservabilityEvent {
  type: "ADAPTER_WRAP_START";
  adapterName: string;
}

export interface AdapterWrapEndEvent extends L0ObservabilityEvent {
  type: "ADAPTER_WRAP_END";
  adapterName: string;
  durationMs: number;
}

// ============================================================================
// Timeout Events
// ============================================================================

export interface TimeoutStartEvent extends L0ObservabilityEvent {
  type: "TIMEOUT_START";
  timeoutType: "initial" | "inter";
  timeoutMs: number;
}

export interface TimeoutResetEvent extends L0ObservabilityEvent {
  type: "TIMEOUT_RESET";
  timeoutType: "initial" | "inter";
}

export interface TimeoutTriggeredEvent extends L0ObservabilityEvent {
  type: "TIMEOUT_TRIGGERED";
  timeoutType: "initial" | "inter";
  elapsedMs: number;
}

// ============================================================================
// Network Events
// ============================================================================

export interface NetworkErrorEvent extends L0ObservabilityEvent {
  type: "NETWORK_ERROR";
  error: string;
  errorCode?: string;
  category: string;
}

export interface NetworkRecoveryEvent extends L0ObservabilityEvent {
  type: "NETWORK_RECOVERY";
  attempt: number;
  delayMs: number;
}

export interface ConnectionDroppedEvent extends L0ObservabilityEvent {
  type: "CONNECTION_DROPPED";
  reason?: string;
}

export interface ConnectionRestoredEvent extends L0ObservabilityEvent {
  type: "CONNECTION_RESTORED";
  downtimeMs: number;
}

// ============================================================================
// Abort Events
// ============================================================================

export interface AbortRequestedEvent extends L0ObservabilityEvent {
  type: "ABORT_REQUESTED";
}

export interface AbortCompletedEvent extends L0ObservabilityEvent {
  type: "ABORT_COMPLETED";
  tokenCount: number;
  contentLength: number;
}

// ============================================================================
// Guardrail Events
// ============================================================================

export interface GuardrailPhaseStartEvent extends L0ObservabilityEvent {
  type: "GUARDRAIL_PHASE_START";
  ruleCount: number;
  tokenCount: number;
}

export interface GuardrailRuleStartEvent extends L0ObservabilityEvent {
  type: "GUARDRAIL_RULE_START";
  index: number;
  ruleId: string;
}

export interface GuardrailRuleResultEvent extends L0ObservabilityEvent {
  type: "GUARDRAIL_RULE_RESULT";
  index: number;
  ruleId: string;
  passed: boolean;
  violation?: GuardrailViolation;
  /** The rule callback for inspection */
  rule?: unknown;
}

export interface GuardrailRuleEndEvent extends L0ObservabilityEvent {
  type: "GUARDRAIL_RULE_END";
  index: number;
  ruleId: string;
  durationMs: number;
}

export interface GuardrailPhaseEndEvent extends L0ObservabilityEvent {
  type: "GUARDRAIL_PHASE_END";
  totalDurationMs: number;
  ruleCount: number;
  violations: GuardrailViolation[];
  shouldRetry: boolean;
  shouldHalt: boolean;
}

export interface GuardrailCallbackStartEvent extends L0ObservabilityEvent {
  type: "GUARDRAIL_CALLBACK_START";
  callbackType: "onViolation";
}

export interface GuardrailCallbackEndEvent extends L0ObservabilityEvent {
  type: "GUARDRAIL_CALLBACK_END";
  callbackType: "onViolation";
  durationMs: number;
}

// ============================================================================
// Drift Events
// ============================================================================

export interface DriftCheckStartEvent extends L0ObservabilityEvent {
  type: "DRIFT_CHECK_START";
  tokenCount: number;
  contentLength: number;
}

export interface DriftCheckResultEvent extends L0ObservabilityEvent {
  type: "DRIFT_CHECK_RESULT";
  detected: boolean;
  types: string[];
  confidence?: number;
}

export interface DriftCheckEndEvent extends L0ObservabilityEvent {
  type: "DRIFT_CHECK_END";
  durationMs: number;
  detected: boolean;
}

export interface DriftCheckSkippedEvent extends L0ObservabilityEvent {
  type: "DRIFT_CHECK_SKIPPED";
  reason: string;
}

// ============================================================================
// Checkpoint Events
// ============================================================================

export interface CheckpointStartEvent extends L0ObservabilityEvent {
  type: "CHECKPOINT_START";
  tokenCount: number;
}

export interface CheckpointEndEvent extends L0ObservabilityEvent {
  type: "CHECKPOINT_END";
  durationMs: number;
}

export interface CheckpointSavedEvent extends L0ObservabilityEvent {
  type: "CHECKPOINT_SAVED";
  checkpoint: string;
  tokenCount: number;
  contentLength: number;
}

export interface CheckpointRestoredEvent extends L0ObservabilityEvent {
  type: "CHECKPOINT_RESTORED";
  checkpoint: string;
  tokenCount: number;
}

// ============================================================================
// Retry Events
// ============================================================================

export interface RetryStartEvent extends L0ObservabilityEvent {
  type: "RETRY_START";
  maxAttempts: number;
  reason: string;
}

export interface RetryAttemptEvent extends L0ObservabilityEvent {
  type: "RETRY_ATTEMPT";
  attempt: number;
  maxAttempts: number;
  reason: string;
  delayMs: number;
}

export interface RetryEndEvent extends L0ObservabilityEvent {
  type: "RETRY_END";
  totalAttempts: number;
  success: boolean;
  finalReason?: string;
}

export interface RetryGiveUpEvent extends L0ObservabilityEvent {
  type: "RETRY_GIVE_UP";
  totalAttempts: number;
  reason: string;
  lastError?: string;
}

// ============================================================================
// Fallback Events
// ============================================================================

export interface FallbackStartEvent extends L0ObservabilityEvent {
  type: "FALLBACK_START";
  fromIndex: number;
  toIndex: number;
  reason: string;
}

export interface FallbackModelSelectedEvent extends L0ObservabilityEvent {
  type: "FALLBACK_MODEL_SELECTED";
  index: number;
  model?: string;
}

export interface FallbackEndEvent extends L0ObservabilityEvent {
  type: "FALLBACK_END";
  finalIndex: number;
  success: boolean;
}

// ============================================================================
// Structured Output Events
// ============================================================================

export interface StructuredParseStartEvent extends L0ObservabilityEvent {
  type: "STRUCTURED_PARSE_START";
  contentLength: number;
}

export interface StructuredParseEndEvent extends L0ObservabilityEvent {
  type: "STRUCTURED_PARSE_END";
  durationMs: number;
  success: boolean;
}

export interface StructuredParseErrorEvent extends L0ObservabilityEvent {
  type: "STRUCTURED_PARSE_ERROR";
  error: string;
  contentPreview?: string;
}

export interface StructuredValidationStartEvent extends L0ObservabilityEvent {
  type: "STRUCTURED_VALIDATION_START";
  schemaName?: string;
}

export interface StructuredValidationEndEvent extends L0ObservabilityEvent {
  type: "STRUCTURED_VALIDATION_END";
  durationMs: number;
  valid: boolean;
}

export interface StructuredValidationErrorEvent extends L0ObservabilityEvent {
  type: "STRUCTURED_VALIDATION_ERROR";
  errors: string[];
}

export interface StructuredAutoCorrectStartEvent extends L0ObservabilityEvent {
  type: "STRUCTURED_AUTO_CORRECT_START";
  errorCount: number;
}

export interface StructuredAutoCorrectEndEvent extends L0ObservabilityEvent {
  type: "STRUCTURED_AUTO_CORRECT_END";
  durationMs: number;
  success: boolean;
  correctionsMade: number;
}

// ============================================================================
// Continuation Events
// ============================================================================

export interface ContinuationStartEvent extends L0ObservabilityEvent {
  type: "CONTINUATION_START";
  checkpoint: string;
  tokenCount: number;
}

export interface ContinuationEndEvent extends L0ObservabilityEvent {
  type: "CONTINUATION_END";
  durationMs: number;
  success: boolean;
}

export interface ContinuationDeduplicationStartEvent extends L0ObservabilityEvent {
  type: "CONTINUATION_DEDUPLICATION_START";
  overlapLength: number;
}

export interface ContinuationDeduplicationEndEvent extends L0ObservabilityEvent {
  type: "CONTINUATION_DEDUPLICATION_END";
  durationMs: number;
  deduplicatedLength: number;
}

// ============================================================================
// Tool Events
// ============================================================================

export interface ToolRequestedEvent extends L0ObservabilityEvent {
  type: "TOOL_REQUESTED";
  toolName: string;
  toolCallId: string;
  arguments: Record<string, unknown>;
}

export interface ToolStartEvent extends L0ObservabilityEvent {
  type: "TOOL_START";
  toolCallId: string;
  toolName: string;
}

export interface ToolResultEvent extends L0ObservabilityEvent {
  type: "TOOL_RESULT";
  toolCallId: string;
  result: unknown;
  durationMs: number;
}

export type ToolErrorType =
  | "NOT_FOUND"
  | "TIMEOUT"
  | "EXECUTION_ERROR"
  | "VALIDATION_ERROR";

export interface ToolErrorEvent extends L0ObservabilityEvent {
  type: "TOOL_ERROR";
  toolCallId: string;
  error: string;
  errorType: ToolErrorType;
  durationMs: number;
}

export interface ToolCompletedEvent extends L0ObservabilityEvent {
  type: "TOOL_COMPLETED";
  toolCallId: string;
  status: "success" | "error";
}

// ============================================================================
// Completion Events
// ============================================================================

export interface TokenEvent extends L0ObservabilityEvent {
  type: "TOKEN";
  value: string;
  index: number;
}

export interface CompleteEvent extends L0ObservabilityEvent {
  type: "COMPLETE";
  tokenCount: number;
  contentLength: number;
  durationMs: number;
}

export interface ErrorEvent extends L0ObservabilityEvent {
  type: "ERROR";
  error: string;
  errorCode?: string;
  recoverable: boolean;
  willRetry: boolean;
  willFallback: boolean;
}

// ============================================================================
// Union Types
// ============================================================================

export type L0Event =
  // Session
  | SessionStartEvent
  | SessionEndEvent
  | SessionSummaryEvent
  // Stream
  | StreamInitEvent
  | StreamReadyEvent
  // Adapter
  | AdapterDetectedEvent
  | AdapterWrapStartEvent
  | AdapterWrapEndEvent
  // Timeout
  | TimeoutStartEvent
  | TimeoutResetEvent
  | TimeoutTriggeredEvent
  // Network
  | NetworkErrorEvent
  | NetworkRecoveryEvent
  | ConnectionDroppedEvent
  | ConnectionRestoredEvent
  // Abort
  | AbortRequestedEvent
  | AbortCompletedEvent
  // Guardrail
  | GuardrailPhaseStartEvent
  | GuardrailRuleStartEvent
  | GuardrailRuleResultEvent
  | GuardrailRuleEndEvent
  | GuardrailPhaseEndEvent
  | GuardrailCallbackStartEvent
  | GuardrailCallbackEndEvent
  // Drift
  | DriftCheckStartEvent
  | DriftCheckResultEvent
  | DriftCheckEndEvent
  | DriftCheckSkippedEvent
  // Checkpoint
  | CheckpointStartEvent
  | CheckpointEndEvent
  | CheckpointSavedEvent
  | CheckpointRestoredEvent
  // Retry
  | RetryStartEvent
  | RetryAttemptEvent
  | RetryEndEvent
  | RetryGiveUpEvent
  // Fallback
  | FallbackStartEvent
  | FallbackModelSelectedEvent
  | FallbackEndEvent
  // Structured
  | StructuredParseStartEvent
  | StructuredParseEndEvent
  | StructuredParseErrorEvent
  | StructuredValidationStartEvent
  | StructuredValidationEndEvent
  | StructuredValidationErrorEvent
  | StructuredAutoCorrectStartEvent
  | StructuredAutoCorrectEndEvent
  // Continuation
  | ContinuationStartEvent
  | ContinuationEndEvent
  | ContinuationDeduplicationStartEvent
  | ContinuationDeduplicationEndEvent
  // Tool
  | ToolRequestedEvent
  | ToolStartEvent
  | ToolResultEvent
  | ToolErrorEvent
  | ToolCompletedEvent
  // Completion
  | TokenEvent
  | CompleteEvent
  | ErrorEvent;

// ============================================================================
// Serialization Helpers
// ============================================================================

/**
 * Serialize an event to JSON string
 * Handles Error objects specially for replay compatibility
 */
export function serializeEvent(event: L0ObservabilityEvent): string {
  return JSON.stringify(event, (_key, value) => {
    if (value instanceof Error) {
      return {
        __type: "Error",
        name: value.name,
        message: value.message,
        stack: value.stack,
      };
    }
    return value;
  });
}

/**
 * Deserialize a JSON string to an event
 * Reconstructs Error objects
 */
export function deserializeEvent(json: string): L0ObservabilityEvent {
  return JSON.parse(json, (_key, value) => {
    if (value?.__type === "Error") {
      const err = new Error(value.message);
      err.name = value.name;
      err.stack = value.stack;
      return err;
    }
    return value;
  });
}
