// Types for L0 Pipeline API - Multi-phase workflows

import type { z } from "zod";
import type { L0Options, L0Result } from "./l0";
import type { StructuredOptions, StructuredResult } from "./structured";

/**
 * Pipeline step configuration
 */
export interface PipelineStep<TInput = any, TOutput = any> {
  /**
   * Step name (for logging/debugging)
   */
  name: string;

  /**
   * Step function that takes input and returns L0 options
   */
  fn: (input: TInput, context: StepContext) => L0Options | Promise<L0Options>;

  /**
   * Optional transform function to process L0 result before next step
   */
  transform?: (
    result: L0Result,
    context: StepContext,
  ) => TOutput | Promise<TOutput>;

  /**
   * Optional condition to determine if step should run
   */
  condition?: (
    input: TInput,
    context: StepContext,
  ) => boolean | Promise<boolean>;

  /**
   * Optional error handler for this step
   */
  onError?: (error: Error, context: StepContext) => void | Promise<void>;

  /**
   * Optional callback when step completes
   */
  onComplete?: (
    result: StepResult<TOutput>,
    context: StepContext,
  ) => void | Promise<void>;

  /**
   * Step-specific metadata
   */
  metadata?: Record<string, any>;
}

/**
 * Structured pipeline step (with schema validation)
 */
export interface StructuredPipelineStep<
  TInput = any,
  TSchema extends z.ZodTypeAny = z.ZodTypeAny,
> {
  /**
   * Step name
   */
  name: string;

  /**
   * Step function that returns structured options
   */
  fn: (
    input: TInput,
    context: StepContext,
  ) => StructuredOptions<TSchema> | Promise<StructuredOptions<TSchema>>;

  /**
   * Optional transform function
   */
  transform?: (
    result: StructuredResult<z.infer<TSchema>>,
    context: StepContext,
  ) => any | Promise<any>;

  /**
   * Optional condition
   */
  condition?: (
    input: TInput,
    context: StepContext,
  ) => boolean | Promise<boolean>;

  /**
   * Optional error handler
   */
  onError?: (error: Error, context: StepContext) => void | Promise<void>;

  /**
   * Optional callback when step completes
   */
  onComplete?: (
    result: StructuredStepResult<z.infer<TSchema>>,
    context: StepContext,
  ) => void | Promise<void>;

  /**
   * Step-specific metadata
   */
  metadata?: Record<string, any>;
}

/**
 * Context passed to each step
 */
export interface StepContext {
  /**
   * Current step index
   */
  stepIndex: number;

  /**
   * Total number of steps
   */
  totalSteps: number;

  /**
   * Results from all previous steps
   */
  previousResults: StepResult[];

  /**
   * Pipeline-wide metadata
   */
  metadata: Record<string, any>;

  /**
   * Abort signal for cancellation
   */
  signal?: AbortSignal;
}

/**
 * Result from a single pipeline step
 */
export interface StepResult<TOutput = any> {
  /**
   * Step name
   */
  stepName: string;

  /**
   * Step index
   */
  stepIndex: number;

  /**
   * Step input
   */
  input: any;

  /**
   * Step output (transformed or raw L0 result)
   */
  output: TOutput;

  /**
   * Raw L0 result
   */
  l0Result: L0Result;

  /**
   * Execution status
   */
  status: "success" | "error" | "skipped";

  /**
   * Error if step failed
   */
  error?: Error;

  /**
   * Step duration in milliseconds
   */
  duration: number;

  /**
   * Timestamp when step started
   */
  startTime: number;

  /**
   * Timestamp when step ended
   */
  endTime: number;
}

/**
 * Result from a structured pipeline step
 */
export interface StructuredStepResult<TOutput = any> {
  /**
   * Step name
   */
  stepName: string;

  /**
   * Step index
   */
  stepIndex: number;

  /**
   * Step input
   */
  input: any;

  /**
   * Step output (validated data)
   */
  output: TOutput;

  /**
   * Raw structured result
   */
  structuredResult: StructuredResult<TOutput>;

  /**
   * Execution status
   */
  status: "success" | "error" | "skipped";

  /**
   * Error if step failed
   */
  error?: Error;

  /**
   * Step duration in milliseconds
   */
  duration: number;

  /**
   * Timestamp when step started
   */
  startTime: number;

  /**
   * Timestamp when step ended
   */
  endTime: number;
}

/**
 * Pipeline configuration options
 */
export interface PipelineOptions {
  /**
   * Pipeline name (for logging/debugging)
   */
  name?: string;

  /**
   * Stop execution on first error
   * @default true
   */
  stopOnError?: boolean;

  /**
   * Maximum execution time for entire pipeline (ms)
   */
  timeout?: number;

  /**
   * Abort signal for cancellation
   */
  signal?: AbortSignal;

  /**
   * Enable monitoring/telemetry
   */
  monitoring?: {
    enabled?: boolean;
    metadata?: Record<string, any>;
  };

  /**
   * Callback when pipeline starts
   */
  onStart?: (input: any) => void | Promise<void>;

  /**
   * Callback when pipeline completes
   */
  onComplete?: (result: PipelineResult) => void | Promise<void>;

  /**
   * Callback when pipeline errors
   */
  onError?: (error: Error, stepIndex: number) => void | Promise<void>;

  /**
   * Callback for step progress
   */
  onProgress?: (stepIndex: number, totalSteps: number) => void | Promise<void>;

  /**
   * Pipeline-wide metadata
   */
  metadata?: Record<string, any>;
}

/**
 * Result from pipeline execution
 */
export interface PipelineResult<TOutput = any> {
  /**
   * Pipeline name
   */
  name?: string;

  /**
   * Final output from last step
   */
  output: TOutput;

  /**
   * Results from all steps
   */
  steps: StepResult[];

  /**
   * Overall execution status
   */
  status: "success" | "error" | "partial";

  /**
   * Error if pipeline failed
   */
  error?: Error;

  /**
   * Total duration in milliseconds
   */
  duration: number;

  /**
   * Timestamp when pipeline started
   */
  startTime: number;

  /**
   * Timestamp when pipeline ended
   */
  endTime: number;

  /**
   * Pipeline metadata
   */
  metadata?: Record<string, any>;
}

/**
 * Pipeline interface
 */
export interface Pipeline<TInput = any, TOutput = any> {
  /**
   * Pipeline name
   */
  name?: string;

  /**
   * Pipeline steps
   */
  steps: PipelineStep[];

  /**
   * Pipeline options
   */
  options: PipelineOptions;

  /**
   * Execute pipeline with input
   */
  run(input: TInput): Promise<PipelineResult<TOutput>>;

  /**
   * Add a step to the pipeline
   */
  addStep(step: PipelineStep): Pipeline<TInput, TOutput>;

  /**
   * Remove a step by name
   */
  removeStep(name: string): Pipeline<TInput, TOutput>;

  /**
   * Get step by name
   */
  getStep(name: string): PipelineStep | undefined;

  /**
   * Clone pipeline
   */
  clone(): Pipeline<TInput, TOutput>;
}

/**
 * Conditional branch in pipeline
 */
export interface PipelineBranch<TInput = any> {
  /**
   * Branch condition
   */
  condition: (
    input: TInput,
    context: StepContext,
  ) => boolean | Promise<boolean>;

  /**
   * Steps to execute if condition is true
   */
  steps: PipelineStep[];

  /**
   * Optional name for the branch
   */
  name?: string;
}

/**
 * Pipeline step builder options
 */
export interface StepBuilderOptions {
  /**
   * L0 options to apply to this step
   */
  l0Options?: Partial<L0Options>;

  /**
   * Transform function
   */
  transform?: (result: L0Result) => any | Promise<any>;

  /**
   * Condition function
   */
  condition?: (input: any, context: StepContext) => boolean | Promise<boolean>;

  /**
   * Error handler
   */
  onError?: (error: Error, context: StepContext) => void | Promise<void>;

  /**
   * Metadata
   */
  metadata?: Record<string, any>;
}

/**
 * Preset pipeline configurations
 */
export interface PipelinePreset {
  name: string;
  stopOnError: boolean;
  timeout?: number;
  monitoring?: {
    enabled: boolean;
  };
}

/**
 * Fast pipeline - minimal config, fail fast
 */
export const fastPipeline: Partial<PipelineOptions> = {
  stopOnError: true,
  monitoring: {
    enabled: false,
  },
};

/**
 * Reliable pipeline - retry, monitoring, graceful failures
 */
export const reliablePipeline: Partial<PipelineOptions> = {
  stopOnError: false,
  monitoring: {
    enabled: true,
  },
};

/**
 * Production pipeline - full monitoring, timeouts
 */
export const productionPipeline: Partial<PipelineOptions> = {
  stopOnError: false,
  timeout: 300000, // 5 minutes
  monitoring: {
    enabled: true,
  },
};
