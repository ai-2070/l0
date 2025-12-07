// Guardrail types for L0

/**
 * Guardrail rule interface
 */
export interface GuardrailRule {
  /**
   * Unique name of the rule
   */
  name: string;

  /**
   * Description of what the rule checks
   */
  description?: string;

  /**
   * Check function that validates content
   * Returns violations found, or empty array if valid
   */
  check: (context: GuardrailContext) => GuardrailViolation[];

  /**
   * Whether this rule should run on every token or only at completion
   */
  streaming?: boolean;

  /**
   * Severity level for violations from this rule
   */
  severity?: "warning" | "error" | "fatal";

  /**
   * Whether violations are recoverable via retry
   */
  recoverable?: boolean;
}

/**
 * Context passed to guardrail rules
 */
export interface GuardrailContext {
  /**
   * Current accumulated content
   */
  content: string;

  /**
   * Previous checkpoint content
   */
  checkpoint?: string;

  /**
   * Current token delta
   */
  delta?: string;

  /**
   * Total tokens received
   */
  tokenCount: number;

  /**
   * Whether stream is complete
   */
  completed: boolean;

  /**
   * Stream metadata
   */
  metadata?: Record<string, any>;

  /**
   * Previous violations (for context)
   */
  previousViolations?: GuardrailViolation[];
}

/**
 * Guardrail violation result
 */
export interface GuardrailViolation {
  /**
   * Name of the rule that was violated
   */
  rule: string;

  /**
   * Human-readable message
   */
  message: string;

  /**
   * Severity of the violation
   */
  severity: "warning" | "error" | "fatal";

  /**
   * Position in content where violation occurred (if applicable)
   */
  position?: number;

  /**
   * Whether this violation is recoverable via retry
   */
  recoverable: boolean;

  /**
   * Timestamp when violation was detected
   */
  timestamp?: number;

  /**
   * Additional context about the violation
   */
  context?: Record<string, any>;

  /**
   * Suggested fix or action
   */
  suggestion?: string;
}

/**
 * Guardrail engine state
 */
export interface GuardrailState {
  /**
   * All violations encountered
   */
  violations: GuardrailViolation[];

  /**
   * Violations by rule name
   */
  violationsByRule: Map<string, GuardrailViolation[]>;

  /**
   * Whether any fatal violations occurred
   */
  hasFatalViolations: boolean;

  /**
   * Whether any error violations occurred
   */
  hasErrorViolations: boolean;

  /**
   * Total violation count
   */
  violationCount: number;

  /**
   * Last check timestamp
   */
  lastCheckTime?: number;
}

/**
 * Guardrail engine configuration
 */
export interface GuardrailConfig {
  /**
   * Rules to apply
   */
  rules: GuardrailRule[];

  /**
   * Whether to stop on first fatal violation
   */
  stopOnFatal?: boolean;

  /**
   * Whether to run streaming checks
   */
  enableStreaming?: boolean;

  /**
   * Interval for streaming checks (in tokens or ms)
   */
  checkInterval?: number;

  /**
   * Callback when violation is detected
   */
  onViolation?: (violation: GuardrailViolation) => void;

  /**
   * Callback when guardrail phase starts
   */
  onPhaseStart?: (
    phase: "pre" | "post",
    ruleCount: number,
    tokenCount: number,
  ) => void;

  /**
   * Callback when guardrail phase ends
   */
  onPhaseEnd?: (
    phase: "pre" | "post",
    passed: boolean,
    violations: GuardrailViolation[],
  ) => void;

  /**
   * Callback when a rule starts
   */
  onRuleStart?: (index: number, ruleId: string) => void;

  /**
   * Callback when a rule ends
   */
  onRuleEnd?: (index: number, ruleId: string, passed: boolean) => void;
}

/**
 * Result from running guardrails
 */
export interface GuardrailResult {
  /**
   * Whether all checks passed
   */
  passed: boolean;

  /**
   * All violations found
   */
  violations: GuardrailViolation[];

  /**
   * Whether content should be retried
   */
  shouldRetry: boolean;

  /**
   * Whether execution should halt
   */
  shouldHalt: boolean;

  /**
   * Summary of results
   */
  summary: {
    total: number;
    fatal: number;
    errors: number;
    warnings: number;
  };
}

/**
 * JSON structure tracking for guardrails
 */
export interface JsonStructure {
  /**
   * Open brace count
   */
  openBraces: number;

  /**
   * Close brace count
   */
  closeBraces: number;

  /**
   * Open bracket count
   */
  openBrackets: number;

  /**
   * Close bracket count
   */
  closeBrackets: number;

  /**
   * Whether currently in a string
   */
  inString: boolean;

  /**
   * Whether structure is balanced
   */
  isBalanced: boolean;

  /**
   * Detected structure issues
   */
  issues: string[];
}

/**
 * Markdown structure tracking
 */
export interface MarkdownStructure {
  /**
   * Open code fence count (```)
   */
  openFences: number;

  /**
   * Fence languages detected
   */
  fenceLanguages: string[];

  /**
   * Whether currently in a fence
   */
  inFence: boolean;

  /**
   * Header levels found
   */
  headers: number[];

  /**
   * List depth
   */
  listDepth: number;

  /**
   * Detected structure issues
   */
  issues: string[];
}

/**
 * LaTeX structure tracking
 */
export interface LatexStructure {
  /**
   * Open environments (begin{})
   */
  openEnvironments: string[];

  /**
   * Whether structure is balanced
   */
  isBalanced: boolean;

  /**
   * Detected structure issues
   */
  issues: string[];
}

/**
 * Pattern matching configuration
 */
export interface PatternConfig {
  /**
   * Patterns to detect (as regex strings or RegExp)
   */
  patterns: Array<string | RegExp>;

  /**
   * Whether patterns indicate bad output
   */
  isBadPattern: boolean;

  /**
   * Custom message for matches
   */
  message?: string;

  /**
   * Whether to treat as fatal
   */
  fatal?: boolean;
}

/**
 * Drift detection configuration
 */
export interface DriftConfig {
  /**
   * Enable tone shift detection
   */
  detectToneShift?: boolean;

  /**
   * Enable meta commentary detection
   */
  detectMetaCommentary?: boolean;

  /**
   * Enable repeated token detection
   */
  detectRepetition?: boolean;

  /**
   * Enable entropy spike detection
   */
  detectEntropySpike?: boolean;

  /**
   * Entropy threshold (standard deviations)
   */
  entropyThreshold?: number;

  /**
   * Repetition threshold (max repeated tokens)
   */
  repetitionThreshold?: number;
}

/**
 * Function call validation structure
 */
export interface FunctionCallStructure {
  /**
   * Tool/function name
   */
  name?: string;

  /**
   * Arguments (should be valid JSON)
   */
  arguments?: string;

  /**
   * Parsed arguments
   */
  parsedArguments?: Record<string, any>;

  /**
   * Whether structure is valid
   */
  isValid: boolean;

  /**
   * Validation errors
   */
  errors: string[];
}

/**
 * Schema validation result
 */
export interface SchemaValidation {
  /**
   * Whether content matches schema
   */
  valid: boolean;

  /**
   * Validation errors
   */
  errors: string[];

  /**
   * Parsed content (if valid)
   */
  parsed?: any;
}
