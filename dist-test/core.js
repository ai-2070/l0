// src/guardrails/engine.ts
var GuardrailEngine = class {
  rules;
  config;
  state;
  constructor(config) {
    this.rules = config.rules || [];
    this.config = {
      stopOnFatal: true,
      enableStreaming: true,
      checkInterval: 100,
      ...config
    };
    this.state = this.createInitialState();
  }
  /**
   * Create initial guardrail state
   */
  createInitialState() {
    return {
      violations: [],
      violationsByRule: /* @__PURE__ */ new Map(),
      hasFatalViolations: false,
      hasErrorViolations: false,
      violationCount: 0
    };
  }
  /**
   * Execute all rules against context
   * @param context - Guardrail context
   * @returns Guardrail result
   */
  check(context) {
    const violations = [];
    const timestamp = Date.now();
    for (const rule of this.rules) {
      if (rule.streaming && !this.config.enableStreaming && !context.completed) {
        continue;
      }
      if (!rule.streaming && !context.completed) {
        continue;
      }
      try {
        const ruleViolations = rule.check({
          ...context,
          previousViolations: this.state.violations
        });
        for (const violation of ruleViolations) {
          violations.push({
            ...violation,
            timestamp
          });
        }
        if (ruleViolations.length > 0) {
          const existing = this.state.violationsByRule.get(rule.name) || [];
          this.state.violationsByRule.set(rule.name, [
            ...existing,
            ...ruleViolations
          ]);
        }
        if (this.config.stopOnFatal && ruleViolations.some((v) => v.severity === "fatal")) {
          break;
        }
      } catch (error) {
        violations.push({
          rule: rule.name,
          message: `Rule execution failed: ${error instanceof Error ? error.message : "Unknown error"}`,
          severity: "warning",
          recoverable: true,
          timestamp
        });
      }
    }
    this.state.violations.push(...violations);
    this.state.violationCount = this.state.violations.length;
    this.state.hasFatalViolations = violations.some(
      (v) => v.severity === "fatal"
    );
    this.state.hasErrorViolations = violations.some(
      (v) => v.severity === "error"
    );
    this.state.lastCheckTime = timestamp;
    if (this.config.onViolation) {
      for (const violation of violations) {
        this.config.onViolation(violation);
      }
    }
    const result = {
      passed: violations.length === 0,
      violations,
      shouldRetry: this.shouldRetry(violations),
      shouldHalt: this.shouldHalt(violations),
      summary: {
        total: violations.length,
        fatal: violations.filter((v) => v.severity === "fatal").length,
        errors: violations.filter((v) => v.severity === "error").length,
        warnings: violations.filter((v) => v.severity === "warning").length
      }
    };
    return result;
  }
  /**
   * Determine if violations should trigger a retry
   */
  shouldRetry(violations) {
    return violations.some(
      (v) => v.recoverable && (v.severity === "error" || v.severity === "fatal")
    );
  }
  /**
   * Determine if violations should halt execution
   */
  shouldHalt(violations) {
    if (violations.some((v) => v.severity === "fatal")) {
      return true;
    }
    if (violations.some((v) => !v.recoverable && v.severity === "error")) {
      return true;
    }
    return false;
  }
  /**
   * Get current state
   */
  getState() {
    return { ...this.state };
  }
  /**
   * Reset state
   */
  reset() {
    this.state = this.createInitialState();
  }
  /**
   * Add a rule to the engine
   */
  addRule(rule) {
    this.rules.push(rule);
  }
  /**
   * Remove a rule from the engine
   */
  removeRule(ruleName) {
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
  getViolationsByRule(ruleName) {
    return this.state.violationsByRule.get(ruleName) || [];
  }
  /**
   * Get all violations
   */
  getAllViolations() {
    return [...this.state.violations];
  }
  /**
   * Check if any violations exist
   */
  hasViolations() {
    return this.state.violationCount > 0;
  }
  /**
   * Check if any fatal violations exist
   */
  hasFatalViolations() {
    return this.state.hasFatalViolations;
  }
  /**
   * Check if any error violations exist
   */
  hasErrorViolations() {
    return this.state.hasErrorViolations;
  }
};
function createGuardrailEngine(rules, options) {
  return new GuardrailEngine({
    rules,
    ...options
  });
}
function checkGuardrails(context, rules) {
  const engine = createGuardrailEngine(rules);
  return engine.check(context);
}

// src/types/retry.ts
var RETRY_DEFAULTS = {
  /** Maximum retry attempts for model failures */
  attempts: 3,
  /** Absolute maximum retries across all error types */
  maxRetries: 6,
  /** Base delay in milliseconds */
  baseDelay: 1e3,
  /** Maximum delay cap in milliseconds */
  maxDelay: 1e4,
  /** Maximum delay for network error suggestions */
  networkMaxDelay: 3e4,
  /** Default backoff strategy (AWS-style fixed jitter for predictable retry timing) */
  backoff: "fixed-jitter",
  /** Default retry reasons (unknown errors are not retried by default) */
  retryOn: [
    "zero_output",
    "guardrail_violation",
    "drift",
    "incomplete",
    "network_error",
    "timeout",
    "rate_limit",
    "server_error"
  ]
};
var ERROR_TYPE_DELAY_DEFAULTS = {
  connectionDropped: 1e3,
  fetchError: 500,
  econnreset: 1e3,
  econnrefused: 2e3,
  sseAborted: 500,
  noBytes: 500,
  partialChunks: 500,
  runtimeKilled: 2e3,
  backgroundThrottle: 5e3,
  dnsError: 3e3,
  timeout: 1e3,
  unknown: 1e3
};
var ErrorCategory = /* @__PURE__ */ ((ErrorCategory3) => {
  ErrorCategory3["NETWORK"] = "network";
  ErrorCategory3["TRANSIENT"] = "transient";
  ErrorCategory3["MODEL"] = "model";
  ErrorCategory3["CONTENT"] = "content";
  ErrorCategory3["PROVIDER"] = "provider";
  ErrorCategory3["FATAL"] = "fatal";
  ErrorCategory3["INTERNAL"] = "internal";
  return ErrorCategory3;
})(ErrorCategory || {});

// src/utils/timers.ts
function exponentialBackoff(attempt, baseDelay = RETRY_DEFAULTS.baseDelay, maxDelay = RETRY_DEFAULTS.maxDelay) {
  const rawDelay = baseDelay * Math.pow(2, attempt);
  const delay = Math.min(rawDelay, maxDelay);
  return {
    delay,
    cappedAtMax: rawDelay > maxDelay,
    rawDelay
  };
}
function linearBackoff(attempt, baseDelay = RETRY_DEFAULTS.baseDelay, maxDelay = RETRY_DEFAULTS.maxDelay) {
  const rawDelay = baseDelay * (attempt + 1);
  const delay = Math.min(rawDelay, maxDelay);
  return {
    delay,
    cappedAtMax: rawDelay > maxDelay,
    rawDelay
  };
}
function fixedBackoff(baseDelay = RETRY_DEFAULTS.baseDelay) {
  return {
    delay: baseDelay,
    cappedAtMax: false,
    rawDelay: baseDelay
  };
}
function fixedJitterBackoff(baseDelay = RETRY_DEFAULTS.baseDelay, maxDelay = RETRY_DEFAULTS.maxDelay) {
  const jitter = Math.random() * baseDelay * 0.5;
  const rawDelay = baseDelay + jitter;
  const delay = Math.min(Math.floor(rawDelay), maxDelay);
  return {
    delay,
    cappedAtMax: rawDelay > maxDelay,
    rawDelay
  };
}
function fullJitterBackoff(attempt, baseDelay = RETRY_DEFAULTS.baseDelay, maxDelay = RETRY_DEFAULTS.maxDelay) {
  const exponential = baseDelay * Math.pow(2, attempt);
  const cappedExponential = Math.min(exponential, maxDelay);
  const rawDelay = Math.random() * cappedExponential;
  const delay = Math.floor(rawDelay);
  return {
    delay,
    cappedAtMax: exponential > maxDelay,
    rawDelay
  };
}
function calculateBackoff(strategy, attempt, baseDelay = RETRY_DEFAULTS.baseDelay, maxDelay = RETRY_DEFAULTS.maxDelay) {
  switch (strategy) {
    case "exponential":
      return exponentialBackoff(attempt, baseDelay, maxDelay);
    case "linear":
      return linearBackoff(attempt, baseDelay, maxDelay);
    case "fixed":
      return fixedBackoff(baseDelay);
    case "full-jitter":
      return fullJitterBackoff(attempt, baseDelay, maxDelay);
    case "fixed-jitter":
      return fixedJitterBackoff(baseDelay, maxDelay);
    default:
      return exponentialBackoff(attempt, baseDelay, maxDelay);
  }
}
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
function timeout(ms, message = "Timeout") {
  return new Promise((_, reject) => {
    setTimeout(() => reject(new Error(message)), ms);
  });
}
async function withTimeout(promise, timeoutMs, timeoutMessage) {
  return Promise.race([promise, timeout(timeoutMs, timeoutMessage)]);
}

// src/utils/errors.ts
function getErrorCategory(code) {
  switch (code) {
    case "NETWORK_ERROR":
      return "network" /* NETWORK */;
    case "INITIAL_TOKEN_TIMEOUT":
    case "INTER_TOKEN_TIMEOUT":
      return "transient" /* TRANSIENT */;
    case "GUARDRAIL_VIOLATION":
    case "FATAL_GUARDRAIL_VIOLATION":
    case "DRIFT_DETECTED":
    case "ZERO_OUTPUT":
      return "content" /* CONTENT */;
    case "INVALID_STREAM":
    case "ADAPTER_NOT_FOUND":
    case "FEATURE_NOT_ENABLED":
      return "internal" /* INTERNAL */;
    case "STREAM_ABORTED":
    case "ALL_STREAMS_EXHAUSTED":
    default:
      return "provider" /* PROVIDER */;
  }
}
var L0Error = class _L0Error extends Error {
  /**
   * Error code for programmatic handling
   */
  code;
  /**
   * Error context with recovery information
   */
  context;
  /**
   * Timestamp when error occurred
   */
  timestamp;
  constructor(message, context) {
    super(message);
    this.name = "L0Error";
    this.code = context.code;
    this.context = context;
    this.timestamp = Date.now();
    Object.setPrototypeOf(this, _L0Error.prototype);
  }
  /**
   * Get error category for routing decisions
   */
  get category() {
    return getErrorCategory(this.code);
  }
  /**
   * Check if error is recoverable based on checkpoint
   */
  get isRecoverable() {
    return this.context.recoverable === true && this.context.checkpoint !== void 0 && this.context.checkpoint.length > 0;
  }
  /**
   * Get checkpoint content for recovery
   */
  getCheckpoint() {
    return this.context.checkpoint;
  }
  /**
   * Create a descriptive string with context
   */
  toDetailedString() {
    const parts = [this.message];
    if (this.context.tokenCount !== void 0) {
      parts.push(`Tokens: ${this.context.tokenCount}`);
    }
    if (this.context.modelRetryCount !== void 0) {
      parts.push(`Retries: ${this.context.modelRetryCount}`);
    }
    if (this.context.fallbackIndex !== void 0 && this.context.fallbackIndex > 0) {
      parts.push(`Fallback: ${this.context.fallbackIndex}`);
    }
    if (this.context.checkpoint) {
      parts.push(`Checkpoint: ${this.context.checkpoint.length} chars`);
    }
    return parts.join(" | ");
  }
  /**
   * Serialize error for logging/transport
   */
  toJSON() {
    return {
      name: this.name,
      code: this.code,
      category: this.category,
      message: this.message,
      timestamp: this.timestamp,
      recoverable: this.isRecoverable,
      checkpoint: this.context.checkpoint ? this.context.checkpoint.length : void 0,
      tokenCount: this.context.tokenCount,
      modelRetryCount: this.context.modelRetryCount,
      networkRetryCount: this.context.networkRetryCount,
      fallbackIndex: this.context.fallbackIndex
    };
  }
};
function isL0Error(error) {
  return error instanceof L0Error;
}
function hasErrorCode(error) {
  return "code" in error && typeof error.code === "string";
}
function getErrorCode(error) {
  return hasErrorCode(error) ? error.code : void 0;
}
var NetworkErrorType = /* @__PURE__ */ ((NetworkErrorType2) => {
  NetworkErrorType2["CONNECTION_DROPPED"] = "connection_dropped";
  NetworkErrorType2["FETCH_ERROR"] = "fetch_error";
  NetworkErrorType2["ECONNRESET"] = "econnreset";
  NetworkErrorType2["ECONNREFUSED"] = "econnrefused";
  NetworkErrorType2["SSE_ABORTED"] = "sse_aborted";
  NetworkErrorType2["NO_BYTES"] = "no_bytes";
  NetworkErrorType2["PARTIAL_CHUNKS"] = "partial_chunks";
  NetworkErrorType2["RUNTIME_KILLED"] = "runtime_killed";
  NetworkErrorType2["BACKGROUND_THROTTLE"] = "background_throttle";
  NetworkErrorType2["DNS_ERROR"] = "dns_error";
  NetworkErrorType2["SSL_ERROR"] = "ssl_error";
  NetworkErrorType2["TIMEOUT"] = "timeout";
  NetworkErrorType2["UNKNOWN"] = "unknown";
  return NetworkErrorType2;
})(NetworkErrorType || {});
function isConnectionDropped(error) {
  const message = error.message.toLowerCase();
  return message.includes("connection dropped") || message.includes("connection closed") || message.includes("connection lost") || message.includes("connection reset") || message.includes("econnreset") || message.includes("pipe broken") || message.includes("broken pipe");
}
function isFetchTypeError(error) {
  return error.name === "TypeError" && (error.message.toLowerCase().includes("fetch") || error.message.toLowerCase().includes("failed to fetch") || error.message.toLowerCase().includes("network request failed"));
}
function isECONNRESET(error) {
  const message = error.message.toLowerCase();
  return message.includes("econnreset") || message.includes("connection reset by peer") || getErrorCode(error) === "ECONNRESET";
}
function isECONNREFUSED(error) {
  const message = error.message.toLowerCase();
  return message.includes("econnrefused") || message.includes("connection refused") || getErrorCode(error) === "ECONNREFUSED";
}
function isSSEAborted(error) {
  const message = error.message.toLowerCase();
  return message.includes("sse") || message.includes("server-sent events") || message.includes("stream") && message.includes("abort") || message.includes("stream aborted") || message.includes("eventstream") || error.name === "AbortError";
}
function isNoBytes(error) {
  const message = error.message.toLowerCase();
  return message.includes("no bytes") || message.includes("empty response") || message.includes("zero bytes") || message.includes("no data received") || message.includes("content-length: 0");
}
function isPartialChunks(error) {
  const message = error.message.toLowerCase();
  return message.includes("partial chunk") || message.includes("incomplete chunk") || message.includes("truncated") || message.includes("premature close") || message.includes("unexpected end of data") || message.includes("incomplete data");
}
function isRuntimeKilled(error) {
  const message = error.message.toLowerCase();
  return message.includes("worker") && message.includes("terminated") || message.includes("runtime") && message.includes("killed") || message.includes("edge runtime") || message.includes("lambda timeout") || message.includes("function timeout") || message.includes("execution timeout") || message.includes("worker died") || message.includes("process exited") || message.includes("sigterm") || message.includes("sigkill");
}
function isBackgroundThrottle(error) {
  const message = error.message.toLowerCase();
  return message.includes("background") && message.includes("suspend") || message.includes("background throttle") || message.includes("tab suspended") || message.includes("page hidden") || message.includes("visibility hidden") || message.includes("inactive tab") || message.includes("background tab");
}
function isDNSError(error) {
  const message = error.message.toLowerCase();
  return message.includes("dns") || message.includes("enotfound") || message.includes("name resolution") || message.includes("host not found") || message.includes("getaddrinfo") || getErrorCode(error) === "ENOTFOUND";
}
function isSSLError(error) {
  const message = error.message.toLowerCase();
  return message.includes("ssl") || message.includes("tls") || message.includes("certificate") || message.includes("cert") || message.includes("handshake") || message.includes("self signed") || message.includes("unable to verify");
}
function isTimeoutError(error) {
  const message = error.message.toLowerCase();
  return error.name === "TimeoutError" || message.includes("timeout") || message.includes("timed out") || message.includes("time out") || message.includes("deadline exceeded") || message.includes("etimedout") || getErrorCode(error) === "ETIMEDOUT";
}
function analyzeNetworkError(error) {
  if (isConnectionDropped(error)) {
    return {
      type: "connection_dropped" /* CONNECTION_DROPPED */,
      retryable: true,
      countsTowardLimit: false,
      suggestion: "Retry with exponential backoff - connection was interrupted"
    };
  }
  if (isFetchTypeError(error)) {
    return {
      type: "fetch_error" /* FETCH_ERROR */,
      retryable: true,
      countsTowardLimit: false,
      suggestion: "Retry immediately - fetch() failed to initiate"
    };
  }
  if (isECONNRESET(error)) {
    return {
      type: "econnreset" /* ECONNRESET */,
      retryable: true,
      countsTowardLimit: false,
      suggestion: "Retry with backoff - connection was reset by peer"
    };
  }
  if (isECONNREFUSED(error)) {
    return {
      type: "econnrefused" /* ECONNREFUSED */,
      retryable: true,
      countsTowardLimit: false,
      suggestion: "Retry with longer delay - server refused connection",
      context: {
        possibleCause: "Server may be down or not accepting connections"
      }
    };
  }
  if (isSSEAborted(error)) {
    return {
      type: "sse_aborted" /* SSE_ABORTED */,
      retryable: true,
      countsTowardLimit: false,
      suggestion: "Retry immediately - SSE stream was aborted"
    };
  }
  if (isNoBytes(error)) {
    return {
      type: "no_bytes" /* NO_BYTES */,
      retryable: true,
      countsTowardLimit: false,
      suggestion: "Retry immediately - server sent no data",
      context: {
        possibleCause: "Empty response or connection closed before data sent"
      }
    };
  }
  if (isPartialChunks(error)) {
    return {
      type: "partial_chunks" /* PARTIAL_CHUNKS */,
      retryable: true,
      countsTowardLimit: false,
      suggestion: "Retry immediately - received incomplete data",
      context: {
        possibleCause: "Connection closed mid-stream"
      }
    };
  }
  if (isRuntimeKilled(error)) {
    return {
      type: "runtime_killed" /* RUNTIME_KILLED */,
      retryable: true,
      countsTowardLimit: false,
      suggestion: "Retry with shorter timeout - runtime was terminated (likely timeout)",
      context: {
        possibleCause: "Edge runtime timeout or Lambda timeout - consider breaking into smaller requests"
      }
    };
  }
  if (isBackgroundThrottle(error)) {
    return {
      type: "background_throttle" /* BACKGROUND_THROTTLE */,
      retryable: true,
      countsTowardLimit: false,
      suggestion: "Retry when page becomes visible - mobile/browser throttling",
      context: {
        possibleCause: "Browser suspended network activity for background tab",
        resolution: "Wait for visibilitychange event"
      }
    };
  }
  if (isDNSError(error)) {
    return {
      type: "dns_error" /* DNS_ERROR */,
      retryable: true,
      countsTowardLimit: false,
      suggestion: "Retry with longer delay - DNS lookup failed",
      context: {
        possibleCause: "Network connectivity issue or invalid hostname"
      }
    };
  }
  if (isSSLError(error)) {
    return {
      type: "ssl_error" /* SSL_ERROR */,
      retryable: false,
      countsTowardLimit: false,
      suggestion: "Don't retry - SSL/TLS error (configuration issue)",
      context: {
        possibleCause: "Certificate validation failed or SSL handshake error",
        resolution: "Check server certificate or SSL configuration"
      }
    };
  }
  if (isTimeoutError(error)) {
    return {
      type: "timeout" /* TIMEOUT */,
      retryable: true,
      countsTowardLimit: false,
      suggestion: "Retry with longer timeout - request timed out"
    };
  }
  return {
    type: "unknown" /* UNKNOWN */,
    retryable: true,
    countsTowardLimit: false,
    suggestion: "Retry with caution - unknown network error"
  };
}
function isNetworkError(error) {
  return isConnectionDropped(error) || isFetchTypeError(error) || isECONNRESET(error) || isECONNREFUSED(error) || isSSEAborted(error) || isNoBytes(error) || isPartialChunks(error) || isRuntimeKilled(error) || isBackgroundThrottle(error) || isDNSError(error) || isTimeoutError(error);
}
function suggestRetryDelay(error, attempt, customDelays, maxDelay = RETRY_DEFAULTS.networkMaxDelay) {
  const analysis = analyzeNetworkError(error);
  const defaultDelays = {
    ["connection_dropped" /* CONNECTION_DROPPED */]: ERROR_TYPE_DELAY_DEFAULTS.connectionDropped,
    ["fetch_error" /* FETCH_ERROR */]: ERROR_TYPE_DELAY_DEFAULTS.fetchError,
    ["econnreset" /* ECONNRESET */]: ERROR_TYPE_DELAY_DEFAULTS.econnreset,
    ["econnrefused" /* ECONNREFUSED */]: ERROR_TYPE_DELAY_DEFAULTS.econnrefused,
    ["sse_aborted" /* SSE_ABORTED */]: ERROR_TYPE_DELAY_DEFAULTS.sseAborted,
    ["no_bytes" /* NO_BYTES */]: ERROR_TYPE_DELAY_DEFAULTS.noBytes,
    ["partial_chunks" /* PARTIAL_CHUNKS */]: ERROR_TYPE_DELAY_DEFAULTS.partialChunks,
    ["runtime_killed" /* RUNTIME_KILLED */]: ERROR_TYPE_DELAY_DEFAULTS.runtimeKilled,
    ["background_throttle" /* BACKGROUND_THROTTLE */]: ERROR_TYPE_DELAY_DEFAULTS.backgroundThrottle,
    ["dns_error" /* DNS_ERROR */]: ERROR_TYPE_DELAY_DEFAULTS.dnsError,
    ["ssl_error" /* SSL_ERROR */]: 0,
    // Don't retry SSL errors
    ["timeout" /* TIMEOUT */]: ERROR_TYPE_DELAY_DEFAULTS.timeout,
    ["unknown" /* UNKNOWN */]: ERROR_TYPE_DELAY_DEFAULTS.unknown
  };
  const baseDelay = customDelays?.[analysis.type] ?? defaultDelays[analysis.type];
  if (baseDelay === 0) return 0;
  return Math.min(baseDelay * Math.pow(2, attempt), maxDelay);
}

// src/runtime/retry.ts
var RetryManager = class {
  config;
  state;
  constructor(config = {}) {
    this.config = {
      attempts: config.attempts ?? RETRY_DEFAULTS.attempts,
      maxRetries: config.maxRetries ?? RETRY_DEFAULTS.maxRetries,
      baseDelay: config.baseDelay ?? RETRY_DEFAULTS.baseDelay,
      maxDelay: config.maxDelay ?? RETRY_DEFAULTS.maxDelay,
      backoff: config.backoff ?? RETRY_DEFAULTS.backoff,
      retryOn: config.retryOn ?? [...RETRY_DEFAULTS.retryOn],
      maxErrorHistory: config.maxErrorHistory
    };
    this.state = this.createInitialState();
  }
  /**
   * Create initial retry state
   */
  createInitialState() {
    return {
      attempt: 0,
      networkRetryCount: 0,
      transientRetries: 0,
      errorHistory: [],
      totalDelay: 0,
      limitReached: false
    };
  }
  /**
   * Categorize an error for retry decision making
   */
  categorizeError(error, reason) {
    const classification = this.classifyError(error);
    const category = this.determineCategory(classification);
    const countsTowardLimit = category === "model" /* MODEL */;
    const retryable = category !== "fatal" /* FATAL */;
    return {
      error,
      category,
      reason: reason ?? this.inferReason(classification),
      countsTowardLimit,
      retryable,
      timestamp: Date.now(),
      statusCode: classification.statusCode
    };
  }
  /**
   * Classify error type using enhanced network error detection
   */
  classifyError(error) {
    const message = error.message?.toLowerCase() || "";
    const isNetwork = isNetworkError(error);
    const isTimeout = isTimeoutError(error);
    let statusCode;
    const statusMatch = message.match(/status\s*(?:code)?\s*:?\s*(\d{3})/i);
    if (statusMatch && statusMatch[1]) {
      statusCode = parseInt(statusMatch[1], 10);
    }
    const isRateLimit = statusCode === 429 || message.includes("rate limit");
    const isServerError = statusCode !== void 0 && statusCode >= 500 && statusCode < 600;
    const isAuthError = statusCode === 401 || statusCode === 403 || message.includes("unauthorized") || message.includes("forbidden");
    const isClientError = statusCode !== void 0 && statusCode >= 400 && statusCode < 500 && statusCode !== 429;
    return {
      isNetwork,
      isRateLimit,
      isServerError,
      isTimeout,
      isAuthError,
      isClientError,
      statusCode
    };
  }
  /**
   * Determine error category from classification
   */
  determineCategory(classification) {
    if (classification.isNetwork) {
      return "network" /* NETWORK */;
    }
    if (classification.isRateLimit || classification.isServerError || classification.isTimeout) {
      return "transient" /* TRANSIENT */;
    }
    if (classification.isAuthError || classification.isClientError && !classification.isRateLimit) {
      return "fatal" /* FATAL */;
    }
    return "model" /* MODEL */;
  }
  /**
   * Infer retry reason from error classification and detailed network analysis
   */
  inferReason(classification, error) {
    if (classification.isNetwork) {
      if (error) {
        const analysis = analyzeNetworkError(error);
        switch (analysis.type) {
          case "connection_dropped":
          case "econnreset":
          case "econnrefused":
          case "sse_aborted":
          case "partial_chunks":
          case "no_bytes":
            return "network_error";
          case "runtime_killed":
          case "timeout":
            return "timeout";
          default:
            return "network_error";
        }
      }
      return "network_error";
    }
    if (classification.isTimeout) return "timeout";
    if (classification.isRateLimit) return "rate_limit";
    if (classification.isServerError) return "server_error";
    return "unknown";
  }
  /**
   * Decide whether to retry and calculate delay
   * Enhanced with network error analysis
   */
  shouldRetry(error, reason) {
    const categorized = this.categorizeError(error, reason);
    if (categorized.category === "network" /* NETWORK */ && isNetworkError(error)) {
      const analysis = analyzeNetworkError(error);
      if (!analysis.retryable) {
        return {
          shouldRetry: false,
          delay: 0,
          reason: `Fatal network error: ${analysis.suggestion}`,
          category: "fatal" /* FATAL */,
          countsTowardLimit: false
        };
      }
    }
    if (categorized.category === "fatal" /* FATAL */) {
      return {
        shouldRetry: false,
        delay: 0,
        reason: "Fatal error - not retryable",
        category: categorized.category,
        countsTowardLimit: false
      };
    }
    if (categorized.reason && !this.config.retryOn.includes(categorized.reason)) {
      return {
        shouldRetry: false,
        delay: 0,
        reason: `Retry reason '${categorized.reason}' not in retryOn list`,
        category: categorized.category,
        countsTowardLimit: false
      };
    }
    if (this.config.maxRetries !== void 0 && this.getTotalRetries() >= this.config.maxRetries) {
      this.state.limitReached = true;
      return {
        shouldRetry: false,
        delay: 0,
        reason: `Absolute maximum retries (${this.config.maxRetries}) reached`,
        category: categorized.category,
        countsTowardLimit: false
      };
    }
    if (categorized.countsTowardLimit && this.state.attempt >= this.config.attempts) {
      this.state.limitReached = true;
      return {
        shouldRetry: false,
        delay: 0,
        reason: "Maximum retry attempts reached",
        category: categorized.category,
        countsTowardLimit: true
      };
    }
    const attemptCount = categorized.countsTowardLimit ? this.state.attempt : categorized.category === "network" /* NETWORK */ ? this.state.networkRetryCount : this.state.transientRetries;
    let backoff;
    if (categorized.category === "network" /* NETWORK */ && this.config.errorTypeDelays && isNetworkError(error)) {
      const customDelayMap = this.mapErrorTypeDelays(
        this.config.errorTypeDelays
      );
      const customDelay = suggestRetryDelay(
        error,
        attemptCount,
        customDelayMap,
        this.config.maxDelay
      );
      backoff = {
        delay: customDelay,
        cappedAtMax: customDelay >= (this.config.maxDelay ?? 1e4),
        rawDelay: customDelay
      };
    } else {
      backoff = calculateBackoff(
        this.config.backoff,
        attemptCount,
        this.config.baseDelay,
        this.config.maxDelay
      );
    }
    return {
      shouldRetry: true,
      delay: backoff.delay,
      reason: `Retrying after ${categorized.category} error`,
      category: categorized.category,
      countsTowardLimit: categorized.countsTowardLimit
    };
  }
  /**
   * Record a retry attempt
   */
  async recordRetry(categorizedError, decision) {
    if (decision.countsTowardLimit) {
      this.state.attempt++;
    } else if (categorizedError.category === "network" /* NETWORK */) {
      this.state.networkRetryCount++;
    } else if (categorizedError.category === "transient" /* TRANSIENT */) {
      this.state.transientRetries++;
    }
    this.state.lastError = categorizedError;
    this.state.errorHistory.push(categorizedError);
    const maxHistory = this.config.maxErrorHistory;
    if (maxHistory !== void 0 && this.state.errorHistory.length > maxHistory) {
      this.state.errorHistory = this.state.errorHistory.slice(-maxHistory);
    }
    this.state.totalDelay += decision.delay;
    if (decision.delay > 0) {
      await sleep(decision.delay);
    }
  }
  /**
   * Execute a function with retry logic
   */
  async execute(fn, onRetry) {
    while (true) {
      try {
        const result = await fn();
        return result;
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        const categorized = this.categorizeError(err);
        const decision = this.shouldRetry(err);
        if (!decision.shouldRetry) {
          throw err;
        }
        const attemptCount = decision.countsTowardLimit ? this.state.attempt : categorized.category === "network" /* NETWORK */ ? this.state.networkRetryCount : this.state.transientRetries;
        let backoff;
        if (categorized.category === "network" /* NETWORK */ && this.config.errorTypeDelays && isNetworkError(err)) {
          const customDelayMap = this.mapErrorTypeDelays(
            this.config.errorTypeDelays
          );
          const customDelay = suggestRetryDelay(
            err,
            attemptCount,
            customDelayMap,
            this.config.maxDelay
          );
          backoff = {
            delay: customDelay,
            cappedAtMax: customDelay >= (this.config.maxDelay ?? 1e4),
            rawDelay: customDelay
          };
        } else {
          backoff = calculateBackoff(
            this.config.backoff,
            attemptCount,
            this.config.baseDelay,
            this.config.maxDelay
          );
        }
        if (onRetry) {
          onRetry({
            state: this.getState(),
            config: this.config,
            error: categorized,
            backoff
          });
        }
        await this.recordRetry(categorized, decision);
      }
    }
  }
  /**
   * Get current state
   */
  getState() {
    return { ...this.state };
  }
  /**
   * Reset state
   */
  reset() {
    this.state = this.createInitialState();
  }
  /**
   * Check if retry limit has been reached
   */
  hasReachedLimit() {
    return this.state.limitReached;
  }
  /**
   * Get total retry count (all types)
   */
  getTotalRetries() {
    return this.state.attempt + this.state.networkRetryCount + this.state.transientRetries;
  }
  /**
   * Get model failure retry count
   */
  getmodelRetryCount() {
    return this.state.attempt;
  }
  /**
   * Map ErrorTypeDelays to NetworkErrorType record
   */
  mapErrorTypeDelays(delays) {
    return {
      ["connection_dropped" /* CONNECTION_DROPPED */]: delays.connectionDropped,
      ["fetch_error" /* FETCH_ERROR */]: delays.fetchError,
      ["econnreset" /* ECONNRESET */]: delays.econnreset,
      ["econnrefused" /* ECONNREFUSED */]: delays.econnrefused,
      ["sse_aborted" /* SSE_ABORTED */]: delays.sseAborted,
      ["no_bytes" /* NO_BYTES */]: delays.noBytes,
      ["partial_chunks" /* PARTIAL_CHUNKS */]: delays.partialChunks,
      ["runtime_killed" /* RUNTIME_KILLED */]: delays.runtimeKilled,
      ["background_throttle" /* BACKGROUND_THROTTLE */]: delays.backgroundThrottle,
      ["dns_error" /* DNS_ERROR */]: delays.dnsError,
      ["timeout" /* TIMEOUT */]: delays.timeout,
      ["unknown" /* UNKNOWN */]: delays.unknown
    };
  }
};
function createRetryManager(config) {
  return new RetryManager(config);
}
function isRetryableError(error) {
  const manager = new RetryManager();
  const categorized = manager.categorizeError(error);
  return categorized.retryable;
}
function getErrorCategory2(error) {
  const manager = new RetryManager();
  const categorized = manager.categorizeError(error);
  return categorized.category;
}

// src/utils/tokens.ts
function hasMeaningfulContent(content) {
  if (!content || content.length === 0) {
    return false;
  }
  const trimmed = content.trim();
  if (trimmed.length === 0) {
    return false;
  }
  if (/^[\r\n\t\s]+$/.test(content)) {
    return false;
  }
  return true;
}
function detectOverlap(checkpoint, continuation, options = {}) {
  if (!checkpoint || !continuation || checkpoint.length === 0 || continuation.length === 0) {
    return {
      overlapLength: 0,
      overlapText: "",
      deduplicatedContinuation: continuation || "",
      hasOverlap: false
    };
  }
  const {
    minOverlap = 2,
    maxOverlap = Math.min(500, continuation.length),
    caseSensitive = true,
    normalizeWhitespace = false
  } = options;
  let checkpointForMatch = checkpoint;
  let continuationForMatch = continuation;
  if (!caseSensitive) {
    checkpointForMatch = checkpoint.toLowerCase();
    continuationForMatch = continuation.toLowerCase();
  }
  if (normalizeWhitespace) {
    checkpointForMatch = checkpointForMatch.replace(/\s+/g, " ");
    continuationForMatch = continuationForMatch.replace(/\s+/g, " ");
  }
  const maxPossibleOverlap = Math.min(
    checkpointForMatch.length,
    continuationForMatch.length,
    maxOverlap
  );
  if (maxPossibleOverlap < minOverlap) {
    return {
      overlapLength: 0,
      overlapText: "",
      deduplicatedContinuation: continuation,
      hasOverlap: false
    };
  }
  for (let len = maxPossibleOverlap; len >= minOverlap; len--) {
    const suffix = checkpointForMatch.slice(-len);
    const prefix = continuationForMatch.slice(0, len);
    if (suffix === prefix) {
      let actualOverlapLength = len;
      if (normalizeWhitespace) {
        let normalizedPos = 0;
        let originalPos = 0;
        const normalizedPrefix = continuationForMatch.slice(0, len);
        while (normalizedPos < normalizedPrefix.length && originalPos < continuation.length) {
          if (/\s/.test(continuation[originalPos])) {
            if (normalizedPrefix[normalizedPos] === " ") {
              normalizedPos++;
              originalPos++;
              while (originalPos < continuation.length && /\s/.test(continuation[originalPos])) {
                originalPos++;
              }
            } else {
              originalPos++;
            }
          } else {
            normalizedPos++;
            originalPos++;
          }
        }
        actualOverlapLength = originalPos;
      }
      return {
        overlapLength: actualOverlapLength,
        overlapText: continuation.slice(0, actualOverlapLength),
        deduplicatedContinuation: continuation.slice(actualOverlapLength),
        hasOverlap: true
      };
    }
  }
  return {
    overlapLength: 0,
    overlapText: "",
    deduplicatedContinuation: continuation,
    hasOverlap: false
  };
}

// src/runtime/zeroToken.ts
function detectZeroToken(content) {
  if (!content) {
    return true;
  }
  if (content.length === 0) {
    return true;
  }
  if (!hasMeaningfulContent(content)) {
    return true;
  }
  const trimmed = content.trim();
  if (trimmed.length < 3) {
    return true;
  }
  if (/^[^\w\s]+$/.test(trimmed)) {
    return true;
  }
  if (/^(.)\1+$/.test(trimmed)) {
    return true;
  }
  return false;
}

// src/runtime/events.ts
function normalizeStreamEvent(chunk) {
  if (!chunk) {
    return {
      type: "error",
      error: new Error("Received null or undefined chunk"),
      timestamp: Date.now()
    };
  }
  if (isL0Event(chunk)) {
    return chunk;
  }
  if (chunk.type) {
    switch (chunk.type) {
      case "text-delta":
      case "content-delta":
        return {
          type: "token",
          value: chunk.textDelta || chunk.delta || chunk.content || "",
          timestamp: Date.now()
        };
      case "finish":
      case "complete":
        return {
          type: "complete",
          timestamp: Date.now()
        };
      case "error":
        return {
          type: "error",
          error: chunk.error || new Error(chunk.message || "Stream error"),
          timestamp: Date.now()
        };
      case "tool-call":
      case "function-call":
        return {
          type: "message",
          value: JSON.stringify(chunk),
          role: "assistant",
          timestamp: Date.now()
        };
      default:
        const text2 = extractTextFromChunk(chunk);
        if (text2) {
          return {
            type: "token",
            value: text2,
            timestamp: Date.now()
          };
        }
        return {
          type: "error",
          error: new Error(`Unknown chunk type: ${chunk.type}`),
          timestamp: Date.now()
        };
    }
  }
  if (chunk.choices && Array.isArray(chunk.choices)) {
    const choice = chunk.choices[0];
    if (choice?.delta?.content) {
      return {
        type: "token",
        value: choice.delta.content,
        timestamp: Date.now()
      };
    }
    if (choice?.finish_reason) {
      return {
        type: "complete",
        timestamp: Date.now()
      };
    }
  }
  if (chunk.delta?.text) {
    return {
      type: "token",
      value: chunk.delta.text,
      timestamp: Date.now()
    };
  }
  if (chunk.type === "message_stop" || chunk.type === "content_block_stop") {
    return {
      type: "complete",
      timestamp: Date.now()
    };
  }
  if (typeof chunk === "string") {
    return {
      type: "token",
      value: chunk,
      timestamp: Date.now()
    };
  }
  const text = extractTextFromChunk(chunk);
  if (text) {
    return {
      type: "token",
      value: text,
      timestamp: Date.now()
    };
  }
  return {
    type: "error",
    error: new Error(`Unable to normalize chunk: ${JSON.stringify(chunk)}`),
    timestamp: Date.now()
  };
}
function isL0Event(obj) {
  return obj && typeof obj === "object" && "type" in obj && (obj.type === "token" || obj.type === "message" || obj.type === "data" || obj.type === "progress" || obj.type === "error" || obj.type === "complete");
}
function extractTextFromChunk(chunk) {
  if (!chunk || typeof chunk !== "object") {
    return null;
  }
  const textFields = [
    "text",
    "content",
    "delta",
    "textDelta",
    "token",
    "message",
    "data"
  ];
  for (const field of textFields) {
    if (chunk[field] && typeof chunk[field] === "string") {
      return chunk[field];
    }
  }
  if (chunk.delta && typeof chunk.delta === "object") {
    for (const field of textFields) {
      if (chunk.delta[field] && typeof chunk.delta[field] === "string") {
        return chunk.delta[field];
      }
    }
  }
  return null;
}
function createTokenEvent(value) {
  return {
    type: "token",
    value,
    timestamp: Date.now()
  };
}
function createCompleteEvent() {
  return {
    type: "complete",
    timestamp: Date.now()
  };
}
function createErrorEvent(error) {
  return {
    type: "error",
    error,
    timestamp: Date.now()
  };
}

// src/runtime/state.ts
function createInitialState() {
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
    dataOutputs: []
  };
}
function resetStateForRetry(state, preserve = {}) {
  state.content = "";
  state.tokenCount = 0;
  state.violations = [];
  state.driftDetected = false;
  state.dataOutputs = [];
  state.lastProgress = void 0;
  state.completed = false;
  state.networkErrors = [];
  if (preserve.checkpoint !== void 0) {
    state.checkpoint = preserve.checkpoint;
  }
  if (preserve.resumed !== void 0) {
    state.resumed = preserve.resumed;
  }
  if (preserve.resumePoint !== void 0) {
    state.resumePoint = preserve.resumePoint;
  }
  if (preserve.resumeFrom !== void 0) {
    state.resumeFrom = preserve.resumeFrom;
  }
  if (preserve.modelRetryCount !== void 0) {
    state.modelRetryCount = preserve.modelRetryCount;
  }
  if (preserve.networkRetryCount !== void 0) {
    state.networkRetryCount = preserve.networkRetryCount;
  }
  if (preserve.fallbackIndex !== void 0) {
    state.fallbackIndex = preserve.fallbackIndex;
  }
}

// src/runtime/checkpoint.ts
function validateCheckpointForContinuation(checkpointContent, guardrailEngine, driftDetector) {
  const result = {
    skipContinuation: false,
    violations: [],
    driftDetected: false,
    driftTypes: []
  };
  if (guardrailEngine) {
    const checkpointContext = {
      content: checkpointContent,
      checkpoint: "",
      delta: checkpointContent,
      tokenCount: 1,
      completed: true
    };
    const checkpointResult = guardrailEngine.check(checkpointContext);
    if (checkpointResult.violations.length > 0) {
      result.violations = checkpointResult.violations;
      const hasFatal = checkpointResult.violations.some(
        (v) => v.severity === "fatal"
      );
      if (hasFatal) {
        result.skipContinuation = true;
      }
    }
  }
  if (!result.skipContinuation && driftDetector) {
    const driftResult = driftDetector.check(checkpointContent);
    if (driftResult.detected) {
      result.driftDetected = true;
      result.driftTypes = driftResult.types;
    }
  }
  return result;
}

// src/runtime/callbacks.ts
function safeInvokeCallback(callback, arg, monitor, callbackName = "callback") {
  if (!callback) return;
  try {
    callback(arg);
  } catch (error) {
    monitor?.logEvent({
      type: "warning",
      message: `${callbackName} threw: ${error instanceof Error ? error.message : String(error)}`
    });
  }
}

// src/runtime/state-machine.ts
var RuntimeStates = {
  INIT: "init",
  WAITING_FOR_TOKEN: "waiting_for_token",
  STREAMING: "streaming",
  CONTINUATION_MATCHING: "continuation_matching",
  CHECKPOINT_VERIFYING: "checkpoint_verifying",
  RETRYING: "retrying",
  FALLBACK: "fallback",
  FINALIZING: "finalizing",
  COMPLETE: "complete",
  ERROR: "error"
};
var StateMachine = class {
  state = RuntimeStates.INIT;
  history = [];
  listeners = /* @__PURE__ */ new Set();
  /**
   * Transition to a new state
   */
  transition(next) {
    if (this.state !== next) {
      this.history.push({
        from: this.state,
        to: next,
        timestamp: Date.now()
      });
      this.state = next;
      this.notify();
    }
  }
  /**
   * Get current state
   */
  get() {
    return this.state;
  }
  /**
   * Check if current state matches any of the provided states
   */
  is(...states) {
    return states.includes(this.state);
  }
  /**
   * Check if state is terminal (done or error)
   */
  isTerminal() {
    return this.state === RuntimeStates.COMPLETE || this.state === RuntimeStates.ERROR;
  }
  /**
   * Reset to initial state and notify subscribers
   */
  reset() {
    const previousState = this.state;
    this.state = RuntimeStates.INIT;
    this.history = [];
    if (previousState !== RuntimeStates.INIT) {
      this.notify();
    }
  }
  /**
   * Get state history (for debugging)
   */
  getHistory() {
    return this.history;
  }
  /**
   * Subscribe to state changes
   */
  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  notify() {
    for (const listener of this.listeners) {
      try {
        listener(this.state);
      } catch {
      }
    }
  }
};

// src/runtime/metrics.ts
var Metrics = class {
  /** Total stream requests */
  requests = 0;
  /** Total tokens processed */
  tokens = 0;
  /** Total retry attempts */
  retries = 0;
  /** Network retries (subset of retries) */
  networkRetryCount = 0;
  /** Total errors encountered */
  errors = 0;
  /** Guardrail violations */
  violations = 0;
  /** Drift detections */
  driftDetections = 0;
  /** Fallback activations */
  fallbacks = 0;
  /** Successful completions */
  completions = 0;
  /** Timeouts (initial + inter-token) */
  timeouts = 0;
  /**
   * Reset all counters
   */
  reset() {
    this.requests = 0;
    this.tokens = 0;
    this.retries = 0;
    this.networkRetryCount = 0;
    this.errors = 0;
    this.violations = 0;
    this.driftDetections = 0;
    this.fallbacks = 0;
    this.completions = 0;
    this.timeouts = 0;
  }
  /**
   * Get snapshot of all metrics
   */
  snapshot() {
    return {
      requests: this.requests,
      tokens: this.tokens,
      retries: this.retries,
      networkRetryCount: this.networkRetryCount,
      errors: this.errors,
      violations: this.violations,
      driftDetections: this.driftDetections,
      fallbacks: this.fallbacks,
      completions: this.completions,
      timeouts: this.timeouts
    };
  }
  /**
   * Serialize for logging
   */
  toJSON() {
    return this.snapshot();
  }
};

// src/runtime/helpers.ts
async function getText(result) {
  for await (const _event of result.stream) {
  }
  return result.state.content;
}
async function consumeStream(result, onToken) {
  for await (const event of result.stream) {
    if (event.type === "token" && event.value) {
      onToken(event.value);
    }
  }
  return result.state.content;
}

// src/runtime/l0.ts
var _driftDetectorFactory = null;
var _monitorFactory = null;
var _interceptorManagerFactory = null;
var _adapterRegistry = null;
async function l0(options) {
  const { signal: externalSignal, interceptors = [] } = options;
  let interceptorManager = null;
  let processedOptions = options;
  if (interceptors.length > 0) {
    if (!_interceptorManagerFactory) {
      throw new L0Error(
        'Interceptors require enableInterceptors() to be called first. Import and call: import { enableInterceptors } from "@ai2070/l0"; enableInterceptors();',
        { code: "FEATURE_NOT_ENABLED", recoverable: false }
      );
    }
    interceptorManager = _interceptorManagerFactory(interceptors);
    try {
      processedOptions = await interceptorManager.executeBefore(
        options
      );
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      await interceptorManager.executeError(err, options);
      throw err;
    }
  }
  const {
    stream: processedStream,
    fallbackStreams: processedFallbackStreams = [],
    guardrails: processedGuardrails = [],
    retry: processedRetry = {},
    timeout: processedTimeout = {},
    signal: processedSignal,
    monitoring: processedMonitoring,
    detectDrift: processedDetectDrift = false,
    detectZeroTokens: processedDetectZeroTokens = true,
    checkIntervals: processedCheckIntervals = {},
    onStart: processedOnStart,
    onComplete: processedOnComplete,
    onError: processedOnError,
    onEvent: processedOnEvent,
    onViolation: processedOnViolation,
    onRetry: processedOnRetry,
    onFallback: processedOnFallback,
    onResume: processedOnResume,
    continueFromLastKnownGoodToken: processedContinueFromCheckpoint = false,
    buildContinuationPrompt: processedBuildContinuationPrompt,
    deduplicateContinuation: processedDeduplicateContinuation,
    deduplicationOptions: processedDeduplicationOptions = {}
  } = processedOptions;
  const shouldDeduplicateContinuation = processedDeduplicateContinuation ?? processedContinueFromCheckpoint;
  const guardrailCheckInterval = processedCheckIntervals.guardrails ?? 5;
  const driftCheckInterval = processedCheckIntervals.drift ?? 10;
  const checkpointInterval = processedCheckIntervals.checkpoint ?? 10;
  const state = createInitialState();
  const errors = [];
  const abortController = new AbortController();
  const signal = processedSignal || externalSignal || abortController.signal;
  let monitor = null;
  if (processedMonitoring?.enabled) {
    if (!_monitorFactory) {
      throw new L0Error(
        'Monitoring requires enableMonitoring() to be called first. Import and call: import { enableMonitoring } from "@ai2070/l0"; enableMonitoring();',
        { code: "FEATURE_NOT_ENABLED", recoverable: false }
      );
    }
    monitor = _monitorFactory({
      enabled: true,
      sampleRate: processedMonitoring?.sampleRate ?? 1,
      includeNetworkDetails: processedMonitoring?.includeNetworkDetails ?? true,
      includeTimings: processedMonitoring?.includeTimings ?? true,
      metadata: processedMonitoring?.metadata
    });
    monitor.start();
    monitor.recordContinuation(processedContinueFromCheckpoint, false);
  }
  const guardrailEngine = processedGuardrails.length > 0 ? new GuardrailEngine({
    rules: processedGuardrails,
    stopOnFatal: true,
    enableStreaming: true,
    onViolation: processedOnViolation
  }) : null;
  const retryManager = new RetryManager({
    attempts: processedRetry.attempts ?? 2,
    maxRetries: processedRetry.maxRetries,
    baseDelay: processedRetry.baseDelay ?? 1e3,
    maxDelay: processedRetry.maxDelay ?? 1e4,
    backoff: processedRetry.backoff ?? "fixed-jitter",
    retryOn: processedRetry.retryOn ?? [
      "zero_output",
      "guardrail_violation",
      "drift",
      "incomplete",
      "network_error",
      "timeout",
      "rate_limit",
      "server_error"
    ]
  });
  let driftDetector = null;
  if (processedDetectDrift) {
    if (!_driftDetectorFactory) {
      throw new L0Error(
        'Drift detection requires enableDriftDetection() to be called first. Import and call: import { enableDriftDetection } from "@ai2070/l0"; enableDriftDetection();',
        { code: "FEATURE_NOT_ENABLED", recoverable: false }
      );
    }
    driftDetector = _driftDetectorFactory();
  }
  const stateMachine = new StateMachine();
  const metrics = new Metrics();
  metrics.requests++;
  const streamGenerator = async function* () {
    let fallbackIndex = 0;
    const allStreams = [processedStream, ...processedFallbackStreams];
    let tokenBuffer = [];
    let checkpointForContinuation = "";
    let overlapBuffer = "";
    let overlapResolved = false;
    while (fallbackIndex < allStreams.length) {
      const currentStreamFactory = allStreams[fallbackIndex];
      let retryAttempt = 0;
      let isRetryAttempt = false;
      const modelRetryLimit = processedRetry.attempts ?? 2;
      state.fallbackIndex = fallbackIndex;
      while (retryAttempt <= modelRetryLimit) {
        stateMachine.transition(RuntimeStates.INIT);
        if (processedOnStart) {
          const isRetry = retryAttempt > 0 || isRetryAttempt;
          const isFallback = fallbackIndex > 0;
          processedOnStart(retryAttempt + 1, isRetry, isFallback);
        }
        try {
          if (retryAttempt > 0 || isRetryAttempt) {
            if (processedContinueFromCheckpoint && state.checkpoint.length > 0) {
              checkpointForContinuation = state.checkpoint;
              stateMachine.transition(RuntimeStates.CHECKPOINT_VERIFYING);
              const validation = validateCheckpointForContinuation(
                checkpointForContinuation,
                guardrailEngine,
                driftDetector
              );
              if (validation.violations.length > 0) {
                state.violations.push(...validation.violations);
                monitor?.recordGuardrailViolations(validation.violations);
              }
              if (validation.driftDetected) {
                state.driftDetected = true;
                monitor?.recordDrift(true, validation.driftTypes);
                if (processedOnViolation) {
                  processedOnViolation({
                    rule: "drift",
                    severity: "warning",
                    message: `Drift detected in checkpoint: ${validation.driftTypes.join(", ")}`,
                    recoverable: true
                  });
                }
              }
              if (validation.skipContinuation) {
                tokenBuffer = [];
                resetStateForRetry(state);
                continue;
              }
              state.resumed = true;
              state.resumePoint = checkpointForContinuation;
              state.resumeFrom = checkpointForContinuation.length;
              overlapBuffer = "";
              overlapResolved = false;
              if (processedOnResume) {
                processedOnResume(checkpointForContinuation, state.tokenCount);
              }
              if (processedBuildContinuationPrompt) {
                processedBuildContinuationPrompt(checkpointForContinuation);
              }
              monitor?.recordContinuation(
                true,
                true,
                checkpointForContinuation
              );
              const checkpointEvent = {
                type: "token",
                value: checkpointForContinuation,
                timestamp: Date.now()
              };
              safeInvokeCallback(
                processedOnEvent,
                checkpointEvent,
                monitor,
                "onEvent"
              );
              yield checkpointEvent;
              tokenBuffer = [checkpointForContinuation];
              state.content = checkpointForContinuation;
              state.tokenCount = 1;
              resetStateForRetry(state, {
                checkpoint: state.checkpoint,
                resumed: true,
                resumePoint: checkpointForContinuation,
                resumeFrom: checkpointForContinuation.length
              });
              state.content = checkpointForContinuation;
              state.tokenCount = 1;
            } else {
              tokenBuffer = [];
              resetStateForRetry(state);
            }
          }
          const streamResult = await currentStreamFactory();
          let sourceStream;
          if (processedOptions.adapter) {
            let adapter;
            if (typeof processedOptions.adapter === "string") {
              if (!_adapterRegistry) {
                throw new L0Error(
                  'String adapter names require enableAdapterRegistry() to be called first. Import and call: import { enableAdapterRegistry } from "@ai2070/l0"; enableAdapterRegistry();',
                  { code: "FEATURE_NOT_ENABLED", recoverable: false }
                );
              }
              adapter = _adapterRegistry.getAdapter(processedOptions.adapter);
              if (!adapter) {
                throw new L0Error(
                  `Adapter "${processedOptions.adapter}" not found. Use registerAdapter() to register it first.`,
                  {
                    code: "ADAPTER_NOT_FOUND",
                    modelRetryCount: state.modelRetryCount,
                    networkRetryCount: state.networkRetryCount,
                    fallbackIndex,
                    recoverable: false
                  }
                );
              }
            } else {
              adapter = processedOptions.adapter;
            }
            sourceStream = adapter.wrap(
              streamResult,
              processedOptions.adapterOptions
            );
          } else if (streamResult.textStream) {
            sourceStream = streamResult.textStream;
          } else if (streamResult.fullStream) {
            sourceStream = streamResult.fullStream;
          } else if (_adapterRegistry?.hasMatchingAdapter(streamResult)) {
            const adapter = _adapterRegistry.detectAdapter(streamResult);
            sourceStream = adapter.wrap(
              streamResult,
              processedOptions.adapterOptions
            );
          } else if (Symbol.asyncIterator in streamResult) {
            sourceStream = streamResult;
          } else {
            throw new L0Error(
              "Invalid stream result - no iterable stream found and no adapter matched. Use explicit `adapter: myAdapter` or register an adapter with detect().",
              {
                code: "INVALID_STREAM",
                modelRetryCount: state.modelRetryCount,
                networkRetryCount: state.networkRetryCount,
                fallbackIndex,
                recoverable: true
              }
            );
          }
          const startTime = Date.now();
          state.firstTokenAt = void 0;
          state.lastTokenAt = void 0;
          let firstTokenReceived = false;
          stateMachine.transition(RuntimeStates.WAITING_FOR_TOKEN);
          let lastTokenEmissionTime = startTime;
          const defaultInitialTokenTimeout = 5e3;
          const initialTimeout = processedTimeout.initialToken ?? defaultInitialTokenTimeout;
          let initialTimeoutId = null;
          let initialTimeoutReached = false;
          if (!signal?.aborted) {
            initialTimeoutId = setTimeout(() => {
              initialTimeoutReached = true;
            }, initialTimeout);
          }
          for await (const chunk of sourceStream) {
            if (signal?.aborted) {
              throw new L0Error("Stream aborted by signal", {
                code: "STREAM_ABORTED",
                checkpoint: state.checkpoint,
                tokenCount: state.tokenCount,
                contentLength: state.content.length,
                modelRetryCount: state.modelRetryCount,
                networkRetryCount: state.networkRetryCount,
                fallbackIndex,
                recoverable: state.checkpoint.length > 0
              });
            }
            if (firstTokenReceived) {
              const interTimeout = processedTimeout.interToken ?? 1e4;
              const timeSinceLastToken = Date.now() - lastTokenEmissionTime;
              if (timeSinceLastToken > interTimeout) {
                metrics.timeouts++;
                throw new L0Error("Inter-token timeout reached", {
                  code: "INTER_TOKEN_TIMEOUT",
                  checkpoint: state.checkpoint,
                  tokenCount: state.tokenCount,
                  contentLength: state.content.length,
                  modelRetryCount: state.modelRetryCount,
                  networkRetryCount: state.networkRetryCount,
                  fallbackIndex,
                  recoverable: state.checkpoint.length > 0,
                  metadata: { timeout: interTimeout, timeSinceLastToken }
                });
              }
            }
            if (initialTimeoutId && !firstTokenReceived) {
              clearTimeout(initialTimeoutId);
              initialTimeoutId = null;
              initialTimeoutReached = false;
            }
            if (initialTimeoutReached && !firstTokenReceived) {
              metrics.timeouts++;
              throw new L0Error("Initial token timeout reached", {
                code: "INITIAL_TOKEN_TIMEOUT",
                checkpoint: state.checkpoint,
                tokenCount: 0,
                contentLength: 0,
                modelRetryCount: state.modelRetryCount,
                networkRetryCount: state.networkRetryCount,
                fallbackIndex,
                recoverable: true,
                metadata: {
                  timeout: processedTimeout.initialToken ?? defaultInitialTokenTimeout
                }
              });
            }
            let event;
            try {
              event = normalizeStreamEvent(chunk);
            } catch (normalizeError) {
              const errMsg = normalizeError instanceof Error ? normalizeError.message : String(normalizeError);
              monitor?.logEvent({
                type: "warning",
                message: `Failed to normalize stream chunk: ${errMsg}`,
                chunk: typeof chunk === "object" ? JSON.stringify(chunk) : chunk
              });
              continue;
            }
            if (event.type === "token" && event.value) {
              let token = event.value;
              if (!firstTokenReceived) {
                firstTokenReceived = true;
                state.firstTokenAt = Date.now();
                stateMachine.transition(RuntimeStates.STREAMING);
              }
              metrics.tokens++;
              if (state.resumed && shouldDeduplicateContinuation && checkpointForContinuation.length > 0 && !overlapResolved) {
                if (overlapBuffer.length === 0) {
                  stateMachine.transition(RuntimeStates.CONTINUATION_MATCHING);
                }
                overlapBuffer += token;
                const overlapResult = detectOverlap(
                  checkpointForContinuation,
                  overlapBuffer,
                  {
                    minOverlap: processedDeduplicationOptions.minOverlap ?? 2,
                    maxOverlap: processedDeduplicationOptions.maxOverlap ?? 500,
                    caseSensitive: processedDeduplicationOptions.caseSensitive ?? true,
                    normalizeWhitespace: processedDeduplicationOptions.normalizeWhitespace ?? false
                  }
                );
                const maxOverlapLen = processedDeduplicationOptions.maxOverlap ?? 500;
                const shouldFinalize = overlapResult.hasOverlap && overlapResult.deduplicatedContinuation.length > 0 || overlapBuffer.length > maxOverlapLen;
                if (shouldFinalize) {
                  overlapResolved = true;
                  stateMachine.transition(RuntimeStates.STREAMING);
                  if (overlapResult.hasOverlap) {
                    token = overlapResult.deduplicatedContinuation;
                    if (token.length === 0) {
                      continue;
                    }
                  } else {
                    token = overlapBuffer;
                  }
                } else {
                  continue;
                }
              }
              tokenBuffer.push(token);
              state.tokenCount++;
              state.lastTokenAt = Date.now();
              const needsContent = guardrailEngine && state.tokenCount % guardrailCheckInterval === 0 || driftDetector && state.tokenCount % driftCheckInterval === 0 || state.tokenCount % checkpointInterval === 0;
              if (needsContent) {
                state.content = tokenBuffer.join("");
              }
              monitor?.recordToken(state.lastTokenAt);
              if (state.tokenCount % checkpointInterval === 0) {
                state.checkpoint = state.content;
              }
              if (guardrailEngine && state.tokenCount % guardrailCheckInterval === 0) {
                const context = {
                  content: state.content,
                  checkpoint: state.checkpoint,
                  delta: token,
                  tokenCount: state.tokenCount,
                  completed: false
                };
                const result2 = guardrailEngine.check(context);
                if (result2.violations.length > 0) {
                  state.violations.push(...result2.violations);
                  monitor?.recordGuardrailViolations(result2.violations);
                }
                if (result2.shouldHalt) {
                  throw new L0Error(
                    `Fatal guardrail violation: ${result2.violations[0]?.message}`,
                    {
                      code: "FATAL_GUARDRAIL_VIOLATION",
                      checkpoint: state.checkpoint,
                      tokenCount: state.tokenCount,
                      contentLength: state.content.length,
                      modelRetryCount: state.modelRetryCount,
                      networkRetryCount: state.networkRetryCount,
                      fallbackIndex,
                      recoverable: false,
                      metadata: { violation: result2.violations[0] }
                    }
                  );
                }
              }
              if (driftDetector && state.tokenCount % driftCheckInterval === 0) {
                const drift = driftDetector.check(state.content, token);
                if (drift.detected) {
                  state.driftDetected = true;
                  monitor?.recordDrift(true, drift.types);
                }
              }
              const l0Event = {
                type: "token",
                value: token,
                timestamp: Date.now()
              };
              safeInvokeCallback(processedOnEvent, l0Event, monitor, "onEvent");
              yield l0Event;
              lastTokenEmissionTime = Date.now();
            } else if (event.type === "message") {
              const messageEvent = {
                type: "message",
                value: event.value,
                role: event.role,
                timestamp: Date.now()
              };
              safeInvokeCallback(
                processedOnEvent,
                messageEvent,
                monitor,
                "onEvent"
              );
              yield messageEvent;
            } else if (event.type === "data") {
              if (event.data) {
                state.dataOutputs.push(event.data);
              }
              const dataEvent = {
                type: "data",
                data: event.data,
                timestamp: Date.now()
              };
              safeInvokeCallback(
                processedOnEvent,
                dataEvent,
                monitor,
                "onEvent"
              );
              yield dataEvent;
            } else if (event.type === "progress") {
              state.lastProgress = event.progress;
              const progressEvent = {
                type: "progress",
                progress: event.progress,
                timestamp: Date.now()
              };
              safeInvokeCallback(
                processedOnEvent,
                progressEvent,
                monitor,
                "onEvent"
              );
              yield progressEvent;
            } else if (event.type === "error") {
              throw event.error || new Error("Stream error");
            } else if (event.type === "complete") {
              break;
            }
          }
          if (initialTimeoutId) {
            clearTimeout(initialTimeoutId);
          }
          if (state.resumed && shouldDeduplicateContinuation && !overlapResolved && overlapBuffer.length > 0) {
            const overlapResult = detectOverlap(
              checkpointForContinuation,
              overlapBuffer,
              {
                minOverlap: processedDeduplicationOptions.minOverlap ?? 2,
                maxOverlap: processedDeduplicationOptions.maxOverlap ?? 500,
                caseSensitive: processedDeduplicationOptions.caseSensitive ?? true,
                normalizeWhitespace: processedDeduplicationOptions.normalizeWhitespace ?? false
              }
            );
            let flushedToken;
            if (overlapResult.hasOverlap) {
              flushedToken = overlapResult.deduplicatedContinuation;
            } else {
              flushedToken = overlapBuffer;
            }
            if (flushedToken.length > 0) {
              tokenBuffer.push(flushedToken);
              state.tokenCount++;
              state.content = tokenBuffer.join("");
              if (guardrailEngine) {
                const context = {
                  content: state.content,
                  checkpoint: state.checkpoint,
                  delta: flushedToken,
                  tokenCount: state.tokenCount,
                  completed: false
                };
                const result2 = guardrailEngine.check(context);
                if (result2.violations.length > 0) {
                  state.violations.push(...result2.violations);
                  monitor?.recordGuardrailViolations(result2.violations);
                }
                if (result2.shouldHalt) {
                  throw new L0Error(
                    `Fatal guardrail violation: ${result2.violations[0]?.message}`,
                    {
                      code: "FATAL_GUARDRAIL_VIOLATION",
                      checkpoint: state.checkpoint,
                      tokenCount: state.tokenCount,
                      contentLength: state.content.length,
                      modelRetryCount: state.modelRetryCount,
                      networkRetryCount: state.networkRetryCount,
                      fallbackIndex,
                      recoverable: false,
                      metadata: { violation: result2.violations[0] }
                    }
                  );
                }
              }
              if (driftDetector) {
                const drift = driftDetector.check(state.content, flushedToken);
                if (drift.detected) {
                  state.driftDetected = true;
                  monitor?.recordDrift(true, drift.types);
                }
              }
              const flushedEvent = {
                type: "token",
                value: flushedToken,
                timestamp: Date.now()
              };
              safeInvokeCallback(
                processedOnEvent,
                flushedEvent,
                monitor,
                "onEvent"
              );
              yield flushedEvent;
            }
            overlapResolved = true;
          }
          state.content = tokenBuffer.join("");
          if (processedDetectZeroTokens && detectZeroToken(state.content)) {
            throw new L0Error("Zero output detected - no meaningful content", {
              code: "ZERO_OUTPUT",
              checkpoint: state.checkpoint,
              tokenCount: state.tokenCount,
              contentLength: state.content.length,
              modelRetryCount: state.modelRetryCount,
              networkRetryCount: state.networkRetryCount,
              fallbackIndex,
              recoverable: true
            });
          }
          if (guardrailEngine) {
            const context = {
              content: state.content,
              checkpoint: state.checkpoint,
              tokenCount: state.tokenCount,
              completed: true
            };
            const result2 = guardrailEngine.check(context);
            if (result2.violations.length > 0) {
              state.violations.push(...result2.violations);
              monitor?.recordGuardrailViolations(result2.violations);
            }
            if (result2.shouldRetry && retryAttempt < modelRetryLimit) {
              const violation = result2.violations[0];
              if (processedOnRetry) {
                processedOnRetry(
                  retryAttempt + 1,
                  `Guardrail violation: ${violation?.message}`
                );
              }
              retryAttempt++;
              state.modelRetryCount++;
              continue;
            }
            if (result2.shouldHalt) {
              throw new L0Error(
                `Fatal guardrail violation: ${result2.violations[0]?.message}`,
                {
                  code: "FATAL_GUARDRAIL_VIOLATION",
                  checkpoint: state.checkpoint,
                  tokenCount: state.tokenCount,
                  contentLength: state.content.length,
                  modelRetryCount: state.modelRetryCount,
                  networkRetryCount: state.networkRetryCount,
                  fallbackIndex,
                  recoverable: false,
                  metadata: { violation: result2.violations[0] }
                }
              );
            }
          }
          if (driftDetector) {
            const finalDrift = driftDetector.check(state.content);
            if (finalDrift.detected && retryAttempt < modelRetryLimit) {
              state.driftDetected = true;
              monitor?.recordDrift(true, finalDrift.types);
              if (processedOnRetry) {
                processedOnRetry(retryAttempt + 1, "Drift detected");
              }
              monitor?.recordRetry(false);
              retryAttempt++;
              state.modelRetryCount++;
              continue;
            }
          }
          stateMachine.transition(RuntimeStates.FINALIZING);
          state.completed = true;
          monitor?.complete();
          metrics.completions++;
          if (state.firstTokenAt) {
            state.duration = Date.now() - state.firstTokenAt;
          }
          const completeEvent = {
            type: "complete",
            timestamp: Date.now()
          };
          safeInvokeCallback(
            processedOnEvent,
            completeEvent,
            monitor,
            "onEvent"
          );
          yield completeEvent;
          stateMachine.transition(RuntimeStates.COMPLETE);
          if (processedOnComplete) {
            processedOnComplete(state);
          }
          break;
        } catch (error) {
          const err = error instanceof Error ? error : new Error(String(error));
          errors.push(err);
          if (guardrailEngine && state.tokenCount > 0) {
            if (tokenBuffer.length > 0) {
              state.content = tokenBuffer.join("");
            }
            const partialContext = {
              content: state.content,
              checkpoint: state.checkpoint,
              delta: "",
              tokenCount: state.tokenCount,
              completed: false
              // Stream didn't complete normally
            };
            const partialResult = guardrailEngine.check(partialContext);
            if (partialResult.violations.length > 0) {
              state.violations.push(...partialResult.violations);
              monitor?.recordGuardrailViolations(partialResult.violations);
              for (const violation of partialResult.violations) {
                if (processedOnViolation) {
                  processedOnViolation(violation);
                }
              }
              const hasFatal = partialResult.violations.some(
                (v) => v.severity === "fatal"
              );
              if (hasFatal) {
                state.checkpoint = "";
              }
            }
            if (!partialResult.violations.some((v) => v.severity === "fatal") && state.content.length > 0) {
              state.checkpoint = state.content;
            }
          }
          if (driftDetector && state.tokenCount > 0) {
            if (tokenBuffer.length > 0) {
              state.content = tokenBuffer.join("");
            }
            const partialDrift = driftDetector.check(state.content);
            if (partialDrift.detected) {
              state.driftDetected = true;
              monitor?.recordDrift(true, partialDrift.types);
              if (processedOnViolation) {
                processedOnViolation({
                  rule: "drift",
                  severity: "warning",
                  message: `Drift detected in partial stream: ${partialDrift.types.join(", ")}`,
                  recoverable: true
                });
              }
            }
          }
          const categorized = retryManager.categorizeError(err);
          let decision = retryManager.shouldRetry(err);
          if (processedRetry.shouldRetry) {
            const customDecision = processedRetry.shouldRetry(err, {
              attempt: retryAttempt,
              totalAttempts: retryAttempt + state.networkRetryCount,
              category: categorized.category,
              reason: categorized.reason,
              content: state.content,
              tokenCount: state.tokenCount
            });
            if (customDecision === true) {
              decision = { ...decision, shouldRetry: true };
            } else if (customDecision === false) {
              decision = { ...decision, shouldRetry: false };
            }
          }
          if (processedRetry.calculateDelay && decision.shouldRetry) {
            const customDelay = processedRetry.calculateDelay({
              attempt: retryAttempt,
              totalAttempts: retryAttempt + state.networkRetryCount,
              category: categorized.category,
              reason: categorized.reason,
              error: err,
              defaultDelay: decision.delay
            });
            if (typeof customDelay === "number") {
              decision = { ...decision, delay: customDelay };
            }
          }
          const isNetError = isNetworkError(err);
          if (isNetError) {
            monitor?.recordNetworkError(
              err,
              decision.shouldRetry,
              decision.delay
            );
          }
          if (processedOnError) {
            const willRetry = decision.shouldRetry;
            const willFallback = !decision.shouldRetry && fallbackIndex < allStreams.length - 1;
            processedOnError(err, willRetry, willFallback);
          }
          if (decision.shouldRetry) {
            if (decision.countsTowardLimit) {
              retryAttempt++;
              state.modelRetryCount++;
            } else {
              state.networkRetryCount++;
            }
            isRetryAttempt = true;
            stateMachine.transition(RuntimeStates.RETRYING);
            metrics.retries++;
            if (isNetError) {
              metrics.networkRetryCount++;
            }
            monitor?.recordRetry(isNetError);
            if (processedOnRetry) {
              processedOnRetry(retryAttempt, decision.reason);
            }
            await retryManager.recordRetry(categorized, decision);
            continue;
          }
          if (fallbackIndex < allStreams.length - 1) {
            break;
          }
          const errorCategory = err instanceof L0Error ? err.category : "internal" /* INTERNAL */;
          const errorEvent = {
            type: "error",
            error: err,
            reason: errorCategory,
            timestamp: Date.now()
          };
          safeInvokeCallback(processedOnEvent, errorEvent, monitor, "onEvent");
          yield errorEvent;
          await interceptorManager?.executeError(err, processedOptions);
          stateMachine.transition(RuntimeStates.ERROR);
          metrics.errors++;
          throw err;
        }
      }
      if (!state.completed) {
        if (fallbackIndex < allStreams.length - 1) {
          fallbackIndex++;
          stateMachine.transition(RuntimeStates.FALLBACK);
          metrics.fallbacks++;
          const fallbackMessage = `Retries exhausted for stream ${fallbackIndex}, falling back to stream ${fallbackIndex + 1}`;
          monitor?.logEvent({
            type: "fallback",
            message: fallbackMessage,
            fromIndex: fallbackIndex - 1,
            toIndex: fallbackIndex
          });
          if (processedOnFallback) {
            processedOnFallback(fallbackIndex - 1, fallbackMessage);
          }
          if (processedContinueFromCheckpoint && state.checkpoint.length > 0) {
            checkpointForContinuation = state.checkpoint;
            stateMachine.transition(RuntimeStates.CHECKPOINT_VERIFYING);
            const validation = validateCheckpointForContinuation(
              checkpointForContinuation,
              guardrailEngine,
              driftDetector
            );
            if (validation.violations.length > 0) {
              state.violations.push(...validation.violations);
              monitor?.recordGuardrailViolations(validation.violations);
            }
            if (validation.driftDetected) {
              state.driftDetected = true;
              monitor?.recordDrift(true, validation.driftTypes);
              if (processedOnViolation) {
                processedOnViolation({
                  rule: "drift",
                  severity: "warning",
                  message: `Drift detected in checkpoint: ${validation.driftTypes.join(", ")}`,
                  recoverable: true
                });
              }
            }
            if (!validation.skipContinuation) {
              state.resumed = true;
              state.resumePoint = checkpointForContinuation;
              state.resumeFrom = checkpointForContinuation.length;
              overlapBuffer = "";
              overlapResolved = false;
              if (processedOnResume) {
                processedOnResume(checkpointForContinuation, state.tokenCount);
              }
              if (processedBuildContinuationPrompt) {
                processedBuildContinuationPrompt(checkpointForContinuation);
              }
              monitor?.recordContinuation(
                true,
                true,
                checkpointForContinuation
              );
              const checkpointEvent = {
                type: "token",
                value: checkpointForContinuation,
                timestamp: Date.now()
              };
              safeInvokeCallback(
                processedOnEvent,
                checkpointEvent,
                monitor,
                "onEvent"
              );
              yield checkpointEvent;
              tokenBuffer = [checkpointForContinuation];
              resetStateForRetry(state, {
                checkpoint: state.checkpoint,
                resumed: true,
                resumePoint: checkpointForContinuation,
                resumeFrom: checkpointForContinuation.length,
                fallbackIndex
              });
              state.content = checkpointForContinuation;
              state.tokenCount = 1;
            } else {
              tokenBuffer = [];
              resetStateForRetry(state, { fallbackIndex });
            }
          } else {
            tokenBuffer = [];
            resetStateForRetry(state, { fallbackIndex });
          }
          continue;
        } else {
          const exhaustedError = new Error(
            `All streams exhausted (primary + ${processedFallbackStreams.length} fallbacks)`
          );
          errors.push(exhaustedError);
          const errorEvent = {
            type: "error",
            error: exhaustedError,
            reason: "internal" /* INTERNAL */,
            timestamp: Date.now()
          };
          safeInvokeCallback(processedOnEvent, errorEvent, monitor, "onEvent");
          yield errorEvent;
          await interceptorManager?.executeError(
            exhaustedError,
            processedOptions
          );
          stateMachine.transition(RuntimeStates.ERROR);
          metrics.errors++;
          throw exhaustedError;
        }
      }
      break;
    }
  };
  let result = {
    stream: streamGenerator(),
    state,
    errors,
    telemetry: monitor?.export(),
    abort: () => abortController.abort()
  };
  if (interceptorManager) {
    try {
      result = await interceptorManager.executeAfter(
        result
      );
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      await interceptorManager.executeError(err, processedOptions);
      throw err;
    }
  }
  return result;
}

// src/guardrails/json.ts
function analyzeJsonStructure(content) {
  let openBraces = 0;
  let closeBraces = 0;
  let openBrackets = 0;
  let closeBrackets = 0;
  let inString = false;
  let escapeNext = false;
  const issues = [];
  for (let i = 0; i < content.length; i++) {
    const char = content[i];
    if (escapeNext) {
      escapeNext = false;
      continue;
    }
    if (char === "\\") {
      escapeNext = true;
      continue;
    }
    if (char === '"') {
      inString = !inString;
      continue;
    }
    if (!inString) {
      if (char === "{") openBraces++;
      if (char === "}") closeBraces++;
      if (char === "[") openBrackets++;
      if (char === "]") closeBrackets++;
    }
  }
  if (inString) {
    issues.push("Unclosed string detected");
  }
  if (openBraces !== closeBraces) {
    issues.push(`Unbalanced braces: ${openBraces} open, ${closeBraces} close`);
  }
  if (openBrackets !== closeBrackets) {
    issues.push(
      `Unbalanced brackets: ${openBrackets} open, ${closeBrackets} close`
    );
  }
  const isBalanced = openBraces === closeBraces && openBrackets === closeBrackets && !inString;
  return {
    openBraces,
    closeBraces,
    openBrackets,
    closeBrackets,
    inString,
    isBalanced,
    issues
  };
}
function looksLikeJson(content) {
  if (!content) return false;
  const trimmed = content.trim();
  return trimmed.startsWith("{") || trimmed.startsWith("[");
}
function validateJsonStructure(context) {
  const { content, completed } = context;
  const violations = [];
  if (!looksLikeJson(content)) {
    return violations;
  }
  const structure = analyzeJsonStructure(content);
  if (!completed) {
    if (structure.closeBraces > structure.openBraces) {
      violations.push({
        rule: "json-structure",
        message: `Too many closing braces: ${structure.closeBraces} close, ${structure.openBraces} open`,
        severity: "error",
        recoverable: true
      });
    }
    if (structure.closeBrackets > structure.openBrackets) {
      violations.push({
        rule: "json-structure",
        message: `Too many closing brackets: ${structure.closeBrackets} close, ${structure.openBrackets} open`,
        severity: "error",
        recoverable: true
      });
    }
  } else {
    if (!structure.isBalanced) {
      for (const issue of structure.issues) {
        violations.push({
          rule: "json-structure",
          message: issue,
          severity: "error",
          recoverable: true,
          suggestion: "Retry generation to get properly balanced JSON"
        });
      }
    }
  }
  return violations;
}
function validateJsonChunks(context) {
  const { content, delta } = context;
  const violations = [];
  if (!delta || !looksLikeJson(content)) {
    return violations;
  }
  const malformedPatterns = [
    { pattern: /,,+/, message: "Multiple consecutive commas" },
    { pattern: /\{\s*,/, message: "Comma immediately after opening brace" },
    { pattern: /\[\s*,/, message: "Comma immediately after opening bracket" },
    { pattern: /:\s*,/, message: "Comma immediately after colon" }
  ];
  for (const { pattern, message } of malformedPatterns) {
    if (pattern.test(content)) {
      violations.push({
        rule: "json-chunks",
        message: `Malformed JSON: ${message}`,
        severity: "error",
        recoverable: true
      });
    }
  }
  return violations;
}
function validateJsonParseable(context) {
  const { content, completed } = context;
  const violations = [];
  if (!completed || !looksLikeJson(content)) {
    return violations;
  }
  try {
    JSON.parse(content.trim());
  } catch (error) {
    violations.push({
      rule: "json-parseable",
      message: `JSON is not parseable: ${error instanceof Error ? error.message : "Unknown error"}`,
      severity: "error",
      recoverable: true,
      suggestion: "Retry generation to get valid JSON"
    });
  }
  return violations;
}
function jsonRule() {
  return {
    name: "json-structure",
    description: "Validates JSON structure and balance",
    streaming: true,
    severity: "error",
    recoverable: true,
    check: (context) => {
      const violations = [];
      violations.push(...validateJsonStructure(context));
      violations.push(...validateJsonChunks(context));
      if (context.completed) {
        violations.push(...validateJsonParseable(context));
      }
      return violations;
    }
  };
}
function strictJsonRule() {
  return {
    name: "json-strict",
    description: "Strict JSON validation including structure and parseability",
    streaming: false,
    severity: "error",
    recoverable: true,
    check: (context) => {
      const violations = [];
      if (!context.completed) {
        return violations;
      }
      const { content } = context;
      if (!looksLikeJson(content)) {
        violations.push({
          rule: "json-strict",
          message: "Content does not appear to be JSON (must start with { or [)",
          severity: "error",
          recoverable: true
        });
        return violations;
      }
      violations.push(...validateJsonParseable(context));
      if (violations.length === 0) {
        try {
          const parsed = JSON.parse(content.trim());
          if (typeof parsed !== "object" || parsed === null) {
            violations.push({
              rule: "json-strict",
              message: "JSON root must be an object or array",
              severity: "error",
              recoverable: true
            });
          }
        } catch {
        }
      }
      return violations;
    }
  };
}

// src/guardrails/markdown.ts
var HEADER_PATTERN = /^(#{1,6})\s+/;
var LIST_PATTERN = /^(\s*)([-*+]|\d+\.)\s+/;
var TABLE_SEPARATOR = /^\|?[\s-:|]+\|[\s-:|]*$/;
var PIPE_COUNT = /\|/g;
var UNORDERED_LIST = /^(\s*)([-*+])\s+/;
var ORDERED_LIST = /^(\s*)(\d+)\.\s+/;
var WHITESPACE_ONLY = /^\s*$/;
var SENTENCE_END = /[.!?;:\]})"`']$/;
var HEADER_LINE = /^#{1,6}\s+/;
var UNORDERED_LIST_LINE = /^[-*+]\s+/;
var ORDERED_LIST_LINE = /^\d+\.\s+/;
var MARKDOWN_PATTERNS = [
  /^#{1,6}\s+/m,
  // Headers
  /```/,
  // Code fences
  /^\s*[-*+]\s+/m,
  // Unordered lists
  /^\s*\d+\.\s+/m,
  // Ordered lists
  /\*\*.*\*\*/,
  // Bold
  /\*.*\*/,
  // Italic
  /\[.*\]\(.*\)/,
  // Links
  /^>\s+/m
  // Blockquotes
];
function analyzeMarkdownStructure(content) {
  const issues = [];
  const lines = content.split("\n");
  const fenceLanguages = [];
  const headers = [];
  let openFences = 0;
  let inFence = false;
  let listDepth = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.trimStart().startsWith("```")) {
      inFence = !inFence;
      if (inFence) {
        openFences++;
        const lang = line.trim().slice(3).trim();
        if (lang) {
          fenceLanguages.push(lang);
        }
      } else {
        openFences--;
      }
    }
    if (!inFence) {
      const headerMatch = line.match(HEADER_PATTERN);
      if (headerMatch && headerMatch[1]) {
        headers.push(headerMatch[1].length);
      }
      const listMatch = line.match(LIST_PATTERN);
      if (listMatch && listMatch[1] !== void 0) {
        const indent = listMatch[1].length;
        const currentDepth = Math.floor(indent / 2) + 1;
        listDepth = Math.max(listDepth, currentDepth);
      }
    }
  }
  if (inFence || openFences !== 0) {
    issues.push(`Unbalanced code fences: ${Math.abs(openFences)} unclosed`);
  }
  return {
    openFences: Math.max(0, openFences),
    fenceLanguages,
    inFence,
    headers,
    listDepth,
    issues
  };
}
function looksLikeMarkdown(content) {
  if (!content) return false;
  return MARKDOWN_PATTERNS.some((pattern) => pattern.test(content));
}
function validateMarkdownFences(context) {
  const { content, completed } = context;
  const violations = [];
  const structure = analyzeMarkdownStructure(content);
  if (!completed && structure.inFence) {
    if (structure.openFences > 5) {
      violations.push({
        rule: "markdown-fences",
        message: `Excessive unclosed code fences: ${structure.openFences}`,
        severity: "warning",
        recoverable: true
      });
    }
  } else if (completed && structure.openFences !== 0) {
    violations.push({
      rule: "markdown-fences",
      message: `Unclosed code fences: ${structure.openFences} fence(s) not closed`,
      severity: "error",
      recoverable: true,
      suggestion: "Retry generation to properly close code fences"
    });
  }
  return violations;
}
function validateMarkdownTables(context) {
  const { content, completed } = context;
  const violations = [];
  if (!completed) {
    return violations;
  }
  const lines = content.split("\n");
  let inTable = false;
  let columnCount = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (TABLE_SEPARATOR.test(line)) {
      inTable = true;
      columnCount = (line.match(PIPE_COUNT) || []).length;
      continue;
    }
    if (inTable) {
      if (line.includes("|")) {
        const cols = (line.match(PIPE_COUNT) || []).length;
        if (cols !== columnCount) {
          violations.push({
            rule: "markdown-tables",
            message: `Inconsistent table columns at line ${i + 1}: expected ${columnCount}, got ${cols}`,
            severity: "warning",
            recoverable: true
          });
        }
      } else if (line.trim().length > 0) {
        inTable = false;
      }
    }
  }
  return violations;
}
function validateMarkdownLists(context) {
  const { content, completed } = context;
  const violations = [];
  if (!completed) {
    return violations;
  }
  const lines = content.split("\n");
  let lastListType = null;
  let lastIndent = -1;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const unorderedMatch = line.match(UNORDERED_LIST);
    if (unorderedMatch && unorderedMatch[1] !== void 0) {
      const indent = unorderedMatch[1].length;
      if (lastListType === "ordered" && lastIndent === indent) {
        violations.push({
          rule: "markdown-lists",
          message: `Mixed list types at line ${i + 1}: switching from ordered to unordered at same level`,
          severity: "warning",
          recoverable: true
        });
      }
      lastListType = "unordered";
      lastIndent = indent;
      continue;
    }
    const orderedMatch = line.match(ORDERED_LIST);
    if (orderedMatch && orderedMatch[1] !== void 0) {
      const indent = orderedMatch[1].length;
      if (lastListType === "unordered" && lastIndent === indent) {
        violations.push({
          rule: "markdown-lists",
          message: `Mixed list types at line ${i + 1}: switching from unordered to ordered at same level`,
          severity: "warning",
          recoverable: true
        });
      }
      lastListType = "ordered";
      lastIndent = indent;
      continue;
    }
    if (line.trim().length > 0 && !WHITESPACE_ONLY.test(line)) {
      lastListType = null;
      lastIndent = -1;
    }
  }
  return violations;
}
function validateMarkdownComplete(context) {
  const { content, completed } = context;
  const violations = [];
  if (!completed) {
    return violations;
  }
  const structure = analyzeMarkdownStructure(content);
  if (structure.inFence) {
    violations.push({
      rule: "markdown-complete",
      message: "Content ends inside code fence",
      severity: "error",
      recoverable: true,
      suggestion: "Retry to complete the code fence"
    });
  }
  const trimmed = content.trim();
  const lines = trimmed.split("\n");
  const lastLine = lines[lines.length - 1] ?? "";
  if (!structure.inFence && lastLine.trim().length > 0 && !SENTENCE_END.test(lastLine) && !HEADER_LINE.test(lastLine) && // Not a header
  !UNORDERED_LIST_LINE.test(lastLine) && // Not a list item
  !ORDERED_LIST_LINE.test(lastLine)) {
    violations.push({
      rule: "markdown-complete",
      message: "Content appears to end abruptly mid-sentence",
      severity: "warning",
      recoverable: true
    });
  }
  return violations;
}
function markdownRule() {
  return {
    name: "markdown-structure",
    description: "Validates Markdown fences, blocks, and structure",
    streaming: true,
    severity: "error",
    recoverable: true,
    check: (context) => {
      const violations = [];
      if (!looksLikeMarkdown(context.content) && context.content.length > 50) {
        return violations;
      }
      violations.push(...validateMarkdownFences(context));
      if (context.completed) {
        violations.push(...validateMarkdownTables(context));
        violations.push(...validateMarkdownLists(context));
        violations.push(...validateMarkdownComplete(context));
      }
      return violations;
    }
  };
}

// src/guardrails/latex.ts
var BEGIN_PATTERN = /\\begin\{(\w+)\}/g;
var END_PATTERN = /\\end\{(\w+)\}/g;
var DISPLAY_MATH_OPEN = /\\\[/g;
var DISPLAY_MATH_CLOSE = /\\\]/g;
var DOUBLE_DOLLAR = /\$\$/g;
var LATEX_PATTERNS = [
  /\\begin\{/,
  /\\end\{/,
  /\\\[/,
  // Display math
  /\\\]/,
  // Display math
  /\$\$/,
  // Display math
  /\\[a-zA-Z]+\{/,
  // Commands with arguments
  /\\section/,
  /\\subsection/,
  /\\textbf/,
  /\\textit/,
  /\\frac/,
  /\\sum/,
  /\\int/
];
function analyzeLatexStructure(content) {
  const issues = [];
  const openEnvironments = [];
  const envStack = [];
  BEGIN_PATTERN.lastIndex = 0;
  END_PATTERN.lastIndex = 0;
  const begins = [];
  const ends = [];
  let match;
  while ((match = BEGIN_PATTERN.exec(content)) !== null) {
    begins.push({ env: match[1], pos: match.index });
  }
  while ((match = END_PATTERN.exec(content)) !== null) {
    ends.push({ env: match[1], pos: match.index });
  }
  const events = [
    ...begins.map((b) => ({ ...b, type: "begin" })),
    ...ends.map((e) => ({ ...e, type: "end" }))
  ].sort((a, b) => a.pos - b.pos);
  for (const event of events) {
    if (event.type === "begin") {
      envStack.push(event.env);
    } else {
      if (envStack.length === 0) {
        issues.push(
          `\\end{${event.env}} without matching \\begin{${event.env}}`
        );
      } else {
        const last = envStack[envStack.length - 1];
        if (last === event.env) {
          envStack.pop();
        } else {
          issues.push(
            `Environment mismatch: \\begin{${last}} closed with \\end{${event.env}}`
          );
          envStack.pop();
        }
      }
    }
  }
  for (const env of envStack) {
    openEnvironments.push(env);
    issues.push(`Unclosed environment: \\begin{${env}}`);
  }
  const isBalanced = envStack.length === 0 && issues.length === 0;
  return {
    openEnvironments,
    isBalanced,
    issues
  };
}
function looksLikeLatex(content) {
  if (!content) return false;
  return LATEX_PATTERNS.some((pattern) => pattern.test(content));
}
function validateLatexEnvironments(context) {
  const { content, completed } = context;
  const violations = [];
  if (!looksLikeLatex(content)) {
    return violations;
  }
  const structure = analyzeLatexStructure(content);
  if (!completed) {
    const mismatchIssues = structure.issues.filter(
      (issue) => issue.includes("mismatch")
    );
    for (const issue of mismatchIssues) {
      violations.push({
        rule: "latex-environments",
        message: issue,
        severity: "error",
        recoverable: true
      });
    }
    if (structure.openEnvironments.length > 5) {
      violations.push({
        rule: "latex-environments",
        message: `Excessive unclosed environments: ${structure.openEnvironments.length}`,
        severity: "warning",
        recoverable: true
      });
    }
  } else {
    if (!structure.isBalanced) {
      for (const issue of structure.issues) {
        violations.push({
          rule: "latex-environments",
          message: issue,
          severity: "error",
          recoverable: true,
          suggestion: "Retry generation to properly balance LaTeX environments"
        });
      }
    }
  }
  return violations;
}
function validateLatexMath(context) {
  const { content, completed } = context;
  const violations = [];
  if (!looksLikeLatex(content)) {
    return violations;
  }
  DISPLAY_MATH_OPEN.lastIndex = 0;
  DISPLAY_MATH_CLOSE.lastIndex = 0;
  DOUBLE_DOLLAR.lastIndex = 0;
  const displayMathOpen = (content.match(DISPLAY_MATH_OPEN) || []).length;
  const displayMathClose = (content.match(DISPLAY_MATH_CLOSE) || []).length;
  const doubleDollar = (content.match(DOUBLE_DOLLAR) || []).length;
  let singleDollarCount = 0;
  let escapeNext = false;
  for (let i = 0; i < content.length; i++) {
    if (escapeNext) {
      escapeNext = false;
      continue;
    }
    if (content[i] === "\\") {
      escapeNext = true;
      continue;
    }
    if (content[i] === "$" && (i + 1 >= content.length || content[i + 1] !== "$")) {
      singleDollarCount++;
    }
  }
  if (completed) {
    if (displayMathOpen !== displayMathClose) {
      violations.push({
        rule: "latex-math",
        message: `Unbalanced display math: ${displayMathOpen} \\[ and ${displayMathClose} \\]`,
        severity: "error",
        recoverable: true,
        suggestion: "Ensure all \\[ have matching \\]"
      });
    }
    if (doubleDollar % 2 !== 0) {
      violations.push({
        rule: "latex-math",
        message: `Unbalanced $$ delimiters: ${doubleDollar} found (should be even)`,
        severity: "error",
        recoverable: true,
        suggestion: "Ensure all $$ are paired"
      });
    }
    if (singleDollarCount % 2 !== 0) {
      violations.push({
        rule: "latex-math",
        message: `Unbalanced inline math: ${singleDollarCount} $ found (should be even)`,
        severity: "warning",
        recoverable: true,
        suggestion: "Check inline math delimiters"
      });
    }
  }
  return violations;
}
function validateLatexCommon(context) {
  const { content, completed } = context;
  const violations = [];
  if (!looksLikeLatex(content)) {
    return violations;
  }
  if (!completed) {
    return violations;
  }
  const commandPattern = /\\[a-zA-Z]+/g;
  let match;
  while ((match = commandPattern.exec(content)) !== null) {
    const afterCommand = content.slice(match.index + match[0].length);
    if (afterCommand.startsWith("{")) {
      let depth = 0;
      let found = false;
      for (let i = 0; i < afterCommand.length; i++) {
        if (afterCommand[i] === "{") depth++;
        if (afterCommand[i] === "}") {
          depth--;
          if (depth === 0) {
            found = true;
            break;
          }
        }
      }
      if (!found && depth > 0) {
        violations.push({
          rule: "latex-common",
          message: `Unclosed braces after command ${match[0]}`,
          severity: "warning",
          recoverable: true
        });
      }
    }
  }
  return violations;
}
function latexRule() {
  return {
    name: "latex-environments",
    description: "Validates LaTeX environment balance and structure",
    streaming: true,
    severity: "error",
    recoverable: true,
    check: (context) => {
      const violations = [];
      if (!looksLikeLatex(context.content) && context.content.length > 50) {
        return violations;
      }
      violations.push(...validateLatexEnvironments(context));
      violations.push(...validateLatexMath(context));
      if (context.completed) {
        violations.push(...validateLatexCommon(context));
      }
      return violations;
    }
  };
}

// src/guardrails/patterns.ts
var BAD_PATTERNS = {
  // Meta commentary patterns
  META_COMMENTARY: [
    /as an ai language model/i,
    /as an ai assistant/i,
    /i'm an ai/i,
    /i am an ai/i,
    /i don't have personal/i,
    /i cannot actually/i,
    /i apologize, but i/i,
    /i'm sorry, but i/i
  ],
  // Hedging patterns (excessive)
  EXCESSIVE_HEDGING: [
    /^sure!?\s*$/im,
    /^certainly!?\s*$/im,
    /^of course!?\s*$/im,
    /^absolutely!?\s*$/im
  ],
  // Refusal patterns
  REFUSAL: [
    /i cannot provide/i,
    /i'm not able to/i,
    /i can't assist with/i,
    /i'm unable to/i,
    /that would be inappropriate/i
  ],
  // Instruction leakage
  INSTRUCTION_LEAK: [
    /\[system\]/i,
    /\[user\]/i,
    /\[assistant\]/i,
    /<\|im_start\|>/i,
    /<\|im_end\|>/i,
    /###\s*instruction/i,
    /###\s*system/i
  ],
  // Placeholder patterns
  PLACEHOLDERS: [
    /\[insert .+?\]/i,
    /\[todo:?\]/i,
    /\[placeholder\]/i,
    /\[your .+? here\]/i,
    /\{\{.+?\}\}/
  ],
  // Format collapse (mixing instruction with output)
  FORMAT_COLLAPSE: [
    /here is the .+?:/i,
    /here's the .+?:/i,
    /let me .+? for you/i,
    /i'll .+? for you/i
  ]
};
function findBadPatterns(content, patterns) {
  const matches = [];
  for (const pattern of patterns) {
    const match = content.match(pattern);
    if (match) {
      matches.push({
        pattern,
        match: match[0],
        index: match.index ?? 0
      });
    }
  }
  return matches;
}
function detectMetaCommentary(context) {
  const { content } = context;
  const violations = [];
  const matches = findBadPatterns(content, BAD_PATTERNS.META_COMMENTARY);
  for (const match of matches) {
    violations.push({
      rule: "pattern-meta-commentary",
      message: `Meta commentary detected: "${match.match}"`,
      severity: "error",
      position: match.index,
      recoverable: true,
      suggestion: "Retry generation without meta commentary"
    });
  }
  return violations;
}
function detectExcessiveHedging(context) {
  const { content } = context;
  const violations = [];
  const firstLine = content.trim().split("\n")[0] ?? "";
  const matches = findBadPatterns(firstLine, BAD_PATTERNS.EXCESSIVE_HEDGING);
  if (matches.length > 0 && matches[0]) {
    violations.push({
      rule: "pattern-hedging",
      message: `Excessive hedging at start: "${matches[0].match}"`,
      severity: "warning",
      position: matches[0].index,
      recoverable: true,
      suggestion: "Content should start directly without hedging"
    });
  }
  return violations;
}
function detectRefusal(context) {
  const { content } = context;
  const violations = [];
  const matches = findBadPatterns(content, BAD_PATTERNS.REFUSAL);
  for (const match of matches) {
    violations.push({
      rule: "pattern-refusal",
      message: `Refusal pattern detected: "${match.match}"`,
      severity: "error",
      position: match.index,
      recoverable: false,
      suggestion: "Model refused to complete the task"
    });
  }
  return violations;
}
function detectInstructionLeakage(context) {
  const { content } = context;
  const violations = [];
  const matches = findBadPatterns(content, BAD_PATTERNS.INSTRUCTION_LEAK);
  for (const match of matches) {
    violations.push({
      rule: "pattern-instruction-leak",
      message: `Instruction leakage detected: "${match.match}"`,
      severity: "error",
      position: match.index,
      recoverable: true,
      suggestion: "Retry generation without system tokens"
    });
  }
  return violations;
}
function detectPlaceholders(context) {
  const { content, completed } = context;
  const violations = [];
  if (!completed) {
    return violations;
  }
  const matches = findBadPatterns(content, BAD_PATTERNS.PLACEHOLDERS);
  for (const match of matches) {
    violations.push({
      rule: "pattern-placeholders",
      message: `Placeholder detected: "${match.match}"`,
      severity: "error",
      position: match.index,
      recoverable: true,
      suggestion: "Output contains incomplete placeholders"
    });
  }
  return violations;
}
function detectFormatCollapse(context) {
  const { content } = context;
  const violations = [];
  const firstLines = content.split("\n").slice(0, 3).join("\n");
  const matches = findBadPatterns(firstLines, BAD_PATTERNS.FORMAT_COLLAPSE);
  if (matches.length > 0 && matches[0]) {
    violations.push({
      rule: "pattern-format-collapse",
      message: `Format collapse detected: "${matches[0].match}"`,
      severity: "warning",
      position: matches[0].index,
      recoverable: true,
      suggestion: "Output should not mix meta-instructions with content"
    });
  }
  return violations;
}
function detectRepetition(context, threshold = 2) {
  const { content, completed } = context;
  const violations = [];
  if (!completed) {
    return violations;
  }
  const sentences = content.split(/[.!?]+/).map((s) => s.trim().toLowerCase()).filter((s) => s.length > 20);
  const counts = /* @__PURE__ */ new Map();
  for (const sentence of sentences) {
    counts.set(sentence, (counts.get(sentence) || 0) + 1);
  }
  for (const [sentence, count] of counts.entries()) {
    if (count > threshold) {
      violations.push({
        rule: "pattern-repetition",
        message: `Sentence repeated ${count} times: "${sentence.slice(0, 50)}..."`,
        severity: "error",
        recoverable: true,
        suggestion: "Content contains repeated sentences"
      });
    }
  }
  return violations;
}
function detectFirstLastDuplicate(context) {
  const { content, completed } = context;
  const violations = [];
  if (!completed || content.length < 100) {
    return violations;
  }
  const sentences = content.split(/[.!?]+/).map((s) => s.trim()).filter((s) => s.length > 10);
  if (sentences.length < 2) {
    return violations;
  }
  const first = sentences[0].toLowerCase();
  const last = sentences[sentences.length - 1].toLowerCase();
  if (first === last) {
    violations.push({
      rule: "pattern-first-last-duplicate",
      message: "First and last sentences are identical",
      severity: "error",
      recoverable: true,
      suggestion: "Retry generation - possible loop detected"
    });
  }
  return violations;
}
function patternRule(_config) {
  return {
    name: "pattern-detection",
    description: "Detects known bad patterns in model output",
    streaming: false,
    severity: "error",
    recoverable: true,
    check: (context) => {
      const violations = [];
      violations.push(...detectMetaCommentary(context));
      violations.push(...detectExcessiveHedging(context));
      violations.push(...detectRefusal(context));
      violations.push(...detectInstructionLeakage(context));
      violations.push(...detectPlaceholders(context));
      violations.push(...detectFormatCollapse(context));
      violations.push(...detectRepetition(context));
      violations.push(...detectFirstLastDuplicate(context));
      return violations;
    }
  };
}

// src/guardrails/zeroOutput.ts
var PUNCTUATION_ONLY = /^[^\w\s]+$/;
var REPEATED_CHARS = /^(.)\1+$/;
var ALPHANUMERIC = /[a-zA-Z0-9]/;
function isZeroOutput(content) {
  if (!content || content.length === 0) {
    return true;
  }
  return !hasMeaningfulContent(content);
}
function isNoiseOnly(content) {
  if (!content || content.length === 0) {
    return true;
  }
  const trimmed = content.trim();
  if (PUNCTUATION_ONLY.test(trimmed)) {
    return true;
  }
  if (REPEATED_CHARS.test(trimmed)) {
    return true;
  }
  if (trimmed.length < 3 && !ALPHANUMERIC.test(trimmed)) {
    return true;
  }
  return false;
}
function validateZeroOutput(context) {
  const { content, completed, tokenCount } = context;
  const violations = [];
  if (!completed && tokenCount < 5) {
    return violations;
  }
  if (isZeroOutput(content)) {
    violations.push({
      rule: "zero-output",
      message: "No meaningful output generated (empty or whitespace only)",
      severity: "error",
      recoverable: false,
      // This is a transport/network issue
      suggestion: "Retry - likely network or model initialization issue"
    });
    return violations;
  }
  if (isNoiseOnly(content)) {
    violations.push({
      rule: "zero-output",
      message: "Output contains only noise or filler characters",
      severity: "error",
      recoverable: false,
      suggestion: "Retry - output is not meaningful"
    });
    return violations;
  }
  if (completed && content.trim().length < 10) {
    violations.push({
      rule: "zero-output",
      message: `Output too short: ${content.trim().length} characters`,
      severity: "warning",
      recoverable: false,
      suggestion: "Retry - output may be truncated"
    });
  }
  return violations;
}
function validateInstantOutput(context) {
  const { completed, tokenCount, metadata } = context;
  const violations = [];
  if (!completed) {
    return violations;
  }
  const startTime = metadata?.startTime;
  const endTime = metadata?.endTime;
  if (startTime && endTime) {
    const duration = endTime - startTime;
    if (duration < 100 && tokenCount < 5) {
      violations.push({
        rule: "zero-output",
        message: `Stream completed instantly (${duration}ms) with minimal output`,
        severity: "error",
        recoverable: false,
        suggestion: "Retry - possible network or transport failure"
      });
    }
  }
  return violations;
}
function zeroOutputRule() {
  return {
    name: "zero-output",
    description: "Detects zero or meaningless output",
    streaming: true,
    severity: "error",
    recoverable: false,
    // Zero output is a transport issue, not model issue
    check: (context) => {
      const violations = [];
      violations.push(...validateZeroOutput(context));
      violations.push(...validateInstantOutput(context));
      return violations;
    }
  };
}

// src/guardrails/index.ts
var minimalGuardrails = [
  jsonRule(),
  zeroOutputRule()
];
var recommendedGuardrails = [
  jsonRule(),
  markdownRule(),
  zeroOutputRule(),
  patternRule()
];
var strictGuardrails = [
  jsonRule(),
  markdownRule(),
  latexRule(),
  patternRule(),
  zeroOutputRule()
];
var jsonOnlyGuardrails = [
  jsonRule(),
  zeroOutputRule()
];
var markdownOnlyGuardrails = [
  markdownRule(),
  zeroOutputRule()
];
var latexOnlyGuardrails = [
  latexRule(),
  zeroOutputRule()
];

// src/types/l0.ts
var minimalRetry = {
  attempts: 2,
  maxRetries: 4,
  backoff: "linear",
  baseDelay: RETRY_DEFAULTS.baseDelay,
  maxDelay: RETRY_DEFAULTS.maxDelay,
  retryOn: [...RETRY_DEFAULTS.retryOn]
};
var recommendedRetry = {
  attempts: RETRY_DEFAULTS.attempts,
  maxRetries: RETRY_DEFAULTS.maxRetries,
  backoff: RETRY_DEFAULTS.backoff,
  baseDelay: RETRY_DEFAULTS.baseDelay,
  maxDelay: RETRY_DEFAULTS.maxDelay,
  retryOn: [...RETRY_DEFAULTS.retryOn]
};
var strictRetry = {
  attempts: RETRY_DEFAULTS.attempts,
  maxRetries: RETRY_DEFAULTS.maxRetries,
  backoff: "full-jitter",
  baseDelay: RETRY_DEFAULTS.baseDelay,
  maxDelay: RETRY_DEFAULTS.maxDelay,
  retryOn: [...RETRY_DEFAULTS.retryOn]
};
var exponentialRetry = {
  attempts: 4,
  maxRetries: 8,
  backoff: "exponential",
  baseDelay: RETRY_DEFAULTS.baseDelay,
  maxDelay: RETRY_DEFAULTS.maxDelay,
  retryOn: [...RETRY_DEFAULTS.retryOn]
};
export {
  ErrorCategory,
  GuardrailEngine,
  L0Error,
  Metrics,
  NetworkErrorType,
  RETRY_DEFAULTS,
  RetryManager,
  RuntimeStates,
  StateMachine,
  analyzeNetworkError,
  checkGuardrails,
  consumeStream,
  createCompleteEvent,
  createErrorEvent,
  createGuardrailEngine,
  createRetryManager,
  createTokenEvent,
  exponentialRetry,
  getErrorCategory2 as getErrorCategory,
  getText,
  isL0Error,
  isNetworkError,
  isRetryableError,
  jsonOnlyGuardrails,
  jsonRule,
  l0,
  markdownRule,
  minimalGuardrails,
  minimalRetry,
  normalizeStreamEvent,
  recommendedGuardrails,
  recommendedRetry,
  sleep,
  strictGuardrails,
  strictJsonRule,
  strictRetry,
  withTimeout,
  zeroOutputRule
};
