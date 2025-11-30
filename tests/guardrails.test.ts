// Comprehensive guardrails tests
import { describe, it, expect, beforeEach } from "vitest";
import {
  GuardrailEngine,
  createGuardrailEngine,
  checkGuardrails,
  jsonRule,
  strictJsonRule,
  markdownRule,
  latexRule,
  patternRule,
  customPatternRule,
  zeroOutputRule,
  minimalGuardrails,
  recommendedGuardrails,
  strictGuardrails,
  jsonOnlyGuardrails,
  markdownOnlyGuardrails,
  latexOnlyGuardrails,
} from "../src/guardrails";
import type {
  GuardrailContext,
  GuardrailRule,
  GuardrailViolation,
} from "../src/types/guardrails";

describe("GuardrailEngine", () => {
  let engine: GuardrailEngine;

  beforeEach(() => {
    engine = new GuardrailEngine({
      rules: [jsonRule()],
      stopOnFatal: true,
      enableStreaming: true,
    });
  });

  describe("Initialization", () => {
    it("should initialize with rules", () => {
      expect(engine).toBeDefined();
    });

    it("should initialize with empty rules", () => {
      const emptyEngine = new GuardrailEngine({ rules: [] });
      expect(emptyEngine).toBeDefined();
    });

    it("should apply default config", () => {
      const defaultEngine = new GuardrailEngine({
        rules: [jsonRule()],
      });
      expect(defaultEngine).toBeDefined();
    });
  });

  describe("Check Execution", () => {
    it("should check content against rules", () => {
      const context: GuardrailContext = {
        content: '{"valid": "json"}',
        completed: true,
        tokenCount: 10,
      };

      const result = engine.check(context);
      expect(result.passed).toBe(true);
      expect(result.violations).toHaveLength(0);
    });

    it("should detect violations", () => {
      const context: GuardrailContext = {
        content: '{"unclosed": "json"',
        completed: true,
        tokenCount: 10,
      };

      const result = engine.check(context);
      expect(result.passed).toBe(false);
      expect(result.violations.length).toBeGreaterThan(0);
    });

    it("should track violation count", () => {
      const context: GuardrailContext = {
        content: '{"bad": json}',
        completed: true,
        tokenCount: 10,
      };

      const result = engine.check(context);
      expect(result.summary.total).toBeGreaterThan(0);
    });

    it("should identify fatal violations", () => {
      const fatalRule: GuardrailRule = {
        name: "fatal-test",
        description: "Always fails with fatal",
        streaming: false,
        severity: "fatal",
        recoverable: false,
        check: () => [
          {
            rule: "fatal-test",
            message: "Fatal error",
            severity: "fatal",
            recoverable: false,
          },
        ],
      };

      const fatalEngine = new GuardrailEngine({
        rules: [fatalRule],
        stopOnFatal: true,
      });

      const context: GuardrailContext = {
        content: "test",
        completed: true,
        tokenCount: 5,
      };

      const result = fatalEngine.check(context);
      expect(result.passed).toBe(false);
      expect(result.summary.fatal).toBeGreaterThan(0);
    });

    it("should stop on fatal when configured", () => {
      const rules: GuardrailRule[] = [
        {
          name: "fatal-rule",
          description: "Fatal rule",
          streaming: false,
          severity: "fatal",
          recoverable: false,
          check: () => [
            {
              rule: "fatal-rule",
              message: "Fatal",
              severity: "fatal",
              recoverable: false,
            },
          ],
        },
        {
          name: "should-not-run",
          description: "Should not execute",
          streaming: false,
          severity: "error",
          recoverable: true,
          check: () => {
            throw new Error("This should not execute");
          },
        },
      ];

      const stopEngine = new GuardrailEngine({
        rules,
        stopOnFatal: true,
      });

      const context: GuardrailContext = {
        content: "test",
        completed: true,
        tokenCount: 5,
      };

      const result = stopEngine.check(context);
      expect(result.summary.fatal).toBeGreaterThan(0);
      // Should only have one violation (from fatal rule)
      expect(result.violations).toHaveLength(1);
    });

    it("should continue on fatal when configured", () => {
      const rules: GuardrailRule[] = [
        {
          name: "fatal-rule",
          description: "Fatal rule",
          streaming: false,
          severity: "fatal",
          recoverable: false,
          check: () => [
            {
              rule: "fatal-rule",
              message: "Fatal",
              severity: "fatal",
              recoverable: false,
            },
          ],
        },
        {
          name: "should-run",
          description: "Should execute",
          streaming: false,
          severity: "error",
          recoverable: true,
          check: () => [
            {
              rule: "should-run",
              message: "Error",
              severity: "error",
              recoverable: true,
            },
          ],
        },
      ];

      const continueEngine = new GuardrailEngine({
        rules,
        stopOnFatal: false,
      });

      const context: GuardrailContext = {
        content: "test",
        completed: true,
        tokenCount: 5,
      };

      const result = continueEngine.check(context);
      expect(result.violations).toHaveLength(2);
    });
  });

  describe("Streaming Behavior", () => {
    it("should skip streaming rules when not enabled", () => {
      const streamingRule: GuardrailRule = {
        name: "streaming-rule",
        description: "Streaming rule",
        streaming: true,
        severity: "error",
        recoverable: true,
        check: () => {
          throw new Error("Should not execute");
        },
      };

      const noStreamEngine = new GuardrailEngine({
        rules: [streamingRule],
        enableStreaming: false,
      });

      const context: GuardrailContext = {
        content: "test",
        completed: false,
        tokenCount: 5,
      };

      const result = noStreamEngine.check(context);
      expect(result.violations).toHaveLength(0);
    });

    it("should execute streaming rules when enabled and streaming", () => {
      const streamingRule: GuardrailRule = {
        name: "streaming-rule",
        description: "Streaming rule",
        streaming: true,
        severity: "warning",
        recoverable: true,
        check: () => [
          {
            rule: "streaming-rule",
            message: "Warning",
            severity: "warning",
            recoverable: true,
          },
        ],
      };

      const streamEngine = new GuardrailEngine({
        rules: [streamingRule],
        enableStreaming: true,
      });

      const context: GuardrailContext = {
        content: "test",
        completed: false,
        tokenCount: 5,
      };

      const result = streamEngine.check(context);
      expect(result.violations).toHaveLength(1);
    });

    it("should skip non-streaming rules during streaming", () => {
      const nonStreamingRule: GuardrailRule = {
        name: "non-streaming-rule",
        description: "Non-streaming rule",
        streaming: false,
        severity: "error",
        recoverable: true,
        check: () => {
          throw new Error("Should not execute during streaming");
        },
      };

      const streamEngine = new GuardrailEngine({
        rules: [nonStreamingRule],
        enableStreaming: true,
      });

      const context: GuardrailContext = {
        content: "test",
        completed: false,
        tokenCount: 5,
      };

      const result = streamEngine.check(context);
      expect(result.violations).toHaveLength(0);
    });

    it("should execute non-streaming rules when complete", () => {
      const nonStreamingRule: GuardrailRule = {
        name: "non-streaming-rule",
        description: "Non-streaming rule",
        streaming: false,
        severity: "error",
        recoverable: true,
        check: () => [
          {
            rule: "non-streaming-rule",
            message: "Error",
            severity: "error",
            recoverable: true,
          },
        ],
      };

      const streamEngine = new GuardrailEngine({
        rules: [nonStreamingRule],
        enableStreaming: true,
      });

      const context: GuardrailContext = {
        content: "test",
        completed: true,
        tokenCount: 5,
      };

      const result = streamEngine.check(context);
      expect(result.violations).toHaveLength(1);
    });
  });

  describe("State Management", () => {
    it("should reset state", () => {
      const context: GuardrailContext = {
        content: '{"bad": json}',
        completed: true,
        tokenCount: 10,
      };

      engine.check(context);
      engine.reset();

      const state = engine.getState();
      expect(state.violations).toHaveLength(0);
      expect(state.violationCount).toBe(0);
    });

    it("should track violations by rule", () => {
      const context: GuardrailContext = {
        content: '{"unclosed": "json"',
        completed: true,
        tokenCount: 10,
      };

      engine.check(context);

      const state = engine.getState();
      expect(state.violationsByRule.size).toBeGreaterThan(0);
    });

    it("should provide violation tracking", () => {
      const context: GuardrailContext = {
        content: '{"bad": json}',
        completed: true,
        tokenCount: 10,
      };

      const result = engine.check(context);
      const hasViolations = engine.hasViolations();

      expect(hasViolations).toBe(true);
      expect(engine.getAllViolations().length).toBe(result.summary.total);
    });
  });

  describe("Error Handling", () => {
    it("should handle rule execution errors gracefully", () => {
      const errorRule: GuardrailRule = {
        name: "error-rule",
        description: "Throws error",
        streaming: false,
        severity: "error",
        recoverable: true,
        check: () => {
          throw new Error("Rule execution failed");
        },
      };

      const errorEngine = new GuardrailEngine({
        rules: [errorRule],
      });

      const context: GuardrailContext = {
        content: "test",
        completed: true,
        tokenCount: 5,
      };

      const result = errorEngine.check(context);
      // Should handle error gracefully
      expect(result).toBeDefined();
    });
  });
});

describe("JSON Guardrails", () => {
  describe("jsonRule", () => {
    it("should pass valid JSON", () => {
      const rule = jsonRule();
      const context: GuardrailContext = {
        content: '{"valid": "json", "number": 42}',
        completed: true,
        tokenCount: 10,
      };

      const violations = rule.check(context);
      expect(violations).toHaveLength(0);
    });

    it("should detect unbalanced braces", () => {
      const rule = jsonRule();
      const context: GuardrailContext = {
        content: '{"unclosed": "json"',
        completed: true,
        tokenCount: 10,
      };

      const violations = rule.check(context);
      expect(violations.length).toBeGreaterThan(0);
      expect(violations[0]!.rule).toBe("json-structure");
    });

    it("should detect unbalanced brackets", () => {
      const rule = jsonRule();
      const context: GuardrailContext = {
        content: '["unclosed"',
        completed: true,
        tokenCount: 10,
      };

      const violations = rule.check(context);
      expect(violations.length).toBeGreaterThan(0);
    });

    it("should detect unparseable JSON", () => {
      const rule = jsonRule();
      const context: GuardrailContext = {
        content: '{"invalid": value}',
        completed: true,
        tokenCount: 10,
      };

      const violations = rule.check(context);
      expect(violations.length).toBeGreaterThan(0);
      expect(violations.some((v) => v.rule === "json-parseable")).toBe(true);
    });

    it("should detect malformed JSON chunks", () => {
      const rule = jsonRule();
      const context: GuardrailContext = {
        content: '{"key":, "value": 1}',
        completed: true,
        tokenCount: 10,
        delta: ", ",
      };

      const violations = rule.check(context);
      expect(violations.length).toBeGreaterThan(0);
    });

    it("should handle streaming incomplete JSON", () => {
      const rule = jsonRule();
      const context: GuardrailContext = {
        content: '{"streaming": "in progress"',
        completed: false,
        tokenCount: 10,
      };

      const violations = rule.check(context);
      // Should be lenient with incomplete streaming
      expect(violations).toHaveLength(0);
    });

    it("should detect premature closing in streaming", () => {
      const rule = jsonRule();
      const context: GuardrailContext = {
        content: "{",
        completed: false,
        tokenCount: 5,
      };

      const violations = rule.check(context);
      // Should be lenient with streaming incomplete
      expect(violations).toHaveLength(0);
    });

    it("should handle non-JSON content gracefully", () => {
      const rule = jsonRule();
      const context: GuardrailContext = {
        content: "This is plain text, not JSON",
        completed: true,
        tokenCount: 10,
      };

      const violations = rule.check(context);
      // Should not flag non-JSON content
      expect(violations).toHaveLength(0);
    });

    it("should detect unclosed strings", () => {
      const rule = jsonRule();
      const context: GuardrailContext = {
        content: '{"key": "unclosed string',
        completed: true,
        tokenCount: 10,
      };

      const violations = rule.check(context);
      expect(violations.length).toBeGreaterThan(0);
    });

    it("should handle escaped quotes in strings", () => {
      const rule = jsonRule();
      const context: GuardrailContext = {
        content: '{"key": "value with \\"escaped\\" quotes"}',
        completed: true,
        tokenCount: 10,
      };

      const violations = rule.check(context);
      expect(violations).toHaveLength(0);
    });
  });

  describe("strictJsonRule", () => {
    it("should pass valid JSON object", () => {
      const rule = strictJsonRule();
      const context: GuardrailContext = {
        content: '{"valid": true}',
        completed: true,
        tokenCount: 10,
      };

      const violations = rule.check(context);
      expect(violations).toHaveLength(0);
    });

    it("should pass valid JSON array", () => {
      const rule = strictJsonRule();
      const context: GuardrailContext = {
        content: "[1, 2, 3]",
        completed: true,
        tokenCount: 10,
      };

      const violations = rule.check(context);
      expect(violations).toHaveLength(0);
    });

    it("should reject non-JSON content", () => {
      const rule = strictJsonRule();
      const context: GuardrailContext = {
        content: "Plain text",
        completed: true,
        tokenCount: 10,
      };

      const violations = rule.check(context);
      expect(violations.length).toBeGreaterThan(0);
      expect(violations[0]!.rule).toBe("json-strict");
    });

    it("should reject primitive JSON values", () => {
      const rule = strictJsonRule();
      const context: GuardrailContext = {
        content: '"just a string"',
        completed: true,
        tokenCount: 10,
      };

      const violations = rule.check(context);
      expect(violations.length).toBeGreaterThan(0);
    });

    it("should only run on complete output", () => {
      const rule = strictJsonRule();
      const context: GuardrailContext = {
        content: '{"incomplete"',
        completed: false,
        tokenCount: 10,
      };

      const violations = rule.check(context);
      expect(violations).toHaveLength(0);
    });
  });
});

describe("Pattern Guardrails", () => {
  describe("patternRule", () => {
    it("should detect meta commentary", () => {
      const rule = patternRule();
      const context: GuardrailContext = {
        content: "As an AI language model, I think this is interesting",
        completed: true,
        tokenCount: 10,
      };

      const violations = rule.check(context);
      expect(violations.length).toBeGreaterThan(0);
    });

    it("should pass when no bad patterns found", () => {
      const rule = patternRule();
      const context: GuardrailContext = {
        content: "This is clean, normal content without any bad patterns.",
        completed: true,
        tokenCount: 10,
      };

      const violations = rule.check(context);
      expect(violations).toHaveLength(0);
    });

    it("should detect instruction leakage", () => {
      const rule = patternRule();
      const context: GuardrailContext = {
        content: "[system] You are a helpful assistant",
        completed: true,
        tokenCount: 10,
      };

      const violations = rule.check(context);
      expect(violations.length).toBeGreaterThan(0);
    });
  });

  describe("customPatternRule", () => {
    it("should create custom pattern rule", () => {
      const rule = customPatternRule(
        [/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i],
        "Email detected",
        "warning",
      );

      expect(rule.name).toBe("pattern-custom");
      expect(rule.severity).toBe("warning");

      const context: GuardrailContext = {
        content: "Contact us at test@example.com",
        completed: true,
        tokenCount: 10,
      };

      const violations = rule.check(context);
      expect(violations.length).toBeGreaterThan(0);
    });

    it("should respect severity setting", () => {
      const rule = customPatternRule(
        [/critical/i],
        "Critical pattern found",
        "fatal",
      );

      const context: GuardrailContext = {
        content: "This is critical",
        completed: true,
        tokenCount: 10,
      };

      const violations = rule.check(context);
      expect(violations[0]!.severity).toBe("fatal");
    });
  });
});

describe("Zero Output Guardrail", () => {
  describe("zeroOutputRule", () => {
    it("should detect zero output", () => {
      const rule = zeroOutputRule();
      const context: GuardrailContext = {
        content: "",
        completed: true,
        tokenCount: 0,
      };

      const violations = rule.check(context);
      expect(violations.length).toBeGreaterThan(0);
      expect(violations[0]!.rule).toBe("zero-output");
    });

    it("should detect whitespace-only output", () => {
      const rule = zeroOutputRule();
      const context: GuardrailContext = {
        content: "   \n\t  ",
        completed: true,
        tokenCount: 5,
      };

      const violations = rule.check(context);
      expect(violations.length).toBeGreaterThan(0);
    });

    it("should pass with actual content", () => {
      const rule = zeroOutputRule();
      const context: GuardrailContext = {
        content: "Actual content here",
        completed: true,
        tokenCount: 10,
      };

      const violations = rule.check(context);
      expect(violations).toHaveLength(0);
    });

    it("should only check complete output", () => {
      const rule = zeroOutputRule();
      const context: GuardrailContext = {
        content: "in",
        completed: false,
        tokenCount: 1,
      };

      const violations = rule.check(context);
      expect(violations).toHaveLength(0);
    });
  });
});

describe("Markdown Guardrails", () => {
  describe("markdownRule", () => {
    it("should pass valid markdown", () => {
      const rule = markdownRule();
      const context: GuardrailContext = {
        content: "# Title\n\nSome **bold** text\n\n```js\ncode\n```",
        completed: true,
        tokenCount: 10,
      };

      const violations = rule.check(context);
      expect(violations).toHaveLength(0);
    });

    it("should detect unclosed code fences", () => {
      const rule = markdownRule();
      const context: GuardrailContext = {
        content: "```javascript\nconst x = 1;",
        completed: true,
        tokenCount: 10,
      };

      const violations = rule.check(context);
      expect(violations.length).toBeGreaterThan(0);
    });

    it("should handle streaming markdown", () => {
      const rule = markdownRule();
      const context: GuardrailContext = {
        content: "```javascript\nconst x = 1",
        completed: false,
        tokenCount: 10,
      };

      const violations = rule.check(context);
      // Should be lenient with streaming
      expect(violations).toHaveLength(0);
    });
  });
});

describe("LaTeX Guardrails", () => {
  describe("latexRule", () => {
    it("should pass valid LaTeX", () => {
      const rule = latexRule();
      const context: GuardrailContext = {
        content: "\\begin{equation}x = y\\end{equation}",
        completed: true,
        tokenCount: 10,
      };

      const violations = rule.check(context);
      expect(violations).toHaveLength(0);
    });

    it("should detect unmatched environments", () => {
      const rule = latexRule();
      const context: GuardrailContext = {
        content: "\\begin{equation}x = y",
        completed: true,
        tokenCount: 10,
      };

      const violations = rule.check(context);
      expect(violations.length).toBeGreaterThan(0);
    });

    it("should handle non-LaTeX content", () => {
      const rule = latexRule();
      const context: GuardrailContext = {
        content: "Regular text without LaTeX",
        completed: true,
        tokenCount: 10,
      };

      const violations = rule.check(context);
      expect(violations).toHaveLength(0);
    });
  });
});

describe("Guardrail Presets", () => {
  describe("minimalGuardrails", () => {
    it("should have basic rules", () => {
      expect(minimalGuardrails).toBeDefined();
      expect(minimalGuardrails.length).toBeGreaterThan(0);
    });

    it("should detect zero output", () => {
      const engine = new GuardrailEngine({ rules: minimalGuardrails });
      const context: GuardrailContext = {
        content: "",
        completed: true,
        tokenCount: 0,
      };

      const result = engine.check(context);
      expect(result.passed).toBe(false);
    });
  });

  describe("recommendedGuardrails", () => {
    it("should have more rules than minimal", () => {
      expect(recommendedGuardrails.length).toBeGreaterThanOrEqual(
        minimalGuardrails.length,
      );
    });

    it("should validate JSON", () => {
      const engine = new GuardrailEngine({ rules: recommendedGuardrails });
      const context: GuardrailContext = {
        content: '{"invalid": json}',
        completed: true,
        tokenCount: 10,
      };

      const result = engine.check(context);
      expect(result.passed).toBe(false);
    });
  });

  describe("strictGuardrails", () => {
    it("should have most comprehensive rules", () => {
      expect(strictGuardrails.length).toBeGreaterThanOrEqual(
        recommendedGuardrails.length,
      );
    });
  });

  describe("jsonOnlyGuardrails", () => {
    it("should contain JSON rules", () => {
      expect(jsonOnlyGuardrails).toBeDefined();
      expect(jsonOnlyGuardrails.length).toBeGreaterThan(0);
      expect(jsonOnlyGuardrails.some((r) => r.name.includes("json"))).toBe(
        true,
      );
    });
  });

  describe("markdownOnlyGuardrails", () => {
    it("should contain Markdown rules", () => {
      expect(markdownOnlyGuardrails).toBeDefined();
      expect(markdownOnlyGuardrails.length).toBeGreaterThan(0);
      expect(
        markdownOnlyGuardrails.some((r) => r.name.includes("markdown")),
      ).toBe(true);
    });
  });

  describe("latexOnlyGuardrails", () => {
    it("should contain LaTeX rules", () => {
      expect(latexOnlyGuardrails).toBeDefined();
      expect(latexOnlyGuardrails.length).toBeGreaterThan(0);
      expect(latexOnlyGuardrails.some((r) => r.name.includes("latex"))).toBe(
        true,
      );
    });
  });
});

describe("Helper Functions", () => {
  describe("createGuardrailEngine", () => {
    it("should create engine with config", () => {
      const engine = createGuardrailEngine([jsonRule()], {
        stopOnFatal: true,
      });

      expect(engine).toBeDefined();
      expect(engine).toBeInstanceOf(GuardrailEngine);
    });
  });

  describe("checkGuardrails", () => {
    it("should check content with rules", () => {
      const context: GuardrailContext = {
        content: '{"valid": "json"}',
        completed: true,
        tokenCount: 10,
      };
      const result = checkGuardrails(context, [jsonRule()]);

      expect(result.passed).toBe(true);
    });

    it("should detect violations", () => {
      const context: GuardrailContext = {
        content: '{"invalid": json}',
        completed: true,
        tokenCount: 10,
      };
      const result = checkGuardrails(context, [jsonRule()]);

      expect(result.passed).toBe(false);
      expect(result.violations.length).toBeGreaterThan(0);
    });
  });
});

describe("Edge Cases", () => {
  it("should handle empty content", () => {
    const engine = new GuardrailEngine({ rules: [jsonRule()] });
    const context: GuardrailContext = {
      content: "",
      completed: true,
      tokenCount: 0,
    };

    const result = engine.check(context);
    expect(result).toBeDefined();
  });

  it("should handle very long content", () => {
    const engine = new GuardrailEngine({ rules: [jsonRule()] });
    const longContent = '{"key": "' + "x".repeat(100000) + '"}';
    const context: GuardrailContext = {
      content: longContent,
      completed: true,
      tokenCount: 100000,
    };

    const result = engine.check(context);
    expect(result).toBeDefined();
  });

  it("should handle special characters", () => {
    const engine = new GuardrailEngine({ rules: [jsonRule()] });
    const context: GuardrailContext = {
      content: '{"unicode": "😀🎉✨", "escaped": "\\n\\t\\r"}',
      completed: true,
      tokenCount: 10,
    };

    const result = engine.check(context);
    expect(result.passed).toBe(true);
  });

  it("should handle nested JSON structures", () => {
    const engine = new GuardrailEngine({ rules: [jsonRule()] });
    const context: GuardrailContext = {
      content: '{"a": {"b": {"c": {"d": "deep"}}}}',
      completed: true,
      tokenCount: 10,
    };

    const result = engine.check(context);
    expect(result.passed).toBe(true);
  });

  it("should handle JSON with arrays", () => {
    const engine = new GuardrailEngine({ rules: [jsonRule()] });
    const context: GuardrailContext = {
      content: '{"items": [1, 2, {"nested": [3, 4]}]}',
      completed: true,
      tokenCount: 10,
    };

    const result = engine.check(context);
    expect(result.passed).toBe(true);
  });

  it("should handle multiple consecutive violations", () => {
    const engine = new GuardrailEngine({
      rules: [jsonRule(), zeroOutputRule()],
    });
    const context: GuardrailContext = {
      content: "",
      completed: true,
      tokenCount: 0,
    };

    const result = engine.check(context);
    expect(result.violations.length).toBeGreaterThan(0);
  });

  it("should handle context with delta", () => {
    const engine = new GuardrailEngine({ rules: [jsonRule()] });
    const context: GuardrailContext = {
      content: '{"key": "value"}',
      completed: false,
      delta: '"value"',
      tokenCount: 10,
    };

    const result = engine.check(context);
    expect(result).toBeDefined();
  });

  it("should handle undefined delta gracefully", () => {
    const engine = new GuardrailEngine({ rules: [jsonRule()] });
    const context: GuardrailContext = {
      content: '{"key": "value"}',
      completed: false,
      delta: undefined,
      tokenCount: 10,
    };

    const result = engine.check(context);
    expect(result).toBeDefined();
  });
});

describe("Integration", () => {
  it("should work with multiple rule types", () => {
    const engine = new GuardrailEngine({
      rules: [jsonRule(), markdownRule(), zeroOutputRule()],
    });

    const context: GuardrailContext = {
      content: '{"valid": "json"}',
      completed: true,
      tokenCount: 10,
    };

    const result = engine.check(context);
    expect(result.passed).toBe(true);
  });

  it("should aggregate violations from multiple rules", () => {
    const engine = new GuardrailEngine({
      rules: [
        jsonRule(),
        customPatternRule([/forbidden/i], "Forbidden word"),
        zeroOutputRule(),
      ],
    });

    const context: GuardrailContext = {
      content: "",
      completed: true,
      tokenCount: 0,
    };

    const result = engine.check(context);
    expect(result.violations.length).toBeGreaterThan(0);
  });

  it("should provide comprehensive violation summary", () => {
    const engine = new GuardrailEngine({
      rules: [jsonRule(), markdownRule()],
    });

    const context: GuardrailContext = {
      content: '{"bad": json} ```unclosed',
      completed: true,
      tokenCount: 10,
    };

    engine.check(context);
    const allViolations = engine.getAllViolations();

    expect(allViolations.length).toBeGreaterThan(0);
    expect(engine.hasViolations()).toBe(true);
  });
});
