// Checkpoint validation for L0 continuation

import type { CheckpointValidationResult } from "../types/l0";
import type { GuardrailContext } from "../types/guardrails";
import type { GuardrailEngine } from "../guardrails/engine";
import type { DriftDetector } from "./drift";

/**
 * Validate checkpoint content before using for continuation
 * This ensures all protections apply to the resumed content
 *
 * @param checkpointContent - The checkpoint content to validate
 * @param guardrailEngine - Optional guardrail engine to run checks
 * @param driftDetector - Optional drift detector to check for drift
 * @returns Validation result with violations and drift status
 */
export function validateCheckpointForContinuation(
  checkpointContent: string,
  guardrailEngine: GuardrailEngine | null,
  driftDetector: DriftDetector | null,
): CheckpointValidationResult {
  const result: CheckpointValidationResult = {
    skipContinuation: false,
    violations: [],
    driftDetected: false,
    driftTypes: [],
  };

  // Run guardrails on checkpoint content
  // Mark as completed: true so completion-only guardrail rules are applied
  // This ensures full safety checks run on the checkpoint before continuation
  if (guardrailEngine) {
    const checkpointContext: GuardrailContext = {
      content: checkpointContent,
      checkpoint: "",
      delta: checkpointContent,
      tokenCount: 1,
      completed: true,
    };
    const checkpointResult = guardrailEngine.check(checkpointContext);
    if (checkpointResult.violations.length > 0) {
      result.violations = checkpointResult.violations;
      // Check for fatal violations - if any, skip continuation
      const hasFatal = checkpointResult.violations.some(
        (v) => v.severity === "fatal",
      );
      if (hasFatal) {
        result.skipContinuation = true;
      }
    }
  }

  // Run drift detection on checkpoint content (only if not already skipping)
  if (!result.skipContinuation && driftDetector) {
    const driftResult = driftDetector.check(checkpointContent);
    if (driftResult.detected) {
      result.driftDetected = true;
      result.driftTypes = driftResult.types;
    }
  }

  return result;
}
