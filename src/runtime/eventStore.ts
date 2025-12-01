// Event Store implementations for L0 Event Sourcing
//
// Provides in-memory and extensible storage for atomic, replayable events.

import type {
  L0EventStore,
  L0EventStoreWithSnapshots,
  L0EventEnvelope,
  L0RecordedEvent,
  L0Snapshot,
} from "../types/events";
import { generateStreamId, L0RecordedEventTypes } from "../types/events";

/**
 * In-memory event store for testing and short-lived sessions
 *
 * Not suitable for production persistence - events are lost on process exit.
 * Use for:
 * - Unit/integration testing with record/replay
 * - Development debugging
 * - Short-lived serverless functions
 */
export class InMemoryEventStore implements L0EventStoreWithSnapshots {
  private streams: Map<string, L0EventEnvelope[]> = new Map();
  private snapshots: Map<string, L0Snapshot[]> = new Map();

  async append(streamId: string, event: L0RecordedEvent): Promise<void> {
    let events = this.streams.get(streamId);
    if (!events) {
      events = [];
      this.streams.set(streamId, events);
    }

    const envelope: L0EventEnvelope = {
      streamId,
      seq: events.length,
      event,
    };

    events.push(envelope);
  }

  async getEvents(streamId: string): Promise<L0EventEnvelope[]> {
    return this.streams.get(streamId) ?? [];
  }

  async exists(streamId: string): Promise<boolean> {
    return this.streams.has(streamId);
  }

  async getLastEvent(streamId: string): Promise<L0EventEnvelope | null> {
    const events = this.streams.get(streamId);
    if (!events || events.length === 0) {
      return null;
    }
    return events[events.length - 1]!;
  }

  async getEventsAfter(
    streamId: string,
    afterSeq: number,
  ): Promise<L0EventEnvelope[]> {
    const events = this.streams.get(streamId);
    if (!events) {
      return [];
    }
    return events.filter((e) => e.seq > afterSeq);
  }

  async delete(streamId: string): Promise<void> {
    this.streams.delete(streamId);
    this.snapshots.delete(streamId);
  }

  async listStreams(): Promise<string[]> {
    return Array.from(this.streams.keys());
  }

  async saveSnapshot(snapshot: L0Snapshot): Promise<void> {
    let snapshots = this.snapshots.get(snapshot.streamId);
    if (!snapshots) {
      snapshots = [];
      this.snapshots.set(snapshot.streamId, snapshots);
    }
    snapshots.push(snapshot);
  }

  async getSnapshot(streamId: string): Promise<L0Snapshot | null> {
    const snapshots = this.snapshots.get(streamId);
    if (!snapshots || snapshots.length === 0) {
      return null;
    }
    return snapshots[snapshots.length - 1]!;
  }

  async getSnapshotBefore(
    streamId: string,
    seq: number,
  ): Promise<L0Snapshot | null> {
    const snapshots = this.snapshots.get(streamId);
    if (!snapshots || snapshots.length === 0) {
      return null;
    }

    // Find the latest snapshot that's at or before the given seq
    let best: L0Snapshot | null = null;
    for (const snapshot of snapshots) {
      if (snapshot.seq <= seq) {
        if (!best || snapshot.seq > best.seq) {
          best = snapshot;
        }
      }
    }
    return best;
  }

  /**
   * Clear all data (useful for testing)
   */
  clear(): void {
    this.streams.clear();
    this.snapshots.clear();
  }

  /**
   * Get total event count across all streams
   */
  getTotalEventCount(): number {
    let count = 0;
    for (const events of this.streams.values()) {
      count += events.length;
    }
    return count;
  }

  /**
   * Get stream count
   */
  getStreamCount(): number {
    return this.streams.size;
  }
}

/**
 * Event recorder - wraps an event store with convenient recording methods
 */
export class L0EventRecorder {
  private streamId: string;
  private eventStore: L0EventStore;
  private seq: number = 0;

  constructor(eventStore: L0EventStore, streamId?: string) {
    this.eventStore = eventStore;
    this.streamId = streamId ?? generateStreamId();
  }

  getStreamId(): string {
    return this.streamId;
  }

  getSeq(): number {
    return this.seq;
  }

  async record(event: L0RecordedEvent): Promise<void> {
    await this.eventStore.append(this.streamId, event);
    this.seq++;
  }

  async recordStart(
    options: Extract<L0RecordedEvent, { type: "START" }>["options"],
  ): Promise<void> {
    await this.record({
      type: L0RecordedEventTypes.START,
      ts: Date.now(),
      options,
    });
  }

  async recordToken(value: string, index: number): Promise<void> {
    await this.record({
      type: L0RecordedEventTypes.TOKEN,
      ts: Date.now(),
      value,
      index,
    });
  }

  async recordCheckpoint(at: number, content: string): Promise<void> {
    await this.record({
      type: L0RecordedEventTypes.CHECKPOINT,
      ts: Date.now(),
      at,
      content,
    });
  }

  async recordGuardrail(
    at: number,
    result: Extract<L0RecordedEvent, { type: "GUARDRAIL" }>["result"],
  ): Promise<void> {
    await this.record({
      type: L0RecordedEventTypes.GUARDRAIL,
      ts: Date.now(),
      at,
      result,
    });
  }

  async recordDrift(
    at: number,
    result: Extract<L0RecordedEvent, { type: "DRIFT" }>["result"],
  ): Promise<void> {
    await this.record({
      type: L0RecordedEventTypes.DRIFT,
      ts: Date.now(),
      at,
      result,
    });
  }

  async recordRetry(
    reason: string,
    attempt: number,
    countsTowardLimit: boolean,
  ): Promise<void> {
    await this.record({
      type: L0RecordedEventTypes.RETRY,
      ts: Date.now(),
      reason,
      attempt,
      countsTowardLimit,
    });
  }

  async recordFallback(to: number): Promise<void> {
    await this.record({
      type: L0RecordedEventTypes.FALLBACK,
      ts: Date.now(),
      to,
    });
  }

  async recordContinuation(checkpoint: string, at: number): Promise<void> {
    await this.record({
      type: L0RecordedEventTypes.CONTINUATION,
      ts: Date.now(),
      checkpoint,
      at,
    });
  }

  async recordComplete(content: string, tokenCount: number): Promise<void> {
    await this.record({
      type: L0RecordedEventTypes.COMPLETE,
      ts: Date.now(),
      content,
      tokenCount,
    });
  }

  async recordError(
    error: Extract<L0RecordedEvent, { type: "ERROR" }>["error"],
    recoverable: boolean,
  ): Promise<void> {
    await this.record({
      type: L0RecordedEventTypes.ERROR,
      ts: Date.now(),
      error,
      recoverable,
    });
  }
}

/**
 * Event replayer - replays events from a store
 */
export class L0EventReplayer {
  private eventStore: L0EventStore;

  constructor(eventStore: L0EventStore) {
    this.eventStore = eventStore;
  }

  /**
   * Replay all events for a stream
   */
  async *replay(
    streamId: string,
    options: {
      /** Playback speed (0 = instant, 1 = real-time) */
      speed?: number;
      /** Start from this sequence */
      fromSeq?: number;
      /** Stop at this sequence */
      toSeq?: number;
    } = {},
  ): AsyncGenerator<L0EventEnvelope> {
    const { speed = 0, fromSeq = 0, toSeq = Infinity } = options;

    const events = await this.eventStore.getEvents(streamId);
    let lastTs: number | null = null;

    for (const envelope of events) {
      // Skip events outside range
      if (envelope.seq < fromSeq) continue;
      if (envelope.seq > toSeq) break;

      // Simulate timing if speed > 0
      if (speed > 0 && lastTs !== null) {
        const delay = (envelope.event.ts - lastTs) / speed;
        if (delay > 0) {
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }

      lastTs = envelope.event.ts;
      yield envelope;
    }
  }

  /**
   * Replay and reconstruct final state
   */
  async replayToState(streamId: string): Promise<ReplayedState> {
    const state: ReplayedState = {
      content: "",
      tokenCount: 0,
      checkpoint: "",
      violations: [],
      driftDetected: false,
      retryAttempts: 0,
      networkRetryCount: 0,
      fallbackIndex: 0,
      completed: false,
      error: null,
      startTs: 0,
      endTs: 0,
    };

    const events = await this.eventStore.getEvents(streamId);

    for (const envelope of events) {
      const event = envelope.event;

      switch (event.type) {
        case "START":
          state.startTs = event.ts;
          break;

        case "TOKEN":
          state.content += event.value;
          state.tokenCount = event.index + 1;
          break;

        case "CHECKPOINT":
          state.checkpoint = event.content;
          break;

        case "GUARDRAIL":
          state.violations.push(...event.result.violations);
          break;

        case "DRIFT":
          if (event.result.detected) {
            state.driftDetected = true;
          }
          break;

        case "RETRY":
          if (event.countsTowardLimit) {
            state.retryAttempts++;
          } else {
            state.networkRetryCount++;
          }
          break;

        case "FALLBACK":
          state.fallbackIndex = event.to;
          break;

        case "CONTINUATION":
          state.content = event.checkpoint;
          break;

        case "COMPLETE":
          state.completed = true;
          state.content = event.content;
          state.tokenCount = event.tokenCount;
          state.endTs = event.ts;
          break;

        case "ERROR":
          state.error = event.error;
          state.endTs = event.ts;
          break;
      }
    }

    return state;
  }

  /**
   * Get stream as token async iterable (for replay mode)
   */
  async *replayTokens(
    streamId: string,
    options: { speed?: number } = {},
  ): AsyncGenerator<string> {
    for await (const envelope of this.replay(streamId, options)) {
      if (envelope.event.type === "TOKEN") {
        yield envelope.event.value;
      }
    }
  }
}

/**
 * State reconstructed from replay
 */
export interface ReplayedState {
  content: string;
  tokenCount: number;
  checkpoint: string;
  violations: import("../types/guardrails").GuardrailViolation[];
  driftDetected: boolean;
  retryAttempts: number;
  networkRetryCount: number;
  fallbackIndex: number;
  completed: boolean;
  error: import("../types/events").SerializedError | null;
  startTs: number;
  endTs: number;
}

/**
 * Create an in-memory event store
 */
export function createInMemoryEventStore(): InMemoryEventStore {
  return new InMemoryEventStore();
}

/**
 * Create an event recorder
 */
export function createEventRecorder(
  eventStore: L0EventStore,
  streamId?: string,
): L0EventRecorder {
  return new L0EventRecorder(eventStore, streamId);
}

/**
 * Create an event replayer
 */
export function createEventReplayer(eventStore: L0EventStore): L0EventReplayer {
  return new L0EventReplayer(eventStore);
}
