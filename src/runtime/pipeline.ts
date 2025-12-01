// Simple pipeline for L0 event processing
// Just an array of functions - no framework, no builders

import type { L0Event, L0State } from "../types/l0";
import type { StateMachine } from "./state-machine";
import type { L0Monitor } from "./monitoring";

/**
 * Context passed to each pipeline stage
 */
export interface PipelineContext {
  state: L0State;
  stateMachine: StateMachine;
  monitor: L0Monitor;
  signal?: AbortSignal;

  // Scratch space for stages to share data
  scratch: Map<string, unknown>;
}

/**
 * A pipeline stage is a simple function that:
 * - Receives an event and context
 * - Returns the event (possibly modified), or null to filter it out
 */
export type Stage = (event: L0Event, ctx: PipelineContext) => L0Event | null;

/**
 * Run an event through all pipeline stages.
 * Returns the final event, or null if any stage filtered it.
 */
export function runStages(
  stages: Stage[],
  event: L0Event,
  ctx: PipelineContext,
): L0Event | null {
  let current: L0Event | null = event;

  for (const stage of stages) {
    if (current === null) break;
    current = stage(current, ctx);
  }

  return current;
}

/**
 * Create a pipeline context
 */
export function createPipelineContext(
  state: L0State,
  stateMachine: StateMachine,
  monitor: L0Monitor,
  signal?: AbortSignal,
): PipelineContext {
  return {
    state,
    stateMachine,
    monitor,
    signal,
    scratch: new Map(),
  };
}
