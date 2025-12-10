// Zod schemas for L0 Event Sourcing types

import { z } from "zod4";
import type {
  L0RecordedEventType,
  SerializedOptions,
  SerializedError,
  GuardrailEventResult,
  DriftEventResult,
  L0StartEvent,
  L0TokenEvent,
  L0CheckpointEvent,
  L0GuardrailEvent,
  L0DriftEvent,
  L0RetryEvent,
  L0FallbackEvent,
  L0ContinuationEvent,
  L0CompleteEvent,
  L0ErrorEvent,
  L0EventEnvelope,
  L0Snapshot,
  L0ExecutionMode,
  L0ReplayOptions,
  L0RecordOptions,
} from "../types/events";
import { GuardrailViolationSchema } from "./guardrails";
import { BackoffStrategySchema } from "./retry";
import {
  FailureTypeSchema,
  RecoveryStrategySchema,
  RecoveryPolicySchema,
} from "./observability";

/**
 * Recorded event type schema
 */
export const L0RecordedEventTypeSchema: z.ZodType<L0RecordedEventType> = z.enum(
  [
    "START",
    "TOKEN",
    "CHECKPOINT",
    "GUARDRAIL",
    "DRIFT",
    "RETRY",
    "FALLBACK",
    "CONTINUATION",
    "COMPLETE",
    "ERROR",
  ],
);

/**
 * Serialized options schema
 */
export const SerializedOptionsSchema: z.ZodType<SerializedOptions> = z.object({
  prompt: z.string().optional(),
  model: z.string().optional(),
  retry: z
    .object({
      attempts: z.number().optional(),
      maxRetries: z.number().optional(),
      baseDelay: z.number().optional(),
      maxDelay: z.number().optional(),
      backoff: BackoffStrategySchema.optional(),
    })
    .optional(),
  timeout: z
    .object({
      initialToken: z.number().optional(),
      interToken: z.number().optional(),
    })
    .optional(),
  checkIntervals: z
    .object({
      guardrails: z.number().optional(),
      drift: z.number().optional(),
      checkpoint: z.number().optional(),
    })
    .optional(),
  continueFromLastKnownGoodToken: z.boolean().optional(),
  detectDrift: z.boolean().optional(),
  detectZeroTokens: z.boolean().optional(),
  fallbackCount: z.number().optional(),
  guardrailCount: z.number().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

/**
 * Serialized error schema
 */
export const SerializedErrorSchema: z.ZodType<SerializedError> = z.object({
  name: z.string(),
  message: z.string(),
  code: z.string().optional(),
  stack: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

/**
 * Guardrail event result schema
 */
export const GuardrailEventResultSchema: z.ZodType<GuardrailEventResult> =
  z.object({
    violations: z.array(GuardrailViolationSchema),
    shouldRetry: z.boolean(),
    shouldHalt: z.boolean(),
  });

/**
 * Drift event result schema
 */
export const DriftEventResultSchema: z.ZodType<DriftEventResult> = z.object({
  detected: z.boolean(),
  types: z.array(z.string()),
  confidence: z.number(),
});

/**
 * L0 start event schema
 */
export const L0StartEventSchema: z.ZodType<L0StartEvent> = z.object({
  type: z.literal("START"),
  ts: z.number(),
  options: SerializedOptionsSchema,
});

/**
 * L0 token event schema
 */
export const L0TokenEventSchema: z.ZodType<L0TokenEvent> = z.object({
  type: z.literal("TOKEN"),
  ts: z.number(),
  value: z.string(),
  index: z.number(),
});

/**
 * L0 checkpoint event schema
 */
export const L0CheckpointEventSchema: z.ZodType<L0CheckpointEvent> = z.object({
  type: z.literal("CHECKPOINT"),
  ts: z.number(),
  at: z.number(),
  content: z.string(),
});

/**
 * L0 guardrail event schema
 */
export const L0GuardrailEventSchema: z.ZodType<L0GuardrailEvent> = z.object({
  type: z.literal("GUARDRAIL"),
  ts: z.number(),
  at: z.number(),
  result: GuardrailEventResultSchema,
});

/**
 * L0 drift event schema
 */
export const L0DriftEventSchema: z.ZodType<L0DriftEvent> = z.object({
  type: z.literal("DRIFT"),
  ts: z.number(),
  at: z.number(),
  result: DriftEventResultSchema,
});

/**
 * L0 retry event schema
 */
export const L0RetryEventSchema: z.ZodType<L0RetryEvent> = z.object({
  type: z.literal("RETRY"),
  ts: z.number(),
  reason: z.string(),
  attempt: z.number(),
  countsTowardLimit: z.boolean(),
});

/**
 * L0 fallback event schema
 */
export const L0FallbackEventSchema: z.ZodType<L0FallbackEvent> = z.object({
  type: z.literal("FALLBACK"),
  ts: z.number(),
  to: z.number(),
});

/**
 * L0 continuation event schema
 */
export const L0ContinuationEventSchema: z.ZodType<L0ContinuationEvent> =
  z.object({
    type: z.literal("CONTINUATION"),
    ts: z.number(),
    checkpoint: z.string(),
    at: z.number(),
  });

/**
 * L0 complete event schema
 */
export const L0CompleteEventSchema: z.ZodType<L0CompleteEvent> = z.object({
  type: z.literal("COMPLETE"),
  ts: z.number(),
  content: z.string(),
  tokenCount: z.number(),
});

/**
 * L0 error event schema
 */
export const L0ErrorEventSchema: z.ZodType<L0ErrorEvent> = z.object({
  type: z.literal("ERROR"),
  ts: z.number(),
  error: SerializedErrorSchema,
  failureType: FailureTypeSchema,
  recoveryStrategy: RecoveryStrategySchema,
  policy: RecoveryPolicySchema,
});

/**
 * Union of all recorded events
 * Note: Using z.union instead of z.discriminatedUnion due to Zod 4 type inference issues
 */
export const L0RecordedEventSchema = z.union([
  L0StartEventSchema,
  L0TokenEventSchema,
  L0CheckpointEventSchema,
  L0GuardrailEventSchema,
  L0DriftEventSchema,
  L0RetryEventSchema,
  L0FallbackEventSchema,
  L0ContinuationEventSchema,
  L0CompleteEventSchema,
  L0ErrorEventSchema,
]);

/**
 * Event envelope schema
 */
export const L0EventEnvelopeSchema: z.ZodType<L0EventEnvelope> = z.object({
  streamId: z.string(),
  seq: z.number(),
  event: L0RecordedEventSchema,
});

/**
 * L0 snapshot schema
 */
export const L0SnapshotSchema: z.ZodType<L0Snapshot> = z.object({
  streamId: z.string(),
  seq: z.number(),
  ts: z.number(),
  content: z.string(),
  tokenCount: z.number(),
  checkpoint: z.string(),
  violations: z.array(GuardrailViolationSchema),
  driftDetected: z.boolean(),
  retryAttempts: z.number(),
  networkRetryCount: z.number(),
  fallbackIndex: z.number(),
});

/**
 * L0 execution mode schema
 */
export const L0ExecutionModeSchema: z.ZodType<L0ExecutionMode> = z.enum([
  "live",
  "record",
  "replay",
]);

/**
 * L0 replay options schema
 * Note: eventStore is an interface with methods, cannot be validated
 */
export const L0ReplayOptionsSchema: z.ZodType<L0ReplayOptions> = z.object({
  streamId: z.string(),
  eventStore: z.any(), // L0EventStore interface
  speed: z.number().optional(),
  fireCallbacks: z.boolean().optional(),
  fromSeq: z.number().optional(),
  toSeq: z.number().optional(),
});

/**
 * L0 record options schema
 */
export const L0RecordOptionsSchema: z.ZodType<L0RecordOptions> = z.object({
  eventStore: z.any(), // L0EventStore interface
  streamId: z.string().optional(),
  saveSnapshots: z.boolean().optional(),
  snapshotInterval: z.number().optional(),
});
