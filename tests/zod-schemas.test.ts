// Zod Schema Type Correctness Tests
//
// This file verifies that our Zod schemas correctly match the TypeScript types.
// It uses compile-time type checking via Expects utility type.
// If a schema's inferred type doesn't match the original type, TypeScript will error.

import { describe, it, expect } from "vitest";
import { z } from "zod4";

// Import all schemas
import {
  // Retry schemas
  ErrorTypeDelaysSchema,
  RetryReasonSchema,
  BackoffStrategySchema,
  RetryConfigSchema,
  CategorizedErrorSchema,
  RetryStateSchema,
  BackoffResultSchema,
  RetryDecisionSchema,
  ErrorClassificationSchema,
  RetryContextSchema,
  // Guardrail schemas
  GuardrailViolationSchema,
  GuardrailContextSchema,
  GuardrailResultSchema,
  JsonStructureSchema,
  MarkdownStructureSchema,
  LatexStructureSchema,
  PatternConfigSchema,
  DriftConfigSchema,
  FunctionCallStructureSchema,
  SchemaValidationSchema,
  // Stream schemas
  StreamEventSchema,
  StreamNormalizerOptionsSchema,
  StreamWrapperSchema,
  StreamStateSchema,
  StreamChunkSchema,
  StreamErrorTypeSchema,
  StreamResumptionStateSchema,
  // Evaluate schemas
  ComparisonStyleSchema,
  ComparisonTypeSchema,
  DifferenceTypeSchema,
  DifferenceSeveritySchema,
  DifferenceSchema,
  EvaluationDetailsSchema,
  EvaluationResultSchema,
  EvaluationPresetSchema,
  StringComparisonOptionsSchema,
  ObjectComparisonOptionsSchema,
  // Events schemas
  L0RecordedEventTypeSchema,
  SerializedOptionsSchema,
  SerializedErrorSchema,
  GuardrailEventResultSchema,
  DriftEventResultSchema,
  L0EventEnvelopeSchema,
  L0SnapshotSchema,
  L0ExecutionModeSchema,
  // Window schemas
  ChunkStrategySchema,
  ContextRestorationStrategySchema,
  WindowOptionsSchema,
  DocumentChunkSchema,
  WindowStatsSchema,
  WindowPresetSchema,
  // Consensus schemas
  ConsensusStrategySchema,
  ConflictResolutionSchema,
  AgreementTypeSchema,
  DisagreementSeveritySchema,
  ConsensusAnalysisSchema,
  TextConsensusOptionsSchema,
  ConsensusPresetSchema,
  // Observability schemas
  FailureTypeSchema,
  RecoveryStrategySchema,
  RecoveryPolicySchema,
  EventCategorySchema,
  EventTypeSchema,
  ToolErrorTypeSchema,
} from "../src/zod";

// Import corresponding types
import type {
  ErrorTypeDelays,
  RetryConfig,
  RetryReason,
  BackoffStrategy,
  RetryState,
  CategorizedError,
  BackoffResult,
  RetryDecision,
  ErrorClassification,
  RetryContext,
} from "../src/types/retry";

import type {
  GuardrailViolation,
  GuardrailContext,
  GuardrailResult,
  JsonStructure,
  MarkdownStructure,
  LatexStructure,
  PatternConfig,
  DriftConfig,
  FunctionCallStructure,
  SchemaValidation,
} from "../src/types/guardrails";

import type {
  StreamEvent,
  StreamNormalizerOptions,
  StreamWrapper,
  StreamState,
  StreamChunk,
  StreamErrorType,
  StreamResumptionState,
} from "../src/types/stream";

import type {
  ComparisonStyle,
  ComparisonType,
  DifferenceType,
  DifferenceSeverity,
  Difference,
  EvaluationDetails,
  EvaluationResult,
  EvaluationPreset,
  StringComparisonOptions,
  ObjectComparisonOptions,
} from "../src/types/evaluate";

import type {
  L0RecordedEventType,
  SerializedOptions,
  SerializedError,
  GuardrailEventResult,
  DriftEventResult,
  L0EventEnvelope,
  L0Snapshot,
  L0ExecutionMode,
} from "../src/types/events";

import type {
  ChunkStrategy,
  ContextRestorationStrategy,
  WindowOptions,
  DocumentChunk,
  WindowStats,
  WindowPreset,
} from "../src/types/window";

import type {
  ConsensusStrategy,
  ConflictResolution,
  AgreementType,
  DisagreementSeverity,
  ConsensusAnalysis,
  TextConsensusOptions,
  ConsensusPreset,
} from "../src/types/consensus";

import type {
  FailureType,
  RecoveryStrategy,
  RecoveryPolicy,
  EventCategory,
  EventType,
  ToolErrorType,
} from "../src/types/observability";

// =============================================================================
// Type Checking Utilities
// =============================================================================

/**
 * Utility type that checks if two types are exactly equal.
 * Returns true if A extends B and B extends A.
 */
type Equals<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;

/**
 * Utility type that causes a compile error if T is not true.
 * Usage: type _Check = Expect<Equals<InferredType, ExpectedType>>
 */
type Expect<T extends true> = T;

/**
 * Helper to check if a schema's output type matches the expected type.
 * This allows for some flexibility (e.g., optional vs undefined).
 */
type SchemaOutputMatches<Schema extends z.ZodType, Expected> =
  z.output<Schema> extends Expected ? true : false;

/**
 * Helper to check if the expected type can be assigned to the schema's output.
 */
type ExpectedAssignableToSchema<Schema extends z.ZodType, Expected> =
  Expected extends z.output<Schema> ? true : false;

// =============================================================================
// Compile-Time Type Checks
// =============================================================================

// These type aliases will cause compile errors if the schemas don't match types.
// The test file compiling successfully means all schemas are type-correct.

// --- Retry Types ---
type _RetryReason = Expect<
  SchemaOutputMatches<typeof RetryReasonSchema, RetryReason>
>;
type _BackoffStrategy = Expect<
  SchemaOutputMatches<typeof BackoffStrategySchema, BackoffStrategy>
>;
type _ErrorTypeDelays = Expect<
  ExpectedAssignableToSchema<typeof ErrorTypeDelaysSchema, ErrorTypeDelays>
>;
type _BackoffResult = Expect<
  SchemaOutputMatches<typeof BackoffResultSchema, BackoffResult>
>;
type _ErrorClassification = Expect<
  SchemaOutputMatches<typeof ErrorClassificationSchema, ErrorClassification>
>;

// --- Stream Types ---
type _StreamErrorType = Expect<
  SchemaOutputMatches<typeof StreamErrorTypeSchema, StreamErrorType>
>;
type _StreamNormalizerOptions = Expect<
  ExpectedAssignableToSchema<
    typeof StreamNormalizerOptionsSchema,
    StreamNormalizerOptions
  >
>;
type _StreamState = Expect<
  ExpectedAssignableToSchema<typeof StreamStateSchema, StreamState>
>;
type _StreamChunk = Expect<
  SchemaOutputMatches<typeof StreamChunkSchema, StreamChunk>
>;

// --- Evaluate Types ---
type _ComparisonStyle = Expect<
  SchemaOutputMatches<typeof ComparisonStyleSchema, ComparisonStyle>
>;
type _ComparisonType = Expect<
  SchemaOutputMatches<typeof ComparisonTypeSchema, ComparisonType>
>;
type _DifferenceType = Expect<
  SchemaOutputMatches<typeof DifferenceTypeSchema, DifferenceType>
>;
type _DifferenceSeverity = Expect<
  SchemaOutputMatches<typeof DifferenceSeveritySchema, DifferenceSeverity>
>;

// --- Events Types ---
type _L0RecordedEventType = Expect<
  SchemaOutputMatches<typeof L0RecordedEventTypeSchema, L0RecordedEventType>
>;
type _L0ExecutionMode = Expect<
  SchemaOutputMatches<typeof L0ExecutionModeSchema, L0ExecutionMode>
>;

// --- Window Types ---
type _ChunkStrategy = Expect<
  SchemaOutputMatches<typeof ChunkStrategySchema, ChunkStrategy>
>;
type _ContextRestorationStrategy = Expect<
  SchemaOutputMatches<
    typeof ContextRestorationStrategySchema,
    ContextRestorationStrategy
  >
>;

// --- Consensus Types ---
type _ConsensusStrategy = Expect<
  SchemaOutputMatches<typeof ConsensusStrategySchema, ConsensusStrategy>
>;
type _ConflictResolution = Expect<
  SchemaOutputMatches<typeof ConflictResolutionSchema, ConflictResolution>
>;
type _AgreementType = Expect<
  SchemaOutputMatches<typeof AgreementTypeSchema, AgreementType>
>;
type _DisagreementSeverity = Expect<
  SchemaOutputMatches<typeof DisagreementSeveritySchema, DisagreementSeverity>
>;

// --- Observability Types ---
type _FailureType = Expect<
  SchemaOutputMatches<typeof FailureTypeSchema, FailureType>
>;
type _RecoveryStrategy = Expect<
  SchemaOutputMatches<typeof RecoveryStrategySchema, RecoveryStrategy>
>;
type _ToolErrorType = Expect<
  SchemaOutputMatches<typeof ToolErrorTypeSchema, ToolErrorType>
>;

// =============================================================================
// Runtime Tests
// =============================================================================

describe("Zod Schema Runtime Validation", () => {
  describe("Retry Schemas", () => {
    it("validates RetryReason enum values", () => {
      expect(RetryReasonSchema.parse("zero_output")).toBe("zero_output");
      expect(RetryReasonSchema.parse("network_error")).toBe("network_error");
      expect(() => RetryReasonSchema.parse("invalid")).toThrow();
    });

    it("validates BackoffStrategy enum values", () => {
      expect(BackoffStrategySchema.parse("exponential")).toBe("exponential");
      expect(BackoffStrategySchema.parse("fixed-jitter")).toBe("fixed-jitter");
      expect(() => BackoffStrategySchema.parse("invalid")).toThrow();
    });

    it("validates ErrorTypeDelays object", () => {
      const valid: ErrorTypeDelays = {
        connectionDropped: 1000,
        fetchError: 500,
      };
      expect(ErrorTypeDelaysSchema.parse(valid)).toEqual(valid);
    });

    it("validates BackoffResult object", () => {
      const valid: BackoffResult = {
        delay: 1000,
        cappedAtMax: false,
        rawDelay: 1000,
      };
      expect(BackoffResultSchema.parse(valid)).toEqual(valid);
    });

    it("validates ErrorClassification object", () => {
      const valid: ErrorClassification = {
        isNetwork: true,
        isRateLimit: false,
        isServerError: false,
        isTimeout: false,
        isAuthError: false,
        isClientError: false,
        statusCode: 500,
      };
      expect(ErrorClassificationSchema.parse(valid)).toEqual(valid);
    });
  });

  describe("Guardrail Schemas", () => {
    it("validates GuardrailViolation object", () => {
      const valid: GuardrailViolation = {
        rule: "test-rule",
        message: "Test violation",
        severity: "error",
        recoverable: true,
      };
      expect(GuardrailViolationSchema.parse(valid)).toEqual(valid);
    });

    it("validates JsonStructure object", () => {
      const valid: JsonStructure = {
        openBraces: 1,
        closeBraces: 1,
        openBrackets: 0,
        closeBrackets: 0,
        inString: false,
        isBalanced: true,
        issues: [],
      };
      expect(JsonStructureSchema.parse(valid)).toEqual(valid);
    });

    it("validates MarkdownStructure object", () => {
      const valid: MarkdownStructure = {
        openFences: 0,
        fenceLanguages: [],
        inFence: false,
        headers: [1, 2],
        listDepth: 0,
        issues: [],
      };
      expect(MarkdownStructureSchema.parse(valid)).toEqual(valid);
    });

    it("validates DriftConfig object", () => {
      const valid: DriftConfig = {
        detectToneShift: true,
        detectRepetition: true,
        entropyThreshold: 2.5,
      };
      expect(DriftConfigSchema.parse(valid)).toEqual(valid);
    });
  });

  describe("Stream Schemas", () => {
    it("validates StreamErrorType enum values", () => {
      expect(StreamErrorTypeSchema.parse("timeout")).toBe("timeout");
      expect(StreamErrorTypeSchema.parse("network")).toBe("network");
      expect(() => StreamErrorTypeSchema.parse("invalid")).toThrow();
    });

    it("validates StreamState object", () => {
      const valid: StreamState = {
        started: true,
        firstTokenReceived: true,
        tokenCount: 100,
        complete: false,
        aborted: false,
      };
      expect(StreamStateSchema.parse(valid)).toEqual(valid);
    });

    it("validates StreamChunk object", () => {
      const valid: StreamChunk = {
        content: "Hello",
        done: false,
        timestamp: Date.now(),
        index: 0,
      };
      expect(StreamChunkSchema.parse(valid)).toEqual(valid);
    });
  });

  describe("Evaluate Schemas", () => {
    it("validates ComparisonStyle enum values", () => {
      expect(ComparisonStyleSchema.parse("strict")).toBe("strict");
      expect(ComparisonStyleSchema.parse("lenient")).toBe("lenient");
      expect(() => ComparisonStyleSchema.parse("invalid")).toThrow();
    });

    it("validates DifferenceType enum values", () => {
      expect(DifferenceTypeSchema.parse("missing")).toBe("missing");
      expect(DifferenceTypeSchema.parse("type-mismatch")).toBe("type-mismatch");
    });

    it("validates EvaluationDetails object", () => {
      const valid: EvaluationDetails = {
        exactMatch: true,
        schemaValid: true,
        structureMatch: true,
        contentSimilarity: 1.0,
        fieldsCompared: 5,
        fieldsMatched: 5,
        comparisonType: "exact",
      };
      expect(EvaluationDetailsSchema.parse(valid)).toEqual(valid);
    });
  });

  describe("Window Schemas", () => {
    it("validates ChunkStrategy enum values", () => {
      expect(ChunkStrategySchema.parse("token")).toBe("token");
      expect(ChunkStrategySchema.parse("paragraph")).toBe("paragraph");
      expect(() => ChunkStrategySchema.parse("invalid")).toThrow();
    });

    it("validates DocumentChunk object", () => {
      const valid: DocumentChunk = {
        index: 0,
        content: "Hello world",
        startPos: 0,
        endPos: 11,
        tokenCount: 2,
        charCount: 11,
        isFirst: true,
        isLast: true,
        totalChunks: 1,
      };
      expect(DocumentChunkSchema.parse(valid)).toEqual(valid);
    });

    it("validates WindowStats object", () => {
      const valid: WindowStats = {
        totalChunks: 5,
        totalChars: 5000,
        totalTokens: 1000,
        avgChunkSize: 1000,
        avgChunkTokens: 200,
        overlapSize: 100,
        strategy: "token",
      };
      expect(WindowStatsSchema.parse(valid)).toEqual(valid);
    });
  });

  describe("Consensus Schemas", () => {
    it("validates ConsensusStrategy enum values", () => {
      expect(ConsensusStrategySchema.parse("majority")).toBe("majority");
      expect(ConsensusStrategySchema.parse("unanimous")).toBe("unanimous");
      expect(() => ConsensusStrategySchema.parse("invalid")).toThrow();
    });

    it("validates ConflictResolution enum values", () => {
      expect(ConflictResolutionSchema.parse("vote")).toBe("vote");
      expect(ConflictResolutionSchema.parse("merge")).toBe("merge");
    });

    it("validates ConsensusAnalysis object", () => {
      const valid: ConsensusAnalysis = {
        totalOutputs: 3,
        successfulOutputs: 3,
        failedOutputs: 0,
        identicalOutputs: 2,
        similarityMatrix: [
          [1, 0.9],
          [0.9, 1],
        ],
        averageSimilarity: 0.95,
        minSimilarity: 0.9,
        maxSimilarity: 1.0,
        totalAgreements: 5,
        totalDisagreements: 1,
        strategy: "majority",
        conflictResolution: "vote",
        duration: 1000,
      };
      expect(ConsensusAnalysisSchema.parse(valid)).toEqual(valid);
    });
  });

  describe("Observability Schemas", () => {
    it("validates FailureType enum values", () => {
      expect(FailureTypeSchema.parse("network")).toBe("network");
      expect(FailureTypeSchema.parse("timeout")).toBe("timeout");
      expect(() => FailureTypeSchema.parse("invalid")).toThrow();
    });

    it("validates RecoveryStrategy enum values", () => {
      expect(RecoveryStrategySchema.parse("retry")).toBe("retry");
      expect(RecoveryStrategySchema.parse("fallback")).toBe("fallback");
    });

    it("validates RecoveryPolicy object", () => {
      const valid: RecoveryPolicy = {
        retryEnabled: true,
        fallbackEnabled: true,
        maxRetries: 3,
        maxFallbacks: 2,
        attempt: 1,
        fallbackIndex: 0,
      };
      expect(RecoveryPolicySchema.parse(valid)).toEqual(valid);
    });
  });

  describe("Events Schemas", () => {
    it("validates L0RecordedEventType enum values", () => {
      expect(L0RecordedEventTypeSchema.parse("START")).toBe("START");
      expect(L0RecordedEventTypeSchema.parse("TOKEN")).toBe("TOKEN");
      expect(L0RecordedEventTypeSchema.parse("COMPLETE")).toBe("COMPLETE");
      expect(() => L0RecordedEventTypeSchema.parse("INVALID")).toThrow();
    });

    it("validates L0ExecutionMode enum values", () => {
      expect(L0ExecutionModeSchema.parse("live")).toBe("live");
      expect(L0ExecutionModeSchema.parse("record")).toBe("record");
      expect(L0ExecutionModeSchema.parse("replay")).toBe("replay");
    });

    it("validates SerializedError object", () => {
      const valid: SerializedError = {
        name: "Error",
        message: "Something went wrong",
        stack: "Error: Something went wrong\n    at ...",
      };
      expect(SerializedErrorSchema.parse(valid)).toEqual(valid);
    });

    it("validates GuardrailEventResult object", () => {
      const valid: GuardrailEventResult = {
        violations: [],
        shouldRetry: false,
        shouldHalt: false,
      };
      expect(GuardrailEventResultSchema.parse(valid)).toEqual(valid);
    });

    it("validates DriftEventResult object", () => {
      const valid: DriftEventResult = {
        detected: false,
        types: [],
        confidence: 0,
      };
      expect(DriftEventResultSchema.parse(valid)).toEqual(valid);
    });
  });
});
