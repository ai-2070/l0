// OpenTelemetry Integration Tests
// Run: OPENAI_API_KEY=sk-... npm run test:integration

import { describe, it, expect, vi, beforeEach } from "vitest";
import { describeIf, hasOpenAI, LLM_TIMEOUT } from "./setup";
import {
  L0OpenTelemetry,
  createOpenTelemetry,
  SemanticAttributes,
  SpanStatusCode,
  SpanKind,
} from "../src/runtime/opentelemetry";
import type { Span, SpanOptions, Attributes } from "@opentelemetry/api";
import { l0 } from "../src/runtime/l0";
import { streamText } from "ai";
import { openai } from "@ai-sdk/openai";

// Mock OpenTelemetry Span
function createMockSpan(): Span & {
  _events: Array<{ name: string; attributes?: Attributes }>;
  _attributes: Record<string, any>;
  _status?: { code: number; message?: string };
  _ended: boolean;
} {
  const spanData = {
    _events: [] as Array<{ name: string; attributes?: Attributes }>,
    _attributes: {} as Record<string, any>,
    _status: undefined as { code: number; message?: string } | undefined,
    _ended: false,
  };

  const mockSpan: Span & typeof spanData = {
    ...spanData,
    spanContext: () => ({
      traceId: "mock-trace-id",
      spanId: "mock-span-id",
      traceFlags: 1,
    }),
    setAttribute: function (key: string, value: any) {
      this._attributes[key] = value;
      return this;
    },
    setAttributes: function (attrs: Record<string, any>) {
      Object.assign(this._attributes, attrs);
      return this;
    },
    addEvent: function (name: string, attributes?: Attributes) {
      this._events.push({ name, attributes });
      return this;
    },
    addLink: function () {
      return this;
    },
    addLinks: function () {
      return this;
    },
    setStatus: function (status: { code: number; message?: string }) {
      this._status = status;
      return this;
    },
    updateName: function () {
      return this;
    },
    recordException: function (exception: any) {
      this._events.push({
        name: "exception",
        attributes: { message: exception?.message || String(exception) },
      });
    },
    end: function () {
      this._ended = true;
    },
    isRecording: function () {
      return !this._ended;
    },
  };

  return mockSpan;
}

// Mock OpenTelemetry Tracer
function createMockTracer() {
  const spans: ReturnType<typeof createMockSpan>[] = [];

  return {
    _spans: spans,
    startSpan: vi.fn((name: string, _options?: SpanOptions) => {
      const span = createMockSpan();
      span._attributes["span.name"] = name;
      spans.push(span);
      return span;
    }),
    startActiveSpan: vi.fn(
      <F extends (span: Span) => unknown>(
        name: string,
        optionsOrFn: SpanOptions | F,
        fnOrUndefined?: F,
      ): ReturnType<F> => {
        const fn =
          typeof optionsOrFn === "function" ? optionsOrFn : fnOrUndefined!;
        const span = createMockSpan();
        span._attributes["span.name"] = name;
        spans.push(span);
        return fn(span) as ReturnType<F>;
      },
    ),
  };
}

describe("OpenTelemetry Integration", () => {
  describe("L0OpenTelemetry Class", () => {
    let mockTracer: ReturnType<typeof createMockTracer>;
    let otel: L0OpenTelemetry;

    beforeEach(() => {
      mockTracer = createMockTracer();
      otel = new L0OpenTelemetry({
        tracer: mockTracer as any,
      });
    });

    it("should create L0OpenTelemetry instance", () => {
      expect(otel).toBeInstanceOf(L0OpenTelemetry);
    });

    it("should create instance with tracer only", () => {
      const tracerOnly = new L0OpenTelemetry({ tracer: mockTracer as any });
      expect(tracerOnly).toBeInstanceOf(L0OpenTelemetry);
    });

    it("should create instance with custom service name", () => {
      const custom = new L0OpenTelemetry({
        tracer: mockTracer as any,
        serviceName: "my-custom-service",
      });
      expect(custom).toBeInstanceOf(L0OpenTelemetry);
    });

    it("should create a span", () => {
      const span = otel.createSpan("test-operation");

      expect(span).toBeDefined();
      expect(mockTracer.startSpan).toHaveBeenCalled();
    });

    it("should record token (with traceTokens enabled)", () => {
      const otelWithTokens = new L0OpenTelemetry({
        tracer: mockTracer as any,
        traceTokens: true,
      });

      const span = otelWithTokens.createSpan("stream");
      otelWithTokens.recordToken(span, "Hello");

      const createdSpan = mockTracer._spans[0]!;
      expect(createdSpan._events.some((e) => e.name === "token")).toBe(true);
    });

    it("should NOT record token events when traceTokens is false", () => {
      const span = otel.createSpan("stream");
      otel.recordToken(span, "Hello");

      const createdSpan = mockTracer._spans[0]!;
      // Default traceTokens is false, so no token events
      expect(createdSpan._events.some((e) => e.name === "token")).toBe(false);
    });

    it("should record network error", () => {
      const span = otel.createSpan("stream");
      const error = new Error("Connection timeout");
      otel.recordNetworkError(error, "timeout", span);

      const createdSpan = mockTracer._spans[0]!;
      expect(createdSpan._events.some((e) => e.name === "network_error")).toBe(
        true,
      );
    });

    it("should record retry", () => {
      const span = otel.createSpan("stream");
      otel.recordRetry("rate_limit", 1, span);

      const createdSpan = mockTracer._spans[0]!;
      expect(createdSpan._events.some((e) => e.name === "retry")).toBe(true);
    });

    it("should record guardrail violation", () => {
      const span = otel.createSpan("stream");
      otel.recordGuardrailViolation(
        {
          rule: "json",
          severity: "error" as const,
          message: "Invalid JSON",
          recoverable: false,
        },
        span,
      );

      const createdSpan = mockTracer._spans[0]!;
      expect(
        createdSpan._events.some((e) => e.name === "guardrail_violation"),
      ).toBe(true);
    });

    it("should record telemetry to span", () => {
      const span = otel.createSpan("execution");
      otel.recordTelemetry(
        {
          sessionId: "test-session",
          startTime: Date.now() - 1000,
          endTime: Date.now(),
          duration: 1000,
          metrics: {
            totalTokens: 50,
            tokensPerSecond: 50,
            timeToFirstToken: 200,
            totalRetries: 0,
            networkRetryCount: 0,
            modelRetryCount: 0,
          },
          network: {
            errorCount: 0,
            errorsByType: {},
          },
          guardrails: {
            violationCount: 0,
            violationsByRule: {},
            violationsByRuleAndSeverity: {},
            violationsBySeverity: { warning: 0, error: 0, fatal: 0 },
          },
        },
        span,
      );

      const createdSpan = mockTracer._spans[0]!;
      expect(createdSpan._attributes[SemanticAttributes.L0_STREAM_ID]).toBe(
        "test-session",
      );
    });

    it("should record drift detection", () => {
      const span = otel.createSpan("stream");
      otel.recordDrift("topic", 0.85, span);

      const createdSpan = mockTracer._spans[0]!;
      expect(createdSpan._events.some((e) => e.name === "drift_detected")).toBe(
        true,
      );
      expect(
        createdSpan._attributes[SemanticAttributes.L0_DRIFT_DETECTED],
      ).toBe(true);
    });
  });

  describe("createOpenTelemetry Factory", () => {
    it("should create L0OpenTelemetry via factory", () => {
      const mockTracer = createMockTracer();
      const otel = createOpenTelemetry({ tracer: mockTracer as any });

      expect(otel).toBeInstanceOf(L0OpenTelemetry);
    });
  });

  describe("SemanticAttributes", () => {
    it("should export GenAI semantic attributes", () => {
      expect(SemanticAttributes.LLM_SYSTEM).toBe("gen_ai.system");
      expect(SemanticAttributes.LLM_REQUEST_MODEL).toBe("gen_ai.request.model");
      expect(SemanticAttributes.LLM_RESPONSE_MODEL).toBe(
        "gen_ai.response.model",
      );
      expect(SemanticAttributes.LLM_USAGE_INPUT_TOKENS).toBe(
        "gen_ai.usage.input_tokens",
      );
      expect(SemanticAttributes.LLM_USAGE_OUTPUT_TOKENS).toBe(
        "gen_ai.usage.output_tokens",
      );
    });

    it("should export L0-specific attributes", () => {
      expect(SemanticAttributes.L0_STREAM_ID).toBe("l0.session_id");
      expect(SemanticAttributes.L0_RETRY_COUNT).toBe("l0.retry.count");
      expect(SemanticAttributes.L0_NETWORK_ERROR_COUNT).toBe(
        "l0.network.error_count",
      );
      expect(SemanticAttributes.L0_TIME_TO_FIRST_TOKEN).toBe(
        "l0.time_to_first_token_ms",
      );
      expect(SemanticAttributes.L0_TOKENS_PER_SECOND).toBe(
        "l0.tokens_per_second",
      );
    });
  });

  describe("SpanStatusCode and SpanKind exports", () => {
    it("should export SpanStatusCode", () => {
      expect(SpanStatusCode).toBeDefined();
      expect(SpanStatusCode.OK).toBeDefined();
      expect(SpanStatusCode.ERROR).toBeDefined();
      expect(SpanStatusCode.UNSET).toBeDefined();
    });

    it("should export SpanKind", () => {
      expect(SpanKind).toBeDefined();
      expect(SpanKind.CLIENT).toBeDefined();
      expect(SpanKind.SERVER).toBeDefined();
      expect(SpanKind.INTERNAL).toBeDefined();
    });
  });

  describe("Configuration Options", () => {
    it("should respect traceTokens option", () => {
      const mockTracer = createMockTracer();
      const otel = new L0OpenTelemetry({
        tracer: mockTracer as any,
        traceTokens: true,
      });

      const span = otel.createSpan("stream");
      otel.recordToken(span, "Hello");

      const createdSpan = mockTracer._spans[0]!;
      expect(createdSpan._events.some((e) => e.name === "token")).toBe(true);
    });

    it("should respect recordTokenContent option", () => {
      const mockTracer = createMockTracer();
      const otel = new L0OpenTelemetry({
        tracer: mockTracer as any,
        traceTokens: true,
        recordTokenContent: true,
      });

      const span = otel.createSpan("stream");
      otel.recordToken(span, "HelloWorld");

      const createdSpan = mockTracer._spans[0]!;
      const tokenEvent = createdSpan._events.find((e) => e.name === "token");
      expect(tokenEvent?.attributes?.["token.content"]).toBe("HelloWorld");
    });

    it("should respect recordGuardrailViolations: false", () => {
      const mockTracer = createMockTracer();
      const otel = new L0OpenTelemetry({
        tracer: mockTracer as any,
        recordGuardrailViolations: false,
      });

      const span = otel.createSpan("stream");
      otel.recordGuardrailViolation(
        {
          rule: "json",
          severity: "error" as const,
          message: "Invalid",
          recoverable: false,
        },
        span,
      );

      const createdSpan = mockTracer._spans[0]!;
      expect(
        createdSpan._events.some((e) => e.name === "guardrail_violation"),
      ).toBe(false);
    });
  });

  describe("traceStream method", () => {
    it("should trace a stream operation", async () => {
      const mockTracer = createMockTracer();
      const otel = new L0OpenTelemetry({ tracer: mockTracer as any });

      const result = await otel.traceStream("test-stream", async (span) => {
        span.setAttribute("test", "value");
        return { success: true };
      });

      expect(result).toEqual({ success: true });
      // traceStream uses startActiveSpan internally
      expect(
        mockTracer.startActiveSpan.mock.calls.length > 0 ||
          mockTracer._spans.length > 0,
      ).toBe(true);
    });

    it("should work without tracer configured", async () => {
      const otel = new L0OpenTelemetry({});

      const result = await otel.traceStream("test-stream", async () => {
        return { success: true };
      });

      expect(result).toEqual({ success: true });
    });
  });

  describeIf(hasOpenAI)("Live OpenTelemetry Integration with LLM", () => {
    it(
      "should trace L0 execution",
      async () => {
        const mockTracer = createMockTracer();
        const otel = createOpenTelemetry({ tracer: mockTracer as any });

        const result = await otel.traceStream(
          "chat-completion",
          async (span) => {
            span.setAttribute(
              SemanticAttributes.LLM_REQUEST_MODEL,
              "gpt-5-nano",
            );

            const l0Result = await l0({
              stream: () =>
                streamText({
                  model: openai("gpt-5-nano"),
                  prompt: "Say: Hello",
                }),
              detectZeroTokens: false,
              monitoring: { enabled: true },
            });

            for await (const event of l0Result.stream) {
              if (event.type === "token") {
                otel.recordToken(span, event.value);
              }
            }

            if (l0Result.telemetry) {
              otel.recordTelemetry(l0Result.telemetry, span);
            }

            return l0Result;
          },
        );

        // Verify span was created
        expect(mockTracer._spans.length).toBeGreaterThan(0);

        // Verify telemetry was recorded
        const span = mockTracer._spans[0]!;
        expect(span._attributes[SemanticAttributes.LLM_REQUEST_MODEL]).toBe(
          "gpt-5-nano",
        );

        // Should have session ID from telemetry
        if (result.telemetry) {
          expect(span._attributes[SemanticAttributes.L0_STREAM_ID]).toBe(
            result.telemetry.sessionId,
          );
        }
      },
      LLM_TIMEOUT,
    );
  });

  describe("Error Handling", () => {
    it("should handle missing tracer gracefully", () => {
      const otel = new L0OpenTelemetry({});

      // Should not throw when creating span without tracer
      const span = otel.createSpan("test");
      expect(span).toBeDefined();

      // Operations should not throw
      otel.recordToken(span, "test");
      otel.recordNetworkError(new Error("test"), "test", span);
      otel.recordRetry("test", 1, span);
      otel.recordGuardrailViolation(
        {
          rule: "test",
          severity: "error" as const,
          message: "test",
          recoverable: false,
        },
        span,
      );
    });

    it("should handle undefined span gracefully", () => {
      const mockTracer = createMockTracer();
      const otel = new L0OpenTelemetry({ tracer: mockTracer as any });

      // Should not throw with undefined span
      expect(() => otel.recordToken(undefined, "test")).not.toThrow();
      expect(() =>
        otel.recordNetworkError(new Error("test"), "test", undefined),
      ).not.toThrow();
      expect(() => otel.recordRetry("test", 1, undefined)).not.toThrow();
    });
  });

  describe("Active Streams Tracking", () => {
    it("should track active streams count", () => {
      const mockTracer = createMockTracer();
      const otel = new L0OpenTelemetry({ tracer: mockTracer as any });

      expect(otel.getActiveStreams()).toBe(0);
    });
  });
});
