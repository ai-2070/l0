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
    modelRetryCount: 0,
    networkRetryCount: 0,
    fallbackIndex: 0,
    violations: [],
    driftDetected: false,
    completed: false,
    networkErrors: [],
    resumed: false,
    dataOutputs: [],
  };
}

/**
 * Options for preserving specific state fields during reset
 */
export interface StateResetPreserveOptions {
  checkpoint?: string;
  resumed?: boolean;
  resumePoint?: string;
  resumeFrom?: number;
  modelRetryCount?: number;
  networkRetryCount?: number;
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
  if (preserve.resumed !== undefined) {
    state.resumed = preserve.resumed;
  }
  if (preserve.resumePoint !== undefined) {
    state.resumePoint = preserve.resumePoint;
  }
  if (preserve.resumeFrom !== undefined) {
    state.resumeFrom = preserve.resumeFrom;
  }
  if (preserve.modelRetryCount !== undefined) {
    state.modelRetryCount = preserve.modelRetryCount;
  }
  if (preserve.networkRetryCount !== undefined) {
    state.networkRetryCount = preserve.networkRetryCount;
  }
  if (preserve.fallbackIndex !== undefined) {
    state.fallbackIndex = preserve.fallbackIndex;
  }
}
