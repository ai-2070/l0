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
export const FailureTypeSchema = z.enum([
  "network",
  "model",
  "tool",
  "timeout",
  "abort",
  "zero_output",
  "unknown",
]) satisfies z.ZodType<FailureType>;

/**
 * Recovery strategy schema
 */
export const RecoveryStrategySchema = z.enum([
  "retry",
  "fallback",
  "continue",
  "halt",
]) satisfies z.ZodType<RecoveryStrategy>;

/**
 * Recovery policy schema
 */
export const RecoveryPolicySchema = z.object({
  retryEnabled: z.boolean(),
  fallbackEnabled: z.boolean(),
  maxRetries: z.number(),
  maxFallbacks: z.number(),
  attempt: z.number(),
  fallbackIndex: z.number(),
}) satisfies z.ZodType<RecoveryPolicy>;

/**
 * Event category schema
 */
export const EventCategorySchema = z.enum([
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
]) satisfies z.ZodType<EventCategory>;

/**
 * Event type schema
 */
export const EventTypeSchema = z.enum([
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
]) satisfies z.ZodType<EventType>;

/**
 * Tool error type schema
 */
export const ToolErrorTypeSchema = z.enum([
  "NOT_FOUND",
  "TIMEOUT",
  "EXECUTION_ERROR",
  "VALIDATION_ERROR",
]) satisfies z.ZodType<ToolErrorType>;

/**
 * Base observability event schema
 */
export const L0ObservabilityEventSchema = z.object({
  type: EventTypeSchema,
  ts: z.number(),
  streamId: z.string(),
  context: z.record(z.unknown()),
}) satisfies z.ZodType<L0ObservabilityEvent>;

// Session events
export const SessionStartEventSchema = L0ObservabilityEventSchema.extend({
  type: z.literal("SESSION_START"),
  attempt: z.number(),
  isRetry: z.boolean(),
  isFallback: z.boolean(),
}) satisfies z.ZodType<SessionStartEvent>;

export const SessionEndEventSchema = L0ObservabilityEventSchema.extend({
  type: z.literal("SESSION_END"),
  durationMs: z.number(),
  success: z.boolean(),
  tokenCount: z.number(),
}) satisfies z.ZodType<SessionEndEvent>;

export const SessionSummaryEventSchema = L0ObservabilityEventSchema.extend({
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
}) satisfies z.ZodType<SessionSummaryEvent>;

export const AttemptStartEventSchema = L0ObservabilityEventSchema.extend({
  type: z.literal("ATTEMPT_START"),
  attempt: z.number(),
  isRetry: z.boolean(),
  isFallback: z.boolean(),
}) satisfies z.ZodType<AttemptStartEvent>;

// Stream events
export const StreamInitEventSchema = L0ObservabilityEventSchema.extend({
  type: z.literal("STREAM_INIT"),
}) satisfies z.ZodType<StreamInitEvent>;

export const StreamReadyEventSchema = L0ObservabilityEventSchema.extend({
  type: z.literal("STREAM_READY"),
  adapterName: z.string().optional(),
}) satisfies z.ZodType<StreamReadyEvent>;

// Adapter events
export const AdapterDetectedEventSchema = L0ObservabilityEventSchema.extend({
  type: z.literal("ADAPTER_DETECTED"),
  adapterName: z.string(),
  adapter: z.string(),
}) satisfies z.ZodType<AdapterDetectedEvent>;

export const AdapterWrapStartEventSchema = L0ObservabilityEventSchema.extend({
  type: z.literal("ADAPTER_WRAP_START"),
  adapterName: z.string(),
}) satisfies z.ZodType<AdapterWrapStartEvent>;

export const AdapterWrapEndEventSchema = L0ObservabilityEventSchema.extend({
  type: z.literal("ADAPTER_WRAP_END"),
  adapterName: z.string(),
  durationMs: z.number(),
}) satisfies z.ZodType<AdapterWrapEndEvent>;

// Timeout events
export const TimeoutStartEventSchema = L0ObservabilityEventSchema.extend({
  type: z.literal("TIMEOUT_START"),
  timeoutType: z.enum(["initial", "inter"]),
  timeoutMs: z.number(),
}) satisfies z.ZodType<TimeoutStartEvent>;

export const TimeoutResetEventSchema = L0ObservabilityEventSchema.extend({
  type: z.literal("TIMEOUT_RESET"),
  timeoutType: z.enum(["initial", "inter"]),
  tokenIndex: z.number().optional(),
}) satisfies z.ZodType<TimeoutResetEvent>;

export const TimeoutTriggeredEventSchema = L0ObservabilityEventSchema.extend({
  type: z.literal("TIMEOUT_TRIGGERED"),
  timeoutType: z.enum(["initial", "inter"]),
  elapsedMs: z.number(),
}) satisfies z.ZodType<TimeoutTriggeredEvent>;

// Network events
export const NetworkErrorEventSchema = L0ObservabilityEventSchema.extend({
  type: z.literal("NETWORK_ERROR"),
  error: z.string(),
  errorCode: z.string().optional(),
  code: z.string().optional(),
  category: z.string(),
  retryable: z.boolean(),
}) satisfies z.ZodType<NetworkErrorEvent>;

export const NetworkRecoveryEventSchema = L0ObservabilityEventSchema.extend({
  type: z.literal("NETWORK_RECOVERY"),
  attempt: z.number(),
  attemptCount: z.number(),
  delayMs: z.number(),
  durationMs: z.number(),
}) satisfies z.ZodType<NetworkRecoveryEvent>;

export const ConnectionDroppedEventSchema = L0ObservabilityEventSchema.extend({
  type: z.literal("CONNECTION_DROPPED"),
  reason: z.string().optional(),
}) satisfies z.ZodType<ConnectionDroppedEvent>;

export const ConnectionRestoredEventSchema = L0ObservabilityEventSchema.extend({
  type: z.literal("CONNECTION_RESTORED"),
  downtimeMs: z.number(),
}) satisfies z.ZodType<ConnectionRestoredEvent>;

// Abort events
export const AbortRequestedEventSchema = L0ObservabilityEventSchema.extend({
  type: z.literal("ABORT_REQUESTED"),
  source: z.enum(["user", "timeout", "error"]).optional(),
}) satisfies z.ZodType<AbortRequestedEvent>;

export const AbortCompletedEventSchema = L0ObservabilityEventSchema.extend({
  type: z.literal("ABORT_COMPLETED"),
  tokenCount: z.number(),
  contentLength: z.number(),
  resourcesFreed: z.boolean().optional(),
}) satisfies z.ZodType<AbortCompletedEvent>;

// Guardrail events
export const GuardrailPhaseStartEventSchema = L0ObservabilityEventSchema.extend(
  {
    type: z.literal("GUARDRAIL_PHASE_START"),
    callbackId: z.string().optional(),
    ruleCount: z.number(),
    tokenCount: z.number(),
    contextSize: z.number().optional(),
  },
) satisfies z.ZodType<GuardrailPhaseStartEvent>;

export const GuardrailRuleStartEventSchema = L0ObservabilityEventSchema.extend({
  type: z.literal("GUARDRAIL_RULE_START"),
  index: z.number(),
  ruleId: z.string(),
  callbackId: z.string().optional(),
}) satisfies z.ZodType<GuardrailRuleStartEvent>;

export const GuardrailRuleResultEventSchema = L0ObservabilityEventSchema.extend(
  {
    type: z.literal("GUARDRAIL_RULE_RESULT"),
    index: z.number(),
    ruleId: z.string(),
    callbackId: z.string().optional(),
    passed: z.boolean(),
    result: z.unknown().optional(),
    violation: GuardrailViolationSchema.optional(),
    rule: z.unknown().optional(),
  },
) satisfies z.ZodType<GuardrailRuleResultEvent>;

export const GuardrailRuleEndEventSchema = L0ObservabilityEventSchema.extend({
  type: z.literal("GUARDRAIL_RULE_END"),
  index: z.number(),
  ruleId: z.string(),
  callbackId: z.string().optional(),
  durationMs: z.number(),
}) satisfies z.ZodType<GuardrailRuleEndEvent>;

export const GuardrailPhaseEndEventSchema = L0ObservabilityEventSchema.extend({
  type: z.literal("GUARDRAIL_PHASE_END"),
  callbackId: z.string().optional(),
  totalDurationMs: z.number(),
  durationMs: z.number(),
  ruleCount: z.number(),
  violations: z.array(GuardrailViolationSchema),
  shouldRetry: z.boolean(),
  shouldHalt: z.boolean(),
}) satisfies z.ZodType<GuardrailPhaseEndEvent>;

export const GuardrailCallbackStartEventSchema =
  L0ObservabilityEventSchema.extend({
    type: z.literal("GUARDRAIL_CALLBACK_START"),
    callbackId: z.string().optional(),
    callbackType: z.literal("onViolation"),
    index: z.number().optional(),
    ruleId: z.string().optional(),
  }) satisfies z.ZodType<GuardrailCallbackStartEvent>;

export const GuardrailCallbackEndEventSchema =
  L0ObservabilityEventSchema.extend({
    type: z.literal("GUARDRAIL_CALLBACK_END"),
    callbackId: z.string().optional(),
    callbackType: z.literal("onViolation"),
    index: z.number().optional(),
    ruleId: z.string().optional(),
    durationMs: z.number(),
    success: z.boolean().optional(),
    error: z.string().optional(),
  }) satisfies z.ZodType<GuardrailCallbackEndEvent>;

// Drift events
export const DriftCheckStartEventSchema = L0ObservabilityEventSchema.extend({
  type: z.literal("DRIFT_CHECK_START"),
  checkpoint: z.string().optional(),
  tokenCount: z.number(),
  contentLength: z.number(),
  strategy: z.string().optional(),
}) satisfies z.ZodType<DriftCheckStartEvent>;

export const DriftCheckResultEventSchema = L0ObservabilityEventSchema.extend({
  type: z.literal("DRIFT_CHECK_RESULT"),
  detected: z.boolean(),
  types: z.array(z.string()),
  confidence: z.number().optional(),
  metrics: z.record(z.unknown()).optional(),
  threshold: z.number().optional(),
}) satisfies z.ZodType<DriftCheckResultEvent>;

export const DriftCheckEndEventSchema = L0ObservabilityEventSchema.extend({
  type: z.literal("DRIFT_CHECK_END"),
  durationMs: z.number(),
  detected: z.boolean(),
}) satisfies z.ZodType<DriftCheckEndEvent>;

export const DriftCheckSkippedEventSchema = L0ObservabilityEventSchema.extend({
  type: z.literal("DRIFT_CHECK_SKIPPED"),
  reason: z.string(),
}) satisfies z.ZodType<DriftCheckSkippedEvent>;

// Checkpoint events
export const CheckpointSavedEventSchema = L0ObservabilityEventSchema.extend({
  type: z.literal("CHECKPOINT_SAVED"),
  checkpoint: z.string(),
  tokenCount: z.number(),
}) satisfies z.ZodType<CheckpointSavedEvent>;

// Resume events
export const ResumeStartEventSchema = L0ObservabilityEventSchema.extend({
  type: z.literal("RESUME_START"),
  checkpoint: z.string(),
  stateHash: z.string().optional(),
  tokenCount: z.number(),
}) satisfies z.ZodType<ResumeStartEvent>;

// Retry events
export const RetryStartEventSchema = L0ObservabilityEventSchema.extend({
  type: z.literal("RETRY_START"),
  attempt: z.number(),
  maxAttempts: z.number(),
  reason: z.string(),
}) satisfies z.ZodType<RetryStartEvent>;

export const RetryAttemptEventSchema = L0ObservabilityEventSchema.extend({
  type: z.literal("RETRY_ATTEMPT"),
  index: z.number().optional(),
  attempt: z.number(),
  maxAttempts: z.number(),
  reason: z.string(),
  delayMs: z.number(),
  countsTowardLimit: z.boolean().optional(),
  isNetwork: z.boolean().optional(),
  isModelIssue: z.boolean().optional(),
}) satisfies z.ZodType<RetryAttemptEvent>;

export const RetryEndEventSchema = L0ObservabilityEventSchema.extend({
  type: z.literal("RETRY_END"),
  attempt: z.number(),
  totalAttempts: z.number(),
  success: z.boolean(),
  durationMs: z.number().optional(),
  finalReason: z.string().optional(),
}) satisfies z.ZodType<RetryEndEvent>;

export const RetryGiveUpEventSchema = L0ObservabilityEventSchema.extend({
  type: z.literal("RETRY_GIVE_UP"),
  totalAttempts: z.number(),
  reason: z.string(),
  lastError: z.string().optional(),
}) satisfies z.ZodType<RetryGiveUpEvent>;

export const RetryFnStartEventSchema = L0ObservabilityEventSchema.extend({
  type: z.literal("RETRY_FN_START"),
  attempt: z.number(),
  category: z.string(),
  defaultShouldRetry: z.boolean(),
}) satisfies z.ZodType<RetryFnStartEvent>;

export const RetryFnResultEventSchema = L0ObservabilityEventSchema.extend({
  type: z.literal("RETRY_FN_RESULT"),
  attempt: z.number(),
  category: z.string(),
  userResult: z.boolean(),
  finalShouldRetry: z.boolean(),
  durationMs: z.number(),
}) satisfies z.ZodType<RetryFnResultEvent>;

export const RetryFnErrorEventSchema = L0ObservabilityEventSchema.extend({
  type: z.literal("RETRY_FN_ERROR"),
  attempt: z.number(),
  category: z.string(),
  error: z.string(),
  finalShouldRetry: z.boolean(),
  durationMs: z.number(),
}) satisfies z.ZodType<RetryFnErrorEvent>;

// Fallback events
export const FallbackStartEventSchema = L0ObservabilityEventSchema.extend({
  type: z.literal("FALLBACK_START"),
  fromIndex: z.number(),
  toIndex: z.number(),
  reason: z.string(),
}) satisfies z.ZodType<FallbackStartEvent>;

export const FallbackModelSelectedEventSchema =
  L0ObservabilityEventSchema.extend({
    type: z.literal("FALLBACK_MODEL_SELECTED"),
    index: z.number(),
  }) satisfies z.ZodType<FallbackModelSelectedEvent>;

export const FallbackEndEventSchema = L0ObservabilityEventSchema.extend({
  type: z.literal("FALLBACK_END"),
  finalIndex: z.number(),
  success: z.boolean(),
}) satisfies z.ZodType<FallbackEndEvent>;

// Structured events
export const StructuredParseStartEventSchema =
  L0ObservabilityEventSchema.extend({
    type: z.literal("STRUCTURED_PARSE_START"),
    contentLength: z.number(),
  }) satisfies z.ZodType<StructuredParseStartEvent>;

export const StructuredParseEndEventSchema = L0ObservabilityEventSchema.extend({
  type: z.literal("STRUCTURED_PARSE_END"),
  durationMs: z.number(),
  success: z.boolean(),
}) satisfies z.ZodType<StructuredParseEndEvent>;

export const StructuredParseErrorEventSchema =
  L0ObservabilityEventSchema.extend({
    type: z.literal("STRUCTURED_PARSE_ERROR"),
    error: z.string(),
    contentPreview: z.string().optional(),
  }) satisfies z.ZodType<StructuredParseErrorEvent>;

export const StructuredValidationStartEventSchema =
  L0ObservabilityEventSchema.extend({
    type: z.literal("STRUCTURED_VALIDATION_START"),
    schemaName: z.string().optional(),
  }) satisfies z.ZodType<StructuredValidationStartEvent>;

export const StructuredValidationEndEventSchema =
  L0ObservabilityEventSchema.extend({
    type: z.literal("STRUCTURED_VALIDATION_END"),
    durationMs: z.number(),
    valid: z.boolean(),
  }) satisfies z.ZodType<StructuredValidationEndEvent>;

export const StructuredValidationErrorEventSchema =
  L0ObservabilityEventSchema.extend({
    type: z.literal("STRUCTURED_VALIDATION_ERROR"),
    errors: z.array(z.string()),
  }) satisfies z.ZodType<StructuredValidationErrorEvent>;

export const StructuredAutoCorrectStartEventSchema =
  L0ObservabilityEventSchema.extend({
    type: z.literal("STRUCTURED_AUTO_CORRECT_START"),
    errorCount: z.number(),
  }) satisfies z.ZodType<StructuredAutoCorrectStartEvent>;

export const StructuredAutoCorrectEndEventSchema =
  L0ObservabilityEventSchema.extend({
    type: z.literal("STRUCTURED_AUTO_CORRECT_END"),
    durationMs: z.number(),
    success: z.boolean(),
    correctionsMade: z.number(),
  }) satisfies z.ZodType<StructuredAutoCorrectEndEvent>;

// Continuation events
export const ContinuationStartEventSchema = L0ObservabilityEventSchema.extend({
  type: z.literal("CONTINUATION_START"),
  checkpoint: z.string(),
  tokenCount: z.number(),
}) satisfies z.ZodType<ContinuationStartEvent>;

// Tool events
export const ToolRequestedEventSchema = L0ObservabilityEventSchema.extend({
  type: z.literal("TOOL_REQUESTED"),
  toolName: z.string(),
  toolCallId: z.string(),
  arguments: z.record(z.unknown()),
}) satisfies z.ZodType<ToolRequestedEvent>;

export const ToolStartEventSchema = L0ObservabilityEventSchema.extend({
  type: z.literal("TOOL_START"),
  toolCallId: z.string(),
  toolName: z.string(),
}) satisfies z.ZodType<ToolStartEvent>;

export const ToolResultEventSchema = L0ObservabilityEventSchema.extend({
  type: z.literal("TOOL_RESULT"),
  toolCallId: z.string(),
  result: z.unknown(),
  durationMs: z.number(),
}) satisfies z.ZodType<ToolResultEvent>;

export const ToolErrorEventSchema = L0ObservabilityEventSchema.extend({
  type: z.literal("TOOL_ERROR"),
  toolCallId: z.string(),
  error: z.string(),
  errorType: ToolErrorTypeSchema,
  durationMs: z.number(),
}) satisfies z.ZodType<ToolErrorEvent>;

export const ToolCompletedEventSchema = L0ObservabilityEventSchema.extend({
  type: z.literal("TOOL_COMPLETED"),
  toolCallId: z.string(),
  status: z.enum(["success", "error"]),
}) satisfies z.ZodType<ToolCompletedEvent>;

// Completion events
export const CompleteEventSchema = L0ObservabilityEventSchema.extend({
  type: z.literal("COMPLETE"),
  tokenCount: z.number(),
  contentLength: z.number(),
  durationMs: z.number(),
  state: L0StateSchema.optional(),
}) satisfies z.ZodType<CompleteEvent>;

export const ErrorEventSchema = L0ObservabilityEventSchema.extend({
  type: z.literal("ERROR"),
  error: z.string(),
  errorCode: z.string().optional(),
  failureType: FailureTypeSchema,
  recoveryStrategy: RecoveryStrategySchema,
  policy: RecoveryPolicySchema,
}) satisfies z.ZodType<ErrorEvent>;

/**
 * Union of all L0 events
 */
export const L0EventUnionSchema = z.discriminatedUnion("type", [
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
