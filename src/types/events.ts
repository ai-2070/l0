// Event Sourcing Types for Atomic, Replayable L0 Operations
//
// Key insight: Replayability MUST ignore external sources of non-determinism.
// In replay mode, we're a pure faucet over stored events - no network, no retries,
// no timeouts, no fallbacks, no live guardrail evaluation.
//
// Derived computations (guardrails, drift, retries) are stored AS events,
// not recomputed on replay.

import type { GuardrailViolation } from "./guardrails";
import type { BackoffStrategy } from "./retry";

/**
 * Serialized L0 options for event storage
 * Strips functions and non-serializable fields
 */
export interface SerializedOptions {
  /** Original prompt or message (if extractable) */
  prompt?: string;
  /** Model identifier */
  model?: string;
  /** Retry configuration */
  retry?: {
    attempts?: number;
    maxRetries?: number;
    baseDelay?: number;
    maxDelay?: number;
    backoff?: BackoffStrategy;
  };
  /** Timeout configuration */
  timeout?: {
    initialToken?: number;
    interToken?: number;
  };
  /** Check intervals */
  checkIntervals?: {
    guardrails?: number;
    drift?: number;
    checkpoint?: number;
  };
  /** Whether continuation was enabled */
  continueFromLastKnownGoodToken?: boolean;
  /** Whether drift detection was enabled */
  detectDrift?: boolean;
  /** Whether zero token detection was enabled */
  detectZeroTokens?: boolean;
  /** Number of fallback streams configured */
  fallbackCount?: number;
  /** Number of guardrails configured */
  guardrailCount?: number;
  /** Custom metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Serialized error for event storage
 */
export interface SerializedError {
  name: string;
  message: string;
  code?: string;
  stack?: string;
  /** Additional error metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Guardrail evaluation result for event storage
 */
export interface GuardrailEventResult {
  violations: GuardrailViolation[];
  shouldRetry: boolean;
  shouldHalt: boolean;
}

/**
 * Drift detection result for event storage
 */
export interface DriftEventResult {
  detected: boolean;
  types: string[];
  confidence: number;
}

/**
 * Core L0 atomic events - lean and composable
 *
 * These events form a complete, replayable log of an L0 execution.
 * In replay mode, these events ARE the source of truth - no recomputation.
 */
export type L0RecordedEvent =
  | L0StartEvent
  | L0TokenEvent
  | L0CheckpointEvent
  | L0GuardrailEvent
  | L0DriftEvent
  | L0RetryEvent
  | L0FallbackEvent
  | L0ContinuationEvent
  | L0CompleteEvent
  | L0ErrorEvent;

/**
 * Stream execution started
 */
export interface L0StartEvent {
  type: "START";
  /** Unix timestamp in milliseconds */
  ts: number;
  /** Serialized options (functions stripped) */
  options: SerializedOptions;
}

/**
 * Token received from stream
 */
export interface L0TokenEvent {
  type: "TOKEN";
  /** Unix timestamp in milliseconds */
  ts: number;
  /** Token content */
  value: string;
  /** Zero-based token index */
  index: number;
}

/**
 * Checkpoint saved (for continuation support)
 */
export interface L0CheckpointEvent {
  type: "CHECKPOINT";
  /** Unix timestamp in milliseconds */
  ts: number;
  /** Token index at checkpoint */
  at: number;
  /** Accumulated content at checkpoint */
  content: string;
}

/**
 * Guardrail evaluation occurred
 * Stored as event because it's a derived computation
 */
export interface L0GuardrailEvent {
  type: "GUARDRAIL";
  /** Unix timestamp in milliseconds */
  ts: number;
  /** Token index when check occurred */
  at: number;
  /** Evaluation result */
  result: GuardrailEventResult;
}

/**
 * Drift detection occurred
 * Stored as event because it's a derived computation
 */
export interface L0DriftEvent {
  type: "DRIFT";
  /** Unix timestamp in milliseconds */
  ts: number;
  /** Token index when check occurred */
  at: number;
  /** Detection result */
  result: DriftEventResult;
}

/**
 * Retry triggered
 */
export interface L0RetryEvent {
  type: "RETRY";
  /** Unix timestamp in milliseconds */
  ts: number;
  /** Reason for retry */
  reason: string;
  /** Attempt number (1-based) */
  attempt: number;
  /** Whether this counts toward model retry limit */
  countsTowardLimit: boolean;
}

/**
 * Fallback to next stream triggered
 */
export interface L0FallbackEvent {
  type: "FALLBACK";
  /** Unix timestamp in milliseconds */
  ts: number;
  /** Index of stream we're falling back to (1-based for fallbacks) */
  to: number;
}

/**
 * Continuation from checkpoint used
 */
export interface L0ContinuationEvent {
  type: "CONTINUATION";
  /** Unix timestamp in milliseconds */
  ts: number;
  /** Checkpoint content used for continuation */
  checkpoint: string;
  /** Token index of checkpoint */
  at: number;
}

/**
 * Stream completed successfully
 */
export interface L0CompleteEvent {
  type: "COMPLETE";
  /** Unix timestamp in milliseconds */
  ts: number;
  /** Final accumulated content */
  content: string;
  /** Total token count */
  tokenCount: number;
}

/**
 * Stream failed with error
 */
export interface L0ErrorEvent {
  type: "ERROR";
  /** Unix timestamp in milliseconds */
  ts: number;
  /** Serialized error */
  error: SerializedError;
  /** Whether error was recoverable */
  recoverable: boolean;
}

/**
 * Event envelope with stream identity
 */
export interface L0EventEnvelope {
  /** Unique stream execution ID */
  streamId: string;
  /** Sequence number within stream (0-based) */
  seq: number;
  /** The event */
  event: L0RecordedEvent;
}

/**
 * Event store interface for persistence
 */
export interface L0EventStore {
  /**
   * Append an event to a stream
   */
  append(streamId: string, event: L0RecordedEvent): Promise<void>;

  /**
   * Get all events for a stream in order
   */
  getEvents(streamId: string): Promise<L0EventEnvelope[]>;

  /**
   * Check if a stream exists
   */
  exists(streamId: string): Promise<boolean>;

  /**
   * Get the last event for a stream
   */
  getLastEvent(streamId: string): Promise<L0EventEnvelope | null>;

  /**
   * Get events after a sequence number (for resumption)
   */
  getEventsAfter(
    streamId: string,
    afterSeq: number,
  ): Promise<L0EventEnvelope[]>;

  /**
   * Delete all events for a stream
   */
  delete(streamId: string): Promise<void>;

  /**
   * List all stream IDs (for debugging/admin)
   */
  listStreams(): Promise<string[]>;
}

/**
 * Snapshot of L0 state at a point in time
 * Used for faster replay of long streams
 */
export interface L0Snapshot {
  /** Stream ID */
  streamId: string;
  /** Sequence number this snapshot is valid at */
  seq: number;
  /** Unix timestamp when snapshot was taken */
  ts: number;
  /** Accumulated content */
  content: string;
  /** Token count */
  tokenCount: number;
  /** Last checkpoint content */
  checkpoint: string;
  /** Violations accumulated */
  violations: GuardrailViolation[];
  /** Whether drift was detected */
  driftDetected: boolean;
  /** Retry attempts count */
  retryAttempts: number;
  /** Network retries count */
  networkRetries: number;
  /** Current fallback index */
  fallbackIndex: number;
}

/**
 * Extended event store with snapshot support
 */
export interface L0EventStoreWithSnapshots extends L0EventStore {
  /**
   * Save a snapshot
   */
  saveSnapshot(snapshot: L0Snapshot): Promise<void>;

  /**
   * Get the latest snapshot for a stream
   */
  getSnapshot(streamId: string): Promise<L0Snapshot | null>;

  /**
   * Get snapshot closest to but not after a sequence number
   */
  getSnapshotBefore(streamId: string, seq: number): Promise<L0Snapshot | null>;
}

/**
 * L0 execution mode
 */
export type L0ExecutionMode = "live" | "record" | "replay";

/**
 * Options for replay mode
 */
export interface L0ReplayOptions {
  /** Stream ID to replay */
  streamId: string;
  /** Event store to read from */
  eventStore: L0EventStore;
  /** Playback speed multiplier (1 = real-time, 0 = instant) */
  speed?: number;
  /** Whether to fire monitoring callbacks during replay */
  fireCallbacks?: boolean;
  /** Start replay from this sequence number */
  fromSeq?: number;
  /** Stop replay at this sequence number */
  toSeq?: number;
}

/**
 * Options for record mode
 */
export interface L0RecordOptions {
  /** Event store to write to */
  eventStore: L0EventStore;
  /** Custom stream ID (auto-generated if not provided) */
  streamId?: string;
  /** Whether to also save snapshots periodically */
  saveSnapshots?: boolean;
  /** Snapshot interval (every N events) */
  snapshotInterval?: number;
}

/**
 * Serialize an Error to StoredError
 */
export function serializeError(error: Error): SerializedError {
  return {
    name: error.name,
    message: error.message,
    stack: error.stack,
    code: (error as any).code,
    metadata: (error as any).metadata,
  };
}

/**
 * Deserialize a StoredError back to Error
 */
export function deserializeError(stored: SerializedError): Error {
  const error = new Error(stored.message);
  error.name = stored.name;
  error.stack = stored.stack;
  (error as any).code = stored.code;
  (error as any).metadata = stored.metadata;
  return error;
}

/**
 * Generate a unique stream ID
 */
export function generateStreamId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 10);
  return `l0_${timestamp}_${random}`;
}
