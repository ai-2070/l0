// State management for L0 runtime

import type { L0State } from "../types/l0";

/**
 * Create initial L0 state
 */
export function createInitialState(): L0State {
  return {
    content: "",
    checkpoint: "",
    tokenCount: 0,
    retryAttempts: 0,
    networkRetries: 0,
    fallbackIndex: 0,
    violations: [],
    driftDetected: false,
    completed: false,
    networkErrors: [],
    continuedFromCheckpoint: false,
    dataOutputs: [],
  };
}

/**
 * State manager for tracking L0 runtime state
 */
export class StateManager {
  private state: L0State;
  private snapshots: L0State[] = [];

  constructor(initialState?: Partial<L0State>) {
    this.state = {
      ...createInitialState(),
      ...initialState,
    };
  }

  /**
   * Get current state
   */
  getState(): L0State {
    return { ...this.state };
  }

  /**
   * Update state
   */
  updateState(updates: Partial<L0State>): void {
    this.state = {
      ...this.state,
      ...updates,
    };
  }

  /**
   * Append content to state
   */
  appendContent(content: string): void {
    this.state.content += content;
    this.state.tokenCount++;
    this.state.lastTokenAt = Date.now();

    if (!this.state.firstTokenAt) {
      this.state.firstTokenAt = Date.now();
    }
  }

  /**
   * Create checkpoint (save current content)
   */
  checkpoint(): void {
    this.state.checkpoint = this.state.content;
  }

  /**
   * Restore from checkpoint
   */
  restoreCheckpoint(): void {
    if (this.state.checkpoint) {
      this.state.content = this.state.checkpoint;
    }
  }

  /**
   * Create snapshot of current state
   */
  snapshot(): void {
    this.snapshots.push({ ...this.state });
  }

  /**
   * Restore from last snapshot
   */
  restore(): boolean {
    const snapshot = this.snapshots.pop();
    if (snapshot) {
      this.state = snapshot;
      return true;
    }
    return false;
  }

  /**
   * Reset state to initial values
   */
  reset(): void {
    this.state = createInitialState();
    this.snapshots = [];
  }

  /**
   * Mark as completed
   */
  markCompleted(): void {
    this.state.completed = true;
  }

  /**
   * Increment retry attempts
   */
  incrementRetries(): void {
    this.state.retryAttempts++;
  }

  /**
   * Increment network retries
   */
  incrementNetworkRetries(): void {
    this.state.networkRetries++;
  }

  /**
   * Add violation to state
   */
  addViolation(violation: any): void {
    this.state.violations.push(violation);
  }

  /**
   * Set drift detected flag
   */
  setDriftDetected(detected: boolean): void {
    this.state.driftDetected = detected;
  }

  /**
   * Get content length
   */
  getContentLength(): number {
    return this.state.content.length;
  }

  /**
   * Get token count
   */
  getTokenCount(): number {
    return this.state.tokenCount;
  }

  /**
   * Check if completed
   */
  isCompleted(): boolean {
    return this.state.completed;
  }

  /**
   * Serialize state to JSON
   */
  toJSON(): string {
    return JSON.stringify(this.state);
  }

  /**
   * Load state from JSON
   */
  fromJSON(json: string): void {
    this.state = JSON.parse(json);
  }
}

/**
 * Create a state manager
 */
export function createStateManager(
  initialState?: Partial<L0State>,
): StateManager {
  return new StateManager(initialState);
}
