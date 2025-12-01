// Tests for src/guardrails/patterns.ts

import { describe, it, expect } from "vitest";
import {
  BAD_PATTERNS,
  findBadPatterns,
  detectMetaCommentary,
  detectExcessiveHedging,
  detectRefusal,
  detectInstructionLeakage,
  detectPlaceholders,
  detectFormatCollapse,
  detectRepetition,
  detectFirstLastDuplicate,
  patternRule,
  customPatternRule,
  PatternGuardrail,
} from "../src/guardrails/patterns";
import type { GuardrailContext } from "../src/types/guardrails";

// Helper to create guardrail context
function createContext(
  content: string,
  completed: boolean = true,
): GuardrailContext {
  return {
    content,
    completed,
    tokenCount: content.split(/\s+/).length,
  };
}

describe("BAD_PATTERNS", () => {
  it("should have META_COMMENTARY patterns", () => {
    expect(BAD_PATTERNS.META_COMMENTARY).toBeInstanceOf(Array);
    expect(BAD_PATTERNS.META_COMMENTARY.length).toBeGreaterThan(0);
  });

  it("should have EXCESSIVE_HEDGING patterns", () => {
    expect(BAD_PATTERNS.EXCESSIVE_HEDGING).toBeInstanceOf(Array);
    expect(BAD_PATTERNS.EXCESSIVE_HEDGING.length).toBeGreaterThan(0);
  });

  it("should have REFUSAL patterns", () => {
    expect(BAD_PATTERNS.REFUSAL).toBeInstanceOf(Array);
    expect(BAD_PATTERNS.REFUSAL.length).toBeGreaterThan(0);
  });

  it("should have INSTRUCTION_LEAK patterns", () => {
    expect(BAD_PATTERNS.INSTRUCTION_LEAK).toBeInstanceOf(Array);
    expect(BAD_PATTERNS.INSTRUCTION_LEAK.length).toBeGreaterThan(0);
  });

  it("should have PLACEHOLDERS patterns", () => {
    expect(BAD_PATTERNS.PLACEHOLDERS).toBeInstanceOf(Array);
    expect(BAD_PATTERNS.PLACEHOLDERS.length).toBeGreaterThan(0);
  });

  it("should have FORMAT_COLLAPSE patterns", () => {
    expect(BAD_PATTERNS.FORMAT_COLLAPSE).toBeInstanceOf(Array);
    expect(BAD_PATTERNS.FORMAT_COLLAPSE.length).toBeGreaterThan(0);
  });
});

describe("findBadPatterns", () => {
  it("should find matching patterns", () => {
    const patterns = [/hello/i, /world/i];
    const matches = findBadPatterns("Hello World!", patterns);

    expect(matches).toHaveLength(2);
    expect(matches[0]?.match.toLowerCase()).toBe("hello");
    expect(matches[1]?.match.toLowerCase()).toBe("world");
  });

  it("should return empty array when no matches", () => {
    const patterns = [/xyz/i];
    const matches = findBadPatterns("Hello World!", patterns);

    expect(matches).toHaveLength(0);
  });

  it("should include match index", () => {
    const patterns = [/world/i];
    const matches = findBadPatterns("Hello World!", patterns);

    expect(matches[0]?.index).toBe(6);
  });

  it("should handle empty content", () => {
    const patterns = [/test/i];
    const matches = findBadPatterns("", patterns);

    expect(matches).toHaveLength(0);
  });

  it("should handle empty patterns array", () => {
    const matches = findBadPatterns("Hello World!", []);

    expect(matches).toHaveLength(0);
  });
});

describe("detectMetaCommentary", () => {
  it("should detect 'as an AI language model'", () => {
    const context = createContext(
      "As an AI language model, I cannot actually do that.",
    );
    const violations = detectMetaCommentary(context);

    expect(violations.length).toBeGreaterThan(0);
    expect(violations[0]?.rule).toBe("pattern-meta-commentary");
  });

  it("should detect 'as an AI assistant'", () => {
    const context = createContext("As an AI assistant, I'm here to help you.");
    const violations = detectMetaCommentary(context);

    expect(violations.length).toBeGreaterThan(0);
  });

  it("should detect 'I'm an AI'", () => {
    const context = createContext("I'm an AI and I cannot do that.");
    const violations = detectMetaCommentary(context);

    expect(violations.length).toBeGreaterThan(0);
  });

  it("should detect 'I am an AI'", () => {
    const context = createContext("I am an AI created by...");
    const violations = detectMetaCommentary(context);

    expect(violations.length).toBeGreaterThan(0);
  });

  it("should detect 'I apologize, but I'", () => {
    const context = createContext("I apologize, but I cannot help with that.");
    const violations = detectMetaCommentary(context);

    expect(violations.length).toBeGreaterThan(0);
  });

  it("should not flag normal content", () => {
    const context = createContext(
      "Here is the information you requested about the topic.",
    );
    const violations = detectMetaCommentary(context);

    expect(violations).toHaveLength(0);
  });
});

describe("detectExcessiveHedging", () => {
  it("should detect 'Sure!' at start", () => {
    const context = createContext("Sure!\n\nHere is the answer.");
    const violations = detectExcessiveHedging(context);

    expect(violations.length).toBeGreaterThan(0);
    expect(violations[0]?.rule).toBe("pattern-hedging");
  });

  it("should detect 'Certainly!' at start", () => {
    const context = createContext("Certainly!\nI can help with that.");
    const violations = detectExcessiveHedging(context);

    expect(violations.length).toBeGreaterThan(0);
  });

  it("should detect 'Of course!' at start", () => {
    const context = createContext("Of course!\n\nLet me explain.");
    const violations = detectExcessiveHedging(context);

    expect(violations.length).toBeGreaterThan(0);
  });

  it("should detect 'Absolutely!' at start", () => {
    const context = createContext("Absolutely!\n\nThe answer is...");
    const violations = detectExcessiveHedging(context);

    expect(violations.length).toBeGreaterThan(0);
  });

  it("should not flag hedging in middle of content", () => {
    const context = createContext(
      "The answer is 42. Certainly, this is correct.",
    );
    const violations = detectExcessiveHedging(context);

    expect(violations).toHaveLength(0);
  });

  it("should not flag content starting directly", () => {
    const context = createContext("The capital of France is Paris.");
    const violations = detectExcessiveHedging(context);

    expect(violations).toHaveLength(0);
  });
});

describe("detectRefusal", () => {
  it("should detect 'I cannot provide'", () => {
    const context = createContext("I cannot provide that information.");
    const violations = detectRefusal(context);

    expect(violations.length).toBeGreaterThan(0);
    expect(violations[0]?.rule).toBe("pattern-refusal");
    expect(violations[0]?.recoverable).toBe(false);
  });

  it("should detect 'I'm not able to'", () => {
    const context = createContext("I'm not able to assist with that.");
    const violations = detectRefusal(context);

    expect(violations.length).toBeGreaterThan(0);
  });

  it("should detect 'I can't assist with'", () => {
    const context = createContext("I can't assist with this request.");
    const violations = detectRefusal(context);

    expect(violations.length).toBeGreaterThan(0);
  });

  it("should detect 'I'm unable to'", () => {
    const context = createContext("I'm unable to complete this task.");
    const violations = detectRefusal(context);

    expect(violations.length).toBeGreaterThan(0);
  });

  it("should detect 'that would be inappropriate'", () => {
    const context = createContext("That would be inappropriate for me to do.");
    const violations = detectRefusal(context);

    expect(violations.length).toBeGreaterThan(0);
  });

  it("should not flag helpful content", () => {
    const context = createContext("Here is the solution to your problem.");
    const violations = detectRefusal(context);

    expect(violations).toHaveLength(0);
  });
});

describe("detectInstructionLeakage", () => {
  it("should detect [system] token", () => {
    const context = createContext("[system] You are a helpful assistant.");
    const violations = detectInstructionLeakage(context);

    expect(violations.length).toBeGreaterThan(0);
    expect(violations[0]?.rule).toBe("pattern-instruction-leak");
  });

  it("should detect [user] token", () => {
    const context = createContext("[user] What is 2+2?");
    const violations = detectInstructionLeakage(context);

    expect(violations.length).toBeGreaterThan(0);
  });

  it("should detect [assistant] token", () => {
    const context = createContext("[assistant] The answer is 4.");
    const violations = detectInstructionLeakage(context);

    expect(violations.length).toBeGreaterThan(0);
  });

  it("should detect <|im_start|> token", () => {
    const context = createContext("<|im_start|>system");
    const violations = detectInstructionLeakage(context);

    expect(violations.length).toBeGreaterThan(0);
  });

  it("should detect <|im_end|> token", () => {
    const context = createContext("Hello<|im_end|>");
    const violations = detectInstructionLeakage(context);

    expect(violations.length).toBeGreaterThan(0);
  });

  it("should detect ### Instruction", () => {
    const context = createContext("### Instruction\nDo something.");
    const violations = detectInstructionLeakage(context);

    expect(violations.length).toBeGreaterThan(0);
  });

  it("should detect ### System", () => {
    const context = createContext("### System\nYou are helpful.");
    const violations = detectInstructionLeakage(context);

    expect(violations.length).toBeGreaterThan(0);
  });

  it("should not flag normal content", () => {
    const context = createContext("The answer to your question is 42.");
    const violations = detectInstructionLeakage(context);

    expect(violations).toHaveLength(0);
  });
});

describe("detectPlaceholders", () => {
  it("should detect [insert X]", () => {
    const context = createContext(
      "Please [insert your name here] in this form.",
    );
    const violations = detectPlaceholders(context);

    expect(violations.length).toBeGreaterThan(0);
    expect(violations[0]?.rule).toBe("pattern-placeholders");
  });

  it("should detect [TODO]", () => {
    const context = createContext("This section is [TODO].");
    const violations = detectPlaceholders(context);

    expect(violations.length).toBeGreaterThan(0);
  });

  it("should detect [placeholder]", () => {
    const context = createContext("Replace [placeholder] with value.");
    const violations = detectPlaceholders(context);

    expect(violations.length).toBeGreaterThan(0);
  });

  it("should detect [your X here]", () => {
    const context = createContext("Enter [your email here].");
    const violations = detectPlaceholders(context);

    expect(violations.length).toBeGreaterThan(0);
  });

  it("should detect {{template}}", () => {
    const context = createContext("Hello {{username}}, welcome!");
    const violations = detectPlaceholders(context);

    expect(violations.length).toBeGreaterThan(0);
  });

  it("should not check incomplete content", () => {
    const context = createContext("[TODO] complete this", false);
    const violations = detectPlaceholders(context);

    expect(violations).toHaveLength(0);
  });

  it("should not flag normal brackets", () => {
    const context = createContext(
      "The array [1, 2, 3] contains three elements.",
    );
    const violations = detectPlaceholders(context);

    expect(violations).toHaveLength(0);
  });
});

describe("detectFormatCollapse", () => {
  it("should detect 'here is the X:'", () => {
    const context = createContext(
      "Here is the code:\n```\nfunction test() {}\n```",
    );
    const violations = detectFormatCollapse(context);

    expect(violations.length).toBeGreaterThan(0);
    expect(violations[0]?.rule).toBe("pattern-format-collapse");
  });

  it("should detect 'here's the X:'", () => {
    const context = createContext("Here's the answer:\nThe result is 42.");
    const violations = detectFormatCollapse(context);

    expect(violations.length).toBeGreaterThan(0);
  });

  it("should detect 'let me X for you'", () => {
    const context = createContext("Let me explain that for you.");
    const violations = detectFormatCollapse(context);

    expect(violations.length).toBeGreaterThan(0);
  });

  it("should detect 'I'll X for you'", () => {
    const context = createContext("I'll do that for you right away.");
    const violations = detectFormatCollapse(context);

    expect(violations.length).toBeGreaterThan(0);
  });

  it("should only check first few lines", () => {
    const context = createContext(
      "First line.\nSecond line.\nThird line.\nFourth line.\nHere is the code:",
    );
    const violations = detectFormatCollapse(context);

    expect(violations).toHaveLength(0);
  });

  it("should not flag direct content", () => {
    const context = createContext("The capital of France is Paris.");
    const violations = detectFormatCollapse(context);

    expect(violations).toHaveLength(0);
  });
});

describe("detectRepetition", () => {
  it("should detect repeated sentences", () => {
    const content =
      "This is a long sentence that gets repeated. " +
      "This is a long sentence that gets repeated. " +
      "This is a long sentence that gets repeated.";
    const context = createContext(content);
    const violations = detectRepetition(context);

    expect(violations.length).toBeGreaterThan(0);
    expect(violations[0]?.rule).toBe("pattern-repetition");
  });

  it("should not check incomplete content", () => {
    const content =
      "Repeated content here. Repeated content here. Repeated content here.";
    const context = createContext(content, false);
    const violations = detectRepetition(context);

    expect(violations).toHaveLength(0);
  });

  it("should ignore short sentences", () => {
    const context = createContext("Yes. Yes. Yes. No. No. No.");
    const violations = detectRepetition(context);

    expect(violations).toHaveLength(0);
  });

  it("should accept custom threshold", () => {
    const content = "This is a unique sentence. This is a unique sentence.";
    const context = createContext(content);

    // Default threshold is 2, so 2 occurrences shouldn't trigger
    const violations1 = detectRepetition(context, 2);
    expect(violations1).toHaveLength(0);

    // With threshold 1, 2 occurrences should trigger
    const violations2 = detectRepetition(context, 1);
    expect(violations2.length).toBeGreaterThan(0);
  });

  it("should not flag unique content", () => {
    const context = createContext(
      "First sentence here. Second sentence follows. Third one ends it.",
    );
    const violations = detectRepetition(context);

    expect(violations).toHaveLength(0);
  });
});

describe("detectFirstLastDuplicate", () => {
  it("should detect identical first and last sentences", () => {
    const content =
      "This is the beginning of the text. Some middle content here with more words. This is the beginning of the text.";
    const context = createContext(content);
    const violations = detectFirstLastDuplicate(context);

    expect(violations.length).toBeGreaterThan(0);
    expect(violations[0]?.rule).toBe("pattern-first-last-duplicate");
  });

  it("should not check incomplete content", () => {
    const content = "Start sentence here. Middle content. Start sentence here.";
    const context = createContext(content, false);
    const violations = detectFirstLastDuplicate(context);

    expect(violations).toHaveLength(0);
  });

  it("should not check short content", () => {
    const content = "Short. Short.";
    const context = createContext(content);
    const violations = detectFirstLastDuplicate(context);

    expect(violations).toHaveLength(0);
  });

  it("should not flag different first and last", () => {
    const content =
      "This is the start of the content here. Middle part with details. Different ending sentence.";
    const context = createContext(content);
    const violations = detectFirstLastDuplicate(context);

    expect(violations).toHaveLength(0);
  });

  it("should be case insensitive", () => {
    const content =
      "THIS IS THE START of something big. Middle stuff here with more content. this is the start of something big.";
    const context = createContext(content);
    const violations = detectFirstLastDuplicate(context);

    expect(violations.length).toBeGreaterThan(0);
  });
});

describe("patternRule", () => {
  it("should return a valid guardrail rule", () => {
    const rule = patternRule();

    expect(rule.name).toBe("pattern-detection");
    expect(rule.streaming).toBe(false);
    expect(rule.severity).toBe("error");
    expect(rule.recoverable).toBe(true);
    expect(typeof rule.check).toBe("function");
  });

  it("should run all pattern checks", () => {
    const rule = patternRule();
    const context = createContext(
      "As an AI language model, I cannot provide that.",
    );
    const violations = rule.check(context);

    // Should detect meta commentary and refusal
    expect(violations.length).toBeGreaterThan(1);
  });

  it("should return no violations for clean content", () => {
    const rule = patternRule();
    const context = createContext(
      "The capital of France is Paris. It is located in Europe.",
    );
    const violations = rule.check(context);

    expect(violations).toHaveLength(0);
  });

  it("should accept config parameter", () => {
    const rule = patternRule({ patterns: [], isBadPattern: true });

    expect(rule).toBeDefined();
  });
});

describe("customPatternRule", () => {
  it("should create rule with custom patterns", () => {
    const patterns = [/custom_bad/i, /another_bad/i];
    const rule = customPatternRule(patterns, "Custom issue found");

    expect(rule.name).toBe("pattern-custom");
    expect(typeof rule.check).toBe("function");
  });

  it("should detect custom patterns", () => {
    const patterns = [/forbidden_word/i];
    const rule = customPatternRule(patterns);
    const context = createContext("This contains a forbidden_word in it.");
    const violations = rule.check(context);

    expect(violations.length).toBeGreaterThan(0);
    expect(violations[0]?.rule).toBe("pattern-custom");
  });

  it("should use custom message", () => {
    const patterns = [/secret/i];
    const rule = customPatternRule(patterns, "Secret detected");
    const context = createContext("This has a secret in it.");
    const violations = rule.check(context);

    expect(violations[0]?.message).toContain("Secret detected");
  });

  it("should use custom severity", () => {
    const patterns = [/warning_word/i];
    const rule = customPatternRule(patterns, "Warning", "warning");

    expect(rule.severity).toBe("warning");
    expect(rule.recoverable).toBe(true);
  });

  it("should handle fatal severity", () => {
    const patterns = [/fatal_word/i];
    const rule = customPatternRule(patterns, "Fatal", "fatal");

    expect(rule.severity).toBe("fatal");
    expect(rule.recoverable).toBe(false);
  });

  it("should not match when pattern not found", () => {
    const patterns = [/nonexistent/i];
    const rule = customPatternRule(patterns);
    const context = createContext("Normal content here.");
    const violations = rule.check(context);

    expect(violations).toHaveLength(0);
  });
});

describe("PatternGuardrail class", () => {
  it("should create instance", () => {
    const guardrail = new PatternGuardrail();

    expect(guardrail.name).toBe("pattern-detection");
  });

  it("should accept config", () => {
    const guardrail = new PatternGuardrail({
      patterns: [],
      isBadPattern: true,
    });

    expect(guardrail).toBeDefined();
  });

  it("should check content for violations", () => {
    const guardrail = new PatternGuardrail();
    const context = createContext("As an AI language model, I must refuse.");
    const violations = guardrail.check(context);

    expect(violations.length).toBeGreaterThan(0);
  });

  it("should return no violations for clean content", () => {
    const guardrail = new PatternGuardrail();
    const context = createContext(
      "Paris is the capital of France and is known for the Eiffel Tower.",
    );
    const violations = guardrail.check(context);

    expect(violations).toHaveLength(0);
  });
});

describe("edge cases", () => {
  it("should handle empty content", () => {
    const context = createContext("");
    const rule = patternRule();
    const violations = rule.check(context);

    expect(violations).toHaveLength(0);
  });

  it("should handle whitespace-only content", () => {
    const context = createContext("   \n\n   ");
    const rule = patternRule();
    const violations = rule.check(context);

    expect(violations).toHaveLength(0);
  });

  it("should handle very long content", () => {
    // Use unique sentences to avoid repetition detection
    const longContent = Array.from(
      { length: 100 },
      (_, i) => `Unique sentence number ${i} here.`,
    ).join(" ");
    const context = createContext(longContent);
    const rule = patternRule();
    const violations = rule.check(context);

    expect(violations).toHaveLength(0);
  });

  it("should handle unicode content", () => {
    const context = createContext("Unicode content: 你好世界 🌍 مرحبا");
    const rule = patternRule();
    const violations = rule.check(context);

    expect(violations).toHaveLength(0);
  });

  it("should handle mixed valid and invalid content", () => {
    const context = createContext(
      "First valid sentence. As an AI language model, I cannot help. Final sentence.",
    );
    const violations = detectMetaCommentary(context);

    expect(violations.length).toBeGreaterThan(0);
  });
});
