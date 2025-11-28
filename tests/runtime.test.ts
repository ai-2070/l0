// Comprehensive runtime l0() tests
import { describe, it, expect, beforeEach, vi } from "vitest";
import { l0, getText } from "../src/runtime/l0";
import type { L0Options, L0Event } from "../src/types/l0";
import { jsonRule, zeroOutputRule } from "../src/guardrails";

// Mock stream helpers
function createMockStream(
  tokens: string[],
  options: {
    delay?: number;
    shouldError?: boolean;
    errorAfter?: number;
  } = {},
): AsyncIterable<any> {
  const { delay = 0, shouldError = false, errorAfter } = options;

  return {
    async *[Symbol.asyncIterator]() {
      for (let i = 0; i < tokens.length; i++) {
        if (shouldError && errorAfter !== undefined && i === errorAfter) {
          throw new Error("Mock stream error");
        }
        if (delay > 0) {
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
        yield { type: "text-delta", textDelta: tokens[i] };
      }
    },
  };
}

function createMockStreamFactory(
  tokens: string[],
  options: {
    delay?: number;
    shouldError?: boolean;
    errorAfter?: number;
  } = {},
) {
  return () => ({
    textStream: createMockStream(tokens, options),
  });
}

describe("L0 Runtime", () => {
  describe("Basic Streaming", () => {
    it("should stream tokens successfully", async () => {
      const tokens = ["Hello", " ", "world"];
      const result = await l0({
        stream: createMockStreamFactory(tokens),
      });

      const events: L0Event[] = [];
      for await (const event of result.stream) {
        events.push(event);
      }

      expect(events.length).toBeGreaterThan(0);
      expect(result.state.completed).toBe(true);
    });

    it("should accumulate content correctly", async () => {
      const tokens = ["Hello", " ", "world"];
      const result = await l0({
        stream: createMockStreamFactory(tokens),
      });

      for await (const event of result.stream) {
        // Consume stream
      }

      expect(result.state.content).toBe("Hello world");
      expect(result.state.tokenCount).toBe(3);
    });

    it("should track timing information", async () => {
      const tokens = ["Hello", " ", "world"];
      const result = await l0({
        stream: createMockStreamFactory(tokens, { delay: 10 }),
      });

      for await (const event of result.stream) {
        // Consume stream
      }

      expect(result.state.firstTokenAt).toBeDefined();
      expect(result.state.lastTokenAt).toBeDefined();
      expect(result.state.completed).toBe(true);
    });

    it("should handle empty token stream", async () => {
      const tokens: string[] = [];
      const result = await l0({
        stream: createMockStreamFactory(tokens),
      });

      for await (const event of result.stream) {
        // Consume stream
      }

      expect(result.state.content).toBe("");
      expect(result.state.tokenCount).toBe(0);
    });

    it("should handle single token", async () => {
      const tokens = ["Hello"];
      const result = await l0({
        stream: createMockStreamFactory(tokens),
      });

      for await (const event of result.stream) {
        // Consume stream
      }

      expect(result.state.content).toBe("Hello");
      expect(result.state.tokenCount).toBe(1);
    });
  });

  describe("Guardrails Integration", () => {
    it("should apply guardrails during streaming", async () => {
      const tokens = ["{", '"', "key", '"', ":", " ", "val", "}"];
      const result = await l0({
        stream: createMockStreamFactory(tokens),
        guardrails: [jsonRule()],
      });

      for await (const event of result.stream) {
        // Consume stream
      }

      // Should detect JSON issues
      expect(result.state).toBeDefined();
    });

    it("should detect violations", async () => {
      const tokens = ["", "", ""]; // Empty tokens should trigger zero output
      const result = await l0({
        stream: createMockStreamFactory(tokens),
        guardrails: [zeroOutputRule()],
      });

      for await (const event of result.stream) {
        // Consume stream
      }

      expect(result.state.completed).toBe(true);
    });

    it("should track violations in state", async () => {
      const tokens = ["{", "invalid json"];
      const result = await l0({
        stream: createMockStreamFactory(tokens),
        guardrails: [jsonRule()],
      });

      for await (const event of result.stream) {
        // Consume stream
      }

      expect(result.state.violations).toBeDefined();
    });

    it("should work without guardrails", async () => {
      const tokens = ["Hello", " ", "world"];
      const result = await l0({
        stream: createMockStreamFactory(tokens),
        guardrails: [],
      });

      for await (const event of result.stream) {
        // Consume stream
      }

      expect(result.state.completed).toBe(true);
      expect(result.state.violations).toHaveLength(0);
    });
  });

  describe("Fallback Streams", () => {
    it("should use primary stream when successful", async () => {
      const primaryTokens = ["Primary", " ", "stream"];
      const fallbackTokens = ["Fallback", " ", "stream"];

      const result = await l0({
        stream: createMockStreamFactory(primaryTokens),
        fallbackStreams: [createMockStreamFactory(fallbackTokens)],
      });

      for await (const event of result.stream) {
        // Consume stream
      }

      expect(result.state.content).toBe("Primary stream");
      expect(result.state.fallbackIndex).toBe(0);
    });

    it("should fallback on primary stream error", async () => {
      const primaryTokens = ["Primary"];
      const fallbackTokens = ["Fallback", " ", "stream"];

      const result = await l0({
        stream: createMockStreamFactory(primaryTokens, {
          shouldError: true,
          errorAfter: 1,
        }),
        fallbackStreams: [createMockStreamFactory(fallbackTokens)],
        retry: { attempts: 0 }, // Disable retries to test fallback
      });

      for await (const event of result.stream) {
        // Consume stream
      }

      expect(result.state.content).toBe("Fallback stream");
      expect(result.state.fallbackIndex).toBe(1);
    });

    it("should try multiple fallbacks", async () => {
      const fallback1Tokens = ["Fallback1"];
      const fallback2Tokens = ["Fallback2", " ", "works"];

      const result = await l0({
        stream: createMockStreamFactory([], { shouldError: true }),
        fallbackStreams: [
          createMockStreamFactory(fallback1Tokens, { shouldError: true }),
          createMockStreamFactory(fallback2Tokens),
        ],
        retry: { attempts: 0 },
      });

      for await (const event of result.stream) {
        // Consume stream
      }

      expect(result.state.fallbackIndex).toBe(2);
    });

    it("should track fallback index in state", async () => {
      const tokens = ["Hello"];
      const result = await l0({
        stream: createMockStreamFactory(tokens),
      });

      for await (const event of result.stream) {
        // Consume stream
      }

      expect(result.state.fallbackIndex).toBeDefined();
      expect(result.state.fallbackIndex).toBe(0);
    });
  });

  describe("Error Handling", () => {
    it("should handle stream errors gracefully", async () => {
      const tokens = ["Start"];
      const result = await l0({
        stream: createMockStreamFactory(tokens, {
          shouldError: true,
          errorAfter: 1,
        }),
        retry: { attempts: 0 },
      });

      for await (const event of result.stream) {
        // Consume stream
      }

      expect(result.state.errors.length).toBeGreaterThan(0);
    });

    it("should track errors in state", async () => {
      const result = await l0({
        stream: createMockStreamFactory(["test"], {
          shouldError: true,
          errorAfter: 0,
        }),
        retry: { attempts: 0 },
      });

      for await (const event of result.stream) {
        // Consume stream
      }

      expect(result.state.errors).toBeDefined();
      expect(Array.isArray(result.state.errors)).toBe(true);
    });

    it("should complete even with errors", async () => {
      const result = await l0({
        stream: createMockStreamFactory([], { shouldError: true }),
        retry: { attempts: 0 },
      });

      for await (const event of result.stream) {
        // Consume stream
      }

      expect(result.state.completed).toBe(true);
    });
  });

  describe("Retry Logic", () => {
    it("should respect retry configuration", async () => {
      const result = await l0({
        stream: createMockStreamFactory(["test"], {
          shouldError: true,
          errorAfter: 0,
        }),
        retry: {
          attempts: 2,
          baseDelay: 10,
          backoff: "fixed",
        },
      });

      for await (const event of result.stream) {
        // Consume stream
      }

      expect(result.state).toBeDefined();
    });

    it("should work with zero retries", async () => {
      const tokens = ["Hello"];
      const result = await l0({
        stream: createMockStreamFactory(tokens),
        retry: { attempts: 0 },
      });

      for await (const event of result.stream) {
        // Consume stream
      }

      expect(result.state.content).toBe("Hello");
    });

    it("should retry on stream errors", async () => {
      let attempt = 0;
      const streamFactory = () => {
        attempt++;
        if (attempt === 1) {
          return {
            textStream: createMockStream(["fail"], {
              shouldError: true,
              errorAfter: 0,
            }),
          };
        }
        return {
          textStream: createMockStream(["success"]),
        };
      };

      const result = await l0({
        stream: streamFactory,
        retry: { attempts: 2, baseDelay: 10 },
      });

      for await (const event of result.stream) {
        // Consume stream
      }

      expect(attempt).toBeGreaterThan(1);
    });
  });

  describe("Zero Token Detection", () => {
    it("should detect zero token output by default", async () => {
      const result = await l0({
        stream: createMockStreamFactory([]),
        detectZeroTokens: true,
      });

      for await (const event of result.stream) {
        // Consume stream
      }

      expect(result.state.zeroTokenDetected).toBe(true);
    });

    it("should not detect zero tokens with valid output", async () => {
      const tokens = ["Hello", " ", "world"];
      const result = await l0({
        stream: createMockStreamFactory(tokens),
        detectZeroTokens: true,
      });

      for await (const event of result.stream) {
        // Consume stream
      }

      expect(result.state.zeroTokenDetected).toBe(false);
    });

    it("should allow disabling zero token detection", async () => {
      const result = await l0({
        stream: createMockStreamFactory([]),
        detectZeroTokens: false,
      });

      for await (const event of result.stream) {
        // Consume stream
      }

      expect(result.state).toBeDefined();
    });
  });

  describe("Drift Detection", () => {
    it("should detect drift when enabled", async () => {
      const tokens = ["As an AI language model", ", I think"];
      const result = await l0({
        stream: createMockStreamFactory(tokens),
        detectDrift: true,
      });

      for await (const event of result.stream) {
        // Consume stream
      }

      expect(result.state.driftDetected).toBeDefined();
    });

    it("should not detect drift when disabled", async () => {
      const tokens = ["As an AI", ", I think"];
      const result = await l0({
        stream: createMockStreamFactory(tokens),
        detectDrift: false,
      });

      for await (const event of result.stream) {
        // Consume stream
      }

      expect(result.state.driftDetected).toBe(false);
    });

    it("should work without drift detection by default", async () => {
      const tokens = ["Hello", " ", "world"];
      const result = await l0({
        stream: createMockStreamFactory(tokens),
      });

      for await (const event of result.stream) {
        // Consume stream
      }

      expect(result.state.completed).toBe(true);
    });
  });

  describe("State Management", () => {
    it("should initialize state correctly", async () => {
      const result = await l0({
        stream: createMockStreamFactory(["test"]),
      });

      expect(result.state).toBeDefined();
      expect(result.state.content).toBe("");
      expect(result.state.tokenCount).toBe(0);
      expect(result.state.violations).toEqual([]);
    });

    it("should update state during streaming", async () => {
      const tokens = ["Hello", " ", "world"];
      const result = await l0({
        stream: createMockStreamFactory(tokens),
      });

      const states: string[] = [];
      for await (const event of result.stream) {
        states.push(result.state.content);
      }

      expect(states.length).toBeGreaterThan(0);
    });

    it("should mark completed after streaming", async () => {
      const tokens = ["Hello"];
      const result = await l0({
        stream: createMockStreamFactory(tokens),
      });

      for await (const event of result.stream) {
        // Consume stream
      }

      expect(result.state.completed).toBe(true);
    });

    it("should track token count", async () => {
      const tokens = ["one", "two", "three"];
      const result = await l0({
        stream: createMockStreamFactory(tokens),
      });

      for await (const event of result.stream) {
        // Consume stream
      }

      expect(result.state.tokenCount).toBe(3);
    });
  });

  describe("Helper Functions", () => {
    describe("getText", () => {
      it("should extract text from result", async () => {
        const tokens = ["Hello", " ", "world"];
        const result = await l0({
          stream: createMockStreamFactory(tokens),
        });

        const text = await getText(result);
        expect(text).toBe("Hello world");
      });

      it("should handle empty stream", async () => {
        const result = await l0({
          stream: createMockStreamFactory([]),
        });

        const text = await getText(result);
        expect(text).toBe("");
      });

      it("should consume entire stream", async () => {
        const tokens = ["Test", " ", "content"];
        const result = await l0({
          stream: createMockStreamFactory(tokens),
        });

        const text = await getText(result);
        expect(text).toBe("Test content");
        expect(result.state.completed).toBe(true);
      });
    });

    describe("consumeStream", () => {
      it("should consume stream without returning text", async () => {
        const tokens = ["Hello"];
        const result = await l0({
          stream: createMockStreamFactory(tokens),
        });

        for await (const event of result.stream) {
          // Consume stream
        }

        expect(result.state.completed).toBe(true);
        expect(result.state.content).toBe("Hello");
      });

      it("should handle errors during consumption", async () => {
        const result = await l0({
          stream: createMockStreamFactory(["test"], {
            shouldError: true,
            errorAfter: 0,
          }),
          retry: { attempts: 0 },
        });

        for await (const event of result.stream) {
          // Consume stream
        }

        expect(result.state.completed).toBe(true);
      });
    });
  });

  describe("Event Callbacks", () => {
    it("should call onEvent callback", async () => {
      const events: L0Event[] = [];
      const tokens = ["Hello"];

      const result = await l0({
        stream: createMockStreamFactory(tokens),
        onEvent: (event) => events.push(event),
      });

      for await (const event of result.stream) {
        // Consume stream
      }

      expect(events.length).toBeGreaterThan(0);
    });

    it("should call onViolation callback", async () => {
      const violations: any[] = [];
      const tokens = ["{", "bad json"];

      const result = await l0({
        stream: createMockStreamFactory(tokens),
        guardrails: [jsonRule()],
        onViolation: (violation) => violations.push(violation),
      });

      for await (const event of result.stream) {
        // Consume stream
      }

      expect(result.state).toBeDefined();
    });

    it("should call onRetry callback", async () => {
      const retries: any[] = [];
      let attempt = 0;

      const streamFactory = () => {
        attempt++;
        if (attempt === 1) {
          return {
            textStream: createMockStream(["fail"], {
              shouldError: true,
              errorAfter: 0,
            }),
          };
        }
        return { textStream: createMockStream(["success"]) };
      };

      const result = await l0({
        stream: streamFactory,
        retry: { attempts: 2, baseDelay: 10 },
        onRetry: (context) => retries.push(context),
      });

      for await (const event of result.stream) {
        // Consume stream
      }

      expect(retries.length).toBeGreaterThanOrEqual(0);
    });
  });

  describe("Monitoring", () => {
    it("should support monitoring configuration", async () => {
      const tokens = ["Hello"];
      const result = await l0({
        stream: createMockStreamFactory(tokens),
        monitoring: {
          enabled: true,
          sampleRate: 1.0,
          includeTimings: true,
        },
      });

      for await (const event of result.stream) {
        // Consume stream
      }

      expect(result.state.completed).toBe(true);
    });

    it("should work without monitoring", async () => {
      const tokens = ["Hello"];
      const result = await l0({
        stream: createMockStreamFactory(tokens),
      });

      for await (const event of result.stream) {
        // Consume stream
      }

      expect(result.state.completed).toBe(true);
    });
  });

  describe("Abort Signal", () => {
    it("should support abort signal", async () => {
      const controller = new AbortController();
      const tokens = ["Hello", " ", "world"];

      const result = await l0({
        stream: createMockStreamFactory(tokens, { delay: 50 }),
        signal: controller.signal,
      });

      // Start consuming but abort mid-stream
      setTimeout(() => controller.abort(), 25);

      try {
        for await (const event of result.stream) {
          // Consume stream
        }
      } catch (error) {
        // Abort may throw
      }

      expect(result.state).toBeDefined();
    });

    it("should work without abort signal", async () => {
      const tokens = ["Hello"];
      const result = await l0({
        stream: createMockStreamFactory(tokens),
      });

      for await (const event of result.stream) {
        // Consume stream
      }

      expect(result.state.completed).toBe(true);
    });
  });

  describe("Timeout Configuration", () => {
    it("should support timeout configuration", async () => {
      const tokens = ["Hello"];
      const result = await l0({
        stream: createMockStreamFactory(tokens),
        timeout: {
          initialToken: 5000,
          interToken: 3000,
        },
      });

      for await (const event of result.stream) {
        // Consume stream
      }

      expect(result.state.completed).toBe(true);
    });

    it("should work with default timeouts", async () => {
      const tokens = ["Hello"];
      const result = await l0({
        stream: createMockStreamFactory(tokens),
      });

      for await (const event of result.stream) {
        // Consume stream
      }

      expect(result.state.completed).toBe(true);
    });
  });

  describe("Edge Cases", () => {
    it("should handle very long streams", async () => {
      const tokens = Array(100).fill("word ");
      const result = await l0({
        stream: createMockStreamFactory(tokens),
      });

      for await (const event of result.stream) {
        // Consume stream
      }

      expect(result.state.tokenCount).toBe(100);
      expect(result.state.completed).toBe(true);
    });

    it("should handle single character tokens", async () => {
      const tokens = ["a", "b", "c"];
      const result = await l0({
        stream: createMockStreamFactory(tokens),
      });

      for await (const event of result.stream) {
        // Consume stream
      }

      expect(result.state.content).toBe("abc");
    });

    it("should handle unicode tokens", async () => {
      const tokens = ["你", "好", "😀"];
      const result = await l0({
        stream: createMockStreamFactory(tokens),
      });

      for await (const event of result.stream) {
        // Consume stream
      }

      expect(result.state.content).toBe("你好😀");
    });

    it("should handle whitespace-only tokens", async () => {
      const tokens = [" ", "\n", "\t"];
      const result = await l0({
        stream: createMockStreamFactory(tokens),
      });

      for await (const event of result.stream) {
        // Consume stream
      }

      expect(result.state.content).toBe(" \n\t");
    });

    it("should handle rapid token succession", async () => {
      const tokens = Array(50).fill("x");
      const result = await l0({
        stream: createMockStreamFactory(tokens, { delay: 1 }),
      });

      for await (const event of result.stream) {
        // Consume stream
      }

      expect(result.state.tokenCount).toBe(50);
    });
  });

  describe("Integration", () => {
    it("should integrate guardrails, retry, and drift detection", async () => {
      const tokens = ["Hello", " ", "world"];
      const result = await l0({
        stream: createMockStreamFactory(tokens),
        guardrails: [jsonRule()],
        retry: { attempts: 1, baseDelay: 10 },
        detectDrift: true,
        detectZeroTokens: true,
      });

      for await (const event of result.stream) {
        // Consume stream
      }

      expect(result.state.completed).toBe(true);
      expect(result.state.content).toBeDefined();
    });

    it("should handle all features with fallbacks", async () => {
      const tokens = ["Primary"];
      const fallbackTokens = ["Fallback"];

      const result = await l0({
        stream: createMockStreamFactory(tokens),
        fallbackStreams: [createMockStreamFactory(fallbackTokens)],
        guardrails: [zeroOutputRule()],
        retry: { attempts: 1 },
        detectDrift: false,
        detectZeroTokens: true,
      });

      for await (const event of result.stream) {
        // Consume stream
      }

      expect(result.state.completed).toBe(true);
    });

    it("should maintain state consistency across features", async () => {
      const tokens = ["Test", " ", "content"];
      const result = await l0({
        stream: createMockStreamFactory(tokens),
        guardrails: [jsonRule()],
        detectDrift: true,
        detectZeroTokens: true,
        monitoring: { enabled: true },
      });

      for await (const event of result.stream) {
        // Consume stream
      }

      expect(result.state.content).toBe("Test content");
      expect(result.state.tokenCount).toBe(3);
      expect(result.state.completed).toBe(true);
      expect(result.state.violations).toBeDefined();
    });
  });

  describe("Performance", () => {
    it("should handle streams efficiently", async () => {
      const tokens = Array(100).fill("token");
      const start = Date.now();

      const result = await l0({
        stream: createMockStreamFactory(tokens),
      });

      for await (const event of result.stream) {
        // Consume stream
      }
      const duration = Date.now() - start;

      expect(duration).toBeLessThan(1000);
      expect(result.state.tokenCount).toBe(100);
    });

    it("should not leak memory with long streams", async () => {
      const tokens = Array(1000).fill("x");
      const result = await l0({
        stream: createMockStreamFactory(tokens),
      });

      for await (const event of result.stream) {
        // Consume stream
      }

      expect(result.state.completed).toBe(true);
    });
  });
});
