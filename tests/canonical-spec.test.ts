/**
 * Canonical Specification Tests for L0 Runtime
 *
 * These tests validate the L0 runtime against the canonical specification
 * defined in fixtures/canonical-spec.json. This ensures consistency between
 * TypeScript and Python implementations.
 *
 * Tests cover:
 * - L0Error structure and toJSON() format
 * - Error code to category mapping
 * - Observability event structure
 * - Network error classification
 */

import { describe, it, expect } from "vitest";
import {
  L0Error,
  L0ErrorCodes,
  getErrorCategory,
  NetworkErrorType,
  analyzeNetworkError,
  isNetworkError,
} from "../src/utils/errors";
import { ErrorCategory } from "../src/types/retry";
import { EventType } from "../src/types/observability";
import canonicalSpec from "./fixtures/canonical-spec.json";

// ============================================================================
// L0Error Tests
// ============================================================================

describe("Canonical Spec: L0Error", () => {
  describe("toJSON() shape", () => {
    it("should return all required fields", () => {
      const error = new L0Error("Test error", {
        code: L0ErrorCodes.STREAM_ABORTED,
        checkpoint: "checkpoint-content",
        tokenCount: 10,
        modelRetryCount: 2,
        networkRetryCount: 1,
        fallbackIndex: 0,
        metadata: { violation: { rule: "test" } },
        context: { requestId: "req-123" },
      });

      const json = error.toJSON();

      // Verify all fields from canonical spec
      expect(json).toHaveProperty("name", "L0Error");
      expect(json).toHaveProperty("code", L0ErrorCodes.STREAM_ABORTED);
      expect(json).toHaveProperty("category");
      expect(json).toHaveProperty("message", "Test error");
      expect(json).toHaveProperty("timestamp");
      expect(json).toHaveProperty("hasCheckpoint", true);
      expect(json).toHaveProperty("checkpoint", "checkpoint-content");
      expect(json).toHaveProperty("tokenCount", 10);
      expect(json).toHaveProperty("modelRetryCount", 2);
      expect(json).toHaveProperty("networkRetryCount", 1);
      expect(json).toHaveProperty("fallbackIndex", 0);
      expect(json).toHaveProperty("metadata");
      expect(json).toHaveProperty("context");
    });

    it("should include metadata for internal state", () => {
      const error = new L0Error("Guardrail failed", {
        code: L0ErrorCodes.GUARDRAIL_VIOLATION,
        metadata: {
          violation: {
            rule: "no-pii",
            severity: "error",
            message: "PII detected",
          },
        },
      });

      const json = error.toJSON();
      expect(json.metadata).toEqual({
        violation: {
          rule: "no-pii",
          severity: "error",
          message: "PII detected",
        },
      });
    });

    it("should include context for user-provided data", () => {
      const error = new L0Error("Network error", {
        code: L0ErrorCodes.NETWORK_ERROR,
        context: {
          requestId: "req-456",
          userId: "user-789",
          nested: { traceId: "trace-abc" },
        },
      });

      const json = error.toJSON();
      expect(json.context).toEqual({
        requestId: "req-456",
        userId: "user-789",
        nested: { traceId: "trace-abc" },
      });
    });

    it("should handle undefined optional fields", () => {
      const error = new L0Error("Minimal error", {
        code: L0ErrorCodes.INVALID_STREAM,
      });

      const json = error.toJSON();
      expect(json.checkpoint).toBeUndefined();
      expect(json.tokenCount).toBeUndefined();
      expect(json.modelRetryCount).toBeUndefined();
      expect(json.networkRetryCount).toBeUndefined();
      expect(json.fallbackIndex).toBeUndefined();
      expect(json.metadata).toBeUndefined();
      expect(json.context).toBeUndefined();
    });

    it("should compute hasCheckpoint correctly", () => {
      // No checkpoint
      const error1 = new L0Error("No checkpoint", {
        code: L0ErrorCodes.STREAM_ABORTED,
      });
      expect(error1.toJSON().hasCheckpoint).toBe(false);

      // Empty checkpoint
      const error2 = new L0Error("Empty checkpoint", {
        code: L0ErrorCodes.STREAM_ABORTED,
        checkpoint: "",
      });
      expect(error2.toJSON().hasCheckpoint).toBe(false);

      // Valid checkpoint
      const error3 = new L0Error("Has checkpoint", {
        code: L0ErrorCodes.STREAM_ABORTED,
        checkpoint: "content",
      });
      expect(error3.toJSON().hasCheckpoint).toBe(true);
    });
  });

  describe("Error code to category mapping", () => {
    const expectedMappings =
      canonicalSpec.errorHandling.ErrorCategory.codeToCategory;

    it("should map NETWORK_ERROR to network category", () => {
      expect(getErrorCategory(L0ErrorCodes.NETWORK_ERROR)).toBe(
        ErrorCategory.NETWORK,
      );
    });

    it("should map timeout codes to transient category", () => {
      expect(getErrorCategory(L0ErrorCodes.INITIAL_TOKEN_TIMEOUT)).toBe(
        ErrorCategory.TRANSIENT,
      );
      expect(getErrorCategory(L0ErrorCodes.INTER_TOKEN_TIMEOUT)).toBe(
        ErrorCategory.TRANSIENT,
      );
    });

    it("should map content quality codes to content category", () => {
      expect(getErrorCategory(L0ErrorCodes.GUARDRAIL_VIOLATION)).toBe(
        ErrorCategory.CONTENT,
      );
      expect(getErrorCategory(L0ErrorCodes.FATAL_GUARDRAIL_VIOLATION)).toBe(
        ErrorCategory.CONTENT,
      );
      expect(getErrorCategory(L0ErrorCodes.DRIFT_DETECTED)).toBe(
        ErrorCategory.CONTENT,
      );
      expect(getErrorCategory(L0ErrorCodes.ZERO_OUTPUT)).toBe(
        ErrorCategory.CONTENT,
      );
    });

    it("should map internal codes to internal category", () => {
      expect(getErrorCategory(L0ErrorCodes.INVALID_STREAM)).toBe(
        ErrorCategory.INTERNAL,
      );
      expect(getErrorCategory(L0ErrorCodes.ADAPTER_NOT_FOUND)).toBe(
        ErrorCategory.INTERNAL,
      );
      expect(getErrorCategory(L0ErrorCodes.FEATURE_NOT_ENABLED)).toBe(
        ErrorCategory.INTERNAL,
      );
    });

    it("should map provider codes to provider category", () => {
      expect(getErrorCategory(L0ErrorCodes.STREAM_ABORTED)).toBe(
        ErrorCategory.PROVIDER,
      );
      expect(getErrorCategory(L0ErrorCodes.ALL_STREAMS_EXHAUSTED)).toBe(
        ErrorCategory.PROVIDER,
      );
    });
  });

  describe("All error codes exist", () => {
    const specErrorCodes = Object.keys(
      canonicalSpec.errorHandling.L0ErrorCodes.values,
    );

    for (const code of specErrorCodes) {
      it(`should have error code: ${code}`, () => {
        expect(L0ErrorCodes).toHaveProperty(code);
      });
    }
  });
});

// ============================================================================
// Network Error Classification Tests
// ============================================================================

describe("Canonical Spec: Network Error Classification", () => {
  const networkErrorTypes = canonicalSpec.networkErrorTypes.types;

  describe("connection_dropped detection", () => {
    const patterns = networkErrorTypes.connection_dropped.detection;

    for (const pattern of patterns) {
      it(`should detect "${pattern}"`, () => {
        const error = new Error(`Network: ${pattern}`);
        const analysis = analyzeNetworkError(error);
        expect(analysis.type).toBe(NetworkErrorType.CONNECTION_DROPPED);
        expect(analysis.retryable).toBe(true);
        expect(analysis.countsTowardLimit).toBe(false);
      });
    }
  });

  describe("dns_error detection", () => {
    const patterns = networkErrorTypes.dns_error.detection;

    for (const pattern of patterns) {
      it(`should detect "${pattern}"`, () => {
        const error = new Error(`DNS error: ${pattern}`);
        const analysis = analyzeNetworkError(error);
        expect(analysis.type).toBe(NetworkErrorType.DNS_ERROR);
        expect(analysis.retryable).toBe(true);
      });
    }
  });

  describe("ssl_error detection", () => {
    const patterns = networkErrorTypes.ssl_error.detection;

    for (const pattern of patterns) {
      it(`should detect "${pattern}" and mark as non-retryable`, () => {
        const error = new Error(`SSL error: ${pattern}`);
        const analysis = analyzeNetworkError(error);
        expect(analysis.type).toBe(NetworkErrorType.SSL_ERROR);
        expect(analysis.retryable).toBe(false);
      });
    }
  });

  describe("timeout detection", () => {
    const patterns = networkErrorTypes.timeout.detection;

    for (const pattern of patterns) {
      it(`should detect "${pattern}"`, () => {
        const error = new Error(`Request ${pattern}`);
        const analysis = analyzeNetworkError(error);
        expect(analysis.type).toBe(NetworkErrorType.TIMEOUT);
        expect(analysis.retryable).toBe(true);
      });
    }
  });

  describe("fetch_error detection", () => {
    it("should detect TypeError with fetch message", () => {
      const error = new TypeError("Failed to fetch");
      const analysis = analyzeNetworkError(error);
      expect(analysis.type).toBe(NetworkErrorType.FETCH_ERROR);
      expect(analysis.retryable).toBe(true);
    });

    it("should detect network request failed", () => {
      const error = new TypeError("Network request failed");
      const analysis = analyzeNetworkError(error);
      expect(analysis.type).toBe(NetworkErrorType.FETCH_ERROR);
      expect(analysis.retryable).toBe(true);
    });
  });

  describe("isNetworkError utility", () => {
    it("should return true for network errors", () => {
      expect(isNetworkError(new Error("connection dropped"))).toBe(true);
      expect(isNetworkError(new Error("econnreset"))).toBe(true);
      expect(isNetworkError(new Error("dns lookup failed"))).toBe(true);
      expect(isNetworkError(new Error("request timeout"))).toBe(true);
    });

    it("should return false for non-network errors", () => {
      expect(isNetworkError(new Error("Invalid JSON"))).toBe(false);
      expect(isNetworkError(new Error("Schema validation failed"))).toBe(false);
    });
  });
});

// ============================================================================
// Observability Event Tests
// ============================================================================

describe("Canonical Spec: Observability Events", () => {
  describe("EventType enum completeness", () => {
    const specEvents = Object.keys(
      canonicalSpec.monitoring.observabilityEvents.events,
    );

    for (const eventType of specEvents) {
      it(`should have EventType.${eventType}`, () => {
        expect(EventType).toHaveProperty(eventType);
        expect((EventType as Record<string, string>)[eventType]).toBe(
          eventType,
        );
      });
    }
  });

  describe("Event type values match keys", () => {
    // EventType values should equal their keys (e.g., EventType.SESSION_START === "SESSION_START")
    const eventTypes = [
      "SESSION_START",
      "ATTEMPT_START",
      "FALLBACK_START",
      "RETRY_ATTEMPT",
      "ERROR",
      "COMPLETE",
      "CHECKPOINT_SAVED",
      "RESUME_START",
      "ABORT_COMPLETED",
      "GUARDRAIL_RULE_RESULT",
      "TIMEOUT_TRIGGERED",
    ];

    for (const type of eventTypes) {
      it(`EventType.${type} should equal "${type}"`, () => {
        expect((EventType as Record<string, string>)[type]).toBe(type);
      });
    }
  });
});

// ============================================================================
// Callback Specification Tests
// ============================================================================

describe("Canonical Spec: Callbacks", () => {
  const callbacks = canonicalSpec.callbacks.callbacks;

  it("should document onStart callback triggers", () => {
    expect(callbacks.onStart.triggeredBy).toContain("SESSION_START");
    expect(callbacks.onStart.triggeredBy).toContain("ATTEMPT_START");
    expect(callbacks.onStart.triggeredBy).toContain("FALLBACK_START");
  });

  it("should document onComplete callback triggers", () => {
    expect(callbacks.onComplete.triggeredBy).toContain("COMPLETE");
  });

  it("should document onError callback triggers", () => {
    expect(callbacks.onError.triggeredBy).toContain("ERROR");
  });

  it("should document onRetry callback triggers", () => {
    expect(callbacks.onRetry.triggeredBy).toContain("RETRY_ATTEMPT");
  });

  it("should document onFallback callback triggers", () => {
    expect(callbacks.onFallback.triggeredBy).toContain("FALLBACK_START");
  });
});

// ============================================================================
// Callback Parameter Schema Tests
// ============================================================================

describe("Canonical Spec: Callback Parameter Schemas", () => {
  const callbacks = canonicalSpec.callbacks.callbacks;

  // Helper to validate parameter schema structure
  interface ParameterSchema {
    name: string;
    type: string;
    required: boolean;
    description: string;
    enum?: string[];
    shape?: Record<string, unknown>;
  }

  function validateParameterSchema(param: ParameterSchema) {
    expect(param.name).toBeDefined();
    expect(typeof param.name).toBe("string");
    expect(param.name.length).toBeGreaterThan(0);

    expect(param.type).toBeDefined();
    expect(typeof param.type).toBe("string");

    expect(typeof param.required).toBe("boolean");

    expect(param.description).toBeDefined();
    expect(typeof param.description).toBe("string");
    expect(param.description.length).toBeGreaterThan(0);
  }

  /**
   * Validates that a callback has exactly the specified parameters (no more, no less)
   */
  function validateExactParameters(
    params: ParameterSchema[],
    expectedParams: Array<{ name: string; type: string }>,
  ) {
    // Must have exact count
    expect(params.length).toBe(expectedParams.length);

    // Each expected param must exist with correct type
    for (const expected of expectedParams) {
      const param = params.find((p) => p.name === expected.name);
      expect(param, `Missing parameter: ${expected.name}`).toBeDefined();
      expect(param!.type).toBe(expected.type);
    }

    // No extra params allowed
    const expectedNames = expectedParams.map((p) => p.name);
    for (const param of params) {
      expect(expectedNames, `Unexpected parameter: ${param.name}`).toContain(
        param.name,
      );
    }
  }

  describe("All callbacks have parameter schemas", () => {
    const callbackNames = Object.keys(callbacks);

    for (const name of callbackNames) {
      it(`${name} should have parameters array`, () => {
        const callback = callbacks[name as keyof typeof callbacks];
        expect(callback.parameters).toBeDefined();
        expect(Array.isArray(callback.parameters)).toBe(true);
        expect(callback.parameters.length).toBeGreaterThan(0);
      });
    }
  });

  describe("onStart parameter schema", () => {
    const params = callbacks.onStart.parameters as ParameterSchema[];

    it("should have exactly these parameters: attempt, isRetry, isFallback", () => {
      validateExactParameters(params, [
        { name: "attempt", type: "number" },
        { name: "isRetry", type: "boolean" },
        { name: "isFallback", type: "boolean" },
      ]);
    });

    it("all parameters should be required", () => {
      for (const param of params) {
        expect(param.required, `${param.name} should be required`).toBe(true);
      }
    });
  });

  describe("onComplete parameter schema", () => {
    const params = callbacks.onComplete.parameters as ParameterSchema[];

    it("should have exactly these parameters: state", () => {
      validateExactParameters(params, [{ name: "state", type: "L0State" }]);
    });

    it("state should have required shape properties", () => {
      const param = params.find((p) => p.name === "state");
      expect(param!.shape).toBeDefined();
      expect(param!.shape!.content).toBeDefined();
      expect(param!.shape!.tokenCount).toBeDefined();
      expect(param!.shape!.checkpoint).toBeDefined();
    });
  });

  describe("onError parameter schema", () => {
    const params = callbacks.onError.parameters as ParameterSchema[];

    it("should have exactly these parameters: error, willRetry, willFallback", () => {
      validateExactParameters(params, [
        { name: "error", type: "L0Error" },
        { name: "willRetry", type: "boolean" },
        { name: "willFallback", type: "boolean" },
      ]);
    });

    it("error should have required shape properties", () => {
      const param = params.find((p) => p.name === "error");
      expect(param!.shape).toBeDefined();
      expect(param!.shape!.message).toBeDefined();
      expect(param!.shape!.code).toBeDefined();
      expect(param!.shape!.category).toBeDefined();
    });

    it("all parameters should be required", () => {
      for (const param of params) {
        expect(param.required, `${param.name} should be required`).toBe(true);
      }
    });
  });

  describe("onRetry parameter schema", () => {
    const params = callbacks.onRetry.parameters as ParameterSchema[];

    it("should have exactly these parameters: attempt, reason", () => {
      validateExactParameters(params, [
        { name: "attempt", type: "number" },
        { name: "reason", type: "string" },
      ]);
    });

    it("all parameters should be required", () => {
      for (const param of params) {
        expect(param.required, `${param.name} should be required`).toBe(true);
      }
    });
  });

  describe("onFallback parameter schema", () => {
    const params = callbacks.onFallback.parameters as ParameterSchema[];

    it("should have exactly these parameters: index, reason", () => {
      validateExactParameters(params, [
        { name: "index", type: "number" },
        { name: "reason", type: "string" },
      ]);
    });

    it("all parameters should be required", () => {
      for (const param of params) {
        expect(param.required, `${param.name} should be required`).toBe(true);
      }
    });
  });

  describe("onCheckpoint parameter schema", () => {
    const params = callbacks.onCheckpoint.parameters as ParameterSchema[];

    it("should have exactly these parameters: checkpoint, tokenCount", () => {
      validateExactParameters(params, [
        { name: "checkpoint", type: "string" },
        { name: "tokenCount", type: "number" },
      ]);
    });

    it("all parameters should be required", () => {
      for (const param of params) {
        expect(param.required, `${param.name} should be required`).toBe(true);
      }
    });
  });

  describe("onResume parameter schema", () => {
    const params = callbacks.onResume.parameters as ParameterSchema[];

    it("should have exactly these parameters: checkpoint, tokenCount", () => {
      validateExactParameters(params, [
        { name: "checkpoint", type: "string" },
        { name: "tokenCount", type: "number" },
      ]);
    });

    it("all parameters should be required", () => {
      for (const param of params) {
        expect(param.required, `${param.name} should be required`).toBe(true);
      }
    });
  });

  describe("onAbort parameter schema", () => {
    const params = callbacks.onAbort.parameters as ParameterSchema[];

    it("should have exactly these parameters: tokenCount, contentLength", () => {
      validateExactParameters(params, [
        { name: "tokenCount", type: "number" },
        { name: "contentLength", type: "number" },
      ]);
    });

    it("all parameters should be required", () => {
      for (const param of params) {
        expect(param.required, `${param.name} should be required`).toBe(true);
      }
    });
  });

  describe("onTimeout parameter schema", () => {
    const params = callbacks.onTimeout.parameters as ParameterSchema[];

    it("should have exactly these parameters: type, elapsedMs", () => {
      validateExactParameters(params, [
        { name: "type", type: "string" },
        { name: "elapsedMs", type: "number" },
      ]);
    });

    it("type should have enum constraint", () => {
      const param = params.find((p) => p.name === "type");
      expect(param!.enum).toBeDefined();
      expect(param!.enum).toContain("initial");
      expect(param!.enum).toContain("inter");
      expect(param!.enum!.length).toBe(2); // Only these two values allowed
    });

    it("all parameters should be required", () => {
      for (const param of params) {
        expect(param.required, `${param.name} should be required`).toBe(true);
      }
    });
  });

  describe("onViolation parameter schema", () => {
    const params = callbacks.onViolation.parameters as ParameterSchema[];

    it("should have exactly these parameters: violation", () => {
      validateExactParameters(params, [
        { name: "violation", type: "GuardrailViolation" },
      ]);
    });

    it("violation should have required shape properties", () => {
      const param = params.find((p) => p.name === "violation");
      expect(param!.shape).toBeDefined();
      expect(param!.shape!.ruleId).toBeDefined();
      expect(param!.shape!.message).toBeDefined();
      expect(param!.shape!.severity).toBeDefined();
    });
  });

  describe("onDrift parameter schema", () => {
    const params = callbacks.onDrift.parameters as ParameterSchema[];

    it("should have exactly these parameters: types, confidence", () => {
      validateExactParameters(params, [
        { name: "types", type: "string[]" },
        { name: "confidence", type: "number" },
      ]);
    });

    it("types should be required, confidence should be optional", () => {
      const typesParam = params.find((p) => p.name === "types");
      const confidenceParam = params.find((p) => p.name === "confidence");
      expect(typesParam!.required).toBe(true);
      expect(confidenceParam!.required).toBe(false);
    });
  });

  describe("onToolCall parameter schema", () => {
    const params = callbacks.onToolCall.parameters as ParameterSchema[];

    it("should have exactly these parameters: toolName, toolCallId, args", () => {
      validateExactParameters(params, [
        { name: "toolName", type: "string" },
        { name: "toolCallId", type: "string" },
        { name: "args", type: "Record<string, unknown>" },
      ]);
    });

    it("all parameters should be required", () => {
      for (const param of params) {
        expect(param.required, `${param.name} should be required`).toBe(true);
      }
    });
  });
});

// ============================================================================
// Lifecycle Invariants Tests
// ============================================================================

describe("Canonical Spec: Lifecycle Invariants", () => {
  const invariants = canonicalSpec.lifecycleInvariants.invariants;

  it("should document all critical invariants", () => {
    const invariantIds = invariants.map((i: { id: string }) => i.id);

    expect(invariantIds).toContain("session-start-once");
    expect(invariantIds).toContain("attempt-start-retries-only");
    expect(invariantIds).toContain("fallback-not-attempt");
    expect(invariantIds).toContain("retry-precedes-attempt");
    expect(invariantIds).toContain("timestamps-monotonic");
    expect(invariantIds).toContain("stream-id-consistent");
    expect(invariantIds).toContain("context-immutable");
    expect(invariantIds).toContain("context-propagated");
  });

  for (const invariant of invariants) {
    it(`invariant "${invariant.id}" has rule and rationale`, () => {
      expect(invariant.rule).toBeDefined();
      expect(invariant.rule.length).toBeGreaterThan(0);
      expect(invariant.rationale).toBeDefined();
      expect(invariant.rationale.length).toBeGreaterThan(0);
    });
  }
});

/**
 * Export canonical spec for Python test runner to consume
 */
export { canonicalSpec };
