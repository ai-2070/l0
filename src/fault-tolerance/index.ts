/**
 * Fault Tolerance Module
 * Provides process-level fault tolerance for L0 inference
 *
 * Features:
 * - Checkpoint Manager: Persists streaming state for crash recovery
 * - Worker Pool: Multiple isolated worker processes with auto-restart
 * - Process Supervision: Automatic restart with exponential backoff
 * - Request Queue: Request persistence and replay on recovery
 *
 * Usage:
 * ```typescript
 * import { createFaultTolerantInference } from '@ai2070/l0/fault-tolerance';
 *
 * const inference = createFaultTolerantInference({
 *   workers: { minWorkers: 2, maxWorkers: 4 },
 *   checkpoints: { directory: './.l0-checkpoints' }
 * });
 *
 * await inference.start();
 *
 * const result = await inference.infer('Explain quantum computing', {
 *   timeout: 60000,
 *   retryAttempts: 3,
 *   fallbackModels: ['gpt-4o', 'gpt-4o-mini']
 * });
 *
 * console.log(result.content);
 *
 * await inference.shutdown();
 * ```
 */

// Types
export type {
  InferenceRequest,
  InferenceResult,
  InferenceOptions,
  InferenceCheckpoint,
  WorkerMessage,
  WorkerResponse,
  WorkerError,
  ProgressUpdate,
  WorkerPoolConfig,
  SupervisorConfig,
  CheckpointConfig,
  QueueConfig,
  FaultToleranceConfig,
} from './types';

export { DEFAULT_CONFIG } from './types';

// Components
export { CheckpointManager } from './checkpoint-manager';
export { WorkerPool } from './worker-pool';
export { RequestQueue } from './request-queue';

// Orchestrator
export {
  FaultTolerantInference,
  createFaultTolerantInference,
  type OrchestratorStats,
  type OrchestratorEvents,
} from './orchestrator';
