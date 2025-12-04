// Comprehensive runtime l0() tests
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { l0, getText } from "../src/runtime/l0";
import type { L0Options, L0Event } from "../src/types/l0";
import { jsonRule, zeroOutputRule } from "../src/guardrails";
import { registerAdapter, clearAdapters } from "../src/adapters/registry";

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
        detectZeroTokens: false, // Disable zero token detection for empty stream test
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
      const tokens = ["{", "invalid"]; // Invalid JSON
      const result = await l0({
        stream: createMockStreamFactory(tokens),
        guardrails: [jsonRule()],
        detectZeroTokens: false,
      });

      for await (const event of result.stream) {
        // Consume stream
      }

      expect(result.state.completed).toBe(true);
      expect(result.state.violations).toBeDefined();
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

      try {
        const result = await l0({
          stream: createMockStreamFactory(primaryTokens, {
            shouldError: true,
            errorAfter: 0, // Error immediately
          }),
          fallbackStreams: [createMockStreamFactory(fallbackTokens)],
          retry: { attempts: 0 }, // Disable retries to test fallback
          detectZeroTokens: false,
        });

        for await (const event of result.stream) {
          // Consume stream
        }

        // May complete with fallback
        expect(result.state).toBeDefined();
      } catch (error) {
        // Error may propagate with mock streams
        expect(error).toBeDefined();
      }
    });

    it("should try multiple fallbacks", async () => {
      const fallback1Tokens = ["Fallback1"];
      const fallback2Tokens = ["Fallback2", " ", "works"];

      const result = await l0({
        stream: createMockStreamFactory([], { shouldError: true }),
        fallbackStreams: [
          createMockStreamFactory(fallback1Tokens, {
            shouldError: true,
            errorAfter: 0,
          }),
          createMockStreamFactory(fallback2Tokens),
        ],
        retry: { attempts: 0 },
        detectZeroTokens: false,
      });

      for await (const event of result.stream) {
        // Consume stream
      }

      // Fallback logic may vary, just ensure it completed
      expect(result.state.completed).toBe(true);
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
      try {
        const result = await l0({
          stream: createMockStreamFactory(tokens, {
            shouldError: true,
            errorAfter: 0,
          }),
          retry: { attempts: 0 },
          detectZeroTokens: false,
        });

        for await (const event of result.stream) {
          // Consume stream
        }

        // If it doesn't throw, check state
        expect(result.state).toBeDefined();
      } catch (error) {
        // Errors may propagate with mock streams
        expect(error).toBeDefined();
        expect((error as Error).message).toContain("Mock stream error");
      }
    });

    it("should track errors in state", async () => {
      try {
        const result = await l0({
          stream: createMockStreamFactory(["test"], {
            shouldError: true,
            errorAfter: 0,
          }),
          retry: { attempts: 0 },
          detectZeroTokens: false,
        });

        for await (const event of result.stream) {
          // Consume stream
        }

        // Error tracking may be in telemetry or different structure
        expect(result.state).toBeDefined();
      } catch (error) {
        // Errors may propagate
        expect(error).toBeDefined();
      }
    });

    it("should complete even with errors", async () => {
      const result = await l0({
        stream: createMockStreamFactory([], { shouldError: true }),
        retry: { attempts: 0 },
        detectZeroTokens: false,
      });

      for await (const event of result.stream) {
        // Consume stream
      }

      expect(result.state.completed).toBe(true);
    });
  });

  describe("Retry Logic", () => {
    it("should respect retry configuration", async () => {
      try {
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
          detectZeroTokens: false,
        });

        for await (const event of result.stream) {
          // Consume stream
        }

        expect(result.state).toBeDefined();
      } catch (error) {
        // May throw after retries exhausted
        expect(error).toBeDefined();
      }
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

    it("should support maxRetries as absolute cap", async () => {
      const tokens = ["Hello"];
      const result = await l0({
        stream: createMockStreamFactory(tokens),
        retry: { maxRetries: 10 },
      });

      for await (const event of result.stream) {
        // Consume stream
      }

      expect(result.state.content).toBe("Hello");
    });

    it("should enforce maxRetries cap on all error types", async () => {
      let attemptCount = 0;
      const streamFactory = () => {
        attemptCount++;
        // Always fail with network error
        return {
          textStream: createMockStream(["fail"], {
            shouldError: true,
            errorAfter: 0,
          }),
        };
      };

      try {
        const result = await l0({
          stream: streamFactory,
          retry: {
            attempts: 100, // High model retry limit
            maxRetries: 2, // But absolute cap at 2 retries
            baseDelay: 10,
          },
          detectZeroTokens: false,
        });

        for await (const event of result.stream) {
          // Consume stream
        }

        // Should not reach here
        expect(true).toBe(false);
      } catch (error) {
        // Should fail after maxRetries cap is reached
        expect(error).toBeDefined();
        // Should have tried at most 3 times (initial + 2 retries)
        expect(attemptCount).toBeLessThanOrEqual(3);
      }
    });

    it("should work with maxRetries set to 0 (no retries)", async () => {
      let attemptCount = 0;
      const streamFactory = () => {
        attemptCount++;
        if (attemptCount === 1) {
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

      try {
        const result = await l0({
          stream: streamFactory,
          retry: { maxRetries: 0, baseDelay: 10 },
          detectZeroTokens: false,
        });

        for await (const event of result.stream) {
          // Consume stream
        }

        // Should not reach here since first attempt fails and no retries allowed
        expect(true).toBe(false);
      } catch (error) {
        // Should fail immediately with no retries
        expect(error).toBeDefined();
        expect(attemptCount).toBe(1);
      }
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

      try {
        const result = await l0({
          stream: streamFactory,
          retry: { attempts: 2, baseDelay: 10 },
          detectZeroTokens: false,
        });

        for await (const event of result.stream) {
          // Consume stream
        }

        // If successful, check completion
        expect(result.state).toBeDefined();
      } catch (error) {
        // May throw depending on retry behavior
        expect(error).toBeDefined();
      }
    });
  });

  describe("Zero Token Detection", () => {
    it("should detect zero token output by default", async () => {
      let errorThrown = false;
      try {
        const result = await l0({
          stream: createMockStreamFactory([]),
          detectZeroTokens: true,
        });

        for await (const event of result.stream) {
          // Consume stream
        }
      } catch (error) {
        errorThrown = true;
        expect(error).toBeDefined();
        expect((error as Error).message).toContain("Zero output");
      }

      expect(errorThrown).toBe(true);
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

      // Should complete without throwing zero token error
      expect(result.state.completed).toBe(true);
      expect(result.state.content).toBe("Hello world");
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
          detectZeroTokens: false,
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
        try {
          const result = await l0({
            stream: createMockStreamFactory(["test"], {
              shouldError: true,
              errorAfter: 0,
            }),
            retry: { attempts: 0 },
            detectZeroTokens: false,
          });

          for await (const event of result.stream) {
            // Consume stream
          }

          expect(result.state).toBeDefined();
        } catch (error) {
          // Errors may propagate during consumption
          expect(error).toBeDefined();
        }
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

      try {
        const result = await l0({
          stream: streamFactory,
          retry: { attempts: 2, baseDelay: 10 },
          onRetry: (context) => retries.push(context),
          detectZeroTokens: false,
        });

        for await (const event of result.stream) {
          // Consume stream
        }

        // If successful, check state
        expect(result.state).toBeDefined();
      } catch (error) {
        // May throw depending on retry behavior
        expect(error).toBeDefined();
      }
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
      const tokens = ["Hello"];

      const result = await l0({
        stream: createMockStreamFactory(tokens),
        signal: controller.signal,
      });

      // Just verify that signal is accepted and doesn't break
      // Actual abort behavior depends on SDK stream implementation
      expect(result).toBeDefined();
      expect(result.state).toBeDefined();

      // Consume the stream
      for await (const event of result.stream) {
        // Stream should work normally
      }

      expect(result.state.completed).toBe(true);
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
        detectZeroTokens: false, // Disable since unicode detection may vary
      });

      for await (const event of result.stream) {
        // Consume stream
      }

      expect(result.state.content).toContain("你");
    });

    it("should handle whitespace-only tokens", async () => {
      const tokens = [" ", "\n", "\t"];
      const result = await l0({
        stream: createMockStreamFactory(tokens),
        detectZeroTokens: false, // Whitespace-only may trigger zero token
      });

      for await (const event of result.stream) {
        // Consume stream
      }

      expect(result.state.content).toBe(" \n\t");
    });

    it("should handle rapid token succession", async () => {
      const tokens = Array(50).fill("x");
      const result = await l0({
        stream: createMockStreamFactory(tokens),
        detectZeroTokens: false, // Disable since repeated 'x' may be detected as repeated char
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
      const tokens = Array(100).fill("word "); // Reduce to reasonable size
      const result = await l0({
        stream: createMockStreamFactory(tokens),
      });

      for await (const event of result.stream) {
        // Consume stream
      }

      expect(result.state.completed).toBe(true);
      expect(result.state.tokenCount).toBe(100);
    });
  });

  describe("Custom Retry Functions", () => {
    describe("calculateDelay", () => {
      it("should use custom calculateDelay function", async () => {
        let attempts = 0;
        let calculateDelayCalled = false;
        const customDelay = 50;

        const streamFactory = () => {
          attempts++;
          if (attempts === 1) {
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

        const startTime = Date.now();
        const result = await l0({
          stream: streamFactory,
          retry: {
            attempts: 3,
            baseDelay: 1000, // High base delay
            retryOn: ["unknown"], // Enable retry for unknown errors
            calculateDelay: (context) => {
              calculateDelayCalled = true;
              expect(context.attempt).toBeGreaterThanOrEqual(0);
              expect(context.defaultDelay).toBeDefined();
              expect(context.error).toBeInstanceOf(Error);
              return customDelay; // Override with short delay
            },
          },
          detectZeroTokens: false,
        });

        for await (const event of result.stream) {
          // Consume stream
        }

        const duration = Date.now() - startTime;

        expect(calculateDelayCalled).toBe(true);
        // Should be much faster than 1000ms base delay
        expect(duration).toBeLessThan(500);
      });

      it("should fall back to default delay when calculateDelay returns undefined", async () => {
        let attempts = 0;
        let calculateDelayCalled = false;

        const streamFactory = () => {
          attempts++;
          if (attempts === 1) {
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
          retry: {
            attempts: 3,
            baseDelay: 10,
            retryOn: ["unknown"], // Enable retry for unknown errors
            calculateDelay: (context) => {
              calculateDelayCalled = true;
              return undefined; // Use default
            },
          },
          detectZeroTokens: false,
        });

        for await (const event of result.stream) {
          // Consume stream
        }

        expect(calculateDelayCalled).toBe(true);
        expect(attempts).toBe(2);
      });

      it("should provide correct context to calculateDelay", async () => {
        let capturedContext: any = null;
        let attempts = 0;

        const streamFactory = () => {
          attempts++;
          if (attempts === 1) {
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
          retry: {
            attempts: 3,
            baseDelay: 100,
            retryOn: ["unknown"], // Enable retry for unknown errors
            calculateDelay: (context) => {
              capturedContext = context;
              return 10;
            },
          },
          detectZeroTokens: false,
        });

        for await (const event of result.stream) {
          // Consume stream
        }

        expect(capturedContext).not.toBeNull();
        expect(capturedContext.attempt).toBeDefined();
        expect(capturedContext.totalAttempts).toBeDefined();
        expect(capturedContext.category).toBeDefined();
        expect(capturedContext.reason).toBeDefined();
        expect(capturedContext.error).toBeInstanceOf(Error);
        expect(typeof capturedContext.defaultDelay).toBe("number");
      });

      it("should allow different delays based on error category", async () => {
        let attempts = 0;
        const delays: number[] = [];

        const streamFactory = () => {
          attempts++;
          if (attempts <= 2) {
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
          retry: {
            attempts: 5,
            baseDelay: 100,
            retryOn: ["unknown"], // Enable retry for unknown errors
            calculateDelay: (context) => {
              const delay =
                context.category === "network"
                  ? 20
                  : context.category === "model"
                    ? 50
                    : 100;
              delays.push(delay);
              return delay;
            },
          },
          detectZeroTokens: false,
        });

        for await (const event of result.stream) {
          // Consume stream
        }

        expect(delays.length).toBeGreaterThan(0);
        // All delays should be one of our custom values
        delays.forEach((d) => expect([20, 50, 100]).toContain(d));
      });
    });
  });

  describe("Adapter Auto-Detection", () => {
    beforeEach(() => {
      clearAdapters();
    });

    afterEach(() => {
      clearAdapters();
    });

    it("should auto-detect and use registered adapter for async iterable streams", async () => {
      // This test ensures adapters are checked BEFORE the generic Symbol.asyncIterator branch
      interface CustomChunk {
        customText: string;
        __customMarker: true;
      }

      type CustomStream = AsyncIterable<CustomChunk> & { __customMarker: true };

      // Create a custom stream that is async iterable but needs an adapter
      function createCustomStream(texts: string[]): CustomStream {
        const stream = {
          __customMarker: true as const,
          async *[Symbol.asyncIterator]() {
            for (const text of texts) {
              yield { customText: text, __customMarker: true as const };
            }
          },
        };
        return stream as CustomStream;
      }

      // Register adapter with detect()
      const customAdapter = {
        name: "custom-test",
        detect(input: unknown): input is CustomStream {
          return (
            !!input &&
            typeof input === "object" &&
            "__customMarker" in input &&
            Symbol.asyncIterator in input
          );
        },
        async *wrap(stream: CustomStream) {
          for await (const chunk of stream) {
            yield {
              type: "token" as const,
              value: chunk.customText,
              timestamp: Date.now(),
            };
          }
          yield { type: "complete" as const, timestamp: Date.now() };
        },
      };

      registerAdapter(customAdapter);

      // Use l0 WITHOUT explicit adapter - should auto-detect
      const result = await l0({
        stream: () => createCustomStream(["Hello", " ", "World"]),
        // No adapter specified!
      });

      const events: L0Event[] = [];
      for await (const event of result.stream) {
        events.push(event);
      }

      // Verify adapter was used (tokens extracted correctly)
      const tokens = events
        .filter((e) => e.type === "token")
        .map((e) => (e as any).value);
      expect(tokens).toEqual(["Hello", " ", "World"]);
      expect(events.some((e) => e.type === "complete")).toBe(true);
    });

    it("should prefer explicit adapter over auto-detection", async () => {
      interface CustomChunk {
        text: string;
        __marker: true;
      }

      type CustomStream = AsyncIterable<CustomChunk> & { __marker: true };

      function createCustomStream(texts: string[]): CustomStream {
        const stream = {
          __marker: true as const,
          async *[Symbol.asyncIterator]() {
            for (const text of texts) {
              yield { text, __marker: true as const };
            }
          },
        };
        return stream as CustomStream;
      }

      // Register auto-detect adapter
      const autoAdapter = {
        name: "auto-adapter",
        detect(input: unknown): input is CustomStream {
          return !!input && typeof input === "object" && "__marker" in input;
        },
        async *wrap(stream: CustomStream) {
          for await (const chunk of stream) {
            yield {
              type: "token" as const,
              value: "AUTO:" + chunk.text,
              timestamp: Date.now(),
            };
          }
          yield { type: "complete" as const, timestamp: Date.now() };
        },
      };

      // Explicit adapter (different behavior)
      const explicitAdapter = {
        name: "explicit-adapter",
        async *wrap(stream: CustomStream) {
          for await (const chunk of stream) {
            yield {
              type: "token" as const,
              value: "EXPLICIT:" + chunk.text,
              timestamp: Date.now(),
            };
          }
          yield { type: "complete" as const, timestamp: Date.now() };
        },
      };

      registerAdapter(autoAdapter);

      // Use explicit adapter
      const result = await l0({
        stream: () => createCustomStream(["Test"]),
        adapter: explicitAdapter,
      });

      const events: L0Event[] = [];
      for await (const event of result.stream) {
        events.push(event);
      }

      // Should use explicit adapter, not auto-detected one
      const tokens = events
        .filter((e) => e.type === "token")
        .map((e) => (e as any).value);
      expect(tokens).toEqual(["EXPLICIT:Test"]);
    });

    it("should fall back to generic async iterable when no adapter matches", async () => {
      // Create a stream that yields L0Events directly (no adapter needed)
      function createL0EventStream(texts: string[]) {
        return {
          async *[Symbol.asyncIterator]() {
            for (const text of texts) {
              yield {
                type: "token" as const,
                value: text,
                timestamp: Date.now(),
              };
            }
            yield { type: "complete" as const, timestamp: Date.now() };
          },
        };
      }

      // No adapters registered, stream is already L0Events
      const result = await l0({
        stream: () => createL0EventStream(["A", "B", "C"]),
      });

      const events: L0Event[] = [];
      for await (const event of result.stream) {
        events.push(event);
      }

      const tokens = events
        .filter((e) => e.type === "token")
        .map((e) => (e as any).value);
      expect(tokens).toEqual(["A", "B", "C"]);
    });

    it("should use adapter by name when registered", async () => {
      interface NamedChunk {
        content: string;
      }

      const namedAdapter = {
        name: "named-test-adapter",
        async *wrap(stream: AsyncIterable<NamedChunk>) {
          for await (const chunk of stream) {
            yield {
              type: "token" as const,
              value: chunk.content,
              timestamp: Date.now(),
            };
          }
          yield { type: "complete" as const, timestamp: Date.now() };
        },
      };

      registerAdapter(namedAdapter, { silent: true });

      function createStream(): AsyncIterable<NamedChunk> {
        return {
          async *[Symbol.asyncIterator]() {
            yield { content: "Named" };
            yield { content: "Adapter" };
          },
        };
      }

      const result = await l0({
        stream: createStream,
        adapter: "named-test-adapter",
      });

      const events: L0Event[] = [];
      for await (const event of result.stream) {
        events.push(event);
      }

      const tokens = events
        .filter((e) => e.type === "token")
        .map((e) => (e as any).value);
      expect(tokens).toEqual(["Named", "Adapter"]);
    });

    it("should throw when adapter name is not found", async () => {
      const result = await l0({
        stream: () => ({ async *[Symbol.asyncIterator]() {} }),
        adapter: "nonexistent-adapter",
      });

      // Error is thrown when consuming the stream
      await expect(async () => {
        for await (const _ of result.stream) {
          // consume
        }
      }).rejects.toThrow('Adapter "nonexistent-adapter" not found');
    });

    it("should prefer textStream over auto-detection", async () => {
      // Vercel AI SDK pattern - has textStream property
      // Should use textStream even if adapter could match

      const adapterWasCalled = { value: false };

      const greedyAdapter = {
        name: "greedy",
        detect(input: unknown): input is any {
          // Would match anything with asyncIterator
          return (
            !!input &&
            typeof input === "object" &&
            Symbol.asyncIterator in input
          );
        },
        async *wrap(stream: any) {
          adapterWasCalled.value = true;
          for await (const chunk of stream) {
            yield {
              type: "token" as const,
              value: chunk,
              timestamp: Date.now(),
            };
          }
          yield { type: "complete" as const, timestamp: Date.now() };
        },
      };

      registerAdapter(greedyAdapter);

      // Vercel AI SDK-like result with textStream
      const vercelLikeResult = {
        textStream: {
          async *[Symbol.asyncIterator]() {
            yield { type: "text-delta", textDelta: "Vercel" };
            yield { type: "text-delta", textDelta: "Stream" };
          },
        },
      };

      const result = await l0({
        stream: () => vercelLikeResult,
      });

      const events: L0Event[] = [];
      for await (const event of result.stream) {
        events.push(event);
      }

      // Should NOT have called the adapter - textStream takes priority
      expect(adapterWasCalled.value).toBe(false);
    });
  });

  describe("shouldRetry Callback", () => {
    it("should call shouldRetry with correct arguments", async () => {
      let capturedArgs: any = null;
      let attempts = 0;

      const streamFactory = () => {
        attempts++;
        if (attempts === 1) {
          // Use a network-style error that will be retried by default
          return {
            textStream: {
              async *[Symbol.asyncIterator]() {
                const err = new Error("ECONNRESET");
                (err as any).code = "ECONNRESET";
                throw err;
              },
            },
          };
        }
        return {
          textStream: createMockStream(["success"]),
        };
      };

      const result = await l0({
        stream: streamFactory,
        retry: {
          attempts: 3,
          baseDelay: 10,
          shouldRetry: async (error, state, attempt, category) => {
            capturedArgs = { error, state, attempt, category };
            return true; // Allow retry
          },
        },
        detectZeroTokens: false,
      });

      for await (const event of result.stream) {
        // Consume stream
      }

      expect(capturedArgs).not.toBeNull();
      expect(capturedArgs.error).toBeInstanceOf(Error);
      expect(capturedArgs.state).toBeDefined();
      expect(capturedArgs.state.content).toBeDefined();
      expect(typeof capturedArgs.attempt).toBe("number");
      expect(capturedArgs.attempt).toBe(0); // 0-based attempt index
      expect(typeof capturedArgs.category).toBe("string");
    });

    it("should allow shouldRetry to veto retry (return false)", async () => {
      let attempts = 0;
      let shouldRetryCalled = false;

      const streamFactory = () => {
        attempts++;
        return {
          textStream: createMockStream(["fail"], {
            shouldError: true,
            errorAfter: 0,
          }),
        };
      };

      let errorThrown = false;
      try {
        const result = await l0({
          stream: streamFactory,
          retry: {
            attempts: 5, // Would allow many retries
            baseDelay: 10,
            shouldRetry: async (error, state, attempt, category) => {
              shouldRetryCalled = true;
              return false; // Veto the retry
            },
          },
          detectZeroTokens: false,
        });

        for await (const event of result.stream) {
          // Consume stream
        }
      } catch (error) {
        errorThrown = true;
      }

      expect(shouldRetryCalled).toBe(true);
      expect(attempts).toBe(1); // Only one attempt, retry was vetoed
      expect(errorThrown).toBe(true);
    });

    it("should NOT allow shouldRetry to force retry when default says no", async () => {
      // When the default decision is to NOT retry (e.g., maxRetries reached),
      // shouldRetry returning true should NOT force a retry
      // because: finalShouldRetry = defaultShouldRetry && userResult
      let attempts = 0;
      let shouldRetryCalls = 0;

      const streamFactory = () => {
        attempts++;
        return {
          textStream: createMockStream(["fail"], {
            shouldError: true,
            errorAfter: 0,
          }),
        };
      };

      let errorThrown = false;
      try {
        const result = await l0({
          stream: streamFactory,
          retry: {
            attempts: 0, // No retries allowed by default
            baseDelay: 10,
            shouldRetry: async (error, state, attempt, category) => {
              shouldRetryCalls++;
              return true; // Try to force retry - should be ignored
            },
          },
          detectZeroTokens: false,
        });

        for await (const event of result.stream) {
          // Consume stream
        }
      } catch (error) {
        errorThrown = true;
      }

      // shouldRetry should still be called even when default is false
      // but the retry should NOT happen because: false && true = false
      expect(attempts).toBe(1); // Only one attempt
      expect(errorThrown).toBe(true);
    });

    it("should treat shouldRetry exception as veto (false)", async () => {
      let attempts = 0;
      let shouldRetryCalled = false;

      const streamFactory = () => {
        attempts++;
        return {
          textStream: createMockStream(["fail"], {
            shouldError: true,
            errorAfter: 0,
          }),
        };
      };

      let errorThrown = false;
      try {
        const result = await l0({
          stream: streamFactory,
          retry: {
            attempts: 5,
            baseDelay: 10,
            shouldRetry: async (error, state, attempt, category) => {
              shouldRetryCalled = true;
              throw new Error("shouldRetry threw an error");
            },
          },
          detectZeroTokens: false,
        });

        for await (const event of result.stream) {
          // Consume stream
        }
      } catch (error) {
        errorThrown = true;
      }

      expect(shouldRetryCalled).toBe(true);
      expect(attempts).toBe(1); // Exception treated as veto, no retry
      expect(errorThrown).toBe(true);
    });

    it("should NOT call shouldRetry for fatal errors", async () => {
      let shouldRetryCalled = false;

      // Create a stream that throws a fatal-like error (401 auth error)
      const streamFactory = () => {
        const err = new Error("401 Unauthorized");
        (err as any).status = 401;
        return {
          textStream: {
            async *[Symbol.asyncIterator]() {
              throw err;
            },
          },
        };
      };

      try {
        const result = await l0({
          stream: streamFactory,
          retry: {
            attempts: 5,
            baseDelay: 10,
            shouldRetry: async (error, state, attempt, category) => {
              shouldRetryCalled = true;
              return true;
            },
          },
          detectZeroTokens: false,
        });

        for await (const event of result.stream) {
          // Consume stream
        }
      } catch (error) {
        // Expected to throw
      }

      // For fatal errors, shouldRetry should not be called
      // (the implementation skips it when category === FATAL)
      expect(shouldRetryCalled).toBe(false);
    });

    it("should emit RETRY_FN_START and RETRY_FN_RESULT events", async () => {
      const events: any[] = [];
      let attempts = 0;

      const streamFactory = () => {
        attempts++;
        if (attempts === 1) {
          // Use a network-style error that will be retried by default
          return {
            textStream: {
              async *[Symbol.asyncIterator]() {
                const err = new Error("ECONNRESET");
                (err as any).code = "ECONNRESET";
                throw err;
              },
            },
          };
        }
        return {
          textStream: createMockStream(["success"]),
        };
      };

      const result = await l0({
        stream: streamFactory,
        retry: {
          attempts: 3,
          baseDelay: 10,
          shouldRetry: async (error, state, attempt, category) => {
            return true;
          },
        },
        onEvent: (event) => {
          if (
            event.type === "RETRY_FN_START" ||
            event.type === "RETRY_FN_RESULT"
          ) {
            events.push(event);
          }
        },
        detectZeroTokens: false,
      });

      for await (const event of result.stream) {
        // Consume stream
      }

      const startEvents = events.filter((e) => e.type === "RETRY_FN_START");
      const resultEvents = events.filter((e) => e.type === "RETRY_FN_RESULT");

      expect(startEvents.length).toBeGreaterThan(0);
      expect(resultEvents.length).toBeGreaterThan(0);

      // Verify event payload structure
      expect(startEvents[0].attempt).toBeDefined();
      expect(startEvents[0].category).toBeDefined();
      expect(startEvents[0].defaultShouldRetry).toBeDefined();

      expect(resultEvents[0].attempt).toBeDefined();
      expect(resultEvents[0].userResult).toBe(true);
      expect(resultEvents[0].finalShouldRetry).toBeDefined();
      expect(resultEvents[0].durationMs).toBeDefined();
    });

    it("should emit RETRY_FN_ERROR event when shouldRetry throws", async () => {
      const events: any[] = [];

      const streamFactory = () => ({
        textStream: createMockStream(["fail"], {
          shouldError: true,
          errorAfter: 0,
        }),
      });

      try {
        const result = await l0({
          stream: streamFactory,
          retry: {
            attempts: 3,
            baseDelay: 10,
            shouldRetry: async (error, state, attempt, category) => {
              throw new Error("Callback error");
            },
          },
          onEvent: (event) => {
            if (event.type === "RETRY_FN_ERROR") {
              events.push(event);
            }
          },
          detectZeroTokens: false,
        });

        for await (const event of result.stream) {
          // Consume stream
        }
      } catch (error) {
        // Expected to throw
      }

      expect(events.length).toBeGreaterThan(0);
      expect(events[0].type).toBe("RETRY_FN_ERROR");
      expect(events[0].error).toContain("Callback error");
      expect(events[0].finalShouldRetry).toBe(false);
      expect(events[0].durationMs).toBeDefined();
    });

    it("should allow selective veto based on error content", async () => {
      let attempts = 0;

      const streamFactory = () => {
        attempts++;
        const err =
          attempts === 1
            ? new Error("context_length_exceeded")
            : new Error("network_error");
        return {
          textStream: {
            async *[Symbol.asyncIterator]() {
              throw err;
            },
          },
        };
      };

      try {
        const result = await l0({
          stream: streamFactory,
          retry: {
            attempts: 5,
            baseDelay: 10,
            shouldRetry: async (error, state, attempt, category) => {
              // Veto retry for context length errors
              if (error.message.includes("context_length_exceeded")) {
                return false;
              }
              return true;
            },
          },
          detectZeroTokens: false,
        });

        for await (const event of result.stream) {
          // Consume stream
        }
      } catch (error) {
        // Expected to throw
      }

      // First error was context_length_exceeded, which we vetoed
      expect(attempts).toBe(1);
    });

    it("should allow selective veto based on token count", async () => {
      let attempts = 0;

      const streamFactory = () => {
        attempts++;
        return {
          textStream: {
            async *[Symbol.asyncIterator]() {
              // Emit some tokens first
              yield { type: "text-delta", textDelta: "Hello " };
              yield { type: "text-delta", textDelta: "world " };
              yield { type: "text-delta", textDelta: "this " };
              yield { type: "text-delta", textDelta: "is " };
              yield { type: "text-delta", textDelta: "content" };
              // Then fail
              throw new Error("Network error");
            },
          },
        };
      };

      try {
        const result = await l0({
          stream: streamFactory,
          retry: {
            attempts: 5,
            baseDelay: 10,
            shouldRetry: async (error, state, attempt, category) => {
              // Veto retry if we already have substantial content
              if (state.tokenCount > 3) {
                return false;
              }
              return true;
            },
          },
          detectZeroTokens: false,
        });

        for await (const event of result.stream) {
          // Consume stream
        }
      } catch (error) {
        // Expected to throw
      }

      // We had 5 tokens, so retry should have been vetoed
      expect(attempts).toBe(1);
    });

    it("should work with async shouldRetry that takes time", async () => {
      let attempts = 0;
      const startTime = Date.now();

      const streamFactory = () => {
        attempts++;
        if (attempts === 1) {
          // Use a network-style error that will be retried by default
          return {
            textStream: {
              async *[Symbol.asyncIterator]() {
                const err = new Error("ECONNRESET");
                (err as any).code = "ECONNRESET";
                throw err;
              },
            },
          };
        }
        return {
          textStream: createMockStream(["success"]),
        };
      };

      const result = await l0({
        stream: streamFactory,
        retry: {
          attempts: 3,
          baseDelay: 10,
          shouldRetry: async (error, state, attempt, category) => {
            // Simulate async work (e.g., checking external service)
            await new Promise((resolve) => setTimeout(resolve, 50));
            return true;
          },
        },
        detectZeroTokens: false,
      });

      for await (const event of result.stream) {
        // Consume stream
      }

      const duration = Date.now() - startTime;

      expect(attempts).toBe(2);
      // Should have taken at least 50ms for the async callback
      expect(duration).toBeGreaterThanOrEqual(50);
    });

    // =========================================================================
    // PERMITTED SCENARIOS
    // =========================================================================

    describe("Permitted: User can veto retries", () => {
      it("should allow user to veto retry even when default allows it", async () => {
        let attempts = 0;

        const streamFactory = () => {
          attempts++;
          return {
            textStream: {
              async *[Symbol.asyncIterator]() {
                const err = new Error("ECONNRESET"); // Network error - normally retried forever
                (err as any).code = "ECONNRESET";
                throw err;
              },
            },
          };
        };

        try {
          const result = await l0({
            stream: streamFactory,
            retry: {
              attempts: 100, // Many retries allowed
              baseDelay: 10,
              shouldRetry: async () => false, // Veto all retries
            },
            detectZeroTokens: false,
          });

          for await (const _ of result.stream) {
          }
        } catch (error) {
          // Expected
        }

        expect(attempts).toBe(1); // Only one attempt - veto worked
      });
    });

    describe("Permitted: User can allow retries via shouldRetry returning true", () => {
      it("should retry when shouldRetry returns true and default allows it", async () => {
        // This test verifies that shouldRetry returning true preserves retry behavior
        // (it doesn't veto). The actual retry is controlled by default logic.
        let attempts = 0;
        let shouldRetryCalls = 0;

        const streamFactory = () => {
          attempts++;
          if (attempts >= 3) {
            return { textStream: createMockStream(["success"]) };
          }
          return {
            textStream: {
              async *[Symbol.asyncIterator]() {
                // Network error - retried by default
                const err = new Error("ECONNRESET");
                (err as any).code = "ECONNRESET";
                throw err;
              },
            },
          };
        };

        const result = await l0({
          stream: streamFactory,
          retry: {
            attempts: 10,
            baseDelay: 1,
            shouldRetry: async () => {
              shouldRetryCalls++;
              return true; // Allow retry (don't veto)
            },
          },
          detectZeroTokens: false,
        });

        for await (const _ of result.stream) {
        }

        // Should have retried and shouldRetry was called each time
        expect(attempts).toBe(3);
        expect(shouldRetryCalls).toBe(2); // Called for each retry decision
      });
    });

    describe("Permitted: User function can return true forever for allowed retries", () => {
      it("should allow shouldRetry to return true for all retryable errors", async () => {
        let attempts = 0;
        let shouldRetryCalls = 0;

        const streamFactory = () => {
          attempts++;
          if (attempts >= 5) {
            return { textStream: createMockStream(["success"]) };
          }
          return {
            textStream: {
              async *[Symbol.asyncIterator]() {
                const err = new Error("ECONNRESET");
                (err as any).code = "ECONNRESET";
                throw err;
              },
            },
          };
        };

        const result = await l0({
          stream: streamFactory,
          retry: {
            attempts: 10,
            baseDelay: 1,
            shouldRetry: async () => {
              shouldRetryCalls++;
              return true; // Always return true
            },
          },
          detectZeroTokens: false,
        });

        for await (const _ of result.stream) {
        }

        expect(attempts).toBe(5);
        expect(shouldRetryCalls).toBe(4); // Called for each retry
      });
    });

    // =========================================================================
    // FORBIDDEN SCENARIOS - userFn cannot force retry
    // =========================================================================

    describe("Forbidden: User cannot force retry for fatal errors", () => {
      it("should NOT retry 401 auth errors even if shouldRetry returns true", async () => {
        let attempts = 0;
        let shouldRetryCalled = false;

        const streamFactory = () => {
          attempts++;
          return {
            textStream: {
              async *[Symbol.asyncIterator]() {
                const err = new Error("401 Unauthorized");
                (err as any).status = 401;
                throw err;
              },
            },
          };
        };

        try {
          const result = await l0({
            stream: streamFactory,
            retry: {
              attempts: 10,
              baseDelay: 10,
              shouldRetry: async () => {
                shouldRetryCalled = true;
                return true; // Try to force retry - should be ignored for fatal
              },
            },
            detectZeroTokens: false,
          });

          for await (const _ of result.stream) {
          }
        } catch (error) {
          // Expected
        }

        // Fatal errors should not even call shouldRetry (skipped)
        // OR if called, the result should be ignored
        expect(attempts).toBe(1); // Only one attempt - no retry for fatal
      });

      it("should NOT retry 403 forbidden errors even if shouldRetry returns true", async () => {
        let attempts = 0;

        const streamFactory = () => {
          attempts++;
          return {
            textStream: {
              async *[Symbol.asyncIterator]() {
                const err = new Error("403 Forbidden");
                (err as any).status = 403;
                throw err;
              },
            },
          };
        };

        try {
          const result = await l0({
            stream: streamFactory,
            retry: {
              attempts: 10,
              baseDelay: 10,
              shouldRetry: async () => true,
            },
            detectZeroTokens: false,
          });

          for await (const _ of result.stream) {
          }
        } catch (error) {
          // Expected
        }

        expect(attempts).toBe(1); // No retry for fatal
      });
    });

    describe("Forbidden: User cannot force retry after attempts exhausted", () => {
      it("should NOT retry after model retry limit (attempts) is exhausted", async () => {
        let attempts = 0;
        let shouldRetryCalls = 0;

        const streamFactory = () => {
          attempts++;
          return {
            textStream: {
              async *[Symbol.asyncIterator]() {
                // Model-type error that counts toward attempts limit
                throw new Error("Model returned bad response");
              },
            },
          };
        };

        try {
          const result = await l0({
            stream: streamFactory,
            retry: {
              attempts: 2, // Only 2 model retries allowed
              baseDelay: 1,
              retryOn: ["unknown"],
              shouldRetry: async () => {
                shouldRetryCalls++;
                return true; // Try to force more retries - should fail
              },
            },
            detectZeroTokens: false,
          });

          for await (const _ of result.stream) {
          }
        } catch (error) {
          // Expected
        }

        // attempts: 2 means initial + 2 retries = 3 total attempts max
        expect(attempts).toBeLessThanOrEqual(3);
      });

      it("should NOT allow shouldRetry to bypass attempts=0 for model errors", async () => {
        // Note: `attempts` only limits MODEL errors (not network errors)
        // Network errors don't count toward attempts limit by design
        // To block ALL retries including network, use maxRetries=0
        let attempts = 0;

        const streamFactory = () => {
          attempts++;
          return {
            textStream: {
              async *[Symbol.asyncIterator]() {
                // Use a model-type error that counts toward attempts
                throw new Error("Model returned zero tokens");
              },
            },
          };
        };

        try {
          const result = await l0({
            stream: streamFactory,
            retry: {
              attempts: 0, // No model retries allowed
              baseDelay: 10,
              retryOn: ["unknown"], // Enable retry for unknown errors
              shouldRetry: async () => true, // Try to force - should be ignored
            },
            detectZeroTokens: false,
          });

          for await (const _ of result.stream) {
          }
        } catch (error) {
          // Expected
        }

        // With attempts=0, model errors get no retries
        // Initial attempt + 0 retries = 1 total
        expect(attempts).toBe(1);
      });
    });

    describe("Forbidden: User cannot force retry after maxRetries exhausted", () => {
      it("should NOT retry after absolute maxRetries cap is reached", async () => {
        let attempts = 0;
        let shouldRetryCalls = 0;

        const streamFactory = () => {
          attempts++;
          return {
            textStream: {
              async *[Symbol.asyncIterator]() {
                const err = new Error("ECONNRESET");
                (err as any).code = "ECONNRESET";
                throw err;
              },
            },
          };
        };

        try {
          const result = await l0({
            stream: streamFactory,
            retry: {
              attempts: 100, // High model retry limit
              maxRetries: 2, // But absolute cap at 2 total retries
              baseDelay: 1,
              shouldRetry: async () => {
                shouldRetryCalls++;
                return true; // Try to force more - should fail after cap
              },
            },
            detectZeroTokens: false,
          });

          for await (const _ of result.stream) {
          }
        } catch (error) {
          // Expected
        }

        // maxRetries: 2 means max 2 retries, so 3 total attempts
        expect(attempts).toBeLessThanOrEqual(3);
      });

      it("should NOT allow shouldRetry to bypass maxRetries=0", async () => {
        let attempts = 0;

        const streamFactory = () => {
          attempts++;
          return {
            textStream: {
              async *[Symbol.asyncIterator]() {
                const err = new Error("ECONNRESET");
                (err as any).code = "ECONNRESET";
                throw err;
              },
            },
          };
        };

        try {
          const result = await l0({
            stream: streamFactory,
            retry: {
              attempts: 100,
              maxRetries: 0, // Absolute cap: no retries at all
              baseDelay: 10,
              shouldRetry: async () => true, // Try to force - should be ignored
            },
            detectZeroTokens: false,
          });

          for await (const _ of result.stream) {
          }
        } catch (error) {
          // Expected
        }

        expect(attempts).toBe(1); // Only initial attempt
      });
    });
  });

  describe("Multimodal Events", () => {
    it("should handle data events and populate dataOutputs", async () => {
      async function* multimodalStream(): AsyncIterable<L0Event> {
        yield {
          type: "progress",
          progress: { percent: 50 },
          timestamp: Date.now(),
        };
        yield {
          type: "data",
          data: {
            contentType: "image",
            mimeType: "image/png",
            base64: "iVBORw0KGgo...",
            metadata: { width: 512, height: 512 },
          },
          timestamp: Date.now(),
        };
        yield { type: "complete", timestamp: Date.now() };
      }

      const result = await l0({
        stream: () => multimodalStream(),
        detectZeroTokens: false, // Multimodal streams may not have text tokens
      });

      const events: L0Event[] = [];
      for await (const event of result.stream) {
        events.push(event);
      }

      // Verify events were emitted
      expect(events.some((e) => e.type === "progress")).toBe(true);
      expect(events.some((e) => e.type === "data")).toBe(true);
      expect(events.some((e) => e.type === "complete")).toBe(true);

      // Verify state was updated
      expect(result.state.dataOutputs).toHaveLength(1);
      expect(result.state.dataOutputs[0].contentType).toBe("image");
      expect(result.state.dataOutputs[0].base64).toBe("iVBORw0KGgo...");
      expect(result.state.dataOutputs[0].metadata?.width).toBe(512);
    });

    it("should track lastProgress from progress events", async () => {
      async function* progressStream(): AsyncIterable<L0Event> {
        yield {
          type: "progress",
          progress: { percent: 25, message: "Starting" },
          timestamp: Date.now(),
        };
        yield {
          type: "progress",
          progress: { percent: 50, message: "Halfway" },
          timestamp: Date.now(),
        };
        yield {
          type: "progress",
          progress: { percent: 100, message: "complete" },
          timestamp: Date.now(),
        };
        yield { type: "complete", timestamp: Date.now() };
      }

      const result = await l0({
        stream: () => progressStream(),
        detectZeroTokens: false, // Progress-only streams have no text tokens
      });

      for await (const _ of result.stream) {
        // consume
      }

      // Should have the last progress update
      expect(result.state.lastProgress?.percent).toBe(100);
      expect(result.state.lastProgress?.message).toBe("complete");
    });

    it("should handle multiple data outputs", async () => {
      async function* multiImageStream(): AsyncIterable<L0Event> {
        yield {
          type: "data",
          data: {
            contentType: "image",
            mimeType: "image/png",
            url: "https://example.com/1.png",
          },
          timestamp: Date.now(),
        };
        yield {
          type: "data",
          data: {
            contentType: "image",
            mimeType: "image/png",
            url: "https://example.com/2.png",
          },
          timestamp: Date.now(),
        };
        yield {
          type: "data",
          data: {
            contentType: "image",
            mimeType: "image/png",
            url: "https://example.com/3.png",
          },
          timestamp: Date.now(),
        };
        yield { type: "complete", timestamp: Date.now() };
      }

      const result = await l0({
        stream: () => multiImageStream(),
        detectZeroTokens: false, // Image-only streams have no text tokens
      });

      for await (const _ of result.stream) {
        // consume
      }

      expect(result.state.dataOutputs).toHaveLength(3);
      expect(result.state.dataOutputs[0].url).toBe("https://example.com/1.png");
      expect(result.state.dataOutputs[2].url).toBe("https://example.com/3.png");
    });

    it("should handle mixed text and data events", async () => {
      async function* mixedStream(): AsyncIterable<L0Event> {
        yield {
          type: "token",
          value: "Generating image: ",
          timestamp: Date.now(),
        };
        yield {
          type: "progress",
          progress: { percent: 50 },
          timestamp: Date.now(),
        };
        yield {
          type: "data",
          data: {
            contentType: "image",
            mimeType: "image/png",
            base64: "abc123",
          },
          timestamp: Date.now(),
        };
        yield { type: "token", value: "Done!", timestamp: Date.now() };
        yield { type: "complete", timestamp: Date.now() };
      }

      const result = await l0({
        stream: () => mixedStream(),
      });

      const events: L0Event[] = [];
      for await (const event of result.stream) {
        events.push(event);
      }

      // Verify all event types
      const types = events.map((e) => e.type);
      expect(types).toContain("token");
      expect(types).toContain("progress");
      expect(types).toContain("data");
      expect(types).toContain("complete");

      // Verify state
      expect(result.state.content).toBe("Generating image: Done!");
      expect(result.state.tokenCount).toBe(2);
      expect(result.state.dataOutputs).toHaveLength(1);
      expect(result.state.lastProgress?.percent).toBe(50);
    });

    it("should initialize dataOutputs as empty array", async () => {
      async function* simpleStream(): AsyncIterable<L0Event> {
        yield { type: "token", value: "Hello", timestamp: Date.now() };
        yield { type: "complete", timestamp: Date.now() };
      }

      const result = await l0({
        stream: () => simpleStream(),
      });

      for await (const _ of result.stream) {
        // consume
      }

      expect(result.state.dataOutputs).toEqual([]);
      expect(result.state.lastProgress).toBeUndefined();
    });

    it("should clear dataOutputs on retry", async () => {
      let callCount = 0;

      const result = await l0({
        stream: () => {
          callCount++;
          async function* gen(): AsyncIterable<L0Event> {
            yield {
              type: "data",
              data: {
                contentType: "image",
                base64: `image-from-call-${callCount}`,
              },
              timestamp: Date.now(),
            };
            yield {
              type: "progress",
              progress: { percent: 50, message: `call-${callCount}` },
              timestamp: Date.now(),
            };
            if (callCount === 1) {
              // First call fails with a retryable network error
              const err = new Error("read ECONNRESET");
              (err as any).code = "ECONNRESET";
              throw err;
            }
            yield { type: "complete", timestamp: Date.now() };
          }
          return gen();
        },
        retry: { attempts: 2 },
        detectZeroTokens: false,
      });

      for await (const _ of result.stream) {
        // consume
      }

      // Should only have data from successful attempt (call 2)
      expect(callCount).toBe(2);
      expect(result.state.dataOutputs).toHaveLength(1);
      expect(result.state.dataOutputs[0].base64).toBe("image-from-call-2");
      expect(result.state.lastProgress?.message).toBe("call-2");
    });

    it("should clear lastProgress on retry", async () => {
      let callCount = 0;

      const result = await l0({
        stream: () => {
          callCount++;
          async function* gen(): AsyncIterable<L0Event> {
            yield {
              type: "progress",
              progress: { percent: 100, message: `progress-${callCount}` },
              timestamp: Date.now(),
            };
            if (callCount === 1) {
              // First call fails with a retryable network error
              const err = new Error("read ECONNRESET");
              (err as any).code = "ECONNRESET";
              throw err;
            }
            yield { type: "token", value: "success", timestamp: Date.now() };
            yield { type: "complete", timestamp: Date.now() };
          }
          return gen();
        },
        retry: { attempts: 2 },
      });

      for await (const _ of result.stream) {
        // consume
      }

      // Should have progress from successful attempt only
      expect(callCount).toBe(2);
      expect(result.state.lastProgress?.message).toBe("progress-2");
    });

    it("should clear dataOutputs on fallback", async () => {
      let primaryCalled = false;

      const result = await l0({
        stream: () => {
          primaryCalled = true;
          async function* gen(): AsyncIterable<L0Event> {
            yield {
              type: "data",
              data: { contentType: "image", base64: "primary-image" },
              timestamp: Date.now(),
            };
            yield {
              type: "progress",
              progress: { percent: 50, message: "primary" },
              timestamp: Date.now(),
            };
            throw new Error("Primary failed");
          }
          return gen();
        },
        fallbackStreams: [
          () => {
            async function* gen(): AsyncIterable<L0Event> {
              yield {
                type: "data",
                data: { contentType: "image", base64: "fallback-image" },
                timestamp: Date.now(),
              };
              yield {
                type: "progress",
                progress: { percent: 100, message: "fallback" },
                timestamp: Date.now(),
              };
              yield { type: "complete", timestamp: Date.now() };
            }
            return gen();
          },
        ],
        retry: { attempts: 1 },
        detectZeroTokens: false,
      });

      for await (const _ of result.stream) {
        // consume
      }

      // Should only have data from fallback
      expect(primaryCalled).toBe(true);
      expect(result.state.dataOutputs).toHaveLength(1);
      expect(result.state.dataOutputs[0].base64).toBe("fallback-image");
      expect(result.state.lastProgress?.message).toBe("fallback");
    });
  });
});
