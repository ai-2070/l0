import { describe, it, expect } from "vitest";
import {
  L0Error,
  isL0Error,
  getErrorCategory,
  NetworkErrorType,
  isConnectionDropped,
  isFetchTypeError,
  isECONNRESET,
  isECONNREFUSED,
  isSSEAborted,
  isNoBytes,
  isPartialChunks,
  isRuntimeKilled,
  isBackgroundThrottle,
  isDNSError,
  isSSLError,
  isTimeoutError,
  analyzeNetworkError,
  isNetworkError,
  describeNetworkError,
  createNetworkError,
  isStreamInterrupted,
  suggestRetryDelay,
  ErrorCategory,
} from "../src/utils/errors";

describe("Error Utilities", () => {
  describe("L0Error", () => {
    it("should create error with context", () => {
      const error = new L0Error("Test error", {
        code: "NETWORK_ERROR",
        checkpoint: "some content",
        tokenCount: 10,
      });

      expect(error.message).toBe("Test error");
      expect(error.code).toBe("NETWORK_ERROR");
      expect(error.context.checkpoint).toBe("some content");
      expect(error.context.tokenCount).toBe(10);
      expect(error.timestamp).toBeDefined();
    });

    it("should get correct category", () => {
      const networkError = new L0Error("Network", { code: "NETWORK_ERROR" });
      expect(networkError.category).toBe(ErrorCategory.NETWORK);

      const contentError = new L0Error("Content", {
        code: "GUARDRAIL_VIOLATION",
      });
      expect(contentError.category).toBe(ErrorCategory.CONTENT);
    });

    it("should check if recoverable", () => {
      const recoverable = new L0Error("Error", {
        code: "NETWORK_ERROR",
        recoverable: true,
        checkpoint: "content",
      });
      expect(recoverable.isRecoverable).toBe(true);

      const notRecoverable = new L0Error("Error", {
        code: "NETWORK_ERROR",
        recoverable: false,
      });
      expect(notRecoverable.isRecoverable).toBe(false);

      const noCheckpoint = new L0Error("Error", {
        code: "NETWORK_ERROR",
        recoverable: true,
        checkpoint: "",
      });
      expect(noCheckpoint.isRecoverable).toBe(false);
    });

    it("should get checkpoint", () => {
      const error = new L0Error("Error", {
        code: "NETWORK_ERROR",
        checkpoint: "saved content",
      });
      expect(error.getCheckpoint()).toBe("saved content");
    });

    it("should create detailed string", () => {
      const error = new L0Error("Test error", {
        code: "NETWORK_ERROR",
        tokenCount: 10,
        modelRetryCount: 2,
        fallbackIndex: 1,
        checkpoint: "content",
      });

      const detailed = error.toDetailedString();
      expect(detailed).toContain("Test error");
      expect(detailed).toContain("Tokens: 10");
      expect(detailed).toContain("Retries: 2");
      expect(detailed).toContain("Fallback: 1");
      expect(detailed).toContain("chars");
    });

    it("should serialize to JSON", () => {
      const error = new L0Error("Test", {
        code: "NETWORK_ERROR",
        tokenCount: 5,
        checkpoint: "test content",
      });

      const json = error.toJSON();
      expect(json.name).toBe("L0Error");
      expect(json.code).toBe("NETWORK_ERROR");
      expect(json.message).toBe("Test");
      expect(json.tokenCount).toBe(5);
      expect(json.checkpoint).toBe(12); // length of "test content"
    });
  });

  describe("isL0Error", () => {
    it("should return true for L0Error", () => {
      const error = new L0Error("Test", { code: "NETWORK_ERROR" });
      expect(isL0Error(error)).toBe(true);
    });

    it("should return false for regular Error", () => {
      const error = new Error("Test");
      expect(isL0Error(error)).toBe(false);
    });

    it("should return false for non-errors", () => {
      expect(isL0Error(null)).toBe(false);
      expect(isL0Error(undefined)).toBe(false);
      expect(isL0Error("error")).toBe(false);
    });
  });

  describe("getErrorCategory", () => {
    it("should categorize network errors", () => {
      expect(getErrorCategory("NETWORK_ERROR")).toBe(ErrorCategory.NETWORK);
    });

    it("should categorize transient errors", () => {
      expect(getErrorCategory("INITIAL_TOKEN_TIMEOUT")).toBe(
        ErrorCategory.TRANSIENT,
      );
      expect(getErrorCategory("INTER_TOKEN_TIMEOUT")).toBe(
        ErrorCategory.TRANSIENT,
      );
    });

    it("should categorize content errors", () => {
      expect(getErrorCategory("GUARDRAIL_VIOLATION")).toBe(
        ErrorCategory.CONTENT,
      );
      expect(getErrorCategory("FATAL_GUARDRAIL_VIOLATION")).toBe(
        ErrorCategory.CONTENT,
      );
      expect(getErrorCategory("DRIFT_DETECTED")).toBe(ErrorCategory.CONTENT);
      expect(getErrorCategory("ZERO_OUTPUT")).toBe(ErrorCategory.CONTENT);
    });

    it("should categorize internal errors", () => {
      expect(getErrorCategory("INVALID_STREAM")).toBe(ErrorCategory.INTERNAL);
      expect(getErrorCategory("ADAPTER_NOT_FOUND")).toBe(
        ErrorCategory.INTERNAL,
      );
      expect(getErrorCategory("FEATURE_NOT_ENABLED")).toBe(
        ErrorCategory.INTERNAL,
      );
    });

    it("should categorize provider errors", () => {
      expect(getErrorCategory("STREAM_ABORTED")).toBe(ErrorCategory.PROVIDER);
      expect(getErrorCategory("ALL_STREAMS_EXHAUSTED")).toBe(
        ErrorCategory.PROVIDER,
      );
    });
  });

  describe("Network Error Detection", () => {
    describe("isConnectionDropped", () => {
      it("should detect connection dropped errors", () => {
        expect(isConnectionDropped(new Error("connection dropped"))).toBe(true);
        expect(isConnectionDropped(new Error("connection closed"))).toBe(true);
        expect(isConnectionDropped(new Error("connection reset"))).toBe(true);
        expect(isConnectionDropped(new Error("ECONNRESET"))).toBe(true);
        expect(isConnectionDropped(new Error("broken pipe"))).toBe(true);
      });

      it("should return false for other errors", () => {
        expect(isConnectionDropped(new Error("timeout"))).toBe(false);
      });
    });

    describe("isFetchTypeError", () => {
      it("should detect fetch TypeErrors", () => {
        const error = new TypeError("Failed to fetch");
        expect(isFetchTypeError(error)).toBe(true);
      });

      it("should detect network request failed", () => {
        const error = new TypeError("Network request failed");
        expect(isFetchTypeError(error)).toBe(true);
      });

      it("should return false for non-TypeErrors", () => {
        expect(isFetchTypeError(new Error("Failed to fetch"))).toBe(false);
      });
    });

    describe("isECONNRESET", () => {
      it("should detect ECONNRESET errors", () => {
        expect(isECONNRESET(new Error("ECONNRESET"))).toBe(true);
        expect(isECONNRESET(new Error("connection reset by peer"))).toBe(true);
      });

      it("should detect by error code", () => {
        const error = new Error("Socket error") as Error & { code: string };
        error.code = "ECONNRESET";
        expect(isECONNRESET(error)).toBe(true);
      });
    });

    describe("isECONNREFUSED", () => {
      it("should detect ECONNREFUSED errors", () => {
        expect(isECONNREFUSED(new Error("ECONNREFUSED"))).toBe(true);
        expect(isECONNREFUSED(new Error("connection refused"))).toBe(true);
      });
    });

    describe("isSSEAborted", () => {
      it("should detect SSE aborted errors", () => {
        expect(isSSEAborted(new Error("SSE connection failed"))).toBe(true);
        expect(isSSEAborted(new Error("stream aborted"))).toBe(true);
      });

      it("should detect AbortError", () => {
        const error = new Error("Aborted");
        error.name = "AbortError";
        expect(isSSEAborted(error)).toBe(true);
      });
    });

    describe("isNoBytes", () => {
      it("should detect no bytes errors", () => {
        expect(isNoBytes(new Error("no bytes received"))).toBe(true);
        expect(isNoBytes(new Error("empty response"))).toBe(true);
        expect(isNoBytes(new Error("zero bytes"))).toBe(true);
      });
    });

    describe("isPartialChunks", () => {
      it("should detect partial chunk errors", () => {
        expect(isPartialChunks(new Error("partial chunk received"))).toBe(true);
        expect(isPartialChunks(new Error("truncated response"))).toBe(true);
        expect(isPartialChunks(new Error("premature close"))).toBe(true);
      });
    });

    describe("isRuntimeKilled", () => {
      it("should detect runtime killed errors", () => {
        expect(isRuntimeKilled(new Error("worker terminated"))).toBe(true);
        expect(isRuntimeKilled(new Error("lambda timeout"))).toBe(true);
        expect(isRuntimeKilled(new Error("SIGTERM"))).toBe(true);
      });
    });

    describe("isBackgroundThrottle", () => {
      it("should detect background throttle errors", () => {
        expect(isBackgroundThrottle(new Error("background suspend"))).toBe(
          true,
        );
        expect(isBackgroundThrottle(new Error("tab suspended"))).toBe(true);
        expect(isBackgroundThrottle(new Error("page hidden"))).toBe(true);
      });
    });

    describe("isDNSError", () => {
      it("should detect DNS errors", () => {
        expect(isDNSError(new Error("DNS lookup failed"))).toBe(true);
        expect(isDNSError(new Error("ENOTFOUND"))).toBe(true);
        expect(isDNSError(new Error("getaddrinfo failed"))).toBe(true);
      });
    });

    describe("isSSLError", () => {
      it("should detect SSL errors", () => {
        expect(isSSLError(new Error("SSL handshake failed"))).toBe(true);
        expect(isSSLError(new Error("certificate expired"))).toBe(true);
        expect(isSSLError(new Error("self signed certificate"))).toBe(true);
      });
    });

    describe("isTimeoutError", () => {
      it("should detect timeout errors", () => {
        expect(isTimeoutError(new Error("timeout"))).toBe(true);
        expect(isTimeoutError(new Error("timed out"))).toBe(true);
        expect(isTimeoutError(new Error("deadline exceeded"))).toBe(true);
      });

      it("should detect TimeoutError by name", () => {
        const error = new Error("Operation timed out");
        error.name = "TimeoutError";
        expect(isTimeoutError(error)).toBe(true);
      });
    });
  });

  describe("analyzeNetworkError", () => {
    it("should analyze connection dropped error", () => {
      const analysis = analyzeNetworkError(new Error("connection dropped"));
      expect(analysis.type).toBe(NetworkErrorType.CONNECTION_DROPPED);
      expect(analysis.retryable).toBe(true);
      expect(analysis.countsTowardLimit).toBe(false);
    });

    it("should analyze fetch error", () => {
      const error = new TypeError("Failed to fetch");
      const analysis = analyzeNetworkError(error);
      expect(analysis.type).toBe(NetworkErrorType.FETCH_ERROR);
      expect(analysis.retryable).toBe(true);
    });

    it("should analyze SSL error as non-retryable", () => {
      const analysis = analyzeNetworkError(new Error("SSL certificate error"));
      expect(analysis.type).toBe(NetworkErrorType.SSL_ERROR);
      expect(analysis.retryable).toBe(false);
    });

    it("should return unknown for unrecognized errors", () => {
      const analysis = analyzeNetworkError(new Error("some random error"));
      expect(analysis.type).toBe(NetworkErrorType.UNKNOWN);
      expect(analysis.retryable).toBe(true);
    });
  });

  describe("isNetworkError", () => {
    it("should return true for network errors", () => {
      expect(isNetworkError(new Error("connection dropped"))).toBe(true);
      expect(isNetworkError(new Error("ECONNRESET"))).toBe(true);
      expect(isNetworkError(new Error("timeout"))).toBe(true);
    });

    it("should return false for non-network errors", () => {
      expect(isNetworkError(new Error("syntax error"))).toBe(false);
      expect(isNetworkError(new Error("undefined is not a function"))).toBe(
        false,
      );
    });
  });

  describe("describeNetworkError", () => {
    it("should describe network error", () => {
      const description = describeNetworkError(new Error("connection dropped"));
      expect(description).toContain("Network error");
      expect(description).toContain("connection_dropped");
    });

    it("should include possible cause if available", () => {
      const description = describeNetworkError(new Error("ECONNREFUSED"));
      expect(description).toContain("econnrefused");
      expect(description).toContain("Server may be down");
    });
  });

  describe("createNetworkError", () => {
    it("should create enhanced error with analysis", () => {
      const original = new Error("connection dropped");
      const analysis = analyzeNetworkError(original);
      const enhanced = createNetworkError(original, analysis);

      expect(enhanced.analysis).toBe(analysis);
      expect(enhanced.message).toContain("connection_dropped");
    });
  });

  describe("isStreamInterrupted", () => {
    it("should return true for network error with tokens", () => {
      expect(isStreamInterrupted(new Error("connection dropped"), 5)).toBe(
        true,
      );
    });

    it("should return false for network error with no tokens", () => {
      expect(isStreamInterrupted(new Error("connection dropped"), 0)).toBe(
        false,
      );
    });

    it("should detect explicit stream interrupted messages", () => {
      expect(isStreamInterrupted(new Error("stream interrupted"), 0)).toBe(
        true,
      );
      expect(
        isStreamInterrupted(new Error("connection lost mid-stream"), 0),
      ).toBe(true);
    });
  });

  describe("suggestRetryDelay", () => {
    it("should suggest delay based on error type", () => {
      const connError = new Error("connection dropped");
      const delay = suggestRetryDelay(connError, 0);
      expect(delay).toBeGreaterThan(0);
    });

    it("should apply exponential backoff", () => {
      const error = new Error("connection dropped");
      const delay0 = suggestRetryDelay(error, 0);
      const delay1 = suggestRetryDelay(error, 1);
      const delay2 = suggestRetryDelay(error, 2);

      expect(delay1).toBe(delay0 * 2);
      expect(delay2).toBe(delay0 * 4);
    });

    it("should return 0 for SSL errors", () => {
      const sslError = new Error("SSL certificate error");
      const delay = suggestRetryDelay(sslError, 0);
      expect(delay).toBe(0);
    });

    it("should respect maxDelay", () => {
      const error = new Error("connection dropped");
      const delay = suggestRetryDelay(error, 10, undefined, 1000);
      expect(delay).toBeLessThanOrEqual(1000);
    });

    it("should use custom delays if provided", () => {
      const error = new Error("connection dropped");
      const customDelays = { [NetworkErrorType.CONNECTION_DROPPED]: 5000 };
      const delay = suggestRetryDelay(error, 0, customDelays);
      expect(delay).toBe(5000);
    });
  });
});
