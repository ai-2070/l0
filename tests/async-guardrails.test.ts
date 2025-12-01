import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  runAsyncGuardrailCheck,
  runGuardrailCheckAsync,
} from "../src/guardrails/async";
import type { GuardrailEngine } from "../src/guardrails/engine";
import type { GuardrailContext } from "../src/types/guardrails";

// Mock setImmediate for controlled async testing
vi.stubGlobal(
  "setImmediate",
  (fn: () => void) => setTimeout(fn, 0) as unknown as NodeJS.Immediate,
);

describe("Async Guardrails", () => {
  let mockEngine: GuardrailEngine;
  let mockContext: GuardrailContext;

  beforeEach(() => {
    mockEngine = {
      check: vi.fn().mockReturnValue({
        violations: [],
        shouldHalt: false,
        shouldRetry: false,
      }),
    } as unknown as GuardrailEngine;

    mockContext = {
      content: "test content",
      delta: "test",
    } as GuardrailContext;
  });

  describe("runAsyncGuardrailCheck", () => {
    it("should return immediately if delta has violations", () => {
      const violation = {
        rule: "test",
        severity: "error" as const,
        message: "test violation",
      };
      (mockEngine.check as ReturnType<typeof vi.fn>).mockReturnValue({
        violations: [violation],
        shouldHalt: true,
        shouldRetry: false,
      });

      const onComplete = vi.fn();
      const result = runAsyncGuardrailCheck(
        mockEngine,
        mockContext,
        onComplete,
      );

      expect(result).toBeDefined();
      expect(result!.violations).toHaveLength(1);
      expect(onComplete).not.toHaveBeenCalled();
    });

    it("should run sync check for small content when delta is clean", () => {
      const context: GuardrailContext = {
        content: "small content",
        delta: "delta",
      } as GuardrailContext;

      const onComplete = vi.fn();
      const result = runAsyncGuardrailCheck(mockEngine, context, onComplete);

      expect(result).toBeDefined();
      expect(mockEngine.check).toHaveBeenCalledTimes(2); // Once for delta, once for full
    });

    it("should defer to async for large content", async () => {
      const largeContent = "x".repeat(6000);
      const context: GuardrailContext = {
        content: largeContent,
        delta: "delta",
      } as GuardrailContext;

      const onComplete = vi.fn();
      const result = runAsyncGuardrailCheck(mockEngine, context, onComplete);

      expect(result).toBeUndefined(); // Deferred

      // Wait for async completion
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(onComplete).toHaveBeenCalled();
    });

    it("should defer when delta is large", async () => {
      const largeDelta = "x".repeat(1500);
      const context: GuardrailContext = {
        content: "content",
        delta: largeDelta,
      } as GuardrailContext;

      const onComplete = vi.fn();
      const result = runAsyncGuardrailCheck(mockEngine, context, onComplete);

      expect(result).toBeUndefined();

      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(onComplete).toHaveBeenCalled();
    });

    it("should defer when no delta provided", async () => {
      const context: GuardrailContext = {
        content: "content",
      } as GuardrailContext;

      const onComplete = vi.fn();
      const result = runAsyncGuardrailCheck(mockEngine, context, onComplete);

      expect(result).toBeUndefined();

      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(onComplete).toHaveBeenCalled();
    });

    it("should return clean result on error in async path", async () => {
      (mockEngine.check as ReturnType<typeof vi.fn>).mockImplementation(() => {
        throw new Error("Engine error");
      });

      // Use large content with no delta to force async path
      const context: GuardrailContext = {
        content: "x".repeat(6000),
      } as GuardrailContext;

      const onComplete = vi.fn();
      runAsyncGuardrailCheck(mockEngine, context, onComplete);

      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(onComplete).toHaveBeenCalledWith({
        violations: [],
        shouldHalt: false,
        shouldRetry: false,
      });
    });
  });

  describe("runGuardrailCheckAsync", () => {
    it("should always call onComplete asynchronously", async () => {
      const onComplete = vi.fn();

      runGuardrailCheckAsync(mockEngine, mockContext, onComplete);

      // Should not be called synchronously
      expect(onComplete).not.toHaveBeenCalled();

      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(onComplete).toHaveBeenCalled();
    });

    it("should pass engine result to onComplete", async () => {
      const expectedResult = {
        violations: [
          { rule: "test", severity: "warning" as const, message: "warn" },
        ],
        shouldHalt: false,
        shouldRetry: true,
      };
      (mockEngine.check as ReturnType<typeof vi.fn>).mockReturnValue(
        expectedResult,
      );

      const onComplete = vi.fn();
      runGuardrailCheckAsync(mockEngine, mockContext, onComplete);

      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(onComplete).toHaveBeenCalledWith(expectedResult);
    });

    it("should return clean result on error", async () => {
      (mockEngine.check as ReturnType<typeof vi.fn>).mockImplementation(() => {
        throw new Error("Engine error");
      });

      const onComplete = vi.fn();
      runGuardrailCheckAsync(mockEngine, mockContext, onComplete);

      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(onComplete).toHaveBeenCalledWith({
        violations: [],
        shouldHalt: false,
        shouldRetry: false,
      });
    });
  });
});
