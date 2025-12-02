import { describe, it, expect } from "vitest";
import {
  isZeroOutput,
  isNoiseOnly,
  validateZeroOutput,
  validateInstantOutput,
  zeroOutputRule,
  ZeroOutputGuardrail,
} from "../src/guardrails/zeroOutput";
import type { GuardrailContext } from "../src/types/guardrails";

describe("Zero Output Guardrail", () => {
  describe("isZeroOutput", () => {
    it("should return true for empty string", () => {
      expect(isZeroOutput("")).toBe(true);
    });

    it("should return true for null/undefined content", () => {
      expect(isZeroOutput(null as unknown as string)).toBe(true);
      expect(isZeroOutput(undefined as unknown as string)).toBe(true);
    });

    it("should return true for whitespace only", () => {
      expect(isZeroOutput("   ")).toBe(true);
      expect(isZeroOutput("\n\n\n")).toBe(true);
      expect(isZeroOutput("\t\t")).toBe(true);
      expect(isZeroOutput("  \n  \t  ")).toBe(true);
    });

    it("should return false for meaningful content", () => {
      expect(isZeroOutput("Hello")).toBe(false);
      expect(isZeroOutput("a")).toBe(false);
      expect(isZeroOutput("123")).toBe(false);
    });
  });

  describe("isNoiseOnly", () => {
    it("should return true for empty string", () => {
      expect(isNoiseOnly("")).toBe(true);
    });

    it("should return true for null/undefined content", () => {
      expect(isNoiseOnly(null as unknown as string)).toBe(true);
      expect(isNoiseOnly(undefined as unknown as string)).toBe(true);
    });

    it("should return true for punctuation only", () => {
      expect(isNoiseOnly("...")).toBe(true);
      expect(isNoiseOnly("!!!")).toBe(true);
      expect(isNoiseOnly("???")).toBe(true);
      expect(isNoiseOnly("---")).toBe(true);
    });

    it("should return true for repeated single characters", () => {
      expect(isNoiseOnly("aaaa")).toBe(true);
      expect(isNoiseOnly("....")).toBe(true);
      expect(isNoiseOnly("xxxx")).toBe(true);
    });

    it("should return true for very short non-alphanumeric content", () => {
      expect(isNoiseOnly("..")).toBe(true);
      expect(isNoiseOnly("!")).toBe(true);
    });

    it("should return false for meaningful content", () => {
      expect(isNoiseOnly("Hello")).toBe(false);
      expect(isNoiseOnly("abc")).toBe(false);
      expect(isNoiseOnly("123")).toBe(false);
      expect(isNoiseOnly("Hi!")).toBe(false);
    });

    it("should return false for mixed alphanumeric content", () => {
      expect(isNoiseOnly("a1")).toBe(false);
      expect(isNoiseOnly("test123")).toBe(false);
    });
  });

  describe("validateZeroOutput", () => {
    it("should return empty array for incomplete context with few tokens", () => {
      const context: GuardrailContext = {
        content: "",
        completed: false,
        tokenCount: 2,
      };

      const violations = validateZeroOutput(context);
      expect(violations).toHaveLength(0);
    });

    it("should detect zero output when completed", () => {
      const context: GuardrailContext = {
        content: "",
        completed: true,
        tokenCount: 10,
      };

      const violations = validateZeroOutput(context);
      expect(violations).toHaveLength(1);
      expect(violations[0]!.rule).toBe("zero-output");
      expect(violations[0]!.severity).toBe("error");
      expect(violations[0]!.message).toContain("No meaningful output");
    });

    it("should detect whitespace-only output", () => {
      const context: GuardrailContext = {
        content: "   \n\t  ",
        completed: true,
        tokenCount: 10,
      };

      const violations = validateZeroOutput(context);
      expect(violations).toHaveLength(1);
      expect(violations[0]!.message).toContain("No meaningful output");
    });

    it("should detect noise-only output", () => {
      const context: GuardrailContext = {
        content: "...",
        completed: true,
        tokenCount: 10,
      };

      const violations = validateZeroOutput(context);
      expect(violations).toHaveLength(1);
      expect(violations[0]!.message).toContain("noise or filler");
    });

    it("should not warn about short but non-empty output", () => {
      // We only flag truly empty output, not short output
      const context: GuardrailContext = {
        content: "Hi",
        completed: true,
        tokenCount: 10,
      };

      const violations = validateZeroOutput(context);
      expect(violations).toHaveLength(0);
    });

    it("should return empty array for meaningful content", () => {
      const context: GuardrailContext = {
        content: "This is a meaningful response with sufficient content.",
        completed: true,
        tokenCount: 10,
      };

      const violations = validateZeroOutput(context);
      expect(violations).toHaveLength(0);
    });

    it("should check when tokenCount >= 5 even if not completed", () => {
      const context: GuardrailContext = {
        content: "",
        completed: false,
        tokenCount: 5,
      };

      const violations = validateZeroOutput(context);
      expect(violations).toHaveLength(1);
    });
  });

  describe("validateInstantOutput", () => {
    it("should return empty array for incomplete context", () => {
      const context: GuardrailContext = {
        content: "test",
        completed: false,
        tokenCount: 2,
      };

      const violations = validateInstantOutput(context);
      expect(violations).toHaveLength(0);
    });

    it("should return empty array without timing metadata", () => {
      const context: GuardrailContext = {
        content: "test",
        completed: true,
        tokenCount: 2,
      };

      const violations = validateInstantOutput(context);
      expect(violations).toHaveLength(0);
    });

    it("should detect instant output with minimal tokens", () => {
      const now = Date.now();
      const context: GuardrailContext = {
        content: "Hi",
        completed: true,
        tokenCount: 2,
        metadata: {
          startTime: now,
          endTime: now + 50, // 50ms - less than 100ms threshold
        },
      };

      const violations = validateInstantOutput(context);
      expect(violations).toHaveLength(1);
      expect(violations[0]!.rule).toBe("zero-output");
      expect(violations[0]!.message).toContain("instantly");
    });

    it("should not flag output with reasonable duration", () => {
      const now = Date.now();
      const context: GuardrailContext = {
        content: "Hello world",
        completed: true,
        tokenCount: 10,
        metadata: {
          startTime: now,
          endTime: now + 500, // 500ms
        },
      };

      const violations = validateInstantOutput(context);
      expect(violations).toHaveLength(0);
    });

    it("should not flag instant output with many tokens", () => {
      const now = Date.now();
      const context: GuardrailContext = {
        content: "Hello world this is a test",
        completed: true,
        tokenCount: 10, // >= 5 tokens threshold
        metadata: {
          startTime: now,
          endTime: now + 50,
        },
      };

      const violations = validateInstantOutput(context);
      expect(violations).toHaveLength(0);
    });
  });

  describe("zeroOutputRule", () => {
    it("should create a valid guardrail rule", () => {
      const rule = zeroOutputRule();

      expect(rule.name).toBe("zero-output");
      expect(rule.description).toBe("Detects zero or meaningless output");
      expect(rule.streaming).toBe(true);
      expect(rule.severity).toBe("error");
      expect(rule.recoverable).toBe(false);
      expect(typeof rule.check).toBe("function");
    });

    it("should combine zero output and instant output checks", () => {
      const rule = zeroOutputRule();
      const now = Date.now();

      const context: GuardrailContext = {
        content: "",
        completed: true,
        tokenCount: 2,
        metadata: {
          startTime: now,
          endTime: now + 50,
        },
      };

      const violations = rule.check(context);
      // Should have violations from both validateZeroOutput and validateInstantOutput
      expect(violations.length).toBeGreaterThanOrEqual(2);
    });

    it("should return empty array for valid content", () => {
      const rule = zeroOutputRule();
      const now = Date.now();

      const context: GuardrailContext = {
        content: "This is a valid response with meaningful content.",
        completed: true,
        tokenCount: 10,
        metadata: {
          startTime: now,
          endTime: now + 500,
        },
      };

      const violations = rule.check(context);
      expect(violations).toHaveLength(0);
    });
  });

  describe("ZeroOutputGuardrail", () => {
    it("should create instance with correct name", () => {
      const guardrail = new ZeroOutputGuardrail();
      expect(guardrail.name).toBe("zero-output");
    });

    it("should check context and return violations", () => {
      const guardrail = new ZeroOutputGuardrail();

      const context: GuardrailContext = {
        content: "",
        completed: true,
        tokenCount: 10,
      };

      const violations = guardrail.check(context);
      expect(violations).toHaveLength(1);
      expect(violations[0]!.rule).toBe("zero-output");
    });

    it("should return empty array for valid content", () => {
      const guardrail = new ZeroOutputGuardrail();

      const context: GuardrailContext = {
        content: "This is meaningful content with sufficient length.",
        completed: true,
        tokenCount: 10,
      };

      const violations = guardrail.check(context);
      expect(violations).toHaveLength(0);
    });
  });
});
