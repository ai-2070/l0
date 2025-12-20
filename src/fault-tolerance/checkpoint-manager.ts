/**
 * Checkpoint Manager
 * Persists inference state to disk for crash recovery
 */

import { existsSync, mkdirSync, readdirSync, unlinkSync, writeFileSync, readFileSync } from 'fs';
import { join } from 'path';
import type { InferenceCheckpoint, CheckpointConfig } from './types';
import { DEFAULT_CONFIG } from './types';

export class CheckpointManager {
  private config: CheckpointConfig;
  private checkpoints: Map<string, InferenceCheckpoint> = new Map();
  private saveTimers: Map<string, NodeJS.Timeout> = new Map();
  private cleanupTimer?: NodeJS.Timeout;

  constructor(config: Partial<CheckpointConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG.checkpoints, ...config };
    this.ensureDirectory();
    this.loadExistingCheckpoints();
    this.startCleanupTimer();
  }

  private ensureDirectory(): void {
    if (!existsSync(this.config.directory)) {
      mkdirSync(this.config.directory, { recursive: true });
    }
  }

  private getCheckpointPath(id: string): string {
    return join(this.config.directory, `${id}.json`);
  }

  private loadExistingCheckpoints(): void {
    try {
      const files = readdirSync(this.config.directory);
      for (const file of files) {
        if (file.endsWith('.json')) {
          try {
            const content = readFileSync(join(this.config.directory, file), 'utf-8');
            const checkpoint = JSON.parse(content) as InferenceCheckpoint;

            // Only load non-completed checkpoints that aren't too old
            if (
              checkpoint.status !== 'completed' &&
              Date.now() - checkpoint.updatedAt < this.config.maxAge
            ) {
              this.checkpoints.set(checkpoint.id, checkpoint);
            }
          } catch {
            // Skip corrupted checkpoint files
          }
        }
      }
    } catch {
      // Directory might not exist yet
    }
  }

  private startCleanupTimer(): void {
    this.cleanupTimer = setInterval(() => {
      this.cleanup();
    }, this.config.cleanupInterval);
  }

  /**
   * Create a new checkpoint for an inference request
   */
  create(
    requestId: string,
    prompt: string,
    model: string
  ): InferenceCheckpoint {
    const checkpoint: InferenceCheckpoint = {
      id: crypto.randomUUID(),
      requestId,
      prompt,
      partialResponse: '',
      tokensReceived: 0,
      model,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      status: 'streaming',
      attempts: 1,
    };

    this.checkpoints.set(checkpoint.id, checkpoint);
    this.scheduleSave(checkpoint.id);

    return checkpoint;
  }

  /**
   * Update checkpoint with streaming progress
   */
  update(
    id: string,
    partialResponse: string,
    tokensReceived: number
  ): void {
    const checkpoint = this.checkpoints.get(id);
    if (!checkpoint) return;

    checkpoint.partialResponse = partialResponse;
    checkpoint.tokensReceived = tokensReceived;
    checkpoint.updatedAt = Date.now();

    this.scheduleSave(id);
  }

  /**
   * Mark checkpoint as failed (for retry)
   */
  markFailed(id: string, error: string): void {
    const checkpoint = this.checkpoints.get(id);
    if (!checkpoint) return;

    checkpoint.status = 'failed';
    checkpoint.error = error;
    checkpoint.updatedAt = Date.now();
    checkpoint.attempts++;

    this.saveImmediately(id);
  }

  /**
   * Mark checkpoint as completed and remove
   */
  complete(id: string): void {
    const checkpoint = this.checkpoints.get(id);
    if (!checkpoint) return;

    checkpoint.status = 'completed';
    checkpoint.updatedAt = Date.now();

    // Clear any pending save
    const timer = this.saveTimers.get(id);
    if (timer) {
      clearTimeout(timer);
      this.saveTimers.delete(id);
    }

    // Remove from memory and disk
    this.checkpoints.delete(id);
    this.deleteFromDisk(id);
  }

  /**
   * Get checkpoint by ID
   */
  get(id: string): InferenceCheckpoint | undefined {
    return this.checkpoints.get(id);
  }

  /**
   * Get checkpoint by request ID
   */
  getByRequestId(requestId: string): InferenceCheckpoint | undefined {
    for (const checkpoint of this.checkpoints.values()) {
      if (checkpoint.requestId === requestId) {
        return checkpoint;
      }
    }
    return undefined;
  }

  /**
   * Get all incomplete checkpoints (for recovery on restart)
   */
  getIncomplete(): InferenceCheckpoint[] {
    return Array.from(this.checkpoints.values()).filter(
      (cp) => cp.status !== 'completed'
    );
  }

  /**
   * Get failed checkpoints that can be retried
   */
  getRetryable(maxAttempts: number): InferenceCheckpoint[] {
    return Array.from(this.checkpoints.values()).filter(
      (cp) => cp.status === 'failed' && cp.attempts < maxAttempts
    );
  }

  private scheduleSave(id: string): void {
    // Debounce saves to avoid excessive disk I/O
    const existingTimer = this.saveTimers.get(id);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    const timer = setTimeout(() => {
      this.saveImmediately(id);
      this.saveTimers.delete(id);
    }, this.config.saveInterval);

    this.saveTimers.set(id, timer);
  }

  private saveImmediately(id: string): void {
    const checkpoint = this.checkpoints.get(id);
    if (!checkpoint) return;

    try {
      const path = this.getCheckpointPath(id);
      writeFileSync(path, JSON.stringify(checkpoint, null, 2));
    } catch (error) {
      console.error(`Failed to save checkpoint ${id}:`, error);
    }
  }

  private deleteFromDisk(id: string): void {
    try {
      const path = this.getCheckpointPath(id);
      if (existsSync(path)) {
        unlinkSync(path);
      }
    } catch {
      // Ignore deletion errors
    }
  }

  /**
   * Clean up old checkpoints
   */
  cleanup(): void {
    const now = Date.now();
    const toDelete: string[] = [];

    for (const [id, checkpoint] of this.checkpoints) {
      if (
        checkpoint.status === 'completed' ||
        now - checkpoint.updatedAt > this.config.maxAge
      ) {
        toDelete.push(id);
      }
    }

    for (const id of toDelete) {
      this.checkpoints.delete(id);
      this.deleteFromDisk(id);
    }

    // Also clean up orphaned files on disk
    try {
      const files = readdirSync(this.config.directory);
      for (const file of files) {
        if (file.endsWith('.json')) {
          const id = file.replace('.json', '');
          if (!this.checkpoints.has(id)) {
            try {
              const content = readFileSync(
                join(this.config.directory, file),
                'utf-8'
              );
              const checkpoint = JSON.parse(content) as InferenceCheckpoint;
              if (
                checkpoint.status === 'completed' ||
                now - checkpoint.updatedAt > this.config.maxAge
              ) {
                unlinkSync(join(this.config.directory, file));
              }
            } catch {
              // Delete corrupted files
              unlinkSync(join(this.config.directory, file));
            }
          }
        }
      }
    } catch {
      // Ignore cleanup errors
    }
  }

  /**
   * Shutdown and flush all pending saves
   */
  async shutdown(): Promise<void> {
    // Clear cleanup timer
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
    }

    // Flush all pending saves
    for (const [id, timer] of this.saveTimers) {
      clearTimeout(timer);
      this.saveImmediately(id);
    }
    this.saveTimers.clear();
  }
}
