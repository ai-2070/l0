// Tests for StateMachine and RuntimeStates

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  StateMachine,
  RuntimeStates,
  createStateMachine,
  type RuntimeState,
} from "../src/runtime/state-machine";

describe("RuntimeStates", () => {
  it("should have all expected state constants", () => {
    expect(RuntimeStates.INIT).toBe("init");
    expect(RuntimeStates.WAITING_FOR_TOKEN).toBe("waiting_for_token");
    expect(RuntimeStates.STREAMING).toBe("streaming");
    expect(RuntimeStates.CONTINUATION_MATCHING).toBe("continuation_matching");
    expect(RuntimeStates.CHECKPOINT_VERIFYING).toBe("checkpoint_verifying");
    expect(RuntimeStates.RETRYING).toBe("retrying");
    expect(RuntimeStates.FALLBACK).toBe("fallback");
    expect(RuntimeStates.FINALIZING).toBe("finalizing");
    expect(RuntimeStates.COMPLETE).toBe("complete");
    expect(RuntimeStates.ERROR).toBe("error");
  });

  it("should have exactly 10 states", () => {
    expect(Object.keys(RuntimeStates)).toHaveLength(10);
  });
});

describe("StateMachine", () => {
  let sm: StateMachine;

  beforeEach(() => {
    sm = new StateMachine();
  });

  describe("initialization", () => {
    it("should start in INIT state", () => {
      expect(sm.get()).toBe(RuntimeStates.INIT);
    });

    it("should have empty history initially", () => {
      expect(sm.getHistory()).toHaveLength(0);
    });

    it("should not be terminal initially", () => {
      expect(sm.isTerminal()).toBe(false);
    });
  });

  describe("transition()", () => {
    it("should transition to a new state", () => {
      sm.transition(RuntimeStates.STREAMING);
      expect(sm.get()).toBe(RuntimeStates.STREAMING);
    });

    it("should record transition in history", () => {
      sm.transition(RuntimeStates.WAITING_FOR_TOKEN);
      const history = sm.getHistory();
      expect(history).toHaveLength(1);
      expect(history[0]!.from).toBe(RuntimeStates.INIT);
      expect(history[0]!.to).toBe(RuntimeStates.WAITING_FOR_TOKEN);
      expect(history[0]!.timestamp).toBeGreaterThan(0);
    });

    it("should not record transition to same state", () => {
      sm.transition(RuntimeStates.INIT);
      expect(sm.getHistory()).toHaveLength(0);
    });

    it("should record multiple transitions", () => {
      sm.transition(RuntimeStates.WAITING_FOR_TOKEN);
      sm.transition(RuntimeStates.STREAMING);
      sm.transition(RuntimeStates.COMPLETE);

      const history = sm.getHistory();
      expect(history).toHaveLength(3);
      expect(history[0]!.to).toBe(RuntimeStates.WAITING_FOR_TOKEN);
      expect(history[1]!.to).toBe(RuntimeStates.STREAMING);
      expect(history[2]!.to).toBe(RuntimeStates.COMPLETE);
    });
  });

  describe("get()", () => {
    it("should return current state", () => {
      expect(sm.get()).toBe(RuntimeStates.INIT);
      sm.transition(RuntimeStates.STREAMING);
      expect(sm.get()).toBe(RuntimeStates.STREAMING);
    });
  });

  describe("is()", () => {
    it("should return true if state matches", () => {
      expect(sm.is(RuntimeStates.INIT)).toBe(true);
    });

    it("should return false if state does not match", () => {
      expect(sm.is(RuntimeStates.STREAMING)).toBe(false);
    });

    it("should return true if state matches any of multiple states", () => {
      expect(sm.is(RuntimeStates.INIT, RuntimeStates.STREAMING)).toBe(true);
      sm.transition(RuntimeStates.STREAMING);
      expect(sm.is(RuntimeStates.INIT, RuntimeStates.STREAMING)).toBe(true);
    });

    it("should return false if state does not match any", () => {
      expect(sm.is(RuntimeStates.STREAMING, RuntimeStates.ERROR)).toBe(false);
    });
  });

  describe("isTerminal()", () => {
    it("should return false for non-terminal states", () => {
      expect(sm.isTerminal()).toBe(false);

      sm.transition(RuntimeStates.STREAMING);
      expect(sm.isTerminal()).toBe(false);

      sm.transition(RuntimeStates.RETRYING);
      expect(sm.isTerminal()).toBe(false);
    });

    it("should return true for COMPLETE state", () => {
      sm.transition(RuntimeStates.COMPLETE);
      expect(sm.isTerminal()).toBe(true);
    });

    it("should return true for ERROR state", () => {
      sm.transition(RuntimeStates.ERROR);
      expect(sm.isTerminal()).toBe(true);
    });
  });

  describe("reset()", () => {
    it("should reset state to INIT", () => {
      sm.transition(RuntimeStates.STREAMING);
      sm.reset();
      expect(sm.get()).toBe(RuntimeStates.INIT);
    });

    it("should clear history", () => {
      sm.transition(RuntimeStates.STREAMING);
      sm.transition(RuntimeStates.COMPLETE);
      sm.reset();
      expect(sm.getHistory()).toHaveLength(0);
    });

    it("should notify subscribers when reset from non-INIT state", () => {
      const listener = vi.fn();
      sm.subscribe(listener);

      sm.transition(RuntimeStates.STREAMING);
      listener.mockClear(); // Clear the transition notification

      sm.reset();

      expect(listener).toHaveBeenCalledTimes(1);
      expect(listener).toHaveBeenCalledWith(RuntimeStates.INIT);
    });

    it("should not notify subscribers when already at INIT (non-terminal)", () => {
      const listener = vi.fn();
      sm.subscribe(listener);

      // Already at INIT, not terminal
      sm.reset();

      expect(listener).not.toHaveBeenCalled();
    });

    it("should clear history completely on reset", () => {
      sm.transition(RuntimeStates.STREAMING);
      sm.transition(RuntimeStates.COMPLETE);
      sm.reset();

      // History should be completely cleared (reset is not a transition)
      expect(sm.getHistory()).toHaveLength(0);
    });
  });

  describe("subscribe()", () => {
    it("should notify listener on state change", () => {
      const listener = vi.fn();
      sm.subscribe(listener);

      sm.transition(RuntimeStates.STREAMING);

      expect(listener).toHaveBeenCalledTimes(1);
      expect(listener).toHaveBeenCalledWith(RuntimeStates.STREAMING);
    });

    it("should not notify on transition to same state", () => {
      const listener = vi.fn();
      sm.subscribe(listener);

      sm.transition(RuntimeStates.INIT);

      expect(listener).not.toHaveBeenCalled();
    });

    it("should notify multiple listeners", () => {
      const listener1 = vi.fn();
      const listener2 = vi.fn();
      sm.subscribe(listener1);
      sm.subscribe(listener2);

      sm.transition(RuntimeStates.STREAMING);

      expect(listener1).toHaveBeenCalledWith(RuntimeStates.STREAMING);
      expect(listener2).toHaveBeenCalledWith(RuntimeStates.STREAMING);
    });

    it("should return unsubscribe function", () => {
      const listener = vi.fn();
      const unsubscribe = sm.subscribe(listener);

      sm.transition(RuntimeStates.STREAMING);
      expect(listener).toHaveBeenCalledTimes(1);

      unsubscribe();

      sm.transition(RuntimeStates.COMPLETE);
      expect(listener).toHaveBeenCalledTimes(1);
    });

    it("should handle listener errors gracefully", () => {
      const errorListener = vi.fn(() => {
        throw new Error("Listener error");
      });
      const normalListener = vi.fn();

      sm.subscribe(errorListener);
      sm.subscribe(normalListener);

      // Should not throw
      expect(() => sm.transition(RuntimeStates.STREAMING)).not.toThrow();

      // Normal listener should still be called
      expect(normalListener).toHaveBeenCalled();
    });
  });

  describe("getHistory()", () => {
    it("should return readonly array", () => {
      sm.transition(RuntimeStates.STREAMING);
      const history = sm.getHistory();

      // TypeScript should prevent mutation, but we verify runtime behavior
      expect(Array.isArray(history)).toBe(true);
    });

    it("should include timestamps", () => {
      const before = Date.now();
      sm.transition(RuntimeStates.STREAMING);
      const after = Date.now();

      const history = sm.getHistory();
      expect(history[0]!.timestamp).toBeGreaterThanOrEqual(before);
      expect(history[0]!.timestamp).toBeLessThanOrEqual(after);
    });
  });
});

describe("createStateMachine()", () => {
  it("should create a new StateMachine instance", () => {
    const sm = createStateMachine();
    expect(sm).toBeInstanceOf(StateMachine);
    expect(sm.get()).toBe(RuntimeStates.INIT);
  });

  it("should create independent instances", () => {
    const sm1 = createStateMachine();
    const sm2 = createStateMachine();

    sm1.transition(RuntimeStates.STREAMING);

    expect(sm1.get()).toBe(RuntimeStates.STREAMING);
    expect(sm2.get()).toBe(RuntimeStates.INIT);
  });
});

describe("State machine typical flow", () => {
  it("should handle successful stream flow", () => {
    const sm = new StateMachine();

    sm.transition(RuntimeStates.WAITING_FOR_TOKEN);
    sm.transition(RuntimeStates.STREAMING);
    sm.transition(RuntimeStates.FINALIZING);
    sm.transition(RuntimeStates.COMPLETE);

    expect(sm.isTerminal()).toBe(true);
    expect(sm.getHistory()).toHaveLength(4);
  });

  it("should handle retry flow", () => {
    const sm = new StateMachine();

    sm.transition(RuntimeStates.WAITING_FOR_TOKEN);
    sm.transition(RuntimeStates.STREAMING);
    sm.transition(RuntimeStates.RETRYING);
    sm.transition(RuntimeStates.WAITING_FOR_TOKEN);
    sm.transition(RuntimeStates.STREAMING);
    sm.transition(RuntimeStates.COMPLETE);

    expect(sm.isTerminal()).toBe(true);
  });

  it("should handle fallback flow", () => {
    const sm = new StateMachine();

    sm.transition(RuntimeStates.WAITING_FOR_TOKEN);
    sm.transition(RuntimeStates.FALLBACK);
    sm.transition(RuntimeStates.WAITING_FOR_TOKEN);
    sm.transition(RuntimeStates.STREAMING);
    sm.transition(RuntimeStates.COMPLETE);

    expect(sm.isTerminal()).toBe(true);
  });

  it("should handle error flow", () => {
    const sm = new StateMachine();

    sm.transition(RuntimeStates.WAITING_FOR_TOKEN);
    sm.transition(RuntimeStates.ERROR);

    expect(sm.isTerminal()).toBe(true);
    expect(sm.get()).toBe(RuntimeStates.ERROR);
  });

  it("should handle continuation matching flow", () => {
    const sm = new StateMachine();

    sm.transition(RuntimeStates.WAITING_FOR_TOKEN);
    sm.transition(RuntimeStates.STREAMING);
    sm.transition(RuntimeStates.CONTINUATION_MATCHING);
    sm.transition(RuntimeStates.STREAMING);
    sm.transition(RuntimeStates.COMPLETE);

    expect(sm.isTerminal()).toBe(true);
  });
});
