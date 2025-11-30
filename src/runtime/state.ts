// L0 state management utilities

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
 * Options for preserving specific state fields during reset
 */
export interface StateResetPreserveOptions {
  checkpoint?: string;
  continuedFromCheckpoint?: boolean;
  continuationCheckpoint?: string;
  retryAttempts?: number;
  networkRetries?: number;
  fallbackIndex?: number;
}

/**
 * Reset L0 state for retry/fallback while preserving specific fields
 * This centralizes state reset logic to prevent inconsistencies
 */
export function resetStateForRetry(
  state: L0State,
  preserve: StateResetPreserveOptions = {},
): void {
  state.content = "";
  state.tokenCount = 0;
  state.violations = [];
  state.driftDetected = false;
  state.dataOutputs = [];
  state.lastProgress = undefined;
  state.completed = false;
  state.networkErrors = [];

  // Restore preserved fields
  if (preserve.checkpoint !== undefined) {
    state.checkpoint = preserve.checkpoint;
  }
  if (preserve.continuedFromCheckpoint !== undefined) {
    state.continuedFromCheckpoint = preserve.continuedFromCheckpoint;
  }
  if (preserve.continuationCheckpoint !== undefined) {
    state.continuationCheckpoint = preserve.continuationCheckpoint;
  }
  if (preserve.retryAttempts !== undefined) {
    state.retryAttempts = preserve.retryAttempts;
  }
  if (preserve.networkRetries !== undefined) {
    state.networkRetries = preserve.networkRetries;
  }
  if (preserve.fallbackIndex !== undefined) {
    state.fallbackIndex = preserve.fallbackIndex;
  }
}
