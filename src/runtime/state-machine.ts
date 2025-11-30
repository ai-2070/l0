// Lightweight state machine for L0 runtime
// 10 states, no transition tables, no event types

/**
 * Runtime state constants - use these instead of string literals
 * to prevent typos and get better editor autocomplete.
 */
export const RuntimeStates = {
  INIT: "init",
  WAITING_FOR_TOKEN: "waiting_for_token",
  STREAMING: "streaming",
  CONTINUATION_MATCHING: "continuation_matching",
  CHECKPOINT_VERIFYING: "checkpoint_verifying",
  RETRYING: "retrying",
  FALLBACK: "fallback",
  FINALIZING: "finalizing",
  DONE: "done",
  ERROR: "error",
} as const;

export type RuntimeState = (typeof RuntimeStates)[keyof typeof RuntimeStates];

/**
 * Simple state machine for tracking runtime state.
 * No transition validation - just a state holder with helpers.
 */
export class StateMachine {
  private state: RuntimeState = RuntimeStates.INIT;
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
    return (
      this.state === RuntimeStates.DONE || this.state === RuntimeStates.ERROR
    );
  }

  /**
   * Reset to initial state
   */
  reset(): void {
    this.state = RuntimeStates.INIT;
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
