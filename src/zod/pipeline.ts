// Zod schemas for L0 Pipeline types

import { z } from "zod";
import type {
  PipelineStep,
  StructuredPipelineStep,
  PipelineOptions,
  PipelineResult,
  StepResult,
  StructuredStepResult,
  StepContext,
  Pipeline,
  PipelineBranch,
  StepBuilderOptions,
  PipelinePreset,
} from "../types/pipeline";
import { L0OptionsSchema, L0ResultSchema } from "./l0";
import { StructuredOptionsSchema, StructuredResultSchema } from "./structured";

/**
 * Step context schema
 */
export const StepContextSchema = z.object({
  stepIndex: z.number(),
  totalSteps: z.number(),
  previousResults: z.array(z.any()), // StepResult[]
  metadata: z.record(z.any()),
  signal: z.instanceof(AbortSignal).optional(),
}) satisfies z.ZodType<StepContext>;

/**
 * Step result schema
 */
export const StepResultSchema = z.object({
  stepName: z.string(),
  stepIndex: z.number(),
  input: z.any(),
  output: z.any(),
  l0Result: L0ResultSchema,
  status: z.enum(["success", "error", "skipped"]),
  error: z.instanceof(Error).optional(),
  duration: z.number(),
  startTime: z.number(),
  endTime: z.number(),
}) satisfies z.ZodType<StepResult>;

/**
 * Structured step result schema
 */
export const StructuredStepResultSchema = z.object({
  stepName: z.string(),
  stepIndex: z.number(),
  input: z.any(),
  output: z.any(),
  structuredResult: StructuredResultSchema,
  status: z.enum(["success", "error", "skipped"]),
  error: z.instanceof(Error).optional(),
  duration: z.number(),
  startTime: z.number(),
  endTime: z.number(),
}) satisfies z.ZodType<StructuredStepResult>;

/**
 * Pipeline step schema
 */
export const PipelineStepSchema = z.object({
  name: z.string(),
  fn: z.function().args(z.any(), StepContextSchema).returns(z.any()),
  transform: z.function().args(L0ResultSchema, StepContextSchema).returns(z.any()).optional(),
  condition: z.function().args(z.any(), StepContextSchema).returns(z.any()).optional(),
  onError: z.function().args(z.instanceof(Error), StepContextSchema).returns(z.any()).optional(),
  onComplete: z.function().args(StepResultSchema, StepContextSchema).returns(z.any()).optional(),
  metadata: z.record(z.any()).optional(),
}) satisfies z.ZodType<PipelineStep>;

/**
 * Structured pipeline step schema
 */
export const StructuredPipelineStepSchema = z.object({
  name: z.string(),
  fn: z.function().args(z.any(), StepContextSchema).returns(z.any()),
  transform: z.function().args(StructuredResultSchema, StepContextSchema).returns(z.any()).optional(),
  condition: z.function().args(z.any(), StepContextSchema).returns(z.any()).optional(),
  onError: z.function().args(z.instanceof(Error), StepContextSchema).returns(z.any()).optional(),
  onComplete: z
    .function()
    .args(StructuredStepResultSchema, StepContextSchema)
    .returns(z.any())
    .optional(),
  metadata: z.record(z.any()).optional(),
}) satisfies z.ZodType<StructuredPipelineStep>;

/**
 * Pipeline options schema
 */
export const PipelineOptionsSchema = z.object({
  name: z.string().optional(),
  stopOnError: z.boolean().optional(),
  timeout: z.number().optional(),
  signal: z.instanceof(AbortSignal).optional(),
  monitoring: z
    .object({
      enabled: z.boolean().optional(),
      metadata: z.record(z.any()).optional(),
    })
    .optional(),
  onStart: z.function().args(z.any()).returns(z.any()).optional(),
  onComplete: z.function().args(z.any()).returns(z.any()).optional(),
  onError: z.function().args(z.instanceof(Error), z.number()).returns(z.any()).optional(),
  onProgress: z.function().args(z.number(), z.number()).returns(z.any()).optional(),
  metadata: z.record(z.any()).optional(),
}) satisfies z.ZodType<PipelineOptions>;

/**
 * Pipeline result schema
 */
export const PipelineResultSchema = z.object({
  name: z.string().optional(),
  output: z.any(),
  steps: z.array(StepResultSchema),
  status: z.enum(["success", "error", "partial"]),
  error: z.instanceof(Error).optional(),
  duration: z.number(),
  startTime: z.number(),
  endTime: z.number(),
  metadata: z.record(z.any()).optional(),
}) satisfies z.ZodType<PipelineResult>;

/**
 * Pipeline interface schema
 */
export const PipelineSchema = z.object({
  name: z.string().optional(),
  steps: z.array(PipelineStepSchema),
  options: PipelineOptionsSchema,
  run: z.function().args(z.any()).returns(z.promise(PipelineResultSchema)),
  addStep: z.function().args(PipelineStepSchema).returns(z.any()),
  removeStep: z.function().args(z.string()).returns(z.any()),
  getStep: z.function().args(z.string()).returns(PipelineStepSchema.optional()),
  clone: z.function().returns(z.any()),
}) satisfies z.ZodType<Pipeline>;

/**
 * Pipeline branch schema
 */
export const PipelineBranchSchema = z.object({
  condition: z.function().args(z.any(), StepContextSchema).returns(z.any()),
  steps: z.array(PipelineStepSchema),
  name: z.string().optional(),
}) satisfies z.ZodType<PipelineBranch>;

/**
 * Step builder options schema
 */
export const StepBuilderOptionsSchema = z.object({
  l0Options: L0OptionsSchema.partial().optional(),
  transform: z.function().args(L0ResultSchema).returns(z.any()).optional(),
  condition: z.function().args(z.any(), StepContextSchema).returns(z.any()).optional(),
  onError: z.function().args(z.instanceof(Error), StepContextSchema).returns(z.any()).optional(),
  metadata: z.record(z.any()).optional(),
}) satisfies z.ZodType<StepBuilderOptions>;

/**
 * Pipeline preset schema
 */
export const PipelinePresetSchema = z.object({
  name: z.string(),
  stopOnError: z.boolean(),
  timeout: z.number().optional(),
  monitoring: z
    .object({
      enabled: z.boolean(),
    })
    .optional(),
}) satisfies z.ZodType<PipelinePreset>;
