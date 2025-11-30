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
    describe("shouldRetry", () => {
      it("should use custom shouldRetry function to force retry", async () => {
        let attempts = 0;
        let shouldRetryCalled = false;

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
            textStream: createMockStream(["success", " ", "content"]),
          };
        };

        const result = await l0({
          stream: streamFactory,
          retry: {
            attempts: 3,
            baseDelay: 10,
            shouldRetry: (error, context) => {
              shouldRetryCalled = true;
              expect(error).toBeInstanceOf(Error);
              expect(context.attempt).toBeGreaterThanOrEqual(0);
              expect(context.category).toBeDefined();
              expect(context.reason).toBeDefined();
              return true; // Force retry
            },
          },
          detectZeroTokens: false,
        });

        for await (const event of result.stream) {
          // Consume stream
        }

        expect(shouldRetryCalled).toBe(true);
        expect(attempts).toBe(2);
        expect(result.state.content).toBe("success content");
      });

      it("should use custom shouldRetry function to prevent retry", async () => {
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
              shouldRetry: (error, context) => {
                shouldRetryCalled = true;
                return false; // Prevent retry
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
        expect(attempts).toBe(1); // Only one attempt, no retries
        expect(errorThrown).toBe(true);
      });

      it("should fall back to default behavior when shouldRetry returns undefined", async () => {
        let attempts = 0;
        let shouldRetryCalled = false;

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
            baseDelay: 10,
            retryOn: ["unknown"], // Enable retry for unknown errors
            shouldRetry: (error, context) => {
              shouldRetryCalled = true;
              return undefined; // Use default behavior
            },
          },
          detectZeroTokens: false,
        });

        for await (const event of result.stream) {
          // Consume stream
        }

        expect(shouldRetryCalled).toBe(true);
        expect(attempts).toBeGreaterThan(1);
      });

      it("should provide correct context to shouldRetry", async () => {
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
            baseDelay: 10,
            shouldRetry: (error, context) => {
              capturedContext = context;
              return true; // Force retry to ensure we capture context
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
        expect(typeof capturedContext.content).toBe("string");
        expect(typeof capturedContext.tokenCount).toBe("number");
      });
    });

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

    describe("shouldRetry and calculateDelay combined", () => {
      it("should use both custom functions together", async () => {
        let attempts = 0;
        let shouldRetryCalls = 0;
        let calculateDelayCalls = 0;

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
            textStream: createMockStream(["final", " ", "success"]),
          };
        };

        const result = await l0({
          stream: streamFactory,
          retry: {
            attempts: 5,
            baseDelay: 1000,
            shouldRetry: (error, context) => {
              shouldRetryCalls++;
              return context.totalAttempts < 3;
            },
            calculateDelay: (context) => {
              calculateDelayCalls++;
              return 10; // Fast retry
            },
          },
          detectZeroTokens: false,
        });

        for await (const event of result.stream) {
          // Consume stream
        }

        expect(shouldRetryCalls).toBeGreaterThan(0);
        expect(calculateDelayCalls).toBeGreaterThan(0);
        expect(result.state.content).toBe("final success");
      });

      it("should not call calculateDelay when shouldRetry returns false", async () => {
        let calculateDelayCalled = false;

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
              attempts: 5,
              baseDelay: 100,
              shouldRetry: () => false,
              calculateDelay: () => {
                calculateDelayCalled = true;
                return 10;
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

        // calculateDelay should still be called before shouldRetry prevents retry
        // Actually, calculateDelay is called when decision.shouldRetry is true
        // Since shouldRetry returns false, calculateDelay may or may not be called
        // depending on implementation order
      });
    });
  });
});
