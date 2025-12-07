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
      const error = new L0Error("Timeout error", {
        code: L0ErrorCodes.INITIAL_TOKEN_TIMEOUT,
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

  it("should document onCheckpoint callback triggers", () => {
    expect(callbacks.onCheckpoint.triggeredBy).toContain("CHECKPOINT_SAVED");
  });

  it("should document onResume callback triggers", () => {
    expect(callbacks.onResume.triggeredBy).toContain("RESUME_START");
  });

  it("should document onAbort callback triggers", () => {
    expect(callbacks.onAbort.triggeredBy).toContain("ABORT_COMPLETED");
  });

  it("should document onTimeout callback triggers", () => {
    expect(callbacks.onTimeout.triggeredBy).toContain("TIMEOUT_TRIGGERED");
  });

  it("should document onViolation callback triggers", () => {
    expect(callbacks.onViolation.triggeredBy.length).toBeGreaterThan(0);
  });

  it("should document onDrift callback triggers", () => {
    expect(callbacks.onDrift.triggeredBy).toContain("DRIFT_CHECK_RESULT");
  });

  it("should document onToolCall callback triggers", () => {
    expect(callbacks.onToolCall.triggeredBy).toContain("TOOL_REQUESTED");
  });

  describe("triggeredBy references valid events", () => {
    const events = canonicalSpec.monitoring.observabilityEvents.events;
    const validEventTypes = Object.keys(events);

    const callbackNames = Object.keys(callbacks);

    for (const callbackName of callbackNames) {
      const callback = callbacks[callbackName as keyof typeof callbacks];

      it(`${callbackName}.triggeredBy should reference valid events`, () => {
        expect(callback.triggeredBy).toBeDefined();
        expect(Array.isArray(callback.triggeredBy)).toBe(true);
        expect(callback.triggeredBy.length).toBeGreaterThan(0);

        for (const trigger of callback.triggeredBy) {
          // Handle special case like "GUARDRAIL_RULE_RESULT (when passed=false)"
          const baseTrigger = trigger.split(" ")[0];
          expect(
            validEventTypes,
            `${callbackName}.triggeredBy contains invalid event: ${trigger}`,
          ).toContain(baseTrigger);
        }
      });
    }
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
// Observability Event Field Schema Tests
// ============================================================================

describe("Canonical Spec: Observability Event Field Schemas", () => {
  const events = canonicalSpec.monitoring.observabilityEvents.events;
  const baseShape = canonicalSpec.monitoring.observabilityEvents.baseShape;

  // Helper to validate event field schema structure
  interface FieldSchema {
    name: string;
    type: string;
    required: boolean;
    description: string;
    enum?: string[];
  }

  function validateFieldSchema(field: FieldSchema) {
    expect(field.name).toBeDefined();
    expect(typeof field.name).toBe("string");
    expect(field.name.length).toBeGreaterThan(0);

    expect(field.type).toBeDefined();
    expect(typeof field.type).toBe("string");

    expect(typeof field.required).toBe("boolean");

    expect(field.description).toBeDefined();
    expect(typeof field.description).toBe("string");
    expect(field.description.length).toBeGreaterThan(0);
  }

  /**
   * Validates that an event has exactly the specified fields (no more, no less)
   */
  function validateExactFields(
    fields: FieldSchema[],
    expectedFields: Array<{ name: string; type: string; required?: boolean }>,
  ) {
    // Must have exact count
    expect(fields.length).toBe(expectedFields.length);

    // Each expected field must exist with correct type
    for (const expected of expectedFields) {
      const field = fields.find((f) => f.name === expected.name);
      expect(field, `Missing field: ${expected.name}`).toBeDefined();
      expect(field!.type).toBe(expected.type);
      if (expected.required !== undefined) {
        expect(field!.required).toBe(expected.required);
      }
    }

    // No extra fields allowed
    const expectedNames = expectedFields.map((f) => f.name);
    for (const field of fields) {
      expect(expectedNames, `Unexpected field: ${field.name}`).toContain(
        field.name,
      );
    }
  }

  describe("Base shape fields", () => {
    it("should have required base fields: type, ts, streamId", () => {
      expect(baseShape.type).toBeDefined();
      expect(baseShape.type.required).toBe(true);
      expect(baseShape.type.type).toBe("EventType");

      expect(baseShape.ts).toBeDefined();
      expect(baseShape.ts.required).toBe(true);
      expect(baseShape.ts.type).toBe("number");

      expect(baseShape.streamId).toBeDefined();
      expect(baseShape.streamId.required).toBe(true);
      expect(baseShape.streamId.type).toBe("string");
    });

    it("should have optional context field", () => {
      expect(baseShape.context).toBeDefined();
      expect(baseShape.context.required).toBe(false);
      expect(baseShape.context.type).toBe("Record<string, unknown>");
    });
  });

  describe("All events have fields array", () => {
    const eventNames = Object.keys(events);

    for (const name of eventNames) {
      it(`${name} should have fields array`, () => {
        const event = events[name as keyof typeof events];
        expect(event.fields).toBeDefined();
        expect(Array.isArray(event.fields)).toBe(true);
      });
    }
  });

  // Session Events
  describe("SESSION_START field schema", () => {
    const fields = events.SESSION_START.fields as FieldSchema[];

    it("should have exactly these fields: attempt, isRetry, isFallback", () => {
      validateExactFields(fields, [
        { name: "attempt", type: "number", required: true },
        { name: "isRetry", type: "boolean", required: true },
        { name: "isFallback", type: "boolean", required: true },
      ]);
    });

    it("all fields should have valid schema", () => {
      for (const field of fields) {
        validateFieldSchema(field);
      }
    });
  });

  describe("STREAM_INIT field schema", () => {
    const fields = events.STREAM_INIT.fields as FieldSchema[];

    it("should have no additional fields", () => {
      validateExactFields(fields, []);
    });
  });

  describe("STREAM_READY field schema", () => {
    const fields = events.STREAM_READY.fields as FieldSchema[];

    it("should have no additional fields", () => {
      validateExactFields(fields, []);
    });
  });

  describe("SESSION_END field schema", () => {
    const fields = events.SESSION_END.fields as FieldSchema[];

    it("should have no additional fields", () => {
      validateExactFields(fields, []);
    });
  });

  describe("SESSION_SUMMARY field schema", () => {
    const fields = events.SESSION_SUMMARY.fields as FieldSchema[];

    it("should have exactly these fields", () => {
      validateExactFields(fields, [
        { name: "tokenCount", type: "number", required: true },
        { name: "startTs", type: "number", required: true },
        { name: "endTs", type: "number", required: true },
        { name: "driftDetected", type: "boolean", required: true },
        { name: "guardrailViolations", type: "number", required: true },
        { name: "fallbackDepth", type: "number", required: true },
        { name: "retryCount", type: "number", required: true },
        { name: "checkpointsCreated", type: "number", required: true },
      ]);
    });
  });

  // Adapter Events
  describe("ADAPTER_WRAP_START field schema", () => {
    const fields = events.ADAPTER_WRAP_START.fields as FieldSchema[];

    it("should have exactly these fields: streamType", () => {
      validateExactFields(fields, [
        { name: "streamType", type: "string", required: true },
      ]);
    });
  });

  describe("ADAPTER_DETECTED field schema", () => {
    const fields = events.ADAPTER_DETECTED.fields as FieldSchema[];

    it("should have exactly these fields: adapterId", () => {
      validateExactFields(fields, [
        { name: "adapterId", type: "string", required: true },
      ]);
    });
  });

  describe("ADAPTER_WRAP_END field schema", () => {
    const fields = events.ADAPTER_WRAP_END.fields as FieldSchema[];

    it("should have exactly these fields: adapterId, success", () => {
      validateExactFields(fields, [
        { name: "adapterId", type: "string", required: true },
        { name: "success", type: "boolean", required: true },
      ]);
    });
  });

  // Timeout Events
  describe("TIMEOUT_START field schema", () => {
    const fields = events.TIMEOUT_START.fields as FieldSchema[];

    it("should have exactly these fields: timeoutType, configuredMs", () => {
      validateExactFields(fields, [
        { name: "timeoutType", type: "string", required: true },
        { name: "configuredMs", type: "number", required: true },
      ]);
    });

    it("timeoutType should have enum constraint", () => {
      const field = fields.find((f) => f.name === "timeoutType");
      expect(field!.enum).toBeDefined();
      expect(field!.enum).toContain("initial");
      expect(field!.enum).toContain("inter");
      expect(field!.enum!.length).toBe(2);
    });
  });

  describe("TIMEOUT_RESET field schema", () => {
    const fields = events.TIMEOUT_RESET.fields as FieldSchema[];

    it("should have exactly these fields: configuredMs", () => {
      validateExactFields(fields, [
        { name: "configuredMs", type: "number", required: true },
      ]);
    });
  });

  describe("TIMEOUT_TRIGGERED field schema", () => {
    const fields = events.TIMEOUT_TRIGGERED.fields as FieldSchema[];

    it("should have exactly these fields: timeoutType, elapsedMs, configuredMs", () => {
      validateExactFields(fields, [
        { name: "timeoutType", type: "string", required: true },
        { name: "elapsedMs", type: "number", required: true },
        { name: "configuredMs", type: "number", required: true },
      ]);
    });

    it("timeoutType should have enum constraint", () => {
      const field = fields.find((f) => f.name === "timeoutType");
      expect(field!.enum).toBeDefined();
      expect(field!.enum).toContain("initial");
      expect(field!.enum).toContain("inter");
      expect(field!.enum!.length).toBe(2);
    });
  });

  // Network Events
  describe("NETWORK_RECOVERY field schema", () => {
    const fields = events.NETWORK_RECOVERY.fields as FieldSchema[];

    it("should have exactly these fields: attemptCount, durationMs", () => {
      validateExactFields(fields, [
        { name: "attemptCount", type: "number", required: true },
        { name: "durationMs", type: "number", required: true },
      ]);
    });
  });

  describe("CONNECTION_DROPPED field schema", () => {
    const fields = events.CONNECTION_DROPPED.fields as FieldSchema[];

    it("should have exactly these fields: reason", () => {
      validateExactFields(fields, [
        { name: "reason", type: "string", required: true },
      ]);
    });
  });

  describe("CONNECTION_RESTORED field schema", () => {
    const fields = events.CONNECTION_RESTORED.fields as FieldSchema[];

    it("should have exactly these fields: durationMs", () => {
      validateExactFields(fields, [
        { name: "durationMs", type: "number", required: true },
      ]);
    });
  });

  // Abort Events
  describe("ABORT_REQUESTED field schema", () => {
    const fields = events.ABORT_REQUESTED.fields as FieldSchema[];

    it("should have exactly these fields: source", () => {
      validateExactFields(fields, [
        { name: "source", type: "string", required: true },
      ]);
    });

    it("source should have enum constraint", () => {
      const field = fields.find((f) => f.name === "source");
      expect(field!.enum).toBeDefined();
      expect(field!.enum).toContain("user");
      expect(field!.enum).toContain("timeout");
      expect(field!.enum).toContain("error");
      expect(field!.enum!.length).toBe(3);
    });
  });

  describe("ABORT_COMPLETED field schema", () => {
    const fields = events.ABORT_COMPLETED.fields as FieldSchema[];

    it("should have exactly these fields: tokenCount, contentLength", () => {
      validateExactFields(fields, [
        { name: "tokenCount", type: "number", required: true },
        { name: "contentLength", type: "number", required: true },
      ]);
    });
  });

  // Tool Events
  describe("TOOL_REQUESTED field schema", () => {
    const fields = events.TOOL_REQUESTED.fields as FieldSchema[];

    it("should have exactly these fields: toolName, toolCallId, arguments", () => {
      validateExactFields(fields, [
        { name: "toolName", type: "string", required: true },
        { name: "toolCallId", type: "string", required: true },
        { name: "arguments", type: "Record<string, unknown>", required: true },
      ]);
    });
  });

  describe("TOOL_START field schema", () => {
    const fields = events.TOOL_START.fields as FieldSchema[];

    it("should have exactly these fields: toolCallId, toolName", () => {
      validateExactFields(fields, [
        { name: "toolCallId", type: "string", required: true },
        { name: "toolName", type: "string", required: true },
      ]);
    });
  });

  describe("TOOL_RESULT field schema", () => {
    const fields = events.TOOL_RESULT.fields as FieldSchema[];

    it("should have exactly these fields: toolCallId, result, durationMs", () => {
      validateExactFields(fields, [
        { name: "toolCallId", type: "string", required: true },
        { name: "result", type: "unknown", required: true },
        { name: "durationMs", type: "number", required: true },
      ]);
    });
  });

  describe("TOOL_ERROR field schema", () => {
    const fields = events.TOOL_ERROR.fields as FieldSchema[];

    it("should have exactly these fields: toolCallId, error, durationMs", () => {
      validateExactFields(fields, [
        { name: "toolCallId", type: "string", required: true },
        { name: "error", type: "string", required: true },
        { name: "durationMs", type: "number", required: true },
      ]);
    });
  });

  describe("TOOL_COMPLETED field schema", () => {
    const fields = events.TOOL_COMPLETED.fields as FieldSchema[];

    it("should have exactly these fields: toolCallId, status", () => {
      validateExactFields(fields, [
        { name: "toolCallId", type: "string", required: true },
        { name: "status", type: "string", required: true },
      ]);
    });

    it("status should have enum constraint", () => {
      const field = fields.find((f) => f.name === "status");
      expect(field!.enum).toBeDefined();
      expect(field!.enum).toContain("success");
      expect(field!.enum).toContain("error");
      expect(field!.enum!.length).toBe(2);
    });
  });

  // Guardrail Events
  describe("GUARDRAIL_PHASE_START field schema", () => {
    const fields = events.GUARDRAIL_PHASE_START.fields as FieldSchema[];

    it("should have exactly these fields: phase, ruleCount", () => {
      validateExactFields(fields, [
        { name: "phase", type: "string", required: true },
        { name: "ruleCount", type: "number", required: true },
      ]);
    });

    it("phase should have enum constraint", () => {
      const field = fields.find((f) => f.name === "phase");
      expect(field!.enum).toBeDefined();
      expect(field!.enum).toContain("pre");
      expect(field!.enum).toContain("post");
      expect(field!.enum!.length).toBe(2);
    });
  });

  describe("GUARDRAIL_RULE_START field schema", () => {
    const fields = events.GUARDRAIL_RULE_START.fields as FieldSchema[];

    it("should have exactly these fields: index, ruleId", () => {
      validateExactFields(fields, [
        { name: "index", type: "number", required: true },
        { name: "ruleId", type: "string", required: true },
      ]);
    });
  });

  describe("GUARDRAIL_RULE_RESULT field schema", () => {
    const fields = events.GUARDRAIL_RULE_RESULT.fields as FieldSchema[];

    it("should have exactly these fields: index, ruleId, passed, violation", () => {
      validateExactFields(fields, [
        { name: "index", type: "number", required: true },
        { name: "ruleId", type: "string", required: true },
        { name: "passed", type: "boolean", required: true },
        { name: "violation", type: "GuardrailViolation", required: false },
      ]);
    });
  });

  describe("GUARDRAIL_RULE_END field schema", () => {
    const fields = events.GUARDRAIL_RULE_END.fields as FieldSchema[];

    it("should have exactly these fields: index, ruleId, passed", () => {
      validateExactFields(fields, [
        { name: "index", type: "number", required: true },
        { name: "ruleId", type: "string", required: true },
        { name: "passed", type: "boolean", required: true },
      ]);
    });
  });

  describe("GUARDRAIL_PHASE_END field schema", () => {
    const fields = events.GUARDRAIL_PHASE_END.fields as FieldSchema[];

    it("should have exactly these fields: phase, passed, violations", () => {
      validateExactFields(fields, [
        { name: "phase", type: "string", required: true },
        { name: "passed", type: "boolean", required: true },
        { name: "violations", type: "GuardrailViolation[]", required: true },
      ]);
    });

    it("phase should have enum constraint", () => {
      const field = fields.find((f) => f.name === "phase");
      expect(field!.enum).toBeDefined();
      expect(field!.enum).toContain("pre");
      expect(field!.enum).toContain("post");
      expect(field!.enum!.length).toBe(2);
    });
  });

  describe("GUARDRAIL_CALLBACK_START field schema", () => {
    const fields = events.GUARDRAIL_CALLBACK_START.fields as FieldSchema[];

    it("should have exactly these fields: callbackId, index, ruleId", () => {
      validateExactFields(fields, [
        { name: "callbackId", type: "string", required: true },
        { name: "index", type: "number", required: true },
        { name: "ruleId", type: "string", required: true },
      ]);
    });
  });

  describe("GUARDRAIL_CALLBACK_END field schema", () => {
    const fields = events.GUARDRAIL_CALLBACK_END.fields as FieldSchema[];

    it("should have exactly these fields: callbackId, index, ruleId, durationMs, success, error", () => {
      validateExactFields(fields, [
        { name: "callbackId", type: "string", required: true },
        { name: "index", type: "number", required: true },
        { name: "ruleId", type: "string", required: true },
        { name: "durationMs", type: "number", required: true },
        { name: "success", type: "boolean", required: true },
        { name: "error", type: "string", required: false },
      ]);
    });
  });

  // Drift Events
  describe("DRIFT_CHECK_RESULT field schema", () => {
    const fields = events.DRIFT_CHECK_RESULT.fields as FieldSchema[];

    it("should have exactly these fields: detected, score, metrics, threshold", () => {
      validateExactFields(fields, [
        { name: "detected", type: "boolean", required: true },
        { name: "score", type: "number", required: true },
        { name: "metrics", type: "Record<string, unknown>", required: true },
        { name: "threshold", type: "number", required: true },
      ]);
    });
  });

  describe("DRIFT_CHECK_SKIPPED field schema", () => {
    const fields = events.DRIFT_CHECK_SKIPPED.fields as FieldSchema[];

    it("should have exactly these fields: reason", () => {
      validateExactFields(fields, [
        { name: "reason", type: "string", required: true },
      ]);
    });
  });

  // Checkpoint/Resume Events
  describe("CHECKPOINT_SAVED field schema", () => {
    const fields = events.CHECKPOINT_SAVED.fields as FieldSchema[];

    it("should have exactly these fields: checkpoint, tokenCount", () => {
      validateExactFields(fields, [
        { name: "checkpoint", type: "string", required: true },
        { name: "tokenCount", type: "number", required: true },
      ]);
    });
  });

  describe("RESUME_START field schema", () => {
    const fields = events.RESUME_START.fields as FieldSchema[];

    it("should have exactly these fields: checkpoint, tokenCount", () => {
      validateExactFields(fields, [
        { name: "checkpoint", type: "string", required: true },
        { name: "tokenCount", type: "number", required: true },
      ]);
    });
  });

  describe("CONTINUATION_START field schema", () => {
    const fields = events.CONTINUATION_START.fields as FieldSchema[];

    it("should have exactly these fields: checkpoint, tokenCount", () => {
      validateExactFields(fields, [
        { name: "checkpoint", type: "string", required: true },
        { name: "tokenCount", type: "number", required: true },
      ]);
    });
  });

  // Retry Events
  describe("ATTEMPT_START field schema", () => {
    const fields = events.ATTEMPT_START.fields as FieldSchema[];

    it("should have exactly these fields: attempt, isRetry, isFallback", () => {
      validateExactFields(fields, [
        { name: "attempt", type: "number", required: true },
        { name: "isRetry", type: "boolean", required: true },
        { name: "isFallback", type: "boolean", required: true },
      ]);
    });
  });

  describe("RETRY_START field schema", () => {
    const fields = events.RETRY_START.fields as FieldSchema[];

    it("should have exactly these fields: maxAttempts", () => {
      validateExactFields(fields, [
        { name: "maxAttempts", type: "number", required: true },
      ]);
    });
  });

  describe("RETRY_ATTEMPT field schema", () => {
    const fields = events.RETRY_ATTEMPT.fields as FieldSchema[];

    it("should have exactly these fields: attempt, maxAttempts, reason, delayMs", () => {
      validateExactFields(fields, [
        { name: "attempt", type: "number", required: true },
        { name: "maxAttempts", type: "number", required: true },
        { name: "reason", type: "string", required: true },
        { name: "delayMs", type: "number", required: true },
      ]);
    });
  });

  describe("RETRY_END field schema", () => {
    const fields = events.RETRY_END.fields as FieldSchema[];

    it("should have exactly these fields: attempt, success", () => {
      validateExactFields(fields, [
        { name: "attempt", type: "number", required: true },
        { name: "success", type: "boolean", required: true },
      ]);
    });
  });

  describe("RETRY_GIVE_UP field schema", () => {
    const fields = events.RETRY_GIVE_UP.fields as FieldSchema[];

    it("should have exactly these fields: attempt, maxAttempts, reason", () => {
      validateExactFields(fields, [
        { name: "attempt", type: "number", required: true },
        { name: "maxAttempts", type: "number", required: true },
        { name: "reason", type: "string", required: true },
      ]);
    });
  });

  // Fallback Events
  describe("FALLBACK_START field schema", () => {
    const fields = events.FALLBACK_START.fields as FieldSchema[];

    it("should have exactly these fields: fromIndex, toIndex", () => {
      validateExactFields(fields, [
        { name: "fromIndex", type: "number", required: true },
        { name: "toIndex", type: "number", required: true },
      ]);
    });
  });

  describe("FALLBACK_MODEL_SELECTED field schema", () => {
    const fields = events.FALLBACK_MODEL_SELECTED.fields as FieldSchema[];

    it("should have exactly these fields: index, reason", () => {
      validateExactFields(fields, [
        { name: "index", type: "number", required: true },
        { name: "reason", type: "string", required: true },
      ]);
    });
  });

  describe("FALLBACK_END field schema", () => {
    const fields = events.FALLBACK_END.fields as FieldSchema[];

    it("should have exactly these fields: success, finalIndex", () => {
      validateExactFields(fields, [
        { name: "success", type: "boolean", required: true },
        { name: "finalIndex", type: "number", required: true },
      ]);
    });
  });

  // Completion Events
  describe("ERROR field schema", () => {
    const fields = events.ERROR.fields as FieldSchema[];

    it("should have exactly these fields: error, errorCode, failureType, recoveryStrategy, policy", () => {
      validateExactFields(fields, [
        { name: "error", type: "string", required: true },
        { name: "errorCode", type: "string", required: false },
        { name: "failureType", type: "FailureType", required: true },
        { name: "recoveryStrategy", type: "RecoveryStrategy", required: true },
        { name: "policy", type: "RecoveryPolicy", required: true },
      ]);
    });
  });

  describe("COMPLETE field schema", () => {
    const fields = events.COMPLETE.fields as FieldSchema[];

    it("should have exactly these fields: tokenCount, contentLength, state", () => {
      validateExactFields(fields, [
        { name: "tokenCount", type: "number", required: true },
        { name: "contentLength", type: "number", required: true },
        { name: "state", type: "L0State", required: false },
      ]);
    });
  });

  // Structured Output Events
  describe("STRUCTURED_PARSE_START field schema", () => {
    const fields = events.STRUCTURED_PARSE_START.fields as FieldSchema[];

    it("should have exactly these fields: contentLength", () => {
      validateExactFields(fields, [
        { name: "contentLength", type: "number", required: true },
      ]);
    });
  });

  describe("STRUCTURED_PARSE_END field schema", () => {
    const fields = events.STRUCTURED_PARSE_END.fields as FieldSchema[];

    it("should have exactly these fields: success, durationMs", () => {
      validateExactFields(fields, [
        { name: "success", type: "boolean", required: true },
        { name: "durationMs", type: "number", required: true },
      ]);
    });
  });

  describe("STRUCTURED_PARSE_ERROR field schema", () => {
    const fields = events.STRUCTURED_PARSE_ERROR.fields as FieldSchema[];

    it("should have exactly these fields: error, contentPreview", () => {
      validateExactFields(fields, [
        { name: "error", type: "string", required: true },
        { name: "contentPreview", type: "string", required: false },
      ]);
    });
  });

  describe("STRUCTURED_VALIDATION_START field schema", () => {
    const fields = events.STRUCTURED_VALIDATION_START.fields as FieldSchema[];

    it("should have exactly these fields: schemaName", () => {
      validateExactFields(fields, [
        { name: "schemaName", type: "string", required: false },
      ]);
    });
  });

  describe("STRUCTURED_VALIDATION_END field schema", () => {
    const fields = events.STRUCTURED_VALIDATION_END.fields as FieldSchema[];

    it("should have exactly these fields: valid, durationMs", () => {
      validateExactFields(fields, [
        { name: "valid", type: "boolean", required: true },
        { name: "durationMs", type: "number", required: true },
      ]);
    });
  });

  describe("STRUCTURED_VALIDATION_ERROR field schema", () => {
    const fields = events.STRUCTURED_VALIDATION_ERROR.fields as FieldSchema[];

    it("should have exactly these fields: errors", () => {
      validateExactFields(fields, [
        { name: "errors", type: "string[]", required: true },
      ]);
    });
  });

  describe("STRUCTURED_AUTO_CORRECT_START field schema", () => {
    const fields = events.STRUCTURED_AUTO_CORRECT_START.fields as FieldSchema[];

    it("should have exactly these fields: errorCount", () => {
      validateExactFields(fields, [
        { name: "errorCount", type: "number", required: true },
      ]);
    });
  });

  describe("STRUCTURED_AUTO_CORRECT_END field schema", () => {
    const fields = events.STRUCTURED_AUTO_CORRECT_END.fields as FieldSchema[];

    it("should have exactly these fields: success, correctionsMade, durationMs", () => {
      validateExactFields(fields, [
        { name: "success", type: "boolean", required: true },
        { name: "correctionsMade", type: "number", required: true },
        { name: "durationMs", type: "number", required: true },
      ]);
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
