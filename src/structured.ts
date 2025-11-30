// L0 Structured Output API - Deterministic JSON with schema validation and auto-correction

import { z } from "zod";
import type {
  StructuredOptions,
  StructuredResult,
  StructuredState,
  StructuredTelemetry,
  CorrectionInfo,
} from "./types/structured";
import type { L0Options, L0Event } from "./types/l0";
import { l0 } from "./runtime/l0";
import { autoCorrectJSON, isValidJSON, extractJSON } from "./utils/autoCorrect";

/**
 * L0 Structured Output - Guaranteed valid JSON matching your schema
 *
 * Provides:
 * - Automatic schema validation with Zod
 * - Auto-correction of common JSON issues
 * - Retry on validation failure
 * - Fallback model support
 * - Full L0 reliability (guardrails, network errors, etc.)
 *
 * @param options - Structured output configuration
 * @returns Validated and typed data matching schema
 *
 * @example
 * ```typescript
 * import { structured } from 'l0';
 * import { z } from 'zod';
 *
 * const schema = z.object({
 *   amount: z.number(),
 *   approved: z.boolean()
 * });
 *
 * const result = await structured({
 *   schema,
 *   stream: () => streamText({ model, prompt })
 * });
 *
 * console.log(result.data.amount); // Typed!
 * ```
 */
export async function structured<T extends z.ZodTypeAny>(
  options: StructuredOptions<T>,
): Promise<StructuredResult<z.infer<T>>> {
  const {
    schema,
    stream: streamFactory,
    fallbackStreams = [],
    retry = {},
    autoCorrect = true,
    strictMode = false,
    timeout,
    signal,
    monitoring,
    detectZeroTokens,
    onValidationError,
    onAutoCorrect,
    onRetry,
  } = options;

  // Track structured-specific state
  let validationAttempts = 0;
  let validationFailures = 0;
  let autoCorrections = 0;
  const correctionTypes: string[] = [];
  const validationErrors: z.ZodError[] = [];
  let rawOutput = "";
  let correctedOutput = "";
  let appliedCorrections: string[] = [];
  let wasAutoCorrected = false;
  const errors: Error[] = [];

  // Timing
  let validationStartTime = 0;
  let validationEndTime = 0;

  // Create abort controller
  const abortController = new AbortController();

  // Wrap the stream factory to attempt JSON parsing after completion
  const wrappedStreamFactory = async () => {
    return streamFactory();
  };

  // Build L0 options
  const l0Options: L0Options = {
    stream: wrappedStreamFactory,
    fallbackStreams,
    retry: {
      attempts: retry.attempts ?? 2,
      backoff: retry.backoff ?? "fixed-jitter",
      baseDelay: retry.baseDelay ?? 1000,
      maxDelay: retry.maxDelay ?? 5000,
      retryOn: [...(retry.retryOn || []), "guardrail_violation", "incomplete"],
      errorTypeDelays: retry.errorTypeDelays,
    },
    timeout,
    signal: signal || abortController.signal,
    // Default to disabled for structured output since short valid JSON
    // (like "[]" or "{}") should not be rejected
    detectZeroTokens: detectZeroTokens ?? false,
    monitoring: {
      enabled: monitoring?.enabled ?? false,
      sampleRate: monitoring?.sampleRate ?? 1.0,
      metadata: {
        ...(monitoring?.metadata || {}),
        structured: true,
        schemaName: schema.description || "unknown",
      },
    },
    guardrails: [
      // Add JSON structure guardrail
      {
        name: "json-structure",
        check: (context) => {
          if (context.completed) {
            // Check if output is valid JSON
            if (!isValidJSON(context.content)) {
              return [
                {
                  rule: "json-structure",
                  message: "Output is not valid JSON",
                  severity: "error",
                  recoverable: true,
                },
              ];
            }
          }
          return [];
        },
      },
    ],
    onRetry: (attempt, reason) => {
      if (onRetry) {
        onRetry(attempt, reason);
      }
    },
  };

  // Maximum retry attempts for validation
  const maxValidationRetries = retry.attempts ?? 2;
  let currentValidationAttempt = 0;

  // Retry loop for validation
  while (currentValidationAttempt <= maxValidationRetries) {
    try {
      // Execute L0 stream
      const result = await l0(l0Options);

      // Accumulate output
      rawOutput = "";
      for await (const event of result.stream) {
        if (event.type === "token" && event.value) {
          rawOutput += event.value;
        } else if (event.type === "error") {
          errors.push(event.error || new Error("Unknown error"));
        }
      }

      // Check if we got output
      if (!rawOutput || rawOutput.trim().length === 0) {
        throw new Error("No output received from model");
      }

      // Start validation timing
      validationStartTime = Date.now();
      validationAttempts++;

      // Step 1: Auto-correct if enabled
      correctedOutput = rawOutput;
      appliedCorrections = [];

      if (autoCorrect) {
        const correctionResult = autoCorrectJSON(correctedOutput, {
          structural: true,
          stripFormatting: true,
          schemaBased: false,
          strict: strictMode,
        });

        if (correctionResult.corrections.length > 0) {
          wasAutoCorrected = true;
          correctedOutput = correctionResult.corrected;
          appliedCorrections = correctionResult.corrections;
          autoCorrections++;
          correctionTypes.push(...correctionResult.corrections);

          // Call callback
          if (onAutoCorrect) {
            const correctionInfo: CorrectionInfo = {
              original: rawOutput,
              corrected: correctedOutput,
              corrections: correctionResult.corrections,
              success: correctionResult.success,
            };
            onAutoCorrect(correctionInfo);
          }
        }
      }

      // Step 2: Parse JSON
      let parsedData: any;
      try {
        parsedData = JSON.parse(correctedOutput);
      } catch (parseError) {
        const err =
          parseError instanceof Error
            ? parseError
            : new Error(String(parseError));
        errors.push(err);

        // Try extractJSON to find JSON within surrounding text
        const extracted = extractJSON(correctedOutput);
        if (extracted !== correctedOutput) {
          try {
            // Try parsing the extracted JSON
            parsedData = JSON.parse(extracted);
            correctedOutput = extracted;
            wasAutoCorrected = true;
            if (!appliedCorrections.includes("extract_json")) {
              appliedCorrections.push("extract_json");
              correctionTypes.push("extract_json");
            }
            autoCorrections++;
          } catch {
            // Try auto-correction on the extracted content
            const rescueResult = autoCorrectJSON(extracted, {
              structural: true,
              stripFormatting: true,
            });

            if (rescueResult.success) {
              parsedData = JSON.parse(rescueResult.corrected);
              correctedOutput = rescueResult.corrected;
              wasAutoCorrected = true;
              appliedCorrections.push(...rescueResult.corrections);
              autoCorrections++;
              correctionTypes.push(...rescueResult.corrections);
            } else {
              throw new Error(
                `Invalid JSON after auto-correction: ${err.message}`,
              );
            }
          }
        } else if (!autoCorrect) {
          // Try one more auto-correction attempt if not already done
          const rescueResult = autoCorrectJSON(correctedOutput, {
            structural: true,
            stripFormatting: true,
          });

          if (rescueResult.success) {
            parsedData = JSON.parse(rescueResult.corrected);
            correctedOutput = rescueResult.corrected;
            wasAutoCorrected = true;
            appliedCorrections.push(...rescueResult.corrections);
            autoCorrections++;
            correctionTypes.push(...rescueResult.corrections);
          } else {
            throw new Error(`Invalid JSON: ${err.message}`);
          }
        } else {
          // Auto-correction was applied but parsing still failed and extractJSON didn't help
          // Try one more aggressive extraction - look for the first complete JSON structure
          const rawExtracted = extractJSON(rawOutput);
          if (rawExtracted !== rawOutput) {
            const rescueResult = autoCorrectJSON(rawExtracted, {
              structural: true,
              stripFormatting: true,
            });

            if (rescueResult.success) {
              try {
                parsedData = JSON.parse(rescueResult.corrected);
                correctedOutput = rescueResult.corrected;
                wasAutoCorrected = true;
                appliedCorrections.push(
                  "extract_json",
                  ...rescueResult.corrections,
                );
                autoCorrections++;
                correctionTypes.push(
                  "extract_json",
                  ...rescueResult.corrections,
                );
              } catch {
                throw new Error(
                  `Invalid JSON after auto-correction: ${err.message}`,
                );
              }
            } else {
              throw new Error(
                `Invalid JSON after auto-correction: ${err.message}`,
              );
            }
          } else {
            throw new Error(
              `Invalid JSON after auto-correction: ${err.message}`,
            );
          }
        }
      }

      // Step 3: Validate against schema
      const validationResult = schema.safeParse(parsedData);

      if (!validationResult.success) {
        validationFailures++;
        validationErrors.push(validationResult.error);

        // Call validation error callback
        if (onValidationError) {
          onValidationError(validationResult.error, currentValidationAttempt);
        }

        // Check if we should retry
        if (currentValidationAttempt < maxValidationRetries) {
          currentValidationAttempt++;
          if (onRetry) {
            onRetry(
              currentValidationAttempt,
              `Schema validation failed: ${validationResult.error.errors[0]?.message}`,
            );
          }
          continue;
        }

        // Out of retries
        throw new Error(
          `Schema validation failed after ${validationAttempts} attempts: ${JSON.stringify(validationResult.error.errors)}`,
        );
      }

      // Success!
      validationEndTime = Date.now();

      // Build structured state
      const structuredState: StructuredState = {
        ...result.state,
        validationFailures,
        autoCorrections,
        validationErrors,
      };

      // Build structured telemetry
      let structuredTelemetry: StructuredTelemetry | undefined;
      if (result.telemetry) {
        structuredTelemetry = {
          ...result.telemetry,
          structured: {
            schemaName: schema.description || "unknown",
            validationAttempts,
            validationFailures,
            autoCorrections,
            correctionTypes: Array.from(new Set(correctionTypes)),
            validationSuccess: true,
            validationTime: validationEndTime - validationStartTime,
          },
        };
      }

      // Return successful result
      return {
        data: validationResult.data,
        raw: rawOutput,
        corrected: wasAutoCorrected,
        corrections: appliedCorrections,
        state: structuredState,
        telemetry: structuredTelemetry,
        errors,
        abort: () => abortController.abort(),
      };
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      errors.push(err);

      // Check if we should retry
      if (currentValidationAttempt < maxValidationRetries) {
        currentValidationAttempt++;
        if (onRetry) {
          onRetry(currentValidationAttempt, err.message);
        }
        continue;
      }

      // Out of retries - throw
      throw new Error(
        `Structured output failed after ${currentValidationAttempt + 1} attempts: ${err.message}`,
      );
    }
  }

  // Should never reach here, but TypeScript needs it
  throw new Error("Unexpected: exhausted retry loop without result");
}

/**
 * Helper: Create a structured output with a simple schema
 *
 * @example
 * ```typescript
 * const result = await structuredObject({
 *   amount: z.number(),
 *   approved: z.boolean()
 * }, {
 *   stream: () => streamText({ model, prompt })
 * });
 * ```
 */
export async function structuredObject<T extends z.ZodRawShape>(
  shape: T,
  options: Omit<StructuredOptions<z.ZodObject<T>>, "schema">,
): Promise<StructuredResult<z.infer<z.ZodObject<T>>>> {
  const schema = z.object(shape);
  return structured({ ...options, schema });
}

/**
 * Helper: Create a structured output with an array schema
 *
 * @example
 * ```typescript
 * const result = await structuredArray(
 *   z.object({ name: z.string() }),
 *   { stream: () => streamText({ model, prompt }) }
 * );
 * ```
 */
export async function structuredArray<T extends z.ZodTypeAny>(
  itemSchema: T,
  options: Omit<StructuredOptions<z.ZodArray<T>>, "schema">,
): Promise<StructuredResult<z.infer<z.ZodArray<T>>>> {
  const schema = z.array(itemSchema);
  return structured({ ...options, schema });
}

/**
 * Create a streaming structured output (yields tokens as they arrive, validates at end)
 *
 * @example
 * ```typescript
 * const result = structuredStream({ schema, stream });
 *
 * for await (const event of result.stream) {
 *   if (event.type === 'token') {
 *     console.log(event.value);
 *   }
 * }
 *
 * const validated = await result.result;
 * console.log(validated.data);
 * ```
 */
export async function structuredStream<T extends z.ZodTypeAny>(
  options: StructuredOptions<T>,
): Promise<{
  stream: AsyncIterable<L0Event>;
  result: Promise<StructuredResult<z.infer<T>>>;
  abort: () => void;
}> {
  const abortController = new AbortController();

  // Create a promise that resolves with the final result
  const resultPromise = structured({
    ...options,
    signal: abortController.signal,
  });

  // Create l0 stream for real-time tokens
  const l0Result = await l0({
    stream: options.stream,
    fallbackStreams: options.fallbackStreams,
    retry: options.retry,
    timeout: options.timeout,
    signal: abortController.signal,
    monitoring: options.monitoring,
    onRetry: options.onRetry,
  });

  return {
    stream: l0Result.stream,
    result: resultPromise,
    abort: () => abortController.abort(),
  };
}
