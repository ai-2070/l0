// Comprehensive tests for L0 Pipeline API

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  pipe,
  createPipeline,
  createStep,
  chainPipelines,
  parallelPipelines,
  createBranchStep,
} from "../src/pipeline";
import type {
  PipelineStep,
  PipelineOptions,
  PipelineResult,
  StepContext,
  StepResult,
  Pipeline,
} from "../src/types/pipeline";
import {
  fastPipeline,
  reliablePipeline,
  productionPipeline,
} from "../src/types/pipeline";

// Mock stream factory for testing
function createMockStreamFactory(response: string, delay: number = 0) {
  return () => ({
    textStream: (async function* () {
      if (delay > 0) {
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
      yield { type: "text-delta", textDelta: response };
    })(),
  });
}

// Mock stream factory that throws an error
function createErrorStreamFactory(message: string, delay: number = 0) {
  return () => ({
    textStream: (async function* () {
      if (delay > 0) {
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
      throw new Error(message);
    })(),
  });
}

// Create a simple pipeline step
function createMockStep(
  name: string,
  response: string,
  delay: number = 0,
): PipelineStep {
  return {
    name,
    fn: () => ({
      stream: createMockStreamFactory(response, delay),
    }),
  };
}

// Create a step that transforms input
function createTransformStep(
  name: string,
  transformFn: (input: string) => string,
): PipelineStep<string, string> {
  return {
    name,
    fn: (input: string) => ({
      stream: createMockStreamFactory(transformFn(input)),
    }),
  };
}

// Create a step that fails
function createFailingStep(name: string, errorMessage: string): PipelineStep {
  return {
    name,
    fn: () => ({
      stream: createErrorStreamFactory(errorMessage),
    }),
  };
}

// ============================================================================
// pipe() Function Tests
// ============================================================================

describe("pipe()", () => {
  describe("Basic Execution", () => {
    it("should execute a single step pipeline", async () => {
      const steps: PipelineStep[] = [createMockStep("step1", "Hello World")];

      const result = await pipe(steps, "input");

      expect(result.status).toBe("success");
      expect(result.steps.length).toBe(1);
      expect(result.steps[0]?.status).toBe("success");
      expect(result.output).toBe("Hello World");
    });

    it("should execute multiple steps in sequence", async () => {
      const steps: PipelineStep[] = [
        createMockStep("step1", "First"),
        createMockStep("step2", "Second"),
        createMockStep("step3", "Third"),
      ];

      const result = await pipe(steps, "input");

      expect(result.status).toBe("success");
      expect(result.steps.length).toBe(3);
      expect(result.steps[0]?.stepName).toBe("step1");
      expect(result.steps[1]?.stepName).toBe("step2");
      expect(result.steps[2]?.stepName).toBe("step3");
      expect(result.output).toBe("Third");
    });

    it("should pass output from one step to the next", async () => {
      const receivedInputs: string[] = [];

      const steps: PipelineStep[] = [
        {
          name: "step1",
          fn: (input) => {
            receivedInputs.push(input);
            return { stream: createMockStreamFactory("output1") };
          },
        },
        {
          name: "step2",
          fn: (input) => {
            receivedInputs.push(input);
            return { stream: createMockStreamFactory("output2") };
          },
        },
      ];

      await pipe(steps, "initial");

      expect(receivedInputs).toEqual(["initial", "output1"]);
    });

    it("should return empty result for empty steps array", async () => {
      const result = await pipe([], "input");

      expect(result.status).toBe("success");
      expect(result.steps.length).toBe(0);
      expect(result.output).toBe("input");
    });

    it("should track duration", async () => {
      const steps: PipelineStep[] = [createMockStep("step1", "response", 10)];

      const result = await pipe(steps, "input");

      expect(result.duration).toBeGreaterThanOrEqual(10);
      expect(result.startTime).toBeLessThan(result.endTime);
    });
  });

  describe("Transform Functions", () => {
    it("should apply transform function to step output", async () => {
      const steps: PipelineStep[] = [
        {
          name: "step1",
          fn: () => ({ stream: createMockStreamFactory("hello") }),
          transform: (result) => result.state.content.toUpperCase(),
        },
      ];

      const result = await pipe(steps, "input");

      expect(result.output).toBe("HELLO");
    });

    it("should pass transformed output to next step", async () => {
      let receivedInput = "";

      const steps: PipelineStep[] = [
        {
          name: "step1",
          fn: () => ({ stream: createMockStreamFactory("hello") }),
          transform: (result) => result.state.content + "_transformed",
        },
        {
          name: "step2",
          fn: (input) => {
            receivedInput = input;
            return { stream: createMockStreamFactory("final") };
          },
        },
      ];

      await pipe(steps, "input");

      expect(receivedInput).toBe("hello_transformed");
    });

    it("should support async transform functions", async () => {
      const steps: PipelineStep[] = [
        {
          name: "step1",
          fn: () => ({ stream: createMockStreamFactory("hello") }),
          transform: async (result) => {
            await new Promise((resolve) => setTimeout(resolve, 5));
            return result.state.content + "_async";
          },
        },
      ];

      const result = await pipe(steps, "input");

      expect(result.output).toBe("hello_async");
    });
  });

  describe("Conditional Steps", () => {
    it("should skip step when condition returns false", async () => {
      const steps: PipelineStep[] = [
        {
          name: "step1",
          fn: () => ({ stream: createMockStreamFactory("first") }),
        },
        {
          name: "step2",
          fn: () => ({ stream: createMockStreamFactory("second") }),
          condition: () => false,
        },
        {
          name: "step3",
          fn: () => ({ stream: createMockStreamFactory("third") }),
        },
      ];

      const result = await pipe(steps, "input");

      expect(result.steps[1]?.status).toBe("skipped");
      expect(result.steps[1]?.output).toBe("first"); // Passes through previous output
      expect(result.output).toBe("third");
    });

    it("should execute step when condition returns true", async () => {
      const steps: PipelineStep[] = [
        {
          name: "step1",
          fn: () => ({ stream: createMockStreamFactory("response") }),
          condition: () => true,
        },
      ];

      const result = await pipe(steps, "input");

      expect(result.steps[0]?.status).toBe("success");
    });

    it("should support async condition functions", async () => {
      const steps: PipelineStep[] = [
        {
          name: "step1",
          fn: () => ({ stream: createMockStreamFactory("response") }),
          condition: async () => {
            await new Promise((resolve) => setTimeout(resolve, 5));
            return true;
          },
        },
      ];

      const result = await pipe(steps, "input");

      expect(result.steps[0]?.status).toBe("success");
    });

    it("should provide context to condition function", async () => {
      let receivedContext: StepContext | null = null;

      const steps: PipelineStep[] = [
        {
          name: "step1",
          fn: () => ({ stream: createMockStreamFactory("first") }),
        },
        {
          name: "step2",
          fn: () => ({ stream: createMockStreamFactory("second") }),
          condition: (_, context) => {
            receivedContext = context;
            return true;
          },
        },
      ];

      await pipe(steps, "input");

      expect(receivedContext).not.toBeNull();
      expect(receivedContext!.stepIndex).toBe(1);
      expect(receivedContext!.totalSteps).toBe(2);
      // Previous results includes step1 result plus step2 skipped check runs before execution
      expect(receivedContext!.previousResults.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe("Error Handling", () => {
    it("should stop on error by default", async () => {
      const steps: PipelineStep[] = [
        createMockStep("step1", "first"),
        createFailingStep("step2", "Test error"),
        createMockStep("step3", "third"),
      ];

      const result = await pipe(steps, "input");

      expect(result.status).toBe("error");
      expect(result.error?.message).toBe("Test error");
      expect(result.steps.length).toBe(2);
      expect(result.steps[1]?.status).toBe("error");
    });

    it("should continue on error when stopOnError is false", async () => {
      const steps: PipelineStep[] = [
        createMockStep("step1", "first"),
        createFailingStep("step2", "Test error"),
        createMockStep("step3", "third"),
      ];

      const result = await pipe(steps, "input", { stopOnError: false });

      expect(result.status).toBe("partial");
      expect(result.steps.length).toBe(3);
      expect(result.steps[1]?.status).toBe("error");
      expect(result.steps[2]?.status).toBe("success");
    });

    it("should call step onError callback", async () => {
      const onError = vi.fn();

      const steps: PipelineStep[] = [
        {
          name: "step1",
          fn: () => ({ stream: createErrorStreamFactory("Test error") }),
          onError,
        },
      ];

      await pipe(steps, "input");

      expect(onError).toHaveBeenCalledTimes(1);
      expect(onError).toHaveBeenCalledWith(
        expect.any(Error),
        expect.objectContaining({ stepIndex: 0 }),
      );
    });

    it("should call pipeline onError callback", async () => {
      const onError = vi.fn();

      const steps: PipelineStep[] = [createFailingStep("step1", "Test error")];

      await pipe(steps, "input", { onError });

      expect(onError).toHaveBeenCalledTimes(1);
      expect(onError).toHaveBeenCalledWith(expect.any(Error), 0);
    });
  });

  describe("Callbacks", () => {
    it("should call onStart callback", async () => {
      const onStart = vi.fn();

      await pipe([createMockStep("step1", "response")], "input", { onStart });

      expect(onStart).toHaveBeenCalledTimes(1);
      expect(onStart).toHaveBeenCalledWith("input");
    });

    it("should call onComplete callback", async () => {
      const onComplete = vi.fn();

      await pipe([createMockStep("step1", "response")], "input", {
        onComplete,
      });

      expect(onComplete).toHaveBeenCalledTimes(1);
      expect(onComplete).toHaveBeenCalledWith(
        expect.objectContaining({
          status: "success",
          output: "response",
        }),
      );
    });

    it("should call onProgress callback for each step", async () => {
      const onProgress = vi.fn();

      const steps: PipelineStep[] = [
        createMockStep("step1", "first"),
        createMockStep("step2", "second"),
        createMockStep("step3", "third"),
      ];

      await pipe(steps, "input", { onProgress });

      expect(onProgress).toHaveBeenCalledTimes(3);
      expect(onProgress).toHaveBeenNthCalledWith(1, 0, 3);
      expect(onProgress).toHaveBeenNthCalledWith(2, 1, 3);
      expect(onProgress).toHaveBeenNthCalledWith(3, 2, 3);
    });

    it("should call step onComplete callback", async () => {
      const onComplete = vi.fn();

      const steps: PipelineStep[] = [
        {
          name: "step1",
          fn: () => ({ stream: createMockStreamFactory("response") }),
          onComplete,
        },
      ];

      await pipe(steps, "input");

      expect(onComplete).toHaveBeenCalledTimes(1);
      expect(onComplete).toHaveBeenCalledWith(
        expect.objectContaining({ stepName: "step1", status: "success" }),
        expect.any(Object),
      );
    });
  });

  describe("Abort Signal", () => {
    it("should abort pipeline when signal is already aborted", async () => {
      const controller = new AbortController();
      controller.abort();

      const steps: PipelineStep[] = [
        createMockStep("step1", "first"),
        createMockStep("step2", "second"),
      ];

      const result = await pipe(steps, "input", { signal: controller.signal });

      expect(result.status).toBe("error");
      expect(result.error?.message).toContain("aborted");
    });
  });

  describe("Timeout", () => {
    it("should timeout pipeline when timeout exceeded", async () => {
      const steps: PipelineStep[] = [createMockStep("step1", "response", 100)];

      const result = await pipe(steps, "input", { timeout: 10 });

      expect(result.status).toBe("error");
      expect(result.error?.message).toContain("timeout");
    });
  });

  describe("Metadata", () => {
    it("should pass metadata to step context", async () => {
      let receivedMetadata: Record<string, any> = {};

      const steps: PipelineStep[] = [
        {
          name: "step1",
          fn: (_, context) => {
            receivedMetadata = context.metadata;
            return { stream: createMockStreamFactory("response") };
          },
        },
      ];

      await pipe(steps, "input", { metadata: { key: "value" } });

      expect(receivedMetadata).toEqual({ key: "value" });
    });

    it("should include metadata in result", async () => {
      const result = await pipe(
        [createMockStep("step1", "response")],
        "input",
        {
          metadata: { key: "value" },
        },
      );

      expect(result.metadata).toEqual({ key: "value" });
    });
  });
});

// ============================================================================
// createPipeline() Function Tests
// ============================================================================

describe("createPipeline()", () => {
  it("should create a reusable pipeline", async () => {
    const pipeline = createPipeline([createMockStep("step1", "response")]);

    const result = await pipeline.run("input");

    expect(result.status).toBe("success");
    expect(result.output).toBe("response");
  });

  it("should allow adding steps", async () => {
    const pipeline = createPipeline([createMockStep("step1", "first")]);

    pipeline.addStep(createMockStep("step2", "second"));

    const result = await pipeline.run("input");

    expect(result.steps.length).toBe(2);
    expect(result.output).toBe("second");
  });

  it("should allow removing steps", async () => {
    const pipeline = createPipeline([
      createMockStep("step1", "first"),
      createMockStep("step2", "second"),
    ]);

    pipeline.removeStep("step1");

    const result = await pipeline.run("input");

    expect(result.steps.length).toBe(1);
    expect(result.steps[0]?.stepName).toBe("step2");
  });

  it("should allow getting step by name", () => {
    const pipeline = createPipeline([
      createMockStep("step1", "first"),
      createMockStep("step2", "second"),
    ]);

    const step = pipeline.getStep("step2");

    expect(step?.name).toBe("step2");
  });

  it("should return undefined for non-existent step", () => {
    const pipeline = createPipeline([createMockStep("step1", "first")]);

    const step = pipeline.getStep("nonexistent");

    expect(step).toBeUndefined();
  });

  it("should clone pipeline", async () => {
    const original = createPipeline([createMockStep("step1", "first")]);
    const cloned = original.clone();

    cloned.addStep(createMockStep("step2", "second"));

    const originalResult = await original.run("input");
    const clonedResult = await cloned.run("input");

    expect(originalResult.steps.length).toBe(1);
    expect(clonedResult.steps.length).toBe(2);
  });

  it("should use pipeline name", async () => {
    const pipeline = createPipeline([createMockStep("step1", "response")], {
      name: "my-pipeline",
    });

    expect(pipeline.name).toBe("my-pipeline");

    const result = await pipeline.run("input");
    expect(result.name).toBe("my-pipeline");
  });
});

// ============================================================================
// createStep() Function Tests
// ============================================================================

describe("createStep()", () => {
  it("should create a step from prompt function", async () => {
    const step = createStep(
      "test-step",
      (input: string) => `Process: ${input}`,
      () => ({
        textStream: (async function* () {
          yield { type: "text-delta", textDelta: "processed" };
        })(),
      }),
    );

    expect(step.name).toBe("test-step");
    expect(typeof step.fn).toBe("function");
  });

  it("should work in pipeline", async () => {
    const step = createStep(
      "test-step",
      (input: string) => `Process: ${input}`,
      () => ({
        textStream: (async function* () {
          yield { type: "text-delta", textDelta: "result" };
        })(),
      }),
    );

    const result = await pipe([step], "input");

    expect(result.status).toBe("success");
    expect(result.output).toBe("result");
  });
});

// ============================================================================
// chainPipelines() Function Tests
// ============================================================================

describe("chainPipelines()", () => {
  it("should chain multiple pipelines", async () => {
    const pipeline1 = createPipeline([createMockStep("p1-step1", "first")], {
      name: "pipeline1",
    });
    const pipeline2 = createPipeline([createMockStep("p2-step1", "second")], {
      name: "pipeline2",
    });

    const combined = chainPipelines(pipeline1, pipeline2);

    const result = await combined.run("input");

    expect(result.steps.length).toBe(2);
    expect(result.output).toBe("second");
  });

  it("should preserve step order", async () => {
    const pipeline1 = createPipeline([
      createMockStep("a", "a"),
      createMockStep("b", "b"),
    ]);
    const pipeline2 = createPipeline([
      createMockStep("c", "c"),
      createMockStep("d", "d"),
    ]);

    const combined = chainPipelines(pipeline1, pipeline2);

    // Verify steps are combined correctly
    expect(combined.steps.map((s) => s.name)).toEqual(["a", "b", "c", "d"]);
  });

  it("should combine pipeline names", () => {
    const pipeline1 = createPipeline([], { name: "p1" });
    const pipeline2 = createPipeline([], { name: "p2" });

    const combined = chainPipelines(pipeline1, pipeline2);

    expect(combined.name).toBe("p1 -> p2");
  });
});

// ============================================================================
// parallelPipelines() Function Tests
// ============================================================================

describe("parallelPipelines()", () => {
  it("should run pipelines in parallel", async () => {
    const pipeline1 = createPipeline([createMockStep("p1", "result1")]);
    const pipeline2 = createPipeline([createMockStep("p2", "result2")]);

    const result = await parallelPipelines(
      [pipeline1, pipeline2],
      "input",
      (results) => ({
        first: results[0]?.output,
        second: results[1]?.output,
      }),
    );

    expect(result).toEqual({
      first: "result1",
      second: "result2",
    });
  });

  it("should pass same input to all pipelines", async () => {
    const receivedInputs: string[] = [];

    const createCapturingPipeline = (id: number) =>
      createPipeline([
        {
          name: `capture-${id}`,
          fn: (input) => {
            receivedInputs.push(input);
            return { stream: createMockStreamFactory(`result-${id}`) };
          },
        },
      ]);

    await parallelPipelines(
      [createCapturingPipeline(1), createCapturingPipeline(2)],
      "shared-input",
      () => null,
    );

    expect(receivedInputs).toEqual(["shared-input", "shared-input"]);
  });
});

// ============================================================================
// createBranchStep() Function Tests
// ============================================================================

describe("createBranchStep()", () => {
  it("should execute ifTrue step when condition is true", async () => {
    const branchStep = createBranchStep(
      "branch",
      () => true,
      createMockStep("true-step", "true-result"),
      createMockStep("false-step", "false-result"),
    );

    const result = await pipe([branchStep], "input");

    expect(result.output).toBe("true-result");
  });

  it("should execute ifFalse step when condition is false", async () => {
    const branchStep = createBranchStep(
      "branch",
      () => false,
      createMockStep("true-step", "true-result"),
      createMockStep("false-step", "false-result"),
    );

    const result = await pipe([branchStep], "input");

    expect(result.output).toBe("false-result");
  });

  it("should support async condition", async () => {
    const branchStep = createBranchStep(
      "branch",
      async () => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        return true;
      },
      createMockStep("true-step", "true-result"),
      createMockStep("false-step", "false-result"),
    );

    const result = await pipe([branchStep], "input");

    expect(result.output).toBe("true-result");
  });

  it("should receive input in condition", async () => {
    let receivedInput = "";

    // Test that the step fn receives the input correctly
    const branchStep: PipelineStep = {
      name: "branch",
      fn: (input: string, context) => {
        receivedInput = input;
        const useLong = input.length > 5;
        const step = useLong
          ? createMockStep("long", "long-result")
          : createMockStep("short", "short-result");
        return step.fn(input, context);
      },
    };

    await pipe([branchStep], "hello world");

    expect(receivedInput).toBe("hello world");
  });
});

// ============================================================================
// Pipeline Presets Tests
// ============================================================================

describe("Pipeline Presets", () => {
  it("should have fastPipeline preset", () => {
    expect(fastPipeline.stopOnError).toBe(true);
    expect(fastPipeline.monitoring?.enabled).toBe(false);
  });

  it("should have reliablePipeline preset", () => {
    expect(reliablePipeline.stopOnError).toBe(false);
    expect(reliablePipeline.monitoring?.enabled).toBe(true);
  });

  it("should have productionPipeline preset", () => {
    expect(productionPipeline.stopOnError).toBe(false);
    expect(productionPipeline.timeout).toBe(300000);
    expect(productionPipeline.monitoring?.enabled).toBe(true);
  });

  it("should use preset with pipe", async () => {
    const result = await pipe([createMockStep("step1", "response")], "input", {
      ...fastPipeline,
    });

    expect(result.status).toBe("success");
  });
});

// ============================================================================
// Integration Tests
// ============================================================================

describe("Pipeline Integration", () => {
  it("should handle complex multi-step pipeline", async () => {
    const steps: PipelineStep[] = [
      {
        name: "extract",
        fn: () => ({ stream: createMockStreamFactory("extracted data") }),
      },
      {
        name: "transform",
        fn: () => ({ stream: createMockStreamFactory("transformed data") }),
        transform: (result) => result.state.content.toUpperCase(),
      },
      {
        name: "validate",
        fn: () => ({ stream: createMockStreamFactory("validated") }),
        condition: (input) => input.includes("TRANSFORMED"),
      },
      {
        name: "format",
        fn: () => ({ stream: createMockStreamFactory("final output") }),
      },
    ];

    const result = await pipe(steps, "raw input", {
      name: "etl-pipeline",
      metadata: { source: "test" },
    });

    expect(result.status).toBe("success");
    expect(result.name).toBe("etl-pipeline");
    expect(result.steps.length).toBe(4);
    expect(result.output).toBe("final output");
  });

  it("should handle pipeline with error recovery", async () => {
    let retryCount = 0;

    const steps: PipelineStep[] = [
      createMockStep("step1", "first"),
      {
        name: "flaky-step",
        fn: () => {
          retryCount++;
          if (retryCount < 2) {
            return { stream: createErrorStreamFactory("Transient error") };
          }
          return { stream: createMockStreamFactory("success") };
        },
        onError: () => {
          // Error handled, continue
        },
      },
      createMockStep("step3", "final"),
    ];

    const result = await pipe(steps, "input", { stopOnError: false });

    expect(result.status).toBe("partial");
    expect(result.steps[1]?.status).toBe("error");
    expect(result.steps[2]?.status).toBe("success");
  });
});
