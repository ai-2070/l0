// Network error detection utilities for L0

/**
 * Network error types that L0 can detect
 */
export enum NetworkErrorType {
  CONNECTION_DROPPED = "connection_dropped",
  FETCH_ERROR = "fetch_error",
  ECONNRESET = "econnreset",
  ECONNREFUSED = "econnrefused",
  SSE_ABORTED = "sse_aborted",
  NO_BYTES = "no_bytes",
  PARTIAL_CHUNKS = "partial_chunks",
  RUNTIME_KILLED = "runtime_killed",
  BACKGROUND_THROTTLE = "background_throttle",
  DNS_ERROR = "dns_error",
  SSL_ERROR = "ssl_error",
  TIMEOUT = "timeout",
  UNKNOWN = "unknown",
}

/**
 * Detailed network error analysis
 */
export interface NetworkErrorAnalysis {
  /**
   * The specific type of network error
   */
  type: NetworkErrorType;

  /**
   * Whether this error is retryable
   */
  retryable: boolean;

  /**
   * Whether this error should count toward retry limit
   */
  countsTowardLimit: boolean;

  /**
   * Suggested action to take
   */
  suggestion: string;

  /**
   * Additional context about the error
   */
  context?: Record<string, any>;
}

/**
 * Detect if error is a connection drop
 */
export function isConnectionDropped(error: Error): boolean {
  const message = error.message.toLowerCase();
  return (
    message.includes("connection dropped") ||
    message.includes("connection closed") ||
    message.includes("connection lost") ||
    message.includes("connection reset") ||
    message.includes("econnreset") ||
    message.includes("pipe broken") ||
    message.includes("broken pipe")
  );
}

/**
 * Detect if error is a fetch() TypeError
 */
export function isFetchTypeError(error: Error): boolean {
  return (
    error.name === "TypeError" &&
    (error.message.toLowerCase().includes("fetch") ||
      error.message.toLowerCase().includes("failed to fetch") ||
      error.message.toLowerCase().includes("network request failed"))
  );
}

/**
 * Detect if error is ECONNRESET
 */
export function isECONNRESET(error: Error): boolean {
  const message = error.message.toLowerCase();
  return (
    message.includes("econnreset") ||
    message.includes("connection reset by peer") ||
    (error as any).code === "ECONNRESET"
  );
}

/**
 * Detect if error is ECONNREFUSED
 */
export function isECONNREFUSED(error: Error): boolean {
  const message = error.message.toLowerCase();
  return (
    message.includes("econnrefused") ||
    message.includes("connection refused") ||
    (error as any).code === "ECONNREFUSED"
  );
}

/**
 * Detect if error is SSE abortion
 */
export function isSSEAborted(error: Error): boolean {
  const message = error.message.toLowerCase();
  return (
    message.includes("sse") ||
    message.includes("server-sent events") ||
    (message.includes("stream") && message.includes("abort")) ||
    message.includes("stream aborted") ||
    message.includes("eventstream") ||
    error.name === "AbortError"
  );
}

/**
 * Detect if error is due to no bytes arriving
 */
export function isNoBytes(error: Error): boolean {
  const message = error.message.toLowerCase();
  return (
    message.includes("no bytes") ||
    message.includes("empty response") ||
    message.includes("zero bytes") ||
    message.includes("no data received") ||
    message.includes("content-length: 0")
  );
}

/**
 * Detect if error is due to partial chunks
 */
export function isPartialChunks(error: Error): boolean {
  const message = error.message.toLowerCase();
  return (
    message.includes("partial chunk") ||
    message.includes("incomplete chunk") ||
    message.includes("truncated") ||
    message.includes("premature close") ||
    message.includes("unexpected end of data") ||
    message.includes("incomplete data")
  );
}

/**
 * Detect if error is due to Node/Edge runtime being killed
 */
export function isRuntimeKilled(error: Error): boolean {
  const message = error.message.toLowerCase();
  return (
    (message.includes("worker") && message.includes("terminated")) ||
    (message.includes("runtime") && message.includes("killed")) ||
    message.includes("edge runtime") ||
    message.includes("lambda timeout") ||
    message.includes("function timeout") ||
    message.includes("execution timeout") ||
    message.includes("worker died") ||
    message.includes("process exited") ||
    message.includes("sigterm") ||
    message.includes("sigkill")
  );
}

/**
 * Detect if error is due to mobile background throttling
 */
export function isBackgroundThrottle(error: Error): boolean {
  const message = error.message.toLowerCase();
  return (
    (message.includes("background") && message.includes("suspend")) ||
    message.includes("background throttle") ||
    message.includes("tab suspended") ||
    message.includes("page hidden") ||
    message.includes("visibility hidden") ||
    message.includes("inactive tab") ||
    message.includes("background tab")
  );
}

/**
 * Detect DNS errors
 */
export function isDNSError(error: Error): boolean {
  const message = error.message.toLowerCase();
  return (
    message.includes("dns") ||
    message.includes("enotfound") ||
    message.includes("name resolution") ||
    message.includes("host not found") ||
    message.includes("getaddrinfo") ||
    (error as any).code === "ENOTFOUND"
  );
}

/**
 * Detect SSL/TLS errors
 */
export function isSSLError(error: Error): boolean {
  const message = error.message.toLowerCase();
  return (
    message.includes("ssl") ||
    message.includes("tls") ||
    message.includes("certificate") ||
    message.includes("cert") ||
    message.includes("handshake") ||
    message.includes("self signed") ||
    message.includes("unable to verify")
  );
}

/**
 * Detect timeout errors
 */
export function isTimeoutError(error: Error): boolean {
  const message = error.message.toLowerCase();
  return (
    error.name === "TimeoutError" ||
    message.includes("timeout") ||
    message.includes("timed out") ||
    message.includes("time out") ||
    message.includes("deadline exceeded") ||
    message.includes("etimedout") ||
    (error as any).code === "ETIMEDOUT"
  );
}

/**
 * Analyze network error and provide detailed information
 */
export function analyzeNetworkError(error: Error): NetworkErrorAnalysis {
  // Check each specific error type
  if (isConnectionDropped(error)) {
    return {
      type: NetworkErrorType.CONNECTION_DROPPED,
      retryable: true,
      countsTowardLimit: false,
      suggestion: "Retry with exponential backoff - connection was interrupted",
    };
  }

  if (isFetchTypeError(error)) {
    return {
      type: NetworkErrorType.FETCH_ERROR,
      retryable: true,
      countsTowardLimit: false,
      suggestion: "Retry immediately - fetch() failed to initiate",
    };
  }

  if (isECONNRESET(error)) {
    return {
      type: NetworkErrorType.ECONNRESET,
      retryable: true,
      countsTowardLimit: false,
      suggestion: "Retry with backoff - connection was reset by peer",
    };
  }

  if (isECONNREFUSED(error)) {
    return {
      type: NetworkErrorType.ECONNREFUSED,
      retryable: true,
      countsTowardLimit: false,
      suggestion: "Retry with longer delay - server refused connection",
      context: {
        possibleCause: "Server may be down or not accepting connections",
      },
    };
  }

  if (isSSEAborted(error)) {
    return {
      type: NetworkErrorType.SSE_ABORTED,
      retryable: true,
      countsTowardLimit: false,
      suggestion: "Retry immediately - SSE stream was aborted",
    };
  }

  if (isNoBytes(error)) {
    return {
      type: NetworkErrorType.NO_BYTES,
      retryable: true,
      countsTowardLimit: false,
      suggestion: "Retry immediately - server sent no data",
      context: {
        possibleCause: "Empty response or connection closed before data sent",
      },
    };
  }

  if (isPartialChunks(error)) {
    return {
      type: NetworkErrorType.PARTIAL_CHUNKS,
      retryable: true,
      countsTowardLimit: false,
      suggestion: "Retry immediately - received incomplete data",
      context: {
        possibleCause: "Connection closed mid-stream",
      },
    };
  }

  if (isRuntimeKilled(error)) {
    return {
      type: NetworkErrorType.RUNTIME_KILLED,
      retryable: true,
      countsTowardLimit: false,
      suggestion:
        "Retry with shorter timeout - runtime was terminated (likely timeout)",
      context: {
        possibleCause:
          "Edge runtime timeout or Lambda timeout - consider breaking into smaller requests",
      },
    };
  }

  if (isBackgroundThrottle(error)) {
    return {
      type: NetworkErrorType.BACKGROUND_THROTTLE,
      retryable: true,
      countsTowardLimit: false,
      suggestion: "Retry when page becomes visible - mobile/browser throttling",
      context: {
        possibleCause: "Browser suspended network activity for background tab",
        resolution: "Wait for visibilitychange event",
      },
    };
  }

  if (isDNSError(error)) {
    return {
      type: NetworkErrorType.DNS_ERROR,
      retryable: true,
      countsTowardLimit: false,
      suggestion: "Retry with longer delay - DNS lookup failed",
      context: {
        possibleCause: "Network connectivity issue or invalid hostname",
      },
    };
  }

  if (isSSLError(error)) {
    return {
      type: NetworkErrorType.SSL_ERROR,
      retryable: false,
      countsTowardLimit: false,
      suggestion: "Don't retry - SSL/TLS error (configuration issue)",
      context: {
        possibleCause: "Certificate validation failed or SSL handshake error",
        resolution: "Check server certificate or SSL configuration",
      },
    };
  }

  if (isTimeoutError(error)) {
    return {
      type: NetworkErrorType.TIMEOUT,
      retryable: true,
      countsTowardLimit: false,
      suggestion: "Retry with longer timeout - request timed out",
    };
  }

  // Unknown network error
  return {
    type: NetworkErrorType.UNKNOWN,
    retryable: true,
    countsTowardLimit: false,
    suggestion: "Retry with caution - unknown network error",
  };
}

/**
 * Check if error is any type of network error
 */
export function isNetworkError(error: Error): boolean {
  return (
    isConnectionDropped(error) ||
    isFetchTypeError(error) ||
    isECONNRESET(error) ||
    isECONNREFUSED(error) ||
    isSSEAborted(error) ||
    isNoBytes(error) ||
    isPartialChunks(error) ||
    isRuntimeKilled(error) ||
    isBackgroundThrottle(error) ||
    isDNSError(error) ||
    isTimeoutError(error)
  );
}

/**
 * Get human-readable description of network error
 */
export function describeNetworkError(error: Error): string {
  const analysis = analyzeNetworkError(error);

  let description = `Network error: ${analysis.type}`;

  if (analysis.context?.possibleCause) {
    description += ` (${analysis.context.possibleCause})`;
  }

  return description;
}

/**
 * Create enhanced network error with analysis
 */
export function createNetworkError(
  originalError: Error,
  analysis: NetworkErrorAnalysis,
): Error & { analysis: NetworkErrorAnalysis } {
  const error = new Error(
    `${originalError.message} [${analysis.type}]`,
  ) as Error & { analysis: NetworkErrorAnalysis };
  error.name = originalError.name;
  error.stack = originalError.stack;
  error.analysis = analysis;
  return error;
}

/**
 * Check if error indicates stream was interrupted mid-flight
 */
export function isStreamInterrupted(
  error: Error,
  tokenCount: number,
): boolean {
  // If we received some tokens but then got a network error, stream was interrupted
  if (tokenCount > 0 && isNetworkError(error)) {
    return true;
  }

  // Check for specific interrupted stream indicators
  const message = error.message.toLowerCase();
  return (
    message.includes("stream interrupted") ||
    message.includes("stream closed unexpectedly") ||
    message.includes("connection lost mid-stream") ||
    (isPartialChunks(error) && tokenCount > 0)
  );
}

/**
 * Suggest retry delay based on network error type
 */
export function suggestRetryDelay(error: Error, attempt: number): number {
  const analysis = analyzeNetworkError(error);

  // Base delays for different error types
  const baseDelays: Record<NetworkErrorType, number> = {
    [NetworkErrorType.CONNECTION_DROPPED]: 1000,
    [NetworkErrorType.FETCH_ERROR]: 500,
    [NetworkErrorType.ECONNRESET]: 1000,
    [NetworkErrorType.ECONNREFUSED]: 2000,
    [NetworkErrorType.SSE_ABORTED]: 500,
    [NetworkErrorType.NO_BYTES]: 500,
    [NetworkErrorType.PARTIAL_CHUNKS]: 500,
    [NetworkErrorType.RUNTIME_KILLED]: 2000,
    [NetworkErrorType.BACKGROUND_THROTTLE]: 5000,
    [NetworkErrorType.DNS_ERROR]: 3000,
    [NetworkErrorType.SSL_ERROR]: 0, // Don't retry
    [NetworkErrorType.TIMEOUT]: 1000,
    [NetworkErrorType.UNKNOWN]: 1000,
  };

  const baseDelay = baseDelays[analysis.type];
  if (baseDelay === 0) return 0;

  // Exponential backoff
  return Math.min(baseDelay * Math.pow(2, attempt), 30000);
}
