// Comprehensive tests for L0 Interceptor System

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  InterceptorManager,
  InterceptorContext,
  createInterceptorManager,
  loggingInterceptor,
  metadataInterceptor,
  authInterceptor,
  timingInterceptor,
  validationInterceptor,
  rateLimitInterceptor,
  cachingInterceptor,
  transformInterceptor,
  analyticsInterceptor,
} from "../src/runtime/interceptors";
import type { L0Options, L0Result, L0Interceptor, L0State } from "../src/types/l0";

// Helper to create mock L0Options
function createMockL0Options(overrides: Partial<L0Options> = {}): L0Options {
  return {
    stream: () => ({
      textStream: (async function* () {
        yield { type: "text-delta", textDelta: "Hello" };
      })(),
    }),
    ...overrides,
  };
}

// Helper to create mock L0Result
function createMockL0Result(overrides: Partial<L0Result> = {}): L0Result {
  const defaultState: L0State = {
    content: "Test content",
    checkpoint: "",
    tokenCount: 10,
    retryAttempts: 0,
    networkRetries: 0,
    fallbackIndex: 0,
    violations: [],
    driftDetected: false,
    completed: true,
    networkErrors: [],
  };

  return {
    stream: (async function* () {
      yield { type: "done" as const };
    })(),
    state: { ...defaultState, ...overrides.state },
    errors: overrides.errors ?? [],
    abort: overrides.abort ?? (() => {}),
    ...overrides,
  };
}

// ============================================================================
// InterceptorManager Class Tests
// ============================================================================

describe("InterceptorManager", () => {
  describe("Initialization", () => {
    it("should initialize with empty interceptors array", () => {
      const manager = new InterceptorManager();
      expect(manager.getContexts()).toEqual([]);
    });

    it("should initialize with provided interceptors", () => {
      const interceptor: L0Interceptor = { name: "test" };
      const manager = new InterceptorManager([interceptor]);
      expect(manager.getContexts()).toEqual([]);
    });

    it("should accept multiple interceptors", () => {
      const interceptors: L0Interceptor[] = [
        { name: "first" },
        { name: "second" },
        { name: "third" },
      ];
      const manager = new InterceptorManager(interceptors);
      expect(manager.getContexts()).toEqual([]);
    });
  });

  describe("executeBefore()", () => {
    it("should return options unchanged when no before hooks", async () => {
      const manager = new InterceptorManager([{ name: "no-hooks" }]);
      const options = createMockL0Options();

      const result = await manager.executeBefore(options);

      expect(result).toBe(options);
    });

    it("should execute single before hook", async () => {
      const beforeHook = vi.fn((options: L0Options) => ({
        ...options,
        detectDrift: true,
      }));

      const manager = new InterceptorManager([
        { name: "test", before: beforeHook },
      ]);
      const options = createMockL0Options();

      const result = await manager.executeBefore(options);

      expect(beforeHook).toHaveBeenCalledWith(options);
      expect(result.detectDrift).toBe(true);
    });

    it("should execute multiple before hooks in order", async () => {
      const executionOrder: number[] = [];

      const manager = new InterceptorManager([
        {
          name: "first",
          before: async (options) => {
            executionOrder.push(1);
            return { ...options, detectDrift: true };
          },
        },
        {
          name: "second",
          before: async (options) => {
            executionOrder.push(2);
            return { ...options, detectZeroTokens: true };
          },
        },
        {
          name: "third",
          before: async (options) => {
            executionOrder.push(3);
            return options;
          },
        },
      ]);

      const result = await manager.executeBefore(createMockL0Options());

      expect(executionOrder).toEqual([1, 2, 3]);
      expect(result.detectDrift).toBe(true);
      expect(result.detectZeroTokens).toBe(true);
    });

    it("should chain modifications through hooks", async () => {
      const manager = new InterceptorManager([
        {
          name: "first",
          before: async (options) => ({
            ...options,
            monitoring: { enabled: true },
          }),
        },
        {
          name: "second",
          before: async (options) => ({
            ...options,
            monitoring: { ...options.monitoring, sampleRate: 0.5 },
          }),
        },
      ]);

      const result = await manager.executeBefore(createMockL0Options());

      expect(result.monitoring?.enabled).toBe(true);
      expect(result.monitoring?.sampleRate).toBe(0.5);
    });

    it("should handle async before hooks", async () => {
      const manager = new InterceptorManager([
        {
          name: "async-hook",
          before: async (options) => {
            await new Promise((resolve) => setTimeout(resolve, 10));
            return { ...options, detectDrift: true };
          },
        },
      ]);

      const result = await manager.executeBefore(createMockL0Options());

      expect(result.detectDrift).toBe(true);
    });

    it("should record execution context for before hooks", async () => {
      const manager = new InterceptorManager([
        {
          name: "tracked-hook",
          before: async (options) => options,
        },
      ]);

      await manager.executeBefore(createMockL0Options());
      const contexts = manager.getContexts();

      expect(contexts.length).toBe(1);
      expect(contexts[0].name).toBe("tracked-hook");
      expect(contexts[0].phase).toBe("before");
      expect(contexts[0].timestamp).toBeGreaterThan(0);
      expect(contexts[0].duration).toBeGreaterThanOrEqual(0);
    });

    it("should throw error when before hook fails", async () => {
      const manager = new InterceptorManager([
        {
          name: "failing-hook",
          before: async () => {
            throw new Error("Before hook error");
          },
        },
      ]);

      await expect(manager.executeBefore(createMockL0Options())).rejects.toThrow(
        'Interceptor "failing-hook" before hook failed: Before hook error'
      );
    });

    it("should record context even when before hook fails", async () => {
      const manager = new InterceptorManager([
        {
          name: "failing-hook",
          before: async () => {
            throw new Error("Error");
          },
        },
      ]);

      try {
        await manager.executeBefore(createMockL0Options());
      } catch {
        // Expected
      }

      const contexts = manager.getContexts();
      expect(contexts.length).toBe(1);
      expect(contexts[0].name).toBe("failing-hook");
    });

    it("should use 'anonymous' for unnamed interceptors", async () => {
      const manager = new InterceptorManager([
        {
          before: async (options) => options,
        },
      ]);

      await manager.executeBefore(createMockL0Options());
      const contexts = manager.getContexts();

      expect(contexts[0].name).toBe("anonymous");
    });

    it("should stop execution chain on first error", async () => {
      const secondHook = vi.fn();

      const manager = new InterceptorManager([
        {
          name: "failing",
          before: async () => {
            throw new Error("First error");
          },
        },
        {
          name: "second",
          before: secondHook,
        },
      ]);

      try {
        await manager.executeBefore(createMockL0Options());
      } catch {
        // Expected
      }

      expect(secondHook).not.toHaveBeenCalled();
    });
  });

  describe("executeAfter()", () => {
    it("should return result unchanged when no after hooks", async () => {
      const manager = new InterceptorManager([{ name: "no-hooks" }]);
      const result = createMockL0Result();

      const output = await manager.executeAfter(result);

      expect(output).toBe(result);
    });

    it("should execute single after hook", async () => {
      const afterHook = vi.fn((result: L0Result) => ({
        ...result,
        text: "Modified",
      }));

      const manager = new InterceptorManager([
        { name: "test", after: afterHook },
      ]);
      const result = createMockL0Result();

      const output = await manager.executeAfter(result);

      expect(afterHook).toHaveBeenCalledWith(result);
      expect(output.text).toBe("Modified");
    });

    it("should execute multiple after hooks in order", async () => {
      const executionOrder: number[] = [];

      const manager = new InterceptorManager([
        {
          name: "first",
          after: async (result) => {
            executionOrder.push(1);
            return result;
          },
        },
        {
          name: "second",
          after: async (result) => {
            executionOrder.push(2);
            return result;
          },
        },
        {
          name: "third",
          after: async (result) => {
            executionOrder.push(3);
            return result;
          },
        },
      ]);

      await manager.executeAfter(createMockL0Result());

      expect(executionOrder).toEqual([1, 2, 3]);
    });

    it("should chain modifications through after hooks", async () => {
      const manager = new InterceptorManager([
        {
          name: "first",
          after: async (result) => ({
            ...result,
            state: { ...result.state, content: result.state.content + " modified" },
          }),
        },
        {
          name: "second",
          after: async (result) => ({
            ...result,
            state: { ...result.state, content: result.state.content + " again" },
          }),
        },
      ]);

      const result = await manager.executeAfter(createMockL0Result());

      expect(result.state.content).toBe("Test content modified again");
    });

    it("should handle async after hooks", async () => {
      const manager = new InterceptorManager([
        {
          name: "async-hook",
          after: async (result) => {
            await new Promise((resolve) => setTimeout(resolve, 10));
            return { ...result, text: "async result" };
          },
        },
      ]);

      const result = await manager.executeAfter(createMockL0Result());

      expect(result.text).toBe("async result");
    });

    it("should record execution context for after hooks", async () => {
      const manager = new InterceptorManager([
        {
          name: "tracked-hook",
          after: async (result) => result,
        },
      ]);

      await manager.executeAfter(createMockL0Result());
      const contexts = manager.getContexts();

      expect(contexts.length).toBe(1);
      expect(contexts[0].name).toBe("tracked-hook");
      expect(contexts[0].phase).toBe("after");
      expect(contexts[0].timestamp).toBeGreaterThan(0);
    });

    it("should throw error when after hook fails", async () => {
      const manager = new InterceptorManager([
        {
          name: "failing-hook",
          after: async () => {
            throw new Error("After hook error");
          },
        },
      ]);

      await expect(manager.executeAfter(createMockL0Result())).rejects.toThrow(
        'Interceptor "failing-hook" after hook failed: After hook error'
      );
    });
  });

  describe("executeError()", () => {
    it("should do nothing when no error hooks", async () => {
      const manager = new InterceptorManager([{ name: "no-hooks" }]);

      // Should not throw
      await manager.executeError(new Error("Test"), createMockL0Options());
    });

    it("should execute single error hook", async () => {
      const errorHook = vi.fn();

      const manager = new InterceptorManager([
        { name: "test", onError: errorHook },
      ]);
      const error = new Error("Test error");
      const options = createMockL0Options();

      await manager.executeError(error, options);

      expect(errorHook).toHaveBeenCalledWith(error, options);
    });

    it("should execute multiple error hooks", async () => {
      const hook1 = vi.fn();
      const hook2 = vi.fn();
      const hook3 = vi.fn();

      const manager = new InterceptorManager([
        { name: "first", onError: hook1 },
        { name: "second", onError: hook2 },
        { name: "third", onError: hook3 },
      ]);

      await manager.executeError(new Error("Test"), createMockL0Options());

      expect(hook1).toHaveBeenCalled();
      expect(hook2).toHaveBeenCalled();
      expect(hook3).toHaveBeenCalled();
    });

    it("should continue executing error hooks even if one fails", async () => {
      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const hook2 = vi.fn();

      const manager = new InterceptorManager([
        {
          name: "failing",
          onError: async () => {
            throw new Error("Error in error handler");
          },
        },
        { name: "second", onError: hook2 },
      ]);

      await manager.executeError(new Error("Original"), createMockL0Options());

      expect(hook2).toHaveBeenCalled();
      expect(consoleSpy).toHaveBeenCalled();

      consoleSpy.mockRestore();
    });

    it("should record execution context for error hooks", async () => {
      const manager = new InterceptorManager([
        {
          name: "error-hook",
          onError: async () => {},
        },
      ]);

      await manager.executeError(new Error("Test"), createMockL0Options());
      const contexts = manager.getContexts();

      expect(contexts.length).toBe(1);
      expect(contexts[0].name).toBe("error-hook");
      expect(contexts[0].phase).toBe("error");
    });

    it("should handle async error hooks", async () => {
      const results: string[] = [];

      const manager = new InterceptorManager([
        {
          name: "async-error",
          onError: async () => {
            await new Promise((resolve) => setTimeout(resolve, 10));
            results.push("executed");
          },
        },
      ]);

      await manager.executeError(new Error("Test"), createMockL0Options());

      expect(results).toEqual(["executed"]);
    });
  });

  describe("getContexts()", () => {
    it("should return copy of contexts array", async () => {
      const manager = new InterceptorManager([
        { name: "hook", before: async (opts) => opts },
      ]);

      await manager.executeBefore(createMockL0Options());
      const contexts1 = manager.getContexts();
      const contexts2 = manager.getContexts();

      expect(contexts1).not.toBe(contexts2);
      expect(contexts1).toEqual(contexts2);
    });

    it("should accumulate contexts across multiple executions", async () => {
      const manager = new InterceptorManager([
        {
          name: "hook",
          before: async (opts) => opts,
          after: async (result) => result,
          onError: async () => {},
        },
      ]);

      await manager.executeBefore(createMockL0Options());
      await manager.executeAfter(createMockL0Result());
      await manager.executeError(new Error("Test"), createMockL0Options());

      const contexts = manager.getContexts();
      expect(contexts.length).toBe(3);
      expect(contexts.map((c) => c.phase)).toEqual(["before", "after", "error"]);
    });
  });

  describe("reset()", () => {
    it("should clear all contexts", async () => {
      const manager = new InterceptorManager([
        { name: "hook", before: async (opts) => opts },
      ]);

      await manager.executeBefore(createMockL0Options());
      expect(manager.getContexts().length).toBe(1);

      manager.reset();
      expect(manager.getContexts().length).toBe(0);
    });

    it("should allow new contexts after reset", async () => {
      const manager = new InterceptorManager([
        { name: "hook", before: async (opts) => opts },
      ]);

      await manager.executeBefore(createMockL0Options());
      manager.reset();
      await manager.executeBefore(createMockL0Options());

      expect(manager.getContexts().length).toBe(1);
    });
  });
});

// ============================================================================
// createInterceptorManager() Factory Tests
// ============================================================================

describe("createInterceptorManager()", () => {
  it("should create InterceptorManager instance", () => {
    const manager = createInterceptorManager();
    expect(manager).toBeInstanceOf(InterceptorManager);
  });

  it("should create manager with provided interceptors", async () => {
    const beforeHook = vi.fn((opts: L0Options) => opts);
    const manager = createInterceptorManager([{ name: "test", before: beforeHook }]);

    await manager.executeBefore(createMockL0Options());

    expect(beforeHook).toHaveBeenCalled();
  });
});

// ============================================================================
// Built-in Interceptors Tests
// ============================================================================

describe("loggingInterceptor()", () => {
  it("should create interceptor with name 'logging'", () => {
    const interceptor = loggingInterceptor();
    expect(interceptor.name).toBe("logging");
  });

  it("should log on before hook", async () => {
    const logger = {
      info: vi.fn(),
      error: vi.fn(),
    };
    const interceptor = loggingInterceptor(logger);

    await interceptor.before!(createMockL0Options({ guardrails: [] }));

    expect(logger.info).toHaveBeenCalledWith("L0 execution starting", expect.any(Object));
  });

  it("should log on after hook", async () => {
    const logger = {
      info: vi.fn(),
      error: vi.fn(),
    };
    const interceptor = loggingInterceptor(logger);

    await interceptor.after!(createMockL0Result());

    expect(logger.info).toHaveBeenCalledWith(
      "L0 execution completed",
      expect.objectContaining({
        completed: true,
        tokens: 10,
      })
    );
  });

  it("should log on error hook", async () => {
    const logger = {
      info: vi.fn(),
      error: vi.fn(),
    };
    const interceptor = loggingInterceptor(logger);

    await interceptor.onError!(new Error("Test error"), createMockL0Options());

    expect(logger.error).toHaveBeenCalledWith(
      "L0 execution failed",
      expect.objectContaining({ error: "Test error" })
    );
  });

  it("should use console as default logger", async () => {
    const consoleSpy = vi.spyOn(console, "info").mockImplementation(() => {});
    const interceptor = loggingInterceptor();

    await interceptor.before!(createMockL0Options());

    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  it("should include guardrail status in before log", async () => {
    const logger = { info: vi.fn(), error: vi.fn() };
    const interceptor = loggingInterceptor(logger);

    await interceptor.before!(
      createMockL0Options({
        guardrails: [{ name: "test", check: () => [] }],
      })
    );

    expect(logger.info).toHaveBeenCalledWith(
      "L0 execution starting",
      expect.objectContaining({ hasGuardrails: true })
    );
  });

  it("should include retry status in before log", async () => {
    const logger = { info: vi.fn(), error: vi.fn() };
    const interceptor = loggingInterceptor(logger);

    await interceptor.before!(createMockL0Options({ retry: { attempts: 3 } }));

    expect(logger.info).toHaveBeenCalledWith(
      "L0 execution starting",
      expect.objectContaining({ hasRetry: true })
    );
  });

  it("should include monitoring status in before log", async () => {
    const logger = { info: vi.fn(), error: vi.fn() };
    const interceptor = loggingInterceptor(logger);

    await interceptor.before!(
      createMockL0Options({ monitoring: { enabled: true } })
    );

    expect(logger.info).toHaveBeenCalledWith(
      "L0 execution starting",
      expect.objectContaining({ hasMonitoring: true })
    );
  });

  it("should include retry and network retry counts in after log", async () => {
    const logger = { info: vi.fn(), error: vi.fn() };
    const interceptor = loggingInterceptor(logger);

    await interceptor.after!(
      createMockL0Result({
        state: {
          content: "",
          checkpoint: "",
          tokenCount: 10,
          retryAttempts: 2,
          networkRetries: 3,
          fallbackIndex: 0,
          violations: [],
          driftDetected: false,
          completed: true,
          networkErrors: [],
        },
      })
    );

    expect(logger.info).toHaveBeenCalledWith(
      "L0 execution completed",
      expect.objectContaining({
        retries: 2,
        networkRetries: 3,
      })
    );
  });

  it("should include violation count in after log", async () => {
    const logger = { info: vi.fn(), error: vi.fn() };
    const interceptor = loggingInterceptor(logger);

    await interceptor.after!(
      createMockL0Result({
        state: {
          content: "",
          checkpoint: "",
          tokenCount: 10,
          retryAttempts: 0,
          networkRetries: 0,
          fallbackIndex: 0,
          violations: [
            { rule: "test", message: "violation", severity: "warning", recoverable: true },
          ],
          driftDetected: false,
          completed: true,
          networkErrors: [],
        },
      })
    );

    expect(logger.info).toHaveBeenCalledWith(
      "L0 execution completed",
      expect.objectContaining({ violations: 1 })
    );
  });
});

describe("metadataInterceptor()", () => {
  it("should create interceptor with name 'metadata'", () => {
    const interceptor = metadataInterceptor({});
    expect(interceptor.name).toBe("metadata");
  });

  it("should inject metadata into monitoring", async () => {
    const interceptor = metadataInterceptor({ user_id: "123", request_id: "abc" });

    const result = await interceptor.before!(createMockL0Options());

    expect(result.monitoring?.metadata).toEqual({
      user_id: "123",
      request_id: "abc",
    });
  });

  it("should merge with existing metadata", async () => {
    const interceptor = metadataInterceptor({ new_field: "value" });

    const result = await interceptor.before!(
      createMockL0Options({
        monitoring: { enabled: true, metadata: { existing: "data" } },
      })
    );

    expect(result.monitoring?.metadata).toEqual({
      existing: "data",
      new_field: "value",
    });
  });

  it("should enable monitoring by default", async () => {
    const interceptor = metadataInterceptor({ key: "value" });

    const result = await interceptor.before!(createMockL0Options());

    expect(result.monitoring?.enabled).toBe(true);
  });

  it("should preserve existing monitoring enabled state", async () => {
    const interceptor = metadataInterceptor({ key: "value" });

    const result = await interceptor.before!(
      createMockL0Options({ monitoring: { enabled: false } })
    );

    expect(result.monitoring?.enabled).toBe(false);
  });

  it("should only have before hook", () => {
    const interceptor = metadataInterceptor({});

    expect(interceptor.before).toBeDefined();
    expect(interceptor.after).toBeUndefined();
    expect(interceptor.onError).toBeUndefined();
  });
});

describe("authInterceptor()", () => {
  it("should create interceptor with name 'auth'", () => {
    const interceptor = authInterceptor(() => ({}));
    expect(interceptor.name).toBe("auth");
  });

  it("should inject auth data from sync function", async () => {
    const interceptor = authInterceptor(() => ({ token: "abc123" }));

    const result = await interceptor.before!(createMockL0Options());

    expect(result.monitoring?.metadata?.auth).toEqual({ token: "abc123" });
  });

  it("should inject auth data from async function", async () => {
    const interceptor = authInterceptor(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      return { token: "async-token" };
    });

    const result = await interceptor.before!(createMockL0Options());

    expect(result.monitoring?.metadata?.auth).toEqual({ token: "async-token" });
  });

  it("should merge auth with existing metadata", async () => {
    const interceptor = authInterceptor(() => ({ token: "xyz" }));

    const result = await interceptor.before!(
      createMockL0Options({
        monitoring: { metadata: { user_id: "123" } },
      })
    );

    expect(result.monitoring?.metadata).toEqual({
      user_id: "123",
      auth: { token: "xyz" },
    });
  });
});

describe("timingInterceptor()", () => {
  it("should create interceptor with name 'timing'", () => {
    const interceptor = timingInterceptor();
    expect(interceptor.name).toBe("timing");
  });

  it("should enable monitoring in before hook", async () => {
    const interceptor = timingInterceptor();

    const result = await interceptor.before!(createMockL0Options());

    expect(result.monitoring?.enabled).toBe(true);
    expect(result.monitoring?.includeTimings).toBe(true);
  });

  it("should add session ID to metadata", async () => {
    const interceptor = timingInterceptor();

    const result = await interceptor.before!(createMockL0Options());

    expect(result.monitoring?.metadata?.sessionId).toMatch(/^session_\d+$/);
  });

  it("should have after hook for cleanup", async () => {
    const interceptor = timingInterceptor();

    expect(interceptor.after).toBeDefined();

    // Execute after hook (should not throw)
    const result = await interceptor.after!(createMockL0Result());
    expect(result).toBeDefined();
  });
});

describe("validationInterceptor()", () => {
  it("should create interceptor with name 'validation'", () => {
    const interceptor = validationInterceptor(() => true);
    expect(interceptor.name).toBe("validation");
  });

  it("should pass when validation succeeds", async () => {
    const interceptor = validationInterceptor((content) => content.length > 0);
    const mockResult = createMockL0Result();

    const result = await interceptor.after!(mockResult);

    expect(result).toBe(mockResult);
  });

  it("should throw when validation fails", async () => {
    const interceptor = validationInterceptor(() => false);

    await expect(interceptor.after!(createMockL0Result())).rejects.toThrow(
      "Output validation failed"
    );
  });

  it("should call onInvalid callback when validation fails", async () => {
    const onInvalid = vi.fn();
    const interceptor = validationInterceptor(() => false, onInvalid);

    try {
      await interceptor.after!(createMockL0Result());
    } catch {
      // Expected
    }

    expect(onInvalid).toHaveBeenCalledWith("Test content");
  });

  it("should support async validation function", async () => {
    const interceptor = validationInterceptor(async (content) => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      return content.includes("Test");
    });

    const result = await interceptor.after!(createMockL0Result());

    expect(result).toBeDefined();
  });

  it("should validate based on content", async () => {
    const interceptor = validationInterceptor((content) => content.length >= 100);

    await expect(interceptor.after!(createMockL0Result())).rejects.toThrow(
      "Output validation failed"
    );
  });

  it("should only have after hook", () => {
    const interceptor = validationInterceptor(() => true);

    expect(interceptor.before).toBeUndefined();
    expect(interceptor.after).toBeDefined();
    expect(interceptor.onError).toBeUndefined();
  });
});

describe("rateLimitInterceptor()", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("should create interceptor with name 'rate-limit'", () => {
    const interceptor = rateLimitInterceptor(10, 60000);
    expect(interceptor.name).toBe("rate-limit");
  });

  it("should allow requests under limit", async () => {
    const interceptor = rateLimitInterceptor(5, 60000);
    const options = createMockL0Options();

    // Should not throw for first 5 requests
    for (let i = 0; i < 5; i++) {
      const result = await interceptor.before!(options);
      expect(result).toBe(options);
    }
  });

  it("should throw when rate limit exceeded", async () => {
    const interceptor = rateLimitInterceptor(3, 60000);
    const options = createMockL0Options();

    // Use up the limit
    await interceptor.before!(options);
    await interceptor.before!(options);
    await interceptor.before!(options);

    // Fourth request should fail
    await expect(interceptor.before!(options)).rejects.toThrow(
      /Rate limit exceeded/
    );
  });

  it("should include wait time in error message", async () => {
    const interceptor = rateLimitInterceptor(1, 60000);
    const options = createMockL0Options();

    await interceptor.before!(options);

    await expect(interceptor.before!(options)).rejects.toThrow(
      /Wait \d+ms before retrying/
    );
  });

  it("should reset after window expires", async () => {
    const interceptor = rateLimitInterceptor(2, 1000);
    const options = createMockL0Options();

    // Use up the limit
    await interceptor.before!(options);
    await interceptor.before!(options);

    // Advance time past the window
    vi.advanceTimersByTime(1100);

    // Should work again
    const result = await interceptor.before!(options);
    expect(result).toBe(options);
  });

  it("should only have before hook", () => {
    const interceptor = rateLimitInterceptor(10, 60000);

    expect(interceptor.before).toBeDefined();
    expect(interceptor.after).toBeUndefined();
    expect(interceptor.onError).toBeUndefined();
  });
});

describe("transformInterceptor()", () => {
  it("should create interceptor with name 'transform'", () => {
    const interceptor = transformInterceptor((content) => content);
    expect(interceptor.name).toBe("transform");
  });

  it("should transform content with sync function", async () => {
    const interceptor = transformInterceptor((content) => content.toUpperCase());

    const result = await interceptor.after!(createMockL0Result());

    expect(result.state.content).toBe("TEST CONTENT");
  });

  it("should transform content with async function", async () => {
    const interceptor = transformInterceptor(async (content) => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      return content.replace("Test", "Transformed");
    });

    const result = await interceptor.after!(createMockL0Result());

    expect(result.state.content).toBe("Transformed content");
  });

  it("should preserve other result properties", async () => {
    const interceptor = transformInterceptor((content) => "new content");

    const originalResult = createMockL0Result({
      state: {
        content: "original",
        checkpoint: "checkpoint",
        tokenCount: 50,
        retryAttempts: 1,
        networkRetries: 2,
        fallbackIndex: 0,
        violations: [],
        driftDetected: false,
        completed: true,
        networkErrors: [],
      },
    });

    const result = await interceptor.after!(originalResult);

    expect(result.state.content).toBe("new content");
    expect(result.state.checkpoint).toBe("checkpoint");
    expect(result.state.tokenCount).toBe(50);
    expect(result.state.retryAttempts).toBe(1);
  });

  it("should only have after hook", () => {
    const interceptor = transformInterceptor((c) => c);

    expect(interceptor.before).toBeUndefined();
    expect(interceptor.after).toBeDefined();
    expect(interceptor.onError).toBeUndefined();
  });
});

describe("analyticsInterceptor()", () => {
  it("should create interceptor with name 'analytics'", () => {
    const interceptor = analyticsInterceptor(() => {});
    expect(interceptor.name).toBe("analytics");
  });

  it("should track l0_started on before hook", async () => {
    const track = vi.fn();
    const interceptor = analyticsInterceptor(track);

    await interceptor.before!(createMockL0Options({ guardrails: [] }));

    expect(track).toHaveBeenCalledWith(
      "l0_started",
      expect.objectContaining({
        timestamp: expect.any(Number),
        hasGuardrails: false,
      })
    );
  });

  it("should track l0_completed on after hook", async () => {
    const track = vi.fn();
    const interceptor = analyticsInterceptor(track);

    await interceptor.before!(createMockL0Options());
    await interceptor.after!(createMockL0Result());

    expect(track).toHaveBeenCalledWith(
      "l0_completed",
      expect.objectContaining({
        duration: expect.any(Number),
        tokens: 10,
        retries: 0,
        completed: true,
      })
    );
  });

  it("should track l0_failed on error hook", async () => {
    const track = vi.fn();
    const interceptor = analyticsInterceptor(track);

    await interceptor.before!(createMockL0Options());
    await interceptor.onError!(new Error("Test error"), createMockL0Options());

    expect(track).toHaveBeenCalledWith(
      "l0_failed",
      expect.objectContaining({
        duration: expect.any(Number),
        error: "Test error",
      })
    );
  });

  it("should support async track function", async () => {
    const results: string[] = [];
    const track = async (event: string) => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      results.push(event);
    };
    const interceptor = analyticsInterceptor(track);

    await interceptor.before!(createMockL0Options());
    await interceptor.after!(createMockL0Result());

    expect(results).toContain("l0_started");
    expect(results).toContain("l0_completed");
  });

  it("should calculate duration between before and after", async () => {
    vi.useFakeTimers();
    const track = vi.fn();
    const interceptor = analyticsInterceptor(track);

    await interceptor.before!(createMockL0Options());
    vi.advanceTimersByTime(100);
    await interceptor.after!(createMockL0Result());

    const afterCall = track.mock.calls.find((c) => c[0] === "l0_completed");
    expect(afterCall?.[1]?.duration).toBe(100);

    vi.useRealTimers();
  });
});

describe("cachingInterceptor()", () => {
  it("should create interceptor with name 'caching'", () => {
    const cache = new Map();
    const interceptor = cachingInterceptor(cache, () => "key");
    expect(interceptor.name).toBe("caching");
  });

  it("should throw CachedResultError when cache hit", async () => {
    const cache = new Map<string, L0Result>();
    const cachedResult = createMockL0Result();
    cache.set("test-key", cachedResult);

    const interceptor = cachingInterceptor(cache, () => "test-key");

    try {
      await interceptor.before!(createMockL0Options());
      expect.fail("Should have thrown");
    } catch (error: any) {
      expect(error.name).toBe("CachedResultError");
      expect(error.result).toBe(cachedResult);
    }
  });

  it("should pass through when cache miss", async () => {
    const cache = new Map<string, L0Result>();
    const interceptor = cachingInterceptor(cache, () => "missing-key");
    const options = createMockL0Options();

    const result = await interceptor.before!(options);

    expect(result).toBe(options);
  });

  it("should use getCacheKey function", async () => {
    const cache = new Map<string, L0Result>();
    const getCacheKey = vi.fn(() => "computed-key");
    cache.set("computed-key", createMockL0Result());

    const interceptor = cachingInterceptor(cache, getCacheKey);

    try {
      await interceptor.before!(createMockL0Options());
    } catch {
      // Expected CachedResultError
    }

    expect(getCacheKey).toHaveBeenCalled();
  });
});

// ============================================================================
// Interceptor Chaining Tests
// ============================================================================

describe("Interceptor Chaining", () => {
  it("should chain multiple interceptors in order", async () => {
    const executionOrder: string[] = [];

    const manager = new InterceptorManager([
      {
        name: "first",
        before: async (opts) => {
          executionOrder.push("first-before");
          return opts;
        },
        after: async (result) => {
          executionOrder.push("first-after");
          return result;
        },
      },
      {
        name: "second",
        before: async (opts) => {
          executionOrder.push("second-before");
          return opts;
        },
        after: async (result) => {
          executionOrder.push("second-after");
          return result;
        },
      },
    ]);

    await manager.executeBefore(createMockL0Options());
    await manager.executeAfter(createMockL0Result());

    expect(executionOrder).toEqual([
      "first-before",
      "second-before",
      "first-after",
      "second-after",
    ]);
  });

  it("should pass modified options through chain", async () => {
    const manager = new InterceptorManager([
      metadataInterceptor({ step1: true }),
      metadataInterceptor({ step2: true }),
      metadataInterceptor({ step3: true }),
    ]);

    const result = await manager.executeBefore(createMockL0Options());

    expect(result.monitoring?.metadata).toEqual({
      step1: true,
      step2: true,
      step3: true,
    });
  });

  it("should combine multiple built-in interceptors", async () => {
    const logger = { info: vi.fn(), error: vi.fn() };
    const track = vi.fn();

    const manager = new InterceptorManager([
      loggingInterceptor(logger),
      metadataInterceptor({ request_id: "123" }),
      analyticsInterceptor(track),
    ]);

    await manager.executeBefore(createMockL0Options());
    await manager.executeAfter(createMockL0Result());

    expect(logger.info).toHaveBeenCalledTimes(2);
    expect(track).toHaveBeenCalledWith("l0_started", expect.any(Object));
    expect(track).toHaveBeenCalledWith("l0_completed", expect.any(Object));
  });
});

// ============================================================================
// Edge Cases Tests
// ============================================================================

describe("Edge Cases", () => {
  describe("Error Handling", () => {
    it("should handle non-Error thrown in before hook", async () => {
      const manager = new InterceptorManager([
        {
          name: "string-throw",
          before: async () => {
            throw "string error";
          },
        },
      ]);

      await expect(manager.executeBefore(createMockL0Options())).rejects.toThrow(
        'Interceptor "string-throw" before hook failed: string error'
      );
    });

    it("should handle undefined returned from before hook", async () => {
      const manager = new InterceptorManager([
        {
          name: "undefined-return",
          before: async () => undefined as any,
        },
      ]);

      const result = await manager.executeBefore(createMockL0Options());
      expect(result).toBeUndefined();
    });

    it("should handle null returned from after hook", async () => {
      const manager = new InterceptorManager([
        {
          name: "null-return",
          after: async () => null as any,
        },
      ]);

      const result = await manager.executeAfter(createMockL0Result());
      expect(result).toBeNull();
    });
  });

  describe("Timing", () => {
    it("should measure duration accurately", async () => {
      vi.useFakeTimers();

      const manager = new InterceptorManager([
        {
          name: "slow-hook",
          before: async (opts) => {
            await new Promise((resolve) => setTimeout(resolve, 100));
            return opts;
          },
        },
      ]);

      const promise = manager.executeBefore(createMockL0Options());
      vi.advanceTimersByTime(100);
      await promise;

      const contexts = manager.getContexts();
      expect(contexts[0].duration).toBe(100);

      vi.useRealTimers();
    });
  });

  describe("Mixed Hook Types", () => {
    it("should handle interceptor with only onError hook", async () => {
      const errorHook = vi.fn();
      const manager = new InterceptorManager([{ name: "error-only", onError: errorHook }]);

      // Before and after should work
      const options = await manager.executeBefore(createMockL0Options());
      expect(options).toBeDefined();

      const result = await manager.executeAfter(createMockL0Result());
      expect(result).toBeDefined();

      // Error hook should be called
      await manager.executeError(new Error("test"), createMockL0Options());
      expect(errorHook).toHaveBeenCalled();
    });

    it("should handle empty interceptor", async () => {
      const manager = new InterceptorManager([{ name: "empty" }]);

      const options = await manager.executeBefore(createMockL0Options());
      const result = await manager.executeAfter(createMockL0Result());
      await manager.executeError(new Error("test"), createMockL0Options());

      expect(options).toBeDefined();
      expect(result).toBeDefined();
      expect(manager.getContexts().length).toBe(0);
    });
  });

  describe("Concurrent Execution", () => {
    it("should handle concurrent before executions", async () => {
      const manager = new InterceptorManager([
        {
          name: "concurrent",
          before: async (opts) => {
            await new Promise((resolve) => setTimeout(resolve, 10));
            return opts;
          },
        },
      ]);

      const promises = [
        manager.executeBefore(createMockL0Options()),
        manager.executeBefore(createMockL0Options()),
        manager.executeBefore(createMockL0Options()),
      ];

      const results = await Promise.all(promises);

      expect(results.length).toBe(3);
      expect(manager.getContexts().length).toBe(3);
    });
  });

  describe("Large Scale", () => {
    it("should handle many interceptors", async () => {
      const interceptors: L0Interceptor[] = [];
      for (let i = 0; i < 100; i++) {
        interceptors.push({
          name: `interceptor-${i}`,
          before: async (opts) => opts,
        });
      }

      const manager = new InterceptorManager(interceptors);
      const result = await manager.executeBefore(createMockL0Options());

      expect(result).toBeDefined();
      expect(manager.getContexts().length).toBe(100);
    });

    it("should handle deeply nested metadata modifications", async () => {
      const manager = new InterceptorManager([
        metadataInterceptor({ level1: { a: 1 } }),
        {
          name: "deep-modifier",
          before: async (opts) => ({
            ...opts,
            monitoring: {
              ...opts.monitoring,
              metadata: {
                ...opts.monitoring?.metadata,
                level2: { b: 2 },
              },
            },
          }),
        },
      ]);

      const result = await manager.executeBefore(createMockL0Options());

      expect(result.monitoring?.metadata?.level1).toEqual({ a: 1 });
      expect(result.monitoring?.metadata?.level2).toEqual({ b: 2 });
    });
  });
});

// ============================================================================
// Type Safety Tests
// ============================================================================

describe("Type Safety", () => {
  it("should maintain L0Options type through before chain", async () => {
    const manager = new InterceptorManager([
      {
        name: "typed",
        before: async (opts: L0Options): Promise<L0Options> => ({
          ...opts,
          detectDrift: true,
        }),
      },
    ]);

    const result = await manager.executeBefore(createMockL0Options());

    // TypeScript should recognize these properties
    expect(result.stream).toBeDefined();
    expect(result.detectDrift).toBe(true);
  });

  it("should maintain L0Result type through after chain", async () => {
    const manager = new InterceptorManager([
      {
        name: "typed",
        after: async (result: L0Result): Promise<L0Result> => ({
          ...result,
          text: "modified",
        }),
      },
    ]);

    const result = await manager.executeAfter(createMockL0Result());

    // TypeScript should recognize these properties
    expect(result.stream).toBeDefined();
    expect(result.state).toBeDefined();
    expect(result.text).toBe("modified");
  });

  it("should accept interceptor with all hooks", () => {
    const fullInterceptor: L0Interceptor = {
      name: "full",
      before: async (opts) => opts,
      after: async (result) => result,
      onError: async () => {},
    };

    const manager = new InterceptorManager([fullInterceptor]);
    expect(manager).toBeDefined();
  });

  it("should accept interceptor with no hooks", () => {
    const emptyInterceptor: L0Interceptor = {
      name: "empty",
    };

    const manager = new InterceptorManager([emptyInterceptor]);
    expect(manager).toBeDefined();
  });
});
