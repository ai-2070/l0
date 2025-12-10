// Zod schemas for L0 Consensus types

import { z } from "zod4";
import type {
  ConsensusStrategy,
  ConflictResolution,
  ConsensusResult,
  ConsensusOutput,
  Agreement,
  AgreementType,
  Disagreement,
  DisagreementSeverity,
  ConsensusAnalysis,
  FieldConsensus,
  FieldAgreement,
  TextConsensusOptions,
  StructuredConsensusOptions,
  ConsensusPreset,
} from "../types/consensus";
import { L0ResultSchema } from "./l0";
import { StructuredResultSchema } from "./structured";

/**
 * Consensus strategy schema
 */
export const ConsensusStrategySchema: z.ZodType<ConsensusStrategy> = z.enum([
  "majority",
  "unanimous",
  "weighted",
  "best",
]);

/**
 * Conflict resolution schema
 */
export const ConflictResolutionSchema: z.ZodType<ConflictResolution> = z.enum([
  "vote",
  "merge",
  "fail",
  "best",
]);

/**
 * Agreement type schema
 */
export const AgreementTypeSchema: z.ZodType<AgreementType> = z.enum([
  "exact",
  "similar",
  "structural",
  "semantic",
]);

/**
 * Disagreement severity schema
 */
export const DisagreementSeveritySchema: z.ZodType<DisagreementSeverity> =
  z.enum(["minor", "moderate", "major", "critical"]);

/**
 * Agreement schema
 */
export const AgreementSchema: z.ZodType<Agreement> = z.object({
  content: z.any(),
  path: z.string().optional(),
  count: z.number(),
  ratio: z.number(),
  indices: z.array(z.number()),
  type: AgreementTypeSchema,
});

/**
 * Disagreement schema
 */
export const DisagreementSchema: z.ZodType<Disagreement> = z.object({
  path: z.string().optional(),
  values: z.array(
    z.object({
      value: z.any(),
      count: z.number(),
      indices: z.array(z.number()),
    }),
  ),
  severity: DisagreementSeveritySchema,
  resolution: z.string().optional(),
  resolutionConfidence: z.number().optional(),
});

/**
 * Consensus analysis schema
 */
export const ConsensusAnalysisSchema: z.ZodType<ConsensusAnalysis> = z.object({
  totalOutputs: z.number(),
  successfulOutputs: z.number(),
  failedOutputs: z.number(),
  identicalOutputs: z.number(),
  similarityMatrix: z.array(z.array(z.number())),
  averageSimilarity: z.number(),
  minSimilarity: z.number(),
  maxSimilarity: z.number(),
  totalAgreements: z.number(),
  totalDisagreements: z.number(),
  strategy: ConsensusStrategySchema,
  conflictResolution: ConflictResolutionSchema,
  duration: z.number(),
});

/**
 * Field agreement schema
 */
export const FieldAgreementSchema: z.ZodType<FieldAgreement> = z.object({
  path: z.string(),
  value: z.any(),
  agreement: z.number(),
  votes: z.record(z.string(), z.number()),
  values: z.array(z.any()),
  unanimous: z.boolean(),
  confidence: z.number(),
});

/**
 * Field consensus schema
 */
export const FieldConsensusSchema: z.ZodType<FieldConsensus> = z.object({
  fields: z.record(z.string(), FieldAgreementSchema),
  overallAgreement: z.number(),
  agreedFields: z.array(z.string()),
  disagreedFields: z.array(z.string()),
});

/**
 * Consensus output schema
 */
export const ConsensusOutputSchema: z.ZodType<ConsensusOutput> = z.object({
  index: z.number(),
  text: z.string(),
  data: z.any().optional(),
  l0Result: L0ResultSchema.optional(),
  structuredResult: StructuredResultSchema.optional(),
  status: z.enum(["success", "error"]),
  error: z.instanceof(Error).optional(),
  duration: z.number(),
  weight: z.number(),
  similarities: z.array(z.number()).optional(),
});

/**
 * Consensus result schema
 */
export const ConsensusResultSchema: z.ZodType<ConsensusResult> = z.object({
  consensus: z.any(),
  confidence: z.number(),
  outputs: z.array(ConsensusOutputSchema),
  agreements: z.array(AgreementSchema),
  disagreements: z.array(DisagreementSchema),
  analysis: ConsensusAnalysisSchema,
  type: z.enum(["text", "structured"]),
  fieldConsensus: FieldConsensusSchema.optional(),
  status: z.enum(["success", "partial", "failed"]),
  error: z.instanceof(Error).optional(),
  metadata: z.record(z.string(), z.any()).optional(),
});

/**
 * Consensus options schema
 * Note: Contains function properties - no explicit type annotation
 */
export const ConsensusOptionsSchema = z.object({
  streams: z.array(z.function()),
  schema: z.any().optional(),
  strategy: ConsensusStrategySchema.optional(),
  threshold: z.number().optional(),
  resolveConflicts: ConflictResolutionSchema.optional(),
  weights: z.array(z.number()).optional(),
  minimumAgreement: z.number().optional(),
  timeout: z.number().optional(),
  signal: z.instanceof(AbortSignal).optional(),
  detectZeroTokens: z.boolean().optional(),
  monitoring: z
    .object({
      enabled: z.boolean().optional(),
      metadata: z.record(z.string(), z.any()).optional(),
    })
    .optional(),
  onComplete: z.function().optional(),
  onConsensus: z.function().optional(),
  metadata: z.record(z.string(), z.any()).optional(),
});

/**
 * Text consensus options schema
 */
export const TextConsensusOptionsSchema: z.ZodType<TextConsensusOptions> =
  z.object({
    threshold: z.number(),
    strategy: ConsensusStrategySchema,
    resolveConflicts: ConflictResolutionSchema,
    weights: z.array(z.number()),
  });

/**
 * Structured consensus options schema
 */
export const StructuredConsensusOptionsSchema: z.ZodType<StructuredConsensusOptions> =
  z.object({
    schema: z.any(),
    strategy: ConsensusStrategySchema,
    resolveConflicts: ConflictResolutionSchema,
    weights: z.array(z.number()),
    minimumAgreement: z.number(),
  });

/**
 * Consensus preset schema
 */
export const ConsensusPresetSchema: z.ZodType<ConsensusPreset> = z.object({
  name: z.string(),
  strategy: ConsensusStrategySchema,
  threshold: z.number(),
  resolveConflicts: ConflictResolutionSchema,
  minimumAgreement: z.number(),
});
