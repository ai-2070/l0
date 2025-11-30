// Sentry Integration Tests
// Run: OPENAI_API_KEY=sk-... npm run test:integration

import { describe, it, expect, vi, beforeEach } from "vitest";
import { describeIf, hasOpenAI, LLM_TIMEOUT } from "./setup";
import {
  L0Sentry,
  createSentryIntegration,
  sentryInterceptor,
  withSentry,
} from "../src/runtime/sentry";
import type { SentryClient } from "../src/runtime/sentry";
import { l0 } from "../src/runtime/l0";
import { streamText } from "ai";
import { openai } from "@ai-sdk/openai";

// Mock Sentry client
function createMockSentry() {
  const captured = {
    exceptions: [] as any[],
    messages: [] as any[],
    breadcrumbs: [] as any[],
  };
  const tags: Record<string, string> = {};
  const extras: Record<string, any> = {};
  const contexts: Record<string, any> = {};

  return {
    _captured: captured,
    _tags: tags,
    _extras: extras,
    _contexts: contexts,
    captureException: vi.fn((error: any, options?: any) => {
      captured.exceptions.push({ error, options });
      return "mock-event-id";
    }) as any,
    captureMessage: vi.fn((message: any, level?: any) => {
      captured.messages.push({ message, level });
      return "mock-event-id";
    }) as any,
    addBreadcrumb: vi.fn((breadcrumb: any) => {
      captured.breadcrumbs.push(breadcrumb);
    }) as any,
    setTag: vi.fn((key: string, value: string) => {
      tags[key] = value;
    }) as any,
    setExtra: vi.fn((key: string, value: any) => {
      extras[key] = value;
    }) as any,
    setContext: vi.fn((name: string, context: any) => {
      contexts[name] = context;
    }) as any,
    startSpan: vi.fn((options: any, callback: any) => {
      const mockSpan = { end: vi.fn() };
      return callback(mockSpan);
    }) as any,
    withScope: vi.fn((callback: any) => {
      return callback({ setTag: vi.fn(), setExtra: vi.fn() });
    }) as any,
  };
}

describe("Sentry Integration", () => {
  describe("L0Sentry Class", () => {
    let mockSentry: ReturnType<typeof createMockSentry>;
    let l0Sentry: L0Sentry;

    beforeEach(() => {
      mockSentry = createMockSentry();
      l0Sentry = new L0Sentry({ sentry: mockSentry });
    });

    it("should create L0Sentry instance", () => {
      expect(l0Sentry).toBeInstanceOf(L0Sentry);
    });

    it("should set custom tags on initialization", () => {
      const sentry = createMockSentry();
      new L0Sentry({
        sentry,
        tags: { app: "test-app", version: "1.0.0" },
      });

      expect(sentry.setTag).toHaveBeenCalledWith("app", "test-app");
      expect(sentry.setTag).toHaveBeenCalledWith("version", "1.0.0");
    });

    it("should set environment tag", () => {
      const sentry = createMockSentry();
      new L0Sentry({
        sentry,
        environment: "production",
      });

      expect(sentry.setTag).toHaveBeenCalledWith("environment", "production");
    });

    it("should add breadcrumb on startExecution", () => {
      l0Sentry.startExecution("test-execution", { prompt: "test" });

      expect(mockSentry._captured.breadcrumbs.length).toBeGreaterThan(0);
      const breadcrumb = mockSentry._captured.breadcrumbs[0];
      expect(breadcrumb.category).toBe("l0");
      expect(breadcrumb.message).toContain("started");
    });

    it("should add breadcrumb on startStream", () => {
      l0Sentry.startStream();

      expect(mockSentry._captured.breadcrumbs.length).toBeGreaterThan(0);
      const breadcrumb = mockSentry._captured.breadcrumbs[0];
      expect(breadcrumb.category).toBe("l0.stream");
    });

    it("should record first token with TTFT", () => {
      l0Sentry.recordFirstToken(150);

      expect(mockSentry._captured.breadcrumbs.length).toBeGreaterThan(0);
      const breadcrumb = mockSentry._captured.breadcrumbs[0];
      expect(breadcrumb.data?.ttft_ms).toBe(150);
    });

    it("should record tokens when breadcrumbsForTokens is enabled", () => {
      const sentry = createMockSentry();
      const l0SentryWithTokens = new L0Sentry({
        sentry,
        breadcrumbsForTokens: true,
      });

      l0SentryWithTokens.recordToken("Hello");

      expect(sentry._captured.breadcrumbs.length).toBeGreaterThan(0);
      const breadcrumb = sentry._captured.breadcrumbs[0];
      expect(breadcrumb.category).toBe("l0.token");
    });

    it("should NOT record tokens when breadcrumbsForTokens is false", () => {
      l0Sentry.recordToken("Hello");

      // Default is false, so no breadcrumb should be added
      expect(mockSentry._captured.breadcrumbs.length).toBe(0);
    });

    it("should record network errors", () => {
      const error = new Error("Network timeout");
      l0Sentry.recordNetworkError(error, "timeout", false);

      // Should add breadcrumb
      expect(mockSentry._captured.breadcrumbs.length).toBeGreaterThan(0);

      // Should capture exception (not retried)
      expect(mockSentry._captured.exceptions.length).toBe(1);
      expect(mockSentry._captured.exceptions[0].error).toBe(error);
    });

    it("should NOT capture network error if retried", () => {
      const error = new Error("Network timeout");
      l0Sentry.recordNetworkError(error, "timeout", true);

      // Should add breadcrumb
      expect(mockSentry._captured.breadcrumbs.length).toBeGreaterThan(0);

      // Should NOT capture exception (was retried)
      expect(mockSentry._captured.exceptions.length).toBe(0);
    });

    it("should record retry attempts", () => {
      l0Sentry.recordRetry(1, "rate_limit", false);

      expect(mockSentry._captured.breadcrumbs.length).toBeGreaterThan(0);
      const breadcrumb = mockSentry._captured.breadcrumbs[0];
      expect(breadcrumb.category).toBe("l0.retry");
      expect(breadcrumb.data?.attempt).toBe(1);
    });

    it("should record guardrail violations", () => {
      l0Sentry.recordGuardrailViolations([
        {
          rule: "json",
          severity: "error",
          message: "Invalid JSON",
          recoverable: false,
        },
      ]);

      expect(mockSentry._captured.breadcrumbs.length).toBeGreaterThan(0);
      const breadcrumb = mockSentry._captured.breadcrumbs[0];
      expect(breadcrumb?.category).toBe("l0.guardrail");
    });

    it("should complete execution with telemetry", () => {
      l0Sentry.completeExecution({
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
      });

      expect(mockSentry._captured.breadcrumbs.length).toBeGreaterThan(0);
      const breadcrumb = mockSentry._captured.breadcrumbs[0];
      expect(breadcrumb?.data?.tokens).toBe(50);
      expect(breadcrumb?.data?.duration_ms).toBe(1000);
    });

    it("should record failure with error", () => {
      const error = new Error("Fatal error");
      l0Sentry.recordFailure(error);

      expect(mockSentry._captured.exceptions.length).toBe(1);
    });
  });

  describe("createSentryIntegration", () => {
    it("should create L0Sentry instance via factory", () => {
      const mockSentry = createMockSentry();
      const integration = createSentryIntegration({ sentry: mockSentry });

      expect(integration).toBeInstanceOf(L0Sentry);
    });
  });

  describe("sentryInterceptor", () => {
    it("should create an interceptor object", () => {
      const mockSentry = createMockSentry();
      const interceptor = sentryInterceptor({ sentry: mockSentry });

      expect(typeof interceptor).toBe("object");
    });

    it("should return an interceptor with expected methods", () => {
      const mockSentry = createMockSentry();
      const interceptor = sentryInterceptor({ sentry: mockSentry });

      expect(interceptor).toHaveProperty("name");
      expect(interceptor).toHaveProperty("before");
      expect(interceptor).toHaveProperty("after");
      expect(interceptor).toHaveProperty("onError");
    });
  });

  describeIf(hasOpenAI)("Live Sentry Integration with LLM", () => {
    it(
      "should track L0 execution with breadcrumbs",
      async () => {
        const mockSentry = createMockSentry();
        const l0Sentry = createSentryIntegration({ sentry: mockSentry });

        // Start tracking
        const finishSpan = l0Sentry.startExecution("test", { prompt: "test" });
        l0Sentry.startStream();

        const result = await l0({
          stream: () =>
            streamText({
              model: openai("gpt-5-nano"),
              prompt: "Say: Hello",
            }),
          detectZeroTokens: false,
        });

        // Consume stream
        let tokenCount = 0;
        for await (const event of result.stream) {
          if (event.type === "token") {
            tokenCount++;
            l0Sentry.recordToken(event.value);
          }
        }

        // Record completion
        l0Sentry.completeStream(tokenCount);
        finishSpan?.();

        // Verify breadcrumbs were added
        expect(mockSentry._captured.breadcrumbs.length).toBeGreaterThan(0);

        // Find execution start breadcrumb
        const startBreadcrumb = mockSentry._captured.breadcrumbs.find(
          (b) => b.category === "l0" && b.message?.includes("started"),
        );
        expect(startBreadcrumb).toBeDefined();
      },
      LLM_TIMEOUT,
    );

    it(
      "should use sentry interceptor with L0",
      async () => {
        const mockSentry = createMockSentry();
        const interceptor = sentryInterceptor({ sentry: mockSentry });

        const result = await l0({
          stream: () =>
            streamText({
              model: openai("gpt-5-nano"),
              prompt: "Say: test",
            }),
          interceptors: [interceptor],
          detectZeroTokens: false,
        });

        // Consume stream
        for await (const _event of result.stream) {
          // consume
        }

        // Interceptor should have added breadcrumbs
        expect(mockSentry._captured.breadcrumbs.length).toBeGreaterThan(0);
      },
      LLM_TIMEOUT,
    );
  });

  describe("withSentry Helper", () => {
    it(
      "should wrap async function with sentry tracking",
      async () => {
        const mockSentry = createMockSentry();

        const result = await withSentry({ sentry: mockSentry }, async () => {
          return { value: 42 };
        });

        expect(result).toEqual({ value: 42 });
      },
      LLM_TIMEOUT,
    );

    it("should capture errors in withSentry", async () => {
      const mockSentry = createMockSentry();
      const error = new Error("Test error");

      await expect(
        withSentry({ sentry: mockSentry }, async () => {
          throw error;
        }),
      ).rejects.toThrow("Test error");

      expect(mockSentry._captured.exceptions.length).toBe(1);
    });
  });

  describe("Configuration Options", () => {
    it("should respect captureNetworkErrors: false", () => {
      const mockSentry = createMockSentry();
      const l0Sentry = new L0Sentry({
        sentry: mockSentry,
        captureNetworkErrors: false,
      });

      l0Sentry.recordNetworkError(new Error("test"), "timeout", false);

      // Should add breadcrumb but not capture exception
      expect(mockSentry._captured.breadcrumbs.length).toBeGreaterThan(0);
      expect(mockSentry._captured.exceptions.length).toBe(0);
    });

    it("should respect captureGuardrailViolations: false", () => {
      const mockSentry = createMockSentry();
      const l0Sentry = new L0Sentry({
        sentry: mockSentry,
        captureGuardrailViolations: false,
      });

      l0Sentry.recordGuardrailViolations([
        {
          rule: "json",
          severity: "error",
          message: "Invalid JSON",
          recoverable: false,
        },
      ]);

      // Should add breadcrumb but not capture exception
      expect(mockSentry._captured.breadcrumbs.length).toBeGreaterThan(0);
      expect(mockSentry._captured.exceptions.length).toBe(0);
    });

    it("should respect minGuardrailSeverity", () => {
      const mockSentry = createMockSentry();
      const l0Sentry = new L0Sentry({
        sentry: mockSentry,
        minGuardrailSeverity: "fatal",
      });

      // Error severity should not be captured when min is fatal
      l0Sentry.recordGuardrailViolations([
        {
          rule: "json",
          severity: "error",
          message: "Invalid JSON",
          recoverable: false,
        },
      ]);

      expect(mockSentry._captured.exceptions.length).toBe(0);
    });
  });
});
