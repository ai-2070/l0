/**
 * L0 Drift Detection - Detect model derailment and anomalies
 *
 * Import from "@ai2070/l0/drift" to get drift detection features
 * without bundling them in your main application when using core.
 *
 * @example
 * ```typescript
 * import { DriftDetector, checkDrift } from "@ai2070/l0/drift";
 * ```
 */

// Drift detector
export {
  DriftDetector,
  createDriftDetector,
  checkDrift,
} from "./runtime/drift.js";

export type { DriftResult, DriftType, DriftConfig } from "./runtime/drift.js";

// Async drift checks
export {
  runAsyncDriftCheck,
  runDriftCheckAsync,
} from "./runtime/async-drift.js";

export type { DriftCheckResult } from "./runtime/async-drift.js";
