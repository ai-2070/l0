// Zod schemas for L0 Consensus types

import { z } from "zod";
import type {
  ConsensusOptions,
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
export const ConsensusStrategySchema = z.enum([
  "majority",
  "unanimous",
  "weighted",
  "best",
]) satisfies z.ZodType<ConsensusStrategy>;

/**
 * Conflict resolution schema
 */
export const ConflictResolutionSchema = z.enum([
  "vote",
  "merge",
  "fail",
  "best",
]) satisfies z.ZodType<ConflictResolution>;

/**
 * Agreement type schema
 */
export const AgreementTypeSchema = z.enum([
  "exact",
  "similar",
  "structural",
  "semantic",
]) satisfies z.ZodType<AgreementType>;

/**
 * Disagreement severity schema
 */
export const DisagreementSeveritySchema = z.enum([
  "minor",
  "moderate",
  "major",
  "critical",
]) satisfies z.ZodType<DisagreementSeverity>;

/**
 * Agreement schema
 */
export const AgreementSchema: z.ZodType<Agreement> = z.object({
  content: z.unknown().transform((v) => v as string | any),
  path: z.string().optional(),
  count: z.number(),
  ratio: z.number(),
  indices: z.array(z.number()),
  type: AgreementTypeSchema,
}) as z.ZodType<Agreement>;

/**
 * Disagreement schema
 */
export const DisagreementSchema = z.object({
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
}) satisfies z.ZodType<Disagreement>;

/**
 * Consensus analysis schema
 */
export const ConsensusAnalysisSchema = z.object({
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
}) satisfies z.ZodType<ConsensusAnalysis>;

/**
 * Field agreement schema
 */
export const FieldAgreementSchema = z.object({
  path: z.string(),
  value: z.any(),
  agreement: z.number(),
  votes: z.record(z.number()),
  values: z.array(z.any()),
  unanimous: z.boolean(),
  confidence: z.number(),
}) satisfies z.ZodType<FieldAgreement>;

/**
 * Field consensus schema
 */
export const FieldConsensusSchema = z.object({
  fields: z.record(FieldAgreementSchema),
  overallAgreement: z.number(),
  agreedFields: z.array(z.string()),
  disagreedFields: z.array(z.string()),
}) satisfies z.ZodType<FieldConsensus>;

/**
 * Consensus output schema
 */
export const ConsensusOutputSchema = z.object({
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
}) satisfies z.ZodType<ConsensusOutput>;

/**
 * Consensus result schema
 */
export const ConsensusResultSchema = z.object({
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
  metadata: z.record(z.any()).optional(),
}) satisfies z.ZodType<ConsensusResult>;

/**
 * Consensus options schema
 */
export const ConsensusOptionsSchema = z.object({
  streams: z.array(z.function().returns(z.any())),
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
      metadata: z.record(z.any()).optional(),
    })
    .optional(),
  onComplete: z
    .function()
    .args(z.array(ConsensusOutputSchema))
    .returns(z.any())
    .optional(),
  onConsensus: z
    .function()
    .args(ConsensusResultSchema)
    .returns(z.any())
    .optional(),
  metadata: z.record(z.any()).optional(),
}) satisfies z.ZodType<ConsensusOptions>;

/**
 * Text consensus options schema
 */
export const TextConsensusOptionsSchema = z.object({
  threshold: z.number(),
  strategy: ConsensusStrategySchema,
  resolveConflicts: ConflictResolutionSchema,
  weights: z.array(z.number()),
}) satisfies z.ZodType<TextConsensusOptions>;

/**
 * Structured consensus options schema
 */
export const StructuredConsensusOptionsSchema = z.object({
  schema: z.any(),
  strategy: ConsensusStrategySchema,
  resolveConflicts: ConflictResolutionSchema,
  weights: z.array(z.number()),
  minimumAgreement: z.number(),
}) satisfies z.ZodType<StructuredConsensusOptions>;

/**
 * Consensus preset schema
 */
export const ConsensusPresetSchema = z.object({
  name: z.string(),
  strategy: ConsensusStrategySchema,
  threshold: z.number(),
  resolveConflicts: ConflictResolutionSchema,
  minimumAgreement: z.number(),
}) satisfies z.ZodType<ConsensusPreset>;
