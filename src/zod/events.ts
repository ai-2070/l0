// Zod schemas for L0 Event Sourcing types

import { z } from "zod4";
import type {
  L0RecordedEventType,
  SerializedOptions,
  SerializedError,
  GuardrailEventResult,
  DriftEventResult,
  L0RecordedEvent,
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
  L0EventStore,
  L0Snapshot,
  L0EventStoreWithSnapshots,
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
export const L0RecordedEventTypeSchema = z.enum([
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
]) satisfies z.ZodType<L0RecordedEventType>;

/**
 * Serialized options schema
 */
export const SerializedOptionsSchema = z.object({
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
  metadata: z.record(z.unknown()).optional(),
}) satisfies z.ZodType<SerializedOptions>;

/**
 * Serialized error schema
 */
export const SerializedErrorSchema = z.object({
  name: z.string(),
  message: z.string(),
  code: z.string().optional(),
  stack: z.string().optional(),
  metadata: z.record(z.unknown()).optional(),
}) satisfies z.ZodType<SerializedError>;

/**
 * Guardrail event result schema
 */
export const GuardrailEventResultSchema = z.object({
  violations: z.array(GuardrailViolationSchema),
  shouldRetry: z.boolean(),
  shouldHalt: z.boolean(),
}) satisfies z.ZodType<GuardrailEventResult>;

/**
 * Drift event result schema
 */
export const DriftEventResultSchema = z.object({
  detected: z.boolean(),
  types: z.array(z.string()),
  confidence: z.number(),
}) satisfies z.ZodType<DriftEventResult>;

/**
 * L0 start event schema
 */
export const L0StartEventSchema = z.object({
  type: z.literal("START"),
  ts: z.number(),
  options: SerializedOptionsSchema,
}) satisfies z.ZodType<L0StartEvent>;

/**
 * L0 token event schema
 */
export const L0TokenEventSchema = z.object({
  type: z.literal("TOKEN"),
  ts: z.number(),
  value: z.string(),
  index: z.number(),
}) satisfies z.ZodType<L0TokenEvent>;

/**
 * L0 checkpoint event schema
 */
export const L0CheckpointEventSchema = z.object({
  type: z.literal("CHECKPOINT"),
  ts: z.number(),
  at: z.number(),
  content: z.string(),
}) satisfies z.ZodType<L0CheckpointEvent>;

/**
 * L0 guardrail event schema
 */
export const L0GuardrailEventSchema = z.object({
  type: z.literal("GUARDRAIL"),
  ts: z.number(),
  at: z.number(),
  result: GuardrailEventResultSchema,
}) satisfies z.ZodType<L0GuardrailEvent>;

/**
 * L0 drift event schema
 */
export const L0DriftEventSchema = z.object({
  type: z.literal("DRIFT"),
  ts: z.number(),
  at: z.number(),
  result: DriftEventResultSchema,
}) satisfies z.ZodType<L0DriftEvent>;

/**
 * L0 retry event schema
 */
export const L0RetryEventSchema = z.object({
  type: z.literal("RETRY"),
  ts: z.number(),
  reason: z.string(),
  attempt: z.number(),
  countsTowardLimit: z.boolean(),
}) satisfies z.ZodType<L0RetryEvent>;

/**
 * L0 fallback event schema
 */
export const L0FallbackEventSchema = z.object({
  type: z.literal("FALLBACK"),
  ts: z.number(),
  to: z.number(),
}) satisfies z.ZodType<L0FallbackEvent>;

/**
 * L0 continuation event schema
 */
export const L0ContinuationEventSchema = z.object({
  type: z.literal("CONTINUATION"),
  ts: z.number(),
  checkpoint: z.string(),
  at: z.number(),
}) satisfies z.ZodType<L0ContinuationEvent>;

/**
 * L0 complete event schema
 */
export const L0CompleteEventSchema = z.object({
  type: z.literal("COMPLETE"),
  ts: z.number(),
  content: z.string(),
  tokenCount: z.number(),
}) satisfies z.ZodType<L0CompleteEvent>;

/**
 * L0 error event schema
 */
export const L0ErrorEventSchema = z.object({
  type: z.literal("ERROR"),
  ts: z.number(),
  error: SerializedErrorSchema,
  failureType: FailureTypeSchema,
  recoveryStrategy: RecoveryStrategySchema,
  policy: RecoveryPolicySchema,
}) satisfies z.ZodType<L0ErrorEvent>;

/**
 * Union of all recorded events
 */
export const L0RecordedEventSchema = z.discriminatedUnion("type", [
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
]) satisfies z.ZodType<L0RecordedEvent>;

/**
 * Event envelope schema
 */
export const L0EventEnvelopeSchema = z.object({
  streamId: z.string(),
  seq: z.number(),
  event: L0RecordedEventSchema,
}) satisfies z.ZodType<L0EventEnvelope>;

/**
 * L0 snapshot schema
 */
export const L0SnapshotSchema = z.object({
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
}) satisfies z.ZodType<L0Snapshot>;

/**
 * L0 execution mode schema
 */
export const L0ExecutionModeSchema = z.enum([
  "live",
  "record",
  "replay",
]) satisfies z.ZodType<L0ExecutionMode>;

/**
 * L0 replay options schema
 * Note: eventStore is an interface with methods, cannot be validated
 */
export const L0ReplayOptionsSchema = z.object({
  streamId: z.string(),
  eventStore: z.any(), // L0EventStore interface
  speed: z.number().optional(),
  fireCallbacks: z.boolean().optional(),
  fromSeq: z.number().optional(),
  toSeq: z.number().optional(),
}) satisfies z.ZodType<L0ReplayOptions>;

/**
 * L0 record options schema
 */
export const L0RecordOptionsSchema = z.object({
  eventStore: z.any(), // L0EventStore interface
  streamId: z.string().optional(),
  saveSnapshots: z.boolean().optional(),
  snapshotInterval: z.number().optional(),
}) satisfies z.ZodType<L0RecordOptions>;
