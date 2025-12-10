// Zod schemas for L0 Observability types

import { z } from "zod4";
import type {
  FailureType,
  RecoveryStrategy,
  RecoveryPolicy,
  EventCategory,
  EventType,
  L0ObservabilityEvent,
  SessionStartEvent,
  SessionEndEvent,
  SessionSummaryEvent,
  AttemptStartEvent,
  StreamInitEvent,
  StreamReadyEvent,
  AdapterDetectedEvent,
  AdapterWrapStartEvent,
  AdapterWrapEndEvent,
  TimeoutStartEvent,
  TimeoutResetEvent,
  TimeoutTriggeredEvent,
  NetworkErrorEvent,
  NetworkRecoveryEvent,
  ConnectionDroppedEvent,
  ConnectionRestoredEvent,
  AbortRequestedEvent,
  AbortCompletedEvent,
  GuardrailPhaseStartEvent,
  GuardrailRuleStartEvent,
  GuardrailRuleResultEvent,
  GuardrailRuleEndEvent,
  GuardrailPhaseEndEvent,
  GuardrailCallbackStartEvent,
  GuardrailCallbackEndEvent,
  DriftCheckStartEvent,
  DriftCheckResultEvent,
  DriftCheckEndEvent,
  DriftCheckSkippedEvent,
  CheckpointSavedEvent,
  ResumeStartEvent,
  RetryStartEvent,
  RetryAttemptEvent,
  RetryEndEvent,
  RetryGiveUpEvent,
  RetryFnStartEvent,
  RetryFnResultEvent,
  RetryFnErrorEvent,
  FallbackStartEvent,
  FallbackModelSelectedEvent,
  FallbackEndEvent,
  StructuredParseStartEvent,
  StructuredParseEndEvent,
  StructuredParseErrorEvent,
  StructuredValidationStartEvent,
  StructuredValidationEndEvent,
  StructuredValidationErrorEvent,
  StructuredAutoCorrectStartEvent,
  StructuredAutoCorrectEndEvent,
  ContinuationStartEvent,
  ToolRequestedEvent,
  ToolStartEvent,
  ToolResultEvent,
  ToolErrorEvent,
  ToolErrorType,
  ToolCompletedEvent,
  CompleteEvent,
  ErrorEvent,
} from "../types/observability";
import { GuardrailViolationSchema } from "./guardrails";
import { L0StateSchema } from "./l0";

/**
 * Failure type schema
 */
export const FailureTypeSchema: z.ZodType<FailureType> = z.enum([
  "network",
  "model",
  "tool",
  "timeout",
  "abort",
  "zero_output",
  "unknown",
]);

/**
 * Recovery strategy schema
 */
export const RecoveryStrategySchema: z.ZodType<RecoveryStrategy> = z.enum([
  "retry",
  "fallback",
  "continue",
  "halt",
]);

/**
 * Recovery policy schema
 */
export const RecoveryPolicySchema: z.ZodType<RecoveryPolicy> = z.object({
  retryEnabled: z.boolean(),
  fallbackEnabled: z.boolean(),
  maxRetries: z.number(),
  maxFallbacks: z.number(),
  attempt: z.number(),
  fallbackIndex: z.number(),
});

/**
 * Event category schema
 */
export const EventCategorySchema: z.ZodType<EventCategory> = z.enum([
  "SESSION",
  "STREAM",
  "ADAPTER",
  "TIMEOUT",
  "NETWORK",
  "ABORT",
  "GUARDRAIL",
  "DRIFT",
  "CHECKPOINT",
  "RESUME",
  "RETRY",
  "FALLBACK",
  "STRUCTURED",
  "CONTINUATION",
  "TOOL",
  "COMPLETION",
]);

/**
 * Event type schema
 */
export const EventTypeSchema: z.ZodType<EventType> = z.enum([
  "SESSION_START",
  "SESSION_END",
  "SESSION_SUMMARY",
  "ATTEMPT_START",
  "STREAM_INIT",
  "STREAM_READY",
  "ADAPTER_DETECTED",
  "ADAPTER_WRAP_START",
  "ADAPTER_WRAP_END",
  "TIMEOUT_START",
  "TIMEOUT_RESET",
  "TIMEOUT_TRIGGERED",
  "NETWORK_ERROR",
  "NETWORK_RECOVERY",
  "CONNECTION_DROPPED",
  "CONNECTION_RESTORED",
  "ABORT_REQUESTED",
  "ABORT_COMPLETED",
  "GUARDRAIL_PHASE_START",
  "GUARDRAIL_RULE_START",
  "GUARDRAIL_RULE_RESULT",
  "GUARDRAIL_RULE_END",
  "GUARDRAIL_PHASE_END",
  "GUARDRAIL_CALLBACK_START",
  "GUARDRAIL_CALLBACK_END",
  "DRIFT_CHECK_START",
  "DRIFT_CHECK_RESULT",
  "DRIFT_CHECK_END",
  "DRIFT_CHECK_SKIPPED",
  "CHECKPOINT_SAVED",
  "RESUME_START",
  "RETRY_START",
  "RETRY_ATTEMPT",
  "RETRY_END",
  "RETRY_GIVE_UP",
  "RETRY_FN_START",
  "RETRY_FN_RESULT",
  "RETRY_FN_ERROR",
  "FALLBACK_START",
  "FALLBACK_MODEL_SELECTED",
  "FALLBACK_END",
  "STRUCTURED_PARSE_START",
  "STRUCTURED_PARSE_END",
  "STRUCTURED_PARSE_ERROR",
  "STRUCTURED_VALIDATION_START",
  "STRUCTURED_VALIDATION_END",
  "STRUCTURED_VALIDATION_ERROR",
  "STRUCTURED_AUTO_CORRECT_START",
  "STRUCTURED_AUTO_CORRECT_END",
  "CONTINUATION_START",
  "TOOL_REQUESTED",
  "TOOL_START",
  "TOOL_RESULT",
  "TOOL_ERROR",
  "TOOL_COMPLETED",
  "COMPLETE",
  "ERROR",
]);

/**
 * Tool error type schema
 */
export const ToolErrorTypeSchema: z.ZodType<ToolErrorType> = z.enum([
  "NOT_FOUND",
  "TIMEOUT",
  "EXECUTION_ERROR",
  "VALIDATION_ERROR",
]);

/**
 * Base observability event schema - keep as z.object() for .extend() support
 */
const BaseObservabilityEventSchema = z.object({
  type: EventTypeSchema,
  ts: z.number(),
  streamId: z.string(),
  context: z.record(z.string(), z.unknown()),
});

export const L0ObservabilityEventSchema: z.ZodType<L0ObservabilityEvent> =
  BaseObservabilityEventSchema;

// Session events
export const SessionStartEventSchema: z.ZodType<SessionStartEvent> =
  BaseObservabilityEventSchema.extend({
    type: z.literal("SESSION_START"),
    attempt: z.number(),
    isRetry: z.boolean(),
    isFallback: z.boolean(),
  });

export const SessionEndEventSchema: z.ZodType<SessionEndEvent> =
  BaseObservabilityEventSchema.extend({
    type: z.literal("SESSION_END"),
    durationMs: z.number(),
    success: z.boolean(),
    tokenCount: z.number(),
  });

export const SessionSummaryEventSchema: z.ZodType<SessionSummaryEvent> =
  BaseObservabilityEventSchema.extend({
    type: z.literal("SESSION_SUMMARY"),
    tokenCount: z.number(),
    startTs: z.number(),
    endTs: z.number(),
    totalTokens: z.number(),
    totalRetries: z.number(),
    totalFallbacks: z.number(),
    violations: z.number(),
    driftDetected: z.boolean(),
    guardrailViolations: z.number(),
    fallbackDepth: z.number(),
    retryCount: z.number(),
    checkpointsCreated: z.number(),
  });

export const AttemptStartEventSchema: z.ZodType<AttemptStartEvent> =
  BaseObservabilityEventSchema.extend({
    type: z.literal("ATTEMPT_START"),
    attempt: z.number(),
    isRetry: z.boolean(),
    isFallback: z.boolean(),
  });

// Stream events
export const StreamInitEventSchema: z.ZodType<StreamInitEvent> =
  BaseObservabilityEventSchema.extend({
    type: z.literal("STREAM_INIT"),
  });

export const StreamReadyEventSchema: z.ZodType<StreamReadyEvent> =
  BaseObservabilityEventSchema.extend({
    type: z.literal("STREAM_READY"),
    adapterName: z.string().optional(),
  });

// Adapter events
export const AdapterDetectedEventSchema: z.ZodType<AdapterDetectedEvent> =
  BaseObservabilityEventSchema.extend({
    type: z.literal("ADAPTER_DETECTED"),
    adapterName: z.string(),
    adapter: z.string(),
  });

export const AdapterWrapStartEventSchema: z.ZodType<AdapterWrapStartEvent> =
  BaseObservabilityEventSchema.extend({
    type: z.literal("ADAPTER_WRAP_START"),
    adapterName: z.string(),
  });

export const AdapterWrapEndEventSchema: z.ZodType<AdapterWrapEndEvent> =
  BaseObservabilityEventSchema.extend({
    type: z.literal("ADAPTER_WRAP_END"),
    adapterName: z.string(),
    durationMs: z.number(),
  });

// Timeout events
export const TimeoutStartEventSchema: z.ZodType<TimeoutStartEvent> =
  BaseObservabilityEventSchema.extend({
    type: z.literal("TIMEOUT_START"),
    timeoutType: z.enum(["initial", "inter"]),
    timeoutMs: z.number(),
  });

export const TimeoutResetEventSchema: z.ZodType<TimeoutResetEvent> =
  BaseObservabilityEventSchema.extend({
    type: z.literal("TIMEOUT_RESET"),
    timeoutType: z.enum(["initial", "inter"]),
    tokenIndex: z.number().optional(),
  });

export const TimeoutTriggeredEventSchema: z.ZodType<TimeoutTriggeredEvent> =
  BaseObservabilityEventSchema.extend({
    type: z.literal("TIMEOUT_TRIGGERED"),
    timeoutType: z.enum(["initial", "inter"]),
    elapsedMs: z.number(),
  });

// Network events
export const NetworkErrorEventSchema: z.ZodType<NetworkErrorEvent> =
  BaseObservabilityEventSchema.extend({
    type: z.literal("NETWORK_ERROR"),
    error: z.string(),
    errorCode: z.string().optional(),
    code: z.string().optional(),
    category: z.string(),
    retryable: z.boolean(),
  });

export const NetworkRecoveryEventSchema: z.ZodType<NetworkRecoveryEvent> =
  BaseObservabilityEventSchema.extend({
    type: z.literal("NETWORK_RECOVERY"),
    attempt: z.number(),
    attemptCount: z.number(),
    delayMs: z.number(),
    durationMs: z.number(),
  });

export const ConnectionDroppedEventSchema: z.ZodType<ConnectionDroppedEvent> =
  BaseObservabilityEventSchema.extend({
    type: z.literal("CONNECTION_DROPPED"),
    reason: z.string().optional(),
  });

export const ConnectionRestoredEventSchema: z.ZodType<ConnectionRestoredEvent> =
  BaseObservabilityEventSchema.extend({
    type: z.literal("CONNECTION_RESTORED"),
    downtimeMs: z.number(),
  });

// Abort events
export const AbortRequestedEventSchema: z.ZodType<AbortRequestedEvent> =
  BaseObservabilityEventSchema.extend({
    type: z.literal("ABORT_REQUESTED"),
    source: z.enum(["user", "timeout", "error"]).optional(),
  });

export const AbortCompletedEventSchema: z.ZodType<AbortCompletedEvent> =
  BaseObservabilityEventSchema.extend({
    type: z.literal("ABORT_COMPLETED"),
    tokenCount: z.number(),
    contentLength: z.number(),
    resourcesFreed: z.boolean().optional(),
  });

// Guardrail events
export const GuardrailPhaseStartEventSchema: z.ZodType<GuardrailPhaseStartEvent> =
  BaseObservabilityEventSchema.extend({
    type: z.literal("GUARDRAIL_PHASE_START"),
    callbackId: z.string().optional(),
    ruleCount: z.number(),
    tokenCount: z.number(),
    contextSize: z.number().optional(),
  });

export const GuardrailRuleStartEventSchema: z.ZodType<GuardrailRuleStartEvent> =
  BaseObservabilityEventSchema.extend({
    type: z.literal("GUARDRAIL_RULE_START"),
    index: z.number(),
    ruleId: z.string(),
    callbackId: z.string().optional(),
  });

export const GuardrailRuleResultEventSchema: z.ZodType<GuardrailRuleResultEvent> =
  BaseObservabilityEventSchema.extend({
    type: z.literal("GUARDRAIL_RULE_RESULT"),
    index: z.number(),
    ruleId: z.string(),
    callbackId: z.string().optional(),
    passed: z.boolean(),
    result: z.unknown().optional(),
    violation: GuardrailViolationSchema.optional(),
    rule: z.unknown().optional(),
  });

export const GuardrailRuleEndEventSchema: z.ZodType<GuardrailRuleEndEvent> =
  BaseObservabilityEventSchema.extend({
    type: z.literal("GUARDRAIL_RULE_END"),
    index: z.number(),
    ruleId: z.string(),
    callbackId: z.string().optional(),
    durationMs: z.number(),
  });

export const GuardrailPhaseEndEventSchema: z.ZodType<GuardrailPhaseEndEvent> =
  BaseObservabilityEventSchema.extend({
    type: z.literal("GUARDRAIL_PHASE_END"),
    callbackId: z.string().optional(),
    totalDurationMs: z.number(),
    durationMs: z.number(),
    ruleCount: z.number(),
    violations: z.array(GuardrailViolationSchema),
    shouldRetry: z.boolean(),
    shouldHalt: z.boolean(),
  });

export const GuardrailCallbackStartEventSchema: z.ZodType<GuardrailCallbackStartEvent> =
  BaseObservabilityEventSchema.extend({
    type: z.literal("GUARDRAIL_CALLBACK_START"),
    callbackId: z.string().optional(),
    callbackType: z.literal("onViolation"),
    index: z.number().optional(),
    ruleId: z.string().optional(),
  });

export const GuardrailCallbackEndEventSchema: z.ZodType<GuardrailCallbackEndEvent> =
  BaseObservabilityEventSchema.extend({
    type: z.literal("GUARDRAIL_CALLBACK_END"),
    callbackId: z.string().optional(),
    callbackType: z.literal("onViolation"),
    index: z.number().optional(),
    ruleId: z.string().optional(),
    durationMs: z.number(),
    success: z.boolean().optional(),
    error: z.string().optional(),
  });

// Drift events
export const DriftCheckStartEventSchema: z.ZodType<DriftCheckStartEvent> =
  BaseObservabilityEventSchema.extend({
    type: z.literal("DRIFT_CHECK_START"),
    checkpoint: z.string().optional(),
    tokenCount: z.number(),
    contentLength: z.number(),
    strategy: z.string().optional(),
  });

export const DriftCheckResultEventSchema: z.ZodType<DriftCheckResultEvent> =
  BaseObservabilityEventSchema.extend({
    type: z.literal("DRIFT_CHECK_RESULT"),
    detected: z.boolean(),
    types: z.array(z.string()),
    confidence: z.number().optional(),
    metrics: z.record(z.string(), z.unknown()).optional(),
    threshold: z.number().optional(),
  });

export const DriftCheckEndEventSchema: z.ZodType<DriftCheckEndEvent> =
  BaseObservabilityEventSchema.extend({
    type: z.literal("DRIFT_CHECK_END"),
    durationMs: z.number(),
    detected: z.boolean(),
  });

export const DriftCheckSkippedEventSchema: z.ZodType<DriftCheckSkippedEvent> =
  BaseObservabilityEventSchema.extend({
    type: z.literal("DRIFT_CHECK_SKIPPED"),
    reason: z.string(),
  });

// Checkpoint events
export const CheckpointSavedEventSchema: z.ZodType<CheckpointSavedEvent> =
  BaseObservabilityEventSchema.extend({
    type: z.literal("CHECKPOINT_SAVED"),
    checkpoint: z.string(),
    tokenCount: z.number(),
  });

// Resume events
export const ResumeStartEventSchema: z.ZodType<ResumeStartEvent> =
  BaseObservabilityEventSchema.extend({
    type: z.literal("RESUME_START"),
    checkpoint: z.string(),
    stateHash: z.string().optional(),
    tokenCount: z.number(),
  });

// Retry events
export const RetryStartEventSchema: z.ZodType<RetryStartEvent> =
  BaseObservabilityEventSchema.extend({
    type: z.literal("RETRY_START"),
    attempt: z.number(),
    maxAttempts: z.number(),
    reason: z.string(),
  });

export const RetryAttemptEventSchema: z.ZodType<RetryAttemptEvent> =
  BaseObservabilityEventSchema.extend({
    type: z.literal("RETRY_ATTEMPT"),
    index: z.number().optional(),
    attempt: z.number(),
    maxAttempts: z.number(),
    reason: z.string(),
    delayMs: z.number(),
    countsTowardLimit: z.boolean().optional(),
    isNetwork: z.boolean().optional(),
    isModelIssue: z.boolean().optional(),
  });

export const RetryEndEventSchema: z.ZodType<RetryEndEvent> =
  BaseObservabilityEventSchema.extend({
    type: z.literal("RETRY_END"),
    attempt: z.number(),
    totalAttempts: z.number(),
    success: z.boolean(),
    durationMs: z.number().optional(),
    finalReason: z.string().optional(),
  });

export const RetryGiveUpEventSchema: z.ZodType<RetryGiveUpEvent> =
  BaseObservabilityEventSchema.extend({
    type: z.literal("RETRY_GIVE_UP"),
    totalAttempts: z.number(),
    reason: z.string(),
    lastError: z.string().optional(),
  });

export const RetryFnStartEventSchema: z.ZodType<RetryFnStartEvent> =
  BaseObservabilityEventSchema.extend({
    type: z.literal("RETRY_FN_START"),
    attempt: z.number(),
    category: z.string(),
    defaultShouldRetry: z.boolean(),
  });

export const RetryFnResultEventSchema: z.ZodType<RetryFnResultEvent> =
  BaseObservabilityEventSchema.extend({
    type: z.literal("RETRY_FN_RESULT"),
    attempt: z.number(),
    category: z.string(),
    userResult: z.boolean(),
    finalShouldRetry: z.boolean(),
    durationMs: z.number(),
  });

export const RetryFnErrorEventSchema: z.ZodType<RetryFnErrorEvent> =
  BaseObservabilityEventSchema.extend({
    type: z.literal("RETRY_FN_ERROR"),
    attempt: z.number(),
    category: z.string(),
    error: z.string(),
    finalShouldRetry: z.boolean(),
    durationMs: z.number(),
  });

// Fallback events
export const FallbackStartEventSchema: z.ZodType<FallbackStartEvent> =
  BaseObservabilityEventSchema.extend({
    type: z.literal("FALLBACK_START"),
    fromIndex: z.number(),
    toIndex: z.number(),
    reason: z.string(),
  });

export const FallbackModelSelectedEventSchema: z.ZodType<FallbackModelSelectedEvent> =
  BaseObservabilityEventSchema.extend({
    type: z.literal("FALLBACK_MODEL_SELECTED"),
    index: z.number(),
  });

export const FallbackEndEventSchema: z.ZodType<FallbackEndEvent> =
  BaseObservabilityEventSchema.extend({
    type: z.literal("FALLBACK_END"),
    finalIndex: z.number(),
    success: z.boolean(),
  });

// Structured events
export const StructuredParseStartEventSchema: z.ZodType<StructuredParseStartEvent> =
  BaseObservabilityEventSchema.extend({
    type: z.literal("STRUCTURED_PARSE_START"),
    contentLength: z.number(),
  });

export const StructuredParseEndEventSchema: z.ZodType<StructuredParseEndEvent> =
  BaseObservabilityEventSchema.extend({
    type: z.literal("STRUCTURED_PARSE_END"),
    durationMs: z.number(),
    success: z.boolean(),
  });

export const StructuredParseErrorEventSchema: z.ZodType<StructuredParseErrorEvent> =
  BaseObservabilityEventSchema.extend({
    type: z.literal("STRUCTURED_PARSE_ERROR"),
    error: z.string(),
    contentPreview: z.string().optional(),
  });

export const StructuredValidationStartEventSchema: z.ZodType<StructuredValidationStartEvent> =
  BaseObservabilityEventSchema.extend({
    type: z.literal("STRUCTURED_VALIDATION_START"),
    schemaName: z.string().optional(),
  });

export const StructuredValidationEndEventSchema: z.ZodType<StructuredValidationEndEvent> =
  BaseObservabilityEventSchema.extend({
    type: z.literal("STRUCTURED_VALIDATION_END"),
    durationMs: z.number(),
    valid: z.boolean(),
  });

export const StructuredValidationErrorEventSchema: z.ZodType<StructuredValidationErrorEvent> =
  BaseObservabilityEventSchema.extend({
    type: z.literal("STRUCTURED_VALIDATION_ERROR"),
    errors: z.array(z.string()),
  });

export const StructuredAutoCorrectStartEventSchema: z.ZodType<StructuredAutoCorrectStartEvent> =
  BaseObservabilityEventSchema.extend({
    type: z.literal("STRUCTURED_AUTO_CORRECT_START"),
    errorCount: z.number(),
  });

export const StructuredAutoCorrectEndEventSchema: z.ZodType<StructuredAutoCorrectEndEvent> =
  BaseObservabilityEventSchema.extend({
    type: z.literal("STRUCTURED_AUTO_CORRECT_END"),
    durationMs: z.number(),
    success: z.boolean(),
    correctionsMade: z.number(),
  });

// Continuation events
export const ContinuationStartEventSchema: z.ZodType<ContinuationStartEvent> =
  BaseObservabilityEventSchema.extend({
    type: z.literal("CONTINUATION_START"),
    checkpoint: z.string(),
    tokenCount: z.number(),
  });

// Tool events
export const ToolRequestedEventSchema: z.ZodType<ToolRequestedEvent> =
  BaseObservabilityEventSchema.extend({
    type: z.literal("TOOL_REQUESTED"),
    toolName: z.string(),
    toolCallId: z.string(),
    arguments: z.record(z.string(), z.unknown()),
  });

export const ToolStartEventSchema: z.ZodType<ToolStartEvent> =
  BaseObservabilityEventSchema.extend({
    type: z.literal("TOOL_START"),
    toolCallId: z.string(),
    toolName: z.string(),
  });

export const ToolResultEventSchema: z.ZodType<ToolResultEvent> =
  BaseObservabilityEventSchema.extend({
    type: z.literal("TOOL_RESULT"),
    toolCallId: z.string(),
    result: z.unknown(),
    durationMs: z.number(),
  });

export const ToolErrorEventSchema: z.ZodType<ToolErrorEvent> =
  BaseObservabilityEventSchema.extend({
    type: z.literal("TOOL_ERROR"),
    toolCallId: z.string(),
    error: z.string(),
    errorType: ToolErrorTypeSchema,
    durationMs: z.number(),
  });

export const ToolCompletedEventSchema: z.ZodType<ToolCompletedEvent> =
  BaseObservabilityEventSchema.extend({
    type: z.literal("TOOL_COMPLETED"),
    toolCallId: z.string(),
    status: z.enum(["success", "error"]),
  });

// Completion events
export const CompleteEventSchema: z.ZodType<CompleteEvent> =
  BaseObservabilityEventSchema.extend({
    type: z.literal("COMPLETE"),
    tokenCount: z.number(),
    contentLength: z.number(),
    durationMs: z.number(),
    state: L0StateSchema.optional(),
  });

export const ErrorEventSchema: z.ZodType<ErrorEvent> =
  BaseObservabilityEventSchema.extend({
    type: z.literal("ERROR"),
    error: z.string(),
    errorCode: z.string().optional(),
    failureType: FailureTypeSchema,
    recoveryStrategy: RecoveryStrategySchema,
    policy: RecoveryPolicySchema,
  });

/**
 * Union of all L0 events
 * Note: Using z.union instead of z.discriminatedUnion due to Zod 4 type inference issues
 */
export const L0EventUnionSchema = z.union([
  SessionStartEventSchema,
  SessionEndEventSchema,
  SessionSummaryEventSchema,
  AttemptStartEventSchema,
  StreamInitEventSchema,
  StreamReadyEventSchema,
  AdapterDetectedEventSchema,
  AdapterWrapStartEventSchema,
  AdapterWrapEndEventSchema,
  TimeoutStartEventSchema,
  TimeoutResetEventSchema,
  TimeoutTriggeredEventSchema,
  NetworkErrorEventSchema,
  NetworkRecoveryEventSchema,
  ConnectionDroppedEventSchema,
  ConnectionRestoredEventSchema,
  AbortRequestedEventSchema,
  AbortCompletedEventSchema,
  GuardrailPhaseStartEventSchema,
  GuardrailRuleStartEventSchema,
  GuardrailRuleResultEventSchema,
  GuardrailRuleEndEventSchema,
  GuardrailPhaseEndEventSchema,
  GuardrailCallbackStartEventSchema,
  GuardrailCallbackEndEventSchema,
  DriftCheckStartEventSchema,
  DriftCheckResultEventSchema,
  DriftCheckEndEventSchema,
  DriftCheckSkippedEventSchema,
  CheckpointSavedEventSchema,
  ResumeStartEventSchema,
  RetryStartEventSchema,
  RetryAttemptEventSchema,
  RetryEndEventSchema,
  RetryGiveUpEventSchema,
  RetryFnStartEventSchema,
  RetryFnResultEventSchema,
  RetryFnErrorEventSchema,
  FallbackStartEventSchema,
  FallbackModelSelectedEventSchema,
  FallbackEndEventSchema,
  StructuredParseStartEventSchema,
  StructuredParseEndEventSchema,
  StructuredParseErrorEventSchema,
  StructuredValidationStartEventSchema,
  StructuredValidationEndEventSchema,
  StructuredValidationErrorEventSchema,
  StructuredAutoCorrectStartEventSchema,
  StructuredAutoCorrectEndEventSchema,
  ContinuationStartEventSchema,
  ToolRequestedEventSchema,
  ToolStartEventSchema,
  ToolResultEventSchema,
  ToolErrorEventSchema,
  ToolCompletedEventSchema,
  CompleteEventSchema,
  ErrorEventSchema,
]);
