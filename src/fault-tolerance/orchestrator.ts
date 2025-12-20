/**
 * Fault Tolerance Orchestrator
 * Main entry point that ties together all fault-tolerance components
 */

import { EventEmitter } from 'events';
import type {
  FaultToleranceConfig,
  InferenceRequest,
  InferenceResult,
  InferenceOptions,
} from './types';
import { DEFAULT_CONFIG } from './types';
import { CheckpointManager } from './checkpoint-manager';
import { WorkerPool } from './worker-pool';
import { RequestQueue } from './request-queue';

export interface OrchestratorEvents {
  'started': { workerCount: number };
  'shutdown': void;
  'request-submitted': { requestId: string };
  'request-completed': { requestId: string; duration: number };
  'request-failed': { requestId: string; error: Error };
  'worker-crashed': { workerId: string };
  'worker-restarted': { workerId: string };
  'checkpoint-saved': { checkpointId: string };
  'recovery-started': { incompleteCount: number };
  'recovery-completed': { recoveredCount: number };
  'stats-updated': OrchestratorStats;
}

export interface OrchestratorStats {
  uptime: number;
  totalRequests: number;
  completedRequests: number;
  failedRequests: number;
  activeRequests: number;
  queuedRequests: number;
  workerStats: {
    total: number;
    ready: number;
    busy: number;
    dead: number;
  };
  checkpointStats: {
    active: number;
    incomplete: number;
  };
}

export class FaultTolerantInference extends EventEmitter {
  private config: FaultToleranceConfig;
  private checkpointManager: CheckpointManager;
  private workerPool: WorkerPool;
  private requestQueue: RequestQueue;
  private isRunning = false;
  private startTime?: number;
  private stats = {
    totalRequests: 0,
    completedRequests: 0,
    failedRequests: 0,
  };
  private statsTimer?: NodeJS.Timeout;

  constructor(config: Partial<FaultToleranceConfig> = {}) {
    super();
    this.config = this.mergeConfig(config);

    // Initialize components
    this.checkpointManager = new CheckpointManager(this.config.checkpoints);
    this.workerPool = new WorkerPool(
      this.config.workers,
      this.config.supervisor
    );
    this.requestQueue = new RequestQueue(
      this.checkpointManager,
      this.config.queue
    );

    // Wire up event handlers
    this.setupEventHandlers();
  }

  private mergeConfig(
    config: Partial<FaultToleranceConfig>
  ): FaultToleranceConfig {
    return {
      workers: { ...DEFAULT_CONFIG.workers, ...config.workers },
      supervisor: { ...DEFAULT_CONFIG.supervisor, ...config.supervisor },
      checkpoints: { ...DEFAULT_CONFIG.checkpoints, ...config.checkpoints },
      queue: { ...DEFAULT_CONFIG.queue, ...config.queue },
    };
  }

  private setupEventHandlers(): void {
    // Worker pool events
    this.workerPool.on('worker-error', ({ workerId, error }) => {
      this.emit('worker-crashed', { workerId });
    });

    this.workerPool.on('worker-restarting', ({ workerId }) => {
      this.emit('worker-restarted', { workerId });
    });

    this.workerPool.on('progress', (progress) => {
      // Update checkpoint with progress
      const checkpoint = this.checkpointManager.getByRequestId(
        progress.requestId
      );
      if (checkpoint) {
        this.checkpointManager.update(
          checkpoint.id,
          progress.partialContent,
          progress.tokensReceived
        );
      }
    });

    // Request queue events
    this.requestQueue.on('completed', ({ requestId, result }) => {
      this.stats.completedRequests++;
      this.emit('request-completed', {
        requestId,
        duration: result.duration,
      });
    });

    this.requestQueue.on('failed', ({ requestId, error }) => {
      this.stats.failedRequests++;
      this.emit('request-failed', { requestId, error });
    });

    this.requestQueue.on('replay-starting', ({ count }) => {
      this.emit('recovery-started', { incompleteCount: count });
    });

    this.requestQueue.on('replay-complete', ({ replayedCount }) => {
      this.emit('recovery-completed', { recoveredCount: replayedCount });
    });
  }

  /**
   * Start the fault-tolerant inference system
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      throw new Error('Orchestrator is already running');
    }

    this.startTime = Date.now();

    // Start worker pool
    await this.workerPool.start();

    // Connect queue to worker pool
    this.requestQueue.setProcessor((request) => this.workerPool.infer(request));

    // Recover any incomplete requests from previous session
    await this.requestQueue.replayFromCheckpoints();

    // Start stats reporting
    this.statsTimer = setInterval(() => {
      this.emit('stats-updated', this.getStats());
    }, 5000);

    this.isRunning = true;
    this.emit('started', { workerCount: this.workerPool.getStats().totalWorkers });
  }

  /**
   * Submit an inference request
   */
  async infer(
    prompt: string,
    options: InferenceOptions = {}
  ): Promise<InferenceResult> {
    if (!this.isRunning) {
      throw new Error('Orchestrator is not running. Call start() first.');
    }

    const request: InferenceRequest = {
      id: crypto.randomUUID(),
      prompt,
      model: options.fallbackModels?.[0],
      options,
      timestamp: Date.now(),
    };

    this.stats.totalRequests++;
    this.emit('request-submitted', { requestId: request.id });

    return this.requestQueue.enqueue(request);
  }

  /**
   * Cancel a pending request
   */
  cancel(requestId: string): boolean {
    return (
      this.requestQueue.cancel(requestId) || this.workerPool.cancel(requestId)
    );
  }

  /**
   * Get current system statistics
   */
  getStats(): OrchestratorStats {
    const workerStats = this.workerPool.getStats();
    const queueStats = this.requestQueue.getStats();
    const incompleteCheckpoints = this.checkpointManager.getIncomplete();

    return {
      uptime: this.startTime ? Date.now() - this.startTime : 0,
      totalRequests: this.stats.totalRequests,
      completedRequests: this.stats.completedRequests,
      failedRequests: this.stats.failedRequests,
      activeRequests: workerStats.busyWorkers,
      queuedRequests: queueStats.queueSize,
      workerStats: {
        total: workerStats.totalWorkers,
        ready: workerStats.readyWorkers,
        busy: workerStats.busyWorkers,
        dead: workerStats.deadWorkers,
      },
      checkpointStats: {
        active: queueStats.queueSize,
        incomplete: incompleteCheckpoints.length,
      },
    };
  }

  /**
   * Check if the system is healthy
   */
  isHealthy(): boolean {
    const stats = this.getStats();
    return (
      this.isRunning &&
      stats.workerStats.total > 0 &&
      stats.workerStats.dead < stats.workerStats.total
    );
  }

  /**
   * Graceful shutdown
   */
  async shutdown(timeout = 30000): Promise<void> {
    if (!this.isRunning) return;

    // Stop stats reporting
    if (this.statsTimer) {
      clearInterval(this.statsTimer);
    }

    // Shutdown components in order
    await this.requestQueue.shutdown();
    await this.workerPool.shutdown(timeout);
    await this.checkpointManager.shutdown();

    this.isRunning = false;
    this.emit('shutdown');
  }
}

/**
 * Factory function for creating a fault-tolerant inference instance
 */
export function createFaultTolerantInference(
  config: Partial<FaultToleranceConfig> = {}
): FaultTolerantInference {
  return new FaultTolerantInference(config);
}
