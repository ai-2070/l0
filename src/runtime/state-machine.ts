// Lightweight state machine for L0 runtime
// 7 states, no transition tables, no event types

export type RuntimeState =
  | "init"
  | "awaiting_first_token"
  | "streaming"
  | "deduplicating"
  | "validating_checkpoint"
  | "retrying"
  | "fallback"
  | "completing"
  | "done"
  | "error";

/**
 * Simple state machine for tracking runtime state.
 * No transition validation - just a state holder with helpers.
 */
export class StateMachine {
  private state: RuntimeState = "init";
  private history: Array<{
    from: RuntimeState;
    to: RuntimeState;
    timestamp: number;
  }> = [];
  private listeners: Set<(state: RuntimeState) => void> = new Set();

  /**
   * Transition to a new state
   */
  transition(next: RuntimeState): void {
    if (this.state !== next) {
      this.history.push({
        from: this.state,
        to: next,
        timestamp: Date.now(),
      });
      this.state = next;
      this.notify();
    }
  }

  /**
   * Get current state
   */
  get(): RuntimeState {
    return this.state;
  }

  /**
   * Check if current state matches any of the provided states
   */
  is(...states: RuntimeState[]): boolean {
    return states.includes(this.state);
  }

  /**
   * Check if state is terminal (done or error)
   */
  isTerminal(): boolean {
    return this.state === "done" || this.state === "error";
  }

  /**
   * Reset to initial state
   */
  reset(): void {
    this.state = "init";
    this.history = [];
  }

  /**
   * Get state history (for debugging)
   */
  getHistory(): ReadonlyArray<{
    from: RuntimeState;
    to: RuntimeState;
    timestamp: number;
  }> {
    return this.history;
  }

  /**
   * Subscribe to state changes
   */
  subscribe(listener: (state: RuntimeState) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    for (const listener of this.listeners) {
      try {
        listener(this.state);
      } catch {
        // Ignore listener errors
      }
    }
  }
}

/**
 * Create a new state machine instance
 */
export function createStateMachine(): StateMachine {
  return new StateMachine();
}
