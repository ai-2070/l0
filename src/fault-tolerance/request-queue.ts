/**
 * Request Queue with Replay Support
 * Manages request persistence and replay for crash recovery
 */

import { EventEmitter } from 'events';
import type {
  InferenceRequest,
  InferenceResult,
  QueueConfig,
} from './types';
import { DEFAULT_CONFIG } from './types';
import { CheckpointManager } from './checkpoint-manager';

interface QueuedRequest {
  request: InferenceRequest;
  resolve: (result: InferenceResult) => void;
  reject: (error: Error) => void;
  attempts: number;
  addedAt: number;
  lastAttemptAt?: number;
  checkpointId?: string;
}

interface RetrySchedule {
  requestId: string;
  scheduledAt: number;
  timer: NodeJS.Timeout;
}

export class RequestQueue extends EventEmitter {
  private config: QueueConfig;
  private checkpointManager: CheckpointManager;
  private queue: Map<string, QueuedRequest> = new Map();
  private retrySchedules: Map<string, RetrySchedule> = new Map();
  private processingSet: Set<string> = new Set();
  private isProcessing = false;
  private processor?: (request: InferenceRequest) => Promise<InferenceResult>;

  constructor(
    checkpointManager: CheckpointManager,
    config: Partial<QueueConfig> = {}
  ) {
    super();
    this.config = { ...DEFAULT_CONFIG.queue, ...config };
    this.checkpointManager = checkpointManager;
  }

  /**
   * Set the request processor function
   */
  setProcessor(
    processor: (request: InferenceRequest) => Promise<InferenceResult>
  ): void {
    this.processor = processor;
  }

  /**
   * Add a request to the queue
   */
  async enqueue(request: InferenceRequest): Promise<InferenceResult> {
    if (this.queue.size >= this.config.maxSize) {
      throw new Error('Queue is full');
    }

    // Create checkpoint for crash recovery
    const checkpoint = this.checkpointManager.create(
      request.id,
      request.prompt,
      request.model || 'gpt-4o-mini'
    );

    return new Promise((resolve, reject) => {
      const queuedRequest: QueuedRequest = {
        request,
        resolve,
        reject,
        attempts: 0,
        addedAt: Date.now(),
        checkpointId: checkpoint.id,
      };

      this.queue.set(request.id, queuedRequest);
      this.emit('enqueued', { requestId: request.id, queueSize: this.queue.size });

      // Trigger processing
      this.processNext();
    });
  }

  /**
   * Process the next request in the queue
   */
  private async processNext(): Promise<void> {
    if (this.isProcessing || !this.processor) return;

    // Find next request that's not being processed and not scheduled for retry
    let nextRequest: QueuedRequest | undefined;
    for (const [id, queued] of this.queue) {
      if (!this.processingSet.has(id) && !this.retrySchedules.has(id)) {
        nextRequest = queued;
        break;
      }
    }

    if (!nextRequest) return;

    this.isProcessing = true;
    this.processingSet.add(nextRequest.request.id);
    nextRequest.attempts++;
    nextRequest.lastAttemptAt = Date.now();

    this.emit('processing', {
      requestId: nextRequest.request.id,
      attempt: nextRequest.attempts,
    });

    try {
      const result = await this.processor(nextRequest.request);

      // Success - complete the request
      this.complete(nextRequest.request.id, result);
    } catch (error) {
      this.handleFailure(
        nextRequest.request.id,
        error instanceof Error ? error : new Error(String(error))
      );
    } finally {
      this.isProcessing = false;
      this.processingSet.delete(nextRequest.request.id);

      // Process next request
      setImmediate(() => this.processNext());
    }
  }

  /**
   * Complete a request successfully
   */
  private complete(requestId: string, result: InferenceResult): void {
    const queued = this.queue.get(requestId);
    if (!queued) return;

    // Complete checkpoint
    if (queued.checkpointId) {
      this.checkpointManager.complete(queued.checkpointId);
    }

    // Remove from queue and resolve
    this.queue.delete(requestId);
    this.emit('completed', { requestId, result });
    queued.resolve(result);
  }

  /**
   * Handle request failure
   */
  private handleFailure(requestId: string, error: Error): void {
    const queued = this.queue.get(requestId);
    if (!queued) return;

    // Update checkpoint with failure
    if (queued.checkpointId) {
      this.checkpointManager.markFailed(queued.checkpointId, error.message);
    }

    // Check if we should retry
    if (queued.attempts < this.config.maxRetries) {
      this.scheduleRetry(requestId);
    } else {
      // Max retries exceeded - fail permanently
      this.queue.delete(requestId);
      this.emit('failed', { requestId, error, attempts: queued.attempts });
      queued.reject(error);
    }
  }

  /**
   * Schedule a retry with exponential backoff
   */
  private scheduleRetry(requestId: string): void {
    const queued = this.queue.get(requestId);
    if (!queued) return;

    // Calculate backoff delay
    const delay = this.config.retryDelay * Math.pow(2, queued.attempts - 1);

    const timer = setTimeout(() => {
      this.retrySchedules.delete(requestId);
      this.processNext();
    }, delay);

    this.retrySchedules.set(requestId, {
      requestId,
      scheduledAt: Date.now() + delay,
      timer,
    });

    this.emit('retry-scheduled', {
      requestId,
      attempt: queued.attempts,
      nextAttemptIn: delay,
    });
  }

  /**
   * Cancel a request
   */
  cancel(requestId: string): boolean {
    const queued = this.queue.get(requestId);
    if (!queued) return false;

    // Clear retry schedule if exists
    const retrySchedule = this.retrySchedules.get(requestId);
    if (retrySchedule) {
      clearTimeout(retrySchedule.timer);
      this.retrySchedules.delete(requestId);
    }

    // Remove from queue
    this.queue.delete(requestId);
    this.processingSet.delete(requestId);

    // Complete checkpoint (removes from disk)
    if (queued.checkpointId) {
      this.checkpointManager.complete(queued.checkpointId);
    }

    queued.reject(new Error('Request cancelled'));
    this.emit('cancelled', { requestId });

    return true;
  }

  /**
   * Replay failed requests from checkpoints (for crash recovery)
   */
  async replayFromCheckpoints(): Promise<void> {
    const incompleteCheckpoints = this.checkpointManager.getIncomplete();

    this.emit('replay-starting', { count: incompleteCheckpoints.length });

    for (const checkpoint of incompleteCheckpoints) {
      // Reconstruct request from checkpoint
      const request: InferenceRequest = {
        id: checkpoint.requestId,
        prompt: checkpoint.prompt,
        model: checkpoint.model,
        timestamp: checkpoint.createdAt,
      };

      // Re-enqueue without creating new checkpoint (reuse existing)
      const queuedRequest: QueuedRequest = {
        request,
        resolve: () => {},
        reject: () => {},
        attempts: checkpoint.attempts,
        addedAt: checkpoint.createdAt,
        checkpointId: checkpoint.id,
      };

      this.queue.set(request.id, queuedRequest);
    }

    this.emit('replay-complete', { replayedCount: incompleteCheckpoints.length });

    // Start processing
    this.processNext();
  }

  /**
   * Get queue statistics
   */
  getStats(): {
    queueSize: number;
    processing: number;
    pendingRetry: number;
    oldestRequestAge: number | null;
  } {
    let oldestAge: number | null = null;
    const now = Date.now();

    for (const queued of this.queue.values()) {
      const age = now - queued.addedAt;
      if (oldestAge === null || age > oldestAge) {
        oldestAge = age;
      }
    }

    return {
      queueSize: this.queue.size,
      processing: this.processingSet.size,
      pendingRetry: this.retrySchedules.size,
      oldestRequestAge: oldestAge,
    };
  }

  /**
   * Get all queued request IDs
   */
  getQueuedRequestIds(): string[] {
    return Array.from(this.queue.keys());
  }

  /**
   * Check if a request is in the queue
   */
  has(requestId: string): boolean {
    return this.queue.has(requestId);
  }

  /**
   * Clear all pending requests
   */
  clear(): void {
    // Clear all retry timers
    for (const schedule of this.retrySchedules.values()) {
      clearTimeout(schedule.timer);
    }
    this.retrySchedules.clear();

    // Reject all pending requests
    for (const queued of this.queue.values()) {
      queued.reject(new Error('Queue cleared'));
    }
    this.queue.clear();
    this.processingSet.clear();

    this.emit('cleared');
  }

  /**
   * Shutdown the queue
   */
  async shutdown(): Promise<void> {
    this.clear();
    this.emit('shutdown');
  }
}
