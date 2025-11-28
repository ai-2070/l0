// Basic L0 Usage Example
// This example demonstrates how to use L0 for reliable LLM streaming

import { l0, recommendedGuardrails, recommendedRetry } from '../src/index';

// Example 1: Basic streaming with guardrails
async function basicExample() {
  console.log('=== Basic Example ===\n');

  const result = await l0({
    stream: async () => {
      // Mock stream function - replace with actual streamText() call
      // Example with Vercel AI SDK:
      // return streamText({
      //   model: openai('gpt-4o-mini'),
      //   prompt: 'Generate a JSON object with name and age'
      // });

      return mockStream('{"name": "Alice", "age": 30}');
    },
    guardrails: recommendedGuardrails,
    retry: recommendedRetry,
  });

  // Consume the stream
  for await (const event of result.stream) {
    if (event.type === 'token') {
      process.stdout.write(event.value || '');
    } else if (event.type === 'done') {
      console.log('\n✓ Stream completed');
    } else if (event.type === 'error') {
      console.error('\n✗ Error:', event.error?.message);
    }
  }

  console.log('\nFinal state:', {
    tokens: result.state.tokenCount,
    retries: result.state.retryAttempts,
    completed: result.state.completed,
  });
}

// Example 2: JSON-only output with strict validation
async function jsonExample() {
  console.log('\n=== JSON Example ===\n');

  const result = await l0({
    stream: async () => {
      return mockStream('{"status": "success", "data": [1, 2, 3]}');
    },
    guardrails: [
      // Use JSON-specific guardrails
      ...recommendedGuardrails.filter(g => g.name.includes('json')),
    ],
    retry: {
      attempts: 3,
      backoff: 'exponential',
      baseDelay: 500,
      retryOn: ['guardrail_violation', 'malformed'],
    },
    detectZeroTokens: true,
  });

  let content = '';
  for await (const event of result.stream) {
    if (event.type === 'token' && event.value) {
      content += event.value;
    }
  }

  console.log('Output:', content);

  // Parse and validate JSON
  try {
    const parsed = JSON.parse(content);
    console.log('✓ Valid JSON:', parsed);
  } catch (err) {
    console.error('✗ Invalid JSON');
  }
}

// Example 3: With callbacks and monitoring
async function monitoringExample() {
  console.log('\n=== Monitoring Example ===\n');

  const result = await l0({
    stream: async () => {
      return mockStream('This is a test response with proper formatting.');
    },
    guardrails: recommendedGuardrails,
    retry: recommendedRetry,

    // Event callback
    onEvent: (event) => {
      if (event.type === 'token') {
        // Track token rate, etc.
      }
    },

    // Violation callback
    onViolation: (violation) => {
      console.warn(`⚠ Guardrail violation: ${violation.rule} - ${violation.message}`);
    },

    // Retry callback
    onRetry: (attempt, reason) => {
      console.log(`↻ Retry attempt ${attempt}: ${reason}`);
    },
  });

  for await (const event of result.stream) {
    if (event.type === 'token') {
      process.stdout.write(event.value || '');
    }
  }

  console.log('\n✓ Completed');
}

// Example 4: With drift detection
async function driftDetectionExample() {
  console.log('\n=== Drift Detection Example ===\n');

  const result = await l0({
    stream: async () => {
      return mockStream('I will help you with that. As an AI assistant, I should mention...');
    },
    guardrails: recommendedGuardrails,
    retry: recommendedRetry,
    detectDrift: true, // Enable drift detection
  });

  for await (const event of result.stream) {
    if (event.type === 'token') {
      process.stdout.write(event.value || '');
    }
  }

  if (result.state.driftDetected) {
    console.log('\n⚠ Drift detected in output');
  } else {
    console.log('\n✓ No drift detected');
  }
}

// Example 5: With timeout handling
async function timeoutExample() {
  console.log('\n=== Timeout Example ===\n');

  const result = await l0({
    stream: async () => {
      return mockSlowStream('Slow response...');
    },
    guardrails: recommendedGuardrails,
    retry: recommendedRetry,
    timeout: {
      initialToken: 2000,  // 2 seconds to first token
      interToken: 5000,    // 5 seconds between tokens
    },
  });

  try {
    for await (const event of result.stream) {
      if (event.type === 'token') {
        process.stdout.write(event.value || '');
      }
    }
    console.log('\n✓ Completed within timeout');
  } catch (err) {
    console.error('\n✗ Timeout error:', (err as Error).message);
  }
}

// Example 6: Custom guardrails
async function customGuardrailsExample() {
  console.log('\n=== Custom Guardrails Example ===\n');

  const result = await l0({
    stream: async () => {
      return mockStream('Response with custom validation.');
    },
    guardrails: [
      // Custom guardrail
      {
        name: 'custom-length',
        description: 'Ensure minimum length',
        check: (context) => {
          if (context.isComplete && context.content.length < 10) {
            return [{
              rule: 'custom-length',
              message: 'Output too short',
              severity: 'error' as const,
              recoverable: true,
            }];
          }
          return [];
        },
      },
      ...recommendedGuardrails,
    ],
    retry: recommendedRetry,
  });

  for await (const event of result.stream) {
    if (event.type === 'token') {
      process.stdout.write(event.value || '');
    }
  }

  console.log('\n✓ Custom guardrails passed');
}

// Mock stream helper
async function* mockStream(text: string) {
  // Simulate streaming by yielding character by character
  for (const char of text) {
    await sleep(10); // Simulate network delay
    yield {
      type: 'text-delta',
      textDelta: char,
    };
  }
  yield { type: 'finish' };
}

// Mock slow stream helper
async function* mockSlowStream(text: string) {
  await sleep(3000); // Simulate slow first token
  for (const char of text) {
    await sleep(100);
    yield {
      type: 'text-delta',
      textDelta: char,
    };
  }
  yield { type: 'finish' };
}

// Helper
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Run all examples
async function runExamples() {
  try {
    await basicExample();
    await jsonExample();
    await monitoringExample();
    await driftDetectionExample();
    await timeoutExample();
    await customGuardrailsExample();
  } catch (err) {
    console.error('Error running examples:', err);
  }
}

// Uncomment to run:
// runExamples();

export {
  basicExample,
  jsonExample,
  monitoringExample,
  driftDetectionExample,
  timeoutExample,
  customGuardrailsExample,
};
