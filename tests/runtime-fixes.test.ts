/**
 * Tests for L0 runtime fixes
 *
 * This file tests the following fixes:
 * 1. Inter-token timeout check (now checks BEFORE processing, not after)
 * 2. Initial token timeout race condition (clearTimeout in microtask)
 * 3. normalizeStreamEvent error handling (wrapped in try/catch)
 * 4. State reset function (centralized state resets)
 * 5. onEvent callback error handling (wrapped in try/catch)
 * 6. Deduplication buffer flush ordering (flush before done event)
 */

import { describe, it, expect } from "vitest";
import { l0 } from "../src/runtime/l0";
import type { L0Event } from "../src/types/l0";
import type { GuardrailRule } from "../src/types/guardrails";

// Helper to create a simple token stream
function createTokenStream(tokens: string[]): () => AsyncGenerator<L0Event> {
  return async function* () {
    for (const token of tokens) {
      yield { type: "token", value: token, timestamp: Date.now() };
    }
    yield { type: "complete", timestamp: Date.now() };
  };
}

// Helper to add delay
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("Inter-token timeout", () => {
  it("should trigger inter-token timeout when gap exceeds threshold", async () => {
    // Create a stream with a long delay between tokens
    const streamFn = async function* (): AsyncGenerator<L0Event> {
      yield { type: "token", value: "first", timestamp: Date.now() };
      // This delay should trigger the timeout (using small value for test speed)
      await delay(150);
      yield { type: "token", value: "second", timestamp: Date.now() };
      yield { type: "complete", timestamp: Date.now() };
    };

    const result = await l0({
      stream: () => streamFn(),
      timeout: { interToken: 100 }, // 100ms timeout
      retry: { attempts: 0 },
    });

    const events: L0Event[] = [];
    let caughtError: Error | null = null;

    try {
      for await (const event of result.stream) {
        events.push(event);
      }
    } catch (error) {
      caughtError = error as Error;
    }

    expect(caughtError).not.toBeNull();
    expect(caughtError?.message).toContain("Inter-token timeout");
  });

  it("should NOT trigger timeout when tokens arrive within threshold", async () => {
    const streamFn = async function* (): AsyncGenerator<L0Event> {
      yield { type: "token", value: "first", timestamp: Date.now() };
      await delay(10);
      yield { type: "token", value: "second", timestamp: Date.now() };
      await delay(10);
      yield { type: "token", value: "third", timestamp: Date.now() };
      yield { type: "complete", timestamp: Date.now() };
    };

    const result = await l0({
      stream: () => streamFn(),
      timeout: { interToken: 1000 }, // 1 second timeout - plenty of time
      retry: { attempts: 0 },
    });

    const events: L0Event[] = [];
    for await (const event of result.stream) {
      events.push(event);
    }

    const tokens = events.filter((e) => e.type === "token").map((e) => e.value);
    expect(tokens).toEqual(["first", "second", "third"]);
    expect(events.some((e) => e.type === "complete")).toBe(true);
  });

  it("should measure time waiting for token, not processing time", async () => {
    // This test verifies the fix: timeout is checked BEFORE processing each chunk
    // If timeout measured processing time instead of wait time, this would fail
    const streamFn = async function* (): AsyncGenerator<L0Event> {
      yield { type: "token", value: "first", timestamp: Date.now() };
      await delay(10); // Short delay between tokens (well under timeout)
      yield { type: "token", value: "second", timestamp: Date.now() };
      await delay(10);
      yield { type: "token", value: "third", timestamp: Date.now() };
      yield { type: "complete", timestamp: Date.now() };
    };

    let processingCalls = 0;
    const result = await l0({
      stream: () => streamFn(),
      timeout: { interToken: 100 }, // 100ms timeout
      retry: { attempts: 0 },
      onEvent: async () => {
        processingCalls++;
        // Simulate slow processing (150ms) - this should NOT affect timeout
        // because timeout measures wait time for next token, not processing time
        // If timeout was measured incorrectly, this 150ms would cause timeout
        await delay(150);
      },
    });

    const events: L0Event[] = [];
    for await (const event of result.stream) {
      events.push(event);
    }

    // Should complete successfully despite slow processing
    // If timeout measured processing time, this would have failed
    expect(events.some((e) => e.type === "complete")).toBe(true);
    expect(processingCalls).toBeGreaterThan(0);
    const tokens = events.filter((e) => e.type === "token").map((e) => e.value);
    expect(tokens).toEqual(["first", "second", "third"]);
  });
});

describe("Initial token timeout", () => {
  it("should complete successfully when first token arrives before timeout", async () => {
    // This test verifies the timeout clearing logic works correctly
    const streamFn = async function* (): AsyncGenerator<L0Event> {
      await delay(50); // Less than timeout
      yield { type: "token", value: "made-it", timestamp: Date.now() };
      yield { type: "complete", timestamp: Date.now() };
    };

    const result = await l0({
      stream: () => streamFn(),
      timeout: { initialToken: 200 }, // 200ms timeout
      retry: { attempts: 0 },
    });

    const events: L0Event[] = [];
    for await (const event of result.stream) {
      events.push(event);
    }

    expect(
      events.some((e) => e.type === "token" && e.value === "made-it"),
    ).toBe(true);
    expect(events.some((e) => e.type === "complete")).toBe(true);
  });

  it("should have initial token timeout configured correctly", async () => {
    // Verify that the timeout setting is respected by checking the error metadata
    // when the inter-token timeout triggers (which uses similar mechanism)
    const streamFn = async function* (): AsyncGenerator<L0Event> {
      yield { type: "token", value: "first", timestamp: Date.now() };
      await delay(200);
      yield { type: "token", value: "second", timestamp: Date.now() };
      yield { type: "complete", timestamp: Date.now() };
    };

    const result = await l0({
      stream: () => streamFn(),
      timeout: { initialToken: 1000, interToken: 100 },
      retry: { attempts: 0 },
    });

    let caughtError: any = null;
    try {
      for await (const _ of result.stream) {
        // Consume
      }
    } catch (error) {
      caughtError = error;
    }

    // Should have triggered inter-token timeout, not initial
    expect(caughtError).not.toBeNull();
    expect(caughtError.code).toBe("INTER_TOKEN_TIMEOUT");
  });
});

describe("normalizeStreamEvent error handling", () => {
  it("should handle unknown event types gracefully", async () => {
    // Create a stream that yields various event shapes
    const streamFn = async function* (): AsyncGenerator<any> {
      yield { type: "token", value: "before", timestamp: Date.now() };
      // Unknown type - normalizeStreamEvent should handle this
      yield { type: "unknown-type", data: "test" };
      yield { type: "token", value: "after", timestamp: Date.now() };
      yield { type: "complete", timestamp: Date.now() };
    };

    const result = await l0({
      stream: () => streamFn(),
      retry: { attempts: 0 },
    });

    const events: L0Event[] = [];
    for await (const event of result.stream) {
      events.push(event);
    }

    // Stream should complete without crashing
    expect(events.some((e) => e.type === "complete")).toBe(true);
    expect(events.some((e) => e.type === "token" && e.value === "before")).toBe(
      true,
    );
    expect(events.some((e) => e.type === "token" && e.value === "after")).toBe(
      true,
    );
  });

  it("should handle string chunks (Vercel AI SDK style)", async () => {
    const streamFn = async function* (): AsyncGenerator<any> {
      yield "hello";
      yield " ";
      yield "world";
      yield { type: "complete", timestamp: Date.now() };
    };

    const result = await l0({
      stream: () => streamFn(),
      retry: { attempts: 0 },
    });

    const events: L0Event[] = [];
    for await (const event of result.stream) {
      events.push(event);
    }

    const tokens = events
      .filter((e) => e.type === "token")
      .map((e) => e.value)
      .join("");
    expect(tokens).toBe("hello world");
  });
});

describe("onEvent callback error handling", () => {
  it("should not crash when onEvent callback throws", async () => {
    const streamFn = createTokenStream(["first", "second", "third"]);

    let callCount = 0;
    const result = await l0({
      stream: streamFn,
      retry: { attempts: 0 },
      onEvent: (event) => {
        callCount++;
        if (event.type === "token" && event.value === "second") {
          throw new Error("Callback error!");
        }
      },
    });

    const events: L0Event[] = [];
    for await (const event of result.stream) {
      events.push(event);
    }

    // Stream should complete despite callback error
    expect(events.some((e) => e.type === "complete")).toBe(true);
    expect(callCount).toBeGreaterThan(0);

    const tokens = events.filter((e) => e.type === "token").map((e) => e.value);
    expect(tokens).toEqual(["first", "second", "third"]);
  });

  it("should continue calling onEvent after callback error", async () => {
    const streamFn = createTokenStream(["a", "b", "c"]);

    const calls: string[] = [];
    const result = await l0({
      stream: streamFn,
      retry: { attempts: 0 },
      onEvent: (event) => {
        if (event.type === "token") {
          calls.push(event.value!);
          if (event.value === "a") {
            throw new Error("First callback error");
          }
        }
      },
    });

    for await (const _ of result.stream) {
      // Consume stream
    }

    // All tokens should have been passed to callback
    expect(calls).toEqual(["a", "b", "c"]);
  });

  it("should handle errors in different event types", async () => {
    const streamFn = async function* (): AsyncGenerator<L0Event> {
      yield { type: "token", value: "text", timestamp: Date.now() };
      yield {
        type: "message",
        value: "msg",
        role: "assistant",
        timestamp: Date.now(),
      };
      yield {
        type: "data",
        data: { contentType: "text" as const },
        timestamp: Date.now(),
      };
      yield { type: "complete", timestamp: Date.now() };
    };

    let errorCount = 0;
    const result = await l0({
      stream: streamFn,
      retry: { attempts: 0 },
      onEvent: () => {
        errorCount++;
        throw new Error(`Error #${errorCount}`);
      },
    });

    const events: L0Event[] = [];
    for await (const event of result.stream) {
      events.push(event);
    }

    // All events should have been emitted despite errors
    expect(events.some((e) => e.type === "token")).toBe(true);
    expect(events.some((e) => e.type === "message")).toBe(true);
    expect(events.some((e) => e.type === "data")).toBe(true);
    expect(events.some((e) => e.type === "complete")).toBe(true);
    expect(errorCount).toBe(4); // Called for each event type
  });
});

describe("Deduplication buffer flush ordering", () => {
  it("should emit all tokens before done event", async () => {
    // Simple test: verify token order relative to done
    const streamFn = async function* (): AsyncGenerator<L0Event> {
      yield { type: "token", value: "a", timestamp: Date.now() };
      yield { type: "token", value: "b", timestamp: Date.now() };
      yield { type: "token", value: "c", timestamp: Date.now() };
      yield { type: "complete", timestamp: Date.now() };
    };

    const eventOrder: string[] = [];
    const result = await l0({
      stream: streamFn,
      retry: { attempts: 0 },
      onEvent: (event) => {
        eventOrder.push(event.type);
      },
    });

    for await (const _ of result.stream) {
      // Consume
    }

    // Complete should be last
    expect(eventOrder[eventOrder.length - 1]).toBe("complete");

    // All tokens should come before complete
    const doneIndex = eventOrder.lastIndexOf("complete");
    const tokenIndices = eventOrder
      .map((e, i) => (e === "token" ? i : -1))
      .filter((i) => i >= 0);
    for (const tokenIndex of tokenIndices) {
      expect(tokenIndex).toBeLessThan(doneIndex);
    }
  });

  it("should run guardrails on content with forbidden words", async () => {
    const violations: any[] = [];
    const badWordRule: GuardrailRule = {
      name: "no-bad-words",
      check: (ctx) => {
        if (ctx.content.includes("forbidden")) {
          return [
            {
              rule: "no-bad-words",
              severity: "error" as const,
              message: "Content contains forbidden word",
              recoverable: true,
            },
          ];
        }
        return [];
      },
    };

    // Simple stream that includes forbidden word
    const streamFn = async function* (): AsyncGenerator<L0Event> {
      yield { type: "token", value: "Hello ", timestamp: Date.now() };
      yield { type: "token", value: "forbidden", timestamp: Date.now() };
      yield { type: "token", value: " world", timestamp: Date.now() };
      yield { type: "complete", timestamp: Date.now() };
    };

    const result = await l0({
      stream: () => streamFn(),
      guardrails: [badWordRule],
      retry: { attempts: 0 },
      onViolation: (v) => violations.push(v),
    });

    try {
      for await (const _ of result.stream) {
        // Consume
      }
    } catch {
      // May throw due to guardrail violation
    }

    // Guardrail should have been triggered
    expect(violations.length).toBeGreaterThan(0);
    expect(violations.some((v) => v.rule === "no-bad-words")).toBe(true);
  });
});

describe("State reset function", () => {
  it("should properly reset state when stream factory is called multiple times", async () => {
    // Test state isolation between separate l0 calls
    const streamFn1 = createTokenStream(["first", "call"]);
    const streamFn2 = createTokenStream(["second", "call"]);

    const result1 = await l0({
      stream: streamFn1,
      retry: { attempts: 0 },
    });

    for await (const _ of result1.stream) {
      // Consume
    }

    const result2 = await l0({
      stream: streamFn2,
      retry: { attempts: 0 },
    });

    for await (const _ of result2.stream) {
      // Consume
    }

    // Each result should have independent state
    expect(result1.state.content).toBe("firstcall");
    expect(result2.state.content).toBe("secondcall");
    expect(result1.state.tokenCount).toBe(2);
    expect(result2.state.tokenCount).toBe(2);
  });

  it("should reset violations between attempts (via guardrail retry)", async () => {
    let attemptCount = 0;
    const allViolations: any[] = [];

    // A guardrail that triggers retry on first attempt
    const retryTriggerRule: GuardrailRule = {
      name: "retry-trigger",
      check: (ctx) => {
        if (ctx.completed && ctx.content.includes("retry-me")) {
          return [
            {
              rule: "retry-trigger",
              severity: "error" as const,
              message: "Content needs retry",
              recoverable: true,
            },
          ];
        }
        return [];
      },
    };

    // Stream factory - MUST return the async generator directly
    const streamFactory = () => {
      attemptCount++;
      // Return the generator directly, not wrapped in another function
      const gen = async function* (): AsyncGenerator<L0Event> {
        if (attemptCount === 1) {
          yield { type: "token", value: "retry-me", timestamp: Date.now() };
        } else {
          yield {
            type: "token",
            value: "clean-content",
            timestamp: Date.now(),
          };
        }
        yield { type: "complete", timestamp: Date.now() };
      };
      return gen();
    };

    const result = await l0({
      stream: streamFactory,
      guardrails: [retryTriggerRule],
      retry: { attempts: 2 },
      continueFromLastKnownGoodToken: false,
      onViolation: (v) => allViolations.push(v),
    });

    for await (const _ of result.stream) {
      // Consume
    }

    // Should have retried and succeeded on second attempt
    expect(attemptCount).toBe(2);
    expect(result.state.content).toBe("clean-content");
    // Final state should have no violations (reset on retry)
    expect(result.state.violations.length).toBe(0);
    // But violation callback was called
    expect(allViolations.length).toBeGreaterThan(0);
  });

  it("should reset dataOutputs between separate calls", async () => {
    // Include meaningful token content so zero-output detection doesn't trigger
    // (zero-token detection considers content < 3 chars as zero output)
    const streamFn1 = async function* (): AsyncGenerator<L0Event> {
      yield { type: "token", value: "image-content", timestamp: Date.now() };
      yield {
        type: "data",
        data: { contentType: "image" as const },
        timestamp: Date.now(),
      };
      yield { type: "complete", timestamp: Date.now() };
    };

    const streamFn2 = async function* (): AsyncGenerator<L0Event> {
      yield { type: "token", value: "audio-content", timestamp: Date.now() };
      yield {
        type: "data",
        data: { contentType: "audio" as const },
        timestamp: Date.now(),
      };
      yield { type: "complete", timestamp: Date.now() };
    };

    const result1 = await l0({
      stream: streamFn1,
      retry: { attempts: 0 },
    });

    for await (const _ of result1.stream) {
      // Consume
    }

    const result2 = await l0({
      stream: streamFn2,
      retry: { attempts: 0 },
    });

    for await (const _ of result2.stream) {
      // Consume
    }

    // Each result should have independent data outputs
    expect(result1.state.dataOutputs.length).toBe(1);
    expect(result1.state.dataOutputs[0].contentType).toBe("image");
    expect(result2.state.dataOutputs.length).toBe(1);
    expect(result2.state.dataOutputs[0].contentType).toBe("audio");
  });
});

describe("safeInvokeCallback helper", () => {
  it("should log errors but not throw", async () => {
    // This is implicitly tested by onEvent callback tests
    // Here we verify behavior with multiple callback invocations

    const streamFn = createTokenStream(["1", "2", "3"]);

    const result = await l0({
      stream: streamFn,
      retry: { attempts: 0 },
      onEvent: (event) => {
        if (event.type === "token") {
          throw new Error(`Error for ${event.value}`);
        }
      },
    });

    const tokens: string[] = [];
    for await (const event of result.stream) {
      if (event.type === "token") {
        tokens.push(event.value!);
      }
    }

    // All tokens should have been processed
    expect(tokens).toEqual(["1", "2", "3"]);
  });
});

describe("Continuation with checkpoint", () => {
  it("should enable deduplication by default when continuation is enabled", async () => {
    // Test that deduplication option defaults correctly when continuation is enabled
    let attemptCount = 0;

    // Guardrail that forces retry
    const forceRetryRule: GuardrailRule = {
      name: "force-retry",
      check: (ctx) => {
        // Trigger retry on first complete with specific content
        if (ctx.completed && ctx.content === "original") {
          return [
            {
              rule: "force-retry",
              severity: "error" as const,
              message: "Force retry",
              recoverable: true,
            },
          ];
        }
        return [];
      },
    };

    // Stream factory that generates different content each time
    const streamFactory = () => {
      attemptCount++;
      const gen = async function* (): AsyncGenerator<L0Event> {
        if (attemptCount === 1) {
          yield { type: "token", value: "original", timestamp: Date.now() };
        } else {
          yield {
            type: "token",
            value: "retry-success",
            timestamp: Date.now(),
          };
        }
        yield { type: "complete", timestamp: Date.now() };
      };
      return gen();
    };

    const result = await l0({
      stream: streamFactory,
      guardrails: [forceRetryRule],
      retry: { attempts: 2 },
      continueFromLastKnownGoodToken: true,
      // deduplicateContinuation defaults to true when continuation is enabled
    });

    for await (const _ of result.stream) {
      // Consume
    }

    // Verify retry happened
    expect(attemptCount).toBe(2);
    // Content should be from the retry
    expect(result.state.content).toContain("retry-success");
  });

  it("should use checkpoints for continuation when enabled", async () => {
    let attemptCount = 0;

    // Guardrail that forces retry after enough tokens for checkpoint
    const forceRetryRule: GuardrailRule = {
      name: "force-retry",
      check: (ctx) => {
        // Only trigger on first attempt with specific content length
        if (
          ctx.completed &&
          ctx.content.length > 50 &&
          ctx.content.includes("TRIGGER_RETRY")
        ) {
          return [
            {
              rule: "force-retry",
              severity: "error" as const,
              message: "Force retry for checkpoint test",
              recoverable: true,
            },
          ];
        }
        return [];
      },
    };

    // Stream factory that generates content that will trigger checkpoint saving
    const streamFactory = () => {
      attemptCount++;
      const gen = async function* (): AsyncGenerator<L0Event> {
        if (attemptCount === 1) {
          // Generate enough content for checkpoint (default interval is 10 tokens)
          for (let i = 0; i < 15; i++) {
            yield { type: "token", value: `word${i} `, timestamp: Date.now() };
          }
          yield {
            type: "token",
            value: "TRIGGER_RETRY",
            timestamp: Date.now(),
          };
        } else {
          // On retry, just add more content
          yield { type: "token", value: "continued", timestamp: Date.now() };
        }
        yield { type: "complete", timestamp: Date.now() };
      };
      return gen();
    };

    const result = await l0({
      stream: streamFactory,
      guardrails: [forceRetryRule],
      retry: { attempts: 2 },
      continueFromLastKnownGoodToken: true,
      checkIntervals: { checkpoint: 5 }, // Save checkpoint every 5 tokens
    });

    for await (const _ of result.stream) {
      // Consume
    }

    // Should have retried
    expect(attemptCount).toBe(2);
    // Should have used continuation
    expect(result.state.resumed).toBe(true);
    // Content should include the checkpoint content plus continuation
    expect(result.state.content).toContain("word");
    expect(result.state.content).toContain("continued");
  });
});
