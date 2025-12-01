// Tests for runtime pipeline (Stage, runStages, PipelineContext)

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  runStages,
  createPipelineContext,
  type Stage,
  type PipelineContext,
} from "../src/runtime/pipeline";
import { StateMachine, RuntimeStates } from "../src/runtime/state-machine";
import type { L0Event, L0State } from "../src/types/l0";

// Create a mock L0State
function createMockState(): L0State {
  return {
    content: "",
    checkpoint: "",
    tokenCount: 0,
    modelRetryCount: 0,
    networkRetryCount: 0,
    fallbackIndex: 0,
    violations: [],
    driftDetected: false,
    completed: false,
    networkErrors: [],
    resumed: false,
    dataOutputs: [],
  };
}

// Create a mock monitor
function createMockMonitor() {
  return {
    enabled: false,
    callbacks: {},
  };
}

// Create a token event
function createTokenEvent(value: string): L0Event {
  return {
    type: "token",
    value,
    timestamp: Date.now(),
  };
}

// Create a complete event
function createCompleteEvent(): L0Event {
  return {
    type: "complete",
    timestamp: Date.now(),
  };
}

describe("createPipelineContext()", () => {
  it("should create a pipeline context with all fields", () => {
    const state = createMockState();
    const stateMachine = new StateMachine();
    const monitor = createMockMonitor();

    const ctx = createPipelineContext(state, stateMachine, monitor as any);

    expect(ctx.state).toBe(state);
    expect(ctx.stateMachine).toBe(stateMachine);
    expect(ctx.monitor).toBe(monitor);
    expect(ctx.scratch).toBeInstanceOf(Map);
    expect(ctx.signal).toBeUndefined();
  });

  it("should create context with abort signal", () => {
    const state = createMockState();
    const stateMachine = new StateMachine();
    const monitor = createMockMonitor();
    const controller = new AbortController();

    const ctx = createPipelineContext(
      state,
      stateMachine,
      monitor as any,
      controller.signal,
    );

    expect(ctx.signal).toBe(controller.signal);
  });

  it("should initialize scratch map as empty", () => {
    const state = createMockState();
    const stateMachine = new StateMachine();
    const monitor = createMockMonitor();

    const ctx = createPipelineContext(state, stateMachine, monitor as any);

    expect(ctx.scratch.size).toBe(0);
  });
});

describe("runStages()", () => {
  let ctx: PipelineContext;

  beforeEach(() => {
    const state = createMockState();
    const stateMachine = new StateMachine();
    const monitor = createMockMonitor();
    ctx = createPipelineContext(state, stateMachine, monitor as any);
  });

  describe("basic execution", () => {
    it("should return event unchanged with empty stages array", () => {
      const event = createTokenEvent("hello");
      const result = runStages([], event, ctx);

      expect(result).toBe(event);
    });

    it("should pass event through single stage", () => {
      const event = createTokenEvent("hello");
      const stage: Stage = (e) => e;

      const result = runStages([stage], event, ctx);

      expect(result).toBe(event);
    });

    it("should pass event through multiple stages", () => {
      const event = createTokenEvent("hello");
      const stage1 = vi.fn((e: L0Event) => e);
      const stage2 = vi.fn((e: L0Event) => e);
      const stage3 = vi.fn((e: L0Event) => e);

      const result = runStages([stage1, stage2, stage3], event, ctx);

      expect(result).toBe(event);
      expect(stage1).toHaveBeenCalledWith(event, ctx);
      expect(stage2).toHaveBeenCalledWith(event, ctx);
      expect(stage3).toHaveBeenCalledWith(event, ctx);
    });
  });

  describe("event modification", () => {
    it("should allow stage to modify event", () => {
      const event = createTokenEvent("hello");
      const stage: Stage = (e) => ({
        ...e,
        value: e.value?.toUpperCase(),
      });

      const result = runStages([stage], event, ctx);

      expect(result?.value).toBe("HELLO");
    });

    it("should chain modifications through stages", () => {
      const event = createTokenEvent("hello");
      const addExclamation: Stage = (e) => ({
        ...e,
        value: e.value + "!",
      });
      const uppercase: Stage = (e) => ({
        ...e,
        value: e.value?.toUpperCase(),
      });

      const result = runStages([addExclamation, uppercase], event, ctx);

      expect(result?.value).toBe("HELLO!");
    });
  });

  describe("event filtering", () => {
    it("should filter event when stage returns null", () => {
      const event = createTokenEvent("hello");
      const filterStage: Stage = () => null;

      const result = runStages([filterStage], event, ctx);

      expect(result).toBeNull();
    });

    it("should stop processing when stage returns null", () => {
      const event = createTokenEvent("hello");
      const filterStage: Stage = () => null;
      const afterFilter = vi.fn((e: L0Event) => e);

      const result = runStages([filterStage, afterFilter], event, ctx);

      expect(result).toBeNull();
      expect(afterFilter).not.toHaveBeenCalled();
    });

    it("should filter based on event content", () => {
      const filterEmpty: Stage = (e) => (e.value === "" ? null : e);

      const emptyEvent = createTokenEvent("");
      const normalEvent = createTokenEvent("hello");

      expect(runStages([filterEmpty], emptyEvent, ctx)).toBeNull();
      expect(runStages([filterEmpty], normalEvent, ctx)).not.toBeNull();
    });
  });

  describe("context access", () => {
    it("should provide access to state", () => {
      ctx.state.content = "existing content";

      const stage: Stage = (e, c) => {
        expect(c.state.content).toBe("existing content");
        return e;
      };

      runStages([stage], createTokenEvent("hello"), ctx);
    });

    it("should provide access to state machine", () => {
      ctx.stateMachine.transition(RuntimeStates.STREAMING);

      const stage: Stage = (e, c) => {
        expect(c.stateMachine.get()).toBe(RuntimeStates.STREAMING);
        return e;
      };

      runStages([stage], createTokenEvent("hello"), ctx);
    });

    it("should allow stages to modify state", () => {
      const stage: Stage = (e, c) => {
        c.state.tokenCount++;
        return e;
      };

      runStages([stage], createTokenEvent("hello"), ctx);

      expect(ctx.state.tokenCount).toBe(1);
    });

    it("should allow stages to share data via scratch map", () => {
      const stage1: Stage = (e, c) => {
        c.scratch.set("processed", true);
        return e;
      };

      const stage2: Stage = (e, c) => {
        expect(c.scratch.get("processed")).toBe(true);
        return e;
      };

      runStages([stage1, stage2], createTokenEvent("hello"), ctx);
    });

    it("should provide access to abort signal", () => {
      const controller = new AbortController();
      const state = createMockState();
      const stateMachine = new StateMachine();
      const monitor = createMockMonitor();
      const ctxWithSignal = createPipelineContext(
        state,
        stateMachine,
        monitor as any,
        controller.signal,
      );

      const stage: Stage = (e, c) => {
        expect(c.signal).toBeDefined();
        expect(c.signal?.aborted).toBe(false);
        return e;
      };

      runStages([stage], createTokenEvent("hello"), ctxWithSignal);
    });
  });

  describe("different event types", () => {
    it("should handle token events", () => {
      const event = createTokenEvent("hello");
      const stage: Stage = (e) => e;

      const result = runStages([stage], event, ctx);

      expect(result?.type).toBe("token");
    });

    it("should handle complete events", () => {
      const event = createCompleteEvent();
      const stage: Stage = (e) => e;

      const result = runStages([stage], event, ctx);

      expect(result?.type).toBe("complete");
    });

    it("should handle error events", () => {
      const event: L0Event = {
        type: "error",
        error: new Error("test error"),
        timestamp: Date.now(),
      };
      const stage: Stage = (e) => e;

      const result = runStages([stage], event, ctx);

      expect(result?.type).toBe("error");
    });

    it("should handle message events", () => {
      const event: L0Event = {
        type: "message",
        value: '{"tool": "test"}',
        role: "assistant",
        timestamp: Date.now(),
      };
      const stage: Stage = (e) => e;

      const result = runStages([stage], event, ctx);

      expect(result?.type).toBe("message");
    });
  });
});

describe("Stage patterns", () => {
  let ctx: PipelineContext;

  beforeEach(() => {
    const state = createMockState();
    const stateMachine = new StateMachine();
    const monitor = createMockMonitor();
    ctx = createPipelineContext(state, stateMachine, monitor as any);
  });

  it("logging stage pattern", () => {
    const logs: string[] = [];
    const loggingStage: Stage = (event) => {
      logs.push(`Event: ${event.type}`);
      return event;
    };

    runStages([loggingStage], createTokenEvent("hello"), ctx);
    runStages([loggingStage], createCompleteEvent(), ctx);

    expect(logs).toEqual(["Event: token", "Event: complete"]);
  });

  it("filtering stage pattern", () => {
    const filterEmptyTokens: Stage = (event) => {
      if (event.type === "token" && !event.value?.trim()) {
        return null;
      }
      return event;
    };

    expect(
      runStages([filterEmptyTokens], createTokenEvent(""), ctx),
    ).toBeNull();
    expect(
      runStages([filterEmptyTokens], createTokenEvent("  "), ctx),
    ).toBeNull();
    expect(
      runStages([filterEmptyTokens], createTokenEvent("hello"), ctx),
    ).not.toBeNull();
    expect(
      runStages([filterEmptyTokens], createCompleteEvent(), ctx),
    ).not.toBeNull();
  });

  it("transformation stage pattern", () => {
    const normalizeWhitespace: Stage = (event) => {
      if (event.type === "token" && event.value) {
        return {
          ...event,
          value: event.value.replace(/\s+/g, " "),
        };
      }
      return event;
    };

    const result = runStages(
      [normalizeWhitespace],
      createTokenEvent("hello   world"),
      ctx,
    );

    expect(result?.value).toBe("hello world");
  });

  it("aggregation stage pattern", () => {
    const aggregateTokens: Stage = (event, c) => {
      if (event.type === "token" && event.value) {
        c.state.content += event.value;
        c.state.tokenCount++;
      }
      return event;
    };

    runStages([aggregateTokens], createTokenEvent("hello"), ctx);
    runStages([aggregateTokens], createTokenEvent(" world"), ctx);

    expect(ctx.state.content).toBe("hello world");
    expect(ctx.state.tokenCount).toBe(2);
  });

  it("conditional stage pattern", () => {
    const onlyProcessStreaming: Stage = (event, c) => {
      if (!c.stateMachine.is(RuntimeStates.STREAMING)) {
        return event; // Pass through unchanged
      }
      // Process only during streaming
      return {
        ...event,
        value: event.value ? `[STREAM] ${event.value}` : event.value,
      };
    };

    // Not streaming
    const result1 = runStages(
      [onlyProcessStreaming],
      createTokenEvent("hello"),
      ctx,
    );
    expect(result1?.value).toBe("hello");

    // Now streaming
    ctx.stateMachine.transition(RuntimeStates.STREAMING);
    const result2 = runStages(
      [onlyProcessStreaming],
      createTokenEvent("world"),
      ctx,
    );
    expect(result2?.value).toBe("[STREAM] world");
  });
});

describe("Pipeline composition", () => {
  let ctx: PipelineContext;

  beforeEach(() => {
    const state = createMockState();
    const stateMachine = new StateMachine();
    const monitor = createMockMonitor();
    ctx = createPipelineContext(state, stateMachine, monitor as any);
  });

  it("should compose multiple concerns", () => {
    // Stage 1: Filter empty tokens
    const filterEmpty: Stage = (e) =>
      e.type === "token" && !e.value?.trim() ? null : e;

    // Stage 2: Normalize whitespace
    const normalize: Stage = (e) => ({
      ...e,
      value: e.value?.replace(/\s+/g, " "),
    });

    // Stage 3: Aggregate
    const aggregate: Stage = (e, c) => {
      if (e.type === "token" && e.value) {
        c.state.content += e.value;
      }
      return e;
    };

    const stages = [filterEmpty, normalize, aggregate];

    runStages(stages, createTokenEvent("hello"), ctx);
    runStages(stages, createTokenEvent("   "), ctx); // Filtered
    runStages(stages, createTokenEvent("  world  "), ctx);

    expect(ctx.state.content).toBe("hello world ");
  });
});
