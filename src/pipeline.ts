// L0 Pipeline API - Multi-phase streaming workflows

import type {
  PipelineStep,
  PipelineOptions,
  PipelineResult,
  StepContext,
  StepResult,
  Pipeline,
} from "./types/pipeline";
import { l0 } from "./runtime/l0";

/**
 * Execute a pipeline of streaming steps
 *
 * Each step receives the output of the previous step and can transform it
 * before passing to the next step. Guardrails can be applied between steps.
 *
 * @param steps - Array of pipeline steps
 * @param input - Initial input to the first step
 * @param options - Pipeline options
 * @returns Pipeline result with all step results
 *
 * @example
 * ```typescript
 * const result = await pipe(
 *   [
 *     {
 *       name: 'summarize',
 *       fn: (input) => ({
 *         stream: () => streamText({
 *           model: openai('gpt-4o'),
 *           prompt: `Summarize: ${input}`
 *         })
 *       })
 *     },
 *     {
 *       name: 'refine',
 *       fn: (summary) => ({
 *         stream: () => streamText({
 *           model: openai('gpt-4o'),
 *           prompt: `Refine this summary: ${summary}`
 *         })
 *       })
 *     }
 *   ],
 *   longDocument,
 *   { name: 'summarize-refine' }
 * );
 *
 * console.log(result.output); // Final refined summary
 * ```
 */
export async function pipe<TInput = any, TOutput = any>(
  steps: PipelineStep[],
  input: TInput,
  options: PipelineOptions = {},
): Promise<PipelineResult<TOutput>> {
  const {
    name,
    stopOnError = true,
    timeout,
    signal,
    monitoring,
    onStart,
    onComplete,
    onError,
    onProgress,
    metadata = {},
  } = options;

  const startTime = Date.now();
  const stepResults: StepResult[] = [];
  let currentInput: any = input;
  let finalOutput: any = input;
  let pipelineError: Error | undefined;
  let pipelineStatus: "success" | "error" | "partial" = "success";

  // Create timeout promise if specified
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = timeout
    ? new Promise<never>((_, reject) => {
        timeoutId = setTimeout(
          () => reject(new Error(`Pipeline timeout after ${timeout}ms`)),
          timeout,
        );
      })
    : null;

  try {
    // Call onStart callback
    if (onStart) {
      await onStart(input);
    }

    // Execute each step
    for (let i = 0; i < steps.length; i++) {
      const step = steps[i]!;
      const stepStartTime = Date.now();

      // Check for abort signal
      if (signal?.aborted) {
        throw new Error("Pipeline aborted");
      }

      // Build step context
      const context: StepContext = {
        stepIndex: i,
        totalSteps: steps.length,
        previousResults: stepResults,
        metadata,
        signal,
      };

      // Call progress callback
      if (onProgress) {
        await onProgress(i, steps.length);
      }

      // Check step condition
      if (step.condition) {
        const shouldRun = await step.condition(currentInput, context);
        if (!shouldRun) {
          stepResults.push({
            stepName: step.name,
            stepIndex: i,
            input: currentInput,
            output: currentInput,
            l0Result: undefined as any,
            status: "skipped",
            duration: Date.now() - stepStartTime,
            startTime: stepStartTime,
            endTime: Date.now(),
          });
          continue;
        }
      }

      try {
        // Get L0 options from step function
        const l0Options = await step.fn(currentInput, context);

        // Execute L0 with timeout race if specified
        const executeStep = async () => {
          const result = await l0({
            ...l0Options,
            signal,
            monitoring,
          });

          // Consume stream and get content
          let content = "";
          for await (const event of result.stream) {
            if (event.type === "token" && event.value) {
              content += event.value;
            }
          }

          return {
            ...result,
            state: {
              ...result.state,
              content: content || result.state.content,
            },
          };
        };

        const l0Result = timeoutPromise
          ? await Promise.race([executeStep(), timeoutPromise])
          : await executeStep();

        // Transform output if transform function provided
        const stepOutput = step.transform
          ? await step.transform(l0Result, context)
          : l0Result.state.content;

        const stepResult: StepResult = {
          stepName: step.name,
          stepIndex: i,
          input: currentInput,
          output: stepOutput,
          l0Result,
          status: "success",
          duration: Date.now() - stepStartTime,
          startTime: stepStartTime,
          endTime: Date.now(),
        };

        stepResults.push(stepResult);

        // Call step onComplete callback
        if (step.onComplete) {
          await step.onComplete(stepResult, context);
        }

        // Update current input for next step
        currentInput = stepOutput;
        finalOutput = stepOutput;
      } catch (error) {
        const stepError =
          error instanceof Error ? error : new Error(String(error));

        const stepResult: StepResult = {
          stepName: step.name,
          stepIndex: i,
          input: currentInput,
          output: undefined,
          l0Result: undefined as any,
          status: "error",
          error: stepError,
          duration: Date.now() - stepStartTime,
          startTime: stepStartTime,
          endTime: Date.now(),
        };

        stepResults.push(stepResult);

        // Call step onError callback
        if (step.onError) {
          await step.onError(stepError, context);
        }

        // Call pipeline onError callback
        if (onError) {
          await onError(stepError, i);
        }

        if (stopOnError) {
          pipelineError = stepError;
          pipelineStatus = "error";
          break;
        } else {
          pipelineStatus = "partial";
        }
      }
    }
  } catch (error) {
    pipelineError = error instanceof Error ? error : new Error(String(error));
    pipelineStatus = "error";
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }

  const result: PipelineResult<TOutput> = {
    name,
    output: finalOutput as TOutput,
    steps: stepResults,
    status: pipelineStatus,
    error: pipelineError,
    duration: Date.now() - startTime,
    startTime,
    endTime: Date.now(),
    metadata,
  };

  // Call onComplete callback
  if (onComplete) {
    await onComplete(result);
  }

  return result;
}

/**
 * Create a reusable pipeline
 *
 * @param steps - Pipeline steps
 * @param options - Default pipeline options
 * @returns Pipeline object with run method
 *
 * @example
 * ```typescript
 * const summarizePipeline = createPipeline([
 *   { name: 'extract', fn: extractStep },
 *   { name: 'summarize', fn: summarizeStep },
 *   { name: 'format', fn: formatStep }
 * ], { name: 'document-summarizer' });
 *
 * const result = await summarizePipeline.run(document);
 * ```
 */
export function createPipeline<TInput = any, TOutput = any>(
  steps: PipelineStep[],
  options: PipelineOptions = {},
): Pipeline<TInput, TOutput> {
  const pipelineSteps = [...steps];
  const pipelineOptions = { ...options };

  const pipeline: Pipeline<TInput, TOutput> = {
    name: options.name,
    steps: pipelineSteps,
    options: pipelineOptions,

    async run(input: TInput): Promise<PipelineResult<TOutput>> {
      return pipe<TInput, TOutput>(pipelineSteps, input, pipelineOptions);
    },

    addStep(step: PipelineStep): Pipeline<TInput, TOutput> {
      pipelineSteps.push(step);
      return pipeline;
    },

    removeStep(name: string): Pipeline<TInput, TOutput> {
      const index = pipelineSteps.findIndex((s) => s.name === name);
      if (index !== -1) {
        pipelineSteps.splice(index, 1);
      }
      return pipeline;
    },

    getStep(name: string): PipelineStep | undefined {
      return pipelineSteps.find((s) => s.name === name);
    },

    clone(): Pipeline<TInput, TOutput> {
      return createPipeline<TInput, TOutput>(
        pipelineSteps.map((s) => ({ ...s })),
        { ...pipelineOptions },
      );
    },
  };

  return pipeline;
}

/**
 * Create a simple step from a prompt template
 *
 * @param name - Step name
 * @param promptFn - Function that generates prompt from input
 * @param streamFactory - Function that creates the stream
 * @returns Pipeline step
 *
 * @example
 * ```typescript
 * const summarizeStep = createStep(
 *   'summarize',
 *   (doc) => `Summarize: ${doc}`,
 *   (prompt) => streamText({ model, prompt })
 * );
 * ```
 */
export function createStep<TInput = string>(
  name: string,
  promptFn: (input: TInput) => string,
  streamFactory: (prompt: string) => any,
): PipelineStep<TInput, string> {
  return {
    name,
    fn: (input: TInput) => ({
      stream: () => streamFactory(promptFn(input)),
    }),
  };
}

/**
 * Chain multiple pipelines together
 *
 * @param pipelines - Pipelines to chain
 * @returns Combined pipeline
 *
 * @example
 * ```typescript
 * const fullPipeline = chainPipelines(
 *   extractPipeline,
 *   analyzePipeline,
 *   formatPipeline
 * );
 * ```
 */
export function chainPipelines<TInput = any, TOutput = any>(
  ...pipelines: Pipeline[]
): Pipeline<TInput, TOutput> {
  const allSteps: PipelineStep[] = [];

  for (const p of pipelines) {
    allSteps.push(...p.steps);
  }

  return createPipeline<TInput, TOutput>(allSteps, {
    name: pipelines.map((p) => p.name).join(" -> "),
  });
}

/**
 * Run pipelines in parallel and combine results
 *
 * @param pipelines - Pipelines to run
 * @param input - Input for all pipelines
 * @param combiner - Function to combine results
 * @returns Combined output
 *
 * @example
 * ```typescript
 * const results = await parallelPipelines(
 *   [sentimentPipeline, entityPipeline, summaryPipeline],
 *   document,
 *   (results) => ({
 *     sentiment: results[0].output,
 *     entities: results[1].output,
 *     summary: results[2].output
 *   })
 * );
 * ```
 */
export async function parallelPipelines<TInput = any, TOutput = any>(
  pipelines: Pipeline[],
  input: TInput,
  combiner: (results: PipelineResult[]) => TOutput,
): Promise<TOutput> {
  const results = await Promise.all(pipelines.map((p) => p.run(input)));
  return combiner(results);
}

/**
 * Create a conditional branch step
 *
 * @param name - Step name
 * @param condition - Condition function
 * @param ifTrue - Step to run if condition is true
 * @param ifFalse - Step to run if condition is false
 * @returns Pipeline step
 *
 * @example
 * ```typescript
 * const branchStep = branchStep(
 *   'route',
 *   (input) => input.length > 1000,
 *   summarizeStep,
 *   passThrough
 * );
 * ```
 */
export function createBranchStep<TInput = any>(
  name: string,
  condition: (input: TInput, context: StepContext) => boolean | Promise<boolean>,
  ifTrue: PipelineStep<TInput>,
  ifFalse: PipelineStep<TInput>,
): PipelineStep<TInput> {
  return {
    name,
    fn: async (input: TInput, context: StepContext) => {
      const result = await condition(input, context);
      const step = result ? ifTrue : ifFalse;
      return step.fn(input, context);
    },
    transform: async (result, context) => {
      // Use the appropriate transform based on which branch was taken
      const conditionResult = await condition(
        context.previousResults[context.stepIndex - 1]?.output,
        context,
      );
      const step = conditionResult ? ifTrue : ifFalse;
      if (step.transform) {
        return step.transform(result, context);
      }
      return result.state.content;
    },
  };
}
