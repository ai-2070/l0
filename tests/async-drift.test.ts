import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  runAsyncDriftCheck,
  runDriftCheckAsync,
} from "../src/runtime/async-drift";
import type { DriftDetector } from "../src/runtime/drift";

// Mock setImmediate for controlled async testing
vi.stubGlobal(
  "setImmediate",
  (fn: () => void) => setTimeout(fn, 0) as unknown as NodeJS.Immediate,
);

describe("Async Drift Detection", () => {
  let mockDetector: DriftDetector;

  beforeEach(() => {
    mockDetector = {
      check: vi.fn().mockReturnValue({
        detected: false,
        types: [],
        confidence: 0,
      }),
    } as unknown as DriftDetector;
  });

  describe("runAsyncDriftCheck", () => {
    it("should return immediately if delta shows drift", () => {
      (mockDetector.check as ReturnType<typeof vi.fn>).mockReturnValue({
        detected: true,
        types: ["meta-commentary"],
        confidence: 0.9,
      });

      const onComplete = vi.fn();
      const result = runAsyncDriftCheck(
        mockDetector,
        "content",
        "As an AI",
        onComplete,
      );

      expect(result).toBeDefined();
      expect(result!.detected).toBe(true);
      expect(result!.types).toContain("meta-commentary");
      expect(onComplete).not.toHaveBeenCalled();
    });

    it("should run sync check for small content when delta is clean", () => {
      const onComplete = vi.fn();
      const result = runAsyncDriftCheck(
        mockDetector,
        "small content",
        "delta",
        onComplete,
      );

      expect(result).toBeDefined();
      expect(mockDetector.check).toHaveBeenCalledTimes(2); // Once for delta, once for full
    });

    it("should defer to async for large content with delta", async () => {
      const largeContent = "x".repeat(15000);

      const onComplete = vi.fn();
      const result = runAsyncDriftCheck(
        mockDetector,
        largeContent,
        "delta",
        onComplete,
      );

      expect(result).toBeUndefined(); // Deferred

      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(onComplete).toHaveBeenCalled();
    });

    it("should run sync for small content without delta", () => {
      const onComplete = vi.fn();
      const result = runAsyncDriftCheck(
        mockDetector,
        "small",
        undefined,
        onComplete,
      );

      expect(result).toBeDefined();
      expect(mockDetector.check).toHaveBeenCalledWith("small", undefined);
    });

    it("should defer for large content without delta", async () => {
      const largeContent = "x".repeat(15000);

      const onComplete = vi.fn();
      const result = runAsyncDriftCheck(
        mockDetector,
        largeContent,
        undefined,
        onComplete,
      );

      expect(result).toBeUndefined();

      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(onComplete).toHaveBeenCalled();
    });

    it("should run sync for small content even with large delta", () => {
      // When delta is large (>1000), it skips the delta check
      // But if content is small (<10000), it runs sync check anyway
      const largeDelta = "x".repeat(1500);

      const onComplete = vi.fn();
      const result = runAsyncDriftCheck(
        mockDetector,
        "content",
        largeDelta,
        onComplete,
      );

      // Small content runs synchronously
      expect(result).toBeDefined();
      expect(mockDetector.check).toHaveBeenCalledWith("content", largeDelta);
    });

    it("should return clean result on error in async path", async () => {
      (mockDetector.check as ReturnType<typeof vi.fn>).mockImplementation(
        () => {
          throw new Error("Detector error");
        },
      );

      const largeContent = "x".repeat(15000);
      const onComplete = vi.fn();

      runAsyncDriftCheck(mockDetector, largeContent, undefined, onComplete);

      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(onComplete).toHaveBeenCalledWith({
        detected: false,
        types: [],
      });
    });
  });

  describe("runDriftCheckAsync", () => {
    it("should always call onComplete asynchronously", async () => {
      const onComplete = vi.fn();

      runDriftCheckAsync(mockDetector, "content", "delta", onComplete);

      expect(onComplete).not.toHaveBeenCalled();

      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(onComplete).toHaveBeenCalled();
    });

    it("should pass detector result to onComplete", async () => {
      const expectedResult = {
        detected: true,
        types: ["repetition"],
        confidence: 0.8,
      };
      (mockDetector.check as ReturnType<typeof vi.fn>).mockReturnValue(
        expectedResult,
      );

      const onComplete = vi.fn();
      runDriftCheckAsync(mockDetector, "content", "delta", onComplete);

      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(onComplete).toHaveBeenCalledWith(expectedResult);
    });

    it("should return clean result on error", async () => {
      (mockDetector.check as ReturnType<typeof vi.fn>).mockImplementation(
        () => {
          throw new Error("Detector error");
        },
      );

      const onComplete = vi.fn();
      runDriftCheckAsync(mockDetector, "content", "delta", onComplete);

      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(onComplete).toHaveBeenCalledWith({
        detected: false,
        types: [],
      });
    });

    it("should handle undefined delta", async () => {
      const onComplete = vi.fn();
      runDriftCheckAsync(mockDetector, "content", undefined, onComplete);

      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(mockDetector.check).toHaveBeenCalledWith("content", undefined);
      expect(onComplete).toHaveBeenCalled();
    });
  });
});
