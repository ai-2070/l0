// Guardrail engine for executing rules and tracking violations

import type {
  GuardrailRule,
  GuardrailContext,
  GuardrailViolation,
  GuardrailState,
  GuardrailConfig,
  GuardrailResult,
} from "../types/guardrails";

/**
 * Guardrail engine for executing rules and managing violations
 */
export class GuardrailEngine {
  private rules: GuardrailRule[];
  private config: GuardrailConfig;
  private state: GuardrailState;

  constructor(config: GuardrailConfig) {
    this.rules = config.rules || [];
    this.config = {
      stopOnFatal: true,
      enableStreaming: true,
      checkInterval: 100,
      ...config,
    };
    this.state = this.createInitialState();
  }

  /**
   * Create initial guardrail state
   */
  private createInitialState(): GuardrailState {
    return {
      violations: [],
      violationsByRule: new Map(),
      hasFatalViolations: false,
      hasErrorViolations: false,
      violationCount: 0,
    };
  }

  /**
   * Execute all rules against context
   * @param context - Guardrail context
   * @returns Guardrail result
   */
  check(context: GuardrailContext): GuardrailResult {
    const violations: GuardrailViolation[] = [];
    const timestamp = Date.now();

    // Execute each rule
    for (const rule of this.rules) {
      // Skip streaming rules if not enabled or not streaming check
      if (
        rule.streaming &&
        !this.config.enableStreaming &&
        !context.completed
      ) {
        continue;
      }

      // Skip non-streaming rules if streaming check
      if (!rule.streaming && !context.completed) {
        continue;
      }

      try {
        const ruleViolations = rule.check({
          ...context,
          previousViolations: this.state.violations,
        });

        // Add timestamp to violations
        for (const violation of ruleViolations) {
          violations.push({
            ...violation,
            timestamp: timestamp,
          });
        }

        // Track violations by rule
        if (ruleViolations.length > 0) {
          const existing = this.state.violationsByRule.get(rule.name) || [];
          this.state.violationsByRule.set(rule.name, [
            ...existing,
            ...ruleViolations,
          ]);
        }

        // Stop on fatal if configured
        if (
          this.config.stopOnFatal &&
          ruleViolations.some((v) => v.severity === "fatal")
        ) {
          break;
        }
      } catch (error) {
        // Rule execution failed - treat as warning
        violations.push({
          rule: rule.name,
          message: `Rule execution failed: ${error instanceof Error ? error.message : "Unknown error"}`,
          severity: "warning",
          recoverable: true,
          timestamp,
        });
      }
    }

    // Update state
    this.state.violations.push(...violations);
    this.state.violationCount = this.state.violations.length;
    this.state.hasFatalViolations = violations.some(
      (v) => v.severity === "fatal",
    );
    this.state.hasErrorViolations = violations.some(
      (v) => v.severity === "error",
    );
    this.state.lastCheckTime = timestamp;

    // Notify callback
    if (this.config.onViolation) {
      for (const violation of violations) {
        this.config.onViolation(violation);
      }
    }

    // Build result
    const result: GuardrailResult = {
      passed: violations.length === 0,
      violations,
      shouldRetry: this.shouldRetry(violations),
      shouldHalt: this.shouldHalt(violations),
      summary: {
        total: violations.length,
        fatal: violations.filter((v) => v.severity === "fatal").length,
        errors: violations.filter((v) => v.severity === "error").length,
        warnings: violations.filter((v) => v.severity === "warning").length,
      },
    };

    return result;
  }

  /**
   * Determine if violations should trigger a retry
   */
  private shouldRetry(violations: GuardrailViolation[]): boolean {
    // Retry if any recoverable error or fatal violation
    return violations.some(
      (v) =>
        v.recoverable && (v.severity === "error" || v.severity === "fatal"),
    );
  }

  /**
   * Determine if violations should halt execution
   */
  private shouldHalt(violations: GuardrailViolation[]): boolean {
    // Halt on fatal violations
    if (violations.some((v) => v.severity === "fatal")) {
      return true;
    }

    // Halt on non-recoverable errors
    if (violations.some((v) => !v.recoverable && v.severity === "error")) {
      return true;
    }

    return false;
  }

  /**
   * Get current state
   */
  getState(): GuardrailState {
    return { ...this.state };
  }

  /**
   * Reset state
   */
  reset(): void {
    this.state = this.createInitialState();
  }

  /**
   * Add a rule to the engine
   */
  addRule(rule: GuardrailRule): void {
    this.rules.push(rule);
  }

  /**
   * Remove a rule from the engine
   */
  removeRule(ruleName: string): boolean {
    const index = this.rules.findIndex((r) => r.name === ruleName);
    if (index !== -1) {
      this.rules.splice(index, 1);
      return true;
    }
    return false;
  }

  /**
   * Get violations for a specific rule
   */
  getViolationsByRule(ruleName: string): GuardrailViolation[] {
    return this.state.violationsByRule.get(ruleName) || [];
  }

  /**
   * Get all violations
   */
  getAllViolations(): GuardrailViolation[] {
    return [...this.state.violations];
  }

  /**
   * Check if any violations exist
   */
  hasViolations(): boolean {
    return this.state.violationCount > 0;
  }

  /**
   * Check if any fatal violations exist
   */
  hasFatalViolations(): boolean {
    return this.state.hasFatalViolations;
  }

  /**
   * Check if any error violations exist
   */
  hasErrorViolations(): boolean {
    return this.state.hasErrorViolations;
  }
}

/**
 * Create a guardrail engine with rules
 */
export function createGuardrailEngine(
  rules: GuardrailRule[],
  options?: Partial<GuardrailConfig>,
): GuardrailEngine {
  return new GuardrailEngine({
    rules,
    ...options,
  });
}

/**
 * Execute rules once and return result
 */
export function checkGuardrails(
  context: GuardrailContext,
  rules: GuardrailRule[],
): GuardrailResult {
  const engine = createGuardrailEngine(rules);
  return engine.check(context);
}
