var __defProp = Object.defineProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};

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
var Timer = class {
  startTime;
  endTime;
  pauseTime;
  totalPausedTime = 0;
  /**
   * Start the timer
   */
  start() {
    this.startTime = Date.now();
    this.endTime = void 0;
    this.pauseTime = void 0;
    this.totalPausedTime = 0;
  }
  /**
   * Pause the timer
   */
  pause() {
    if (!this.startTime || this.pauseTime) return;
    this.pauseTime = Date.now();
  }
  /**
   * Resume the timer
   */
  resume() {
    if (!this.pauseTime) return;
    this.totalPausedTime += Date.now() - this.pauseTime;
    this.pauseTime = void 0;
  }
  /**
   * Stop the timer
   */
  stop() {
    if (!this.startTime) return;
    if (this.pauseTime) {
      this.resume();
    }
    this.endTime = Date.now();
  }
  /**
   * Get elapsed time in milliseconds
   */
  elapsed() {
    if (!this.startTime) return 0;
    const end = this.endTime ?? Date.now();
    const paused = this.pauseTime ? this.totalPausedTime + (Date.now() - this.pauseTime) : this.totalPausedTime;
    return end - this.startTime - paused;
  }
  /**
   * Reset the timer
   */
  reset() {
    this.startTime = void 0;
    this.endTime = void 0;
    this.pauseTime = void 0;
    this.totalPausedTime = 0;
  }
  /**
   * Check if timer is running
   */
  isRunning() {
    return !!this.startTime && !this.endTime && !this.pauseTime;
  }
  /**
   * Check if timer is paused
   */
  isPaused() {
    return !!this.pauseTime;
  }
};

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
function describeNetworkError(error) {
  const analysis = analyzeNetworkError(error);
  let description = `Network error: ${analysis.type}`;
  if (analysis.context?.possibleCause) {
    description += ` (${analysis.context.possibleCause})`;
  }
  return description;
}
function isStreamInterrupted(error, tokenCount) {
  if (tokenCount > 0 && isNetworkError(error)) {
    return true;
  }
  const message = error.message.toLowerCase();
  return message.includes("stream interrupted") || message.includes("stream closed unexpectedly") || message.includes("connection lost mid-stream") || isPartialChunks(error) && tokenCount > 0;
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
function isMeaningfulToken(token) {
  if (!token || token.length === 0) {
    return false;
  }
  const trimmed = token.trim();
  if (trimmed.length === 0) {
    return false;
  }
  if (/^[\r\n\t\s]+$/.test(token)) {
    return false;
  }
  return true;
}
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
function countMeaningfulTokens(content) {
  if (!content || !hasMeaningfulContent(content)) {
    return 0;
  }
  const trimmed = content.trim();
  const tokens = trimmed.split(/\s+/).filter((t) => t.length > 0);
  return tokens.length;
}
function extractMeaningfulTokens(content) {
  if (!content || !hasMeaningfulContent(content)) {
    return [];
  }
  const trimmed = content.trim();
  return trimmed.split(/\s+/).filter((t) => t.length > 0);
}
function normalizeToken(token) {
  return token.trim().toLowerCase();
}
function detectRepeatedTokens(content, threshold = 3) {
  if (!content || !hasMeaningfulContent(content)) {
    return [];
  }
  const tokens = extractMeaningfulTokens(content);
  const repeated = [];
  const counts = /* @__PURE__ */ new Map();
  for (const token of tokens) {
    const normalized = normalizeToken(token);
    const count = (counts.get(normalized) || 0) + 1;
    counts.set(normalized, count);
    if (count === threshold) {
      repeated.push(token);
    }
  }
  return repeated;
}
function endsAbruptly(content) {
  if (!content || !hasMeaningfulContent(content)) {
    return false;
  }
  const trimmed = content.trim();
  const endsWithPunctuation = /[.!?;:]$/.test(trimmed);
  const endsWithClosure = /[)\]}]$/.test(trimmed);
  return !endsWithPunctuation && !endsWithClosure;
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
    normalizeWhitespace: normalizeWhitespace2 = false
  } = options;
  let checkpointForMatch = checkpoint;
  let continuationForMatch = continuation;
  if (!caseSensitive) {
    checkpointForMatch = checkpoint.toLowerCase();
    continuationForMatch = continuation.toLowerCase();
  }
  if (normalizeWhitespace2) {
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
      if (normalizeWhitespace2) {
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
function deduplicateContinuation(checkpoint, continuation, options = {}) {
  return detectOverlap(checkpoint, continuation, options).deduplicatedContinuation;
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
function detectZeroTokenBeforeFirstMeaningful(content, tokenCount) {
  if (tokenCount === 0) {
    return true;
  }
  if (tokenCount > 0 && !hasMeaningfulContent(content)) {
    return true;
  }
  if (tokenCount > 10 && content.trim().length < 5) {
    return true;
  }
  return false;
}
function detectInstantFinish(startTime, endTime, tokenCount) {
  const duration = endTime - startTime;
  if (duration < 100 && tokenCount < 5) {
    return true;
  }
  if (duration < 50) {
    return true;
  }
  return false;
}
function analyzeZeroToken(content, tokenCount, startTime, endTime) {
  if (detectZeroToken(content)) {
    if (tokenCount === 0) {
      return {
        isZeroToken: true,
        reason: "No tokens received - likely network or transport failure",
        category: "network"
      };
    }
    if (tokenCount > 0 && content.trim().length === 0) {
      return {
        isZeroToken: true,
        reason: "Tokens received but no content - possible encoding issue",
        category: "encoding"
      };
    }
    return {
      isZeroToken: true,
      reason: "Only whitespace or noise characters received",
      category: "transport"
    };
  }
  if (startTime && endTime) {
    if (detectInstantFinish(startTime, endTime, tokenCount)) {
      return {
        isZeroToken: true,
        reason: "Stream completed suspiciously fast - possible transport failure",
        category: "transport"
      };
    }
  }
  return {
    isZeroToken: false,
    reason: "Valid output detected",
    category: "none"
  };
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
function createMessageEvent(value, role) {
  return {
    type: "message",
    value,
    role,
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
function normalizeStreamEvents(chunks) {
  return chunks.map((chunk) => normalizeStreamEvent(chunk));
}
function filterEventsByType(events, type) {
  return events.filter((event) => event.type === type);
}
function extractTokens(events) {
  return events.filter((event) => event.type === "token" && event.value).map((event) => event.value);
}
function reconstructText(events) {
  return extractTokens(events).join("");
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
function enableDriftDetection(factory) {
  _driftDetectorFactory = factory;
}
function enableMonitoring(factory) {
  _monitorFactory = factory;
}
function enableInterceptors(factory) {
  _interceptorManagerFactory = factory;
}
function enableAdapterRegistry(registry) {
  _adapterRegistry = registry;
}
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

// src/runtime/drift.ts
var DriftDetector = class {
  config;
  history;
  constructor(config = {}) {
    this.config = {
      detectToneShift: config.detectToneShift ?? true,
      detectMetaCommentary: config.detectMetaCommentary ?? true,
      detectRepetition: config.detectRepetition ?? true,
      detectEntropySpike: config.detectEntropySpike ?? true,
      repetitionThreshold: config.repetitionThreshold ?? 3,
      entropyThreshold: config.entropyThreshold ?? 2.5,
      entropyWindow: config.entropyWindow ?? 50
    };
    this.history = {
      entropy: [],
      tokens: [],
      lastContent: ""
    };
  }
  /**
   * Check content for drift
   * @param content - Current content
   * @param delta - Latest token/delta (optional)
   * @returns Drift detection result
   */
  check(content, delta) {
    const types = [];
    let confidence = 0;
    const details = [];
    if (delta) {
      this.history.tokens.push(delta);
      if (this.history.tokens.length > this.config.entropyWindow) {
        this.history.tokens.shift();
      }
    }
    if (this.config.detectMetaCommentary) {
      const meta = this.detectMetaCommentary(content);
      if (meta) {
        types.push("meta_commentary");
        confidence = Math.max(confidence, 0.9);
        details.push("Meta commentary detected");
      }
    }
    if (this.config.detectToneShift) {
      const tone = this.detectToneShift(content, this.history.lastContent);
      if (tone) {
        types.push("tone_shift");
        confidence = Math.max(confidence, 0.7);
        details.push("Tone shift detected");
      }
    }
    if (this.config.detectRepetition) {
      const rep = this.detectRepetition(content);
      if (rep) {
        types.push("repetition");
        confidence = Math.max(confidence, 0.8);
        details.push("Excessive repetition detected");
      }
    }
    if (this.config.detectEntropySpike && delta) {
      const entropy = this.calculateEntropy(delta);
      this.history.entropy.push(entropy);
      if (this.history.entropy.length > this.config.entropyWindow) {
        this.history.entropy.shift();
      }
      if (this.detectEntropySpike()) {
        types.push("entropy_spike");
        confidence = Math.max(confidence, 0.6);
        details.push("Entropy spike detected");
      }
    }
    if (this.detectFormatCollapse(content)) {
      types.push("format_collapse");
      confidence = Math.max(confidence, 0.8);
      details.push("Format collapse detected");
    }
    if (this.detectMarkdownCollapse(content, this.history.lastContent)) {
      types.push("markdown_collapse");
      confidence = Math.max(confidence, 0.7);
      details.push("Markdown formatting collapse detected");
    }
    if (this.detectExcessiveHedging(content)) {
      types.push("hedging");
      confidence = Math.max(confidence, 0.5);
      details.push("Excessive hedging detected");
    }
    this.history.lastContent = content;
    return {
      detected: types.length > 0,
      confidence,
      types,
      details: details.join("; ")
    };
  }
  /**
   * Detect meta commentary patterns
   */
  detectMetaCommentary(content) {
    const metaPatterns = [
      /as an ai/i,
      /i'm an ai/i,
      /i am an ai/i,
      /i cannot actually/i,
      /i don't have personal/i,
      /i apologize, but i/i,
      /i'm sorry, but i/i,
      /let me explain/i,
      /to clarify/i,
      /in other words/i
    ];
    const recent = content.slice(-200);
    return metaPatterns.some((pattern) => pattern.test(recent));
  }
  /**
   * Detect tone shift between old and new content
   */
  detectToneShift(content, previousContent) {
    if (!previousContent || previousContent.length < 100) {
      return false;
    }
    const recentChunk = content.slice(-200);
    const previousChunk = previousContent.slice(-200);
    const formalMarkers = /\b(therefore|thus|hence|moreover|furthermore|consequently)\b/gi;
    const recentFormal = (recentChunk.match(formalMarkers) || []).length;
    const previousFormal = (previousChunk.match(formalMarkers) || []).length;
    const informalMarkers = /\b(gonna|wanna|yeah|yep|nope|ok|okay)\b/gi;
    const recentInformal = (recentChunk.match(informalMarkers) || []).length;
    const previousInformal = (previousChunk.match(informalMarkers) || []).length;
    const formalShift = Math.abs(recentFormal - previousFormal) > 2;
    const informalShift = Math.abs(recentInformal - previousInformal) > 2;
    return formalShift || informalShift;
  }
  /**
   * Detect excessive repetition
   */
  detectRepetition(content) {
    const sentences = content.split(/[.!?]+/).map((s) => s.trim().toLowerCase()).filter((s) => s.length > 20);
    if (sentences.length < 3) {
      return false;
    }
    const counts = /* @__PURE__ */ new Map();
    for (const sentence of sentences) {
      counts.set(sentence, (counts.get(sentence) || 0) + 1);
    }
    for (const count of counts.values()) {
      if (count >= this.config.repetitionThreshold) {
        return true;
      }
    }
    const words = content.toLowerCase().split(/\s+/);
    const phrases = /* @__PURE__ */ new Map();
    for (let i = 0; i < words.length - 5; i++) {
      const phrase = words.slice(i, i + 5).join(" ");
      phrases.set(phrase, (phrases.get(phrase) || 0) + 1);
    }
    for (const count of phrases.values()) {
      if (count >= this.config.repetitionThreshold) {
        return true;
      }
    }
    return false;
  }
  /**
   * Calculate Shannon entropy of text
   */
  calculateEntropy(text) {
    if (!text || text.length === 0) {
      return 0;
    }
    const frequencies = /* @__PURE__ */ new Map();
    for (const char of text) {
      frequencies.set(char, (frequencies.get(char) || 0) + 1);
    }
    let entropy = 0;
    const length = text.length;
    for (const count of frequencies.values()) {
      const probability = count / length;
      entropy -= probability * Math.log2(probability);
    }
    return entropy;
  }
  /**
   * Detect entropy spike
   */
  detectEntropySpike() {
    if (this.history.entropy.length < 10) {
      return false;
    }
    const mean = this.history.entropy.reduce((a, b) => a + b, 0) / this.history.entropy.length;
    const variance = this.history.entropy.reduce(
      (acc, val) => acc + Math.pow(val - mean, 2),
      0
    ) / this.history.entropy.length;
    const stdDev = Math.sqrt(variance);
    const last = this.history.entropy[this.history.entropy.length - 1] ?? 0;
    return last > mean + this.config.entropyThreshold * stdDev;
  }
  /**
   * Detect format collapse (mixing instruction with output)
   */
  detectFormatCollapse(content) {
    const collapsePatterns = [
      /here is the .+?:/i,
      /here's the .+?:/i,
      /let me .+? for you/i,
      /i'll .+? for you/i,
      /here you go/i
    ];
    const beginning = content.slice(0, 100);
    return collapsePatterns.some((pattern) => pattern.test(beginning));
  }
  /**
   * Detect markdown to plaintext collapse
   */
  detectMarkdownCollapse(content, previousContent) {
    if (!previousContent || previousContent.length < 100) {
      return false;
    }
    const markdownPatterns = [
      /```/g,
      /^#{1,6}\s/gm,
      /\*\*.*?\*\*/g,
      /\[.*?\]\(.*?\)/g
    ];
    const recent = content.slice(-200);
    const previous = previousContent.slice(-200);
    let recentMarkdown = 0;
    let previousMarkdown = 0;
    for (const pattern of markdownPatterns) {
      recentMarkdown += (recent.match(pattern) || []).length;
      previousMarkdown += (previous.match(pattern) || []).length;
    }
    return previousMarkdown > 3 && recentMarkdown === 0;
  }
  /**
   * Detect excessive hedging at start
   */
  detectExcessiveHedging(content) {
    const hedgingPatterns = [
      /^sure!?\s*$/im,
      /^certainly!?\s*$/im,
      /^of course!?\s*$/im,
      /^absolutely!?\s*$/im
    ];
    const firstLine = content.trim().split("\n")[0] ?? "";
    return hedgingPatterns.some((pattern) => pattern.test(firstLine));
  }
  /**
   * Reset detector state
   */
  reset() {
    this.history = {
      entropy: [],
      tokens: [],
      lastContent: ""
    };
  }
  /**
   * Get detection history
   */
  getHistory() {
    return { ...this.history };
  }
};
function createDriftDetector(config) {
  return new DriftDetector(config);
}
function checkDrift(content) {
  const detector = new DriftDetector();
  return detector.check(content);
}

// src/runtime/monitoring.ts
var L0Monitor = class {
  config;
  telemetry;
  tokenTimestamps = [];
  constructor(config = {}) {
    this.config = {
      enabled: config.enabled ?? false,
      sampleRate: config.sampleRate ?? 1,
      includeNetworkDetails: config.includeNetworkDetails ?? true,
      includeTimings: config.includeTimings ?? true,
      metadata: config.metadata
    };
    this.telemetry = this.createInitialTelemetry();
  }
  /**
   * Check if monitoring is enabled and should sample this execution
   */
  isEnabled() {
    if (!this.config.enabled) return false;
    return Math.random() < this.config.sampleRate;
  }
  /**
   * Create initial telemetry structure
   */
  createInitialTelemetry() {
    return {
      sessionId: this.generateSessionId(),
      startTime: Date.now(),
      metrics: {
        totalTokens: 0,
        totalRetries: 0,
        networkRetryCount: 0,
        modelRetryCount: 0
      },
      network: {
        errorCount: 0,
        errorsByType: {},
        errors: this.config.includeNetworkDetails ? [] : void 0
      },
      metadata: this.config.metadata
    };
  }
  /**
   * Generate unique session ID
   */
  generateSessionId() {
    return `l0_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
  /**
   * Record stream start
   */
  start() {
    if (!this.isEnabled()) return;
    this.telemetry.startTime = Date.now();
  }
  /**
   * Record stream completion
   */
  complete() {
    if (!this.isEnabled()) return;
    this.telemetry.endTime = Date.now();
    this.telemetry.duration = this.telemetry.endTime - this.telemetry.startTime;
    if (this.config.includeTimings && this.tokenTimestamps.length > 0) {
      this.calculateTimingMetrics();
    }
  }
  /**
   * Record a token received
   */
  recordToken(timestamp) {
    if (!this.isEnabled()) return;
    const ts = timestamp ?? Date.now();
    this.telemetry.metrics.totalTokens++;
    if (this.config.includeTimings) {
      this.tokenTimestamps.push(ts);
      if (this.telemetry.metrics.totalTokens === 1) {
        this.telemetry.metrics.timeToFirstToken = ts - this.telemetry.startTime;
      }
    }
  }
  /**
   * Record a network error
   */
  recordNetworkError(error, retried, delay) {
    if (!this.isEnabled()) return;
    const analysis = analyzeNetworkError(error);
    const errorType = analysis.type;
    this.telemetry.network.errorCount++;
    this.telemetry.network.errorsByType[errorType] = (this.telemetry.network.errorsByType[errorType] || 0) + 1;
    if (this.config.includeNetworkDetails && this.telemetry.network.errors) {
      this.telemetry.network.errors.push({
        type: errorType,
        message: error.message,
        timestamp: Date.now(),
        retried,
        delay
      });
    }
  }
  /**
   * Record a retry attempt
   */
  recordRetry(isNetworkError2) {
    if (!this.isEnabled()) return;
    this.telemetry.metrics.totalRetries++;
    if (isNetworkError2) {
      this.telemetry.metrics.networkRetryCount++;
    } else {
      this.telemetry.metrics.modelRetryCount++;
    }
  }
  /**
   * Record guardrail violations
   */
  recordGuardrailViolations(violations) {
    if (!this.isEnabled()) return;
    if (!this.telemetry.guardrails) {
      this.telemetry.guardrails = {
        violationCount: 0,
        violationsByRule: {},
        violationsByRuleAndSeverity: {},
        violationsBySeverity: {
          warning: 0,
          error: 0,
          fatal: 0
        }
      };
    }
    for (const violation of violations) {
      this.telemetry.guardrails.violationCount++;
      this.telemetry.guardrails.violationsByRule[violation.rule] = (this.telemetry.guardrails.violationsByRule[violation.rule] || 0) + 1;
      if (!this.telemetry.guardrails.violationsByRuleAndSeverity[violation.rule]) {
        this.telemetry.guardrails.violationsByRuleAndSeverity[violation.rule] = {
          warning: 0,
          error: 0,
          fatal: 0
        };
      }
      const ruleSeverity = this.telemetry.guardrails.violationsByRuleAndSeverity[violation.rule];
      if (ruleSeverity) {
        ruleSeverity[violation.severity]++;
      }
      this.telemetry.guardrails.violationsBySeverity[violation.severity]++;
    }
  }
  /**
   * Record drift detection
   */
  recordDrift(detected, types) {
    if (!this.isEnabled()) return;
    this.telemetry.drift = {
      detected,
      types
    };
  }
  /**
   * Record continuation from checkpoint
   */
  recordContinuation(enabled, used, checkpointContent) {
    if (!this.isEnabled()) return;
    if (!this.telemetry.continuation) {
      this.telemetry.continuation = {
        enabled,
        used: false,
        continuationCount: 0
      };
    }
    this.telemetry.continuation.enabled = enabled;
    if (used) {
      this.telemetry.continuation.used = true;
      this.telemetry.continuation.continuationCount = (this.telemetry.continuation.continuationCount || 0) + 1;
      if (checkpointContent) {
        this.telemetry.continuation.checkpointContent = checkpointContent;
        this.telemetry.continuation.checkpointLength = checkpointContent.length;
      } else {
        this.telemetry.continuation.checkpointContent = void 0;
        this.telemetry.continuation.checkpointLength = void 0;
      }
    }
  }
  /**
   * Log custom event (e.g., fallback, custom interceptor events)
   */
  logEvent(event) {
    if (!this.isEnabled()) return;
    if (!this.telemetry.metadata) {
      this.telemetry.metadata = {};
    }
    if (!this.telemetry.metadata.customEvents) {
      this.telemetry.metadata.customEvents = [];
    }
    this.telemetry.metadata.customEvents.push({
      ...event,
      timestamp: Date.now()
    });
  }
  /**
   * Calculate timing metrics
   */
  calculateTimingMetrics() {
    if (this.tokenTimestamps.length < 2) return;
    const interTokenTimes = [];
    for (let i = 1; i < this.tokenTimestamps.length; i++) {
      interTokenTimes.push(
        this.tokenTimestamps[i] - this.tokenTimestamps[i - 1]
      );
    }
    if (interTokenTimes.length > 0) {
      const sum = interTokenTimes.reduce((a, b) => a + b, 0);
      this.telemetry.metrics.avgInterTokenTime = sum / interTokenTimes.length;
    }
    if (this.telemetry.duration && this.telemetry.duration > 0) {
      this.telemetry.metrics.tokensPerSecond = this.telemetry.metrics.totalTokens / this.telemetry.duration * 1e3;
    }
  }
  /**
   * Get current telemetry data
   * Returns the live telemetry object (not a copy) so updates are reflected
   */
  getTelemetry() {
    if (!this.isEnabled()) return void 0;
    return this.telemetry;
  }
  /**
   * Get telemetry summary as JSON
   */
  toJSON() {
    if (!this.isEnabled()) return "{}";
    return JSON.stringify(this.telemetry, null, 2);
  }
  /**
   * Export telemetry for external logging
   */
  export() {
    return this.getTelemetry();
  }
  /**
   * Get summary statistics
   */
  getSummary() {
    if (!this.isEnabled()) return void 0;
    return {
      sessionId: this.telemetry.sessionId,
      duration: this.telemetry.duration ?? 0,
      tokens: this.telemetry.metrics.totalTokens,
      tokensPerSecond: this.telemetry.metrics.tokensPerSecond ?? 0,
      retries: this.telemetry.metrics.totalRetries,
      networkErrors: this.telemetry.network.errorCount,
      violations: this.telemetry.guardrails?.violationCount ?? 0
    };
  }
  /**
   * Get network error breakdown
   */
  getNetworkErrorBreakdown() {
    if (!this.isEnabled()) return {};
    return { ...this.telemetry.network.errorsByType };
  }
  /**
   * Check if any network errors occurred
   */
  hasNetworkErrors() {
    if (!this.isEnabled()) return false;
    return this.telemetry.network.errorCount > 0;
  }
  /**
   * Check if any guardrail violations occurred
   */
  hasViolations() {
    if (!this.isEnabled()) return false;
    return (this.telemetry.guardrails?.violationCount ?? 0) > 0;
  }
  /**
   * Get most common network error type
   */
  getMostCommonNetworkError() {
    if (!this.isEnabled() || this.telemetry.network.errorCount === 0) {
      return null;
    }
    let maxCount = 0;
    let mostCommon = null;
    for (const [type, count] of Object.entries(
      this.telemetry.network.errorsByType
    )) {
      if (count > maxCount) {
        maxCount = count;
        mostCommon = type;
      }
    }
    return mostCommon;
  }
  /**
   * Reset telemetry (for new execution)
   */
  reset() {
    this.telemetry = this.createInitialTelemetry();
    this.tokenTimestamps = [];
  }
};
function createMonitor(config) {
  return new L0Monitor(config);
}
var TelemetryExporter = class {
  /**
   * Export to JSON string
   */
  static toJSON(telemetry) {
    return JSON.stringify(telemetry, null, 2);
  }
  /**
   * Export to CSV format (summary)
   */
  static toCSV(telemetry) {
    const lines = [];
    lines.push(
      "sessionId,duration,tokens,tokensPerSecond,retries,networkErrors,violations"
    );
    const duration = telemetry.duration ?? 0;
    const tokens = telemetry.metrics.totalTokens;
    const tokensPerSecond = telemetry.metrics.tokensPerSecond ?? 0;
    const retries = telemetry.metrics.totalRetries;
    const networkErrors = telemetry.network.errorCount;
    const violations = telemetry.guardrails?.violationCount ?? 0;
    lines.push(
      `${telemetry.sessionId},${duration},${tokens},${tokensPerSecond.toFixed(2)},${retries},${networkErrors},${violations}`
    );
    return lines.join("\n");
  }
  /**
   * Export to structured log format
   */
  static toLogFormat(telemetry) {
    return {
      session_id: telemetry.sessionId,
      timestamp: telemetry.startTime,
      duration_ms: telemetry.duration,
      metrics: {
        tokens: telemetry.metrics.totalTokens,
        tokens_per_second: telemetry.metrics.tokensPerSecond,
        time_to_first_token_ms: telemetry.metrics.timeToFirstToken,
        avg_inter_token_time_ms: telemetry.metrics.avgInterTokenTime,
        total_retries: telemetry.metrics.totalRetries,
        network_retries: telemetry.metrics.networkRetryCount,
        model_retries: telemetry.metrics.modelRetryCount
      },
      network: {
        error_count: telemetry.network.errorCount,
        errors_by_type: telemetry.network.errorsByType
      },
      guardrails: telemetry.guardrails ? {
        violation_count: telemetry.guardrails.violationCount,
        violations_by_severity: telemetry.guardrails.violationsBySeverity
      } : null,
      drift: telemetry.drift,
      metadata: telemetry.metadata
    };
  }
  /**
   * Export to metrics format (for time-series databases)
   */
  static toMetrics(telemetry) {
    const metrics = [];
    const timestamp = telemetry.endTime ?? telemetry.startTime;
    const tags = telemetry.metadata ? Object.fromEntries(
      Object.entries(telemetry.metadata).map(([k, v]) => [k, String(v)])
    ) : void 0;
    if (telemetry.duration !== void 0) {
      metrics.push({
        name: "l0.duration",
        value: telemetry.duration,
        timestamp,
        tags
      });
    }
    metrics.push({
      name: "l0.tokens.total",
      value: telemetry.metrics.totalTokens,
      timestamp,
      tags
    });
    if (telemetry.metrics.tokensPerSecond !== void 0) {
      metrics.push({
        name: "l0.tokens.per_second",
        value: telemetry.metrics.tokensPerSecond,
        timestamp,
        tags
      });
    }
    if (telemetry.metrics.timeToFirstToken !== void 0) {
      metrics.push({
        name: "l0.time_to_first_token",
        value: telemetry.metrics.timeToFirstToken,
        timestamp,
        tags
      });
    }
    metrics.push({
      name: "l0.retries.total",
      value: telemetry.metrics.totalRetries,
      timestamp,
      tags
    });
    metrics.push({
      name: "l0.retries.network",
      value: telemetry.metrics.networkRetryCount,
      timestamp,
      tags
    });
    metrics.push({
      name: "l0.retries.model",
      value: telemetry.metrics.modelRetryCount,
      timestamp,
      tags
    });
    metrics.push({
      name: "l0.network.errors",
      value: telemetry.network.errorCount,
      timestamp,
      tags
    });
    if (telemetry.guardrails) {
      metrics.push({
        name: "l0.guardrails.violations",
        value: telemetry.guardrails.violationCount,
        timestamp,
        tags
      });
    }
    return metrics;
  }
};

// src/runtime/interceptors.ts
var InterceptorManager = class {
  interceptors;
  contexts = [];
  constructor(interceptors = []) {
    this.interceptors = interceptors;
  }
  /**
   * Execute all "before" hooks in order
   * Each interceptor can modify the options
   */
  async executeBefore(options) {
    let currentOptions = options;
    for (const interceptor of this.interceptors) {
      if (interceptor.before) {
        const startTime = Date.now();
        const context = {
          name: interceptor.name || "anonymous",
          phase: "before",
          timestamp: startTime
        };
        try {
          currentOptions = await interceptor.before(currentOptions);
          context.duration = Date.now() - startTime;
          this.contexts.push(context);
        } catch (error) {
          context.duration = Date.now() - startTime;
          this.contexts.push(context);
          throw new Error(
            `Interceptor "${context.name}" before hook failed: ${error instanceof Error ? error.message : String(error)}`
          );
        }
      }
    }
    return currentOptions;
  }
  /**
   * Execute all "after" hooks in order
   * Each interceptor can inspect/modify the result
   */
  async executeAfter(result) {
    let currentResult = result;
    for (const interceptor of this.interceptors) {
      if (interceptor.after) {
        const startTime = Date.now();
        const context = {
          name: interceptor.name || "anonymous",
          phase: "after",
          timestamp: startTime
        };
        try {
          currentResult = await interceptor.after(currentResult);
          context.duration = Date.now() - startTime;
          this.contexts.push(context);
        } catch (error) {
          context.duration = Date.now() - startTime;
          this.contexts.push(context);
          throw new Error(
            `Interceptor "${context.name}" after hook failed: ${error instanceof Error ? error.message : String(error)}`
          );
        }
      }
    }
    return currentResult;
  }
  /**
   * Execute all "onError" hooks
   * Error hooks don't modify anything, just notify
   */
  async executeError(error, options) {
    for (const interceptor of this.interceptors) {
      if (interceptor.onError) {
        const startTime = Date.now();
        const context = {
          name: interceptor.name || "anonymous",
          phase: "error",
          timestamp: startTime
        };
        try {
          await interceptor.onError(error, options);
          context.duration = Date.now() - startTime;
          this.contexts.push(context);
        } catch (err) {
          context.duration = Date.now() - startTime;
          this.contexts.push(context);
          console.error(
            `Interceptor "${context.name}" error hook failed:`,
            err
          );
        }
      }
    }
  }
  /**
   * Get execution contexts for debugging
   */
  getContexts() {
    return [...this.contexts];
  }
  /**
   * Reset contexts
   */
  reset() {
    this.contexts = [];
  }
};
function loggingInterceptor(logger = console) {
  return {
    name: "logging",
    before: async (options) => {
      logger.info("L0 execution starting", {
        hasGuardrails: !!options.guardrails?.length,
        hasRetry: !!options.retry,
        hasMonitoring: options.monitoring?.enabled
      });
      return options;
    },
    after: async (result) => {
      logger.info("L0 execution completed", {
        completed: result.state.completed,
        tokens: result.state.tokenCount,
        retries: result.state.modelRetryCount,
        networkRetryCount: result.state.networkRetryCount,
        violations: result.state.violations.length
      });
      return result;
    },
    onError: async (error) => {
      logger.error("L0 execution failed", {
        error: error.message
      });
    }
  };
}
function metadataInterceptor(metadata) {
  return {
    name: "metadata",
    before: async (options) => {
      return {
        ...options,
        monitoring: {
          ...options.monitoring,
          enabled: options.monitoring?.enabled ?? true,
          metadata: {
            ...options.monitoring?.metadata,
            ...metadata
          }
        }
      };
    }
  };
}
function authInterceptor(getAuth) {
  return {
    name: "auth",
    before: async (options) => {
      const auth = await getAuth();
      return {
        ...options,
        monitoring: {
          ...options.monitoring,
          metadata: {
            ...options.monitoring?.metadata,
            auth
          }
        }
      };
    }
  };
}
function timingInterceptor() {
  const startTimes = /* @__PURE__ */ new Map();
  return {
    name: "timing",
    before: async (options) => {
      const sessionId = `session_${Date.now()}`;
      startTimes.set(sessionId, Date.now());
      return {
        ...options,
        monitoring: {
          ...options.monitoring,
          enabled: true,
          includeTimings: true,
          metadata: {
            ...options.monitoring?.metadata,
            sessionId
          }
        }
      };
    },
    after: async (result) => {
      const sessionId = result.telemetry?.sessionId;
      if (sessionId && startTimes.has(sessionId)) {
        startTimes.delete(sessionId);
      }
      return result;
    }
  };
}
function validationInterceptor(validate, onInvalid) {
  return {
    name: "validation",
    after: async (result) => {
      const isValid2 = await validate(result.state.content);
      if (!isValid2) {
        if (onInvalid) {
          onInvalid(result.state.content);
        }
        throw new Error("Output validation failed");
      }
      return result;
    }
  };
}
function rateLimitInterceptor(maxRequests, windowMs) {
  const requests = [];
  return {
    name: "rate-limit",
    before: async (options) => {
      const now = Date.now();
      while (requests.length > 0 && requests[0] < now - windowMs) {
        requests.shift();
      }
      if (requests.length >= maxRequests) {
        const oldestRequest = requests[0] ?? now;
        const waitTime = windowMs - (now - oldestRequest);
        throw new Error(
          `Rate limit exceeded. Wait ${waitTime}ms before retrying.`
        );
      }
      requests.push(now);
      return options;
    }
  };
}
function cachingInterceptor(cache, getCacheKey) {
  return {
    name: "caching",
    before: async (options) => {
      const key = getCacheKey(options);
      if (cache.has(key)) {
        const cached = cache.get(key);
        throw new CachedResultError(cached);
      }
      return options;
    },
    after: async (result) => {
      return result;
    }
  };
}
var CachedResultError = class extends Error {
  constructor(result) {
    super("Cached result available");
    this.result = result;
    this.name = "CachedResultError";
  }
};
function transformInterceptor(transform) {
  return {
    name: "transform",
    after: async (result) => {
      const transformed = await transform(result.state.content);
      return {
        ...result,
        state: {
          ...result.state,
          content: transformed
        }
      };
    }
  };
}
function analyticsInterceptor(track) {
  let startTime;
  return {
    name: "analytics",
    before: async (options) => {
      startTime = Date.now();
      await track("l0_started", {
        timestamp: startTime,
        hasGuardrails: !!options.guardrails?.length
      });
      return options;
    },
    after: async (result) => {
      await track("l0_completed", {
        duration: Date.now() - startTime,
        tokens: result.state.tokenCount,
        retries: result.state.modelRetryCount,
        completed: result.state.completed
      });
      return result;
    },
    onError: async (error) => {
      await track("l0_failed", {
        duration: Date.now() - startTime,
        error: error.message
      });
    }
  };
}
function createInterceptorManager(interceptors = []) {
  return new InterceptorManager(interceptors);
}

// src/adapters/registry.ts
var registeredAdapters = [];
function registerAdapter(adapter, options = {}) {
  if (!adapter.detect) {
    if (!options.silent && typeof process !== "undefined" && process.env?.NODE_ENV !== "production") {
      console.warn(
        `\u26A0\uFE0F  Adapter "${adapter.name}" has no detect() method.
   It will not be used for auto-detection.
   Use explicit \`adapter: myAdapter\` instead, or add a detect() method.`
      );
    }
  }
  if (registeredAdapters.some((a) => a.name === adapter.name)) {
    throw new Error(`Adapter "${adapter.name}" is already registered`);
  }
  registeredAdapters.push(adapter);
}
function unregisterAdapter(name) {
  const index = registeredAdapters.findIndex((a) => a.name === name);
  if (index === -1) return false;
  registeredAdapters.splice(index, 1);
  return true;
}
function getAdapter(name) {
  return registeredAdapters.find((a) => a.name === name);
}
function getRegisteredStreamAdapters() {
  return registeredAdapters.map((a) => a.name);
}
function clearAdapters() {
  registeredAdapters.length = 0;
}
function detectAdapter(input) {
  const detectableAdapters = registeredAdapters.filter((a) => a.detect);
  const matches = detectableAdapters.filter((a) => a.detect(input));
  if (matches.length === 0) {
    const registered = getRegisteredStreamAdapters();
    const detectable = detectableAdapters.map((a) => a.name);
    const adapterList = detectable.length > 0 ? `[${detectable.join(", ")}]` : "(none)";
    const hint = registered.length > detectable.length ? ` (${registered.length - detectable.length} adapter(s) without detect() were skipped)` : "";
    throw new Error(
      `No registered adapter detected for stream. Detectable adapters: ${adapterList}${hint}. Use explicit \`adapter: myAdapter\` or register an adapter with detect().`
    );
  }
  if (matches.length > 1) {
    throw new Error(
      `Multiple adapters detected for stream: [${matches.map((a) => a.name).join(", ")}]. Use explicit \`adapter: myAdapter\` to disambiguate.`
    );
  }
  return matches[0];
}
function hasMatchingAdapter(input) {
  const detectableAdapters = registeredAdapters.filter((a) => a.detect);
  const matches = detectableAdapters.filter((a) => a.detect(input));
  return matches.length === 1;
}

// src/runtime/pipeline.ts
function runStages(stages, event, ctx) {
  let current = event;
  for (const stage of stages) {
    if (current === null) break;
    current = stage(current, ctx);
  }
  return current;
}
function createPipelineContext(state, stateMachine, monitor, signal) {
  return {
    state,
    stateMachine,
    monitor,
    signal,
    scratch: /* @__PURE__ */ new Map()
  };
}

// src/guardrails/async.ts
function runAsyncGuardrailCheck(engine, context, onComplete) {
  if (context.delta && context.delta.length < 1e3) {
    const quickContext = {
      ...context,
      content: context.delta
      // Only check the delta
    };
    const quickResult = engine.check(quickContext);
    if (quickResult.violations.length > 0) {
      return quickResult;
    }
    if (context.content.length < 5e3) {
      return engine.check(context);
    }
  }
  setImmediate(() => {
    try {
      const result = engine.check(context);
      onComplete(result);
    } catch {
      onComplete({ violations: [], shouldHalt: false, shouldRetry: false });
    }
  });
  return void 0;
}
function runGuardrailCheckAsync(engine, context, onComplete) {
  setImmediate(() => {
    try {
      const result = engine.check(context);
      onComplete(result);
    } catch {
      onComplete({ violations: [], shouldHalt: false, shouldRetry: false });
    }
  });
}

// src/runtime/async-drift.ts
function runAsyncDriftCheck(detector, content, delta, onComplete) {
  if (delta && delta.length < 1e3) {
    const quickResult = detector.check(delta);
    if (quickResult.detected) {
      return quickResult;
    }
    if (content.length < 1e4) {
      return detector.check(content, delta);
    }
  }
  if (content.length < 1e4) {
    return detector.check(content, delta);
  }
  setImmediate(() => {
    let result;
    try {
      result = detector.check(content, delta);
    } catch {
      result = { detected: false, types: [] };
    }
    onComplete(result);
  });
  return void 0;
}
function runDriftCheckAsync(detector, content, delta, onComplete) {
  setImmediate(() => {
    let result;
    try {
      result = detector.check(content, delta);
    } catch {
      result = { detected: false, types: [] };
    }
    onComplete(result);
  });
}

// node_modules/zod/v3/external.js
var external_exports = {};
__export(external_exports, {
  BRAND: () => BRAND,
  DIRTY: () => DIRTY,
  EMPTY_PATH: () => EMPTY_PATH,
  INVALID: () => INVALID,
  NEVER: () => NEVER,
  OK: () => OK,
  ParseStatus: () => ParseStatus,
  Schema: () => ZodType,
  ZodAny: () => ZodAny,
  ZodArray: () => ZodArray,
  ZodBigInt: () => ZodBigInt,
  ZodBoolean: () => ZodBoolean,
  ZodBranded: () => ZodBranded,
  ZodCatch: () => ZodCatch,
  ZodDate: () => ZodDate,
  ZodDefault: () => ZodDefault,
  ZodDiscriminatedUnion: () => ZodDiscriminatedUnion,
  ZodEffects: () => ZodEffects,
  ZodEnum: () => ZodEnum,
  ZodError: () => ZodError,
  ZodFirstPartyTypeKind: () => ZodFirstPartyTypeKind,
  ZodFunction: () => ZodFunction,
  ZodIntersection: () => ZodIntersection,
  ZodIssueCode: () => ZodIssueCode,
  ZodLazy: () => ZodLazy,
  ZodLiteral: () => ZodLiteral,
  ZodMap: () => ZodMap,
  ZodNaN: () => ZodNaN,
  ZodNativeEnum: () => ZodNativeEnum,
  ZodNever: () => ZodNever,
  ZodNull: () => ZodNull,
  ZodNullable: () => ZodNullable,
  ZodNumber: () => ZodNumber,
  ZodObject: () => ZodObject,
  ZodOptional: () => ZodOptional,
  ZodParsedType: () => ZodParsedType,
  ZodPipeline: () => ZodPipeline,
  ZodPromise: () => ZodPromise,
  ZodReadonly: () => ZodReadonly,
  ZodRecord: () => ZodRecord,
  ZodSchema: () => ZodType,
  ZodSet: () => ZodSet,
  ZodString: () => ZodString,
  ZodSymbol: () => ZodSymbol,
  ZodTransformer: () => ZodEffects,
  ZodTuple: () => ZodTuple,
  ZodType: () => ZodType,
  ZodUndefined: () => ZodUndefined,
  ZodUnion: () => ZodUnion,
  ZodUnknown: () => ZodUnknown,
  ZodVoid: () => ZodVoid,
  addIssueToContext: () => addIssueToContext,
  any: () => anyType,
  array: () => arrayType,
  bigint: () => bigIntType,
  boolean: () => booleanType,
  coerce: () => coerce,
  custom: () => custom,
  date: () => dateType,
  datetimeRegex: () => datetimeRegex,
  defaultErrorMap: () => en_default,
  discriminatedUnion: () => discriminatedUnionType,
  effect: () => effectsType,
  enum: () => enumType,
  function: () => functionType,
  getErrorMap: () => getErrorMap,
  getParsedType: () => getParsedType,
  instanceof: () => instanceOfType,
  intersection: () => intersectionType,
  isAborted: () => isAborted,
  isAsync: () => isAsync,
  isDirty: () => isDirty,
  isValid: () => isValid,
  late: () => late,
  lazy: () => lazyType,
  literal: () => literalType,
  makeIssue: () => makeIssue,
  map: () => mapType,
  nan: () => nanType,
  nativeEnum: () => nativeEnumType,
  never: () => neverType,
  null: () => nullType,
  nullable: () => nullableType,
  number: () => numberType,
  object: () => objectType,
  objectUtil: () => objectUtil,
  oboolean: () => oboolean,
  onumber: () => onumber,
  optional: () => optionalType,
  ostring: () => ostring,
  pipeline: () => pipelineType,
  preprocess: () => preprocessType,
  promise: () => promiseType,
  quotelessJson: () => quotelessJson,
  record: () => recordType,
  set: () => setType,
  setErrorMap: () => setErrorMap,
  strictObject: () => strictObjectType,
  string: () => stringType,
  symbol: () => symbolType,
  transformer: () => effectsType,
  tuple: () => tupleType,
  undefined: () => undefinedType,
  union: () => unionType,
  unknown: () => unknownType,
  util: () => util,
  void: () => voidType
});

// node_modules/zod/v3/helpers/util.js
var util;
(function(util2) {
  util2.assertEqual = (_) => {
  };
  function assertIs(_arg) {
  }
  util2.assertIs = assertIs;
  function assertNever(_x) {
    throw new Error();
  }
  util2.assertNever = assertNever;
  util2.arrayToEnum = (items) => {
    const obj = {};
    for (const item of items) {
      obj[item] = item;
    }
    return obj;
  };
  util2.getValidEnumValues = (obj) => {
    const validKeys = util2.objectKeys(obj).filter((k) => typeof obj[obj[k]] !== "number");
    const filtered = {};
    for (const k of validKeys) {
      filtered[k] = obj[k];
    }
    return util2.objectValues(filtered);
  };
  util2.objectValues = (obj) => {
    return util2.objectKeys(obj).map(function(e) {
      return obj[e];
    });
  };
  util2.objectKeys = typeof Object.keys === "function" ? (obj) => Object.keys(obj) : (object) => {
    const keys = [];
    for (const key in object) {
      if (Object.prototype.hasOwnProperty.call(object, key)) {
        keys.push(key);
      }
    }
    return keys;
  };
  util2.find = (arr, checker) => {
    for (const item of arr) {
      if (checker(item))
        return item;
    }
    return void 0;
  };
  util2.isInteger = typeof Number.isInteger === "function" ? (val) => Number.isInteger(val) : (val) => typeof val === "number" && Number.isFinite(val) && Math.floor(val) === val;
  function joinValues(array, separator = " | ") {
    return array.map((val) => typeof val === "string" ? `'${val}'` : val).join(separator);
  }
  util2.joinValues = joinValues;
  util2.jsonStringifyReplacer = (_, value) => {
    if (typeof value === "bigint") {
      return value.toString();
    }
    return value;
  };
})(util || (util = {}));
var objectUtil;
(function(objectUtil2) {
  objectUtil2.mergeShapes = (first, second) => {
    return {
      ...first,
      ...second
      // second overwrites first
    };
  };
})(objectUtil || (objectUtil = {}));
var ZodParsedType = util.arrayToEnum([
  "string",
  "nan",
  "number",
  "integer",
  "float",
  "boolean",
  "date",
  "bigint",
  "symbol",
  "function",
  "undefined",
  "null",
  "array",
  "object",
  "unknown",
  "promise",
  "void",
  "never",
  "map",
  "set"
]);
var getParsedType = (data) => {
  const t = typeof data;
  switch (t) {
    case "undefined":
      return ZodParsedType.undefined;
    case "string":
      return ZodParsedType.string;
    case "number":
      return Number.isNaN(data) ? ZodParsedType.nan : ZodParsedType.number;
    case "boolean":
      return ZodParsedType.boolean;
    case "function":
      return ZodParsedType.function;
    case "bigint":
      return ZodParsedType.bigint;
    case "symbol":
      return ZodParsedType.symbol;
    case "object":
      if (Array.isArray(data)) {
        return ZodParsedType.array;
      }
      if (data === null) {
        return ZodParsedType.null;
      }
      if (data.then && typeof data.then === "function" && data.catch && typeof data.catch === "function") {
        return ZodParsedType.promise;
      }
      if (typeof Map !== "undefined" && data instanceof Map) {
        return ZodParsedType.map;
      }
      if (typeof Set !== "undefined" && data instanceof Set) {
        return ZodParsedType.set;
      }
      if (typeof Date !== "undefined" && data instanceof Date) {
        return ZodParsedType.date;
      }
      return ZodParsedType.object;
    default:
      return ZodParsedType.unknown;
  }
};

// node_modules/zod/v3/ZodError.js
var ZodIssueCode = util.arrayToEnum([
  "invalid_type",
  "invalid_literal",
  "custom",
  "invalid_union",
  "invalid_union_discriminator",
  "invalid_enum_value",
  "unrecognized_keys",
  "invalid_arguments",
  "invalid_return_type",
  "invalid_date",
  "invalid_string",
  "too_small",
  "too_big",
  "invalid_intersection_types",
  "not_multiple_of",
  "not_finite"
]);
var quotelessJson = (obj) => {
  const json = JSON.stringify(obj, null, 2);
  return json.replace(/"([^"]+)":/g, "$1:");
};
var ZodError = class _ZodError extends Error {
  get errors() {
    return this.issues;
  }
  constructor(issues) {
    super();
    this.issues = [];
    this.addIssue = (sub) => {
      this.issues = [...this.issues, sub];
    };
    this.addIssues = (subs = []) => {
      this.issues = [...this.issues, ...subs];
    };
    const actualProto = new.target.prototype;
    if (Object.setPrototypeOf) {
      Object.setPrototypeOf(this, actualProto);
    } else {
      this.__proto__ = actualProto;
    }
    this.name = "ZodError";
    this.issues = issues;
  }
  format(_mapper) {
    const mapper = _mapper || function(issue) {
      return issue.message;
    };
    const fieldErrors = { _errors: [] };
    const processError = (error) => {
      for (const issue of error.issues) {
        if (issue.code === "invalid_union") {
          issue.unionErrors.map(processError);
        } else if (issue.code === "invalid_return_type") {
          processError(issue.returnTypeError);
        } else if (issue.code === "invalid_arguments") {
          processError(issue.argumentsError);
        } else if (issue.path.length === 0) {
          fieldErrors._errors.push(mapper(issue));
        } else {
          let curr = fieldErrors;
          let i = 0;
          while (i < issue.path.length) {
            const el = issue.path[i];
            const terminal = i === issue.path.length - 1;
            if (!terminal) {
              curr[el] = curr[el] || { _errors: [] };
            } else {
              curr[el] = curr[el] || { _errors: [] };
              curr[el]._errors.push(mapper(issue));
            }
            curr = curr[el];
            i++;
          }
        }
      }
    };
    processError(this);
    return fieldErrors;
  }
  static assert(value) {
    if (!(value instanceof _ZodError)) {
      throw new Error(`Not a ZodError: ${value}`);
    }
  }
  toString() {
    return this.message;
  }
  get message() {
    return JSON.stringify(this.issues, util.jsonStringifyReplacer, 2);
  }
  get isEmpty() {
    return this.issues.length === 0;
  }
  flatten(mapper = (issue) => issue.message) {
    const fieldErrors = {};
    const formErrors = [];
    for (const sub of this.issues) {
      if (sub.path.length > 0) {
        const firstEl = sub.path[0];
        fieldErrors[firstEl] = fieldErrors[firstEl] || [];
        fieldErrors[firstEl].push(mapper(sub));
      } else {
        formErrors.push(mapper(sub));
      }
    }
    return { formErrors, fieldErrors };
  }
  get formErrors() {
    return this.flatten();
  }
};
ZodError.create = (issues) => {
  const error = new ZodError(issues);
  return error;
};

// node_modules/zod/v3/locales/en.js
var errorMap = (issue, _ctx) => {
  let message;
  switch (issue.code) {
    case ZodIssueCode.invalid_type:
      if (issue.received === ZodParsedType.undefined) {
        message = "Required";
      } else {
        message = `Expected ${issue.expected}, received ${issue.received}`;
      }
      break;
    case ZodIssueCode.invalid_literal:
      message = `Invalid literal value, expected ${JSON.stringify(issue.expected, util.jsonStringifyReplacer)}`;
      break;
    case ZodIssueCode.unrecognized_keys:
      message = `Unrecognized key(s) in object: ${util.joinValues(issue.keys, ", ")}`;
      break;
    case ZodIssueCode.invalid_union:
      message = `Invalid input`;
      break;
    case ZodIssueCode.invalid_union_discriminator:
      message = `Invalid discriminator value. Expected ${util.joinValues(issue.options)}`;
      break;
    case ZodIssueCode.invalid_enum_value:
      message = `Invalid enum value. Expected ${util.joinValues(issue.options)}, received '${issue.received}'`;
      break;
    case ZodIssueCode.invalid_arguments:
      message = `Invalid function arguments`;
      break;
    case ZodIssueCode.invalid_return_type:
      message = `Invalid function return type`;
      break;
    case ZodIssueCode.invalid_date:
      message = `Invalid date`;
      break;
    case ZodIssueCode.invalid_string:
      if (typeof issue.validation === "object") {
        if ("includes" in issue.validation) {
          message = `Invalid input: must include "${issue.validation.includes}"`;
          if (typeof issue.validation.position === "number") {
            message = `${message} at one or more positions greater than or equal to ${issue.validation.position}`;
          }
        } else if ("startsWith" in issue.validation) {
          message = `Invalid input: must start with "${issue.validation.startsWith}"`;
        } else if ("endsWith" in issue.validation) {
          message = `Invalid input: must end with "${issue.validation.endsWith}"`;
        } else {
          util.assertNever(issue.validation);
        }
      } else if (issue.validation !== "regex") {
        message = `Invalid ${issue.validation}`;
      } else {
        message = "Invalid";
      }
      break;
    case ZodIssueCode.too_small:
      if (issue.type === "array")
        message = `Array must contain ${issue.exact ? "exactly" : issue.inclusive ? `at least` : `more than`} ${issue.minimum} element(s)`;
      else if (issue.type === "string")
        message = `String must contain ${issue.exact ? "exactly" : issue.inclusive ? `at least` : `over`} ${issue.minimum} character(s)`;
      else if (issue.type === "number")
        message = `Number must be ${issue.exact ? `exactly equal to ` : issue.inclusive ? `greater than or equal to ` : `greater than `}${issue.minimum}`;
      else if (issue.type === "bigint")
        message = `Number must be ${issue.exact ? `exactly equal to ` : issue.inclusive ? `greater than or equal to ` : `greater than `}${issue.minimum}`;
      else if (issue.type === "date")
        message = `Date must be ${issue.exact ? `exactly equal to ` : issue.inclusive ? `greater than or equal to ` : `greater than `}${new Date(Number(issue.minimum))}`;
      else
        message = "Invalid input";
      break;
    case ZodIssueCode.too_big:
      if (issue.type === "array")
        message = `Array must contain ${issue.exact ? `exactly` : issue.inclusive ? `at most` : `less than`} ${issue.maximum} element(s)`;
      else if (issue.type === "string")
        message = `String must contain ${issue.exact ? `exactly` : issue.inclusive ? `at most` : `under`} ${issue.maximum} character(s)`;
      else if (issue.type === "number")
        message = `Number must be ${issue.exact ? `exactly` : issue.inclusive ? `less than or equal to` : `less than`} ${issue.maximum}`;
      else if (issue.type === "bigint")
        message = `BigInt must be ${issue.exact ? `exactly` : issue.inclusive ? `less than or equal to` : `less than`} ${issue.maximum}`;
      else if (issue.type === "date")
        message = `Date must be ${issue.exact ? `exactly` : issue.inclusive ? `smaller than or equal to` : `smaller than`} ${new Date(Number(issue.maximum))}`;
      else
        message = "Invalid input";
      break;
    case ZodIssueCode.custom:
      message = `Invalid input`;
      break;
    case ZodIssueCode.invalid_intersection_types:
      message = `Intersection results could not be merged`;
      break;
    case ZodIssueCode.not_multiple_of:
      message = `Number must be a multiple of ${issue.multipleOf}`;
      break;
    case ZodIssueCode.not_finite:
      message = "Number must be finite";
      break;
    default:
      message = _ctx.defaultError;
      util.assertNever(issue);
  }
  return { message };
};
var en_default = errorMap;

// node_modules/zod/v3/errors.js
var overrideErrorMap = en_default;
function setErrorMap(map) {
  overrideErrorMap = map;
}
function getErrorMap() {
  return overrideErrorMap;
}

// node_modules/zod/v3/helpers/parseUtil.js
var makeIssue = (params) => {
  const { data, path, errorMaps, issueData } = params;
  const fullPath = [...path, ...issueData.path || []];
  const fullIssue = {
    ...issueData,
    path: fullPath
  };
  if (issueData.message !== void 0) {
    return {
      ...issueData,
      path: fullPath,
      message: issueData.message
    };
  }
  let errorMessage = "";
  const maps = errorMaps.filter((m) => !!m).slice().reverse();
  for (const map of maps) {
    errorMessage = map(fullIssue, { data, defaultError: errorMessage }).message;
  }
  return {
    ...issueData,
    path: fullPath,
    message: errorMessage
  };
};
var EMPTY_PATH = [];
function addIssueToContext(ctx, issueData) {
  const overrideMap = getErrorMap();
  const issue = makeIssue({
    issueData,
    data: ctx.data,
    path: ctx.path,
    errorMaps: [
      ctx.common.contextualErrorMap,
      // contextual error map is first priority
      ctx.schemaErrorMap,
      // then schema-bound map if available
      overrideMap,
      // then global override map
      overrideMap === en_default ? void 0 : en_default
      // then global default map
    ].filter((x) => !!x)
  });
  ctx.common.issues.push(issue);
}
var ParseStatus = class _ParseStatus {
  constructor() {
    this.value = "valid";
  }
  dirty() {
    if (this.value === "valid")
      this.value = "dirty";
  }
  abort() {
    if (this.value !== "aborted")
      this.value = "aborted";
  }
  static mergeArray(status, results) {
    const arrayValue = [];
    for (const s of results) {
      if (s.status === "aborted")
        return INVALID;
      if (s.status === "dirty")
        status.dirty();
      arrayValue.push(s.value);
    }
    return { status: status.value, value: arrayValue };
  }
  static async mergeObjectAsync(status, pairs) {
    const syncPairs = [];
    for (const pair of pairs) {
      const key = await pair.key;
      const value = await pair.value;
      syncPairs.push({
        key,
        value
      });
    }
    return _ParseStatus.mergeObjectSync(status, syncPairs);
  }
  static mergeObjectSync(status, pairs) {
    const finalObject = {};
    for (const pair of pairs) {
      const { key, value } = pair;
      if (key.status === "aborted")
        return INVALID;
      if (value.status === "aborted")
        return INVALID;
      if (key.status === "dirty")
        status.dirty();
      if (value.status === "dirty")
        status.dirty();
      if (key.value !== "__proto__" && (typeof value.value !== "undefined" || pair.alwaysSet)) {
        finalObject[key.value] = value.value;
      }
    }
    return { status: status.value, value: finalObject };
  }
};
var INVALID = Object.freeze({
  status: "aborted"
});
var DIRTY = (value) => ({ status: "dirty", value });
var OK = (value) => ({ status: "valid", value });
var isAborted = (x) => x.status === "aborted";
var isDirty = (x) => x.status === "dirty";
var isValid = (x) => x.status === "valid";
var isAsync = (x) => typeof Promise !== "undefined" && x instanceof Promise;

// node_modules/zod/v3/helpers/errorUtil.js
var errorUtil;
(function(errorUtil2) {
  errorUtil2.errToObj = (message) => typeof message === "string" ? { message } : message || {};
  errorUtil2.toString = (message) => typeof message === "string" ? message : message?.message;
})(errorUtil || (errorUtil = {}));

// node_modules/zod/v3/types.js
var ParseInputLazyPath = class {
  constructor(parent, value, path, key) {
    this._cachedPath = [];
    this.parent = parent;
    this.data = value;
    this._path = path;
    this._key = key;
  }
  get path() {
    if (!this._cachedPath.length) {
      if (Array.isArray(this._key)) {
        this._cachedPath.push(...this._path, ...this._key);
      } else {
        this._cachedPath.push(...this._path, this._key);
      }
    }
    return this._cachedPath;
  }
};
var handleResult = (ctx, result) => {
  if (isValid(result)) {
    return { success: true, data: result.value };
  } else {
    if (!ctx.common.issues.length) {
      throw new Error("Validation failed but no issues detected.");
    }
    return {
      success: false,
      get error() {
        if (this._error)
          return this._error;
        const error = new ZodError(ctx.common.issues);
        this._error = error;
        return this._error;
      }
    };
  }
};
function processCreateParams(params) {
  if (!params)
    return {};
  const { errorMap: errorMap2, invalid_type_error, required_error, description } = params;
  if (errorMap2 && (invalid_type_error || required_error)) {
    throw new Error(`Can't use "invalid_type_error" or "required_error" in conjunction with custom error map.`);
  }
  if (errorMap2)
    return { errorMap: errorMap2, description };
  const customMap = (iss, ctx) => {
    const { message } = params;
    if (iss.code === "invalid_enum_value") {
      return { message: message ?? ctx.defaultError };
    }
    if (typeof ctx.data === "undefined") {
      return { message: message ?? required_error ?? ctx.defaultError };
    }
    if (iss.code !== "invalid_type")
      return { message: ctx.defaultError };
    return { message: message ?? invalid_type_error ?? ctx.defaultError };
  };
  return { errorMap: customMap, description };
}
var ZodType = class {
  get description() {
    return this._def.description;
  }
  _getType(input) {
    return getParsedType(input.data);
  }
  _getOrReturnCtx(input, ctx) {
    return ctx || {
      common: input.parent.common,
      data: input.data,
      parsedType: getParsedType(input.data),
      schemaErrorMap: this._def.errorMap,
      path: input.path,
      parent: input.parent
    };
  }
  _processInputParams(input) {
    return {
      status: new ParseStatus(),
      ctx: {
        common: input.parent.common,
        data: input.data,
        parsedType: getParsedType(input.data),
        schemaErrorMap: this._def.errorMap,
        path: input.path,
        parent: input.parent
      }
    };
  }
  _parseSync(input) {
    const result = this._parse(input);
    if (isAsync(result)) {
      throw new Error("Synchronous parse encountered promise.");
    }
    return result;
  }
  _parseAsync(input) {
    const result = this._parse(input);
    return Promise.resolve(result);
  }
  parse(data, params) {
    const result = this.safeParse(data, params);
    if (result.success)
      return result.data;
    throw result.error;
  }
  safeParse(data, params) {
    const ctx = {
      common: {
        issues: [],
        async: params?.async ?? false,
        contextualErrorMap: params?.errorMap
      },
      path: params?.path || [],
      schemaErrorMap: this._def.errorMap,
      parent: null,
      data,
      parsedType: getParsedType(data)
    };
    const result = this._parseSync({ data, path: ctx.path, parent: ctx });
    return handleResult(ctx, result);
  }
  "~validate"(data) {
    const ctx = {
      common: {
        issues: [],
        async: !!this["~standard"].async
      },
      path: [],
      schemaErrorMap: this._def.errorMap,
      parent: null,
      data,
      parsedType: getParsedType(data)
    };
    if (!this["~standard"].async) {
      try {
        const result = this._parseSync({ data, path: [], parent: ctx });
        return isValid(result) ? {
          value: result.value
        } : {
          issues: ctx.common.issues
        };
      } catch (err) {
        if (err?.message?.toLowerCase()?.includes("encountered")) {
          this["~standard"].async = true;
        }
        ctx.common = {
          issues: [],
          async: true
        };
      }
    }
    return this._parseAsync({ data, path: [], parent: ctx }).then((result) => isValid(result) ? {
      value: result.value
    } : {
      issues: ctx.common.issues
    });
  }
  async parseAsync(data, params) {
    const result = await this.safeParseAsync(data, params);
    if (result.success)
      return result.data;
    throw result.error;
  }
  async safeParseAsync(data, params) {
    const ctx = {
      common: {
        issues: [],
        contextualErrorMap: params?.errorMap,
        async: true
      },
      path: params?.path || [],
      schemaErrorMap: this._def.errorMap,
      parent: null,
      data,
      parsedType: getParsedType(data)
    };
    const maybeAsyncResult = this._parse({ data, path: ctx.path, parent: ctx });
    const result = await (isAsync(maybeAsyncResult) ? maybeAsyncResult : Promise.resolve(maybeAsyncResult));
    return handleResult(ctx, result);
  }
  refine(check, message) {
    const getIssueProperties = (val) => {
      if (typeof message === "string" || typeof message === "undefined") {
        return { message };
      } else if (typeof message === "function") {
        return message(val);
      } else {
        return message;
      }
    };
    return this._refinement((val, ctx) => {
      const result = check(val);
      const setError = () => ctx.addIssue({
        code: ZodIssueCode.custom,
        ...getIssueProperties(val)
      });
      if (typeof Promise !== "undefined" && result instanceof Promise) {
        return result.then((data) => {
          if (!data) {
            setError();
            return false;
          } else {
            return true;
          }
        });
      }
      if (!result) {
        setError();
        return false;
      } else {
        return true;
      }
    });
  }
  refinement(check, refinementData) {
    return this._refinement((val, ctx) => {
      if (!check(val)) {
        ctx.addIssue(typeof refinementData === "function" ? refinementData(val, ctx) : refinementData);
        return false;
      } else {
        return true;
      }
    });
  }
  _refinement(refinement) {
    return new ZodEffects({
      schema: this,
      typeName: ZodFirstPartyTypeKind.ZodEffects,
      effect: { type: "refinement", refinement }
    });
  }
  superRefine(refinement) {
    return this._refinement(refinement);
  }
  constructor(def) {
    this.spa = this.safeParseAsync;
    this._def = def;
    this.parse = this.parse.bind(this);
    this.safeParse = this.safeParse.bind(this);
    this.parseAsync = this.parseAsync.bind(this);
    this.safeParseAsync = this.safeParseAsync.bind(this);
    this.spa = this.spa.bind(this);
    this.refine = this.refine.bind(this);
    this.refinement = this.refinement.bind(this);
    this.superRefine = this.superRefine.bind(this);
    this.optional = this.optional.bind(this);
    this.nullable = this.nullable.bind(this);
    this.nullish = this.nullish.bind(this);
    this.array = this.array.bind(this);
    this.promise = this.promise.bind(this);
    this.or = this.or.bind(this);
    this.and = this.and.bind(this);
    this.transform = this.transform.bind(this);
    this.brand = this.brand.bind(this);
    this.default = this.default.bind(this);
    this.catch = this.catch.bind(this);
    this.describe = this.describe.bind(this);
    this.pipe = this.pipe.bind(this);
    this.readonly = this.readonly.bind(this);
    this.isNullable = this.isNullable.bind(this);
    this.isOptional = this.isOptional.bind(this);
    this["~standard"] = {
      version: 1,
      vendor: "zod",
      validate: (data) => this["~validate"](data)
    };
  }
  optional() {
    return ZodOptional.create(this, this._def);
  }
  nullable() {
    return ZodNullable.create(this, this._def);
  }
  nullish() {
    return this.nullable().optional();
  }
  array() {
    return ZodArray.create(this);
  }
  promise() {
    return ZodPromise.create(this, this._def);
  }
  or(option) {
    return ZodUnion.create([this, option], this._def);
  }
  and(incoming) {
    return ZodIntersection.create(this, incoming, this._def);
  }
  transform(transform) {
    return new ZodEffects({
      ...processCreateParams(this._def),
      schema: this,
      typeName: ZodFirstPartyTypeKind.ZodEffects,
      effect: { type: "transform", transform }
    });
  }
  default(def) {
    const defaultValueFunc = typeof def === "function" ? def : () => def;
    return new ZodDefault({
      ...processCreateParams(this._def),
      innerType: this,
      defaultValue: defaultValueFunc,
      typeName: ZodFirstPartyTypeKind.ZodDefault
    });
  }
  brand() {
    return new ZodBranded({
      typeName: ZodFirstPartyTypeKind.ZodBranded,
      type: this,
      ...processCreateParams(this._def)
    });
  }
  catch(def) {
    const catchValueFunc = typeof def === "function" ? def : () => def;
    return new ZodCatch({
      ...processCreateParams(this._def),
      innerType: this,
      catchValue: catchValueFunc,
      typeName: ZodFirstPartyTypeKind.ZodCatch
    });
  }
  describe(description) {
    const This = this.constructor;
    return new This({
      ...this._def,
      description
    });
  }
  pipe(target) {
    return ZodPipeline.create(this, target);
  }
  readonly() {
    return ZodReadonly.create(this);
  }
  isOptional() {
    return this.safeParse(void 0).success;
  }
  isNullable() {
    return this.safeParse(null).success;
  }
};
var cuidRegex = /^c[^\s-]{8,}$/i;
var cuid2Regex = /^[0-9a-z]+$/;
var ulidRegex = /^[0-9A-HJKMNP-TV-Z]{26}$/i;
var uuidRegex = /^[0-9a-fA-F]{8}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{12}$/i;
var nanoidRegex = /^[a-z0-9_-]{21}$/i;
var jwtRegex = /^[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+\.[A-Za-z0-9-_]*$/;
var durationRegex = /^[-+]?P(?!$)(?:(?:[-+]?\d+Y)|(?:[-+]?\d+[.,]\d+Y$))?(?:(?:[-+]?\d+M)|(?:[-+]?\d+[.,]\d+M$))?(?:(?:[-+]?\d+W)|(?:[-+]?\d+[.,]\d+W$))?(?:(?:[-+]?\d+D)|(?:[-+]?\d+[.,]\d+D$))?(?:T(?=[\d+-])(?:(?:[-+]?\d+H)|(?:[-+]?\d+[.,]\d+H$))?(?:(?:[-+]?\d+M)|(?:[-+]?\d+[.,]\d+M$))?(?:[-+]?\d+(?:[.,]\d+)?S)?)??$/;
var emailRegex = /^(?!\.)(?!.*\.\.)([A-Z0-9_'+\-\.]*)[A-Z0-9_+-]@([A-Z0-9][A-Z0-9\-]*\.)+[A-Z]{2,}$/i;
var _emojiRegex = `^(\\p{Extended_Pictographic}|\\p{Emoji_Component})+$`;
var emojiRegex;
var ipv4Regex = /^(?:(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\.){3}(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])$/;
var ipv4CidrRegex = /^(?:(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\.){3}(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\/(3[0-2]|[12]?[0-9])$/;
var ipv6Regex = /^(([0-9a-fA-F]{1,4}:){7,7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:)|fe80:(:[0-9a-fA-F]{0,4}){0,4}%[0-9a-zA-Z]{1,}|::(ffff(:0{1,4}){0,1}:){0,1}((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])|([0-9a-fA-F]{1,4}:){1,4}:((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9]))$/;
var ipv6CidrRegex = /^(([0-9a-fA-F]{1,4}:){7,7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:)|fe80:(:[0-9a-fA-F]{0,4}){0,4}%[0-9a-zA-Z]{1,}|::(ffff(:0{1,4}){0,1}:){0,1}((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])|([0-9a-fA-F]{1,4}:){1,4}:((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9]))\/(12[0-8]|1[01][0-9]|[1-9]?[0-9])$/;
var base64Regex = /^([0-9a-zA-Z+/]{4})*(([0-9a-zA-Z+/]{2}==)|([0-9a-zA-Z+/]{3}=))?$/;
var base64urlRegex = /^([0-9a-zA-Z-_]{4})*(([0-9a-zA-Z-_]{2}(==)?)|([0-9a-zA-Z-_]{3}(=)?))?$/;
var dateRegexSource = `((\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-((0[13578]|1[02])-(0[1-9]|[12]\\d|3[01])|(0[469]|11)-(0[1-9]|[12]\\d|30)|(02)-(0[1-9]|1\\d|2[0-8])))`;
var dateRegex = new RegExp(`^${dateRegexSource}$`);
function timeRegexSource(args) {
  let secondsRegexSource = `[0-5]\\d`;
  if (args.precision) {
    secondsRegexSource = `${secondsRegexSource}\\.\\d{${args.precision}}`;
  } else if (args.precision == null) {
    secondsRegexSource = `${secondsRegexSource}(\\.\\d+)?`;
  }
  const secondsQuantifier = args.precision ? "+" : "?";
  return `([01]\\d|2[0-3]):[0-5]\\d(:${secondsRegexSource})${secondsQuantifier}`;
}
function timeRegex(args) {
  return new RegExp(`^${timeRegexSource(args)}$`);
}
function datetimeRegex(args) {
  let regex = `${dateRegexSource}T${timeRegexSource(args)}`;
  const opts = [];
  opts.push(args.local ? `Z?` : `Z`);
  if (args.offset)
    opts.push(`([+-]\\d{2}:?\\d{2})`);
  regex = `${regex}(${opts.join("|")})`;
  return new RegExp(`^${regex}$`);
}
function isValidIP(ip, version) {
  if ((version === "v4" || !version) && ipv4Regex.test(ip)) {
    return true;
  }
  if ((version === "v6" || !version) && ipv6Regex.test(ip)) {
    return true;
  }
  return false;
}
function isValidJWT(jwt, alg) {
  if (!jwtRegex.test(jwt))
    return false;
  try {
    const [header] = jwt.split(".");
    if (!header)
      return false;
    const base64 = header.replace(/-/g, "+").replace(/_/g, "/").padEnd(header.length + (4 - header.length % 4) % 4, "=");
    const decoded = JSON.parse(atob(base64));
    if (typeof decoded !== "object" || decoded === null)
      return false;
    if ("typ" in decoded && decoded?.typ !== "JWT")
      return false;
    if (!decoded.alg)
      return false;
    if (alg && decoded.alg !== alg)
      return false;
    return true;
  } catch {
    return false;
  }
}
function isValidCidr(ip, version) {
  if ((version === "v4" || !version) && ipv4CidrRegex.test(ip)) {
    return true;
  }
  if ((version === "v6" || !version) && ipv6CidrRegex.test(ip)) {
    return true;
  }
  return false;
}
var ZodString = class _ZodString extends ZodType {
  _parse(input) {
    if (this._def.coerce) {
      input.data = String(input.data);
    }
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.string) {
      const ctx2 = this._getOrReturnCtx(input);
      addIssueToContext(ctx2, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.string,
        received: ctx2.parsedType
      });
      return INVALID;
    }
    const status = new ParseStatus();
    let ctx = void 0;
    for (const check of this._def.checks) {
      if (check.kind === "min") {
        if (input.data.length < check.value) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_small,
            minimum: check.value,
            type: "string",
            inclusive: true,
            exact: false,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "max") {
        if (input.data.length > check.value) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_big,
            maximum: check.value,
            type: "string",
            inclusive: true,
            exact: false,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "length") {
        const tooBig = input.data.length > check.value;
        const tooSmall = input.data.length < check.value;
        if (tooBig || tooSmall) {
          ctx = this._getOrReturnCtx(input, ctx);
          if (tooBig) {
            addIssueToContext(ctx, {
              code: ZodIssueCode.too_big,
              maximum: check.value,
              type: "string",
              inclusive: true,
              exact: true,
              message: check.message
            });
          } else if (tooSmall) {
            addIssueToContext(ctx, {
              code: ZodIssueCode.too_small,
              minimum: check.value,
              type: "string",
              inclusive: true,
              exact: true,
              message: check.message
            });
          }
          status.dirty();
        }
      } else if (check.kind === "email") {
        if (!emailRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "email",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "emoji") {
        if (!emojiRegex) {
          emojiRegex = new RegExp(_emojiRegex, "u");
        }
        if (!emojiRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "emoji",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "uuid") {
        if (!uuidRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "uuid",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "nanoid") {
        if (!nanoidRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "nanoid",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "cuid") {
        if (!cuidRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "cuid",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "cuid2") {
        if (!cuid2Regex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "cuid2",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "ulid") {
        if (!ulidRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "ulid",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "url") {
        try {
          new URL(input.data);
        } catch {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "url",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "regex") {
        check.regex.lastIndex = 0;
        const testResult = check.regex.test(input.data);
        if (!testResult) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "regex",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "trim") {
        input.data = input.data.trim();
      } else if (check.kind === "includes") {
        if (!input.data.includes(check.value, check.position)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_string,
            validation: { includes: check.value, position: check.position },
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "toLowerCase") {
        input.data = input.data.toLowerCase();
      } else if (check.kind === "toUpperCase") {
        input.data = input.data.toUpperCase();
      } else if (check.kind === "startsWith") {
        if (!input.data.startsWith(check.value)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_string,
            validation: { startsWith: check.value },
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "endsWith") {
        if (!input.data.endsWith(check.value)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_string,
            validation: { endsWith: check.value },
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "datetime") {
        const regex = datetimeRegex(check);
        if (!regex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_string,
            validation: "datetime",
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "date") {
        const regex = dateRegex;
        if (!regex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_string,
            validation: "date",
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "time") {
        const regex = timeRegex(check);
        if (!regex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_string,
            validation: "time",
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "duration") {
        if (!durationRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "duration",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "ip") {
        if (!isValidIP(input.data, check.version)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "ip",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "jwt") {
        if (!isValidJWT(input.data, check.alg)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "jwt",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "cidr") {
        if (!isValidCidr(input.data, check.version)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "cidr",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "base64") {
        if (!base64Regex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "base64",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "base64url") {
        if (!base64urlRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "base64url",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else {
        util.assertNever(check);
      }
    }
    return { status: status.value, value: input.data };
  }
  _regex(regex, validation, message) {
    return this.refinement((data) => regex.test(data), {
      validation,
      code: ZodIssueCode.invalid_string,
      ...errorUtil.errToObj(message)
    });
  }
  _addCheck(check) {
    return new _ZodString({
      ...this._def,
      checks: [...this._def.checks, check]
    });
  }
  email(message) {
    return this._addCheck({ kind: "email", ...errorUtil.errToObj(message) });
  }
  url(message) {
    return this._addCheck({ kind: "url", ...errorUtil.errToObj(message) });
  }
  emoji(message) {
    return this._addCheck({ kind: "emoji", ...errorUtil.errToObj(message) });
  }
  uuid(message) {
    return this._addCheck({ kind: "uuid", ...errorUtil.errToObj(message) });
  }
  nanoid(message) {
    return this._addCheck({ kind: "nanoid", ...errorUtil.errToObj(message) });
  }
  cuid(message) {
    return this._addCheck({ kind: "cuid", ...errorUtil.errToObj(message) });
  }
  cuid2(message) {
    return this._addCheck({ kind: "cuid2", ...errorUtil.errToObj(message) });
  }
  ulid(message) {
    return this._addCheck({ kind: "ulid", ...errorUtil.errToObj(message) });
  }
  base64(message) {
    return this._addCheck({ kind: "base64", ...errorUtil.errToObj(message) });
  }
  base64url(message) {
    return this._addCheck({
      kind: "base64url",
      ...errorUtil.errToObj(message)
    });
  }
  jwt(options) {
    return this._addCheck({ kind: "jwt", ...errorUtil.errToObj(options) });
  }
  ip(options) {
    return this._addCheck({ kind: "ip", ...errorUtil.errToObj(options) });
  }
  cidr(options) {
    return this._addCheck({ kind: "cidr", ...errorUtil.errToObj(options) });
  }
  datetime(options) {
    if (typeof options === "string") {
      return this._addCheck({
        kind: "datetime",
        precision: null,
        offset: false,
        local: false,
        message: options
      });
    }
    return this._addCheck({
      kind: "datetime",
      precision: typeof options?.precision === "undefined" ? null : options?.precision,
      offset: options?.offset ?? false,
      local: options?.local ?? false,
      ...errorUtil.errToObj(options?.message)
    });
  }
  date(message) {
    return this._addCheck({ kind: "date", message });
  }
  time(options) {
    if (typeof options === "string") {
      return this._addCheck({
        kind: "time",
        precision: null,
        message: options
      });
    }
    return this._addCheck({
      kind: "time",
      precision: typeof options?.precision === "undefined" ? null : options?.precision,
      ...errorUtil.errToObj(options?.message)
    });
  }
  duration(message) {
    return this._addCheck({ kind: "duration", ...errorUtil.errToObj(message) });
  }
  regex(regex, message) {
    return this._addCheck({
      kind: "regex",
      regex,
      ...errorUtil.errToObj(message)
    });
  }
  includes(value, options) {
    return this._addCheck({
      kind: "includes",
      value,
      position: options?.position,
      ...errorUtil.errToObj(options?.message)
    });
  }
  startsWith(value, message) {
    return this._addCheck({
      kind: "startsWith",
      value,
      ...errorUtil.errToObj(message)
    });
  }
  endsWith(value, message) {
    return this._addCheck({
      kind: "endsWith",
      value,
      ...errorUtil.errToObj(message)
    });
  }
  min(minLength, message) {
    return this._addCheck({
      kind: "min",
      value: minLength,
      ...errorUtil.errToObj(message)
    });
  }
  max(maxLength, message) {
    return this._addCheck({
      kind: "max",
      value: maxLength,
      ...errorUtil.errToObj(message)
    });
  }
  length(len, message) {
    return this._addCheck({
      kind: "length",
      value: len,
      ...errorUtil.errToObj(message)
    });
  }
  /**
   * Equivalent to `.min(1)`
   */
  nonempty(message) {
    return this.min(1, errorUtil.errToObj(message));
  }
  trim() {
    return new _ZodString({
      ...this._def,
      checks: [...this._def.checks, { kind: "trim" }]
    });
  }
  toLowerCase() {
    return new _ZodString({
      ...this._def,
      checks: [...this._def.checks, { kind: "toLowerCase" }]
    });
  }
  toUpperCase() {
    return new _ZodString({
      ...this._def,
      checks: [...this._def.checks, { kind: "toUpperCase" }]
    });
  }
  get isDatetime() {
    return !!this._def.checks.find((ch) => ch.kind === "datetime");
  }
  get isDate() {
    return !!this._def.checks.find((ch) => ch.kind === "date");
  }
  get isTime() {
    return !!this._def.checks.find((ch) => ch.kind === "time");
  }
  get isDuration() {
    return !!this._def.checks.find((ch) => ch.kind === "duration");
  }
  get isEmail() {
    return !!this._def.checks.find((ch) => ch.kind === "email");
  }
  get isURL() {
    return !!this._def.checks.find((ch) => ch.kind === "url");
  }
  get isEmoji() {
    return !!this._def.checks.find((ch) => ch.kind === "emoji");
  }
  get isUUID() {
    return !!this._def.checks.find((ch) => ch.kind === "uuid");
  }
  get isNANOID() {
    return !!this._def.checks.find((ch) => ch.kind === "nanoid");
  }
  get isCUID() {
    return !!this._def.checks.find((ch) => ch.kind === "cuid");
  }
  get isCUID2() {
    return !!this._def.checks.find((ch) => ch.kind === "cuid2");
  }
  get isULID() {
    return !!this._def.checks.find((ch) => ch.kind === "ulid");
  }
  get isIP() {
    return !!this._def.checks.find((ch) => ch.kind === "ip");
  }
  get isCIDR() {
    return !!this._def.checks.find((ch) => ch.kind === "cidr");
  }
  get isBase64() {
    return !!this._def.checks.find((ch) => ch.kind === "base64");
  }
  get isBase64url() {
    return !!this._def.checks.find((ch) => ch.kind === "base64url");
  }
  get minLength() {
    let min = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "min") {
        if (min === null || ch.value > min)
          min = ch.value;
      }
    }
    return min;
  }
  get maxLength() {
    let max = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "max") {
        if (max === null || ch.value < max)
          max = ch.value;
      }
    }
    return max;
  }
};
ZodString.create = (params) => {
  return new ZodString({
    checks: [],
    typeName: ZodFirstPartyTypeKind.ZodString,
    coerce: params?.coerce ?? false,
    ...processCreateParams(params)
  });
};
function floatSafeRemainder(val, step) {
  const valDecCount = (val.toString().split(".")[1] || "").length;
  const stepDecCount = (step.toString().split(".")[1] || "").length;
  const decCount = valDecCount > stepDecCount ? valDecCount : stepDecCount;
  const valInt = Number.parseInt(val.toFixed(decCount).replace(".", ""));
  const stepInt = Number.parseInt(step.toFixed(decCount).replace(".", ""));
  return valInt % stepInt / 10 ** decCount;
}
var ZodNumber = class _ZodNumber extends ZodType {
  constructor() {
    super(...arguments);
    this.min = this.gte;
    this.max = this.lte;
    this.step = this.multipleOf;
  }
  _parse(input) {
    if (this._def.coerce) {
      input.data = Number(input.data);
    }
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.number) {
      const ctx2 = this._getOrReturnCtx(input);
      addIssueToContext(ctx2, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.number,
        received: ctx2.parsedType
      });
      return INVALID;
    }
    let ctx = void 0;
    const status = new ParseStatus();
    for (const check of this._def.checks) {
      if (check.kind === "int") {
        if (!util.isInteger(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_type,
            expected: "integer",
            received: "float",
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "min") {
        const tooSmall = check.inclusive ? input.data < check.value : input.data <= check.value;
        if (tooSmall) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_small,
            minimum: check.value,
            type: "number",
            inclusive: check.inclusive,
            exact: false,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "max") {
        const tooBig = check.inclusive ? input.data > check.value : input.data >= check.value;
        if (tooBig) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_big,
            maximum: check.value,
            type: "number",
            inclusive: check.inclusive,
            exact: false,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "multipleOf") {
        if (floatSafeRemainder(input.data, check.value) !== 0) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.not_multiple_of,
            multipleOf: check.value,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "finite") {
        if (!Number.isFinite(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.not_finite,
            message: check.message
          });
          status.dirty();
        }
      } else {
        util.assertNever(check);
      }
    }
    return { status: status.value, value: input.data };
  }
  gte(value, message) {
    return this.setLimit("min", value, true, errorUtil.toString(message));
  }
  gt(value, message) {
    return this.setLimit("min", value, false, errorUtil.toString(message));
  }
  lte(value, message) {
    return this.setLimit("max", value, true, errorUtil.toString(message));
  }
  lt(value, message) {
    return this.setLimit("max", value, false, errorUtil.toString(message));
  }
  setLimit(kind, value, inclusive, message) {
    return new _ZodNumber({
      ...this._def,
      checks: [
        ...this._def.checks,
        {
          kind,
          value,
          inclusive,
          message: errorUtil.toString(message)
        }
      ]
    });
  }
  _addCheck(check) {
    return new _ZodNumber({
      ...this._def,
      checks: [...this._def.checks, check]
    });
  }
  int(message) {
    return this._addCheck({
      kind: "int",
      message: errorUtil.toString(message)
    });
  }
  positive(message) {
    return this._addCheck({
      kind: "min",
      value: 0,
      inclusive: false,
      message: errorUtil.toString(message)
    });
  }
  negative(message) {
    return this._addCheck({
      kind: "max",
      value: 0,
      inclusive: false,
      message: errorUtil.toString(message)
    });
  }
  nonpositive(message) {
    return this._addCheck({
      kind: "max",
      value: 0,
      inclusive: true,
      message: errorUtil.toString(message)
    });
  }
  nonnegative(message) {
    return this._addCheck({
      kind: "min",
      value: 0,
      inclusive: true,
      message: errorUtil.toString(message)
    });
  }
  multipleOf(value, message) {
    return this._addCheck({
      kind: "multipleOf",
      value,
      message: errorUtil.toString(message)
    });
  }
  finite(message) {
    return this._addCheck({
      kind: "finite",
      message: errorUtil.toString(message)
    });
  }
  safe(message) {
    return this._addCheck({
      kind: "min",
      inclusive: true,
      value: Number.MIN_SAFE_INTEGER,
      message: errorUtil.toString(message)
    })._addCheck({
      kind: "max",
      inclusive: true,
      value: Number.MAX_SAFE_INTEGER,
      message: errorUtil.toString(message)
    });
  }
  get minValue() {
    let min = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "min") {
        if (min === null || ch.value > min)
          min = ch.value;
      }
    }
    return min;
  }
  get maxValue() {
    let max = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "max") {
        if (max === null || ch.value < max)
          max = ch.value;
      }
    }
    return max;
  }
  get isInt() {
    return !!this._def.checks.find((ch) => ch.kind === "int" || ch.kind === "multipleOf" && util.isInteger(ch.value));
  }
  get isFinite() {
    let max = null;
    let min = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "finite" || ch.kind === "int" || ch.kind === "multipleOf") {
        return true;
      } else if (ch.kind === "min") {
        if (min === null || ch.value > min)
          min = ch.value;
      } else if (ch.kind === "max") {
        if (max === null || ch.value < max)
          max = ch.value;
      }
    }
    return Number.isFinite(min) && Number.isFinite(max);
  }
};
ZodNumber.create = (params) => {
  return new ZodNumber({
    checks: [],
    typeName: ZodFirstPartyTypeKind.ZodNumber,
    coerce: params?.coerce || false,
    ...processCreateParams(params)
  });
};
var ZodBigInt = class _ZodBigInt extends ZodType {
  constructor() {
    super(...arguments);
    this.min = this.gte;
    this.max = this.lte;
  }
  _parse(input) {
    if (this._def.coerce) {
      try {
        input.data = BigInt(input.data);
      } catch {
        return this._getInvalidInput(input);
      }
    }
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.bigint) {
      return this._getInvalidInput(input);
    }
    let ctx = void 0;
    const status = new ParseStatus();
    for (const check of this._def.checks) {
      if (check.kind === "min") {
        const tooSmall = check.inclusive ? input.data < check.value : input.data <= check.value;
        if (tooSmall) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_small,
            type: "bigint",
            minimum: check.value,
            inclusive: check.inclusive,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "max") {
        const tooBig = check.inclusive ? input.data > check.value : input.data >= check.value;
        if (tooBig) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_big,
            type: "bigint",
            maximum: check.value,
            inclusive: check.inclusive,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "multipleOf") {
        if (input.data % check.value !== BigInt(0)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.not_multiple_of,
            multipleOf: check.value,
            message: check.message
          });
          status.dirty();
        }
      } else {
        util.assertNever(check);
      }
    }
    return { status: status.value, value: input.data };
  }
  _getInvalidInput(input) {
    const ctx = this._getOrReturnCtx(input);
    addIssueToContext(ctx, {
      code: ZodIssueCode.invalid_type,
      expected: ZodParsedType.bigint,
      received: ctx.parsedType
    });
    return INVALID;
  }
  gte(value, message) {
    return this.setLimit("min", value, true, errorUtil.toString(message));
  }
  gt(value, message) {
    return this.setLimit("min", value, false, errorUtil.toString(message));
  }
  lte(value, message) {
    return this.setLimit("max", value, true, errorUtil.toString(message));
  }
  lt(value, message) {
    return this.setLimit("max", value, false, errorUtil.toString(message));
  }
  setLimit(kind, value, inclusive, message) {
    return new _ZodBigInt({
      ...this._def,
      checks: [
        ...this._def.checks,
        {
          kind,
          value,
          inclusive,
          message: errorUtil.toString(message)
        }
      ]
    });
  }
  _addCheck(check) {
    return new _ZodBigInt({
      ...this._def,
      checks: [...this._def.checks, check]
    });
  }
  positive(message) {
    return this._addCheck({
      kind: "min",
      value: BigInt(0),
      inclusive: false,
      message: errorUtil.toString(message)
    });
  }
  negative(message) {
    return this._addCheck({
      kind: "max",
      value: BigInt(0),
      inclusive: false,
      message: errorUtil.toString(message)
    });
  }
  nonpositive(message) {
    return this._addCheck({
      kind: "max",
      value: BigInt(0),
      inclusive: true,
      message: errorUtil.toString(message)
    });
  }
  nonnegative(message) {
    return this._addCheck({
      kind: "min",
      value: BigInt(0),
      inclusive: true,
      message: errorUtil.toString(message)
    });
  }
  multipleOf(value, message) {
    return this._addCheck({
      kind: "multipleOf",
      value,
      message: errorUtil.toString(message)
    });
  }
  get minValue() {
    let min = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "min") {
        if (min === null || ch.value > min)
          min = ch.value;
      }
    }
    return min;
  }
  get maxValue() {
    let max = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "max") {
        if (max === null || ch.value < max)
          max = ch.value;
      }
    }
    return max;
  }
};
ZodBigInt.create = (params) => {
  return new ZodBigInt({
    checks: [],
    typeName: ZodFirstPartyTypeKind.ZodBigInt,
    coerce: params?.coerce ?? false,
    ...processCreateParams(params)
  });
};
var ZodBoolean = class extends ZodType {
  _parse(input) {
    if (this._def.coerce) {
      input.data = Boolean(input.data);
    }
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.boolean) {
      const ctx = this._getOrReturnCtx(input);
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.boolean,
        received: ctx.parsedType
      });
      return INVALID;
    }
    return OK(input.data);
  }
};
ZodBoolean.create = (params) => {
  return new ZodBoolean({
    typeName: ZodFirstPartyTypeKind.ZodBoolean,
    coerce: params?.coerce || false,
    ...processCreateParams(params)
  });
};
var ZodDate = class _ZodDate extends ZodType {
  _parse(input) {
    if (this._def.coerce) {
      input.data = new Date(input.data);
    }
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.date) {
      const ctx2 = this._getOrReturnCtx(input);
      addIssueToContext(ctx2, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.date,
        received: ctx2.parsedType
      });
      return INVALID;
    }
    if (Number.isNaN(input.data.getTime())) {
      const ctx2 = this._getOrReturnCtx(input);
      addIssueToContext(ctx2, {
        code: ZodIssueCode.invalid_date
      });
      return INVALID;
    }
    const status = new ParseStatus();
    let ctx = void 0;
    for (const check of this._def.checks) {
      if (check.kind === "min") {
        if (input.data.getTime() < check.value) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_small,
            message: check.message,
            inclusive: true,
            exact: false,
            minimum: check.value,
            type: "date"
          });
          status.dirty();
        }
      } else if (check.kind === "max") {
        if (input.data.getTime() > check.value) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_big,
            message: check.message,
            inclusive: true,
            exact: false,
            maximum: check.value,
            type: "date"
          });
          status.dirty();
        }
      } else {
        util.assertNever(check);
      }
    }
    return {
      status: status.value,
      value: new Date(input.data.getTime())
    };
  }
  _addCheck(check) {
    return new _ZodDate({
      ...this._def,
      checks: [...this._def.checks, check]
    });
  }
  min(minDate, message) {
    return this._addCheck({
      kind: "min",
      value: minDate.getTime(),
      message: errorUtil.toString(message)
    });
  }
  max(maxDate, message) {
    return this._addCheck({
      kind: "max",
      value: maxDate.getTime(),
      message: errorUtil.toString(message)
    });
  }
  get minDate() {
    let min = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "min") {
        if (min === null || ch.value > min)
          min = ch.value;
      }
    }
    return min != null ? new Date(min) : null;
  }
  get maxDate() {
    let max = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "max") {
        if (max === null || ch.value < max)
          max = ch.value;
      }
    }
    return max != null ? new Date(max) : null;
  }
};
ZodDate.create = (params) => {
  return new ZodDate({
    checks: [],
    coerce: params?.coerce || false,
    typeName: ZodFirstPartyTypeKind.ZodDate,
    ...processCreateParams(params)
  });
};
var ZodSymbol = class extends ZodType {
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.symbol) {
      const ctx = this._getOrReturnCtx(input);
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.symbol,
        received: ctx.parsedType
      });
      return INVALID;
    }
    return OK(input.data);
  }
};
ZodSymbol.create = (params) => {
  return new ZodSymbol({
    typeName: ZodFirstPartyTypeKind.ZodSymbol,
    ...processCreateParams(params)
  });
};
var ZodUndefined = class extends ZodType {
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.undefined) {
      const ctx = this._getOrReturnCtx(input);
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.undefined,
        received: ctx.parsedType
      });
      return INVALID;
    }
    return OK(input.data);
  }
};
ZodUndefined.create = (params) => {
  return new ZodUndefined({
    typeName: ZodFirstPartyTypeKind.ZodUndefined,
    ...processCreateParams(params)
  });
};
var ZodNull = class extends ZodType {
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.null) {
      const ctx = this._getOrReturnCtx(input);
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.null,
        received: ctx.parsedType
      });
      return INVALID;
    }
    return OK(input.data);
  }
};
ZodNull.create = (params) => {
  return new ZodNull({
    typeName: ZodFirstPartyTypeKind.ZodNull,
    ...processCreateParams(params)
  });
};
var ZodAny = class extends ZodType {
  constructor() {
    super(...arguments);
    this._any = true;
  }
  _parse(input) {
    return OK(input.data);
  }
};
ZodAny.create = (params) => {
  return new ZodAny({
    typeName: ZodFirstPartyTypeKind.ZodAny,
    ...processCreateParams(params)
  });
};
var ZodUnknown = class extends ZodType {
  constructor() {
    super(...arguments);
    this._unknown = true;
  }
  _parse(input) {
    return OK(input.data);
  }
};
ZodUnknown.create = (params) => {
  return new ZodUnknown({
    typeName: ZodFirstPartyTypeKind.ZodUnknown,
    ...processCreateParams(params)
  });
};
var ZodNever = class extends ZodType {
  _parse(input) {
    const ctx = this._getOrReturnCtx(input);
    addIssueToContext(ctx, {
      code: ZodIssueCode.invalid_type,
      expected: ZodParsedType.never,
      received: ctx.parsedType
    });
    return INVALID;
  }
};
ZodNever.create = (params) => {
  return new ZodNever({
    typeName: ZodFirstPartyTypeKind.ZodNever,
    ...processCreateParams(params)
  });
};
var ZodVoid = class extends ZodType {
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.undefined) {
      const ctx = this._getOrReturnCtx(input);
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.void,
        received: ctx.parsedType
      });
      return INVALID;
    }
    return OK(input.data);
  }
};
ZodVoid.create = (params) => {
  return new ZodVoid({
    typeName: ZodFirstPartyTypeKind.ZodVoid,
    ...processCreateParams(params)
  });
};
var ZodArray = class _ZodArray extends ZodType {
  _parse(input) {
    const { ctx, status } = this._processInputParams(input);
    const def = this._def;
    if (ctx.parsedType !== ZodParsedType.array) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.array,
        received: ctx.parsedType
      });
      return INVALID;
    }
    if (def.exactLength !== null) {
      const tooBig = ctx.data.length > def.exactLength.value;
      const tooSmall = ctx.data.length < def.exactLength.value;
      if (tooBig || tooSmall) {
        addIssueToContext(ctx, {
          code: tooBig ? ZodIssueCode.too_big : ZodIssueCode.too_small,
          minimum: tooSmall ? def.exactLength.value : void 0,
          maximum: tooBig ? def.exactLength.value : void 0,
          type: "array",
          inclusive: true,
          exact: true,
          message: def.exactLength.message
        });
        status.dirty();
      }
    }
    if (def.minLength !== null) {
      if (ctx.data.length < def.minLength.value) {
        addIssueToContext(ctx, {
          code: ZodIssueCode.too_small,
          minimum: def.minLength.value,
          type: "array",
          inclusive: true,
          exact: false,
          message: def.minLength.message
        });
        status.dirty();
      }
    }
    if (def.maxLength !== null) {
      if (ctx.data.length > def.maxLength.value) {
        addIssueToContext(ctx, {
          code: ZodIssueCode.too_big,
          maximum: def.maxLength.value,
          type: "array",
          inclusive: true,
          exact: false,
          message: def.maxLength.message
        });
        status.dirty();
      }
    }
    if (ctx.common.async) {
      return Promise.all([...ctx.data].map((item, i) => {
        return def.type._parseAsync(new ParseInputLazyPath(ctx, item, ctx.path, i));
      })).then((result2) => {
        return ParseStatus.mergeArray(status, result2);
      });
    }
    const result = [...ctx.data].map((item, i) => {
      return def.type._parseSync(new ParseInputLazyPath(ctx, item, ctx.path, i));
    });
    return ParseStatus.mergeArray(status, result);
  }
  get element() {
    return this._def.type;
  }
  min(minLength, message) {
    return new _ZodArray({
      ...this._def,
      minLength: { value: minLength, message: errorUtil.toString(message) }
    });
  }
  max(maxLength, message) {
    return new _ZodArray({
      ...this._def,
      maxLength: { value: maxLength, message: errorUtil.toString(message) }
    });
  }
  length(len, message) {
    return new _ZodArray({
      ...this._def,
      exactLength: { value: len, message: errorUtil.toString(message) }
    });
  }
  nonempty(message) {
    return this.min(1, message);
  }
};
ZodArray.create = (schema, params) => {
  return new ZodArray({
    type: schema,
    minLength: null,
    maxLength: null,
    exactLength: null,
    typeName: ZodFirstPartyTypeKind.ZodArray,
    ...processCreateParams(params)
  });
};
function deepPartialify(schema) {
  if (schema instanceof ZodObject) {
    const newShape = {};
    for (const key in schema.shape) {
      const fieldSchema = schema.shape[key];
      newShape[key] = ZodOptional.create(deepPartialify(fieldSchema));
    }
    return new ZodObject({
      ...schema._def,
      shape: () => newShape
    });
  } else if (schema instanceof ZodArray) {
    return new ZodArray({
      ...schema._def,
      type: deepPartialify(schema.element)
    });
  } else if (schema instanceof ZodOptional) {
    return ZodOptional.create(deepPartialify(schema.unwrap()));
  } else if (schema instanceof ZodNullable) {
    return ZodNullable.create(deepPartialify(schema.unwrap()));
  } else if (schema instanceof ZodTuple) {
    return ZodTuple.create(schema.items.map((item) => deepPartialify(item)));
  } else {
    return schema;
  }
}
var ZodObject = class _ZodObject extends ZodType {
  constructor() {
    super(...arguments);
    this._cached = null;
    this.nonstrict = this.passthrough;
    this.augment = this.extend;
  }
  _getCached() {
    if (this._cached !== null)
      return this._cached;
    const shape = this._def.shape();
    const keys = util.objectKeys(shape);
    this._cached = { shape, keys };
    return this._cached;
  }
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.object) {
      const ctx2 = this._getOrReturnCtx(input);
      addIssueToContext(ctx2, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.object,
        received: ctx2.parsedType
      });
      return INVALID;
    }
    const { status, ctx } = this._processInputParams(input);
    const { shape, keys: shapeKeys } = this._getCached();
    const extraKeys = [];
    if (!(this._def.catchall instanceof ZodNever && this._def.unknownKeys === "strip")) {
      for (const key in ctx.data) {
        if (!shapeKeys.includes(key)) {
          extraKeys.push(key);
        }
      }
    }
    const pairs = [];
    for (const key of shapeKeys) {
      const keyValidator = shape[key];
      const value = ctx.data[key];
      pairs.push({
        key: { status: "valid", value: key },
        value: keyValidator._parse(new ParseInputLazyPath(ctx, value, ctx.path, key)),
        alwaysSet: key in ctx.data
      });
    }
    if (this._def.catchall instanceof ZodNever) {
      const unknownKeys = this._def.unknownKeys;
      if (unknownKeys === "passthrough") {
        for (const key of extraKeys) {
          pairs.push({
            key: { status: "valid", value: key },
            value: { status: "valid", value: ctx.data[key] }
          });
        }
      } else if (unknownKeys === "strict") {
        if (extraKeys.length > 0) {
          addIssueToContext(ctx, {
            code: ZodIssueCode.unrecognized_keys,
            keys: extraKeys
          });
          status.dirty();
        }
      } else if (unknownKeys === "strip") {
      } else {
        throw new Error(`Internal ZodObject error: invalid unknownKeys value.`);
      }
    } else {
      const catchall = this._def.catchall;
      for (const key of extraKeys) {
        const value = ctx.data[key];
        pairs.push({
          key: { status: "valid", value: key },
          value: catchall._parse(
            new ParseInputLazyPath(ctx, value, ctx.path, key)
            //, ctx.child(key), value, getParsedType(value)
          ),
          alwaysSet: key in ctx.data
        });
      }
    }
    if (ctx.common.async) {
      return Promise.resolve().then(async () => {
        const syncPairs = [];
        for (const pair of pairs) {
          const key = await pair.key;
          const value = await pair.value;
          syncPairs.push({
            key,
            value,
            alwaysSet: pair.alwaysSet
          });
        }
        return syncPairs;
      }).then((syncPairs) => {
        return ParseStatus.mergeObjectSync(status, syncPairs);
      });
    } else {
      return ParseStatus.mergeObjectSync(status, pairs);
    }
  }
  get shape() {
    return this._def.shape();
  }
  strict(message) {
    errorUtil.errToObj;
    return new _ZodObject({
      ...this._def,
      unknownKeys: "strict",
      ...message !== void 0 ? {
        errorMap: (issue, ctx) => {
          const defaultError = this._def.errorMap?.(issue, ctx).message ?? ctx.defaultError;
          if (issue.code === "unrecognized_keys")
            return {
              message: errorUtil.errToObj(message).message ?? defaultError
            };
          return {
            message: defaultError
          };
        }
      } : {}
    });
  }
  strip() {
    return new _ZodObject({
      ...this._def,
      unknownKeys: "strip"
    });
  }
  passthrough() {
    return new _ZodObject({
      ...this._def,
      unknownKeys: "passthrough"
    });
  }
  // const AugmentFactory =
  //   <Def extends ZodObjectDef>(def: Def) =>
  //   <Augmentation extends ZodRawShape>(
  //     augmentation: Augmentation
  //   ): ZodObject<
  //     extendShape<ReturnType<Def["shape"]>, Augmentation>,
  //     Def["unknownKeys"],
  //     Def["catchall"]
  //   > => {
  //     return new ZodObject({
  //       ...def,
  //       shape: () => ({
  //         ...def.shape(),
  //         ...augmentation,
  //       }),
  //     }) as any;
  //   };
  extend(augmentation) {
    return new _ZodObject({
      ...this._def,
      shape: () => ({
        ...this._def.shape(),
        ...augmentation
      })
    });
  }
  /**
   * Prior to zod@1.0.12 there was a bug in the
   * inferred type of merged objects. Please
   * upgrade if you are experiencing issues.
   */
  merge(merging) {
    const merged = new _ZodObject({
      unknownKeys: merging._def.unknownKeys,
      catchall: merging._def.catchall,
      shape: () => ({
        ...this._def.shape(),
        ...merging._def.shape()
      }),
      typeName: ZodFirstPartyTypeKind.ZodObject
    });
    return merged;
  }
  // merge<
  //   Incoming extends AnyZodObject,
  //   Augmentation extends Incoming["shape"],
  //   NewOutput extends {
  //     [k in keyof Augmentation | keyof Output]: k extends keyof Augmentation
  //       ? Augmentation[k]["_output"]
  //       : k extends keyof Output
  //       ? Output[k]
  //       : never;
  //   },
  //   NewInput extends {
  //     [k in keyof Augmentation | keyof Input]: k extends keyof Augmentation
  //       ? Augmentation[k]["_input"]
  //       : k extends keyof Input
  //       ? Input[k]
  //       : never;
  //   }
  // >(
  //   merging: Incoming
  // ): ZodObject<
  //   extendShape<T, ReturnType<Incoming["_def"]["shape"]>>,
  //   Incoming["_def"]["unknownKeys"],
  //   Incoming["_def"]["catchall"],
  //   NewOutput,
  //   NewInput
  // > {
  //   const merged: any = new ZodObject({
  //     unknownKeys: merging._def.unknownKeys,
  //     catchall: merging._def.catchall,
  //     shape: () =>
  //       objectUtil.mergeShapes(this._def.shape(), merging._def.shape()),
  //     typeName: ZodFirstPartyTypeKind.ZodObject,
  //   }) as any;
  //   return merged;
  // }
  setKey(key, schema) {
    return this.augment({ [key]: schema });
  }
  // merge<Incoming extends AnyZodObject>(
  //   merging: Incoming
  // ): //ZodObject<T & Incoming["_shape"], UnknownKeys, Catchall> = (merging) => {
  // ZodObject<
  //   extendShape<T, ReturnType<Incoming["_def"]["shape"]>>,
  //   Incoming["_def"]["unknownKeys"],
  //   Incoming["_def"]["catchall"]
  // > {
  //   // const mergedShape = objectUtil.mergeShapes(
  //   //   this._def.shape(),
  //   //   merging._def.shape()
  //   // );
  //   const merged: any = new ZodObject({
  //     unknownKeys: merging._def.unknownKeys,
  //     catchall: merging._def.catchall,
  //     shape: () =>
  //       objectUtil.mergeShapes(this._def.shape(), merging._def.shape()),
  //     typeName: ZodFirstPartyTypeKind.ZodObject,
  //   }) as any;
  //   return merged;
  // }
  catchall(index) {
    return new _ZodObject({
      ...this._def,
      catchall: index
    });
  }
  pick(mask) {
    const shape = {};
    for (const key of util.objectKeys(mask)) {
      if (mask[key] && this.shape[key]) {
        shape[key] = this.shape[key];
      }
    }
    return new _ZodObject({
      ...this._def,
      shape: () => shape
    });
  }
  omit(mask) {
    const shape = {};
    for (const key of util.objectKeys(this.shape)) {
      if (!mask[key]) {
        shape[key] = this.shape[key];
      }
    }
    return new _ZodObject({
      ...this._def,
      shape: () => shape
    });
  }
  /**
   * @deprecated
   */
  deepPartial() {
    return deepPartialify(this);
  }
  partial(mask) {
    const newShape = {};
    for (const key of util.objectKeys(this.shape)) {
      const fieldSchema = this.shape[key];
      if (mask && !mask[key]) {
        newShape[key] = fieldSchema;
      } else {
        newShape[key] = fieldSchema.optional();
      }
    }
    return new _ZodObject({
      ...this._def,
      shape: () => newShape
    });
  }
  required(mask) {
    const newShape = {};
    for (const key of util.objectKeys(this.shape)) {
      if (mask && !mask[key]) {
        newShape[key] = this.shape[key];
      } else {
        const fieldSchema = this.shape[key];
        let newField = fieldSchema;
        while (newField instanceof ZodOptional) {
          newField = newField._def.innerType;
        }
        newShape[key] = newField;
      }
    }
    return new _ZodObject({
      ...this._def,
      shape: () => newShape
    });
  }
  keyof() {
    return createZodEnum(util.objectKeys(this.shape));
  }
};
ZodObject.create = (shape, params) => {
  return new ZodObject({
    shape: () => shape,
    unknownKeys: "strip",
    catchall: ZodNever.create(),
    typeName: ZodFirstPartyTypeKind.ZodObject,
    ...processCreateParams(params)
  });
};
ZodObject.strictCreate = (shape, params) => {
  return new ZodObject({
    shape: () => shape,
    unknownKeys: "strict",
    catchall: ZodNever.create(),
    typeName: ZodFirstPartyTypeKind.ZodObject,
    ...processCreateParams(params)
  });
};
ZodObject.lazycreate = (shape, params) => {
  return new ZodObject({
    shape,
    unknownKeys: "strip",
    catchall: ZodNever.create(),
    typeName: ZodFirstPartyTypeKind.ZodObject,
    ...processCreateParams(params)
  });
};
var ZodUnion = class extends ZodType {
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    const options = this._def.options;
    function handleResults(results) {
      for (const result of results) {
        if (result.result.status === "valid") {
          return result.result;
        }
      }
      for (const result of results) {
        if (result.result.status === "dirty") {
          ctx.common.issues.push(...result.ctx.common.issues);
          return result.result;
        }
      }
      const unionErrors = results.map((result) => new ZodError(result.ctx.common.issues));
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_union,
        unionErrors
      });
      return INVALID;
    }
    if (ctx.common.async) {
      return Promise.all(options.map(async (option) => {
        const childCtx = {
          ...ctx,
          common: {
            ...ctx.common,
            issues: []
          },
          parent: null
        };
        return {
          result: await option._parseAsync({
            data: ctx.data,
            path: ctx.path,
            parent: childCtx
          }),
          ctx: childCtx
        };
      })).then(handleResults);
    } else {
      let dirty = void 0;
      const issues = [];
      for (const option of options) {
        const childCtx = {
          ...ctx,
          common: {
            ...ctx.common,
            issues: []
          },
          parent: null
        };
        const result = option._parseSync({
          data: ctx.data,
          path: ctx.path,
          parent: childCtx
        });
        if (result.status === "valid") {
          return result;
        } else if (result.status === "dirty" && !dirty) {
          dirty = { result, ctx: childCtx };
        }
        if (childCtx.common.issues.length) {
          issues.push(childCtx.common.issues);
        }
      }
      if (dirty) {
        ctx.common.issues.push(...dirty.ctx.common.issues);
        return dirty.result;
      }
      const unionErrors = issues.map((issues2) => new ZodError(issues2));
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_union,
        unionErrors
      });
      return INVALID;
    }
  }
  get options() {
    return this._def.options;
  }
};
ZodUnion.create = (types, params) => {
  return new ZodUnion({
    options: types,
    typeName: ZodFirstPartyTypeKind.ZodUnion,
    ...processCreateParams(params)
  });
};
var getDiscriminator = (type) => {
  if (type instanceof ZodLazy) {
    return getDiscriminator(type.schema);
  } else if (type instanceof ZodEffects) {
    return getDiscriminator(type.innerType());
  } else if (type instanceof ZodLiteral) {
    return [type.value];
  } else if (type instanceof ZodEnum) {
    return type.options;
  } else if (type instanceof ZodNativeEnum) {
    return util.objectValues(type.enum);
  } else if (type instanceof ZodDefault) {
    return getDiscriminator(type._def.innerType);
  } else if (type instanceof ZodUndefined) {
    return [void 0];
  } else if (type instanceof ZodNull) {
    return [null];
  } else if (type instanceof ZodOptional) {
    return [void 0, ...getDiscriminator(type.unwrap())];
  } else if (type instanceof ZodNullable) {
    return [null, ...getDiscriminator(type.unwrap())];
  } else if (type instanceof ZodBranded) {
    return getDiscriminator(type.unwrap());
  } else if (type instanceof ZodReadonly) {
    return getDiscriminator(type.unwrap());
  } else if (type instanceof ZodCatch) {
    return getDiscriminator(type._def.innerType);
  } else {
    return [];
  }
};
var ZodDiscriminatedUnion = class _ZodDiscriminatedUnion extends ZodType {
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    if (ctx.parsedType !== ZodParsedType.object) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.object,
        received: ctx.parsedType
      });
      return INVALID;
    }
    const discriminator = this.discriminator;
    const discriminatorValue = ctx.data[discriminator];
    const option = this.optionsMap.get(discriminatorValue);
    if (!option) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_union_discriminator,
        options: Array.from(this.optionsMap.keys()),
        path: [discriminator]
      });
      return INVALID;
    }
    if (ctx.common.async) {
      return option._parseAsync({
        data: ctx.data,
        path: ctx.path,
        parent: ctx
      });
    } else {
      return option._parseSync({
        data: ctx.data,
        path: ctx.path,
        parent: ctx
      });
    }
  }
  get discriminator() {
    return this._def.discriminator;
  }
  get options() {
    return this._def.options;
  }
  get optionsMap() {
    return this._def.optionsMap;
  }
  /**
   * The constructor of the discriminated union schema. Its behaviour is very similar to that of the normal z.union() constructor.
   * However, it only allows a union of objects, all of which need to share a discriminator property. This property must
   * have a different value for each object in the union.
   * @param discriminator the name of the discriminator property
   * @param types an array of object schemas
   * @param params
   */
  static create(discriminator, options, params) {
    const optionsMap = /* @__PURE__ */ new Map();
    for (const type of options) {
      const discriminatorValues = getDiscriminator(type.shape[discriminator]);
      if (!discriminatorValues.length) {
        throw new Error(`A discriminator value for key \`${discriminator}\` could not be extracted from all schema options`);
      }
      for (const value of discriminatorValues) {
        if (optionsMap.has(value)) {
          throw new Error(`Discriminator property ${String(discriminator)} has duplicate value ${String(value)}`);
        }
        optionsMap.set(value, type);
      }
    }
    return new _ZodDiscriminatedUnion({
      typeName: ZodFirstPartyTypeKind.ZodDiscriminatedUnion,
      discriminator,
      options,
      optionsMap,
      ...processCreateParams(params)
    });
  }
};
function mergeValues(a, b) {
  const aType = getParsedType(a);
  const bType = getParsedType(b);
  if (a === b) {
    return { valid: true, data: a };
  } else if (aType === ZodParsedType.object && bType === ZodParsedType.object) {
    const bKeys = util.objectKeys(b);
    const sharedKeys = util.objectKeys(a).filter((key) => bKeys.indexOf(key) !== -1);
    const newObj = { ...a, ...b };
    for (const key of sharedKeys) {
      const sharedValue = mergeValues(a[key], b[key]);
      if (!sharedValue.valid) {
        return { valid: false };
      }
      newObj[key] = sharedValue.data;
    }
    return { valid: true, data: newObj };
  } else if (aType === ZodParsedType.array && bType === ZodParsedType.array) {
    if (a.length !== b.length) {
      return { valid: false };
    }
    const newArray = [];
    for (let index = 0; index < a.length; index++) {
      const itemA = a[index];
      const itemB = b[index];
      const sharedValue = mergeValues(itemA, itemB);
      if (!sharedValue.valid) {
        return { valid: false };
      }
      newArray.push(sharedValue.data);
    }
    return { valid: true, data: newArray };
  } else if (aType === ZodParsedType.date && bType === ZodParsedType.date && +a === +b) {
    return { valid: true, data: a };
  } else {
    return { valid: false };
  }
}
var ZodIntersection = class extends ZodType {
  _parse(input) {
    const { status, ctx } = this._processInputParams(input);
    const handleParsed = (parsedLeft, parsedRight) => {
      if (isAborted(parsedLeft) || isAborted(parsedRight)) {
        return INVALID;
      }
      const merged = mergeValues(parsedLeft.value, parsedRight.value);
      if (!merged.valid) {
        addIssueToContext(ctx, {
          code: ZodIssueCode.invalid_intersection_types
        });
        return INVALID;
      }
      if (isDirty(parsedLeft) || isDirty(parsedRight)) {
        status.dirty();
      }
      return { status: status.value, value: merged.data };
    };
    if (ctx.common.async) {
      return Promise.all([
        this._def.left._parseAsync({
          data: ctx.data,
          path: ctx.path,
          parent: ctx
        }),
        this._def.right._parseAsync({
          data: ctx.data,
          path: ctx.path,
          parent: ctx
        })
      ]).then(([left, right]) => handleParsed(left, right));
    } else {
      return handleParsed(this._def.left._parseSync({
        data: ctx.data,
        path: ctx.path,
        parent: ctx
      }), this._def.right._parseSync({
        data: ctx.data,
        path: ctx.path,
        parent: ctx
      }));
    }
  }
};
ZodIntersection.create = (left, right, params) => {
  return new ZodIntersection({
    left,
    right,
    typeName: ZodFirstPartyTypeKind.ZodIntersection,
    ...processCreateParams(params)
  });
};
var ZodTuple = class _ZodTuple extends ZodType {
  _parse(input) {
    const { status, ctx } = this._processInputParams(input);
    if (ctx.parsedType !== ZodParsedType.array) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.array,
        received: ctx.parsedType
      });
      return INVALID;
    }
    if (ctx.data.length < this._def.items.length) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.too_small,
        minimum: this._def.items.length,
        inclusive: true,
        exact: false,
        type: "array"
      });
      return INVALID;
    }
    const rest = this._def.rest;
    if (!rest && ctx.data.length > this._def.items.length) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.too_big,
        maximum: this._def.items.length,
        inclusive: true,
        exact: false,
        type: "array"
      });
      status.dirty();
    }
    const items = [...ctx.data].map((item, itemIndex) => {
      const schema = this._def.items[itemIndex] || this._def.rest;
      if (!schema)
        return null;
      return schema._parse(new ParseInputLazyPath(ctx, item, ctx.path, itemIndex));
    }).filter((x) => !!x);
    if (ctx.common.async) {
      return Promise.all(items).then((results) => {
        return ParseStatus.mergeArray(status, results);
      });
    } else {
      return ParseStatus.mergeArray(status, items);
    }
  }
  get items() {
    return this._def.items;
  }
  rest(rest) {
    return new _ZodTuple({
      ...this._def,
      rest
    });
  }
};
ZodTuple.create = (schemas, params) => {
  if (!Array.isArray(schemas)) {
    throw new Error("You must pass an array of schemas to z.tuple([ ... ])");
  }
  return new ZodTuple({
    items: schemas,
    typeName: ZodFirstPartyTypeKind.ZodTuple,
    rest: null,
    ...processCreateParams(params)
  });
};
var ZodRecord = class _ZodRecord extends ZodType {
  get keySchema() {
    return this._def.keyType;
  }
  get valueSchema() {
    return this._def.valueType;
  }
  _parse(input) {
    const { status, ctx } = this._processInputParams(input);
    if (ctx.parsedType !== ZodParsedType.object) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.object,
        received: ctx.parsedType
      });
      return INVALID;
    }
    const pairs = [];
    const keyType = this._def.keyType;
    const valueType = this._def.valueType;
    for (const key in ctx.data) {
      pairs.push({
        key: keyType._parse(new ParseInputLazyPath(ctx, key, ctx.path, key)),
        value: valueType._parse(new ParseInputLazyPath(ctx, ctx.data[key], ctx.path, key)),
        alwaysSet: key in ctx.data
      });
    }
    if (ctx.common.async) {
      return ParseStatus.mergeObjectAsync(status, pairs);
    } else {
      return ParseStatus.mergeObjectSync(status, pairs);
    }
  }
  get element() {
    return this._def.valueType;
  }
  static create(first, second, third) {
    if (second instanceof ZodType) {
      return new _ZodRecord({
        keyType: first,
        valueType: second,
        typeName: ZodFirstPartyTypeKind.ZodRecord,
        ...processCreateParams(third)
      });
    }
    return new _ZodRecord({
      keyType: ZodString.create(),
      valueType: first,
      typeName: ZodFirstPartyTypeKind.ZodRecord,
      ...processCreateParams(second)
    });
  }
};
var ZodMap = class extends ZodType {
  get keySchema() {
    return this._def.keyType;
  }
  get valueSchema() {
    return this._def.valueType;
  }
  _parse(input) {
    const { status, ctx } = this._processInputParams(input);
    if (ctx.parsedType !== ZodParsedType.map) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.map,
        received: ctx.parsedType
      });
      return INVALID;
    }
    const keyType = this._def.keyType;
    const valueType = this._def.valueType;
    const pairs = [...ctx.data.entries()].map(([key, value], index) => {
      return {
        key: keyType._parse(new ParseInputLazyPath(ctx, key, ctx.path, [index, "key"])),
        value: valueType._parse(new ParseInputLazyPath(ctx, value, ctx.path, [index, "value"]))
      };
    });
    if (ctx.common.async) {
      const finalMap = /* @__PURE__ */ new Map();
      return Promise.resolve().then(async () => {
        for (const pair of pairs) {
          const key = await pair.key;
          const value = await pair.value;
          if (key.status === "aborted" || value.status === "aborted") {
            return INVALID;
          }
          if (key.status === "dirty" || value.status === "dirty") {
            status.dirty();
          }
          finalMap.set(key.value, value.value);
        }
        return { status: status.value, value: finalMap };
      });
    } else {
      const finalMap = /* @__PURE__ */ new Map();
      for (const pair of pairs) {
        const key = pair.key;
        const value = pair.value;
        if (key.status === "aborted" || value.status === "aborted") {
          return INVALID;
        }
        if (key.status === "dirty" || value.status === "dirty") {
          status.dirty();
        }
        finalMap.set(key.value, value.value);
      }
      return { status: status.value, value: finalMap };
    }
  }
};
ZodMap.create = (keyType, valueType, params) => {
  return new ZodMap({
    valueType,
    keyType,
    typeName: ZodFirstPartyTypeKind.ZodMap,
    ...processCreateParams(params)
  });
};
var ZodSet = class _ZodSet extends ZodType {
  _parse(input) {
    const { status, ctx } = this._processInputParams(input);
    if (ctx.parsedType !== ZodParsedType.set) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.set,
        received: ctx.parsedType
      });
      return INVALID;
    }
    const def = this._def;
    if (def.minSize !== null) {
      if (ctx.data.size < def.minSize.value) {
        addIssueToContext(ctx, {
          code: ZodIssueCode.too_small,
          minimum: def.minSize.value,
          type: "set",
          inclusive: true,
          exact: false,
          message: def.minSize.message
        });
        status.dirty();
      }
    }
    if (def.maxSize !== null) {
      if (ctx.data.size > def.maxSize.value) {
        addIssueToContext(ctx, {
          code: ZodIssueCode.too_big,
          maximum: def.maxSize.value,
          type: "set",
          inclusive: true,
          exact: false,
          message: def.maxSize.message
        });
        status.dirty();
      }
    }
    const valueType = this._def.valueType;
    function finalizeSet(elements2) {
      const parsedSet = /* @__PURE__ */ new Set();
      for (const element of elements2) {
        if (element.status === "aborted")
          return INVALID;
        if (element.status === "dirty")
          status.dirty();
        parsedSet.add(element.value);
      }
      return { status: status.value, value: parsedSet };
    }
    const elements = [...ctx.data.values()].map((item, i) => valueType._parse(new ParseInputLazyPath(ctx, item, ctx.path, i)));
    if (ctx.common.async) {
      return Promise.all(elements).then((elements2) => finalizeSet(elements2));
    } else {
      return finalizeSet(elements);
    }
  }
  min(minSize, message) {
    return new _ZodSet({
      ...this._def,
      minSize: { value: minSize, message: errorUtil.toString(message) }
    });
  }
  max(maxSize, message) {
    return new _ZodSet({
      ...this._def,
      maxSize: { value: maxSize, message: errorUtil.toString(message) }
    });
  }
  size(size, message) {
    return this.min(size, message).max(size, message);
  }
  nonempty(message) {
    return this.min(1, message);
  }
};
ZodSet.create = (valueType, params) => {
  return new ZodSet({
    valueType,
    minSize: null,
    maxSize: null,
    typeName: ZodFirstPartyTypeKind.ZodSet,
    ...processCreateParams(params)
  });
};
var ZodFunction = class _ZodFunction extends ZodType {
  constructor() {
    super(...arguments);
    this.validate = this.implement;
  }
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    if (ctx.parsedType !== ZodParsedType.function) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.function,
        received: ctx.parsedType
      });
      return INVALID;
    }
    function makeArgsIssue(args, error) {
      return makeIssue({
        data: args,
        path: ctx.path,
        errorMaps: [ctx.common.contextualErrorMap, ctx.schemaErrorMap, getErrorMap(), en_default].filter((x) => !!x),
        issueData: {
          code: ZodIssueCode.invalid_arguments,
          argumentsError: error
        }
      });
    }
    function makeReturnsIssue(returns, error) {
      return makeIssue({
        data: returns,
        path: ctx.path,
        errorMaps: [ctx.common.contextualErrorMap, ctx.schemaErrorMap, getErrorMap(), en_default].filter((x) => !!x),
        issueData: {
          code: ZodIssueCode.invalid_return_type,
          returnTypeError: error
        }
      });
    }
    const params = { errorMap: ctx.common.contextualErrorMap };
    const fn = ctx.data;
    if (this._def.returns instanceof ZodPromise) {
      const me = this;
      return OK(async function(...args) {
        const error = new ZodError([]);
        const parsedArgs = await me._def.args.parseAsync(args, params).catch((e) => {
          error.addIssue(makeArgsIssue(args, e));
          throw error;
        });
        const result = await Reflect.apply(fn, this, parsedArgs);
        const parsedReturns = await me._def.returns._def.type.parseAsync(result, params).catch((e) => {
          error.addIssue(makeReturnsIssue(result, e));
          throw error;
        });
        return parsedReturns;
      });
    } else {
      const me = this;
      return OK(function(...args) {
        const parsedArgs = me._def.args.safeParse(args, params);
        if (!parsedArgs.success) {
          throw new ZodError([makeArgsIssue(args, parsedArgs.error)]);
        }
        const result = Reflect.apply(fn, this, parsedArgs.data);
        const parsedReturns = me._def.returns.safeParse(result, params);
        if (!parsedReturns.success) {
          throw new ZodError([makeReturnsIssue(result, parsedReturns.error)]);
        }
        return parsedReturns.data;
      });
    }
  }
  parameters() {
    return this._def.args;
  }
  returnType() {
    return this._def.returns;
  }
  args(...items) {
    return new _ZodFunction({
      ...this._def,
      args: ZodTuple.create(items).rest(ZodUnknown.create())
    });
  }
  returns(returnType) {
    return new _ZodFunction({
      ...this._def,
      returns: returnType
    });
  }
  implement(func) {
    const validatedFunc = this.parse(func);
    return validatedFunc;
  }
  strictImplement(func) {
    const validatedFunc = this.parse(func);
    return validatedFunc;
  }
  static create(args, returns, params) {
    return new _ZodFunction({
      args: args ? args : ZodTuple.create([]).rest(ZodUnknown.create()),
      returns: returns || ZodUnknown.create(),
      typeName: ZodFirstPartyTypeKind.ZodFunction,
      ...processCreateParams(params)
    });
  }
};
var ZodLazy = class extends ZodType {
  get schema() {
    return this._def.getter();
  }
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    const lazySchema = this._def.getter();
    return lazySchema._parse({ data: ctx.data, path: ctx.path, parent: ctx });
  }
};
ZodLazy.create = (getter, params) => {
  return new ZodLazy({
    getter,
    typeName: ZodFirstPartyTypeKind.ZodLazy,
    ...processCreateParams(params)
  });
};
var ZodLiteral = class extends ZodType {
  _parse(input) {
    if (input.data !== this._def.value) {
      const ctx = this._getOrReturnCtx(input);
      addIssueToContext(ctx, {
        received: ctx.data,
        code: ZodIssueCode.invalid_literal,
        expected: this._def.value
      });
      return INVALID;
    }
    return { status: "valid", value: input.data };
  }
  get value() {
    return this._def.value;
  }
};
ZodLiteral.create = (value, params) => {
  return new ZodLiteral({
    value,
    typeName: ZodFirstPartyTypeKind.ZodLiteral,
    ...processCreateParams(params)
  });
};
function createZodEnum(values, params) {
  return new ZodEnum({
    values,
    typeName: ZodFirstPartyTypeKind.ZodEnum,
    ...processCreateParams(params)
  });
}
var ZodEnum = class _ZodEnum extends ZodType {
  _parse(input) {
    if (typeof input.data !== "string") {
      const ctx = this._getOrReturnCtx(input);
      const expectedValues = this._def.values;
      addIssueToContext(ctx, {
        expected: util.joinValues(expectedValues),
        received: ctx.parsedType,
        code: ZodIssueCode.invalid_type
      });
      return INVALID;
    }
    if (!this._cache) {
      this._cache = new Set(this._def.values);
    }
    if (!this._cache.has(input.data)) {
      const ctx = this._getOrReturnCtx(input);
      const expectedValues = this._def.values;
      addIssueToContext(ctx, {
        received: ctx.data,
        code: ZodIssueCode.invalid_enum_value,
        options: expectedValues
      });
      return INVALID;
    }
    return OK(input.data);
  }
  get options() {
    return this._def.values;
  }
  get enum() {
    const enumValues = {};
    for (const val of this._def.values) {
      enumValues[val] = val;
    }
    return enumValues;
  }
  get Values() {
    const enumValues = {};
    for (const val of this._def.values) {
      enumValues[val] = val;
    }
    return enumValues;
  }
  get Enum() {
    const enumValues = {};
    for (const val of this._def.values) {
      enumValues[val] = val;
    }
    return enumValues;
  }
  extract(values, newDef = this._def) {
    return _ZodEnum.create(values, {
      ...this._def,
      ...newDef
    });
  }
  exclude(values, newDef = this._def) {
    return _ZodEnum.create(this.options.filter((opt) => !values.includes(opt)), {
      ...this._def,
      ...newDef
    });
  }
};
ZodEnum.create = createZodEnum;
var ZodNativeEnum = class extends ZodType {
  _parse(input) {
    const nativeEnumValues = util.getValidEnumValues(this._def.values);
    const ctx = this._getOrReturnCtx(input);
    if (ctx.parsedType !== ZodParsedType.string && ctx.parsedType !== ZodParsedType.number) {
      const expectedValues = util.objectValues(nativeEnumValues);
      addIssueToContext(ctx, {
        expected: util.joinValues(expectedValues),
        received: ctx.parsedType,
        code: ZodIssueCode.invalid_type
      });
      return INVALID;
    }
    if (!this._cache) {
      this._cache = new Set(util.getValidEnumValues(this._def.values));
    }
    if (!this._cache.has(input.data)) {
      const expectedValues = util.objectValues(nativeEnumValues);
      addIssueToContext(ctx, {
        received: ctx.data,
        code: ZodIssueCode.invalid_enum_value,
        options: expectedValues
      });
      return INVALID;
    }
    return OK(input.data);
  }
  get enum() {
    return this._def.values;
  }
};
ZodNativeEnum.create = (values, params) => {
  return new ZodNativeEnum({
    values,
    typeName: ZodFirstPartyTypeKind.ZodNativeEnum,
    ...processCreateParams(params)
  });
};
var ZodPromise = class extends ZodType {
  unwrap() {
    return this._def.type;
  }
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    if (ctx.parsedType !== ZodParsedType.promise && ctx.common.async === false) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.promise,
        received: ctx.parsedType
      });
      return INVALID;
    }
    const promisified = ctx.parsedType === ZodParsedType.promise ? ctx.data : Promise.resolve(ctx.data);
    return OK(promisified.then((data) => {
      return this._def.type.parseAsync(data, {
        path: ctx.path,
        errorMap: ctx.common.contextualErrorMap
      });
    }));
  }
};
ZodPromise.create = (schema, params) => {
  return new ZodPromise({
    type: schema,
    typeName: ZodFirstPartyTypeKind.ZodPromise,
    ...processCreateParams(params)
  });
};
var ZodEffects = class extends ZodType {
  innerType() {
    return this._def.schema;
  }
  sourceType() {
    return this._def.schema._def.typeName === ZodFirstPartyTypeKind.ZodEffects ? this._def.schema.sourceType() : this._def.schema;
  }
  _parse(input) {
    const { status, ctx } = this._processInputParams(input);
    const effect = this._def.effect || null;
    const checkCtx = {
      addIssue: (arg) => {
        addIssueToContext(ctx, arg);
        if (arg.fatal) {
          status.abort();
        } else {
          status.dirty();
        }
      },
      get path() {
        return ctx.path;
      }
    };
    checkCtx.addIssue = checkCtx.addIssue.bind(checkCtx);
    if (effect.type === "preprocess") {
      const processed = effect.transform(ctx.data, checkCtx);
      if (ctx.common.async) {
        return Promise.resolve(processed).then(async (processed2) => {
          if (status.value === "aborted")
            return INVALID;
          const result = await this._def.schema._parseAsync({
            data: processed2,
            path: ctx.path,
            parent: ctx
          });
          if (result.status === "aborted")
            return INVALID;
          if (result.status === "dirty")
            return DIRTY(result.value);
          if (status.value === "dirty")
            return DIRTY(result.value);
          return result;
        });
      } else {
        if (status.value === "aborted")
          return INVALID;
        const result = this._def.schema._parseSync({
          data: processed,
          path: ctx.path,
          parent: ctx
        });
        if (result.status === "aborted")
          return INVALID;
        if (result.status === "dirty")
          return DIRTY(result.value);
        if (status.value === "dirty")
          return DIRTY(result.value);
        return result;
      }
    }
    if (effect.type === "refinement") {
      const executeRefinement = (acc) => {
        const result = effect.refinement(acc, checkCtx);
        if (ctx.common.async) {
          return Promise.resolve(result);
        }
        if (result instanceof Promise) {
          throw new Error("Async refinement encountered during synchronous parse operation. Use .parseAsync instead.");
        }
        return acc;
      };
      if (ctx.common.async === false) {
        const inner = this._def.schema._parseSync({
          data: ctx.data,
          path: ctx.path,
          parent: ctx
        });
        if (inner.status === "aborted")
          return INVALID;
        if (inner.status === "dirty")
          status.dirty();
        executeRefinement(inner.value);
        return { status: status.value, value: inner.value };
      } else {
        return this._def.schema._parseAsync({ data: ctx.data, path: ctx.path, parent: ctx }).then((inner) => {
          if (inner.status === "aborted")
            return INVALID;
          if (inner.status === "dirty")
            status.dirty();
          return executeRefinement(inner.value).then(() => {
            return { status: status.value, value: inner.value };
          });
        });
      }
    }
    if (effect.type === "transform") {
      if (ctx.common.async === false) {
        const base = this._def.schema._parseSync({
          data: ctx.data,
          path: ctx.path,
          parent: ctx
        });
        if (!isValid(base))
          return INVALID;
        const result = effect.transform(base.value, checkCtx);
        if (result instanceof Promise) {
          throw new Error(`Asynchronous transform encountered during synchronous parse operation. Use .parseAsync instead.`);
        }
        return { status: status.value, value: result };
      } else {
        return this._def.schema._parseAsync({ data: ctx.data, path: ctx.path, parent: ctx }).then((base) => {
          if (!isValid(base))
            return INVALID;
          return Promise.resolve(effect.transform(base.value, checkCtx)).then((result) => ({
            status: status.value,
            value: result
          }));
        });
      }
    }
    util.assertNever(effect);
  }
};
ZodEffects.create = (schema, effect, params) => {
  return new ZodEffects({
    schema,
    typeName: ZodFirstPartyTypeKind.ZodEffects,
    effect,
    ...processCreateParams(params)
  });
};
ZodEffects.createWithPreprocess = (preprocess, schema, params) => {
  return new ZodEffects({
    schema,
    effect: { type: "preprocess", transform: preprocess },
    typeName: ZodFirstPartyTypeKind.ZodEffects,
    ...processCreateParams(params)
  });
};
var ZodOptional = class extends ZodType {
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType === ZodParsedType.undefined) {
      return OK(void 0);
    }
    return this._def.innerType._parse(input);
  }
  unwrap() {
    return this._def.innerType;
  }
};
ZodOptional.create = (type, params) => {
  return new ZodOptional({
    innerType: type,
    typeName: ZodFirstPartyTypeKind.ZodOptional,
    ...processCreateParams(params)
  });
};
var ZodNullable = class extends ZodType {
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType === ZodParsedType.null) {
      return OK(null);
    }
    return this._def.innerType._parse(input);
  }
  unwrap() {
    return this._def.innerType;
  }
};
ZodNullable.create = (type, params) => {
  return new ZodNullable({
    innerType: type,
    typeName: ZodFirstPartyTypeKind.ZodNullable,
    ...processCreateParams(params)
  });
};
var ZodDefault = class extends ZodType {
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    let data = ctx.data;
    if (ctx.parsedType === ZodParsedType.undefined) {
      data = this._def.defaultValue();
    }
    return this._def.innerType._parse({
      data,
      path: ctx.path,
      parent: ctx
    });
  }
  removeDefault() {
    return this._def.innerType;
  }
};
ZodDefault.create = (type, params) => {
  return new ZodDefault({
    innerType: type,
    typeName: ZodFirstPartyTypeKind.ZodDefault,
    defaultValue: typeof params.default === "function" ? params.default : () => params.default,
    ...processCreateParams(params)
  });
};
var ZodCatch = class extends ZodType {
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    const newCtx = {
      ...ctx,
      common: {
        ...ctx.common,
        issues: []
      }
    };
    const result = this._def.innerType._parse({
      data: newCtx.data,
      path: newCtx.path,
      parent: {
        ...newCtx
      }
    });
    if (isAsync(result)) {
      return result.then((result2) => {
        return {
          status: "valid",
          value: result2.status === "valid" ? result2.value : this._def.catchValue({
            get error() {
              return new ZodError(newCtx.common.issues);
            },
            input: newCtx.data
          })
        };
      });
    } else {
      return {
        status: "valid",
        value: result.status === "valid" ? result.value : this._def.catchValue({
          get error() {
            return new ZodError(newCtx.common.issues);
          },
          input: newCtx.data
        })
      };
    }
  }
  removeCatch() {
    return this._def.innerType;
  }
};
ZodCatch.create = (type, params) => {
  return new ZodCatch({
    innerType: type,
    typeName: ZodFirstPartyTypeKind.ZodCatch,
    catchValue: typeof params.catch === "function" ? params.catch : () => params.catch,
    ...processCreateParams(params)
  });
};
var ZodNaN = class extends ZodType {
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.nan) {
      const ctx = this._getOrReturnCtx(input);
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.nan,
        received: ctx.parsedType
      });
      return INVALID;
    }
    return { status: "valid", value: input.data };
  }
};
ZodNaN.create = (params) => {
  return new ZodNaN({
    typeName: ZodFirstPartyTypeKind.ZodNaN,
    ...processCreateParams(params)
  });
};
var BRAND = Symbol("zod_brand");
var ZodBranded = class extends ZodType {
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    const data = ctx.data;
    return this._def.type._parse({
      data,
      path: ctx.path,
      parent: ctx
    });
  }
  unwrap() {
    return this._def.type;
  }
};
var ZodPipeline = class _ZodPipeline extends ZodType {
  _parse(input) {
    const { status, ctx } = this._processInputParams(input);
    if (ctx.common.async) {
      const handleAsync = async () => {
        const inResult = await this._def.in._parseAsync({
          data: ctx.data,
          path: ctx.path,
          parent: ctx
        });
        if (inResult.status === "aborted")
          return INVALID;
        if (inResult.status === "dirty") {
          status.dirty();
          return DIRTY(inResult.value);
        } else {
          return this._def.out._parseAsync({
            data: inResult.value,
            path: ctx.path,
            parent: ctx
          });
        }
      };
      return handleAsync();
    } else {
      const inResult = this._def.in._parseSync({
        data: ctx.data,
        path: ctx.path,
        parent: ctx
      });
      if (inResult.status === "aborted")
        return INVALID;
      if (inResult.status === "dirty") {
        status.dirty();
        return {
          status: "dirty",
          value: inResult.value
        };
      } else {
        return this._def.out._parseSync({
          data: inResult.value,
          path: ctx.path,
          parent: ctx
        });
      }
    }
  }
  static create(a, b) {
    return new _ZodPipeline({
      in: a,
      out: b,
      typeName: ZodFirstPartyTypeKind.ZodPipeline
    });
  }
};
var ZodReadonly = class extends ZodType {
  _parse(input) {
    const result = this._def.innerType._parse(input);
    const freeze = (data) => {
      if (isValid(data)) {
        data.value = Object.freeze(data.value);
      }
      return data;
    };
    return isAsync(result) ? result.then((data) => freeze(data)) : freeze(result);
  }
  unwrap() {
    return this._def.innerType;
  }
};
ZodReadonly.create = (type, params) => {
  return new ZodReadonly({
    innerType: type,
    typeName: ZodFirstPartyTypeKind.ZodReadonly,
    ...processCreateParams(params)
  });
};
function cleanParams(params, data) {
  const p = typeof params === "function" ? params(data) : typeof params === "string" ? { message: params } : params;
  const p2 = typeof p === "string" ? { message: p } : p;
  return p2;
}
function custom(check, _params = {}, fatal) {
  if (check)
    return ZodAny.create().superRefine((data, ctx) => {
      const r = check(data);
      if (r instanceof Promise) {
        return r.then((r2) => {
          if (!r2) {
            const params = cleanParams(_params, data);
            const _fatal = params.fatal ?? fatal ?? true;
            ctx.addIssue({ code: "custom", ...params, fatal: _fatal });
          }
        });
      }
      if (!r) {
        const params = cleanParams(_params, data);
        const _fatal = params.fatal ?? fatal ?? true;
        ctx.addIssue({ code: "custom", ...params, fatal: _fatal });
      }
      return;
    });
  return ZodAny.create();
}
var late = {
  object: ZodObject.lazycreate
};
var ZodFirstPartyTypeKind;
(function(ZodFirstPartyTypeKind2) {
  ZodFirstPartyTypeKind2["ZodString"] = "ZodString";
  ZodFirstPartyTypeKind2["ZodNumber"] = "ZodNumber";
  ZodFirstPartyTypeKind2["ZodNaN"] = "ZodNaN";
  ZodFirstPartyTypeKind2["ZodBigInt"] = "ZodBigInt";
  ZodFirstPartyTypeKind2["ZodBoolean"] = "ZodBoolean";
  ZodFirstPartyTypeKind2["ZodDate"] = "ZodDate";
  ZodFirstPartyTypeKind2["ZodSymbol"] = "ZodSymbol";
  ZodFirstPartyTypeKind2["ZodUndefined"] = "ZodUndefined";
  ZodFirstPartyTypeKind2["ZodNull"] = "ZodNull";
  ZodFirstPartyTypeKind2["ZodAny"] = "ZodAny";
  ZodFirstPartyTypeKind2["ZodUnknown"] = "ZodUnknown";
  ZodFirstPartyTypeKind2["ZodNever"] = "ZodNever";
  ZodFirstPartyTypeKind2["ZodVoid"] = "ZodVoid";
  ZodFirstPartyTypeKind2["ZodArray"] = "ZodArray";
  ZodFirstPartyTypeKind2["ZodObject"] = "ZodObject";
  ZodFirstPartyTypeKind2["ZodUnion"] = "ZodUnion";
  ZodFirstPartyTypeKind2["ZodDiscriminatedUnion"] = "ZodDiscriminatedUnion";
  ZodFirstPartyTypeKind2["ZodIntersection"] = "ZodIntersection";
  ZodFirstPartyTypeKind2["ZodTuple"] = "ZodTuple";
  ZodFirstPartyTypeKind2["ZodRecord"] = "ZodRecord";
  ZodFirstPartyTypeKind2["ZodMap"] = "ZodMap";
  ZodFirstPartyTypeKind2["ZodSet"] = "ZodSet";
  ZodFirstPartyTypeKind2["ZodFunction"] = "ZodFunction";
  ZodFirstPartyTypeKind2["ZodLazy"] = "ZodLazy";
  ZodFirstPartyTypeKind2["ZodLiteral"] = "ZodLiteral";
  ZodFirstPartyTypeKind2["ZodEnum"] = "ZodEnum";
  ZodFirstPartyTypeKind2["ZodEffects"] = "ZodEffects";
  ZodFirstPartyTypeKind2["ZodNativeEnum"] = "ZodNativeEnum";
  ZodFirstPartyTypeKind2["ZodOptional"] = "ZodOptional";
  ZodFirstPartyTypeKind2["ZodNullable"] = "ZodNullable";
  ZodFirstPartyTypeKind2["ZodDefault"] = "ZodDefault";
  ZodFirstPartyTypeKind2["ZodCatch"] = "ZodCatch";
  ZodFirstPartyTypeKind2["ZodPromise"] = "ZodPromise";
  ZodFirstPartyTypeKind2["ZodBranded"] = "ZodBranded";
  ZodFirstPartyTypeKind2["ZodPipeline"] = "ZodPipeline";
  ZodFirstPartyTypeKind2["ZodReadonly"] = "ZodReadonly";
})(ZodFirstPartyTypeKind || (ZodFirstPartyTypeKind = {}));
var instanceOfType = (cls, params = {
  message: `Input not instance of ${cls.name}`
}) => custom((data) => data instanceof cls, params);
var stringType = ZodString.create;
var numberType = ZodNumber.create;
var nanType = ZodNaN.create;
var bigIntType = ZodBigInt.create;
var booleanType = ZodBoolean.create;
var dateType = ZodDate.create;
var symbolType = ZodSymbol.create;
var undefinedType = ZodUndefined.create;
var nullType = ZodNull.create;
var anyType = ZodAny.create;
var unknownType = ZodUnknown.create;
var neverType = ZodNever.create;
var voidType = ZodVoid.create;
var arrayType = ZodArray.create;
var objectType = ZodObject.create;
var strictObjectType = ZodObject.strictCreate;
var unionType = ZodUnion.create;
var discriminatedUnionType = ZodDiscriminatedUnion.create;
var intersectionType = ZodIntersection.create;
var tupleType = ZodTuple.create;
var recordType = ZodRecord.create;
var mapType = ZodMap.create;
var setType = ZodSet.create;
var functionType = ZodFunction.create;
var lazyType = ZodLazy.create;
var literalType = ZodLiteral.create;
var enumType = ZodEnum.create;
var nativeEnumType = ZodNativeEnum.create;
var promiseType = ZodPromise.create;
var effectsType = ZodEffects.create;
var optionalType = ZodOptional.create;
var nullableType = ZodNullable.create;
var preprocessType = ZodEffects.createWithPreprocess;
var pipelineType = ZodPipeline.create;
var ostring = () => stringType().optional();
var onumber = () => numberType().optional();
var oboolean = () => booleanType().optional();
var coerce = {
  string: ((arg) => ZodString.create({ ...arg, coerce: true })),
  number: ((arg) => ZodNumber.create({ ...arg, coerce: true })),
  boolean: ((arg) => ZodBoolean.create({
    ...arg,
    coerce: true
  })),
  bigint: ((arg) => ZodBigInt.create({ ...arg, coerce: true })),
  date: ((arg) => ZodDate.create({ ...arg, coerce: true }))
};
var NEVER = INVALID;

// src/utils/autoCorrect.ts
function autoCorrectJSON(raw, options = {}) {
  const {
    structural = true,
    stripFormatting = true
    // schemaBased and strict reserved for future use
  } = options;
  let corrected = raw;
  const corrections = [];
  try {
    if (stripFormatting) {
      const { text, applied } = stripUnwantedFormatting(corrected);
      corrected = text;
      corrections.push(...applied);
    }
    if (structural) {
      const { text, applied } = applyStructuralFixes(corrected);
      corrected = text;
      corrections.push(...applied);
    }
    const { text: fixedQuotes, applied: quoteCorrections } = fixQuotesAndEscapes(corrected);
    corrected = fixedQuotes;
    corrections.push(...quoteCorrections);
    JSON.parse(corrected);
    return {
      corrected,
      success: true,
      corrections
    };
  } catch (error) {
    return {
      corrected,
      success: false,
      corrections,
      error: error instanceof Error ? error : new Error(String(error))
    };
  }
}
function stripUnwantedFormatting(text) {
  let result = text;
  const applied = [];
  const strictFenceRegex = /^```(?:json)?\s*\n?([\s\S]*?)\n?```\s*$/;
  if (strictFenceRegex.test(result)) {
    result = result.replace(strictFenceRegex, "$1");
    applied.push("strip_markdown_fence");
  } else {
    const embeddedFenceRegex = /```(?:json)?\s*\n([\s\S]*?)\n[ \t]*```(?:\s*$|\n)/;
    const match = result.match(embeddedFenceRegex);
    if (match && match[1]) {
      result = match[1];
      applied.push("strip_markdown_fence");
    }
  }
  if (result.trim().startsWith("json")) {
    result = result.trim().replace(/^json\s*/i, "");
    applied.push("strip_json_prefix");
  }
  const prefixes = [
    /^Here's the JSON:?\s*/i,
    /^Here is the JSON:?\s*/i,
    /^The JSON is:?\s*/i,
    /^Sure,? here's the JSON:?\s*/i,
    /^Certainly[,!]? here's the JSON:?\s*/i,
    /^Output:?\s*/i,
    /^Result:?\s*/i,
    /^Response:?\s*/i,
    /^As an AI[^{]*/i,
    /^I can help[^{]*/i
  ];
  for (const prefix of prefixes) {
    if (prefix.test(result)) {
      result = result.replace(prefix, "");
      applied.push("remove_prefix_text");
      break;
    }
  }
  const suffixes = [
    /[\]}]\s*\n\n.*$/s,
    /[\]}]\s*I hope this helps.*$/is,
    /[\]}]\s*Let me know if.*$/is,
    /[\]}]\s*This JSON.*$/is
  ];
  for (const suffix of suffixes) {
    if (suffix.test(result)) {
      const lastBrace = result.lastIndexOf("}");
      const lastBracket = result.lastIndexOf("]");
      const lastIndex = Math.max(lastBrace, lastBracket);
      if (lastIndex !== -1) {
        result = result.substring(0, lastIndex + 1);
        applied.push("remove_suffix_text");
        break;
      }
    }
  }
  if (/\/\*[\s\S]*?\*\/|\/\/.*$/gm.test(result)) {
    result = result.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    applied.push("remove_comments");
  }
  result = result.trim();
  return { text: result, applied };
}
function applyStructuralFixes(text) {
  let result = text;
  const applied = [];
  const openBraces = (result.match(/{/g) || []).length;
  const closeBraces = (result.match(/}/g) || []).length;
  const openBrackets = (result.match(/\[/g) || []).length;
  const closeBrackets = (result.match(/\]/g) || []).length;
  if (openBraces > closeBraces) {
    const missing = openBraces - closeBraces;
    result += "}".repeat(missing);
    applied.push("close_brace");
  }
  if (openBrackets > closeBrackets) {
    const missing = openBrackets - closeBrackets;
    result += "]".repeat(missing);
    applied.push("close_bracket");
  }
  const trailingCommaRegex = /,(\s*[}\]])/g;
  if (trailingCommaRegex.test(result)) {
    result = result.replace(trailingCommaRegex, "$1");
    applied.push("remove_trailing_comma");
  }
  if (result.trim().endsWith(",")) {
    result = result.trim().slice(0, -1);
    applied.push("remove_trailing_comma");
  }
  return { text: result, applied };
}
function fixQuotesAndEscapes(text) {
  let result = text;
  const applied = [];
  try {
    JSON.parse(result);
  } catch (error) {
    if (error instanceof Error && (error.message.includes("control character") || error.message.includes("Bad control character"))) {
      result = result.replace(
        /"([^"\\]*(?:\\.[^"\\]*)*)"/g,
        (_match, content) => {
          const escaped = content.replace(/\n/g, "\\n").replace(/\r/g, "\\r").replace(/\t/g, "\\t");
          return `"${escaped}"`;
        }
      );
      applied.push("escape_control_chars");
    }
  }
  return { text: result, applied };
}
function findFirstJSONDelimiter(text) {
  let inString = false;
  let escapeNext = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
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
      if (char === "{") {
        return { startIndex: i, openChar: "{", closeChar: "}" };
      }
      if (char === "[") {
        return { startIndex: i, openChar: "[", closeChar: "]" };
      }
    }
  }
  return null;
}
function extractJSON(text) {
  const delimiter = findFirstJSONDelimiter(text);
  if (!delimiter) {
    return text;
  }
  const { startIndex, openChar, closeChar } = delimiter;
  let depth = 0;
  let inString = false;
  let escapeNext = false;
  for (let i = startIndex; i < text.length; i++) {
    const char = text[i];
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
    if (inString) {
      continue;
    }
    if (char === openChar) {
      depth++;
    } else if (char === closeChar) {
      depth--;
      if (depth === 0) {
        return text.substring(startIndex, i + 1);
      }
    }
  }
  const objectMatch = text.match(/\{[\s\S]*\}/);
  if (objectMatch) {
    return objectMatch[0];
  }
  const arrayMatch = text.match(/\[[\s\S]*\]/);
  if (arrayMatch) {
    return arrayMatch[0];
  }
  return text;
}
function isValidJSON(text) {
  try {
    JSON.parse(text);
    return true;
  } catch {
    return false;
  }
}
function describeJSONError(error) {
  const message = error.message.toLowerCase();
  if (message.includes("unexpected end")) {
    return "Incomplete JSON - missing closing braces or brackets";
  }
  if (message.includes("unexpected token")) {
    return "Invalid JSON syntax - unexpected character";
  }
  if (message.includes("control character")) {
    return "Invalid control characters in string values";
  }
  if (message.includes("trailing comma")) {
    return "Trailing commas not allowed in JSON";
  }
  if (message.includes("expected property name")) {
    return "Invalid property name - must be quoted";
  }
  return error.message;
}
function repairJSON(text) {
  const autoResult = autoCorrectJSON(text, {
    structural: true,
    stripFormatting: true
  });
  if (autoResult.success) {
    return autoResult.corrected;
  }
  const extracted = extractJSON(text);
  if (extracted !== text) {
    const retryResult = autoCorrectJSON(extracted, {
      structural: true,
      stripFormatting: true
    });
    if (retryResult.success) {
      return retryResult.corrected;
    }
  }
  let result = text.trim();
  result = result.replace(/'([^']*?)'/g, '"$1"');
  const finalResult = autoCorrectJSON(result, {
    structural: true,
    stripFormatting: true
  });
  if (finalResult.success) {
    return finalResult.corrected;
  }
  throw new Error(
    `Unable to repair JSON: ${describeJSONError(finalResult.error)}`
  );
}
function safeJSONParse(text, options = {}) {
  try {
    const data = JSON.parse(text);
    return { data, corrected: false, corrections: [] };
  } catch {
    const result = autoCorrectJSON(text, options);
    if (result.success) {
      const data = JSON.parse(result.corrected);
      return { data, corrected: true, corrections: result.corrections };
    }
    throw new Error(
      `Failed to parse JSON: ${describeJSONError(result.error)}`
    );
  }
}

// src/structured.ts
async function structured(options) {
  const {
    schema,
    stream: streamFactory,
    fallbackStreams = [],
    retry = {},
    autoCorrect = true,
    strictMode = false,
    timeout: timeout2,
    signal,
    monitoring,
    detectZeroTokens,
    onValidationError,
    onAutoCorrect,
    onRetry
  } = options;
  let validationAttempts = 0;
  let validationFailures = 0;
  let autoCorrections = 0;
  const correctionTypes = [];
  const validationErrors = [];
  let rawOutput = "";
  let correctedOutput = "";
  let appliedCorrections = [];
  let wasAutoCorrected = false;
  const errors = [];
  let validationStartTime = 0;
  let validationEndTime = 0;
  const abortController = new AbortController();
  const wrappedStreamFactory = async () => {
    return streamFactory();
  };
  const l0Options = {
    stream: wrappedStreamFactory,
    fallbackStreams,
    retry: {
      attempts: retry.attempts ?? 2,
      backoff: retry.backoff ?? "fixed-jitter",
      baseDelay: retry.baseDelay ?? 1e3,
      maxDelay: retry.maxDelay ?? 5e3,
      retryOn: [...retry.retryOn || [], "guardrail_violation", "incomplete"],
      errorTypeDelays: retry.errorTypeDelays
    },
    timeout: timeout2,
    signal: signal || abortController.signal,
    // Default to disabled for structured output since short valid JSON
    // (like "[]" or "{}") should not be rejected
    detectZeroTokens: detectZeroTokens ?? false,
    monitoring: {
      enabled: monitoring?.enabled ?? false,
      sampleRate: monitoring?.sampleRate ?? 1,
      metadata: {
        ...monitoring?.metadata || {},
        structured: true,
        schemaName: schema.description || "unknown"
      }
    },
    guardrails: [
      // Add JSON structure guardrail
      {
        name: "json-structure",
        check: (context) => {
          if (context.completed) {
            if (!isValidJSON(context.content)) {
              return [
                {
                  rule: "json-structure",
                  message: "Output is not valid JSON",
                  severity: "error",
                  recoverable: true
                }
              ];
            }
          }
          return [];
        }
      }
    ],
    onRetry: (attempt, reason) => {
      if (onRetry) {
        onRetry(attempt, reason);
      }
    }
  };
  const maxValidationRetries = retry.attempts ?? 2;
  let currentValidationAttempt = 0;
  while (currentValidationAttempt <= maxValidationRetries) {
    try {
      const result = await l0(l0Options);
      rawOutput = "";
      for await (const event of result.stream) {
        if (event.type === "token" && event.value) {
          rawOutput += event.value;
        } else if (event.type === "error") {
          errors.push(event.error || new Error("Unknown error"));
        }
      }
      if (!rawOutput || rawOutput.trim().length === 0) {
        throw new Error("No output received from model");
      }
      validationStartTime = Date.now();
      validationAttempts++;
      correctedOutput = rawOutput;
      appliedCorrections = [];
      if (autoCorrect) {
        const correctionResult = autoCorrectJSON(correctedOutput, {
          structural: true,
          stripFormatting: true,
          schemaBased: false,
          strict: strictMode
        });
        if (correctionResult.corrections.length > 0) {
          wasAutoCorrected = true;
          correctedOutput = correctionResult.corrected;
          appliedCorrections = correctionResult.corrections;
          autoCorrections++;
          correctionTypes.push(...correctionResult.corrections);
          if (onAutoCorrect) {
            const correctionInfo = {
              original: rawOutput,
              corrected: correctedOutput,
              corrections: correctionResult.corrections,
              success: correctionResult.success
            };
            onAutoCorrect(correctionInfo);
          }
        }
      }
      let parsedData;
      try {
        parsedData = JSON.parse(correctedOutput);
      } catch (parseError) {
        const err = parseError instanceof Error ? parseError : new Error(String(parseError));
        errors.push(err);
        const extracted = extractJSON(correctedOutput);
        if (extracted !== correctedOutput) {
          try {
            parsedData = JSON.parse(extracted);
            correctedOutput = extracted;
            wasAutoCorrected = true;
            if (!appliedCorrections.includes("extract_json")) {
              appliedCorrections.push("extract_json");
              correctionTypes.push("extract_json");
            }
            autoCorrections++;
          } catch {
            const rescueResult = autoCorrectJSON(extracted, {
              structural: true,
              stripFormatting: true
            });
            if (rescueResult.success) {
              parsedData = JSON.parse(rescueResult.corrected);
              correctedOutput = rescueResult.corrected;
              wasAutoCorrected = true;
              appliedCorrections.push(...rescueResult.corrections);
              autoCorrections++;
              correctionTypes.push(...rescueResult.corrections);
            } else {
              throw new Error(
                `Invalid JSON after auto-correction: ${err.message}`
              );
            }
          }
        } else if (!autoCorrect) {
          const rescueResult = autoCorrectJSON(correctedOutput, {
            structural: true,
            stripFormatting: true
          });
          if (rescueResult.success) {
            parsedData = JSON.parse(rescueResult.corrected);
            correctedOutput = rescueResult.corrected;
            wasAutoCorrected = true;
            appliedCorrections.push(...rescueResult.corrections);
            autoCorrections++;
            correctionTypes.push(...rescueResult.corrections);
          } else {
            throw new Error(`Invalid JSON: ${err.message}`);
          }
        } else {
          const rawExtracted = extractJSON(rawOutput);
          if (rawExtracted !== rawOutput) {
            const rescueResult = autoCorrectJSON(rawExtracted, {
              structural: true,
              stripFormatting: true
            });
            if (rescueResult.success) {
              try {
                parsedData = JSON.parse(rescueResult.corrected);
                correctedOutput = rescueResult.corrected;
                wasAutoCorrected = true;
                appliedCorrections.push(
                  "extract_json",
                  ...rescueResult.corrections
                );
                autoCorrections++;
                correctionTypes.push(
                  "extract_json",
                  ...rescueResult.corrections
                );
              } catch {
                throw new Error(
                  `Invalid JSON after auto-correction: ${err.message}`
                );
              }
            } else {
              throw new Error(
                `Invalid JSON after auto-correction: ${err.message}`
              );
            }
          } else {
            throw new Error(
              `Invalid JSON after auto-correction: ${err.message}`
            );
          }
        }
      }
      const validationResult = schema.safeParse(parsedData);
      if (!validationResult.success) {
        validationFailures++;
        validationErrors.push(validationResult.error);
        if (onValidationError) {
          onValidationError(validationResult.error, currentValidationAttempt);
        }
        if (currentValidationAttempt < maxValidationRetries) {
          currentValidationAttempt++;
          if (onRetry) {
            onRetry(
              currentValidationAttempt,
              `Schema validation failed: ${validationResult.error.errors[0]?.message}`
            );
          }
          continue;
        }
        throw new Error(
          `Schema validation failed after ${validationAttempts} attempts: ${JSON.stringify(validationResult.error.errors)}`
        );
      }
      validationEndTime = Date.now();
      const structuredState = {
        ...result.state,
        validationFailures,
        autoCorrections,
        validationErrors
      };
      let structuredTelemetry;
      if (result.telemetry) {
        structuredTelemetry = {
          ...result.telemetry,
          structured: {
            schemaName: schema.description || "unknown",
            validationAttempts,
            validationFailures,
            autoCorrections,
            correctionTypes: Array.from(new Set(correctionTypes)),
            validationSuccess: true,
            validationTime: validationEndTime - validationStartTime
          }
        };
      }
      return {
        data: validationResult.data,
        raw: rawOutput,
        corrected: wasAutoCorrected,
        corrections: appliedCorrections,
        state: structuredState,
        telemetry: structuredTelemetry,
        errors,
        abort: () => abortController.abort()
      };
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      errors.push(err);
      if (currentValidationAttempt < maxValidationRetries) {
        currentValidationAttempt++;
        if (onRetry) {
          onRetry(currentValidationAttempt, err.message);
        }
        continue;
      }
      throw new Error(
        `Structured output failed after ${currentValidationAttempt + 1} attempts: ${err.message}`
      );
    }
  }
  throw new Error("Unexpected: exhausted retry loop without result");
}
async function structuredObject(shape, options) {
  const schema = external_exports.object(shape);
  return structured({ ...options, schema });
}
async function structuredArray(itemSchema, options) {
  const schema = external_exports.array(itemSchema);
  return structured({ ...options, schema });
}
async function structuredStream(options) {
  const abortController = new AbortController();
  const resultPromise = structured({
    ...options,
    signal: abortController.signal
  });
  const l0Result = await l0({
    stream: options.stream,
    fallbackStreams: options.fallbackStreams,
    retry: options.retry,
    timeout: options.timeout,
    signal: abortController.signal,
    monitoring: options.monitoring,
    onRetry: options.onRetry
  });
  return {
    stream: l0Result.stream,
    result: resultPromise,
    abort: () => abortController.abort()
  };
}

// src/types/structured.ts
var minimalStructured = {
  autoCorrect: false,
  strictMode: false,
  retry: {
    attempts: 1,
    backoff: "fixed",
    baseDelay: 500
  }
};
var recommendedStructured = {
  autoCorrect: true,
  strictMode: false,
  retry: {
    attempts: 2,
    backoff: "fixed-jitter",
    baseDelay: 1e3,
    maxDelay: 5e3
  }
};
var strictStructured = {
  autoCorrect: true,
  strictMode: true,
  retry: {
    attempts: 3,
    backoff: "fixed-jitter",
    baseDelay: 1e3,
    maxDelay: 1e4
  }
};

// src/utils/chunking.ts
function chunkDocument(document, options) {
  const { strategy } = options;
  switch (strategy) {
    case "token":
      return chunkByTokens(document, options);
    case "char":
      return chunkByChars(document, options);
    case "paragraph":
      return chunkByParagraphs(document, options);
    case "sentence":
      return chunkBySentences(document, options);
    default:
      return chunkByTokens(document, options);
  }
}
function chunkByTokens(document, options) {
  const { size, overlap, estimateTokens, preserveParagraphs } = options;
  const chunks = [];
  let startPos = 0;
  while (startPos < document.length) {
    let endPos = startPos;
    let currentTokens = 0;
    while (endPos < document.length && currentTokens < size) {
      endPos++;
      if (endPos % 4 === 0) {
        currentTokens++;
      }
    }
    if (preserveParagraphs && endPos < document.length) {
      const nextNewline = document.indexOf("\n\n", endPos);
      const prevNewline = document.lastIndexOf("\n\n", endPos);
      if (nextNewline !== -1 && nextNewline - endPos < 100) {
        endPos = nextNewline + 2;
      } else if (prevNewline > startPos && endPos - prevNewline < 100) {
        endPos = prevNewline + 2;
      }
    }
    const content = document.slice(startPos, endPos).trim();
    if (content.length > 0) {
      chunks.push({
        index: chunks.length,
        content,
        startPos,
        endPos,
        tokenCount: estimateTokens(content),
        charCount: content.length,
        isFirst: chunks.length === 0,
        isLast: endPos >= document.length,
        totalChunks: 0,
        // Will be updated after all chunks created
        metadata: options.metadata
      });
    }
    const overlapChars = Math.floor(overlap * 4);
    startPos = endPos - overlapChars;
    const lastChunk = chunks[chunks.length - 1];
    if (lastChunk && startPos <= lastChunk.startPos) {
      startPos = endPos;
    }
  }
  chunks.forEach((chunk) => {
    chunk.totalChunks = chunks.length;
    chunk.isLast = chunk.index === chunks.length - 1;
  });
  return chunks;
}
function chunkByChars(document, options) {
  const { size, overlap, estimateTokens, preserveParagraphs } = options;
  const chunks = [];
  let startPos = 0;
  while (startPos < document.length) {
    let endPos = Math.min(startPos + size, document.length);
    if (preserveParagraphs && endPos < document.length) {
      const nextNewline = document.indexOf("\n\n", endPos);
      const prevNewline = document.lastIndexOf("\n\n", endPos);
      if (nextNewline !== -1 && nextNewline - endPos < 100) {
        endPos = nextNewline + 2;
      } else if (prevNewline > startPos && endPos - prevNewline < 100) {
        endPos = prevNewline + 2;
      }
    }
    const content = document.slice(startPos, endPos).trim();
    if (content.length > 0) {
      chunks.push({
        index: chunks.length,
        content,
        startPos,
        endPos,
        tokenCount: estimateTokens(content),
        charCount: content.length,
        isFirst: chunks.length === 0,
        isLast: endPos >= document.length,
        totalChunks: 0,
        metadata: options.metadata
      });
    }
    startPos = endPos - overlap;
    const lastChunk = chunks[chunks.length - 1];
    if (lastChunk && startPos <= lastChunk.startPos) {
      startPos = endPos;
    }
  }
  chunks.forEach((chunk) => {
    chunk.totalChunks = chunks.length;
    chunk.isLast = chunk.index === chunks.length - 1;
  });
  return chunks;
}
function chunkByParagraphs(document, options) {
  const { size, overlap, estimateTokens } = options;
  const paragraphs = document.split(/\n\n+/).filter((p) => p.trim().length > 0);
  const chunks = [];
  let currentChunk = [];
  let currentSize = 0;
  let currentStartPos = 0;
  for (let i = 0; i < paragraphs.length; i++) {
    const para = paragraphs[i].trim();
    const paraSize = estimateTokens(para);
    if (paraSize > size) {
      if (currentChunk.length > 0) {
        const content = currentChunk.join("\n\n");
        chunks.push(
          createChunk(
            content,
            currentStartPos,
            document,
            chunks.length,
            estimateTokens,
            options.metadata
          )
        );
        currentChunk = [];
        currentSize = 0;
      }
      const paraChunks = chunkByChars(para, {
        ...options,
        size,
        overlap: 0
      });
      paraChunks.forEach((pc) => {
        chunks.push({
          ...pc,
          index: chunks.length,
          startPos: document.indexOf(pc.content, currentStartPos)
        });
      });
      currentStartPos = document.indexOf(para, currentStartPos) + para.length;
      continue;
    }
    if (currentSize + paraSize > size && currentChunk.length > 0) {
      const content = currentChunk.join("\n\n");
      chunks.push(
        createChunk(
          content,
          currentStartPos,
          document,
          chunks.length,
          estimateTokens,
          options.metadata
        )
      );
      const overlapParas = [];
      let overlapSize = 0;
      for (let j = currentChunk.length - 1; j >= 0; j--) {
        const p = currentChunk[j];
        const pSize = estimateTokens(p);
        if (overlapSize + pSize <= overlap) {
          overlapParas.unshift(p);
          overlapSize += pSize;
        } else {
          break;
        }
      }
      currentChunk = overlapParas;
      currentSize = overlapSize;
      currentStartPos = document.indexOf(
        currentChunk[0] || para,
        currentStartPos
      );
    }
    currentChunk.push(para);
    currentSize += paraSize;
  }
  if (currentChunk.length > 0) {
    const content = currentChunk.join("\n\n");
    chunks.push(
      createChunk(
        content,
        currentStartPos,
        document,
        chunks.length,
        estimateTokens,
        options.metadata
      )
    );
  }
  chunks.forEach((chunk) => {
    chunk.totalChunks = chunks.length;
    chunk.isFirst = chunk.index === 0;
    chunk.isLast = chunk.index === chunks.length - 1;
  });
  return chunks;
}
function chunkBySentences(document, options) {
  const { size, overlap, estimateTokens } = options;
  const sentences = splitIntoSentences(document);
  const chunks = [];
  let currentChunk = [];
  let currentSize = 0;
  let currentStartPos = 0;
  for (const sentence of sentences) {
    const sentSize = estimateTokens(sentence);
    if (sentSize > size) {
      if (currentChunk.length > 0) {
        const content = currentChunk.join(" ");
        chunks.push(
          createChunk(
            content,
            currentStartPos,
            document,
            chunks.length,
            estimateTokens,
            options.metadata
          )
        );
        currentChunk = [];
        currentSize = 0;
      }
      const sentChunks = chunkByChars(sentence, {
        ...options,
        size,
        overlap: 0
      });
      sentChunks.forEach((sc) => {
        chunks.push({
          ...sc,
          index: chunks.length,
          startPos: document.indexOf(sc.content, currentStartPos)
        });
      });
      currentStartPos = document.indexOf(sentence, currentStartPos) + sentence.length;
      continue;
    }
    if (currentSize + sentSize > size && currentChunk.length > 0) {
      const content = currentChunk.join(" ");
      chunks.push(
        createChunk(
          content,
          currentStartPos,
          document,
          chunks.length,
          estimateTokens,
          options.metadata
        )
      );
      const overlapSents = [];
      let overlapSize = 0;
      for (let j = currentChunk.length - 1; j >= 0; j--) {
        const s = currentChunk[j];
        const sSize = estimateTokens(s);
        if (overlapSize + sSize <= overlap) {
          overlapSents.unshift(s);
          overlapSize += sSize;
        } else {
          break;
        }
      }
      currentChunk = overlapSents;
      currentSize = overlapSize;
      currentStartPos = document.indexOf(
        currentChunk[0] || sentence,
        currentStartPos
      );
    }
    currentChunk.push(sentence);
    currentSize += sentSize;
  }
  if (currentChunk.length > 0) {
    const content = currentChunk.join(" ");
    chunks.push(
      createChunk(
        content,
        currentStartPos,
        document,
        chunks.length,
        estimateTokens,
        options.metadata
      )
    );
  }
  chunks.forEach((chunk) => {
    chunk.totalChunks = chunks.length;
    chunk.isFirst = chunk.index === 0;
    chunk.isLast = chunk.index === chunks.length - 1;
  });
  return chunks;
}
function splitIntoSentences(text) {
  const sentences = [];
  const regex = /[.!?]+[\s\n]+(?=[A-Z])|[.!?]+$/g;
  let lastIndex = 0;
  let match;
  while ((match = regex.exec(text)) !== null) {
    const sentence = text.slice(lastIndex, match.index + match[0].length).trim();
    if (sentence.length > 0) {
      sentences.push(sentence);
    }
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < text.length) {
    const remaining = text.slice(lastIndex).trim();
    if (remaining.length > 0) {
      sentences.push(remaining);
    }
  }
  return sentences;
}
function createChunk(content, startPos, fullDocument, index, estimateTokens, metadata) {
  const actualStartPos = fullDocument.indexOf(content, startPos);
  return {
    index,
    content,
    startPos: actualStartPos !== -1 ? actualStartPos : startPos,
    endPos: actualStartPos !== -1 ? actualStartPos + content.length : startPos + content.length,
    tokenCount: estimateTokens(content),
    charCount: content.length,
    isFirst: index === 0,
    isLast: false,
    // Will be updated later
    totalChunks: 0,
    // Will be updated later
    metadata
  };
}
function estimateTokenCount(text) {
  const charCount = text.length;
  const wordCount = text.split(/\s+/).length;
  const charEstimate = Math.ceil(charCount / 4);
  const wordEstimate = Math.ceil(wordCount * 1.3);
  return Math.ceil((charEstimate + wordEstimate) / 2);
}
function getChunkOverlap(chunk1, chunk2) {
  if (chunk1.endPos <= chunk2.startPos || chunk2.endPos <= chunk1.startPos) {
    return null;
  }
  const overlapStart = Math.max(chunk1.startPos, chunk2.startPos);
  const overlapEnd = Math.min(chunk1.endPos, chunk2.endPos);
  const chunk1End = chunk1.content.slice(-(chunk1.endPos - overlapStart));
  const chunk2Start = chunk2.content.slice(0, overlapEnd - chunk2.startPos);
  return chunk1End.length <= chunk2Start.length ? chunk1End : chunk2Start;
}
function mergeChunks(chunks, preserveOverlap = false) {
  if (chunks.length === 0) return "";
  if (chunks.length === 1) return chunks[0].content;
  if (preserveOverlap) {
    return chunks.map((c) => c.content).join("\n\n");
  }
  const result = [chunks[0].content];
  for (let i = 1; i < chunks.length; i++) {
    const prevChunk = chunks[i - 1];
    const currentChunk = chunks[i];
    const overlap = getChunkOverlap(prevChunk, currentChunk);
    if (overlap) {
      const overlapIndex = currentChunk.content.indexOf(overlap);
      if (overlapIndex !== -1) {
        result.push(currentChunk.content.slice(overlapIndex + overlap.length));
      } else {
        result.push(currentChunk.content);
      }
    } else {
      result.push(currentChunk.content);
    }
  }
  return result.join("");
}

// src/window.ts
var DEFAULT_OPTIONS = {
  size: 2e3,
  overlap: 200,
  strategy: "token",
  estimateTokens: estimateTokenCount,
  preserveParagraphs: true,
  preserveSentences: false,
  metadata: {}
};
var DocumentWindowImpl = class {
  document;
  options;
  chunks;
  _currentIndex = 0;
  constructor(document, options = {}) {
    this.document = document;
    this.options = { ...DEFAULT_OPTIONS, ...options };
    this.chunks = chunkDocument(document, this.options);
    if (this.chunks.length === 0) {
      throw new Error("Document resulted in zero chunks");
    }
  }
  /**
   * Get total number of chunks
   */
  get totalChunks() {
    return this.chunks.length;
  }
  /**
   * Get current chunk index
   */
  get currentIndex() {
    return this._currentIndex;
  }
  /**
   * Get a specific chunk by index
   */
  get(index) {
    if (index < 0 || index >= this.chunks.length) {
      return null;
    }
    return this.chunks[index] ?? null;
  }
  /**
   * Get current chunk
   */
  current() {
    return this.get(this._currentIndex);
  }
  /**
   * Move to next chunk
   */
  next() {
    if (this._currentIndex < this.chunks.length - 1) {
      this._currentIndex++;
      return this.current();
    }
    return null;
  }
  /**
   * Move to previous chunk
   */
  prev() {
    if (this._currentIndex > 0) {
      this._currentIndex--;
      return this.current();
    }
    return null;
  }
  /**
   * Jump to specific chunk
   */
  jump(index) {
    if (index < 0 || index >= this.chunks.length) {
      return null;
    }
    this._currentIndex = index;
    return this.current();
  }
  /**
   * Reset to first chunk
   */
  reset() {
    this._currentIndex = 0;
    return this.current();
  }
  /**
   * Get all chunks
   */
  getAllChunks() {
    return [...this.chunks];
  }
  /**
   * Get a range of chunks
   */
  getRange(start, end) {
    const validStart = Math.max(0, start);
    const validEnd = Math.min(this.chunks.length, end);
    return this.chunks.slice(validStart, validEnd);
  }
  /**
   * Check if has next chunk
   */
  hasNext() {
    return this._currentIndex < this.chunks.length - 1;
  }
  /**
   * Check if has previous chunk
   */
  hasPrev() {
    return this._currentIndex > 0;
  }
  /**
   * Process all chunks with L0 (parallel by default)
   */
  async processAll(processFn) {
    return this.processParallel(processFn);
  }
  /**
   * Process chunks sequentially (one at a time)
   */
  async processSequential(processFn) {
    const results = [];
    for (const chunk of this.chunks) {
      const startTime = Date.now();
      try {
        const options = processFn(chunk);
        const result = await l0(options);
        for await (const _event of result.stream) {
        }
        results.push({
          chunk,
          result,
          status: "success",
          duration: Date.now() - startTime
        });
      } catch (error) {
        results.push({
          chunk,
          result: void 0,
          status: "error",
          error: error instanceof Error ? error : new Error(String(error)),
          duration: Date.now() - startTime
        });
      }
    }
    return results;
  }
  /**
   * Process chunks in parallel with concurrency control
   */
  async processParallel(processFn, options = {}) {
    const { concurrency = 5 } = options;
    const results = new Array(this.chunks.length);
    const queue = [...this.chunks];
    let activeCount = 0;
    let index = 0;
    return new Promise((resolve, _reject) => {
      const processNext = () => {
        while (activeCount < concurrency && queue.length > 0) {
          const chunk = queue.shift();
          const chunkIndex = index++;
          activeCount++;
          const startTime = Date.now();
          (async () => {
            try {
              const l0Options = processFn(chunk);
              const result = await l0(l0Options);
              for await (const _event of result.stream) {
              }
              results[chunkIndex] = {
                chunk,
                result,
                status: "success",
                duration: Date.now() - startTime
              };
            } catch (error) {
              results[chunkIndex] = {
                chunk,
                result: void 0,
                status: "error",
                error: error instanceof Error ? error : new Error(String(error)),
                duration: Date.now() - startTime
              };
            } finally {
              activeCount--;
              if (queue.length > 0) {
                processNext();
              } else if (activeCount === 0) {
                resolve(results);
              }
            }
          })();
        }
      };
      processNext();
    });
  }
  /**
   * Get window statistics
   */
  getStats() {
    const totalChars = this.document.length;
    const totalTokens = this.options.estimateTokens(this.document);
    const avgChunkSize = this.chunks.reduce((sum, c) => sum + c.charCount, 0) / this.chunks.length;
    const avgChunkTokens = this.chunks.reduce((sum, c) => sum + c.tokenCount, 0) / this.chunks.length;
    return {
      totalChunks: this.chunks.length,
      totalChars,
      totalTokens,
      avgChunkSize: Math.round(avgChunkSize),
      avgChunkTokens: Math.round(avgChunkTokens),
      overlapSize: this.options.overlap,
      strategy: this.options.strategy
    };
  }
  /**
   * Get context for a chunk with optional surrounding context
   */
  getContext(index, options = {}) {
    const { before = 0, after = 0 } = options;
    const start = Math.max(0, index - before);
    const end = Math.min(this.chunks.length, index + after + 1);
    const contextChunks = this.chunks.slice(start, end);
    return mergeChunks(contextChunks, false);
  }
  /**
   * Find chunks containing specific text
   */
  findChunks(searchText, caseSensitive = false) {
    const search = caseSensitive ? searchText : searchText.toLowerCase();
    return this.chunks.filter((chunk) => {
      const content = caseSensitive ? chunk.content : chunk.content.toLowerCase();
      return content.includes(search);
    });
  }
  /**
   * Get chunks within a character range
   */
  getChunksInRange(startPos, endPos) {
    return this.chunks.filter(
      (chunk) => chunk.startPos >= startPos && chunk.startPos < endPos || chunk.endPos > startPos && chunk.endPos <= endPos || chunk.startPos <= startPos && chunk.endPos >= endPos
    );
  }
};
function createWindow(document, options) {
  return new DocumentWindowImpl(document, options);
}
async function processWithWindow(document, processFn, options) {
  const window = createWindow(document, options);
  return window.processAll(processFn);
}
async function l0WithWindow(options) {
  const { window, chunkIndex = 0, contextRestoration, ...l0Options } = options;
  if (!window) {
    throw new Error("Window is required");
  }
  const chunk = window.get(chunkIndex);
  if (!chunk) {
    throw new Error(`Invalid chunk index: ${chunkIndex}`);
  }
  const {
    enabled = true,
    strategy = "adjacent",
    maxAttempts = RETRY_DEFAULTS.attempts,
    onRestore
  } = contextRestoration || {};
  let currentChunkIndex = chunkIndex;
  let attempts = 0;
  while (attempts <= maxAttempts) {
    try {
      const result = await l0(l0Options);
      if (result.state.driftDetected && enabled && attempts < maxAttempts) {
        let nextChunkIndex = null;
        switch (strategy) {
          case "adjacent":
            if (window.hasNext()) {
              nextChunkIndex = currentChunkIndex + 1;
            } else if (currentChunkIndex > 0) {
              nextChunkIndex = currentChunkIndex - 1;
            }
            break;
          case "overlap":
            if (window.hasNext()) {
              nextChunkIndex = currentChunkIndex + 1;
            }
            break;
          case "full":
            if (window.hasNext()) {
              nextChunkIndex = currentChunkIndex + 1;
            } else if (currentChunkIndex > 0) {
              nextChunkIndex = currentChunkIndex - 1;
            }
            break;
        }
        if (nextChunkIndex !== null) {
          currentChunkIndex = nextChunkIndex;
          attempts++;
          if (onRestore) {
            onRestore(chunkIndex, nextChunkIndex);
          }
          continue;
        }
      }
      return result;
    } catch (error) {
      if (attempts >= maxAttempts) {
        throw error;
      }
      attempts++;
    }
  }
  throw new Error("Context restoration failed after max attempts");
}
function mergeResults(results, separator = "\n\n") {
  return results.filter((r) => r.status === "success" && r.result?.state?.content).map((r) => r.result.state.content).join(separator);
}
function getProcessingStats(results) {
  const total = results.length;
  const successful = results.filter((r) => r.status === "success").length;
  const failed = results.filter((r) => r.status === "error").length;
  const successRate = total > 0 ? successful / total * 100 : 0;
  const totalDuration = results.reduce((sum, r) => sum + r.duration, 0);
  const avgDuration = total > 0 ? totalDuration / total : 0;
  return {
    total,
    successful,
    failed,
    successRate,
    avgDuration: Math.round(avgDuration),
    totalDuration
  };
}

// src/types/window.ts
var smallWindow = {
  name: "small",
  size: 1e3,
  overlap: 100,
  strategy: "token"
};
var mediumWindow = {
  name: "medium",
  size: 2e3,
  overlap: 200,
  strategy: "token"
};
var largeWindow = {
  name: "large",
  size: 4e3,
  overlap: 400,
  strategy: "token"
};
var paragraphWindow = {
  name: "paragraph",
  size: 2e3,
  overlap: 200,
  strategy: "paragraph"
};
var sentenceWindow = {
  name: "sentence",
  size: 1500,
  overlap: 150,
  strategy: "sentence"
};

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
        const indent2 = listMatch[1].length;
        const currentDepth = Math.floor(indent2 / 2) + 1;
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
      const indent2 = unorderedMatch[1].length;
      if (lastListType === "ordered" && lastIndent === indent2) {
        violations.push({
          rule: "markdown-lists",
          message: `Mixed list types at line ${i + 1}: switching from ordered to unordered at same level`,
          severity: "warning",
          recoverable: true
        });
      }
      lastListType = "unordered";
      lastIndent = indent2;
      continue;
    }
    const orderedMatch = line.match(ORDERED_LIST);
    if (orderedMatch && orderedMatch[1] !== void 0) {
      const indent2 = orderedMatch[1].length;
      if (lastListType === "unordered" && lastIndent === indent2) {
        violations.push({
          rule: "markdown-lists",
          message: `Mixed list types at line ${i + 1}: switching from unordered to ordered at same level`,
          severity: "warning",
          recoverable: true
        });
      }
      lastListType = "ordered";
      lastIndent = indent2;
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
function customPatternRule(patterns, message = "Custom pattern detected", severity = "error") {
  return {
    name: "pattern-custom",
    description: "Custom pattern matching",
    streaming: false,
    severity,
    recoverable: severity !== "fatal",
    check: (context) => {
      const violations = [];
      const matches = findBadPatterns(context.content, patterns);
      for (const match of matches) {
        violations.push({
          rule: "pattern-custom",
          message: `${message}: "${match.match}"`,
          severity,
          position: match.index,
          recoverable: severity !== "fatal"
        });
      }
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

// src/runtime/prometheus.ts
var L0PrometheusCollector = class {
  registry;
  prefix;
  // Counters
  requestsTotal;
  tokensTotal;
  retriesTotal;
  networkErrorsTotal;
  guardrailViolationsTotal;
  driftDetectedTotal;
  // Gauges
  tokensPerSecond;
  activeStreams;
  // Histograms
  requestDuration;
  timeToFirstToken;
  constructor(config) {
    this.prefix = config.prefix ?? "l0";
    this.registry = config.registry ?? new config.client.Registry();
    if (config.defaultLabels) {
      this.registry.setDefaultLabels(config.defaultLabels);
    }
    const durationBuckets = config.buckets?.duration ?? [
      0.1,
      0.25,
      0.5,
      1,
      2.5,
      5,
      10,
      30,
      60,
      120
    ];
    const ttftBuckets = config.buckets?.ttft ?? [
      0.05,
      0.1,
      0.25,
      0.5,
      1,
      2.5,
      5,
      10
    ];
    this.requestsTotal = new config.client.Counter({
      name: `${this.prefix}_requests_total`,
      help: "Total number of L0 requests",
      labelNames: ["status"],
      registers: [this.registry]
    });
    this.tokensTotal = new config.client.Counter({
      name: `${this.prefix}_tokens_total`,
      help: "Total tokens generated",
      labelNames: ["model"],
      registers: [this.registry]
    });
    this.retriesTotal = new config.client.Counter({
      name: `${this.prefix}_retries_total`,
      help: "Total retry attempts",
      labelNames: ["type"],
      registers: [this.registry]
    });
    this.networkErrorsTotal = new config.client.Counter({
      name: `${this.prefix}_network_errors_total`,
      help: "Total network errors",
      labelNames: ["error_type"],
      registers: [this.registry]
    });
    this.guardrailViolationsTotal = new config.client.Counter({
      name: `${this.prefix}_guardrail_violations_total`,
      help: "Total guardrail violations",
      labelNames: ["rule", "severity"],
      registers: [this.registry]
    });
    this.driftDetectedTotal = new config.client.Counter({
      name: `${this.prefix}_drift_detected_total`,
      help: "Total drift detection events",
      labelNames: ["type"],
      registers: [this.registry]
    });
    this.tokensPerSecond = new config.client.Gauge({
      name: `${this.prefix}_tokens_per_second`,
      help: "Current tokens per second rate",
      labelNames: ["model"],
      registers: [this.registry]
    });
    this.activeStreams = new config.client.Gauge({
      name: `${this.prefix}_active_streams`,
      help: "Number of active streams",
      labelNames: ["model"],
      registers: [this.registry]
    });
    this.requestDuration = new config.client.Histogram({
      name: `${this.prefix}_request_duration_seconds`,
      help: "L0 request duration in seconds",
      labelNames: ["status"],
      buckets: durationBuckets,
      registers: [this.registry]
    });
    this.timeToFirstToken = new config.client.Histogram({
      name: `${this.prefix}_time_to_first_token_seconds`,
      help: "Time to first token in seconds",
      labelNames: ["model"],
      buckets: ttftBuckets,
      registers: [this.registry]
    });
  }
  /**
   * Record telemetry from L0 execution
   */
  record(telemetry, labels) {
    const model = labels?.model ?? "unknown";
    const status = telemetry.metrics.totalTokens > 0 ? "success" : "empty";
    this.requestsTotal.inc({ status });
    if (telemetry.duration !== void 0) {
      this.requestDuration.observe({ status }, telemetry.duration / 1e3);
    }
    if (telemetry.metrics.totalTokens > 0) {
      this.tokensTotal.inc({ model }, telemetry.metrics.totalTokens);
    }
    if (telemetry.metrics.tokensPerSecond !== void 0) {
      this.tokensPerSecond.set({ model }, telemetry.metrics.tokensPerSecond);
    }
    if (telemetry.metrics.timeToFirstToken !== void 0) {
      this.timeToFirstToken.observe(
        { model },
        telemetry.metrics.timeToFirstToken / 1e3
      );
    }
    if (telemetry.metrics.networkRetryCount > 0) {
      this.retriesTotal.inc(
        { type: "network" },
        telemetry.metrics.networkRetryCount
      );
    }
    if (telemetry.metrics.modelRetryCount > 0) {
      this.retriesTotal.inc(
        { type: "model" },
        telemetry.metrics.modelRetryCount
      );
    }
    if (telemetry.network.errorCount > 0) {
      for (const [errorType, count] of Object.entries(
        telemetry.network.errorsByType
      )) {
        this.networkErrorsTotal.inc({ error_type: errorType }, count);
      }
    }
    if (telemetry.guardrails && telemetry.guardrails.violationCount > 0) {
      if (telemetry.guardrails.violationsByRuleAndSeverity) {
        for (const [rule, severityCounts] of Object.entries(
          telemetry.guardrails.violationsByRuleAndSeverity
        )) {
          for (const [severity, count] of Object.entries(severityCounts)) {
            if (count > 0) {
              this.guardrailViolationsTotal.inc({ rule, severity }, count);
            }
          }
        }
      } else {
        for (const [rule, count] of Object.entries(
          telemetry.guardrails.violationsByRule
        )) {
          this.guardrailViolationsTotal.inc(
            { rule, severity: "unknown" },
            count
          );
        }
      }
    }
    if (telemetry.drift?.detected) {
      for (const type of telemetry.drift.types) {
        this.driftDetectedTotal.inc({ type });
      }
    }
  }
  /**
   * Record from L0Monitor directly
   */
  recordFromMonitor(monitor, labels) {
    const telemetry = monitor.getTelemetry();
    if (telemetry) {
      this.record(telemetry, labels);
    }
  }
  /**
   * Increment active streams
   */
  incActiveStreams(model = "unknown") {
    this.activeStreams.inc({ model });
  }
  /**
   * Decrement active streams
   */
  decActiveStreams(model = "unknown") {
    this.activeStreams.dec({ model });
  }
  /**
   * Get the registry
   */
  getRegistry() {
    return this.registry;
  }
  /**
   * Get metrics in Prometheus format
   */
  async getMetrics() {
    return this.registry.metrics();
  }
  /**
   * Get content type for metrics endpoint
   */
  getContentType() {
    return this.registry.contentType;
  }
  /**
   * Clear all metrics
   */
  clear() {
    this.registry.clear();
  }
};
function createL0PrometheusCollector(config) {
  return new L0PrometheusCollector(config);
}
function l0PrometheusMiddleware(collector) {
  return async (_req, res) => {
    res.set("Content-Type", collector.getContentType());
    res.send(await collector.getMetrics());
  };
}
var PrometheusRegistry = class {
  metrics = /* @__PURE__ */ new Map();
  prefix;
  defaultLabels;
  constructor(options = {}) {
    this.prefix = options.prefix ?? "l0";
    this.defaultLabels = options.defaultLabels ?? {};
  }
  /**
   * Generate a unique key for a metric with its labels
   */
  getLabelKey(labels) {
    if (!labels || Object.keys(labels).length === 0) {
      return "";
    }
    const sortedPairs = Object.entries(labels).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join(",");
    return sortedPairs;
  }
  /**
   * Register a metric - aggregates counters and replaces gauges
   */
  register(metric) {
    const key = metric.name;
    const mergedLabels = { ...this.defaultLabels, ...metric.labels };
    const labelKey = this.getLabelKey(mergedLabels);
    const existing = this.metrics.get(key) || [];
    const existingIndex = existing.findIndex(
      (m) => this.getLabelKey(m.labels) === labelKey
    );
    if (existingIndex >= 0) {
      const existingMetric = existing[existingIndex];
      if (metric.type === "counter") {
        existingMetric.value += metric.value;
      } else if (metric.type === "gauge") {
        existingMetric.value = metric.value;
      } else if (metric.type === "histogram") {
        if (!existingMetric.observations) {
          existingMetric.observations = [];
        }
        existingMetric.observations.push(metric.value);
      }
    } else {
      const newMetric = {
        ...metric,
        labels: mergedLabels
      };
      if (metric.type === "histogram") {
        newMetric.observations = [metric.value];
      }
      existing.push(newMetric);
    }
    this.metrics.set(key, existing);
  }
  /**
   * Increment a counter
   */
  incCounter(name, help, value = 1, labels) {
    this.register({
      name: `${this.prefix}_${name}`,
      help,
      type: "counter",
      value,
      labels
    });
  }
  /**
   * Set a gauge value
   */
  setGauge(name, help, value, labels) {
    this.register({
      name: `${this.prefix}_${name}`,
      help,
      type: "gauge",
      value,
      labels
    });
  }
  /**
   * Observe a histogram value
   */
  observeHistogram(name, help, value, labels, buckets) {
    this.register({
      name: `${this.prefix}_${name}`,
      help,
      type: "histogram",
      value,
      labels,
      buckets: buckets ?? [
        5e-3,
        0.01,
        0.025,
        0.05,
        0.1,
        0.25,
        0.5,
        1,
        2.5,
        5,
        10
      ]
    });
  }
  /**
   * Record telemetry from L0Monitor
   */
  recordTelemetry(telemetry, labels) {
    const baseLabels = { ...labels };
    if (telemetry.duration !== void 0) {
      this.observeHistogram(
        "request_duration_seconds",
        "L0 request duration in seconds",
        telemetry.duration / 1e3,
        baseLabels,
        [0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30, 60]
      );
    }
    this.incCounter(
      "tokens_total",
      "Total tokens generated",
      telemetry.metrics.totalTokens,
      baseLabels
    );
    if (telemetry.metrics.tokensPerSecond !== void 0) {
      this.setGauge(
        "tokens_per_second",
        "Tokens generated per second",
        telemetry.metrics.tokensPerSecond,
        baseLabels
      );
    }
    if (telemetry.metrics.timeToFirstToken !== void 0) {
      this.observeHistogram(
        "time_to_first_token_seconds",
        "Time to first token in seconds",
        telemetry.metrics.timeToFirstToken / 1e3,
        baseLabels,
        [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10]
      );
    }
    if (telemetry.metrics.totalRetries > 0) {
      this.incCounter(
        "retries_total",
        "Total retry attempts",
        telemetry.metrics.totalRetries,
        baseLabels
      );
      this.incCounter(
        "retries_network_total",
        "Network-related retry attempts",
        telemetry.metrics.networkRetryCount,
        { ...baseLabels, retry_type: "network" }
      );
      this.incCounter(
        "retries_model_total",
        "Model-related retry attempts",
        telemetry.metrics.modelRetryCount,
        { ...baseLabels, retry_type: "model" }
      );
    }
    if (telemetry.network.errorCount > 0) {
      this.incCounter(
        "network_errors_total",
        "Total network errors",
        telemetry.network.errorCount,
        baseLabels
      );
      for (const [errorType, count] of Object.entries(
        telemetry.network.errorsByType
      )) {
        this.incCounter(
          "network_errors_by_type_total",
          "Network errors by type",
          count,
          { ...baseLabels, error_type: errorType }
        );
      }
    }
    if (telemetry.guardrails && telemetry.guardrails.violationCount > 0) {
      this.incCounter(
        "guardrail_violations_total",
        "Total guardrail violations",
        telemetry.guardrails.violationCount,
        baseLabels
      );
      for (const [severity, count] of Object.entries(
        telemetry.guardrails.violationsBySeverity
      )) {
        if (count > 0) {
          this.incCounter(
            "guardrail_violations_by_severity_total",
            "Guardrail violations by severity",
            count,
            { ...baseLabels, severity }
          );
        }
      }
      for (const [rule, count] of Object.entries(
        telemetry.guardrails.violationsByRule
      )) {
        this.incCounter(
          "guardrail_violations_by_rule_total",
          "Guardrail violations by rule",
          count,
          { ...baseLabels, rule }
        );
      }
    }
    if (telemetry.drift?.detected) {
      this.incCounter(
        "drift_detected_total",
        "Drift detection events",
        1,
        baseLabels
      );
    }
    this.incCounter("requests_total", "Total L0 requests", 1, baseLabels);
  }
  /**
   * Record from L0Monitor directly
   */
  recordFromMonitor(monitor, labels) {
    const telemetry = monitor.getTelemetry();
    if (telemetry) {
      this.recordTelemetry(telemetry, labels);
    }
  }
  /**
   * Export metrics in Prometheus text format
   */
  expose() {
    const lines = [];
    const processed = /* @__PURE__ */ new Set();
    for (const [name, metricList] of this.metrics.entries()) {
      if (metricList.length === 0) continue;
      const first = metricList[0];
      if (!processed.has(name)) {
        lines.push(`# HELP ${name} ${first.help}`);
        lines.push(`# TYPE ${name} ${first.type}`);
        processed.add(name);
      }
      for (const metric of metricList) {
        const labelStr = this.formatLabels(metric.labels);
        if (metric.type === "histogram" && metric.observations) {
          const observations = metric.observations;
          const buckets = metric.buckets ?? [
            5e-3,
            0.01,
            0.025,
            0.05,
            0.1,
            0.25,
            0.5,
            1,
            2.5,
            5,
            10
          ];
          const sum = observations.reduce((a, b) => a + b, 0);
          const count = observations.length;
          for (const le of buckets) {
            const bucketCount = observations.filter((v) => v <= le).length;
            const bucketLabelStr = labelStr ? labelStr.replace("}", `,le="${le}"}`) : `{le="${le}"}`;
            lines.push(`${name}_bucket${bucketLabelStr} ${bucketCount}`);
          }
          const infLabelStr = labelStr ? labelStr.replace("}", `,le="+Inf"}`) : `{le="+Inf"}`;
          lines.push(`${name}_bucket${infLabelStr} ${count}`);
          lines.push(`${name}_sum${labelStr} ${sum}`);
          lines.push(`${name}_count${labelStr} ${count}`);
        } else if (metric.type === "histogram") {
          lines.push(
            `${name}_bucket${labelStr ? labelStr.replace("}", `,le="+Inf"}`) : `{le="+Inf"}`} 1`
          );
          lines.push(`${name}_sum${labelStr} ${metric.value}`);
          lines.push(`${name}_count${labelStr} 1`);
        } else {
          lines.push(`${name}${labelStr} ${metric.value}`);
        }
      }
    }
    return lines.join("\n");
  }
  /**
   * Format labels for Prometheus output
   */
  formatLabels(labels) {
    if (!labels || Object.keys(labels).length === 0) {
      return "";
    }
    const pairs = Object.entries(labels).map(([k, v]) => `${k}="${this.escapeLabel(v)}"`).join(",");
    return `{${pairs}}`;
  }
  /**
   * Escape label value for Prometheus
   */
  escapeLabel(value) {
    return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");
  }
  /**
   * Clear all metrics
   */
  clear() {
    this.metrics.clear();
  }
  /**
   * Get metrics as JSON (for debugging)
   */
  toJSON() {
    return Object.fromEntries(this.metrics.entries());
  }
};
var PrometheusCollector = class {
  registry;
  constructor(options = {}) {
    this.registry = new PrometheusRegistry(options);
  }
  /**
   * Record telemetry, aggregating with previous values
   */
  record(telemetry, labels) {
    this.registry.recordTelemetry(telemetry, labels);
  }
  /**
   * Record from L0Monitor
   */
  recordFromMonitor(monitor, labels) {
    this.registry.recordFromMonitor(monitor, labels);
  }
  /**
   * Expose metrics in Prometheus format
   */
  expose() {
    return this.registry.expose();
  }
  /**
   * Clear all collected metrics
   */
  clear() {
    this.registry.clear();
  }
  /**
   * Get the underlying registry
   */
  getRegistry() {
    return this.registry;
  }
};
function createPrometheusRegistry(options) {
  return new PrometheusRegistry(options);
}
function createPrometheusCollector(options) {
  return new PrometheusCollector(options);
}
function prometheusMiddleware(collector) {
  return (_req, res) => {
    res.set("Content-Type", "text/plain; version=0.0.4; charset=utf-8");
    res.send(collector.expose());
  };
}
var DEFAULT_BUCKETS = {
  duration: [0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30, 60, 120],
  ttft: [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  tokens: [10, 50, 100, 250, 500, 1e3, 2500, 5e3, 1e4],
  retries: [0, 1, 2, 3, 5, 10]
};
var METRIC_NAMES = {
  requestsTotal: "l0_requests_total",
  requestDuration: "l0_request_duration_seconds",
  tokensTotal: "l0_tokens_total",
  tokensPerSecond: "l0_tokens_per_second",
  timeToFirstToken: "l0_time_to_first_token_seconds",
  retriesTotal: "l0_retries_total",
  networkErrorsTotal: "l0_network_errors_total",
  guardrailViolationsTotal: "l0_guardrail_violations_total",
  driftDetectedTotal: "l0_drift_detected_total"
};

// src/runtime/sentry.ts
var L0Sentry = class {
  sentry;
  config;
  constructor(config) {
    this.sentry = config.sentry;
    this.config = {
      captureNetworkErrors: config.captureNetworkErrors ?? true,
      captureGuardrailViolations: config.captureGuardrailViolations ?? true,
      minGuardrailSeverity: config.minGuardrailSeverity ?? "error",
      breadcrumbsForTokens: config.breadcrumbsForTokens ?? false,
      enableTracing: config.enableTracing ?? true,
      tags: config.tags,
      environment: config.environment
    };
    if (this.config.tags) {
      for (const [key, value] of Object.entries(this.config.tags)) {
        this.sentry.setTag(key, value);
      }
    }
    if (this.config.environment) {
      this.sentry.setTag("environment", this.config.environment);
    }
  }
  /**
   * Start tracking an L0 execution
   * Returns a span finish function if tracing is enabled
   */
  startExecution(name = "l0.execution", metadata) {
    this.sentry.addBreadcrumb({
      type: "info",
      category: "l0",
      message: "L0 execution started",
      data: metadata,
      level: "info",
      timestamp: Date.now() / 1e3
    });
    if (this.config.enableTracing && this.sentry.startSpan) {
      let finishSpan;
      this.sentry.startSpan(
        {
          name,
          op: "l0.execution",
          attributes: metadata
        },
        (span) => {
          finishSpan = () => span?.end();
        }
      );
      return finishSpan;
    }
    return void 0;
  }
  /**
   * Start tracking stream consumption
   */
  startStream() {
    this.sentry.addBreadcrumb({
      type: "info",
      category: "l0.stream",
      message: "Stream started",
      level: "info",
      timestamp: Date.now() / 1e3
    });
  }
  /**
   * Record a token received
   */
  recordToken(token) {
    if (this.config.breadcrumbsForTokens) {
      this.sentry.addBreadcrumb({
        type: "debug",
        category: "l0.token",
        message: token ? `Token: ${token.slice(0, 50)}` : "Token received",
        level: "debug",
        timestamp: Date.now() / 1e3
      });
    }
  }
  /**
   * Record first token (TTFT)
   */
  recordFirstToken(ttft) {
    this.sentry.addBreadcrumb({
      type: "info",
      category: "l0.stream",
      message: `First token received`,
      data: { ttft_ms: ttft },
      level: "info",
      timestamp: Date.now() / 1e3
    });
  }
  /**
   * Record a network error
   */
  recordNetworkError(error, errorType, retried) {
    this.sentry.addBreadcrumb({
      type: "error",
      category: "l0.network",
      message: `Network error: ${errorType}`,
      data: {
        error_type: errorType,
        message: error.message,
        retried
      },
      level: "error",
      timestamp: Date.now() / 1e3
    });
    if (this.config.captureNetworkErrors && !retried) {
      this.sentry.captureException(error, {
        tags: {
          error_type: errorType,
          component: "l0.network"
        },
        extra: {
          retried
        }
      });
    }
  }
  /**
   * Record a retry attempt
   */
  recordRetry(attempt, reason, isNetworkError2) {
    this.sentry.addBreadcrumb({
      type: "info",
      category: "l0.retry",
      message: `Retry attempt ${attempt}`,
      data: {
        attempt,
        reason,
        is_network_error: isNetworkError2
      },
      level: "warning",
      timestamp: Date.now() / 1e3
    });
  }
  /**
   * Record guardrail violations
   */
  recordGuardrailViolations(violations) {
    for (const violation of violations) {
      this.sentry.addBreadcrumb({
        type: "error",
        category: "l0.guardrail",
        message: `Guardrail violation: ${violation.rule}`,
        data: {
          rule: violation.rule,
          severity: violation.severity,
          message: violation.message,
          recoverable: violation.recoverable
        },
        level: this.mapSeverity(violation.severity),
        timestamp: Date.now() / 1e3
      });
      if (this.config.captureGuardrailViolations && this.shouldCapture(violation.severity)) {
        this.sentry.captureMessage(
          `Guardrail violation: ${violation.message}`,
          this.mapSeverity(violation.severity)
        );
      }
    }
  }
  /**
   * Record drift detection
   */
  recordDrift(detected, types) {
    if (detected) {
      this.sentry.addBreadcrumb({
        type: "error",
        category: "l0.drift",
        message: `Drift detected: ${types.join(", ")}`,
        data: { types },
        level: "warning",
        timestamp: Date.now() / 1e3
      });
    }
  }
  /**
   * Complete stream tracking
   */
  completeStream(tokenCount) {
    this.sentry.addBreadcrumb({
      type: "info",
      category: "l0.stream",
      message: "Stream completed",
      data: { token_count: tokenCount },
      level: "info",
      timestamp: Date.now() / 1e3
    });
  }
  /**
   * Complete execution tracking
   */
  completeExecution(telemetry) {
    this.sentry.setContext("l0_telemetry", {
      session_id: telemetry.sessionId,
      duration_ms: telemetry.duration,
      tokens: telemetry.metrics.totalTokens,
      tokens_per_second: telemetry.metrics.tokensPerSecond,
      ttft_ms: telemetry.metrics.timeToFirstToken,
      retries: telemetry.metrics.totalRetries,
      network_errors: telemetry.network.errorCount,
      guardrail_violations: telemetry.guardrails?.violationCount ?? 0
    });
    this.sentry.addBreadcrumb({
      type: "info",
      category: "l0",
      message: "L0 execution completed",
      data: {
        duration_ms: telemetry.duration,
        tokens: telemetry.metrics.totalTokens,
        retries: telemetry.metrics.totalRetries
      },
      level: "info",
      timestamp: Date.now() / 1e3
    });
  }
  /**
   * Record execution failure
   */
  recordFailure(error, telemetry) {
    if (telemetry) {
      this.sentry.setContext("l0_telemetry", {
        session_id: telemetry.sessionId,
        duration_ms: telemetry.duration,
        tokens: telemetry.metrics.totalTokens,
        retries: telemetry.metrics.totalRetries,
        network_errors: telemetry.network.errorCount
      });
    }
    this.sentry.captureException(error, {
      tags: {
        component: "l0"
      },
      extra: {
        telemetry: telemetry ? {
          session_id: telemetry.sessionId,
          duration_ms: telemetry.duration,
          tokens: telemetry.metrics.totalTokens
        } : void 0
      }
    });
  }
  /**
   * Record from L0Monitor
   */
  recordFromMonitor(monitor) {
    const telemetry = monitor.getTelemetry();
    if (telemetry) {
      this.completeExecution(telemetry);
    }
  }
  /**
   * Map guardrail severity to Sentry severity
   */
  mapSeverity(severity) {
    switch (severity) {
      case "fatal":
        return "fatal";
      case "error":
        return "error";
      case "warning":
        return "warning";
      default:
        return "info";
    }
  }
  /**
   * Check if severity meets capture threshold
   */
  shouldCapture(severity) {
    const levels = ["warning", "error", "fatal"];
    const minIndex = levels.indexOf(this.config.minGuardrailSeverity);
    const currentIndex = levels.indexOf(severity);
    return currentIndex >= minIndex;
  }
};
function createSentryIntegration(config) {
  return new L0Sentry(config);
}
function sentryInterceptor(config) {
  const integration = createSentryIntegration(config);
  let finishSpan;
  return {
    name: "sentry",
    before: async (options) => {
      finishSpan = integration.startExecution(
        "l0.execution",
        options.monitoring?.metadata
      );
      return options;
    },
    after: async (result) => {
      if (result.telemetry) {
        integration.completeExecution(result.telemetry);
      }
      finishSpan?.();
      return result;
    },
    onError: async (error, _options) => {
      integration.recordFailure(error);
      finishSpan?.();
    }
  };
}
async function withSentry(config, fn) {
  const integration = createSentryIntegration(config);
  integration.startExecution();
  try {
    const result = await fn();
    if (result.telemetry) {
      integration.completeExecution(result.telemetry);
    }
    return result;
  } catch (error) {
    integration.recordFailure(
      error instanceof Error ? error : new Error(String(error))
    );
    throw error;
  }
}

// node_modules/@opentelemetry/api/build/esm/trace/span_kind.js
var SpanKind;
(function(SpanKind2) {
  SpanKind2[SpanKind2["INTERNAL"] = 0] = "INTERNAL";
  SpanKind2[SpanKind2["SERVER"] = 1] = "SERVER";
  SpanKind2[SpanKind2["CLIENT"] = 2] = "CLIENT";
  SpanKind2[SpanKind2["PRODUCER"] = 3] = "PRODUCER";
  SpanKind2[SpanKind2["CONSUMER"] = 4] = "CONSUMER";
})(SpanKind || (SpanKind = {}));

// node_modules/@opentelemetry/api/build/esm/trace/status.js
var SpanStatusCode;
(function(SpanStatusCode2) {
  SpanStatusCode2[SpanStatusCode2["UNSET"] = 0] = "UNSET";
  SpanStatusCode2[SpanStatusCode2["OK"] = 1] = "OK";
  SpanStatusCode2[SpanStatusCode2["ERROR"] = 2] = "ERROR";
})(SpanStatusCode || (SpanStatusCode = {}));

// src/runtime/opentelemetry.ts
var SemanticAttributes = {
  // General LLM attributes
  LLM_SYSTEM: "gen_ai.system",
  LLM_REQUEST_MODEL: "gen_ai.request.model",
  LLM_RESPONSE_MODEL: "gen_ai.response.model",
  LLM_REQUEST_MAX_TOKENS: "gen_ai.request.max_tokens",
  LLM_REQUEST_TEMPERATURE: "gen_ai.request.temperature",
  LLM_REQUEST_TOP_P: "gen_ai.request.top_p",
  LLM_RESPONSE_FINISH_REASON: "gen_ai.response.finish_reasons",
  LLM_USAGE_INPUT_TOKENS: "gen_ai.usage.input_tokens",
  LLM_USAGE_OUTPUT_TOKENS: "gen_ai.usage.output_tokens",
  // L0-specific attributes
  L0_SESSION_ID: "l0.session_id",
  L0_STREAM_COMPLETED: "l0.stream.completed",
  L0_FALLBACK_INDEX: "l0.fallback.index",
  L0_RETRY_COUNT: "l0.retry.count",
  L0_NETWORK_ERROR_COUNT: "l0.network.error_count",
  L0_GUARDRAIL_VIOLATION_COUNT: "l0.guardrail.violation_count",
  L0_DRIFT_DETECTED: "l0.drift.detected",
  L0_TIME_TO_FIRST_TOKEN: "l0.time_to_first_token_ms",
  L0_TOKENS_PER_SECOND: "l0.tokens_per_second"
};
var L0OpenTelemetry = class {
  tracer;
  meter;
  config;
  // Metrics
  requestCounter;
  tokenCounter;
  retryCounter;
  errorCounter;
  durationHistogram;
  ttftHistogram;
  activeStreamsGauge;
  activeStreams = 0;
  constructor(config) {
    this.tracer = config.tracer;
    this.meter = config.meter;
    this.config = {
      serviceName: config.serviceName ?? "l0",
      traceTokens: config.traceTokens ?? false,
      recordTokenContent: config.recordTokenContent ?? false,
      recordGuardrailViolations: config.recordGuardrailViolations ?? true,
      defaultAttributes: config.defaultAttributes
    };
    if (this.meter) {
      this.initializeMetrics();
    }
  }
  /**
   * Initialize OpenTelemetry metrics
   */
  initializeMetrics() {
    if (!this.meter) return;
    this.requestCounter = this.meter.createCounter("l0.requests", {
      description: "Total number of L0 stream requests",
      unit: "1"
    });
    this.tokenCounter = this.meter.createCounter("l0.tokens", {
      description: "Total number of tokens processed",
      unit: "1"
    });
    this.retryCounter = this.meter.createCounter("l0.retries", {
      description: "Total number of retry attempts",
      unit: "1"
    });
    this.errorCounter = this.meter.createCounter("l0.errors", {
      description: "Total number of errors",
      unit: "1"
    });
    this.durationHistogram = this.meter.createHistogram("l0.duration", {
      description: "Stream duration in milliseconds",
      unit: "ms"
    });
    this.ttftHistogram = this.meter.createHistogram("l0.time_to_first_token", {
      description: "Time to first token in milliseconds",
      unit: "ms"
    });
    this.activeStreamsGauge = this.meter.createUpDownCounter(
      "l0.active_streams",
      {
        description: "Number of currently active streams",
        unit: "1"
      }
    );
  }
  /**
   * Trace an L0 stream operation
   *
   * @param name - Span name
   * @param fn - Function that returns an L0 result
   * @param attributes - Additional span attributes
   */
  async traceStream(name, fn, attributes) {
    if (!this.tracer) {
      return fn(createNoOpSpan());
    }
    const spanAttributes = {
      ...this.config.defaultAttributes,
      ...attributes
    };
    const span = this.tracer.startSpan(`${this.config.serviceName}.${name}`, {
      kind: SpanKind.CLIENT,
      attributes: spanAttributes
    });
    this.activeStreams++;
    this.activeStreamsGauge?.add(1);
    try {
      const result = await fn(span);
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (error) {
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: error instanceof Error ? error.message : String(error)
      });
      if (error instanceof Error) {
        span.recordException(error);
      }
      this.errorCounter?.add(1, { type: "stream_error" });
      throw error;
    } finally {
      this.activeStreams--;
      this.activeStreamsGauge?.add(-1);
      span.end();
    }
  }
  /**
   * Record telemetry from a completed L0 operation
   *
   * This is the primary method for recording metrics. All metric counters
   * are updated here using the aggregated data from L0Monitor to ensure
   * accurate counting without duplication.
   */
  recordTelemetry(telemetry, span) {
    const attributes = {
      [SemanticAttributes.L0_SESSION_ID]: telemetry.sessionId
    };
    this.requestCounter?.add(1, { status: "completed" });
    if (telemetry.metrics.totalTokens > 0) {
      this.tokenCounter?.add(telemetry.metrics.totalTokens, attributes);
    }
    if (telemetry.metrics.totalRetries > 0) {
      this.retryCounter?.add(telemetry.metrics.totalRetries, {
        ...attributes,
        type: "total"
      });
    }
    if (telemetry.metrics.networkRetryCount > 0) {
      this.retryCounter?.add(telemetry.metrics.networkRetryCount, {
        ...attributes,
        type: "network"
      });
    }
    if (telemetry.metrics.modelRetryCount > 0) {
      this.retryCounter?.add(telemetry.metrics.modelRetryCount, {
        ...attributes,
        type: "model"
      });
    }
    if (telemetry.network.errorCount > 0) {
      const errorsByType = telemetry.network.errorsByType;
      if (errorsByType && Object.keys(errorsByType).length > 0) {
        for (const [errorType, count] of Object.entries(errorsByType)) {
          if (count > 0) {
            this.errorCounter?.add(count, {
              ...attributes,
              type: "network",
              error_type: errorType
            });
          }
        }
      } else {
        this.errorCounter?.add(telemetry.network.errorCount, {
          ...attributes,
          type: "network"
        });
      }
    }
    if (telemetry.guardrails?.violationCount && telemetry.guardrails.violationCount > 0) {
      const byRuleAndSeverity = telemetry.guardrails.violationsByRuleAndSeverity;
      if (byRuleAndSeverity && Object.keys(byRuleAndSeverity).length > 0) {
        for (const [rule, severities] of Object.entries(byRuleAndSeverity)) {
          for (const [severity, count] of Object.entries(severities)) {
            if (count > 0) {
              this.errorCounter?.add(count, {
                ...attributes,
                type: "guardrail_violation",
                rule,
                severity
              });
            }
          }
        }
      } else {
        this.errorCounter?.add(telemetry.guardrails.violationCount, {
          ...attributes,
          type: "guardrail_violation"
        });
      }
    }
    if (telemetry.drift?.detected) {
      this.errorCounter?.add(1, {
        ...attributes,
        type: "drift"
      });
    }
    if (telemetry.duration) {
      this.durationHistogram?.record(telemetry.duration, attributes);
    }
    if (telemetry.metrics.timeToFirstToken) {
      this.ttftHistogram?.record(
        telemetry.metrics.timeToFirstToken,
        attributes
      );
    }
    if (span?.isRecording()) {
      span.setAttributes({
        [SemanticAttributes.L0_SESSION_ID]: telemetry.sessionId,
        [SemanticAttributes.LLM_USAGE_OUTPUT_TOKENS]: telemetry.metrics.totalTokens,
        [SemanticAttributes.L0_RETRY_COUNT]: telemetry.metrics.totalRetries,
        [SemanticAttributes.L0_NETWORK_ERROR_COUNT]: telemetry.network.errorCount
      });
      if (telemetry.guardrails?.violationCount) {
        span.setAttribute(
          SemanticAttributes.L0_GUARDRAIL_VIOLATION_COUNT,
          telemetry.guardrails.violationCount
        );
      }
      if (telemetry.drift?.detected) {
        span.setAttribute(SemanticAttributes.L0_DRIFT_DETECTED, true);
      }
      if (telemetry.metrics.timeToFirstToken) {
        span.setAttribute(
          SemanticAttributes.L0_TIME_TO_FIRST_TOKEN,
          telemetry.metrics.timeToFirstToken
        );
      }
      if (telemetry.metrics.tokensPerSecond) {
        span.setAttribute(
          SemanticAttributes.L0_TOKENS_PER_SECOND,
          telemetry.metrics.tokensPerSecond
        );
      }
      if (telemetry.duration) {
        span.setAttribute("duration_ms", telemetry.duration);
      }
    }
  }
  /**
   * Record a token event (span event only, metrics come from recordTelemetry)
   *
   * Note: This method only adds span events for tracing. Metric counters are
   * updated via recordTelemetry() using aggregated data from L0Monitor to
   * avoid double-counting.
   */
  recordToken(span, content) {
    if (this.config.traceTokens && span?.isRecording()) {
      const eventAttributes = {};
      if (this.config.recordTokenContent && content) {
        eventAttributes["token.content"] = content;
      }
      span.addEvent("token", eventAttributes);
    }
  }
  /**
   * Record a retry attempt (span event only, metrics come from recordTelemetry)
   *
   * Note: This method only adds span events for tracing. Metric counters are
   * updated via recordTelemetry() using aggregated data from L0Monitor to
   * avoid double-counting.
   */
  recordRetry(reason, attempt, span) {
    if (span?.isRecording()) {
      span.addEvent("retry", {
        "retry.reason": reason,
        "retry.attempt": attempt
      });
    }
  }
  /**
   * Record a network error (span event only, metrics come from recordTelemetry)
   *
   * Note: This method only adds span events for tracing. Metric counters are
   * updated via recordTelemetry() using aggregated data from L0Monitor to
   * avoid double-counting.
   */
  recordNetworkError(error, errorType, span) {
    if (span?.isRecording()) {
      span.addEvent("network_error", {
        "error.type": errorType,
        "error.message": error.message
      });
    }
  }
  /**
   * Record a guardrail violation (span event only, metrics come from recordTelemetry)
   *
   * Note: This method only adds span events for tracing. Metric counters are
   * updated via recordTelemetry() using aggregated data from L0Monitor to
   * avoid double-counting.
   */
  recordGuardrailViolation(violation, span) {
    if (!this.config.recordGuardrailViolations) return;
    if (span?.isRecording()) {
      span.addEvent("guardrail_violation", {
        "guardrail.rule": violation.rule,
        "guardrail.severity": violation.severity,
        "guardrail.message": violation.message
      });
    }
  }
  /**
   * Record drift detection (span event only, metrics come from recordTelemetry)
   *
   * Note: This method only adds span events for tracing. Metric counters are
   * updated via recordTelemetry() using aggregated data from L0Monitor to
   * avoid double-counting.
   */
  recordDrift(driftType, confidence, span) {
    if (span?.isRecording()) {
      span.setAttribute(SemanticAttributes.L0_DRIFT_DETECTED, true);
      span.addEvent("drift_detected", {
        "drift.type": driftType,
        "drift.confidence": confidence
      });
    }
  }
  /**
   * Create a child span for a sub-operation
   */
  createSpan(name, attributes) {
    if (!this.tracer) {
      return createNoOpSpan();
    }
    return this.tracer.startSpan(`${this.config.serviceName}.${name}`, {
      kind: SpanKind.INTERNAL,
      attributes: {
        ...this.config.defaultAttributes,
        ...attributes
      }
    });
  }
  /**
   * Connect to an L0Monitor for automatic telemetry recording
   */
  connectMonitor(monitor) {
    const originalComplete = monitor.complete.bind(monitor);
    monitor.complete = () => {
      originalComplete();
      const telemetry = monitor.getTelemetry();
      if (telemetry) {
        this.recordTelemetry(telemetry);
      }
    };
  }
  /**
   * Get current active stream count
   */
  getActiveStreams() {
    return this.activeStreams;
  }
};
function createOpenTelemetry(config) {
  return new L0OpenTelemetry(config);
}
function createNoOpSpan() {
  return {
    spanContext: () => ({
      traceId: "",
      spanId: "",
      traceFlags: 0
    }),
    setAttribute: function() {
      return this;
    },
    setAttributes: function() {
      return this;
    },
    addEvent: function() {
      return this;
    },
    addLink: function() {
      return this;
    },
    addLinks: function() {
      return this;
    },
    setStatus: function() {
      return this;
    },
    updateName: function() {
      return this;
    },
    recordException: function() {
    },
    end: function() {
    },
    isRecording: function() {
      return false;
    }
  };
}
function openTelemetryInterceptor(config) {
  const otel = new L0OpenTelemetry(config);
  return {
    name: "opentelemetry",
    onStart: (context) => {
      context.span = otel.createSpan("stream");
    },
    onToken: (token, context) => {
      otel.recordToken(context.span, token);
    },
    onRetry: (reason, attempt, context) => {
      otel.recordRetry(reason, attempt, context.span);
    },
    onError: (error, errorType, context) => {
      otel.recordNetworkError(error, errorType, context.span);
    },
    onViolation: (violation, context) => {
      otel.recordGuardrailViolation(violation, context.span);
    },
    onComplete: (telemetry, context) => {
      otel.recordTelemetry(telemetry, context.span);
      context.span?.end();
    }
  };
}

// src/runtime/parallel.ts
async function parallel(operations, options = {}) {
  const {
    concurrency = 5,
    failFast = false,
    sharedRetry,
    sharedMonitoring,
    onProgress,
    onComplete,
    onError
  } = options;
  const startTime = Date.now();
  const results = new Array(
    operations.length
  ).fill(null);
  const errors = new Array(operations.length).fill(null);
  let completed = 0;
  let successCount = 0;
  let failureCount = 0;
  const mergedOperations = operations.map((op) => ({
    ...op,
    retry: op.retry || sharedRetry,
    monitoring: op.monitoring || sharedMonitoring
  }));
  const queue = mergedOperations.map((op, index) => ({ op, index }));
  const executing = [];
  const processOperation = async (item) => {
    try {
      const result = await l0(item.op);
      for await (const _event of result.stream) {
      }
      results[item.index] = result;
      successCount++;
      if (onComplete) {
        onComplete(result, item.index);
      }
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      errors[item.index] = err;
      failureCount++;
      if (onError) {
        onError(err, item.index);
      }
      if (failFast) {
        throw err;
      }
    } finally {
      completed++;
      if (onProgress) {
        onProgress(completed, operations.length);
      }
    }
  };
  try {
    for (const item of queue) {
      const promise = processOperation(item).then(() => {
        executing.splice(executing.indexOf(promise), 1);
      });
      executing.push(promise);
      if (executing.length >= concurrency) {
        await Promise.race(executing);
      }
    }
    await Promise.all(executing);
  } catch (error) {
    if (failFast) {
      await Promise.allSettled(executing);
    }
  }
  const duration = Date.now() - startTime;
  const allSucceeded = failureCount === 0;
  const aggregatedTelemetry = aggregateTelemetry(
    results.filter((r) => r !== null)
  );
  return {
    results,
    errors,
    successCount,
    failureCount,
    duration,
    allSucceeded,
    aggregatedTelemetry
  };
}
async function parallelAll(operations, options = {}) {
  return parallel(operations, { ...options, concurrency: operations.length });
}
async function sequential(operations, options = {}) {
  return parallel(operations, { ...options, concurrency: 1 });
}
async function batched(operations, batchSize, options = {}) {
  const allResults = [];
  const allErrors = [];
  let totalSuccess = 0;
  let totalFailure = 0;
  let totalDuration = 0;
  const batches = [];
  for (let i = 0; i < operations.length; i += batchSize) {
    batches.push(operations.slice(i, i + batchSize));
  }
  for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
    const batch = batches[batchIndex];
    const result = await parallel(batch, {
      ...options,
      concurrency: batchSize,
      onProgress: options.onProgress ? (completed, _total) => {
        const overallCompleted = batchIndex * batchSize + completed;
        options.onProgress(overallCompleted, operations.length);
      } : void 0
    });
    allResults.push(...result.results);
    allErrors.push(...result.errors);
    totalSuccess += result.successCount;
    totalFailure += result.failureCount;
    totalDuration += result.duration;
    if (options.failFast && !result.allSucceeded) {
      break;
    }
  }
  const aggregatedTelemetry = aggregateTelemetry(
    allResults.filter((r) => r !== null)
  );
  return {
    results: allResults,
    errors: allErrors,
    successCount: totalSuccess,
    failureCount: totalFailure,
    duration: totalDuration,
    allSucceeded: totalFailure === 0,
    aggregatedTelemetry
  };
}
async function race(operations, options = {}) {
  const { sharedRetry, sharedMonitoring } = options;
  const controllers = operations.map(() => new AbortController());
  const mergedOperations = operations.map((op, index) => ({
    ...op,
    retry: op.retry || sharedRetry,
    monitoring: op.monitoring || sharedMonitoring,
    signal: controllers[index].signal
  }));
  const promises = mergedOperations.map(async (op, index) => {
    const result = await l0(op);
    for await (const _event of result.stream) {
    }
    return { result, index };
  });
  try {
    const { result, index } = await Promise.any(promises);
    controllers.forEach((controller) => controller.abort());
    return { ...result, winnerIndex: index };
  } catch (error) {
    controllers.forEach((controller) => controller.abort());
    if (error instanceof AggregateError) {
      throw error.errors[0] || new Error("All operations failed");
    }
    throw error;
  }
}
function aggregateTelemetry(results) {
  if (results.length === 0) {
    return {
      totalTokens: 0,
      totalDuration: 0,
      totalRetries: 0,
      totalNetworkErrors: 0,
      totalViolations: 0,
      avgTokensPerSecond: 0,
      avgTimeToFirstToken: 0
    };
  }
  let totalTokens = 0;
  let totalDuration = 0;
  let totalRetries = 0;
  let totalNetworkErrors = 0;
  let totalViolations = 0;
  let sumTokensPerSecond = 0;
  let sumTimeToFirstToken = 0;
  let countWithTTFT = 0;
  let countWithTPS = 0;
  for (const result of results) {
    if (result.telemetry) {
      totalTokens += result.telemetry.metrics.totalTokens;
      totalDuration += result.telemetry.duration || 0;
      totalRetries += result.telemetry.metrics.totalRetries;
      totalNetworkErrors += result.telemetry.network.errorCount;
      totalViolations += result.telemetry.guardrails?.violationCount || 0;
      if (result.telemetry.metrics.tokensPerSecond !== void 0) {
        sumTokensPerSecond += result.telemetry.metrics.tokensPerSecond;
        countWithTPS++;
      }
      if (result.telemetry.metrics.timeToFirstToken !== void 0) {
        sumTimeToFirstToken += result.telemetry.metrics.timeToFirstToken;
        countWithTTFT++;
      }
    }
  }
  return {
    totalTokens,
    totalDuration,
    totalRetries,
    totalNetworkErrors,
    totalViolations,
    avgTokensPerSecond: countWithTPS > 0 ? sumTokensPerSecond / countWithTPS : 0,
    avgTimeToFirstToken: countWithTTFT > 0 ? sumTimeToFirstToken / countWithTTFT : 0
  };
}
var OperationPool = class {
  constructor(concurrency, options = {}) {
    this.concurrency = concurrency;
    this.options = options;
  }
  queue = [];
  activeWorkers = 0;
  /**
   * Add an operation to the pool
   */
  async execute(operation) {
    return new Promise((resolve, reject) => {
      this.queue.push({ op: operation, resolve, reject });
      this.processQueue();
    });
  }
  /**
   * Process queued operations
   */
  async processQueue() {
    if (this.activeWorkers >= this.concurrency || this.queue.length === 0) {
      return;
    }
    const item = this.queue.shift();
    if (!item) return;
    this.activeWorkers++;
    try {
      const mergedOp = {
        ...item.op,
        retry: item.op.retry || this.options.sharedRetry,
        monitoring: item.op.monitoring || this.options.sharedMonitoring
      };
      const result = await l0(mergedOp);
      for await (const _event of result.stream) {
      }
      item.resolve(result);
    } catch (error) {
      item.reject(error instanceof Error ? error : new Error(String(error)));
    } finally {
      this.activeWorkers--;
      this.processQueue();
    }
  }
  /**
   * Wait for all operations to complete
   */
  async drain() {
    while (this.queue.length > 0 || this.activeWorkers > 0) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }
  /**
   * Get current queue length
   */
  getQueueLength() {
    return this.queue.length;
  }
  /**
   * Get number of active workers
   */
  getActiveWorkers() {
    return this.activeWorkers;
  }
};
function createPool(concurrency, options = {}) {
  return new OperationPool(concurrency, options);
}

// src/utils/comparison.ts
function compareStrings(a, b, options = {}) {
  const {
    caseSensitive = true,
    normalizeWhitespace: normalizeWhitespace2 = true,
    algorithm = "levenshtein"
  } = options;
  let str1 = a;
  let str2 = b;
  if (!caseSensitive) {
    str1 = str1.toLowerCase();
    str2 = str2.toLowerCase();
  }
  if (normalizeWhitespace2) {
    str1 = str1.replace(/\s+/g, " ").trim();
    str2 = str2.replace(/\s+/g, " ").trim();
  }
  if (str1 === str2) return 1;
  switch (algorithm) {
    case "levenshtein":
      return levenshteinSimilarity(str1, str2);
    case "jaro-winkler":
      return jaroWinklerSimilarity(str1, str2);
    case "cosine":
      return cosineSimilarity(str1, str2);
    default:
      return levenshteinSimilarity(str1, str2);
  }
}
function levenshteinSimilarity(a, b) {
  if (a === b) return 1;
  if (a.length === 0 || b.length === 0) return 0;
  const distance = levenshteinDistance(a, b);
  const maxLength = Math.max(a.length, b.length);
  return 1 - distance / maxLength;
}
function levenshteinDistance(a, b) {
  const matrix = [];
  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i];
  }
  for (let j = 0; j <= a.length; j++) {
    matrix[0][j] = j;
  }
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          // substitution
          matrix[i][j - 1] + 1,
          // insertion
          matrix[i - 1][j] + 1
          // deletion
        );
      }
    }
  }
  return matrix[b.length][a.length];
}
function jaroWinklerSimilarity(a, b) {
  if (a === b) return 1;
  if (a.length === 0 || b.length === 0) return 0;
  const jaroSim = jaroSimilarity(a, b);
  const prefixLength = commonPrefixLength(a, b, 4);
  const prefixScale = 0.1;
  return jaroSim + prefixLength * prefixScale * (1 - jaroSim);
}
function jaroSimilarity(a, b) {
  const matchWindow = Math.floor(Math.max(a.length, b.length) / 2) - 1;
  const aMatches = new Array(a.length).fill(false);
  const bMatches = new Array(b.length).fill(false);
  let matches = 0;
  let transpositions = 0;
  for (let i = 0; i < a.length; i++) {
    const start = Math.max(0, i - matchWindow);
    const end = Math.min(i + matchWindow + 1, b.length);
    for (let j = start; j < end; j++) {
      if (bMatches[j] || a[i] !== b[j]) continue;
      aMatches[i] = true;
      bMatches[j] = true;
      matches++;
      break;
    }
  }
  if (matches === 0) return 0;
  let k = 0;
  for (let i = 0; i < a.length; i++) {
    if (!aMatches[i]) continue;
    while (!bMatches[k]) k++;
    if (a[i] !== b[k]) transpositions++;
    k++;
  }
  return (matches / a.length + matches / b.length + (matches - transpositions / 2) / matches) / 3;
}
function commonPrefixLength(a, b, maxLength) {
  let length = 0;
  const max = Math.min(a.length, b.length, maxLength);
  for (let i = 0; i < max; i++) {
    if (a[i] === b[i]) {
      length++;
    } else {
      break;
    }
  }
  return length;
}
function cosineSimilarity(a, b) {
  const vectorA = stringToVector(a);
  const vectorB = stringToVector(b);
  const dotProduct = Object.keys(vectorA).reduce((sum, key) => {
    return sum + (vectorA[key] || 0) * (vectorB[key] || 0);
  }, 0);
  const magnitudeA = Math.sqrt(
    Object.values(vectorA).reduce((sum, val) => sum + val * val, 0)
  );
  const magnitudeB = Math.sqrt(
    Object.values(vectorB).reduce((sum, val) => sum + val * val, 0)
  );
  if (magnitudeA === 0 || magnitudeB === 0) return 0;
  return dotProduct / (magnitudeA * magnitudeB);
}
function stringToVector(str) {
  const words = str.toLowerCase().split(/\s+/);
  const vector = {};
  for (const word of words) {
    vector[word] = (vector[word] || 0) + 1;
  }
  return vector;
}
function compareNumbers(a, b, tolerance = 1e-3) {
  return Math.abs(a - b) <= tolerance;
}
function compareArrays(a, b, options, path = "") {
  const differences = [];
  if (options.ignoreArrayOrder) {
    const aSet = new Set(a.map((item) => JSON.stringify(item)));
    const bSet = new Set(b.map((item) => JSON.stringify(item)));
    for (const item of aSet) {
      if (!bSet.has(item)) {
        differences.push({
          path: `${path}[]`,
          expected: JSON.parse(item),
          actual: void 0,
          type: "missing",
          severity: options.style === "strict" ? "error" : "warning",
          message: `Item missing in actual array`
        });
      }
    }
    for (const item of bSet) {
      if (!aSet.has(item)) {
        differences.push({
          path: `${path}[]`,
          expected: void 0,
          actual: JSON.parse(item),
          type: "extra",
          severity: options.ignoreExtraFields ? "info" : "warning",
          message: `Extra item in actual array`
        });
      }
    }
  } else {
    const maxLength = Math.max(a.length, b.length);
    for (let i = 0; i < maxLength; i++) {
      const itemPath = `${path}[${i}]`;
      if (i >= a.length) {
        differences.push({
          path: itemPath,
          expected: void 0,
          actual: b[i],
          type: "extra",
          severity: options.ignoreExtraFields ? "info" : "warning",
          message: `Extra item at index ${i}`
        });
      } else if (i >= b.length) {
        differences.push({
          path: itemPath,
          expected: a[i],
          actual: void 0,
          type: "missing",
          severity: "error",
          message: `Missing item at index ${i}`
        });
      } else {
        const itemDiffs = compareValues(a[i], b[i], options, itemPath);
        differences.push(...itemDiffs);
      }
    }
  }
  return differences;
}
function compareObjects(expected, actual, options, path = "") {
  const differences = [];
  const expectedKeys = Object.keys(expected);
  const actualKeys = Object.keys(actual);
  const allKeys = /* @__PURE__ */ new Set([...expectedKeys, ...actualKeys]);
  for (const key of allKeys) {
    const fieldPath = path ? `${path}.${key}` : key;
    const hasExpected = key in expected;
    const hasActual = key in actual;
    if (options.customComparisons?.[fieldPath]) {
      const customResult = options.customComparisons[fieldPath](
        expected[key],
        actual[key]
      );
      if (typeof customResult === "boolean" && !customResult) {
        differences.push({
          path: fieldPath,
          expected: expected[key],
          actual: actual[key],
          type: "different",
          severity: "error",
          message: `Custom comparison failed for ${fieldPath}`
        });
      } else if (typeof customResult === "number" && customResult < 0.8) {
        differences.push({
          path: fieldPath,
          expected: expected[key],
          actual: actual[key],
          type: "different",
          severity: "warning",
          message: `Custom comparison score too low: ${customResult.toFixed(2)}`,
          similarity: customResult
        });
      }
      continue;
    }
    if (!hasExpected && hasActual) {
      if (!options.ignoreExtraFields) {
        differences.push({
          path: fieldPath,
          expected: void 0,
          actual: actual[key],
          type: "extra",
          severity: options.style === "strict" ? "error" : "info",
          message: `Extra field: ${key}`
        });
      }
    } else if (hasExpected && !hasActual) {
      differences.push({
        path: fieldPath,
        expected: expected[key],
        actual: void 0,
        type: "missing",
        severity: "error",
        message: `Missing field: ${key}`
      });
    } else {
      const valueDiffs = compareValues(
        expected[key],
        actual[key],
        options,
        fieldPath
      );
      differences.push(...valueDiffs);
    }
  }
  return differences;
}
function compareValues(expected, actual, options, path = "") {
  if (expected === actual) {
    return [];
  }
  const expectedType = getType(expected);
  const actualType = getType(actual);
  if (expectedType !== actualType) {
    return [
      {
        path,
        expected,
        actual,
        type: "type-mismatch",
        severity: "error",
        message: `Type mismatch: expected ${expectedType}, got ${actualType}`
      }
    ];
  }
  switch (expectedType) {
    case "null":
    case "undefined":
      return expected === actual ? [] : [
        {
          path,
          expected,
          actual,
          type: "different",
          severity: "error",
          message: `Expected ${expected}, got ${actual}`
        }
      ];
    case "number":
      if (compareNumbers(expected, actual, options.numericTolerance)) {
        return [];
      }
      return [
        {
          path,
          expected,
          actual,
          type: "different",
          severity: "error",
          message: `Numbers differ: ${expected} vs ${actual}`
        }
      ];
    case "string":
      if (expected === actual) return [];
      const similarity = compareStrings(expected, actual, {
        caseSensitive: true,
        normalizeWhitespace: true,
        algorithm: "levenshtein"
      });
      if (options.style === "lenient" && similarity >= 0.8) {
        return [
          {
            path,
            expected,
            actual,
            type: "different",
            severity: "warning",
            message: `Strings differ but similar (${(similarity * 100).toFixed(0)}%)`,
            similarity
          }
        ];
      }
      return [
        {
          path,
          expected,
          actual,
          type: "different",
          severity: "error",
          message: `Strings differ`,
          similarity
        }
      ];
    case "boolean":
      return [
        {
          path,
          expected,
          actual,
          type: "different",
          severity: "error",
          message: `Boolean mismatch: ${expected} vs ${actual}`
        }
      ];
    case "array":
      return compareArrays(expected, actual, options, path);
    case "object":
      return compareObjects(expected, actual, options, path);
    default:
      return [
        {
          path,
          expected,
          actual,
          type: "different",
          severity: "error",
          message: `Values differ`
        }
      ];
  }
}
function getType(value) {
  if (value === null) return "null";
  if (value === void 0) return "undefined";
  if (Array.isArray(value)) return "array";
  return typeof value;
}
function deepEqual(a, b) {
  if (a === b) return true;
  if (a === null || b === null) return false;
  if (a === void 0 || b === void 0) return false;
  const typeA = typeof a;
  const typeB = typeof b;
  if (typeA !== typeB) return false;
  if (typeA !== "object") return false;
  const isArrayA = Array.isArray(a);
  const isArrayB = Array.isArray(b);
  if (isArrayA !== isArrayB) return false;
  if (isArrayA) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (!deepEqual(a[i], b[i])) return false;
    }
    return true;
  }
  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  if (keysA.length !== keysB.length) return false;
  for (const key of keysA) {
    if (!(key in b)) return false;
    if (!deepEqual(a[key], b[key])) return false;
  }
  return true;
}
function calculateSimilarityScore(differences, totalFields) {
  if (totalFields === 0) return 1;
  const weights = {
    error: 1,
    warning: 0.5,
    info: 0.1
  };
  const totalPenalty = differences.reduce((sum, diff) => {
    return sum + weights[diff.severity];
  }, 0);
  const maxPenalty = totalFields;
  return Math.max(0, 1 - totalPenalty / maxPenalty);
}
function countFields(value) {
  const type = getType(value);
  if (type === "object") {
    return Object.keys(value).reduce((sum, key) => {
      return sum + 1 + countFields(value[key]);
    }, 0);
  }
  if (type === "array") {
    return value.reduce((sum, item) => {
      return sum + countFields(item);
    }, 0);
  }
  return 1;
}

// src/utils/consensusUtils.ts
function calculateSimilarityMatrix(outputs) {
  const n = outputs.length;
  const matrix = Array(n).fill(0).map(() => Array(n).fill(0));
  for (let i = 0; i < n; i++) {
    matrix[i][i] = 1;
    for (let j = i + 1; j < n; j++) {
      const similarity = calculateOutputSimilarity(outputs[i], outputs[j]);
      matrix[i][j] = similarity;
      matrix[j][i] = similarity;
    }
  }
  return matrix;
}
function calculateOutputSimilarity(a, b) {
  if (a.data && b.data) {
    return calculateStructuralSimilarity(a.data, b.data);
  }
  return compareStrings(a.text, b.text, {
    caseSensitive: false,
    normalizeWhitespace: true,
    algorithm: "levenshtein"
  });
}
function calculateStructuralSimilarity(a, b) {
  if (a === b) return 1;
  if (a === null || a === void 0)
    return b === null || b === void 0 ? 1 : 0;
  if (b === null || b === void 0) return 0;
  const typeA = typeof a;
  const typeB = typeof b;
  if (typeA !== typeB) return 0;
  if (typeA !== "object") {
    if (typeA === "string") {
      if (a === b) return 1;
      return compareStrings(a, b, {
        caseSensitive: false,
        normalizeWhitespace: true
      });
    }
    if (typeA === "number") {
      if (a === b) return 1;
      const maxDiff = Math.max(Math.abs(a), Math.abs(b));
      if (maxDiff === 0) return 1;
      return 1 - Math.abs(a - b) / maxDiff;
    }
    return a === b ? 1 : 0;
  }
  const isArrayA = Array.isArray(a);
  const isArrayB = Array.isArray(b);
  if (isArrayA !== isArrayB) return 0;
  if (isArrayA) {
    const lengthA = a.length;
    const lengthB = b.length;
    const maxLength = Math.max(lengthA, lengthB);
    if (maxLength === 0) return 1;
    if (lengthA === lengthB && deepEqual(a, b)) return 1;
    let matches2 = 0;
    const minLength = Math.min(lengthA, lengthB);
    for (let i = 0; i < minLength; i++) {
      matches2 += calculateStructuralSimilarity(a[i], b[i]);
    }
    return matches2 / maxLength;
  }
  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  if (keysA.length === keysB.length && deepEqual(a, b)) return 1;
  const allKeys = /* @__PURE__ */ new Set([...keysA, ...keysB]);
  const total = allKeys.size;
  if (total === 0) return 1;
  let matches = 0;
  for (const key of allKeys) {
    if (key in a && key in b) {
      matches += calculateStructuralSimilarity(a[key], b[key]);
    }
  }
  return matches / total;
}
function findAgreements(outputs, threshold = 0.8) {
  const agreements = [];
  if (!outputs[0]?.data) {
    const textAgreements = findTextAgreements(outputs, threshold);
    agreements.push(...textAgreements);
  } else {
    const structuredAgreements = findStructuredAgreements(outputs, threshold);
    agreements.push(...structuredAgreements);
  }
  return agreements;
}
function findTextAgreements(outputs, threshold) {
  const agreements = [];
  const groups = [];
  const used = /* @__PURE__ */ new Set();
  for (let i = 0; i < outputs.length; i++) {
    if (used.has(i)) continue;
    const group = [i];
    used.add(i);
    for (let j = i + 1; j < outputs.length; j++) {
      if (used.has(j)) continue;
      const similarity = calculateOutputSimilarity(outputs[i], outputs[j]);
      if (similarity >= threshold) {
        group.push(j);
        used.add(j);
      }
    }
    if (group.length > 1) {
      groups.push(group);
    }
  }
  for (const group of groups) {
    const content = outputs[group[0]].text;
    const type = group.length === outputs.length ? "exact" : "similar";
    agreements.push({
      content,
      count: group.length,
      ratio: group.length / outputs.length,
      indices: group,
      type
    });
  }
  return agreements;
}
function findStructuredAgreements(outputs, threshold) {
  const agreements = [];
  const allPaths = /* @__PURE__ */ new Set();
  for (const output of outputs) {
    if (output.data) {
      getAllPaths(output.data).forEach((p) => allPaths.add(p));
    }
  }
  for (const path of allPaths) {
    const values = outputs.map((o) => getValueAtPath(o.data, path)).filter((v) => v !== void 0);
    if (values.length === 0) continue;
    const valueCounts = /* @__PURE__ */ new Map();
    values.forEach((v, i) => {
      const key = JSON.stringify(v);
      if (!valueCounts.has(key)) {
        valueCounts.set(key, []);
      }
      valueCounts.get(key).push(i);
    });
    let maxCount = 0;
    let majorityValue;
    let majorityIndices = [];
    for (const [key, indices] of valueCounts) {
      if (indices.length > maxCount) {
        maxCount = indices.length;
        majorityValue = JSON.parse(key);
        majorityIndices = indices;
      }
    }
    const ratio = maxCount / outputs.length;
    if (ratio >= threshold) {
      agreements.push({
        content: majorityValue,
        path,
        count: maxCount,
        ratio,
        indices: majorityIndices,
        type: ratio === 1 ? "exact" : "structural"
      });
    }
  }
  return agreements;
}
function findDisagreements(outputs, threshold = 0.8) {
  const disagreements = [];
  if (outputs[0]?.data) {
    const structuredDisagreements = findStructuredDisagreements(
      outputs,
      threshold
    );
    disagreements.push(...structuredDisagreements);
  } else {
    const textDisagreements = findTextDisagreements(outputs, threshold);
    disagreements.push(...textDisagreements);
  }
  return disagreements;
}
function findTextDisagreements(outputs, threshold) {
  const disagreements = [];
  const valueCounts = /* @__PURE__ */ new Map();
  outputs.forEach((output, i) => {
    const text = output.text.trim();
    let grouped = false;
    for (const [key, indices] of valueCounts) {
      const similarity = compareStrings(text, key);
      if (similarity >= threshold) {
        indices.push(i);
        grouped = true;
        break;
      }
    }
    if (!grouped) {
      valueCounts.set(text, [i]);
    }
  });
  if (valueCounts.size > 1) {
    const values = Array.from(valueCounts.entries()).map(
      ([value, indices]) => ({
        value,
        count: indices.length,
        indices
      })
    );
    const severity = calculateDisagreementSeverity(values, outputs.length);
    disagreements.push({
      values,
      severity
    });
  }
  return disagreements;
}
function findStructuredDisagreements(outputs, threshold) {
  const disagreements = [];
  const allPaths = /* @__PURE__ */ new Set();
  for (const output of outputs) {
    if (output.data) {
      getAllPaths(output.data).forEach((p) => allPaths.add(p));
    }
  }
  for (const path of allPaths) {
    const values = outputs.map((o) => ({
      value: getValueAtPath(o.data, path),
      index: outputs.indexOf(o)
    }));
    const valueCounts = /* @__PURE__ */ new Map();
    values.forEach(({ value, index }) => {
      if (value === void 0) return;
      const key = JSON.stringify(value);
      if (!valueCounts.has(key)) {
        valueCounts.set(key, []);
      }
      valueCounts.get(key).push(index);
    });
    if (valueCounts.size > 1) {
      const distinctValues = Array.from(valueCounts.entries()).map(
        ([value, indices]) => ({
          value: JSON.parse(value),
          count: indices.length,
          indices
        })
      );
      const maxCount = Math.max(...distinctValues.map((v) => v.count));
      const majorityRatio = maxCount / outputs.length;
      if (majorityRatio >= threshold) {
        continue;
      }
      const severity = calculateDisagreementSeverity(
        distinctValues,
        outputs.length
      );
      disagreements.push({
        path,
        values: distinctValues,
        severity
      });
    }
  }
  return disagreements;
}
function calculateDisagreementSeverity(values, total) {
  const maxCount = Math.max(...values.map((v) => v.count));
  const ratio = maxCount / total;
  if (ratio >= 0.8) {
    return "minor";
  } else if (ratio >= 0.6) {
    return "moderate";
  } else if (ratio >= 0.4) {
    return "major";
  } else {
    return "critical";
  }
}
function calculateFieldConsensus(outputs) {
  const fields = {};
  const allPaths = /* @__PURE__ */ new Set();
  for (const output of outputs) {
    if (output.data) {
      getAllPaths(output.data).forEach((p) => allPaths.add(p));
    }
  }
  for (const path of allPaths) {
    const values = outputs.map((o, i) => ({ value: getValueAtPath(o.data, path), index: i })).filter((v) => v.value !== void 0);
    if (values.length === 0) continue;
    const votes = {};
    const allValues = [];
    values.forEach(({ value }) => {
      const key = JSON.stringify(value);
      votes[key] = (votes[key] || 0) + 1;
      allValues.push(value);
    });
    let maxVotes = 0;
    let consensusValue;
    for (const [key, count] of Object.entries(votes)) {
      if (count > maxVotes) {
        maxVotes = count;
        consensusValue = JSON.parse(key);
      }
    }
    const agreement = maxVotes / outputs.length;
    const unanimous = maxVotes === outputs.length;
    const confidence = agreement;
    fields[path] = {
      path,
      value: consensusValue,
      agreement,
      votes,
      values: allValues,
      unanimous,
      confidence
    };
  }
  const agreedFields = Object.keys(fields).filter((k) => fields[k].unanimous);
  const disagreedFields = Object.keys(fields).filter(
    (k) => !fields[k].unanimous
  );
  const overallAgreement = Object.values(fields).reduce((sum, f) => sum + f.agreement, 0) / Object.keys(fields).length;
  return {
    fields,
    overallAgreement,
    agreedFields,
    disagreedFields
  };
}
function getAllPaths(obj, prefix = "") {
  const paths = [];
  if (obj && typeof obj === "object" && !Array.isArray(obj)) {
    for (const key of Object.keys(obj)) {
      const path = prefix ? `${prefix}.${key}` : key;
      paths.push(path);
      const value = obj[key];
      if (value && typeof value === "object" && !Array.isArray(value)) {
        paths.push(...getAllPaths(value, path));
      }
    }
  }
  return paths;
}
function getValueAtPath(obj, path) {
  if (!obj) return void 0;
  const parts = path.split(".");
  let current = obj;
  for (const part of parts) {
    if (current && typeof current === "object" && part in current) {
      current = current[part];
    } else {
      return void 0;
    }
  }
  return current;
}
function resolveMajority(outputs, weights) {
  if (outputs.length === 0) {
    throw new Error("No outputs to resolve");
  }
  const outputWeights = weights || outputs.map((o) => o.weight ?? 1);
  if (outputs[0].data) {
    const fieldConsensus = calculateFieldConsensus(outputs);
    const consensusData = {};
    for (const [path, field] of Object.entries(fieldConsensus.fields)) {
      setValueAtPath(consensusData, path, field.value);
    }
    return {
      ...outputs[0],
      index: outputs[0].index ?? 0,
      data: consensusData,
      text: JSON.stringify(consensusData)
    };
  }
  let bestIndex = 0;
  let bestScore = -1;
  for (let i = 0; i < outputs.length; i++) {
    let score = 0;
    for (let j = 0; j < outputs.length; j++) {
      if (i !== j) {
        const similarity = calculateOutputSimilarity(outputs[i], outputs[j]);
        score += similarity * (outputWeights[j] ?? 1);
      }
    }
    if (score > bestScore) {
      bestScore = score;
      bestIndex = i;
    }
  }
  return outputs[bestIndex];
}
function resolveBest(outputs, weights) {
  if (outputs.length === 0) {
    throw new Error("No outputs to resolve");
  }
  const outputWeights = weights || outputs.map((o) => o.weight ?? 1);
  let bestIndex = 0;
  let bestWeight = outputWeights[0] ?? 1;
  for (let i = 1; i < outputs.length; i++) {
    if ((outputWeights[i] ?? 1) > bestWeight) {
      bestWeight = outputWeights[i] ?? 1;
      bestIndex = i;
    }
  }
  return outputs[bestIndex];
}
function resolveMerge(outputs) {
  if (outputs.length === 0) {
    throw new Error("No outputs to resolve");
  }
  if (outputs.length === 1) {
    return outputs[0];
  }
  if (outputs[0].data) {
    const merged = {};
    const allPaths = /* @__PURE__ */ new Set();
    outputs.forEach((o) => {
      if (o.data) {
        getAllPaths(o.data).forEach((p) => allPaths.add(p));
      }
    });
    for (const path of allPaths) {
      const values = outputs.map((o) => getValueAtPath(o.data, path)).filter((v) => v !== void 0);
      if (values.length > 0) {
        setValueAtPath(merged, path, values[0]);
      }
    }
    return {
      ...outputs[0],
      index: outputs[0].index ?? 0,
      data: merged,
      text: JSON.stringify(merged)
    };
  }
  const uniqueTexts = Array.from(new Set(outputs.map((o) => o.text.trim())));
  const mergedText = uniqueTexts.join("\n\n");
  return {
    ...outputs[0],
    index: outputs[0].index ?? 0,
    text: mergedText
  };
}
function setValueAtPath(obj, path, value) {
  const parts = path.split(".");
  let current = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    if (!(part in current)) {
      current[part] = {};
    }
    current = current[part];
  }
  current[parts[parts.length - 1]] = value;
}
function meetsMinimumAgreement(agreements, outputs, threshold) {
  if (agreements.length === 0) return false;
  const maxRatio = Math.max(...agreements.map((a) => a.count / outputs));
  return maxRatio >= threshold;
}

// src/consensus.ts
async function consensus(options) {
  const {
    streams,
    schema,
    strategy = "majority",
    threshold = 0.8,
    resolveConflicts = "vote",
    weights,
    minimumAgreement = 0.6,
    timeout: timeout2,
    signal,
    detectZeroTokens = true,
    monitoring,
    onComplete,
    onConsensus,
    metadata
  } = options;
  if (streams.length < 2) {
    throw new Error("Consensus requires at least 2 streams");
  }
  const startTime = Date.now();
  const outputs = [];
  const defaultWeights = weights || streams.map(() => 1);
  const promises = streams.map(async (streamFactory, index) => {
    const outputStartTime = Date.now();
    try {
      if (schema) {
        const result2 = await structured({
          schema,
          stream: streamFactory,
          monitoring,
          detectZeroTokens
        });
        const text = result2.raw || JSON.stringify(result2.data);
        return {
          index,
          text,
          data: result2.data,
          l0Result: void 0,
          structuredResult: result2,
          status: "success",
          duration: Date.now() - outputStartTime,
          weight: defaultWeights[index] ?? 1
        };
      } else {
        const result2 = await l0({
          stream: streamFactory,
          monitoring,
          signal,
          detectZeroTokens
        });
        let text = "";
        for await (const event of result2.stream) {
          if (event.type === "token" && event.value) {
            text += event.value;
          }
        }
        return {
          index,
          text: text || result2.state.content,
          data: void 0,
          l0Result: result2,
          status: "success",
          duration: Date.now() - outputStartTime,
          weight: defaultWeights[index] ?? 1
        };
      }
    } catch (error) {
      return {
        index,
        text: "",
        data: void 0,
        l0Result: void 0,
        status: "error",
        error: error instanceof Error ? error : new Error(String(error)),
        duration: Date.now() - outputStartTime,
        weight: defaultWeights[index] ?? 1
      };
    }
  });
  const timeoutPromise = timeout2 ? new Promise(
    (_, reject) => setTimeout(() => reject(new Error("Consensus timeout")), timeout2)
  ) : null;
  const results = timeoutPromise ? await Promise.race([Promise.all(promises), timeoutPromise]) : await Promise.all(promises);
  outputs.push(...results);
  if (onComplete) {
    await onComplete(outputs);
  }
  const successfulOutputs = outputs.filter((o) => o.status === "success");
  if (successfulOutputs.length === 0) {
    throw new Error("All consensus streams failed");
  }
  const similarityMatrix = calculateSimilarityMatrix(successfulOutputs);
  let totalSimilarity = 0;
  let comparisons = 0;
  let minSimilarity = 1;
  let maxSimilarity = 0;
  for (let i = 0; i < similarityMatrix.length; i++) {
    for (let j = i + 1; j < similarityMatrix.length; j++) {
      const sim = similarityMatrix[i]?.[j] ?? 0;
      totalSimilarity += sim;
      comparisons++;
      minSimilarity = Math.min(minSimilarity, sim);
      maxSimilarity = Math.max(maxSimilarity, sim);
    }
  }
  const averageSimilarity = comparisons > 0 ? totalSimilarity / comparisons : 1;
  const agreements = findAgreements(successfulOutputs, threshold);
  const disagreements = findDisagreements(successfulOutputs, threshold);
  if (!meetsMinimumAgreement(
    agreements,
    successfulOutputs.length,
    minimumAgreement
  )) {
    if (resolveConflicts === "fail") {
      throw new Error(
        `Consensus failed: agreement ratio ${agreements[0]?.ratio || 0} below minimum ${minimumAgreement}`
      );
    }
  }
  let consensusOutput;
  switch (strategy) {
    case "majority":
      consensusOutput = resolveMajority(successfulOutputs, defaultWeights);
      break;
    case "unanimous":
      if (averageSimilarity < 0.95) {
        if (resolveConflicts === "fail") {
          throw new Error("Unanimous consensus failed: outputs differ");
        }
        consensusOutput = resolveMajority(successfulOutputs, defaultWeights);
      } else {
        consensusOutput = successfulOutputs[0];
      }
      break;
    case "weighted":
      if (!weights) {
        throw new Error("Weighted strategy requires weights to be provided");
      }
      consensusOutput = resolveMajority(successfulOutputs, weights);
      break;
    case "best":
      consensusOutput = resolveBest(successfulOutputs, defaultWeights);
      break;
    default:
      consensusOutput = resolveMajority(successfulOutputs, defaultWeights);
  }
  if (disagreements.length > 0 && resolveConflicts !== "vote") {
    switch (resolveConflicts) {
      case "merge":
        consensusOutput = resolveMerge(successfulOutputs);
        break;
      case "best":
        consensusOutput = resolveBest(successfulOutputs, defaultWeights);
        break;
      case "fail":
        throw new Error(
          `Consensus failed: ${disagreements.length} disagreements found`
        );
    }
  }
  disagreements.forEach((d) => {
    d.resolution = resolveConflicts;
    d.resolutionConfidence = averageSimilarity;
  });
  const fieldConsensus = schema ? calculateFieldConsensus(successfulOutputs) : void 0;
  const confidence = calculateConfidence(
    successfulOutputs,
    agreements,
    disagreements,
    averageSimilarity,
    strategy
  );
  const identicalOutputs = countIdenticalOutputs(successfulOutputs);
  const analysis = {
    totalOutputs: outputs.length,
    successfulOutputs: successfulOutputs.length,
    failedOutputs: outputs.length - successfulOutputs.length,
    identicalOutputs,
    similarityMatrix,
    averageSimilarity,
    minSimilarity,
    maxSimilarity,
    totalAgreements: agreements.length,
    totalDisagreements: disagreements.length,
    strategy,
    conflictResolution: resolveConflicts,
    duration: Date.now() - startTime
  };
  const status = successfulOutputs.length === outputs.length ? "success" : successfulOutputs.length > 0 ? "partial" : "failed";
  const result = {
    consensus: schema ? consensusOutput.data : consensusOutput.text,
    confidence,
    outputs,
    agreements,
    disagreements,
    analysis,
    type: schema ? "structured" : "text",
    fieldConsensus,
    status,
    metadata
  };
  if (onConsensus) {
    await onConsensus(result);
  }
  return result;
}
function calculateConfidence(outputs, agreements, disagreements, averageSimilarity, strategy) {
  if (outputs.length === 1) return 1;
  let confidence = averageSimilarity;
  if (agreements.length > 0) {
    const maxAgreementRatio = Math.max(...agreements.map((a) => a.ratio));
    confidence = (confidence + maxAgreementRatio) / 2;
  }
  if (disagreements.length > 0) {
    const majorDisagreements = disagreements.filter(
      (d) => d.severity === "major" || d.severity === "critical"
    ).length;
    const penalty = majorDisagreements * 0.1;
    confidence = Math.max(0, confidence - penalty);
  }
  if (strategy === "unanimous" && averageSimilarity > 0.95) {
    confidence = Math.min(1, confidence + 0.1);
  }
  return Math.max(0, Math.min(1, confidence));
}
function countIdenticalOutputs(outputs) {
  if (outputs.length === 0) return 0;
  const first = outputs[0].text;
  return outputs.filter((o) => o.text === first).length;
}
function quickConsensus(outputs, threshold = 0.8) {
  if (outputs.length < 2) return true;
  const counts = /* @__PURE__ */ new Map();
  outputs.forEach((output) => {
    counts.set(output, (counts.get(output) || 0) + 1);
  });
  const maxCount = Math.max(...Array.from(counts.values()));
  const ratio = maxCount / outputs.length;
  return ratio >= threshold;
}
function getConsensusValue(outputs) {
  if (outputs.length === 0) {
    throw new Error("No outputs to get consensus from");
  }
  const counts = /* @__PURE__ */ new Map();
  outputs.forEach((output) => {
    const key = JSON.stringify(output);
    const existing = counts.get(key);
    if (existing) {
      existing.count++;
    } else {
      counts.set(key, { value: output, count: 1 });
    }
  });
  let maxCount = 0;
  let consensusValue = outputs[0];
  for (const { value, count } of counts.values()) {
    if (count > maxCount) {
      maxCount = count;
      consensusValue = value;
    }
  }
  return consensusValue;
}
function validateConsensus(result, minConfidence = 0.8, maxDisagreements = 0) {
  if (result.confidence < minConfidence) {
    return false;
  }
  const criticalDisagreements = result.disagreements.filter(
    (d) => d.severity === "major" || d.severity === "critical"
  ).length;
  if (criticalDisagreements > maxDisagreements) {
    return false;
  }
  return true;
}

// src/types/consensus.ts
var strictConsensus = {
  strategy: "unanimous",
  threshold: 1,
  resolveConflicts: "fail",
  minimumAgreement: 1
};
var standardConsensus = {
  strategy: "majority",
  threshold: 0.8,
  resolveConflicts: "vote",
  minimumAgreement: 0.6
};
var lenientConsensus = {
  strategy: "majority",
  threshold: 0.7,
  resolveConflicts: "merge",
  minimumAgreement: 0.5
};
var bestConsensus = {
  strategy: "best",
  threshold: 0.8,
  resolveConflicts: "best",
  minimumAgreement: 0.5
};

// src/pipeline.ts
async function pipe(steps, input, options = {}) {
  const {
    name,
    stopOnError = true,
    timeout: timeout2,
    signal,
    monitoring,
    onStart,
    onComplete,
    onError,
    onProgress,
    metadata = {}
  } = options;
  const startTime = Date.now();
  const stepResults = [];
  let currentInput = input;
  let finalOutput = input;
  let pipelineError;
  let pipelineStatus = "success";
  let timeoutId;
  const timeoutPromise = timeout2 ? new Promise((_, reject) => {
    timeoutId = setTimeout(
      () => reject(new Error(`Pipeline timeout after ${timeout2}ms`)),
      timeout2
    );
  }) : null;
  try {
    if (onStart) {
      await onStart(input);
    }
    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      const stepStartTime = Date.now();
      if (signal?.aborted) {
        throw new Error("Pipeline aborted");
      }
      const context = {
        stepIndex: i,
        totalSteps: steps.length,
        previousResults: stepResults,
        metadata,
        signal
      };
      if (onProgress) {
        await onProgress(i, steps.length);
      }
      if (step.condition) {
        const shouldRun = await step.condition(currentInput, context);
        if (!shouldRun) {
          stepResults.push({
            stepName: step.name,
            stepIndex: i,
            input: currentInput,
            output: currentInput,
            l0Result: void 0,
            status: "skipped",
            duration: Date.now() - stepStartTime,
            startTime: stepStartTime,
            endTime: Date.now()
          });
          continue;
        }
      }
      try {
        const l0Options = await step.fn(currentInput, context);
        const executeStep = async () => {
          const result2 = await l0({
            ...l0Options,
            signal,
            monitoring
          });
          let content = "";
          for await (const event of result2.stream) {
            if (event.type === "token" && event.value) {
              content += event.value;
            }
          }
          return {
            ...result2,
            state: {
              ...result2.state,
              content: content || result2.state.content
            }
          };
        };
        const l0Result = timeoutPromise ? await Promise.race([executeStep(), timeoutPromise]) : await executeStep();
        const stepOutput = step.transform ? await step.transform(l0Result, context) : l0Result.state.content;
        const stepResult = {
          stepName: step.name,
          stepIndex: i,
          input: currentInput,
          output: stepOutput,
          l0Result,
          status: "success",
          duration: Date.now() - stepStartTime,
          startTime: stepStartTime,
          endTime: Date.now()
        };
        stepResults.push(stepResult);
        if (step.onComplete) {
          await step.onComplete(stepResult, context);
        }
        currentInput = stepOutput;
        finalOutput = stepOutput;
      } catch (error) {
        const stepError = error instanceof Error ? error : new Error(String(error));
        const stepResult = {
          stepName: step.name,
          stepIndex: i,
          input: currentInput,
          output: void 0,
          l0Result: void 0,
          status: "error",
          error: stepError,
          duration: Date.now() - stepStartTime,
          startTime: stepStartTime,
          endTime: Date.now()
        };
        stepResults.push(stepResult);
        if (step.onError) {
          await step.onError(stepError, context);
        }
        if (onError) {
          await onError(stepError, i);
        }
        if (stopOnError) {
          pipelineError = stepError;
          pipelineStatus = "error";
          break;
        } else {
          pipelineStatus = "partial";
        }
      }
    }
  } catch (error) {
    pipelineError = error instanceof Error ? error : new Error(String(error));
    pipelineStatus = "error";
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
  const result = {
    name,
    output: finalOutput,
    steps: stepResults,
    status: pipelineStatus,
    error: pipelineError,
    duration: Date.now() - startTime,
    startTime,
    endTime: Date.now(),
    metadata
  };
  if (onComplete) {
    await onComplete(result);
  }
  return result;
}
function createPipeline(steps, options = {}) {
  const pipelineSteps = [...steps];
  const pipelineOptions = { ...options };
  const pipeline = {
    name: options.name,
    steps: pipelineSteps,
    options: pipelineOptions,
    async run(input) {
      return pipe(pipelineSteps, input, pipelineOptions);
    },
    addStep(step) {
      pipelineSteps.push(step);
      return pipeline;
    },
    removeStep(name) {
      const index = pipelineSteps.findIndex((s) => s.name === name);
      if (index !== -1) {
        pipelineSteps.splice(index, 1);
      }
      return pipeline;
    },
    getStep(name) {
      return pipelineSteps.find((s) => s.name === name);
    },
    clone() {
      return createPipeline(
        pipelineSteps.map((s) => ({ ...s })),
        { ...pipelineOptions }
      );
    }
  };
  return pipeline;
}
function createStep(name, promptFn, streamFactory) {
  return {
    name,
    fn: (input) => ({
      stream: () => streamFactory(promptFn(input))
    })
  };
}
function chainPipelines(...pipelines) {
  const allSteps = [];
  for (const p of pipelines) {
    allSteps.push(...p.steps);
  }
  return createPipeline(allSteps, {
    name: pipelines.map((p) => p.name).join(" -> ")
  });
}
async function parallelPipelines(pipelines, input, combiner) {
  const results = await Promise.all(pipelines.map((p) => p.run(input)));
  return combiner(results);
}
function createBranchStep(name, condition, ifTrue, ifFalse) {
  const branchByContext = /* @__PURE__ */ new WeakMap();
  return {
    name,
    fn: async (input, context) => {
      const result = await condition(input, context);
      const step = result ? ifTrue : ifFalse;
      branchByContext.set(context, step);
      return step.fn(input, context);
    },
    transform: async (result, context) => {
      const step = branchByContext.get(context) ?? ifTrue;
      if (step.transform) {
        return step.transform(result, context);
      }
      return result.state.content;
    }
  };
}

// src/types/pipeline.ts
var fastPipeline = {
  stopOnError: true,
  monitoring: {
    enabled: false
  }
};
var reliablePipeline = {
  stopOnError: false,
  monitoring: {
    enabled: true
  }
};
var productionPipeline = {
  stopOnError: false,
  timeout: 3e5,
  // 5 minutes
  monitoring: {
    enabled: true
  }
};

// src/utils/normalize.ts
function normalizeNewlines(text) {
  if (!text) return text;
  return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}
function normalizeWhitespace(text, options = {}) {
  if (!text) return text;
  const {
    collapseSpaces = false,
    trimLines = false,
    removeEmptyLines = false
  } = options;
  let result = text;
  result = normalizeNewlines(result);
  if (collapseSpaces) {
    result = result.replace(/ {2,}/g, " ");
  }
  if (trimLines) {
    result = result.split("\n").map((line) => line.trim()).join("\n");
  }
  if (removeEmptyLines) {
    result = result.split("\n").filter((line) => line.trim().length > 0).join("\n");
  }
  return result;
}
function normalizeIndentation(text, mode = "spaces", spacesPerTab = 2) {
  if (!text) return text;
  const lines = normalizeNewlines(text).split("\n");
  if (mode === "spaces") {
    return lines.map((line) => line.replace(/\t/g, " ".repeat(spacesPerTab))).join("\n");
  } else {
    return lines.map((line) => {
      let converted = line;
      const leadingSpaces = line.match(/^ +/);
      if (leadingSpaces) {
        const spaces = leadingSpaces[0].length;
        const tabs = Math.floor(spaces / spacesPerTab);
        const remainingSpaces = spaces % spacesPerTab;
        converted = "	".repeat(tabs) + " ".repeat(remainingSpaces) + line.slice(spaces);
      }
      return converted;
    }).join("\n");
  }
}
function dedent(text) {
  if (!text) return text;
  const lines = normalizeNewlines(text).split("\n");
  let minIndent = Infinity;
  for (const line of lines) {
    if (line.trim().length === 0) continue;
    const indent2 = line.match(/^[ \t]*/)?.[0].length ?? 0;
    minIndent = Math.min(minIndent, indent2);
  }
  if (minIndent === Infinity || minIndent === 0) {
    return text;
  }
  return lines.map((line) => {
    if (line.trim().length === 0) return line;
    return line.slice(minIndent);
  }).join("\n");
}
function indent(text, indent2 = 2) {
  if (!text) return text;
  const indentStr = typeof indent2 === "number" ? " ".repeat(indent2) : indent2;
  const lines = normalizeNewlines(text).split("\n");
  return lines.map((line) => line.trim().length > 0 ? indentStr + line : line).join("\n");
}
function trimText(text) {
  if (!text) return text;
  const lines = normalizeNewlines(text).split("\n");
  while (lines.length > 0 && lines[0].trim().length === 0) {
    lines.shift();
  }
  while (lines.length > 0 && lines[lines.length - 1].trim().length === 0) {
    lines.pop();
  }
  return lines.join("\n").trim();
}
function normalizeText(text, options = {}) {
  if (!text) return text;
  const {
    newlines = true,
    whitespace = false,
    indentation = false,
    spacesPerTab = 2,
    dedent: shouldDedent = false,
    trim: trim2 = false
  } = options;
  let result = text;
  if (newlines) {
    result = normalizeNewlines(result);
  }
  if (whitespace) {
    result = normalizeWhitespace(result, {
      collapseSpaces: true,
      trimLines: false,
      removeEmptyLines: false
    });
  }
  if (indentation) {
    result = normalizeIndentation(result, indentation, spacesPerTab);
  }
  if (shouldDedent) {
    result = dedent(result);
  }
  if (trim2) {
    result = trimText(result);
  }
  return result;
}
function normalizeForModel(text) {
  if (!text) return text;
  return normalizeText(text, {
    newlines: true,
    whitespace: true,
    trim: true
  });
}

// src/format/context.ts
function formatContext(content, options = {}) {
  if (!content || content.trim().length === 0) {
    return "";
  }
  const {
    label = "Context",
    dedent: shouldDedent = true,
    normalize = true,
    delimiter = "xml",
    customDelimiterStart,
    customDelimiterEnd
  } = options;
  let processed = content;
  if (normalize) {
    processed = normalizeForModel(processed);
  }
  if (shouldDedent) {
    processed = dedent(processed);
  }
  if (customDelimiterStart && customDelimiterEnd) {
    return `${customDelimiterStart}
${processed}
${customDelimiterEnd}`;
  }
  switch (delimiter) {
    case "xml":
      return formatXmlContext(processed, label);
    case "markdown":
      return formatMarkdownContext(processed, label);
    case "brackets":
      return formatBracketContext(processed, label);
    case "none":
      return processed;
    default:
      return formatXmlContext(processed, label);
  }
}
function formatXmlContext(content, label) {
  const tag = label.toLowerCase().replace(/\s+/g, "_");
  return `<${tag}>
${content}
</${tag}>`;
}
function formatMarkdownContext(content, label) {
  return `# ${label}

${content}`;
}
function formatBracketContext(content, label) {
  const delimiter = "=".repeat(Math.max(20, label.length + 10));
  return `[${label.toUpperCase()}]
${delimiter}
${content}
${delimiter}`;
}
function formatMultipleContexts(items, options = {}) {
  const formatted = items.filter((item) => item.content && item.content.trim().length > 0).map(
    (item) => formatContext(item.content, {
      ...options,
      label: item.label || options.label
    })
  );
  return formatted.join("\n\n");
}
function formatDocument(content, metadata, options = {}) {
  if (!content || content.trim().length === 0) {
    return "";
  }
  let result = "";
  if (metadata && Object.keys(metadata).length > 0) {
    const metaLines = Object.entries(metadata).filter(([_, value]) => value && value.trim().length > 0).map(([key, value]) => `${key}: ${value}`);
    if (metaLines.length > 0) {
      result += metaLines.join("\n") + "\n\n";
    }
  }
  result += content;
  return formatContext(result, {
    label: metadata?.title || "Document",
    ...options
  });
}
function formatInstructions(instructions, options = {}) {
  return formatContext(instructions, {
    label: "Instructions",
    delimiter: "xml",
    ...options
  });
}
function escapeDelimiters(content, delimiter = "xml") {
  if (!content) return content;
  switch (delimiter) {
    case "xml":
      return content.replace(/</g, "&lt;").replace(/>/g, "&gt;");
    case "markdown":
      return content.replace(/^(#{1,6})\s/gm, "\\$1 ");
    case "brackets":
      return content.replace(/\[/g, "\\[").replace(/\]/g, "\\]");
    default:
      return content;
  }
}
function unescapeDelimiters(content, delimiter = "xml") {
  if (!content) return content;
  switch (delimiter) {
    case "xml":
      return content.replace(/&lt;/g, "<").replace(/&gt;/g, ">");
    case "markdown":
      return content.replace(/\\(#{1,6})\s/g, "$1 ");
    case "brackets":
      return content.replace(/\\\[/g, "[").replace(/\\\]/g, "]");
    default:
      return content;
  }
}

// src/format/memory.ts
function formatMemory(memory, options = {}) {
  if (typeof memory === "string") {
    return formatMemoryString(memory, options);
  }
  if (!memory || memory.length === 0) {
    return "";
  }
  const {
    maxEntries,
    includeTimestamps = false,
    includeMetadata = false,
    style = "conversational",
    normalize = true
  } = options;
  const entries = maxEntries ? memory.slice(-maxEntries) : memory;
  switch (style) {
    case "conversational":
      return formatConversationalMemory(
        entries,
        includeTimestamps,
        includeMetadata,
        normalize
      );
    case "structured":
      return formatStructuredMemory(
        entries,
        includeTimestamps,
        includeMetadata,
        normalize
      );
    case "compact":
      return formatCompactMemory(entries, normalize);
    default:
      return formatConversationalMemory(
        entries,
        includeTimestamps,
        includeMetadata,
        normalize
      );
  }
}
function formatConversationalMemory(entries, includeTimestamps, includeMetadata, normalize) {
  const lines = [];
  for (const entry of entries) {
    const content = normalize ? normalizeForModel(entry.content) : entry.content;
    const roleLabel = getRoleLabel(entry.role);
    let line = `${roleLabel}: ${content}`;
    if (includeTimestamps && entry.timestamp) {
      const date = new Date(entry.timestamp);
      line = `[${date.toISOString()}] ${line}`;
    }
    if (includeMetadata && entry.metadata) {
      const meta = Object.entries(entry.metadata).map(([k, v]) => `${k}=${v}`).join(", ");
      if (meta) {
        line += ` (${meta})`;
      }
    }
    lines.push(line);
  }
  return lines.join("\n\n");
}
function formatStructuredMemory(entries, includeTimestamps, includeMetadata, normalize) {
  const lines = ["<conversation_history>"];
  for (const entry of entries) {
    const content = normalize ? normalizeForModel(entry.content) : entry.content;
    let attrs = `role="${entry.role}"`;
    if (includeTimestamps && entry.timestamp) {
      attrs += ` timestamp="${entry.timestamp}"`;
    }
    if (includeMetadata && entry.metadata) {
      const metaStr = JSON.stringify(entry.metadata);
      attrs += ` metadata='${metaStr}'`;
    }
    lines.push(`  <message ${attrs}>`);
    lines.push(`    ${content}`);
    lines.push(`  </message>`);
  }
  lines.push("</conversation_history>");
  return lines.join("\n");
}
function formatCompactMemory(entries, normalize) {
  return entries.map((entry) => {
    const content = normalize ? normalizeForModel(entry.content) : entry.content;
    const role = (entry.role[0] ?? "U").toUpperCase();
    return `${role}: ${content}`;
  }).join("\n");
}
function formatMemoryString(memory, options) {
  const { normalize = true } = options;
  if (normalize) {
    return normalizeForModel(memory);
  }
  return memory;
}
function getRoleLabel(role) {
  switch (role) {
    case "user":
      return "User";
    case "assistant":
      return "Assistant";
    case "system":
      return "System";
    default:
      return role.charAt(0).toUpperCase() + role.slice(1);
  }
}
function createMemoryEntry(role, content, metadata) {
  return {
    role,
    content,
    timestamp: Date.now(),
    metadata
  };
}
function mergeMemory(...memories) {
  return memories.flat().sort((a, b) => {
    const timeA = a.timestamp || 0;
    const timeB = b.timestamp || 0;
    return timeA - timeB;
  });
}
function filterMemoryByRole(memory, role) {
  return memory.filter((entry) => entry.role === role);
}
function getLastNEntries(memory, n) {
  return memory.slice(-n);
}
function calculateMemorySize(memory) {
  return memory.reduce((sum, entry) => sum + entry.content.length, 0);
}
function truncateMemory(memory, maxSize) {
  const result = [];
  let currentSize = 0;
  for (let i = memory.length - 1; i >= 0; i--) {
    const entry = memory[i];
    const entrySize = entry.content.length;
    if (currentSize + entrySize <= maxSize) {
      result.unshift(entry);
      currentSize += entrySize;
    } else {
      break;
    }
  }
  return result;
}

// src/format/output.ts
function formatJsonOutput(options = {}) {
  const {
    includeInstructions = true,
    strict = true,
    schema,
    example
  } = options;
  const parts = [];
  if (includeInstructions) {
    if (strict) {
      parts.push(
        "Respond with valid JSON only. Do not include any text before or after the JSON object."
      );
      parts.push("Do not wrap the JSON in markdown code blocks or backticks.");
      parts.push("Start your response with { and end with }.");
    } else {
      parts.push("Respond with valid JSON.");
    }
  }
  if (schema) {
    parts.push("");
    parts.push("Expected JSON schema:");
    parts.push(schema);
  }
  if (example) {
    parts.push("");
    parts.push("Example output:");
    parts.push(example);
  }
  return parts.join("\n");
}
function formatStructuredOutput(format, options = {}) {
  const { strict = true, schema, example } = options;
  const parts = [];
  switch (format) {
    case "json":
      return formatJsonOutput({
        includeInstructions: true,
        strict,
        schema,
        example
      });
    case "yaml":
      if (strict) {
        parts.push("Respond with valid YAML only.");
        parts.push("Do not include any text before or after the YAML.");
      } else {
        parts.push("Respond with valid YAML.");
      }
      break;
    case "xml":
      if (strict) {
        parts.push("Respond with valid XML only.");
        parts.push("Start with an XML declaration or root element.");
        parts.push("Do not include any text before or after the XML.");
      } else {
        parts.push("Respond with valid XML.");
      }
      break;
    case "markdown":
      parts.push("Respond with well-formatted Markdown.");
      if (strict) {
        parts.push("Use proper Markdown syntax for all formatting.");
      }
      break;
    case "plain":
      parts.push("Respond with plain text only.");
      if (strict) {
        parts.push(
          "Do not use any formatting, markdown, or special characters."
        );
      }
      break;
  }
  if (schema) {
    parts.push("");
    parts.push(`Expected ${format.toUpperCase()} schema:`);
    parts.push(schema);
  }
  if (example) {
    parts.push("");
    parts.push("Example output:");
    parts.push(example);
  }
  return parts.join("\n");
}
function formatOutputConstraints(constraints) {
  const parts = [];
  if (constraints.maxLength) {
    parts.push(`Keep your response under ${constraints.maxLength} characters.`);
  }
  if (constraints.minLength) {
    parts.push(
      `Provide at least ${constraints.minLength} characters in your response.`
    );
  }
  if (constraints.noCodeBlocks) {
    parts.push("Do not use code blocks or backticks.");
  }
  if (constraints.noMarkdown) {
    parts.push("Do not use Markdown formatting.");
  }
  if (constraints.language) {
    parts.push(`Respond in ${constraints.language}.`);
  }
  if (constraints.tone) {
    parts.push(`Use a ${constraints.tone} tone.`);
  }
  return parts.join("\n");
}
function wrapOutputInstruction(instruction) {
  return `<output_format>
${instruction}
</output_format>`;
}
function createOutputFormatSection(format, options = {}) {
  const { wrap: wrap2 = true, constraints } = options;
  const parts = [];
  parts.push(formatStructuredOutput(format, options));
  if (constraints) {
    parts.push("");
    parts.push(formatOutputConstraints(constraints));
  }
  const instruction = parts.join("\n");
  return wrap2 ? wrapOutputInstruction(instruction) : instruction;
}
function extractJsonFromOutput(output) {
  if (!output) return null;
  const codeBlockMatch = output.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (codeBlockMatch && codeBlockMatch[1]) {
    return codeBlockMatch[1].trim();
  }
  const jsonMatch = output.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
  if (jsonMatch && jsonMatch[1]) {
    return jsonMatch[1].trim();
  }
  return null;
}
function cleanOutput(output) {
  if (!output) return output;
  let cleaned = output.trim();
  const prefixes = [
    /^here is the .+?:?\s*/i,
    /^here's the .+?:?\s*/i,
    /^sure,?\s*/i,
    /^certainly,?\s*/i,
    /^of course,?\s*/i
  ];
  for (const prefix of prefixes) {
    cleaned = cleaned.replace(prefix, "");
  }
  cleaned = cleaned.replace(/^```(?:\w+)?\s*\n?/, "");
  cleaned = cleaned.replace(/\n?```\s*$/, "");
  return cleaned.trim();
}

// src/format/tools.ts
function formatTool(tool, options = {}) {
  const {
    style = "json-schema",
    includeExamples = false,
    includeTypes = true
  } = options;
  switch (style) {
    case "json-schema":
      return formatToolJsonSchema(tool, includeTypes);
    case "typescript":
      return formatToolTypeScript(tool);
    case "natural":
      return formatToolNatural(tool, includeExamples);
    case "xml":
      return formatToolXml(tool);
    default:
      return formatToolJsonSchema(tool, includeTypes);
  }
}
function formatToolJsonSchema(tool, includeTypes = true) {
  const properties = {};
  const required = [];
  for (const param of tool.parameters) {
    const propDef = {
      description: param.description || ""
    };
    if (includeTypes) {
      propDef.type = param.type;
    }
    if (param.enum) {
      propDef.enum = param.enum;
    }
    if (param.default !== void 0) {
      propDef.default = param.default;
    }
    properties[param.name] = propDef;
    if (param.required) {
      required.push(param.name);
    }
  }
  const schema = {
    name: tool.name,
    description: tool.description,
    parameters: {
      type: "object",
      properties,
      required: required.length > 0 ? required : void 0
    }
  };
  return JSON.stringify(schema, null, 2);
}
function formatToolTypeScript(tool) {
  const params = tool.parameters.map((p) => {
    const optional = p.required ? "" : "?";
    const type = p.type === "integer" ? "number" : p.type;
    return `${p.name}${optional}: ${type}`;
  }).join(", ");
  let result = `/**
 * ${tool.description}
`;
  for (const param of tool.parameters) {
    result += ` * @param ${param.name}`;
    if (param.description) {
      result += ` - ${param.description}`;
    }
    result += "\n";
  }
  result += ` */
function ${tool.name}(${params}): void;`;
  return result;
}
function formatToolNatural(tool, includeExamples) {
  const lines = [];
  lines.push(`Tool: ${tool.name}`);
  lines.push(`Description: ${tool.description}`);
  lines.push("");
  lines.push("Parameters:");
  for (const param of tool.parameters) {
    const required = param.required ? "(required)" : "(optional)";
    let line = `  - ${param.name} ${required}: ${param.type}`;
    if (param.description) {
      line += ` - ${param.description}`;
    }
    if (param.enum) {
      line += ` [Options: ${param.enum.join(", ")}]`;
    }
    if (param.default !== void 0) {
      line += ` [Default: ${param.default}]`;
    }
    lines.push(line);
  }
  if (includeExamples) {
    lines.push("");
    lines.push("Example usage:");
    const exampleArgs = tool.parameters.filter((p) => p.required).map((p) => {
      const value = p.enum ? `"${p.enum[0]}"` : getExampleValue(p.type);
      return `"${p.name}": ${value}`;
    }).join(", ");
    lines.push(`  ${tool.name}({ ${exampleArgs} })`);
  }
  return lines.join("\n");
}
function formatToolXml(tool) {
  const lines = [];
  lines.push(`<tool name="${tool.name}">`);
  lines.push(`  <description>${escapeXml(tool.description)}</description>`);
  lines.push(`  <parameters>`);
  for (const param of tool.parameters) {
    const attrs = [
      `name="${param.name}"`,
      `type="${param.type}"`,
      param.required ? 'required="true"' : 'required="false"'
    ];
    if (param.default !== void 0) {
      attrs.push(`default="${param.default}"`);
    }
    lines.push(`    <parameter ${attrs.join(" ")}>`);
    if (param.description) {
      lines.push(
        `      <description>${escapeXml(param.description)}</description>`
      );
    }
    if (param.enum) {
      lines.push(`      <enum>${param.enum.join(", ")}</enum>`);
    }
    lines.push(`    </parameter>`);
  }
  lines.push(`  </parameters>`);
  lines.push(`</tool>`);
  return lines.join("\n");
}
function formatTools(tools, options = {}) {
  const { style = "json-schema" } = options;
  if (style === "json-schema") {
    return JSON.stringify(
      tools.map((tool) => JSON.parse(formatToolJsonSchema(tool, true))),
      null,
      2
    );
  }
  return tools.map((tool) => formatTool(tool, options)).join("\n\n" + "=".repeat(50) + "\n\n");
}
function createTool(name, description, parameters) {
  return {
    name,
    description,
    parameters
  };
}
function createParameter(name, type, description, required = false) {
  return {
    name,
    type,
    description,
    required
  };
}
function validateTool(tool) {
  const errors = [];
  if (!tool.name || tool.name.trim().length === 0) {
    errors.push("Tool name is required");
  }
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(tool.name)) {
    errors.push("Tool name must be a valid identifier");
  }
  if (!tool.description || tool.description.trim().length === 0) {
    errors.push("Tool description is required");
  }
  if (!tool.parameters || !Array.isArray(tool.parameters)) {
    errors.push("Tool parameters must be an array");
  } else {
    for (let i = 0; i < tool.parameters.length; i++) {
      const param = tool.parameters[i];
      if (!param.name || param.name.trim().length === 0) {
        errors.push(`Parameter ${i} is missing a name`);
      }
      if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(param.name)) {
        errors.push(`Parameter ${param.name} must be a valid identifier`);
      }
      if (!param.type) {
        errors.push(`Parameter ${param.name} is missing a type`);
      }
      const validTypes = [
        "string",
        "number",
        "integer",
        "boolean",
        "array",
        "object"
      ];
      if (!validTypes.includes(param.type)) {
        errors.push(`Parameter ${param.name} has invalid type: ${param.type}`);
      }
    }
  }
  return errors;
}
function getExampleValue(type) {
  switch (type) {
    case "string":
      return '"example"';
    case "number":
    case "integer":
      return "42";
    case "boolean":
      return "true";
    case "array":
      return "[]";
    case "object":
      return "{}";
    default:
      return '""';
  }
}
function escapeXml(str) {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}
function formatFunctionArguments(args, pretty = false) {
  return JSON.stringify(args, null, pretty ? 2 : 0);
}
function parseFunctionCall(output) {
  const patterns = [
    // JSON format: {"name": "func", "arguments": {...}}
    /\{\s*"name"\s*:\s*"([^"]+)"\s*,\s*"arguments"\s*:\s*(\{[^}]*\})\s*\}/,
    // Function call format: func_name({...})
    /([a-zA-Z_][a-zA-Z0-9_]*)\s*\(\s*(\{[^}]*\})\s*\)/
  ];
  for (const pattern of patterns) {
    const match = output.match(pattern);
    if (match && match[1] && match[2]) {
      try {
        const name = match[1];
        const args = JSON.parse(match[2]);
        return { name, arguments: args };
      } catch {
        continue;
      }
    }
  }
  return null;
}

// src/format/utils.ts
function trim(str) {
  if (!str) return str;
  return str.trim();
}
function escape(str) {
  if (!str) return str;
  return str.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/'/g, "\\'").replace(/\n/g, "\\n").replace(/\r/g, "\\r").replace(/\t/g, "\\t");
}
function unescape(str) {
  if (!str) return str;
  const BACKSLASH_PLACEHOLDER = "\0BACKSLASH\0";
  return str.replace(/\\\\/g, BACKSLASH_PLACEHOLDER).replace(/\\t/g, "	").replace(/\\r/g, "\r").replace(/\\n/g, "\n").replace(/\\'/g, "'").replace(/\\"/g, '"').replace(new RegExp(BACKSLASH_PLACEHOLDER, "g"), "\\");
}
function escapeHtml(str) {
  if (!str) return str;
  const entities = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  };
  return str.replace(/[&<>"']/g, (char) => entities[char] || char);
}
function unescapeHtml(str) {
  if (!str) return str;
  const entities = {
    "&amp;": "&",
    "&lt;": "<",
    "&gt;": ">",
    "&quot;": '"',
    "&#39;": "'",
    "&#x27;": "'"
  };
  return str.replace(
    /&(?:amp|lt|gt|quot|#39|#x27);/g,
    (entity) => entities[entity] || entity
  );
}
function escapeRegex(str) {
  if (!str) return str;
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function sanitize(str) {
  if (!str) return str;
  return str.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "");
}
function truncate(str, maxLength, suffix = "...") {
  if (!str || str.length <= maxLength) {
    return str;
  }
  const truncateAt = maxLength - suffix.length;
  return str.slice(0, truncateAt) + suffix;
}
function truncateWords(str, maxLength, suffix = "...") {
  if (!str || str.length <= maxLength) {
    return str;
  }
  const truncateAt = maxLength - suffix.length;
  const truncated = str.slice(0, truncateAt);
  const lastSpace = truncated.lastIndexOf(" ");
  if (lastSpace > 0) {
    return truncated.slice(0, lastSpace) + suffix;
  }
  return truncated + suffix;
}
function wrap(str, width) {
  if (!str) return str;
  const words = str.split(/\s+/);
  const lines = [];
  let currentLine = "";
  for (const word of words) {
    if (currentLine.length + word.length + 1 <= width) {
      currentLine += (currentLine ? " " : "") + word;
    } else {
      if (currentLine) {
        lines.push(currentLine);
      }
      currentLine = word;
    }
  }
  if (currentLine) {
    lines.push(currentLine);
  }
  return lines.join("\n");
}
function pad(str, length, char = " ", align = "left") {
  if (!str) str = "";
  if (str.length >= length) return str;
  const padLength = length - str.length;
  switch (align) {
    case "right":
      return char.repeat(padLength) + str;
    case "center": {
      const leftPad = Math.floor(padLength / 2);
      const rightPad = padLength - leftPad;
      return char.repeat(leftPad) + str + char.repeat(rightPad);
    }
    case "left":
    default:
      return str + char.repeat(padLength);
  }
}
function removeAnsi(str) {
  if (!str) return str;
  return str.replace(
    /[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g,
    ""
  );
}

// src/utils/repair.ts
function repairJson(json) {
  if (!json || json.trim().length === 0) {
    return json;
  }
  let repaired = json.trim();
  repaired = balanceBraces(repaired);
  repaired = balanceBrackets(repaired);
  repaired = removeTrailingCommas(repaired);
  repaired = fixUnclosedStrings(repaired);
  return repaired;
}
function balanceBraces(json) {
  if (!json) return json;
  let openCount = 0;
  let closeCount = 0;
  let inString = false;
  let escapeNext = false;
  for (let i = 0; i < json.length; i++) {
    const char = json[i];
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
      if (char === "{") openCount++;
      if (char === "}") closeCount++;
    }
  }
  if (openCount > closeCount) {
    return json + "}".repeat(openCount - closeCount);
  }
  if (closeCount > openCount) {
    let result = json;
    let toRemove = closeCount - openCount;
    for (let i = result.length - 1; i >= 0 && toRemove > 0; i--) {
      if (result[i] === "}") {
        result = result.slice(0, i) + result.slice(i + 1);
        toRemove--;
      }
    }
    return result;
  }
  return json;
}
function balanceBrackets(json) {
  if (!json) return json;
  let openCount = 0;
  let closeCount = 0;
  let inString = false;
  let escapeNext = false;
  for (let i = 0; i < json.length; i++) {
    const char = json[i];
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
      if (char === "[") openCount++;
      if (char === "]") closeCount++;
    }
  }
  if (openCount > closeCount) {
    return json + "]".repeat(openCount - closeCount);
  }
  if (closeCount > openCount) {
    let result = json;
    let toRemove = closeCount - openCount;
    for (let i = result.length - 1; i >= 0 && toRemove > 0; i--) {
      if (result[i] === "]") {
        result = result.slice(0, i) + result.slice(i + 1);
        toRemove--;
      }
    }
    return result;
  }
  return json;
}
function removeTrailingCommas(json) {
  if (!json) return json;
  return json.replace(/,(\s*})/g, "$1").replace(/,(\s*])/g, "$1");
}
function fixUnclosedStrings(json) {
  if (!json) return json;
  let quoteCount = 0;
  let escapeNext = false;
  for (let i = 0; i < json.length; i++) {
    const char = json[i];
    if (escapeNext) {
      escapeNext = false;
      continue;
    }
    if (char === "\\") {
      escapeNext = true;
      continue;
    }
    if (char === '"') {
      quoteCount++;
    }
  }
  if (quoteCount % 2 !== 0) {
    return json + '"';
  }
  return json;
}
function repairMarkdownFences(markdown) {
  if (!markdown) return markdown;
  const fencePattern = /```/g;
  const matches = markdown.match(fencePattern);
  if (!matches) return markdown;
  if (matches.length % 2 !== 0) {
    return markdown + "\n```";
  }
  return markdown;
}
function repairLatexEnvironments(latex) {
  if (!latex) return latex;
  const beginPattern = /\\begin\{(\w+)\}/g;
  const endPattern = /\\end\{(\w+)\}/g;
  const begins = Array.from(latex.matchAll(beginPattern));
  const ends = Array.from(latex.matchAll(endPattern));
  const stack = [];
  for (const begin of begins) {
    stack.push(begin[1]);
  }
  for (const end of ends) {
    const env = end[1];
    const lastIndex = stack.lastIndexOf(env);
    if (lastIndex !== -1) {
      stack.splice(lastIndex, 1);
    }
  }
  let result = latex;
  for (const env of stack.reverse()) {
    result += `
\\end{${env}}`;
  }
  return result;
}
function repairToolCallArguments(args) {
  if (!args) return args;
  let repaired = args.trim();
  if (!repaired.startsWith("{") && !repaired.startsWith("[")) {
    repaired = "{" + repaired;
  }
  repaired = repairJson(repaired);
  return repaired;
}
function isValidJson(json) {
  if (!json || json.trim().length === 0) {
    return false;
  }
  try {
    JSON.parse(json);
    return true;
  } catch {
    return false;
  }
}
function parseOrRepairJson(json) {
  if (!json) return null;
  try {
    return JSON.parse(json);
  } catch {
    const repaired = repairJson(json);
    try {
      return JSON.parse(repaired);
    } catch {
      return null;
    }
  }
}
function extractJson(text) {
  if (!text) return null;
  const startBrace = text.indexOf("{");
  const startBracket = text.indexOf("[");
  let start = -1;
  if (startBrace !== -1 && startBracket !== -1) {
    start = Math.min(startBrace, startBracket);
  } else if (startBrace !== -1) {
    start = startBrace;
  } else if (startBracket !== -1) {
    start = startBracket;
  }
  if (start === -1) return null;
  const startChar = text[start];
  const endChar = startChar === "{" ? "}" : "]";
  let depth = 0;
  let inString = false;
  let escapeNext = false;
  for (let i = start; i < text.length; i++) {
    const char = text[i];
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
      if (char === startChar) depth++;
      if (char === endChar) {
        depth--;
        if (depth === 0) {
          return text.slice(start, i + 1);
        }
      }
    }
  }
  return repairJson(text.slice(start));
}
function wrapInJson(key, content) {
  return JSON.stringify({ [key]: content });
}
function ensureJson(content, wrapKey = "content") {
  if (!content) return "{}";
  if (isValidJson(content)) {
    return content;
  }
  const repaired = repairJson(content);
  if (isValidJson(repaired)) {
    return repaired;
  }
  return wrapInJson(wrapKey, content);
}

// src/adapters/helpers.ts
async function* toL0Events(stream, extractText) {
  try {
    for await (const chunk of stream) {
      const text = extractText(chunk);
      if (text != null) {
        yield {
          type: "token",
          value: text,
          timestamp: Date.now()
        };
      }
    }
    yield {
      type: "complete",
      timestamp: Date.now()
    };
  } catch (err) {
    yield {
      type: "error",
      error: err instanceof Error ? err : new Error(String(err)),
      timestamp: Date.now()
    };
  }
}
async function* toL0EventsWithMessages(stream, handlers) {
  try {
    for await (const chunk of stream) {
      const text = handlers.extractText(chunk);
      if (text != null) {
        yield {
          type: "token",
          value: text,
          timestamp: Date.now()
        };
        continue;
      }
      if (handlers.extractMessage) {
        const message = handlers.extractMessage(chunk);
        if (message != null) {
          yield {
            type: "message",
            value: message.value,
            role: message.role,
            timestamp: Date.now()
          };
        }
      }
    }
    yield {
      type: "complete",
      timestamp: Date.now()
    };
  } catch (err) {
    yield {
      type: "error",
      error: err instanceof Error ? err : new Error(String(err)),
      timestamp: Date.now()
    };
  }
}
function createAdapterTokenEvent(value) {
  return {
    type: "token",
    value,
    timestamp: Date.now()
  };
}
function createAdapterDoneEvent() {
  return {
    type: "complete",
    timestamp: Date.now()
  };
}
function createAdapterErrorEvent(err) {
  return {
    type: "error",
    error: err instanceof Error ? err : new Error(String(err)),
    timestamp: Date.now()
  };
}
function createAdapterMessageEvent(value, role) {
  return {
    type: "message",
    value,
    role,
    timestamp: Date.now()
  };
}
function createAdapterDataEvent(payload) {
  return {
    type: "data",
    data: payload,
    timestamp: Date.now()
  };
}
function createAdapterProgressEvent(progress) {
  return {
    type: "progress",
    progress,
    timestamp: Date.now()
  };
}
function createImageEvent(options) {
  const payload = {
    contentType: "image",
    mimeType: options.mimeType ?? "image/png",
    url: options.url,
    base64: options.base64,
    bytes: options.bytes,
    metadata: {
      width: options.width,
      height: options.height,
      seed: options.seed,
      model: options.model
    }
  };
  if (payload.metadata) {
    payload.metadata = Object.fromEntries(
      Object.entries(payload.metadata).filter(([_, v]) => v !== void 0)
    );
    if (Object.keys(payload.metadata).length === 0) {
      delete payload.metadata;
    }
  }
  return createAdapterDataEvent(payload);
}
function createAudioEvent(options) {
  const payload = {
    contentType: "audio",
    mimeType: options.mimeType ?? "audio/mp3",
    url: options.url,
    base64: options.base64,
    bytes: options.bytes,
    metadata: {
      duration: options.duration,
      model: options.model
    }
  };
  if (payload.metadata) {
    payload.metadata = Object.fromEntries(
      Object.entries(payload.metadata).filter(([_, v]) => v !== void 0)
    );
    if (Object.keys(payload.metadata).length === 0) {
      delete payload.metadata;
    }
  }
  return createAdapterDataEvent(payload);
}
function createJsonDataEvent(data, metadata) {
  return createAdapterDataEvent({
    contentType: "json",
    mimeType: "application/json",
    json: data,
    metadata
  });
}
async function* toMultimodalL0Events(stream, handlers) {
  try {
    for await (const chunk of stream) {
      if (handlers.extractText) {
        const text = handlers.extractText(chunk);
        if (text != null) {
          yield createAdapterTokenEvent(text);
          continue;
        }
      }
      if (handlers.extractData) {
        const data = handlers.extractData(chunk);
        if (data != null) {
          yield createAdapterDataEvent(data);
          continue;
        }
      }
      if (handlers.extractProgress) {
        const progress = handlers.extractProgress(chunk);
        if (progress != null) {
          yield createAdapterProgressEvent(progress);
          continue;
        }
      }
      if (handlers.extractMessage) {
        const message = handlers.extractMessage(chunk);
        if (message != null) {
          yield createAdapterMessageEvent(message.value, message.role);
          continue;
        }
      }
    }
    yield createAdapterDoneEvent();
  } catch (err) {
    yield createAdapterErrorEvent(err);
  }
}

// src/adapters/openai.ts
async function* wrapOpenAIStream(stream, options = {}) {
  const {
    includeUsage = true,
    includeToolCalls = true,
    emitFunctionCallsAsTokens = false,
    choiceIndex = 0
  } = options;
  let usage;
  const choiceState = /* @__PURE__ */ new Map();
  const getChoiceState = (index) => {
    if (!choiceState.has(index)) {
      choiceState.set(index, {
        functionCallAccumulator: null,
        toolCallsAccumulator: /* @__PURE__ */ new Map(),
        finished: false
      });
    }
    return choiceState.get(index);
  };
  try {
    for await (const chunk of stream) {
      const choices = chunk.choices;
      if (!choices || choices.length === 0) {
        continue;
      }
      if (chunk.usage) {
        usage = chunk.usage;
      }
      for (const choice of choices) {
        if (!choice) continue;
        const idx = choice.index;
        if (choiceIndex !== "all" && idx !== choiceIndex) {
          continue;
        }
        const state = getChoiceState(idx);
        const delta = choice.delta;
        if (!delta) continue;
        const choicePrefix = choiceIndex === "all" ? `[choice:${idx}]` : "";
        if (delta.content) {
          yield {
            type: "token",
            value: choicePrefix ? `${choicePrefix}${delta.content}` : delta.content,
            timestamp: Date.now()
          };
        }
        if (delta.function_call) {
          if (delta.function_call.name) {
            state.functionCallAccumulator = {
              name: delta.function_call.name,
              arguments: delta.function_call.arguments || ""
            };
          } else if (delta.function_call.arguments && state.functionCallAccumulator) {
            state.functionCallAccumulator.arguments += delta.function_call.arguments;
          }
          if (emitFunctionCallsAsTokens && delta.function_call.arguments) {
            yield {
              type: "token",
              value: delta.function_call.arguments,
              timestamp: Date.now()
            };
          }
        }
        if (delta.tool_calls) {
          for (const toolCall of delta.tool_calls) {
            const existing = state.toolCallsAccumulator.get(toolCall.index);
            if (toolCall.id || toolCall.function?.name) {
              state.toolCallsAccumulator.set(toolCall.index, {
                id: toolCall.id || existing?.id || "",
                name: toolCall.function?.name || existing?.name || "",
                arguments: toolCall.function?.arguments || ""
              });
            } else if (toolCall.function?.arguments && existing) {
              existing.arguments += toolCall.function.arguments;
            }
            if (emitFunctionCallsAsTokens && toolCall.function?.arguments) {
              yield {
                type: "token",
                value: toolCall.function.arguments,
                timestamp: Date.now()
              };
            }
          }
        }
        if (choice.finish_reason && !state.finished) {
          state.finished = true;
          if (state.functionCallAccumulator && includeToolCalls) {
            yield {
              type: "message",
              value: JSON.stringify({
                type: "function_call",
                function_call: state.functionCallAccumulator,
                ...choiceIndex === "all" ? { choiceIndex: idx } : {}
              }),
              role: "assistant",
              timestamp: Date.now()
            };
          }
          if (state.toolCallsAccumulator.size > 0 && includeToolCalls) {
            const toolCalls = Array.from(state.toolCallsAccumulator.values());
            yield {
              type: "message",
              value: JSON.stringify({
                type: "tool_calls",
                tool_calls: toolCalls,
                ...choiceIndex === "all" ? { choiceIndex: idx } : {}
              }),
              role: "assistant",
              timestamp: Date.now()
            };
          }
        }
      }
    }
    yield {
      type: "complete",
      timestamp: Date.now(),
      ...includeUsage && usage ? { usage } : {}
    };
  } catch (error) {
    yield {
      type: "error",
      error: error instanceof Error ? error : new Error(String(error)),
      timestamp: Date.now()
    };
  }
}
function openaiStream(client, params, options) {
  return async () => {
    const stream = await client.chat.completions.create({
      ...params,
      stream: true
    });
    return wrapOpenAIStream(stream, options);
  };
}
function openaiText(client, model, prompt, options) {
  const messages = typeof prompt === "string" ? [{ role: "user", content: prompt }] : prompt;
  const {
    includeUsage,
    includeToolCalls,
    emitFunctionCallsAsTokens,
    ...chatParams
  } = options || {};
  return openaiStream(
    client,
    { model, messages, ...chatParams },
    { includeUsage, includeToolCalls, emitFunctionCallsAsTokens }
  );
}
function openaiJSON(client, model, prompt, options) {
  const messages = typeof prompt === "string" ? [{ role: "user", content: prompt }] : prompt;
  const {
    includeUsage,
    includeToolCalls,
    emitFunctionCallsAsTokens,
    ...chatParams
  } = options || {};
  return openaiStream(
    client,
    {
      model,
      messages,
      response_format: { type: "json_object" },
      ...chatParams
    },
    { includeUsage, includeToolCalls, emitFunctionCallsAsTokens }
  );
}
function openaiWithTools(client, model, messages, tools, options) {
  const {
    includeUsage,
    includeToolCalls,
    emitFunctionCallsAsTokens,
    ...chatParams
  } = options || {};
  return openaiStream(
    client,
    { model, messages, tools, ...chatParams },
    {
      includeUsage,
      includeToolCalls: includeToolCalls ?? true,
      emitFunctionCallsAsTokens
    }
  );
}
function isOpenAIChunk(obj) {
  if (!obj || typeof obj !== "object" || !("choices" in obj)) {
    return false;
  }
  const chunk = obj;
  if (!Array.isArray(chunk.choices) || chunk.choices.length === 0) {
    return false;
  }
  const firstChoice = chunk.choices[0];
  return firstChoice !== void 0 && "delta" in firstChoice;
}
async function extractOpenAIText(stream) {
  let text = "";
  for await (const chunk of stream) {
    const content = chunk.choices?.[0]?.delta?.content;
    if (content) {
      text += content;
    }
  }
  return text;
}
function isOpenAIStream(input) {
  if (!input || typeof input !== "object") return false;
  if (!(Symbol.asyncIterator in input)) return false;
  const stream = input;
  if (typeof stream.toReadableStream === "function" && "controller" in stream) {
    return true;
  }
  if ("response" in stream && typeof stream.toReadableStream === "function") {
    return true;
  }
  return false;
}
var openaiAdapter = {
  name: "openai",
  detect: isOpenAIStream,
  wrap: wrapOpenAIStream
};

// src/adapters/anthropic.ts
function isAnthropicStreamEvent(event) {
  if (!event || typeof event !== "object") return false;
  const e = event;
  if (typeof e.type !== "string") return false;
  return [
    "message_start",
    "content_block_start",
    "content_block_delta",
    "content_block_stop",
    "message_delta",
    "message_stop"
  ].includes(e.type);
}
function isAnthropicStream(input) {
  if (!input || typeof input !== "object") return false;
  if (!(Symbol.asyncIterator in input)) return false;
  const stream = input;
  if (typeof stream.on === "function" && typeof stream.finalMessage === "function") {
    return true;
  }
  if ("controller" in stream && "body" in stream) {
    return true;
  }
  return false;
}
async function* wrapAnthropicStream(stream, options = {}) {
  const { includeUsage = true, includeToolUse = true } = options;
  let usage = {};
  let emittedDone = false;
  const toolUseAccumulator = /* @__PURE__ */ new Map();
  try {
    for await (const event of stream) {
      const eventType = event.type;
      switch (eventType) {
        case "message_start": {
          const e = event;
          if (e.message?.usage) {
            usage.input_tokens = e.message.usage.input_tokens;
            usage.output_tokens = e.message.usage.output_tokens;
          }
          break;
        }
        case "content_block_start": {
          const e = event;
          if (e.content_block?.type === "tool_use" && includeToolUse) {
            toolUseAccumulator.set(e.index, {
              id: e.content_block.id || "",
              name: e.content_block.name || "",
              input: ""
            });
          }
          break;
        }
        case "content_block_delta": {
          const e = event;
          if (e.delta?.type === "text_delta" && e.delta.text != null) {
            yield {
              type: "token",
              value: e.delta.text,
              timestamp: Date.now()
            };
          } else if (e.delta?.type === "input_json_delta" && e.delta.partial_json != null) {
            const toolUse = toolUseAccumulator.get(e.index);
            if (toolUse) {
              toolUse.input += e.delta.partial_json;
            }
          }
          break;
        }
        case "content_block_stop": {
          const e = event;
          if (includeToolUse) {
            const toolUse = toolUseAccumulator.get(e.index);
            if (toolUse) {
              yield {
                type: "message",
                value: JSON.stringify({
                  type: "tool_use",
                  tool_use: {
                    id: toolUse.id,
                    name: toolUse.name,
                    input: toolUse.input
                  }
                }),
                role: "assistant",
                timestamp: Date.now()
              };
              toolUseAccumulator.delete(e.index);
            }
          }
          break;
        }
        case "message_delta": {
          const e = event;
          if (e.usage?.output_tokens != null) {
            usage.output_tokens = e.usage.output_tokens;
          }
          break;
        }
        case "message_stop": {
          if (!emittedDone) {
            emittedDone = true;
            yield {
              type: "complete",
              timestamp: Date.now(),
              ...includeUsage && (usage.input_tokens || usage.output_tokens) ? { usage } : {}
            };
          }
          break;
        }
      }
    }
    if (!emittedDone) {
      emittedDone = true;
      yield {
        type: "complete",
        timestamp: Date.now(),
        ...includeUsage && (usage.input_tokens || usage.output_tokens) ? { usage } : {}
      };
    }
  } catch (err) {
    yield {
      type: "error",
      error: err instanceof Error ? err : new Error(String(err)),
      timestamp: Date.now()
    };
  }
}
var anthropicAdapter = {
  name: "anthropic",
  detect: isAnthropicStream,
  wrap: wrapAnthropicStream
};
function anthropicStream(client, params, options) {
  return async () => {
    const stream = client.messages.stream(params);
    return wrapAnthropicStream(stream, options);
  };
}
function anthropicText(client, model, prompt, options) {
  const {
    maxTokens = 1024,
    system,
    includeUsage,
    includeToolUse
  } = options || {};
  return anthropicStream(
    client,
    {
      model,
      max_tokens: maxTokens,
      messages: [{ role: "user", content: prompt }],
      ...system ? { system } : {}
    },
    { includeUsage, includeToolUse }
  );
}

// src/adapters/mastra.ts
async function* wrapMastraStream(streamResult, options = {}) {
  const {
    includeUsage = true,
    includeToolCalls = true,
    includeReasoning = false
  } = options;
  try {
    const textStream = streamResult.textStream;
    const reader = textStream.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      if (value) {
        yield {
          type: "token",
          value,
          timestamp: Date.now()
        };
      }
    }
    if (includeReasoning) {
      try {
        const reasoningText = await streamResult.reasoningText;
        if (reasoningText) {
          yield {
            type: "message",
            value: JSON.stringify({
              type: "reasoning",
              reasoning: reasoningText
            }),
            role: "assistant",
            timestamp: Date.now()
          };
        }
      } catch {
      }
    }
    if (includeToolCalls) {
      try {
        const toolCalls = await streamResult.toolCalls;
        if (toolCalls && toolCalls.length > 0) {
          yield {
            type: "message",
            value: JSON.stringify({
              type: "tool_calls",
              tool_calls: toolCalls.map((tc) => ({
                id: tc.payload?.toolCallId ?? tc.toolCallId,
                name: tc.payload?.toolName ?? tc.toolName,
                arguments: JSON.stringify(tc.payload?.args ?? tc.args)
              }))
            }),
            role: "assistant",
            timestamp: Date.now()
          };
        }
      } catch {
      }
      try {
        const toolResults = await streamResult.toolResults;
        if (toolResults && toolResults.length > 0) {
          yield {
            type: "message",
            value: JSON.stringify({
              type: "tool_results",
              tool_results: toolResults.map((tr) => ({
                id: tr.payload?.toolCallId ?? tr.toolCallId,
                name: tr.payload?.toolName ?? tr.toolName,
                result: tr.payload?.result ?? tr.result
              }))
            }),
            role: "assistant",
            timestamp: Date.now()
          };
        }
      } catch {
      }
    }
    let usage;
    let finishReason;
    if (includeUsage) {
      try {
        usage = await streamResult.usage;
      } catch {
      }
    }
    try {
      finishReason = await streamResult.finishReason;
    } catch {
    }
    yield {
      type: "complete",
      timestamp: Date.now(),
      ...includeUsage && usage ? { usage } : {},
      ...finishReason ? { finishReason } : {}
    };
  } catch (error) {
    yield {
      type: "error",
      error: error instanceof Error ? error : new Error(String(error)),
      timestamp: Date.now()
    };
  }
}
function mastraStream(agent, messages, streamOptions, adapterOptions) {
  return async () => {
    const streamResult = await agent.stream(messages, streamOptions);
    return wrapMastraStream(
      streamResult,
      adapterOptions
    );
  };
}
function mastraText(agent, prompt, options) {
  const { includeUsage, includeToolCalls, includeReasoning, ...streamOptions } = options || {};
  return mastraStream(agent, prompt, streamOptions, {
    includeUsage,
    includeToolCalls,
    includeReasoning
  });
}
function mastraStructured(agent, prompt, schema, options) {
  const { includeUsage, includeToolCalls, includeReasoning, ...streamOptions } = options || {};
  return mastraStream(
    agent,
    prompt,
    {
      ...streamOptions,
      structuredOutput: { schema }
    },
    { includeUsage, includeToolCalls, includeReasoning }
  );
}
async function* wrapMastraFullStream(streamResult, options = {}) {
  const {
    includeUsage = true,
    includeToolCalls = true,
    includeReasoning = false
  } = options;
  try {
    const fullStream = streamResult.fullStream;
    const reader = fullStream.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      if (!value) continue;
      const chunk = value;
      switch (chunk.type) {
        case "text-delta":
          yield {
            type: "token",
            value: chunk.payload?.text ?? chunk.textDelta,
            timestamp: Date.now()
          };
          break;
        case "reasoning":
          if (includeReasoning) {
            yield {
              type: "message",
              value: JSON.stringify({
                type: "reasoning",
                reasoning: chunk.payload?.text ?? chunk.textDelta
              }),
              role: "assistant",
              timestamp: Date.now()
            };
          }
          break;
        case "tool-call":
          if (includeToolCalls) {
            const payload = chunk.payload ?? chunk;
            yield {
              type: "message",
              value: JSON.stringify({
                type: "tool_call",
                tool_call: {
                  id: payload.toolCallId,
                  name: payload.toolName,
                  arguments: JSON.stringify(payload.args)
                }
              }),
              role: "assistant",
              timestamp: Date.now()
            };
          }
          break;
        case "tool-result":
          if (includeToolCalls) {
            const payload = chunk.payload ?? chunk;
            yield {
              type: "message",
              value: JSON.stringify({
                type: "tool_result",
                tool_result: {
                  id: payload.toolCallId,
                  name: payload.toolName,
                  result: payload.result
                }
              }),
              role: "assistant",
              timestamp: Date.now()
            };
          }
          break;
        case "finish":
          let usage;
          if (includeUsage) {
            try {
              usage = await streamResult.usage;
            } catch {
            }
          }
          yield {
            type: "complete",
            timestamp: Date.now(),
            ...includeUsage && usage ? { usage } : {},
            ...chunk.finishReason ? { finishReason: chunk.finishReason } : {}
          };
          break;
        case "error":
          yield {
            type: "error",
            error: chunk.error instanceof Error ? chunk.error : new Error(String(chunk.error)),
            timestamp: Date.now()
          };
          break;
      }
    }
  } catch (error) {
    yield {
      type: "error",
      error: error instanceof Error ? error : new Error(String(error)),
      timestamp: Date.now()
    };
  }
}
function isMastraStream(obj) {
  if (!obj || typeof obj !== "object") {
    return false;
  }
  const stream = obj;
  return "textStream" in stream && "text" in stream && "usage" in stream && "finishReason" in stream && typeof stream.textStream === "object" && stream.textStream !== null && "getReader" in stream.textStream;
}
async function extractMastraText(streamResult) {
  return streamResult.text;
}
async function extractMastraObject(streamResult) {
  return streamResult.object;
}
var mastraAdapter = {
  name: "mastra",
  detect: isMastraStream,
  wrap: wrapMastraStream
};

// src/types/events.ts
function serializeError(error) {
  return {
    name: error.name,
    message: error.message,
    stack: error.stack,
    code: error.code,
    metadata: error.metadata
  };
}
function deserializeError(stored) {
  const error = new Error(stored.message);
  error.name = stored.name;
  error.stack = stored.stack;
  error.code = stored.code;
  error.metadata = stored.metadata;
  return error;
}
function generateStreamId() {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 10);
  return `l0_${timestamp}_${random}`;
}

// src/runtime/eventStore.ts
var InMemoryEventStore = class {
  streams = /* @__PURE__ */ new Map();
  snapshots = /* @__PURE__ */ new Map();
  async append(streamId, event) {
    let events = this.streams.get(streamId);
    if (!events) {
      events = [];
      this.streams.set(streamId, events);
    }
    const envelope = {
      streamId,
      seq: events.length,
      event
    };
    events.push(envelope);
  }
  async getEvents(streamId) {
    return this.streams.get(streamId) ?? [];
  }
  async exists(streamId) {
    return this.streams.has(streamId);
  }
  async getLastEvent(streamId) {
    const events = this.streams.get(streamId);
    if (!events || events.length === 0) {
      return null;
    }
    return events[events.length - 1];
  }
  async getEventsAfter(streamId, afterSeq) {
    const events = this.streams.get(streamId);
    if (!events) {
      return [];
    }
    return events.filter((e) => e.seq > afterSeq);
  }
  async delete(streamId) {
    this.streams.delete(streamId);
    this.snapshots.delete(streamId);
  }
  async listStreams() {
    return Array.from(this.streams.keys());
  }
  async saveSnapshot(snapshot) {
    let snapshots = this.snapshots.get(snapshot.streamId);
    if (!snapshots) {
      snapshots = [];
      this.snapshots.set(snapshot.streamId, snapshots);
    }
    snapshots.push(snapshot);
  }
  async getSnapshot(streamId) {
    const snapshots = this.snapshots.get(streamId);
    if (!snapshots || snapshots.length === 0) {
      return null;
    }
    return snapshots[snapshots.length - 1];
  }
  async getSnapshotBefore(streamId, seq) {
    const snapshots = this.snapshots.get(streamId);
    if (!snapshots || snapshots.length === 0) {
      return null;
    }
    let best = null;
    for (const snapshot of snapshots) {
      if (snapshot.seq <= seq) {
        if (!best || snapshot.seq > best.seq) {
          best = snapshot;
        }
      }
    }
    return best;
  }
  /**
   * Clear all data (useful for testing)
   */
  clear() {
    this.streams.clear();
    this.snapshots.clear();
  }
  /**
   * Get total event count across all streams
   */
  getTotalEventCount() {
    let count = 0;
    for (const events of this.streams.values()) {
      count += events.length;
    }
    return count;
  }
  /**
   * Get stream count
   */
  getStreamCount() {
    return this.streams.size;
  }
};
var L0EventRecorder = class {
  streamId;
  eventStore;
  seq = 0;
  constructor(eventStore, streamId) {
    this.eventStore = eventStore;
    this.streamId = streamId ?? generateStreamId();
  }
  getStreamId() {
    return this.streamId;
  }
  getSeq() {
    return this.seq;
  }
  async record(event) {
    await this.eventStore.append(this.streamId, event);
    this.seq++;
  }
  async recordStart(options) {
    await this.record({
      type: "START",
      ts: Date.now(),
      options
    });
  }
  async recordToken(value, index) {
    await this.record({
      type: "TOKEN",
      ts: Date.now(),
      value,
      index
    });
  }
  async recordCheckpoint(at, content) {
    await this.record({
      type: "CHECKPOINT",
      ts: Date.now(),
      at,
      content
    });
  }
  async recordGuardrail(at, result) {
    await this.record({
      type: "GUARDRAIL",
      ts: Date.now(),
      at,
      result
    });
  }
  async recordDrift(at, result) {
    await this.record({
      type: "DRIFT",
      ts: Date.now(),
      at,
      result
    });
  }
  async recordRetry(reason, attempt, countsTowardLimit) {
    await this.record({
      type: "RETRY",
      ts: Date.now(),
      reason,
      attempt,
      countsTowardLimit
    });
  }
  async recordFallback(to) {
    await this.record({
      type: "FALLBACK",
      ts: Date.now(),
      to
    });
  }
  async recordContinuation(checkpoint, at) {
    await this.record({
      type: "CONTINUATION",
      ts: Date.now(),
      checkpoint,
      at
    });
  }
  async recordComplete(content, tokenCount) {
    await this.record({
      type: "COMPLETE",
      ts: Date.now(),
      content,
      tokenCount
    });
  }
  async recordError(error, recoverable) {
    await this.record({
      type: "ERROR",
      ts: Date.now(),
      error,
      recoverable
    });
  }
};
var L0EventReplayer = class {
  eventStore;
  constructor(eventStore) {
    this.eventStore = eventStore;
  }
  /**
   * Replay all events for a stream
   */
  async *replay(streamId, options = {}) {
    const { speed = 0, fromSeq = 0, toSeq = Infinity } = options;
    const events = await this.eventStore.getEvents(streamId);
    let lastTs = null;
    for (const envelope of events) {
      if (envelope.seq < fromSeq) continue;
      if (envelope.seq > toSeq) break;
      if (speed > 0 && lastTs !== null) {
        const delay = (envelope.event.ts - lastTs) / speed;
        if (delay > 0) {
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }
      lastTs = envelope.event.ts;
      yield envelope;
    }
  }
  /**
   * Replay and reconstruct final state
   */
  async replayToState(streamId) {
    const state = {
      content: "",
      tokenCount: 0,
      checkpoint: "",
      violations: [],
      driftDetected: false,
      retryAttempts: 0,
      networkRetryCount: 0,
      fallbackIndex: 0,
      completed: false,
      error: null,
      startTs: 0,
      endTs: 0
    };
    const events = await this.eventStore.getEvents(streamId);
    for (const envelope of events) {
      const event = envelope.event;
      switch (event.type) {
        case "START":
          state.startTs = event.ts;
          break;
        case "TOKEN":
          state.content += event.value;
          state.tokenCount = event.index + 1;
          break;
        case "CHECKPOINT":
          state.checkpoint = event.content;
          break;
        case "GUARDRAIL":
          state.violations.push(...event.result.violations);
          break;
        case "DRIFT":
          if (event.result.detected) {
            state.driftDetected = true;
          }
          break;
        case "RETRY":
          if (event.countsTowardLimit) {
            state.retryAttempts++;
          } else {
            state.networkRetryCount++;
          }
          break;
        case "FALLBACK":
          state.fallbackIndex = event.to;
          break;
        case "CONTINUATION":
          state.content = event.checkpoint;
          break;
        case "COMPLETE":
          state.completed = true;
          state.content = event.content;
          state.tokenCount = event.tokenCount;
          state.endTs = event.ts;
          break;
        case "ERROR":
          state.error = event.error;
          state.endTs = event.ts;
          break;
      }
    }
    return state;
  }
  /**
   * Get stream as token async iterable (for replay mode)
   */
  async *replayTokens(streamId, options = {}) {
    for await (const envelope of this.replay(streamId, options)) {
      if (envelope.event.type === "TOKEN") {
        yield envelope.event.value;
      }
    }
  }
};
function createInMemoryEventStore() {
  return new InMemoryEventStore();
}
function createEventRecorder(eventStore, streamId) {
  return new L0EventRecorder(eventStore, streamId);
}
function createEventReplayer(eventStore) {
  return new L0EventReplayer(eventStore);
}

// src/runtime/replay.ts
async function replay(options) {
  const {
    streamId,
    eventStore,
    speed = 0,
    fireCallbacks = true,
    fromSeq = 0,
    toSeq = Infinity
  } = options;
  const exists = await eventStore.exists(streamId);
  if (!exists) {
    throw new Error(`Stream not found: ${streamId}`);
  }
  const envelopes = await eventStore.getEvents(streamId);
  if (envelopes.length === 0) {
    throw new Error(`Stream has no events: ${streamId}`);
  }
  const startEvent = envelopes.find((e) => e.event.type === "START");
  const originalOptions = startEvent ? startEvent.event.options : {};
  const state = createInitialState2();
  const errors = [];
  const abortController = new AbortController();
  const monitor = new L0Monitor({
    enabled: true,
    includeTimings: true
  });
  monitor.start();
  let onToken;
  let onViolation;
  let onRetry;
  let onEvent;
  const streamGenerator = async function* () {
    let lastTs = null;
    for (const envelope of envelopes) {
      if (envelope.seq < fromSeq) continue;
      if (envelope.seq > toSeq) break;
      if (abortController.signal.aborted) {
        break;
      }
      const event = envelope.event;
      if (speed > 0 && lastTs !== null) {
        const delay = (event.ts - lastTs) / speed;
        if (delay > 0) {
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }
      lastTs = event.ts;
      switch (event.type) {
        case "START":
          break;
        case "TOKEN": {
          state.content += event.value;
          state.tokenCount = event.index + 1;
          monitor.recordToken(event.ts);
          const tokenEvent = {
            type: "token",
            value: event.value,
            timestamp: event.ts
          };
          if (fireCallbacks) {
            if (onToken) onToken(event.value);
            if (onEvent) onEvent(tokenEvent);
          }
          yield tokenEvent;
          break;
        }
        case "CHECKPOINT":
          state.checkpoint = event.content;
          break;
        case "GUARDRAIL": {
          state.violations.push(...event.result.violations);
          monitor.recordGuardrailViolations(event.result.violations);
          if (fireCallbacks && onViolation) {
            for (const violation of event.result.violations) {
              onViolation(violation);
            }
          }
          break;
        }
        case "DRIFT":
          if (event.result.detected) {
            state.driftDetected = true;
            monitor.recordDrift(true, event.result.types);
          }
          break;
        case "RETRY": {
          if (event.countsTowardLimit) {
            state.modelRetryCount++;
          } else {
            state.networkRetryCount++;
          }
          monitor.recordRetry(!event.countsTowardLimit);
          if (fireCallbacks && onRetry) {
            onRetry(event.attempt, event.reason);
          }
          break;
        }
        case "FALLBACK":
          state.fallbackIndex = event.to;
          break;
        case "CONTINUATION":
          state.resumed = true;
          state.resumePoint = event.checkpoint;
          monitor.recordContinuation(true, true, event.checkpoint);
          break;
        case "COMPLETE": {
          state.completed = true;
          state.content = event.content;
          state.tokenCount = event.tokenCount;
          monitor.complete();
          const completeEvent = {
            type: "complete",
            timestamp: event.ts
          };
          if (fireCallbacks && onEvent) {
            onEvent(completeEvent);
          }
          yield completeEvent;
          break;
        }
        case "ERROR": {
          const error = deserializeError(event.error);
          errors.push(error);
          const errorEvent = {
            type: "error",
            error,
            timestamp: event.ts
          };
          if (fireCallbacks && onEvent) {
            onEvent(errorEvent);
          }
          yield errorEvent;
          break;
        }
      }
    }
  };
  const result = {
    stream: streamGenerator(),
    state,
    errors,
    telemetry: monitor.export(),
    abort: () => abortController.abort(),
    streamId,
    isReplay: true,
    originalOptions,
    // Allow setting callbacks before iteration
    setCallbacks(callbacks) {
      onToken = callbacks.onToken;
      onViolation = callbacks.onViolation;
      onRetry = callbacks.onRetry;
      onEvent = callbacks.onEvent;
    }
  };
  return result;
}
function createInitialState2() {
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
function compareReplays(a, b) {
  const differences = [];
  if (a.content !== b.content) {
    differences.push(
      `content: "${a.content.slice(0, 50)}..." vs "${b.content.slice(0, 50)}..."`
    );
  }
  if (a.tokenCount !== b.tokenCount) {
    differences.push(`tokenCount: ${a.tokenCount} vs ${b.tokenCount}`);
  }
  if (a.completed !== b.completed) {
    differences.push(`completed: ${a.completed} vs ${b.completed}`);
  }
  if (a.modelRetryCount !== b.modelRetryCount) {
    differences.push(
      `modelRetryCount: ${a.modelRetryCount} vs ${b.modelRetryCount}`
    );
  }
  if (a.fallbackIndex !== b.fallbackIndex) {
    differences.push(`fallbackIndex: ${a.fallbackIndex} vs ${b.fallbackIndex}`);
  }
  if (a.violations.length !== b.violations.length) {
    differences.push(
      `violations: ${a.violations.length} vs ${b.violations.length}`
    );
  }
  if (a.driftDetected !== b.driftDetected) {
    differences.push(`driftDetected: ${a.driftDetected} vs ${b.driftDetected}`);
  }
  return {
    identical: differences.length === 0,
    differences
  };
}
async function getStreamMetadata(eventStore, streamId) {
  const exists = await eventStore.exists(streamId);
  if (!exists) return null;
  const events = await eventStore.getEvents(streamId);
  if (events.length === 0) return null;
  const startEvent = events.find((e) => e.event.type === "START");
  const completeEvent = events.find((e) => e.event.type === "COMPLETE");
  const errorEvent = events.find((e) => e.event.type === "ERROR");
  const tokenEvents = events.filter((e) => e.event.type === "TOKEN");
  return {
    streamId,
    eventCount: events.length,
    tokenCount: tokenEvents.length,
    startTs: startEvent?.event.ts ?? events[0].event.ts,
    endTs: (completeEvent ?? errorEvent ?? events[events.length - 1]).event.ts,
    completed: !!completeEvent,
    hasError: !!errorEvent,
    options: startEvent ? startEvent.event.options : {}
  };
}

// src/runtime/storageAdapters.ts
var adapterRegistry = /* @__PURE__ */ new Map();
function registerStorageAdapter(type, factory) {
  adapterRegistry.set(type, factory);
}
function unregisterStorageAdapter(type) {
  return adapterRegistry.delete(type);
}
function getRegisteredAdapters() {
  return Array.from(adapterRegistry.keys());
}
async function createEventStore(config) {
  const factory = adapterRegistry.get(config.type);
  if (!factory) {
    const available = getRegisteredAdapters().join(", ") || "none";
    throw new Error(
      `Unknown storage adapter type: "${config.type}". Available adapters: ${available}`
    );
  }
  return factory(config);
}
registerStorageAdapter("memory", () => new InMemoryEventStore());
var BaseEventStore = class {
  prefix;
  ttl;
  constructor(config = { type: "base" }) {
    this.prefix = config.prefix ?? "l0";
    this.ttl = config.ttl ?? 0;
  }
  /**
   * Get the storage key for a stream
   */
  getStreamKey(streamId) {
    return `${this.prefix}:stream:${streamId}`;
  }
  /**
   * Get the storage key for stream metadata
   */
  getMetaKey(streamId) {
    return `${this.prefix}:meta:${streamId}`;
  }
  /**
   * Check if an event has expired based on TTL
   */
  isExpired(timestamp) {
    if (this.ttl === 0) return false;
    return Date.now() - timestamp > this.ttl;
  }
  // Default implementations that can be overridden for optimization
  async getLastEvent(streamId) {
    const events = await this.getEvents(streamId);
    return events.length > 0 ? events[events.length - 1] : null;
  }
  async getEventsAfter(streamId, afterSeq) {
    const events = await this.getEvents(streamId);
    return events.filter((e) => e.seq > afterSeq);
  }
};
var BaseEventStoreWithSnapshots = class extends BaseEventStore {
  /**
   * Get the storage key for snapshots
   */
  getSnapshotKey(streamId) {
    return `${this.prefix}:snapshot:${streamId}`;
  }
  // Default implementation
  async getSnapshotBefore(streamId, seq) {
    const snapshot = await this.getSnapshot(streamId);
    if (snapshot && snapshot.seq <= seq) {
      return snapshot;
    }
    return null;
  }
};
var FileEventStore = class _FileEventStore extends BaseEventStoreWithSnapshots {
  basePath;
  fs = null;
  path = null;
  constructor(config) {
    super(config);
    this.basePath = config.basePath ?? config.connection ?? "./l0-events";
  }
  async ensureFs() {
    if (!this.fs) {
      this.fs = await import("fs/promises");
      this.path = await import("path");
      await this.fs.mkdir(this.basePath, { recursive: true });
    }
  }
  /**
   * Validate stream ID to prevent path traversal attacks.
   * Only allows alphanumeric characters, hyphens, and underscores.
   * @internal Exposed as static for testing
   * @throws Error if stream ID contains invalid characters
   */
  static validateStreamId(streamId) {
    if (!streamId || streamId.length === 0) {
      throw new Error("Invalid stream ID: must not be empty");
    }
    if (!/^[a-zA-Z0-9_-]+$/.test(streamId)) {
      throw new Error(
        "Invalid stream ID: only alphanumeric characters, hyphens, and underscores are allowed"
      );
    }
    return streamId;
  }
  getFilePath(streamId) {
    const safeId = _FileEventStore.validateStreamId(streamId);
    return this.path.join(this.basePath, `${safeId}.json`);
  }
  getSnapshotFilePath(streamId) {
    const safeId = _FileEventStore.validateStreamId(streamId);
    return this.path.join(this.basePath, `${safeId}.snapshot.json`);
  }
  async append(streamId, event) {
    await this.ensureFs();
    const filePath = this.getFilePath(streamId);
    let events = [];
    try {
      const content = await this.fs.readFile(filePath, "utf-8");
      events = JSON.parse(content);
    } catch {
    }
    const envelope = {
      streamId,
      seq: events.length,
      event
    };
    events.push(envelope);
    await this.fs.writeFile(filePath, JSON.stringify(events, null, 2));
  }
  async getEvents(streamId) {
    await this.ensureFs();
    const filePath = this.getFilePath(streamId);
    try {
      const content = await this.fs.readFile(filePath, "utf-8");
      const events = JSON.parse(content);
      if (this.ttl > 0) {
        return events.filter((e) => !this.isExpired(e.event.ts));
      }
      return events;
    } catch {
      return [];
    }
  }
  async exists(streamId) {
    await this.ensureFs();
    const filePath = this.getFilePath(streamId);
    try {
      await this.fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }
  async delete(streamId) {
    await this.ensureFs();
    const filePath = this.getFilePath(streamId);
    const snapshotPath = this.getSnapshotFilePath(streamId);
    try {
      await this.fs.unlink(filePath);
    } catch {
    }
    try {
      await this.fs.unlink(snapshotPath);
    } catch {
    }
  }
  async listStreams() {
    await this.ensureFs();
    try {
      const files = await this.fs.readdir(this.basePath);
      return files.filter((f) => f.endsWith(".json") && !f.endsWith(".snapshot.json")).map((f) => f.replace(".json", ""));
    } catch {
      return [];
    }
  }
  async saveSnapshot(snapshot) {
    await this.ensureFs();
    const filePath = this.getSnapshotFilePath(snapshot.streamId);
    await this.fs.writeFile(filePath, JSON.stringify(snapshot, null, 2));
  }
  async getSnapshot(streamId) {
    await this.ensureFs();
    const filePath = this.getSnapshotFilePath(streamId);
    try {
      const content = await this.fs.readFile(filePath, "utf-8");
      return JSON.parse(content);
    } catch {
      return null;
    }
  }
};
registerStorageAdapter(
  "file",
  (config) => new FileEventStore(config)
);
var LocalStorageEventStore = class extends BaseEventStoreWithSnapshots {
  storage;
  constructor(config = { type: "localStorage" }) {
    super(config);
    const globalObj = typeof globalThis !== "undefined" ? globalThis : {};
    const ls = globalObj.localStorage;
    if (!ls) {
      throw new Error("LocalStorage is not available in this environment");
    }
    this.storage = ls;
  }
  async append(streamId, event) {
    const key = this.getStreamKey(streamId);
    const existing = this.storage.getItem(key);
    const events = existing ? JSON.parse(existing) : [];
    const envelope = {
      streamId,
      seq: events.length,
      event
    };
    events.push(envelope);
    this.storage.setItem(key, JSON.stringify(events));
    this.addToStreamList(streamId);
  }
  async getEvents(streamId) {
    const key = this.getStreamKey(streamId);
    const content = this.storage.getItem(key);
    if (!content) return [];
    const events = JSON.parse(content);
    if (this.ttl > 0) {
      return events.filter((e) => !this.isExpired(e.event.ts));
    }
    return events;
  }
  async exists(streamId) {
    const key = this.getStreamKey(streamId);
    return this.storage.getItem(key) !== null;
  }
  async delete(streamId) {
    this.storage.removeItem(this.getStreamKey(streamId));
    this.storage.removeItem(this.getSnapshotKey(streamId));
    this.removeFromStreamList(streamId);
  }
  async listStreams() {
    const listKey = `${this.prefix}:streams`;
    const content = this.storage.getItem(listKey);
    return content ? JSON.parse(content) : [];
  }
  async saveSnapshot(snapshot) {
    const key = this.getSnapshotKey(snapshot.streamId);
    this.storage.setItem(key, JSON.stringify(snapshot));
  }
  async getSnapshot(streamId) {
    const key = this.getSnapshotKey(streamId);
    const content = this.storage.getItem(key);
    return content ? JSON.parse(content) : null;
  }
  addToStreamList(streamId) {
    const listKey = `${this.prefix}:streams`;
    const existing = this.storage.getItem(listKey);
    const streams = existing ? JSON.parse(existing) : [];
    if (!streams.includes(streamId)) {
      streams.push(streamId);
      this.storage.setItem(listKey, JSON.stringify(streams));
    }
  }
  removeFromStreamList(streamId) {
    const listKey = `${this.prefix}:streams`;
    const existing = this.storage.getItem(listKey);
    if (!existing) return;
    const streams = JSON.parse(existing);
    const filtered = streams.filter((s) => s !== streamId);
    this.storage.setItem(listKey, JSON.stringify(filtered));
  }
};
registerStorageAdapter("localStorage", (config) => {
  return new LocalStorageEventStore(config);
});
var CompositeEventStore = class {
  stores;
  primaryIndex;
  /**
   * @param stores - Array of event stores to write to
   * @param primaryIndex - Index of the primary store for reads (default: 0)
   */
  constructor(stores, primaryIndex = 0) {
    if (stores.length === 0) {
      throw new Error("CompositeEventStore requires at least one store");
    }
    this.stores = stores;
    this.primaryIndex = primaryIndex;
  }
  get primary() {
    return this.stores[this.primaryIndex];
  }
  async append(streamId, event) {
    await Promise.all(
      this.stores.map((store) => store.append(streamId, event))
    );
  }
  async getEvents(streamId) {
    return this.primary.getEvents(streamId);
  }
  async exists(streamId) {
    return this.primary.exists(streamId);
  }
  async getLastEvent(streamId) {
    return this.primary.getLastEvent(streamId);
  }
  async getEventsAfter(streamId, afterSeq) {
    return this.primary.getEventsAfter(streamId, afterSeq);
  }
  async delete(streamId) {
    await Promise.all(this.stores.map((store) => store.delete(streamId)));
  }
  async listStreams() {
    return this.primary.listStreams();
  }
};
function createCompositeStore(stores, primaryIndex) {
  return new CompositeEventStore(stores, primaryIndex);
}
var TTLEventStore = class {
  store;
  ttl;
  constructor(store, ttlMs) {
    this.store = store;
    this.ttl = ttlMs;
  }
  isExpired(timestamp) {
    return Date.now() - timestamp > this.ttl;
  }
  filterExpired(events) {
    return events.filter((e) => !this.isExpired(e.event.ts));
  }
  async append(streamId, event) {
    return this.store.append(streamId, event);
  }
  async getEvents(streamId) {
    const events = await this.store.getEvents(streamId);
    return this.filterExpired(events);
  }
  async exists(streamId) {
    const events = await this.getEvents(streamId);
    return events.length > 0;
  }
  async getLastEvent(streamId) {
    const events = await this.getEvents(streamId);
    return events.length > 0 ? events[events.length - 1] : null;
  }
  async getEventsAfter(streamId, afterSeq) {
    const events = await this.getEvents(streamId);
    return events.filter((e) => e.seq > afterSeq);
  }
  async delete(streamId) {
    return this.store.delete(streamId);
  }
  async listStreams() {
    return this.store.listStreams();
  }
};
function withTTL(store, ttlMs) {
  return new TTLEventStore(store, ttlMs);
}

// src/utils/zodCompat.ts
function isZodSchema(value) {
  if (!value || typeof value !== "object") return false;
  const schema = value;
  return typeof schema.parse === "function" && typeof schema.safeParse === "function" && "_def" in schema;
}
function isZodError(error) {
  if (!error || typeof error !== "object") return false;
  const err = error;
  return err.name === "ZodError" && Array.isArray(err.issues) && typeof err.format === "function";
}
function safeParse(schema, data) {
  const result = schema.safeParse(data);
  return result;
}
function getZodErrorMessages(error) {
  return error.issues.map((issue) => {
    const path = issue.path.length > 0 ? `${issue.path.join(".")}: ` : "";
    return `${path}${issue.message}`;
  });
}
function flattenZodError(error) {
  const flat = error.flatten();
  return {
    formErrors: flat.formErrors,
    fieldErrors: flat.fieldErrors
  };
}

// src/utils/effectSchemaCompat.ts
function isEffectSchema(value) {
  if (!value) return false;
  if (typeof value !== "object" && typeof value !== "function") return false;
  const schema = value;
  return "ast" in schema && schema.ast !== void 0 && typeof schema.pipe === "function";
}
function isEffectParseError(error) {
  if (!error || typeof error !== "object") return false;
  const err = error;
  return err._tag === "ParseError" && "issue" in err;
}
function isEffectRight(result) {
  return result._tag === "Right";
}
function isEffectLeft(result) {
  return result._tag === "Left";
}
var effectAdapter = null;
function registerEffectSchemaAdapter(adapter) {
  effectAdapter = adapter;
}
function unregisterEffectSchemaAdapter() {
  effectAdapter = null;
}
function hasEffectSchemaAdapter() {
  return effectAdapter !== null;
}
function getEffectSchemaAdapter() {
  if (!effectAdapter) {
    throw new Error(
      "Effect Schema adapter not registered. Call registerEffectSchemaAdapter() first."
    );
  }
  return effectAdapter;
}
function safeDecodeEffectSchema(schema, data) {
  const adapter = getEffectSchemaAdapter();
  const result = adapter.decodeUnknownEither(schema, data);
  if (isEffectRight(result)) {
    return { success: true, data: result.right };
  } else {
    return { success: false, error: result.left };
  }
}
function getEffectErrorMessage(error) {
  if (effectAdapter) {
    return effectAdapter.formatError(error);
  }
  return error.message || "Schema validation failed";
}
function wrapEffectSchema(schema) {
  return {
    _tag: "effect",
    parse(data) {
      const adapter = getEffectSchemaAdapter();
      return adapter.decodeUnknownSync(schema, data);
    },
    safeParse(data) {
      const result = safeDecodeEffectSchema(schema, data);
      if (result.success) {
        return { success: true, data: result.data };
      } else {
        return {
          success: false,
          error: new Error(getEffectErrorMessage(result.error))
        };
      }
    }
  };
}

// src/utils/jsonSchemaCompat.ts
var jsonSchemaAdapter = null;
function registerJSONSchemaAdapter(adapter) {
  jsonSchemaAdapter = adapter;
}
function unregisterJSONSchemaAdapter() {
  jsonSchemaAdapter = null;
}
function hasJSONSchemaAdapter() {
  return jsonSchemaAdapter !== null;
}
function getJSONSchemaAdapter() {
  if (!jsonSchemaAdapter) {
    throw new Error(
      "JSON Schema adapter not registered. Call registerJSONSchemaAdapter() first."
    );
  }
  return jsonSchemaAdapter;
}
function isJSONSchema(value) {
  if (!value || typeof value !== "object") return false;
  const schema = value;
  return "$schema" in schema || "type" in schema || "properties" in schema || "$ref" in schema || "allOf" in schema || "anyOf" in schema || "oneOf" in schema;
}
function validateJSONSchema(schema, data) {
  const adapter = getJSONSchemaAdapter();
  const result = adapter.validate(schema, data);
  if (result.valid) {
    return { success: true, data: result.data };
  } else {
    const message = adapter.formatErrors(result.errors);
    return { success: false, error: new Error(message) };
  }
}
function wrapJSONSchema(schema) {
  return {
    _tag: "jsonschema",
    parse(data) {
      const result = validateJSONSchema(schema, data);
      if (result.success) {
        return result.data;
      }
      throw result.error;
    },
    safeParse(data) {
      return validateJSONSchema(schema, data);
    }
  };
}
function createSimpleJSONSchemaAdapter() {
  return {
    validate: (schema, data) => {
      const errors = [];
      function validateValue(s, value, path) {
        if (s.type) {
          const types = Array.isArray(s.type) ? s.type : [s.type];
          const actualType = getJSONType(value);
          const typeMatches = types.some((t) => {
            if (t === actualType) return true;
            if (t === "integer" && actualType === "number") {
              return Number.isInteger(value);
            }
            return false;
          });
          if (!typeMatches) {
            errors.push({
              path,
              message: `Expected ${types.join(" or ")}, got ${actualType}`,
              keyword: "type"
            });
            return;
          }
        }
        if (s.enum && !s.enum.includes(value)) {
          errors.push({
            path,
            message: `Value must be one of: ${s.enum.join(", ")}`,
            keyword: "enum"
          });
        }
        if (s.const !== void 0 && value !== s.const) {
          errors.push({
            path,
            message: `Value must be ${JSON.stringify(s.const)}`,
            keyword: "const"
          });
        }
        if (s.type === "object" && typeof value === "object" && value !== null) {
          const obj = value;
          if (s.required) {
            for (const prop of s.required) {
              if (!(prop in obj)) {
                errors.push({
                  path: `${path}/${prop}`,
                  message: `Missing required property: ${prop}`,
                  keyword: "required"
                });
              }
            }
          }
          if (s.properties) {
            for (const [key, propSchema] of Object.entries(s.properties)) {
              if (key in obj) {
                validateValue(propSchema, obj[key], `${path}/${key}`);
              }
            }
          }
        }
        if (s.type === "array" && Array.isArray(value)) {
          if (s.items && !Array.isArray(s.items)) {
            value.forEach((item, index) => {
              validateValue(
                s.items,
                item,
                `${path}/${index}`
              );
            });
          }
        }
        if (s.type === "string" && typeof value === "string") {
          if (s.minLength !== void 0 && value.length < s.minLength) {
            errors.push({
              path,
              message: `String must be at least ${s.minLength} characters`,
              keyword: "minLength"
            });
          }
          if (s.maxLength !== void 0 && value.length > s.maxLength) {
            errors.push({
              path,
              message: `String must be at most ${s.maxLength} characters`,
              keyword: "maxLength"
            });
          }
          if (s.pattern) {
            const regex = new RegExp(s.pattern);
            if (!regex.test(value)) {
              errors.push({
                path,
                message: `String must match pattern: ${s.pattern}`,
                keyword: "pattern"
              });
            }
          }
        }
        if (s.type === "number" && typeof value === "number") {
          if (s.minimum !== void 0 && value < s.minimum) {
            errors.push({
              path,
              message: `Number must be >= ${s.minimum}`,
              keyword: "minimum"
            });
          }
          if (s.maximum !== void 0 && value > s.maximum) {
            errors.push({
              path,
              message: `Number must be <= ${s.maximum}`,
              keyword: "maximum"
            });
          }
        }
      }
      validateValue(schema, data, "");
      if (errors.length === 0) {
        return { valid: true, data };
      }
      return { valid: false, errors };
    },
    formatErrors: (errors) => {
      return errors.map((e) => `${e.path || "/"}: ${e.message}`).join("; ");
    }
  };
}
function getJSONType(value) {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

// src/utils/shallow.ts
function shallowClone(obj) {
  if (obj === null || obj === void 0) {
    return obj;
  }
  if (typeof obj !== "object") {
    return obj;
  }
  if (Array.isArray(obj)) {
    return [...obj];
  }
  return { ...obj };
}
function shallowCopy(source, target) {
  Object.assign(target, source);
}

// src/index.ts
enableDriftDetection(() => new DriftDetector());
enableMonitoring((config) => new L0Monitor(config));
enableInterceptors(
  (interceptors) => new InterceptorManager(interceptors)
);
enableAdapterRegistry({
  getAdapter,
  hasMatchingAdapter,
  detectAdapter
});
export {
  BaseEventStore,
  BaseEventStoreWithSnapshots,
  CompositeEventStore,
  DEFAULT_BUCKETS,
  DocumentWindowImpl,
  DriftDetector,
  ERROR_TYPE_DELAY_DEFAULTS,
  ErrorCategory,
  FileEventStore,
  GuardrailEngine,
  InMemoryEventStore,
  InterceptorManager,
  L0Error,
  L0EventRecorder,
  L0EventReplayer,
  L0Monitor,
  L0OpenTelemetry,
  L0PrometheusCollector,
  L0Sentry,
  LocalStorageEventStore,
  METRIC_NAMES,
  Metrics,
  NetworkErrorType,
  OperationPool,
  PrometheusCollector,
  PrometheusRegistry,
  RETRY_DEFAULTS,
  RetryManager,
  RuntimeStates,
  SemanticAttributes,
  SpanKind,
  SpanStatusCode,
  StateMachine,
  TTLEventStore,
  TelemetryExporter,
  Timer,
  analyticsInterceptor,
  analyzeNetworkError,
  analyzeZeroToken,
  anthropicAdapter,
  anthropicStream,
  anthropicText,
  authInterceptor,
  autoCorrectJSON,
  balanceBraces,
  balanceBrackets,
  batched,
  bestConsensus,
  cachingInterceptor,
  calculateBackoff,
  calculateFieldConsensus,
  calculateMemorySize,
  calculateOutputSimilarity,
  calculateSimilarityMatrix,
  calculateSimilarityScore,
  calculateStructuralSimilarity,
  chainPipelines,
  checkDrift,
  checkGuardrails,
  chunkByChars,
  chunkByParagraphs,
  chunkBySentences,
  chunkByTokens,
  chunkDocument,
  cleanOutput,
  clearAdapters,
  compareArrays,
  compareNumbers,
  compareObjects,
  compareReplays,
  compareStrings,
  compareValues,
  consensus,
  consumeStream,
  cosineSimilarity,
  countFields,
  countMeaningfulTokens,
  createAdapterDataEvent,
  createAdapterDoneEvent,
  createAdapterErrorEvent,
  createAdapterMessageEvent,
  createAdapterProgressEvent,
  createAdapterTokenEvent,
  createAudioEvent,
  createBranchStep,
  createCompleteEvent,
  createCompositeStore,
  createDriftDetector,
  createErrorEvent,
  createEventRecorder,
  createEventReplayer,
  createEventStore,
  createGuardrailEngine,
  createImageEvent,
  createInMemoryEventStore,
  createInterceptorManager,
  createJsonDataEvent,
  createL0PrometheusCollector,
  createMemoryEntry,
  createMessageEvent,
  createMonitor,
  createOpenTelemetry,
  createOutputFormatSection,
  createParameter,
  createPipeline,
  createPipelineContext,
  createPool,
  createPrometheusCollector,
  createPrometheusRegistry,
  createRetryManager,
  createSentryIntegration,
  createSimpleJSONSchemaAdapter,
  createStep,
  createTokenEvent,
  createTool,
  createWindow,
  customPatternRule,
  dedent,
  deduplicateContinuation,
  deepEqual,
  describeJSONError,
  describeNetworkError,
  deserializeError,
  detectAdapter,
  detectInstantFinish,
  detectOverlap,
  detectRepeatedTokens,
  detectZeroToken,
  detectZeroTokenBeforeFirstMeaningful,
  endsAbruptly,
  ensureJson,
  escape,
  escapeDelimiters,
  escapeHtml,
  escapeRegex,
  estimateTokenCount,
  exponentialBackoff,
  exponentialRetry,
  extractJSON,
  extractJson,
  extractJsonFromOutput,
  extractMastraObject,
  extractMastraText,
  extractMeaningfulTokens,
  extractOpenAIText,
  extractTokens,
  fastPipeline,
  filterEventsByType,
  filterMemoryByRole,
  findAgreements,
  findDisagreements,
  fixedBackoff,
  fixedJitterBackoff,
  flattenZodError,
  formatContext,
  formatDocument,
  formatFunctionArguments,
  formatInstructions,
  formatJsonOutput,
  formatMemory,
  formatMultipleContexts,
  formatOutputConstraints,
  formatStructuredOutput,
  formatTool,
  formatTools,
  fullJitterBackoff,
  generateStreamId,
  getAdapter,
  getChunkOverlap,
  getConsensusValue,
  getEffectErrorMessage,
  getEffectSchemaAdapter,
  getErrorCategory2 as getErrorCategory,
  getJSONSchemaAdapter,
  getLastNEntries,
  getProcessingStats,
  getRegisteredAdapters,
  getRegisteredStreamAdapters,
  getStreamMetadata,
  getText,
  getType,
  getZodErrorMessages,
  hasEffectSchemaAdapter,
  hasJSONSchemaAdapter,
  hasMatchingAdapter,
  hasMeaningfulContent,
  indent,
  isAnthropicStream,
  isAnthropicStreamEvent,
  isBackgroundThrottle,
  isConnectionDropped,
  isDNSError,
  isECONNREFUSED,
  isECONNRESET,
  isEffectLeft,
  isEffectParseError,
  isEffectRight,
  isEffectSchema,
  isFetchTypeError,
  isJSONSchema,
  isL0Error,
  isMastraStream,
  isMeaningfulToken,
  isNetworkError,
  isNoBytes,
  isOpenAIChunk,
  isOpenAIStream,
  isPartialChunks,
  isRetryableError,
  isRuntimeKilled,
  isSSEAborted,
  isSSLError,
  isStreamInterrupted,
  isTimeoutError,
  isValidJSON,
  isValidJson,
  isZodError,
  isZodSchema,
  jaroWinklerSimilarity,
  jsonOnlyGuardrails,
  jsonRule,
  l0,
  l0PrometheusMiddleware,
  l0WithWindow,
  largeWindow,
  latexOnlyGuardrails,
  latexRule,
  lenientConsensus,
  levenshteinDistance,
  levenshteinSimilarity,
  linearBackoff,
  loggingInterceptor,
  markdownOnlyGuardrails,
  markdownRule,
  mastraAdapter,
  mastraStream,
  mastraStructured,
  mastraText,
  mediumWindow,
  meetsMinimumAgreement,
  mergeChunks,
  mergeMemory,
  mergeResults,
  metadataInterceptor,
  minimalGuardrails,
  minimalRetry,
  minimalStructured,
  normalizeForModel,
  normalizeIndentation,
  normalizeNewlines,
  normalizeStreamEvent,
  normalizeStreamEvents,
  normalizeText,
  normalizeWhitespace,
  openTelemetryInterceptor,
  openaiAdapter,
  openaiJSON,
  openaiStream,
  openaiText,
  openaiWithTools,
  pad,
  paragraphWindow,
  parallel,
  parallelAll,
  parallelPipelines,
  parseFunctionCall,
  parseOrRepairJson,
  patternRule,
  pipe,
  processWithWindow,
  productionPipeline,
  prometheusMiddleware,
  quickConsensus,
  race,
  rateLimitInterceptor,
  recommendedGuardrails,
  recommendedRetry,
  recommendedStructured,
  reconstructText,
  registerAdapter,
  registerEffectSchemaAdapter,
  registerJSONSchemaAdapter,
  registerStorageAdapter,
  reliablePipeline,
  removeAnsi,
  removeTrailingCommas,
  repairJSON,
  repairJson,
  repairLatexEnvironments,
  repairMarkdownFences,
  repairToolCallArguments,
  replay,
  resolveBest,
  resolveMajority,
  resolveMerge,
  runAsyncDriftCheck,
  runAsyncGuardrailCheck,
  runDriftCheckAsync,
  runGuardrailCheckAsync,
  runStages,
  safeDecodeEffectSchema,
  safeJSONParse,
  safeParse,
  sanitize,
  sentenceWindow,
  sentryInterceptor,
  sequential,
  serializeError,
  shallowClone,
  shallowCopy,
  sleep,
  smallWindow,
  splitIntoSentences,
  standardConsensus,
  strictConsensus,
  strictGuardrails,
  strictJsonRule,
  strictRetry,
  strictStructured,
  structured,
  structuredArray,
  structuredObject,
  structuredStream,
  suggestRetryDelay,
  timeout,
  timingInterceptor,
  toL0Events,
  toL0EventsWithMessages,
  toMultimodalL0Events,
  transformInterceptor,
  trim,
  trimText,
  truncate,
  truncateMemory,
  truncateWords,
  unescape,
  unescapeDelimiters,
  unescapeHtml,
  unregisterAdapter,
  unregisterEffectSchemaAdapter,
  unregisterJSONSchemaAdapter,
  unregisterStorageAdapter,
  validateConsensus,
  validateJSONSchema,
  validateTool,
  validationInterceptor,
  withSentry,
  withTTL,
  withTimeout,
  wrap,
  wrapAnthropicStream,
  wrapEffectSchema,
  wrapJSONSchema,
  wrapMastraFullStream,
  wrapMastraStream,
  wrapOpenAIStream,
  zeroOutputRule
};
