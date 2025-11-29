// Stream normalization and handling for L0

import type {
  StreamState,
  StreamError,
  StreamErrorType,
} from "../types/stream";
import { normalizeStreamEvent } from "./events";
import type { L0Event } from "../types/l0";

/**
 * Stream normalizer for handling various streaming formats
 */
export class StreamNormalizer {
  private state: StreamState;
  private accumulated: string = "";
  private checkpointInterval: number;
  private lastCheckpoint: string = "";

  constructor(options: { checkpointInterval?: number } = {}) {
    this.checkpointInterval = options.checkpointInterval || 10;
    this.state = this.createInitialState();
  }

  /**
   * Create initial stream state
   */
  private createInitialState(): StreamState {
    return {
      started: false,
      firstTokenReceived: false,
      tokenCount: 0,
      complete: false,
      aborted: false,
    };
  }

  /**
   * Process a stream chunk and normalize it
   */
  async *normalize(
    stream: AsyncIterable<any>,
    signal?: AbortSignal,
  ): AsyncGenerator<L0Event> {
    this.state.started = true;
    this.state.startTime = Date.now();

    try {
      for await (const chunk of stream) {
        // Check abort signal
        if (signal?.aborted) {
          this.state.aborted = true;
          throw this.createStreamError("abort", "Stream aborted by signal");
        }

        // Normalize the chunk
        const event = normalizeStreamEvent(chunk);

        // Update state based on event type
        if (event.type === "token" && event.value) {
          if (!this.state.firstTokenReceived) {
            this.state.firstTokenReceived = true;
            this.state.firstTokenTime = Date.now();
          }

          this.accumulated += event.value;
          this.state.tokenCount++;
          this.state.lastTokenTime = Date.now();

          // Create checkpoint periodically
          if (this.state.tokenCount % this.checkpointInterval === 0) {
            this.lastCheckpoint = this.accumulated;
          }
        } else if (event.type === "error") {
          this.state.error = event.error;
          throw event.error;
        } else if (event.type === "done") {
          this.state.complete = true;
        }

        yield event;
      }

      // Mark as complete if not already
      if (!this.state.complete) {
        this.state.complete = true;
      }
    } catch (error) {
      this.state.error =
        error instanceof Error ? error : new Error(String(error));
      throw this.state.error;
    }
  }

  /**
   * Get current state
   */
  getState(): StreamState {
    return { ...this.state };
  }

  /**
   * Get accumulated content
   */
  getAccumulated(): string {
    return this.accumulated;
  }

  /**
   * Get last checkpoint
   */
  getCheckpoint(): string {
    return this.lastCheckpoint;
  }

  /**
   * Reset normalizer state
   */
  reset(): void {
    this.state = this.createInitialState();
    this.accumulated = "";
    this.lastCheckpoint = "";
  }

  /**
   * Create a stream error
   */
  private createStreamError(
    type: StreamErrorType,
    message: string,
  ): StreamError {
    const error = new Error(message) as StreamError;
    error.type = type;
    error.recoverable = type !== "abort";
    error.timestamp = Date.now();
    return error;
  }
}

/**
 * Create a stream normalizer
 */
export function createStreamNormalizer(options?: {
  checkpointInterval?: number;
}): StreamNormalizer {
  return new StreamNormalizer(options);
}

/**
 * Normalize a stream with timeout handling
 */
export async function* normalizeStreamWithTimeout(
  stream: AsyncIterable<any>,
  options: {
    initialTimeout?: number;
    interTokenTimeout?: number;
    signal?: AbortSignal;
  } = {},
): AsyncGenerator<L0Event> {
  const { initialTimeout = 2000, interTokenTimeout = 5000, signal } = options;

  const normalizer = new StreamNormalizer();
  let firstTokenReceived = false;
  let lastTokenTime = Date.now();

  // Set initial timeout
  let initialTimeoutId: NodeJS.Timeout | null = null;
  let initialTimeoutReached = false;

  if (initialTimeout > 0) {
    initialTimeoutId = setTimeout(() => {
      initialTimeoutReached = true;
    }, initialTimeout);
  }

  try {
    for await (const event of normalizer.normalize(stream, signal)) {
      // Clear initial timeout on first token
      if (initialTimeoutId && !firstTokenReceived && event.type === "token") {
        clearTimeout(initialTimeoutId);
        initialTimeoutId = null;
        firstTokenReceived = true;
      }

      // Check initial timeout
      if (initialTimeoutReached && !firstTokenReceived) {
        throw new Error(`Initial token timeout after ${initialTimeout}ms`);
      }

      // Check inter-token timeout
      if (
        firstTokenReceived &&
        interTokenTimeout > 0 &&
        event.type === "token"
      ) {
        const timeSinceLastToken = Date.now() - lastTokenTime;
        if (timeSinceLastToken > interTokenTimeout) {
          throw new Error(`Inter-token timeout after ${timeSinceLastToken}ms`);
        }
        lastTokenTime = Date.now();
      }

      yield event;
    }
  } finally {
    if (initialTimeoutId) {
      clearTimeout(initialTimeoutId);
    }
  }
}

/**
 * Buffer stream chunks with batching
 */
export async function* bufferStream(
  stream: AsyncIterable<L0Event>,
  bufferSize: number = 10,
): AsyncGenerator<L0Event[]> {
  let buffer: L0Event[] = [];

  for await (const event of stream) {
    buffer.push(event);

    if (
      buffer.length >= bufferSize ||
      event.type === "done" ||
      event.type === "error"
    ) {
      yield buffer;
      buffer = [];
    }
  }

  // Yield remaining buffer
  if (buffer.length > 0) {
    yield buffer;
  }
}

/**
 * Map stream events with a transform function
 */
export async function* mapStream<T>(
  stream: AsyncIterable<L0Event>,
  mapper: (event: L0Event) => T,
): AsyncGenerator<T> {
  for await (const event of stream) {
    yield mapper(event);
  }
}

/**
 * Filter stream events
 */
export async function* filterStream(
  stream: AsyncIterable<L0Event>,
  predicate: (event: L0Event) => boolean,
): AsyncGenerator<L0Event> {
  for await (const event of stream) {
    if (predicate(event)) {
      yield event;
    }
  }
}

/**
 * Take first N events from stream
 */
export async function* takeStream(
  stream: AsyncIterable<L0Event>,
  count: number,
): AsyncGenerator<L0Event> {
  let taken = 0;
  for await (const event of stream) {
    if (taken >= count) break;
    yield event;
    taken++;
  }
}

/**
 * Collect all events from stream into array
 */
export async function collectStream(
  stream: AsyncIterable<L0Event>,
): Promise<L0Event[]> {
  const events: L0Event[] = [];
  for await (const event of stream) {
    events.push(event);
  }
  return events;
}

/**
 * Consume stream and return final text
 */
export async function consumeStream(
  stream: AsyncIterable<L0Event>,
): Promise<string> {
  let text = "";
  for await (const event of stream) {
    if (event.type === "token" && event.value) {
      text += event.value;
    }
  }
  return text;
}

/**
 * Create a passthrough stream that doesn't modify events
 */
export async function* passthroughStream(
  stream: AsyncIterable<L0Event>,
): AsyncGenerator<L0Event> {
  for await (const event of stream) {
    yield event;
  }
}

/**
 * Tap into stream without modifying it (for logging/monitoring)
 */
export async function* tapStream(
  stream: AsyncIterable<L0Event>,
  callback: (event: L0Event) => void,
): AsyncGenerator<L0Event> {
  for await (const event of stream) {
    callback(event);
    yield event;
  }
}

/**
 * Merge multiple streams into one
 */
export async function* mergeStreams(
  ...streams: AsyncIterable<L0Event>[]
): AsyncGenerator<L0Event> {
  for (const stream of streams) {
    for await (const event of stream) {
      yield event;
    }
  }
}

/**
 * Create a stream from an array of events
 */
export async function* streamFromArray(
  events: L0Event[],
): AsyncGenerator<L0Event> {
  for (const event of events) {
    yield event;
  }
}

/**
 * Debounce stream events
 */
export async function* debounceStream(
  stream: AsyncIterable<L0Event>,
  delayMs: number,
): AsyncGenerator<L0Event> {
  let lastEvent: L0Event | null = null;
  let timeoutId: NodeJS.Timeout | null = null;

  const events: L0Event[] = [];

  for await (const event of stream) {
    events.push(event);
  }

  // Process collected events with debounce
  for (const event of events) {
    lastEvent = event;

    if (timeoutId) {
      clearTimeout(timeoutId);
    }

    await new Promise<void>((resolve) => {
      timeoutId = setTimeout(() => {
        resolve();
      }, delayMs);
    });

    if (lastEvent === event) {
      yield event;
    }
  }
}
