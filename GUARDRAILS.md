# Guardrails

Guardrails are pure functions that validate streaming output without rewriting it. They detect issues and signal whether to retry.

## Quick Start

```typescript
import { l0, recommendedGuardrails } from "@ai2070/l0";

const result = await l0({
  stream: () => streamText({ model, prompt }),
  guardrails: recommendedGuardrails,
});
```

## Presets

```typescript
import {
  minimalGuardrails, // JSON + zero output
  recommendedGuardrails, // + Markdown, patterns
  strictGuardrails, // + LaTeX
  jsonOnlyGuardrails, // JSON + zero output
  markdownOnlyGuardrails, // Markdown + zero output
  latexOnlyGuardrails, // LaTeX + zero output
} from "@ai2070/l0";
```

---

## Built-in Rules

### JSON Rule

Validates JSON structure during streaming:

```typescript
import { jsonRule, strictJsonRule } from "@ai2070/l0";

jsonRule(); // Balanced braces/brackets, streaming-aware
strictJsonRule(); // + Must be parseable, root must be object/array
```

**Detects:**

- Unbalanced `{}` and `[]`
- Unclosed strings
- Multiple consecutive commas
- Malformed patterns like `{,` or `[,`

### Markdown Rule

Validates Markdown structure:

```typescript
import { markdownRule } from "@ai2070/l0";

markdownRule();
```

**Detects:**

- Unclosed code fences (```)
- Inconsistent table columns
- Mixed list types at same level
- Content ending mid-sentence

### LaTeX Rule

Validates LaTeX environments and math:

```typescript
import { latexRule } from "@ai2070/l0";

latexRule();
```

**Detects:**

- Unclosed `\begin{env}` environments
- Mismatched environment names
- Unbalanced `\[...\]` and `$$...$$`
- Unbalanced inline math `$...$`

### Zero Output Rule

Detects empty or meaningless output:

```typescript
import { zeroOutputRule } from "@ai2070/l0";

zeroOutputRule();
```

**Detects:**

- Empty output
- Whitespace-only output
- Punctuation-only output
- Repeated character noise
- Suspiciously instant completion

### Pattern Rule

Detects known bad patterns:

```typescript
import { patternRule, customPatternRule } from "@ai2070/l0";

patternRule(); // All built-in patterns

// Custom patterns
customPatternRule([/forbidden/i, /blocked/i], "Custom violation", "error");
```

**Built-in patterns:**

| Category         | Examples                                    |
| ---------------- | ------------------------------------------- |
| Meta commentary  | "As an AI...", "I'm an AI assistant"        |
| Hedging          | "Sure!", "Certainly!", "Of course!"         |
| Refusal          | "I cannot provide...", "I'm not able to..." |
| Instruction leak | `[SYSTEM]`, `<\|im_start\|>`                |
| Placeholders     | `[INSERT ...]`, `{{placeholder}}`           |
| Format collapse  | "Here is the...", "Let me..."               |
| Repetition       | Same sentence repeated 3+ times             |

---

## Violation Severity

| Severity  | Behavior                     |
| --------- | ---------------------------- |
| `fatal`   | Halt immediately, no retry   |
| `error`   | Trigger retry if recoverable |
| `warning` | Log but continue             |

```typescript
interface GuardrailViolation {
  rule: string;
  message: string;
  severity: "fatal" | "error" | "warning";
  recoverable: boolean;
  position?: number;
  suggestion?: string;
}
```

---

## Custom Rules

### Simple Rule

```typescript
import { GuardrailRule } from "@ai2070/l0";

const noSwearing: GuardrailRule = {
  name: "no-swearing",
  description: "Blocks profanity",
  streaming: false, // Only check on complete
  severity: "error",
  recoverable: true,
  check: (context) => {
    const violations = [];
    if (/damn|hell/i.test(context.content)) {
      violations.push({
        rule: "no-swearing",
        message: "Profanity detected",
        severity: "error",
        recoverable: true,
      });
    }
    return violations;
  },
};

await l0({
  stream,
  guardrails: [...recommendedGuardrails, noSwearing],
});
```

### Streaming Rule

```typescript
const lengthLimit: GuardrailRule = {
  name: "length-limit",
  description: "Limits output length",
  streaming: true, // Check during streaming
  severity: "fatal",
  recoverable: false,
  check: (context) => {
    if (context.content.length > 10000) {
      return [
        {
          rule: "length-limit",
          message: "Output exceeds 10,000 characters",
          severity: "fatal",
          recoverable: false,
        },
      ];
    }
    return [];
  },
};
```

### Context Object

```typescript
interface GuardrailContext {
  content: string; // Full accumulated content
  delta?: string; // Latest chunk (streaming)
  completed: boolean; // Stream finished?
  tokenCount: number; // Tokens received
  previousViolations: GuardrailViolation[];
  metadata?: Record<string, any>;
}
```

---

## Guardrail Engine

For advanced use cases, use the engine directly:

```typescript
import {
  GuardrailEngine,
  createGuardrailEngine,
  checkGuardrails,
} from "@ai2070/l0";

// Create engine
const engine = createGuardrailEngine(recommendedGuardrails, {
  stopOnFatal: true,
  enableStreaming: true,
  onViolation: (v) => console.log("Violation:", v.message),
});

// Check content
const result = engine.check({
  content: "...",
  completed: true,
  tokenCount: 100,
});

console.log(result.passed); // true/false
console.log(result.violations); // GuardrailViolation[]
console.log(result.shouldRetry); // true/false
console.log(result.shouldHalt); // true/false

// Or one-shot check
const result = checkGuardrails(context, rules);
```

### Engine Methods

```typescript
engine.check(context); // Run all rules
engine.addRule(rule); // Add rule
engine.removeRule("rule-name"); // Remove rule
engine.getState(); // Get current state
engine.reset(); // Reset state
engine.hasViolations(); // Any violations?
engine.hasFatalViolations(); // Any fatal?
engine.getViolationsByRule("json"); // Violations for rule
engine.getAllViolations(); // All violations
```

---

## Analysis Functions

Low-level analysis utilities:

````typescript
import {
  analyzeJsonStructure,
  looksLikeJson,
  analyzeMarkdownStructure,
  looksLikeMarkdown,
  analyzeLatexStructure,
  looksLikeLatex,
  isZeroOutput,
  isNoiseOnly,
  findBadPatterns,
  BAD_PATTERNS,
} from "@ai2070/l0";

// JSON analysis
const json = analyzeJsonStructure('{"a": 1');
console.log(json.isBalanced); // false
console.log(json.openBraces); // 1
console.log(json.closeBraces); // 0
console.log(json.issues); // ["Unbalanced braces..."]

// Markdown analysis
const md = analyzeMarkdownStructure("```js\ncode");
console.log(md.inFence); // true
console.log(md.openFences); // 1

// LaTeX analysis
const tex = analyzeLatexStructure("\\begin{equation}");
console.log(tex.openEnvironments); // ["equation"]
console.log(tex.isBalanced); // false

// Pattern detection
const matches = findBadPatterns(content, BAD_PATTERNS.META_COMMENTARY);
````

---

## Integration with Retry

Guardrail violations integrate with retry logic:

```typescript
await l0({
  stream,
  guardrails: recommendedGuardrails,
  retry: {
    attempts: 3,
    retryOn: ["guardrail_violation"], // Retry on recoverable violations
  },
});
```

| Violation Type       | Counts Toward Limit           |
| -------------------- | ----------------------------- |
| `recoverable: true`  | Yes                           |
| `recoverable: false` | No (treated as network error) |

Zero output violations are `recoverable: false` because they indicate transport issues, not model issues.
