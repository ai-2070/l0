/**
 * Worker Pool with Process Supervision
 * Manages multiple inference workers with automatic restart on crash
 */

import { Worker } from 'worker_threads';
import { join } from 'path';
import { EventEmitter } from 'events';
import type {
  WorkerPoolConfig,
  SupervisorConfig,
  WorkerMessage,
  WorkerResponse,
  InferenceRequest,
  InferenceResult,
} from './types';
import { DEFAULT_CONFIG } from './types';

interface ManagedWorker {
  id: string;
  worker: Worker;
  status: 'starting' | 'ready' | 'busy' | 'dead';
  currentRequestId: string | null;
  restartCount: number;
  restartTimestamps: number[];
  lastHealthCheck: number;
}

interface PendingRequest {
  request: InferenceRequest;
  resolve: (result: InferenceResult) => void;
  reject: (error: Error) => void;
  workerId?: string;
  attempts: number;
  timeout: NodeJS.Timeout;
}

export class WorkerPool extends EventEmitter {
  private config: WorkerPoolConfig;
  private supervisorConfig: SupervisorConfig;
  private workers: Map<string, ManagedWorker> = new Map();
  private pendingRequests: Map<string, PendingRequest> = new Map();
  private requestQueue: InferenceRequest[] = [];
  private healthCheckTimer?: NodeJS.Timeout;
  private isShuttingDown = false;
  private workerScript: string;

  constructor(
    config: Partial<WorkerPoolConfig> = {},
    supervisorConfig: Partial<SupervisorConfig> = {}
  ) {
    super();
    this.config = { ...DEFAULT_CONFIG.workers, ...config };
    this.supervisorConfig = { ...DEFAULT_CONFIG.supervisor, ...supervisorConfig };
    this.workerScript = join(__dirname, 'inference-worker.js');
  }

  /**
   * Start the worker pool
   */
  async start(): Promise<void> {
    // Spawn minimum number of workers
    const startPromises: Promise<void>[] = [];
    for (let i = 0; i < this.config.minWorkers; i++) {
      startPromises.push(this.spawnWorker());
    }
    await Promise.all(startPromises);

    // Start health check timer
    this.healthCheckTimer = setInterval(
      () => this.healthCheck(),
      this.config.healthCheckInterval
    );

    this.emit('started', { workerCount: this.workers.size });
  }

  /**
   * Spawn a new worker
   */
  private async spawnWorker(): Promise<void> {
    const id = crypto.randomUUID();

    const worker = new Worker(this.workerScript, {
      workerData: { workerId: id },
    });

    const managedWorker: ManagedWorker = {
      id,
      worker,
      status: 'starting',
      currentRequestId: null,
      restartCount: 0,
      restartTimestamps: [],
      lastHealthCheck: Date.now(),
    };

    this.workers.set(id, managedWorker);
    this.setupWorkerHandlers(managedWorker);
  }

  /**
   * Set up event handlers for a worker
   */
  private setupWorkerHandlers(managedWorker: ManagedWorker): void {
    const { worker, id } = managedWorker;

    worker.on('message', (response: WorkerResponse) => {
      this.handleWorkerResponse(id, response);
    });

    worker.on('error', (error: Error) => {
      this.emit('worker-error', { workerId: id, error });
      this.handleWorkerCrash(id, error);
    });

    worker.on('exit', (code: number) => {
      if (code !== 0 && !this.isShuttingDown) {
        this.emit('worker-exit', { workerId: id, code });
        this.handleWorkerCrash(id, new Error(`Worker exited with code ${code}`));
      }
    });
  }

  /**
   * Handle response from worker
   */
  private handleWorkerResponse(workerId: string, response: WorkerResponse): void {
    const managedWorker = this.workers.get(workerId);
    if (!managedWorker) return;

    switch (response.type) {
      case 'ready':
        managedWorker.status = 'ready';
        this.emit('worker-ready', { workerId });
        this.processQueue();
        break;

      case 'result':
        this.completeRequest(response.requestId, response.payload as InferenceResult);
        managedWorker.status = 'ready';
        managedWorker.currentRequestId = null;
        this.processQueue();
        break;

      case 'error':
        this.failRequest(
          response.requestId,
          new Error((response.payload as any).message),
          (response.payload as any).retryable
        );
        managedWorker.status = 'ready';
        managedWorker.currentRequestId = null;
        this.processQueue();
        break;

      case 'progress':
        this.emit('progress', {
          requestId: response.requestId,
          ...response.payload,
        });
        break;
    }
  }

  /**
   * Handle worker crash and restart with backoff
   */
  private async handleWorkerCrash(workerId: string, error: Error): Promise<void> {
    const managedWorker = this.workers.get(workerId);
    if (!managedWorker) return;

    // Mark worker as dead
    managedWorker.status = 'dead';

    // Re-queue any pending request from this worker
    if (managedWorker.currentRequestId) {
      const pending = this.pendingRequests.get(managedWorker.currentRequestId);
      if (pending) {
        this.requestQueue.unshift(pending.request);
        pending.workerId = undefined;
      }
    }

    // Clean up restart timestamps outside the window
    const now = Date.now();
    managedWorker.restartTimestamps = managedWorker.restartTimestamps.filter(
      (ts) => now - ts < this.supervisorConfig.restartWindow
    );

    // Check if we've exceeded max restarts
    if (managedWorker.restartTimestamps.length >= this.supervisorConfig.maxRestarts) {
      this.emit('worker-max-restarts', { workerId, error });
      this.workers.delete(workerId);

      // Try to maintain minimum workers
      if (this.getReadyWorkerCount() < this.config.minWorkers) {
        await this.spawnWorker();
      }
      return;
    }

    // Calculate backoff delay
    const backoffDelay = Math.min(
      this.supervisorConfig.backoffInitial *
        Math.pow(
          this.supervisorConfig.backoffMultiplier,
          managedWorker.restartTimestamps.length
        ),
      this.supervisorConfig.backoffMax
    );

    this.emit('worker-restarting', { workerId, delay: backoffDelay });

    // Remove old worker
    this.workers.delete(workerId);

    // Schedule restart with backoff
    setTimeout(async () => {
      if (!this.isShuttingDown) {
        await this.spawnWorker();
      }
    }, backoffDelay);
  }

  /**
   * Submit an inference request
   */
  async infer(request: InferenceRequest): Promise<InferenceResult> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(request.id);
        reject(new Error('Request timeout'));
      }, request.options?.timeout || 120000);

      const pending: PendingRequest = {
        request,
        resolve,
        reject,
        attempts: 0,
        timeout,
      };

      this.pendingRequests.set(request.id, pending);
      this.requestQueue.push(request);
      this.processQueue();
    });
  }

  /**
   * Process queued requests
   */
  private processQueue(): void {
    while (this.requestQueue.length > 0) {
      const availableWorker = this.getAvailableWorker();
      if (!availableWorker) break;

      const request = this.requestQueue.shift();
      if (!request) break;

      const pending = this.pendingRequests.get(request.id);
      if (!pending) continue;

      pending.workerId = availableWorker.id;
      pending.attempts++;

      availableWorker.status = 'busy';
      availableWorker.currentRequestId = request.id;

      const message: WorkerMessage = {
        type: 'request',
        payload: request,
      };

      availableWorker.worker.postMessage(message);
      this.emit('request-dispatched', {
        requestId: request.id,
        workerId: availableWorker.id,
      });
    }

    // Scale up if needed
    this.maybeScaleUp();
  }

  /**
   * Get an available worker
   */
  private getAvailableWorker(): ManagedWorker | undefined {
    for (const worker of this.workers.values()) {
      if (worker.status === 'ready') {
        return worker;
      }
    }
    return undefined;
  }

  /**
   * Get count of ready workers
   */
  private getReadyWorkerCount(): number {
    let count = 0;
    for (const worker of this.workers.values()) {
      if (worker.status === 'ready' || worker.status === 'busy') {
        count++;
      }
    }
    return count;
  }

  /**
   * Scale up workers if queue is backing up
   */
  private async maybeScaleUp(): Promise<void> {
    const readyWorkers = this.getReadyWorkerCount();
    const queueSize = this.requestQueue.length;

    if (
      queueSize > 0 &&
      readyWorkers < this.config.maxWorkers &&
      this.workers.size < this.config.maxWorkers
    ) {
      await this.spawnWorker();
    }
  }

  /**
   * Complete a pending request
   */
  private completeRequest(requestId: string, result: InferenceResult): void {
    const pending = this.pendingRequests.get(requestId);
    if (!pending) return;

    clearTimeout(pending.timeout);
    this.pendingRequests.delete(requestId);
    pending.resolve(result);
  }

  /**
   * Fail a pending request (with optional retry)
   */
  private failRequest(
    requestId: string,
    error: Error,
    retryable: boolean
  ): void {
    const pending = this.pendingRequests.get(requestId);
    if (!pending) return;

    const maxRetries = pending.request.options?.retryAttempts || 3;

    if (retryable && pending.attempts < maxRetries) {
      // Re-queue for retry
      this.requestQueue.push(pending.request);
      this.emit('request-retry', {
        requestId,
        attempt: pending.attempts,
        maxRetries,
      });
    } else {
      // Final failure
      clearTimeout(pending.timeout);
      this.pendingRequests.delete(requestId);
      pending.reject(error);
    }
  }

  /**
   * Cancel a pending request
   */
  cancel(requestId: string): boolean {
    const pending = this.pendingRequests.get(requestId);
    if (!pending) return false;

    // If assigned to a worker, send cancel message
    if (pending.workerId) {
      const worker = this.workers.get(pending.workerId);
      if (worker) {
        worker.worker.postMessage({
          type: 'cancel',
          payload: { requestId },
        });
      }
    }

    // Remove from queue if not yet dispatched
    const queueIndex = this.requestQueue.findIndex((r) => r.id === requestId);
    if (queueIndex !== -1) {
      this.requestQueue.splice(queueIndex, 1);
    }

    clearTimeout(pending.timeout);
    this.pendingRequests.delete(requestId);
    pending.reject(new Error('Request cancelled'));

    return true;
  }

  /**
   * Health check for workers
   */
  private healthCheck(): void {
    const now = Date.now();

    for (const [id, worker] of this.workers) {
      // Check for stuck workers
      if (
        worker.status === 'busy' &&
        worker.currentRequestId &&
        now - worker.lastHealthCheck > this.config.idleTimeout
      ) {
        this.emit('worker-stuck', { workerId: id });
        // Force restart stuck worker
        worker.worker.terminate();
      }

      worker.lastHealthCheck = now;
    }

    // Ensure minimum workers
    const activeWorkers = this.getReadyWorkerCount();
    if (activeWorkers < this.config.minWorkers) {
      const needed = this.config.minWorkers - activeWorkers;
      for (let i = 0; i < needed; i++) {
        this.spawnWorker();
      }
    }
  }

  /**
   * Get pool statistics
   */
  getStats(): {
    totalWorkers: number;
    readyWorkers: number;
    busyWorkers: number;
    deadWorkers: number;
    queueSize: number;
    pendingRequests: number;
  } {
    let ready = 0;
    let busy = 0;
    let dead = 0;

    for (const worker of this.workers.values()) {
      switch (worker.status) {
        case 'ready':
          ready++;
          break;
        case 'busy':
          busy++;
          break;
        case 'dead':
          dead++;
          break;
      }
    }

    return {
      totalWorkers: this.workers.size,
      readyWorkers: ready,
      busyWorkers: busy,
      deadWorkers: dead,
      queueSize: this.requestQueue.length,
      pendingRequests: this.pendingRequests.size,
    };
  }

  /**
   * Graceful shutdown
   */
  async shutdown(timeout = 30000): Promise<void> {
    this.isShuttingDown = true;

    // Stop health checks
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
    }

    // Cancel all pending requests
    for (const [requestId, pending] of this.pendingRequests) {
      clearTimeout(pending.timeout);
      pending.reject(new Error('Pool shutting down'));
    }
    this.pendingRequests.clear();
    this.requestQueue = [];

    // Send shutdown to all workers
    const shutdownPromises = Array.from(this.workers.values()).map(
      (managedWorker) =>
        new Promise<void>((resolve) => {
          const timer = setTimeout(() => {
            managedWorker.worker.terminate();
            resolve();
          }, timeout);

          managedWorker.worker.once('exit', () => {
            clearTimeout(timer);
            resolve();
          });

          managedWorker.worker.postMessage({ type: 'shutdown', payload: {} });
        })
    );

    await Promise.all(shutdownPromises);
    this.workers.clear();
    this.emit('shutdown');
  }
}
