/**
 * Fault Tolerance Types
 * Core type definitions for the fault-tolerant inference system
 */

export interface InferenceRequest {
  id: string;
  prompt: string;
  model?: string;
  options?: InferenceOptions;
  timestamp: number;
}

export interface InferenceOptions {
  maxTokens?: number;
  temperature?: number;
  systemPrompt?: string;
  timeout?: number;
  retryAttempts?: number;
  fallbackModels?: string[];
}

export interface InferenceResult {
  id: string;
  requestId: string;
  content: string;
  tokensUsed: number;
  model: string;
  duration: number;
  completedAt: number;
}

export interface InferenceCheckpoint {
  id: string;
  requestId: string;
  prompt: string;
  partialResponse: string;
  tokensReceived: number;
  model: string;
  createdAt: number;
  updatedAt: number;
  status: 'streaming' | 'paused' | 'failed' | 'completed';
  error?: string;
  attempts: number;
}

export interface WorkerMessage {
  type: 'request' | 'cancel' | 'shutdown';
  payload: InferenceRequest | { requestId: string };
}

export interface WorkerResponse {
  type: 'result' | 'error' | 'progress' | 'ready';
  requestId: string;
  payload: InferenceResult | WorkerError | ProgressUpdate;
}

export interface WorkerError {
  code: string;
  message: string;
  retryable: boolean;
  details?: unknown;
}

export interface ProgressUpdate {
  tokensReceived: number;
  partialContent: string;
  elapsed: number;
}

export interface WorkerPoolConfig {
  minWorkers: number;
  maxWorkers: number;
  idleTimeout: number;
  maxRestarts: number;
  restartWindow: number;
  healthCheckInterval: number;
}

export interface SupervisorConfig {
  maxRestarts: number;
  restartWindow: number;
  backoffInitial: number;
  backoffMax: number;
  backoffMultiplier: number;
}

export interface CheckpointConfig {
  directory: string;
  saveInterval: number;
  maxAge: number;
  cleanupInterval: number;
}

export interface QueueConfig {
  maxSize: number;
  maxRetries: number;
  retryDelay: number;
  timeout: number;
}

export interface FaultToleranceConfig {
  workers: WorkerPoolConfig;
  supervisor: SupervisorConfig;
  checkpoints: CheckpointConfig;
  queue: QueueConfig;
}

export const DEFAULT_CONFIG: FaultToleranceConfig = {
  workers: {
    minWorkers: 2,
    maxWorkers: 4,
    idleTimeout: 60000,
    maxRestarts: 10,
    restartWindow: 60000,
    healthCheckInterval: 5000,
  },
  supervisor: {
    maxRestarts: 10,
    restartWindow: 60000,
    backoffInitial: 1000,
    backoffMax: 30000,
    backoffMultiplier: 2,
  },
  checkpoints: {
    directory: './.l0-checkpoints',
    saveInterval: 1000,
    maxAge: 86400000, // 24 hours
    cleanupInterval: 3600000, // 1 hour
  },
  queue: {
    maxSize: 1000,
    maxRetries: 3,
    retryDelay: 1000,
    timeout: 120000,
  },
};
