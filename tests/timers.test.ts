import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  exponentialBackoff,
  linearBackoff,
  fixedBackoff,
  fixedJitterBackoff,
  fullJitterBackoff,
  decorrelatedJitterBackoff,
  calculateBackoff,
  sleep,
  timeout,
  withTimeout,
  Timer,
  debounce,
  throttle,
} from "../src/utils/timers";

describe("Timer Utilities", () => {
  describe("exponentialBackoff", () => {
    it("should calculate exponential delays", () => {
      expect(exponentialBackoff(0, 1000, 10000).delay).toBe(1000);
      expect(exponentialBackoff(1, 1000, 10000).delay).toBe(2000);
      expect(exponentialBackoff(2, 1000, 10000).delay).toBe(4000);
      expect(exponentialBackoff(3, 1000, 10000).delay).toBe(8000);
    });

    it("should cap at maxDelay", () => {
      const result = exponentialBackoff(10, 1000, 10000);
      expect(result.delay).toBe(10000);
      expect(result.cappedAtMax).toBe(true);
    });

    it("should track raw delay before capping", () => {
      const result = exponentialBackoff(5, 1000, 10000);
      expect(result.rawDelay).toBe(32000);
      expect(result.delay).toBe(10000);
    });

    it("should use default values", () => {
      const result = exponentialBackoff(0);
      expect(result.delay).toBe(1000);
    });
  });

  describe("linearBackoff", () => {
    it("should calculate linear delays", () => {
      expect(linearBackoff(0, 1000, 10000).delay).toBe(1000);
      expect(linearBackoff(1, 1000, 10000).delay).toBe(2000);
      expect(linearBackoff(2, 1000, 10000).delay).toBe(3000);
    });

    it("should cap at maxDelay", () => {
      const result = linearBackoff(20, 1000, 10000);
      expect(result.delay).toBe(10000);
      expect(result.cappedAtMax).toBe(true);
    });

    it("should use default values", () => {
      const result = linearBackoff(0);
      expect(result.delay).toBe(1000);
    });
  });

  describe("fixedBackoff", () => {
    it("should return constant delay", () => {
      expect(fixedBackoff(500).delay).toBe(500);
      expect(fixedBackoff(500).cappedAtMax).toBe(false);
    });

    it("should use default value", () => {
      expect(fixedBackoff().delay).toBe(1000);
    });
  });

  describe("fixedJitterBackoff", () => {
    it("should return delay with jitter", () => {
      const result = fixedJitterBackoff(1000, 10000);
      expect(result.delay).toBeGreaterThanOrEqual(1000);
      expect(result.delay).toBeLessThanOrEqual(1500);
    });

    it("should cap at maxDelay", () => {
      const result = fixedJitterBackoff(20000, 10000);
      expect(result.delay).toBeLessThanOrEqual(10000);
    });
  });

  describe("fullJitterBackoff", () => {
    it("should return random delay up to exponential", () => {
      const results = Array.from({ length: 10 }, () =>
        fullJitterBackoff(2, 1000, 10000)
      );

      results.forEach((result) => {
        expect(result.delay).toBeGreaterThanOrEqual(0);
        expect(result.delay).toBeLessThanOrEqual(4000);
      });
    });

    it("should cap exponential at maxDelay before jitter", () => {
      const result = fullJitterBackoff(10, 1000, 5000);
      expect(result.delay).toBeLessThanOrEqual(5000);
      expect(result.cappedAtMax).toBe(true);
    });
  });

  describe("decorrelatedJitterBackoff", () => {
    it("should return jittered delay", () => {
      const result = decorrelatedJitterBackoff(1, 1000, 10000);
      expect(result.delay).toBeGreaterThanOrEqual(0);
      expect(result.delay).toBeLessThanOrEqual(10000);
    });

    it("should use previous delay for decorrelation", () => {
      const result = decorrelatedJitterBackoff(1, 1000, 10000, 2000);
      expect(result.delay).toBeGreaterThanOrEqual(0);
    });

    it("should cap at maxDelay", () => {
      const result = decorrelatedJitterBackoff(5, 1000, 5000, 10000);
      expect(result.delay).toBeLessThanOrEqual(5000);
    });
  });

  describe("calculateBackoff", () => {
    it("should dispatch to exponential strategy", () => {
      const result = calculateBackoff("exponential", 2, 1000, 10000);
      expect(result.delay).toBe(4000);
    });

    it("should dispatch to linear strategy", () => {
      const result = calculateBackoff("linear", 2, 1000, 10000);
      expect(result.delay).toBe(3000);
    });

    it("should dispatch to fixed strategy", () => {
      const result = calculateBackoff("fixed", 5, 1000, 10000);
      expect(result.delay).toBe(1000);
    });

    it("should dispatch to full-jitter strategy", () => {
      const result = calculateBackoff("full-jitter", 2, 1000, 10000);
      expect(result.delay).toBeLessThanOrEqual(4000);
    });

    it("should dispatch to fixed-jitter strategy", () => {
      const result = calculateBackoff("fixed-jitter", 2, 1000, 10000);
      expect(result.delay).toBeGreaterThanOrEqual(1000);
    });

    it("should default to exponential for unknown strategy", () => {
      const result = calculateBackoff("unknown" as any, 2, 1000, 10000);
      expect(result.delay).toBe(4000);
    });
  });

  describe("sleep", () => {
    it("should delay execution", async () => {
      const start = Date.now();
      await sleep(50);
      const elapsed = Date.now() - start;
      expect(elapsed).toBeGreaterThanOrEqual(40);
    });
  });

  describe("timeout", () => {
    it("should reject after specified time", async () => {
      await expect(timeout(10, "Test timeout")).rejects.toThrow("Test timeout");
    });

    it("should use default message", async () => {
      await expect(timeout(10)).rejects.toThrow("Timeout");
    });
  });

  describe("withTimeout", () => {
    it("should return promise result if faster than timeout", async () => {
      const result = await withTimeout(
        Promise.resolve("success"),
        100
      );
      expect(result).toBe("success");
    });

    it("should reject if timeout is reached", async () => {
      const slowPromise = new Promise((resolve) => setTimeout(resolve, 200));
      await expect(
        withTimeout(slowPromise, 10, "Too slow")
      ).rejects.toThrow("Too slow");
    });
  });

  describe("Timer", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("should track elapsed time", () => {
      const timer = new Timer();
      timer.start();
      vi.advanceTimersByTime(100);
      expect(timer.elapsed()).toBe(100);
    });

    it("should return 0 if not started", () => {
      const timer = new Timer();
      expect(timer.elapsed()).toBe(0);
    });

    it("should stop tracking on stop()", () => {
      const timer = new Timer();
      timer.start();
      vi.advanceTimersByTime(100);
      timer.stop();
      vi.advanceTimersByTime(100);
      expect(timer.elapsed()).toBe(100);
    });

    it("should pause and resume", () => {
      const timer = new Timer();
      timer.start();
      vi.advanceTimersByTime(50);
      timer.pause();
      vi.advanceTimersByTime(100); // Paused, shouldn't count
      timer.resume();
      vi.advanceTimersByTime(50);
      expect(timer.elapsed()).toBe(100);
    });

    it("should reset timer", () => {
      const timer = new Timer();
      timer.start();
      vi.advanceTimersByTime(100);
      timer.reset();
      expect(timer.elapsed()).toBe(0);
      expect(timer.isRunning()).toBe(false);
    });

    it("should report running state", () => {
      const timer = new Timer();
      expect(timer.isRunning()).toBe(false);
      timer.start();
      expect(timer.isRunning()).toBe(true);
      timer.pause();
      expect(timer.isRunning()).toBe(false);
      timer.resume();
      expect(timer.isRunning()).toBe(true);
      timer.stop();
      expect(timer.isRunning()).toBe(false);
    });

    it("should report paused state", () => {
      const timer = new Timer();
      expect(timer.isPaused()).toBe(false);
      timer.start();
      expect(timer.isPaused()).toBe(false);
      timer.pause();
      expect(timer.isPaused()).toBe(true);
      timer.resume();
      expect(timer.isPaused()).toBe(false);
    });

    it("should handle pause before start", () => {
      const timer = new Timer();
      timer.pause(); // Should be no-op
      expect(timer.isPaused()).toBe(false);
    });

    it("should handle resume without pause", () => {
      const timer = new Timer();
      timer.start();
      timer.resume(); // Should be no-op
      expect(timer.isRunning()).toBe(true);
    });

    it("should handle stop before start", () => {
      const timer = new Timer();
      timer.stop(); // Should be no-op
      expect(timer.elapsed()).toBe(0);
    });

    it("should handle stop while paused", () => {
      const timer = new Timer();
      timer.start();
      vi.advanceTimersByTime(50);
      timer.pause();
      vi.advanceTimersByTime(100);
      timer.stop();
      expect(timer.elapsed()).toBe(50);
    });
  });

  describe("debounce", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("should delay function execution", () => {
      const fn = vi.fn();
      const debounced = debounce(fn, 100);

      debounced();
      expect(fn).not.toHaveBeenCalled();

      vi.advanceTimersByTime(100);
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it("should reset delay on repeated calls", () => {
      const fn = vi.fn();
      const debounced = debounce(fn, 100);

      debounced();
      vi.advanceTimersByTime(50);
      debounced(); // Reset
      vi.advanceTimersByTime(50);
      expect(fn).not.toHaveBeenCalled();

      vi.advanceTimersByTime(50);
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it("should pass arguments to function", () => {
      const fn = vi.fn();
      const debounced = debounce(fn, 100);

      debounced("arg1", "arg2");
      vi.advanceTimersByTime(100);

      expect(fn).toHaveBeenCalledWith("arg1", "arg2");
    });
  });

  describe("throttle", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("should call immediately on first invocation", () => {
      const fn = vi.fn();
      const throttled = throttle(fn, 100);

      throttled();
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it("should prevent calls within delay period", () => {
      const fn = vi.fn();
      const throttled = throttle(fn, 100);

      throttled();
      throttled();
      throttled();
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it("should allow call after delay", () => {
      const fn = vi.fn();
      const throttled = throttle(fn, 100);

      throttled();
      vi.advanceTimersByTime(100);
      throttled();
      expect(fn).toHaveBeenCalledTimes(2);
    });

    it("should queue trailing call", () => {
      const fn = vi.fn();
      const throttled = throttle(fn, 100);

      throttled("first");
      throttled("second"); // Queued
      expect(fn).toHaveBeenCalledTimes(1);

      vi.advanceTimersByTime(100);
      expect(fn).toHaveBeenCalledTimes(2);
      expect(fn).toHaveBeenLastCalledWith("second");
    });

    it("should pass arguments to function", () => {
      const fn = vi.fn();
      const throttled = throttle(fn, 100);

      throttled("arg1", "arg2");
      expect(fn).toHaveBeenCalledWith("arg1", "arg2");
    });
  });
});
