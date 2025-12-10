// Zod schemas for L0 Pipeline types

import { z } from "zod4";
import type {
  StepResult,
  StructuredStepResult,
  StepContext,
  PipelineResult,
  PipelinePreset,
} from "../types/pipeline";
import { L0ResultSchema } from "./l0";
import { StructuredResultSchema } from "./structured";

/**
 * Step context schema
 */
export const StepContextSchema: z.ZodType<StepContext> = z.object({
  stepIndex: z.number(),
  totalSteps: z.number(),
  previousResults: z.array(z.any()), // StepResult[]
  metadata: z.record(z.string(), z.any()),
  signal: z.instanceof(AbortSignal).optional(),
});

/**
 * Step result schema
 */
export const StepResultSchema: z.ZodType<StepResult> = z.object({
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
});

/**
 * Structured step result schema
 */
export const StructuredStepResultSchema: z.ZodType<StructuredStepResult> =
  z.object({
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
  });

/**
 * Pipeline step schema
 * Note: Contains function properties - no explicit type annotation
 */
export const PipelineStepSchema = z.object({
  name: z.string(),
  fn: z.function(),
  transform: z.function().optional(),
  condition: z.function().optional(),
  onError: z.function().optional(),
  onComplete: z.function().optional(),
  metadata: z.record(z.string(), z.any()).optional(),
});

/**
 * Structured pipeline step schema
 * Note: Contains function properties - no explicit type annotation
 */
export const StructuredPipelineStepSchema = z.object({
  name: z.string(),
  fn: z.function(),
  transform: z.function().optional(),
  condition: z.function().optional(),
  onError: z.function().optional(),
  onComplete: z.function().optional(),
  metadata: z.record(z.string(), z.any()).optional(),
});

/**
 * Pipeline options schema
 * Note: Contains function properties - no explicit type annotation
 */
export const PipelineOptionsSchema = z.object({
  name: z.string().optional(),
  stopOnError: z.boolean().optional(),
  timeout: z.number().optional(),
  signal: z.instanceof(AbortSignal).optional(),
  monitoring: z
    .object({
      enabled: z.boolean().optional(),
      metadata: z.record(z.string(), z.any()).optional(),
    })
    .optional(),
  onStart: z.function().optional(),
  onComplete: z.function().optional(),
  onError: z.function().optional(),
  onProgress: z.function().optional(),
  metadata: z.record(z.string(), z.any()).optional(),
});

/**
 * Pipeline result schema
 */
export const PipelineResultSchema: z.ZodType<PipelineResult> = z.object({
  name: z.string().optional(),
  output: z.any(),
  steps: z.array(StepResultSchema),
  status: z.enum(["success", "error", "partial"]),
  error: z.instanceof(Error).optional(),
  duration: z.number(),
  startTime: z.number(),
  endTime: z.number(),
  metadata: z.record(z.string(), z.any()).optional(),
});

/**
 * Pipeline interface schema
 * Note: Contains function properties - no explicit type annotation
 */
export const PipelineSchema = z.object({
  name: z.string().optional(),
  steps: z.array(PipelineStepSchema),
  options: PipelineOptionsSchema,
  run: z.function(),
  addStep: z.function(),
  removeStep: z.function(),
  getStep: z.function(),
  clone: z.function(),
});

/**
 * Pipeline branch schema
 * Note: Contains function properties - no explicit type annotation
 */
export const PipelineBranchSchema = z.object({
  condition: z.function(),
  steps: z.array(PipelineStepSchema),
  name: z.string().optional(),
});

/**
 * Step builder options schema
 * Note: Contains function properties - no explicit type annotation
 */
export const StepBuilderOptionsSchema = z.object({
  l0Options: z.any().optional(),
  transform: z.function().optional(),
  condition: z.function().optional(),
  onError: z.function().optional(),
  metadata: z.record(z.string(), z.any()).optional(),
});

/**
 * Pipeline preset schema
 */
export const PipelinePresetSchema: z.ZodType<PipelinePreset> = z.object({
  name: z.string(),
  stopOnError: z.boolean(),
  timeout: z.number().optional(),
  monitoring: z
    .object({
      enabled: z.boolean(),
    })
    .optional(),
});
