/**
 * Inference Worker
 * Runs in a separate process/thread and handles inference with L0 protection
 */

import { parentPort, workerData } from 'worker_threads';
import type {
  WorkerMessage,
  WorkerResponse,
  InferenceRequest,
  InferenceResult,
  WorkerError,
  ProgressUpdate,
} from './types';

// Dynamic imports for L0 and AI SDK (resolved at runtime)
let l0: typeof import('../l0').l0;
let streamText: typeof import('ai').streamText;
let openai: typeof import('@ai-sdk/openai').openai;

interface WorkerState {
  isProcessing: boolean;
  currentRequestId: string | null;
  abortController: AbortController | null;
}

const state: WorkerState = {
  isProcessing: false,
  currentRequestId: null,
  abortController: null,
};

/**
 * Initialize the worker with required dependencies
 */
async function initialize(): Promise<void> {
  try {
    // Dynamic imports to handle optional dependencies
    const l0Module = await import('../l0');
    l0 = l0Module.l0;

    const aiModule = await import('ai');
    streamText = aiModule.streamText;

    const openaiModule = await import('@ai-sdk/openai');
    openai = openaiModule.openai;

    sendResponse({
      type: 'ready',
      requestId: '',
      payload: {} as InferenceResult,
    });
  } catch (error) {
    sendResponse({
      type: 'error',
      requestId: '',
      payload: {
        code: 'INIT_FAILED',
        message: `Worker initialization failed: ${error}`,
        retryable: false,
      },
    });
  }
}

/**
 * Send response back to main process
 */
function sendResponse(response: WorkerResponse): void {
  if (parentPort) {
    parentPort.postMessage(response);
  }
}

/**
 * Process an inference request with L0 protection
 */
async function processRequest(request: InferenceRequest): Promise<void> {
  if (state.isProcessing) {
    sendResponse({
      type: 'error',
      requestId: request.id,
      payload: {
        code: 'WORKER_BUSY',
        message: 'Worker is already processing a request',
        retryable: true,
      },
    });
    return;
  }

  state.isProcessing = true;
  state.currentRequestId = request.id;
  state.abortController = new AbortController();

  const startTime = Date.now();
  let tokensReceived = 0;
  let content = '';

  try {
    const model = request.model || 'gpt-4o-mini';
    const fallbackModels = request.options?.fallbackModels || ['gpt-4o-mini'];

    const result = await l0({
      stream: () =>
        streamText({
          model: openai(model),
          prompt: request.prompt,
          maxTokens: request.options?.maxTokens,
          temperature: request.options?.temperature,
          system: request.options?.systemPrompt,
          abortSignal: state.abortController!.signal,
        }),

      // L0 retry configuration
      retry: {
        maxAttempts: request.options?.retryAttempts || 3,
        backoff: 'exponential',
        initialDelay: 1000,
      },

      // Fallback to other models on failure
      fallback: fallbackModels.map((fallbackModel) => () =>
        streamText({
          model: openai(fallbackModel),
          prompt: request.prompt,
          maxTokens: request.options?.maxTokens,
          temperature: request.options?.temperature,
          system: request.options?.systemPrompt,
          abortSignal: state.abortController!.signal,
        })
      ),

      // Timeout protection
      timeout: request.options?.timeout || 60000,

      // Stall detection
      stall: {
        timeout: 10000,
        action: 'retry',
      },

      // Enable continuation for resume support
      continuation: {
        enabled: true,
      },

      // Progress callback for checkpointing
      onToken: (token: string) => {
        tokensReceived++;
        content += token;

        // Send progress update every 10 tokens
        if (tokensReceived % 10 === 0) {
          sendResponse({
            type: 'progress',
            requestId: request.id,
            payload: {
              tokensReceived,
              partialContent: content,
              elapsed: Date.now() - startTime,
            } as ProgressUpdate,
          });
        }
      },
    });

    // Get final content
    const finalContent = await result.text;
    const duration = Date.now() - startTime;

    sendResponse({
      type: 'result',
      requestId: request.id,
      payload: {
        id: crypto.randomUUID(),
        requestId: request.id,
        content: finalContent,
        tokensUsed: tokensReceived,
        model: model,
        duration,
        completedAt: Date.now(),
      } as InferenceResult,
    });
  } catch (error) {
    const isAborted = state.abortController?.signal.aborted;

    sendResponse({
      type: 'error',
      requestId: request.id,
      payload: {
        code: isAborted ? 'CANCELLED' : 'INFERENCE_FAILED',
        message: error instanceof Error ? error.message : String(error),
        retryable: !isAborted,
        details: {
          tokensReceived,
          partialContent: content,
        },
      } as WorkerError,
    });
  } finally {
    state.isProcessing = false;
    state.currentRequestId = null;
    state.abortController = null;
  }
}

/**
 * Cancel the current request
 */
function cancelRequest(requestId: string): void {
  if (state.currentRequestId === requestId && state.abortController) {
    state.abortController.abort();
  }
}

/**
 * Handle incoming messages from main process
 */
function handleMessage(message: WorkerMessage): void {
  switch (message.type) {
    case 'request':
      processRequest(message.payload as InferenceRequest);
      break;

    case 'cancel':
      const { requestId } = message.payload as { requestId: string };
      cancelRequest(requestId);
      break;

    case 'shutdown':
      if (state.abortController) {
        state.abortController.abort();
      }
      process.exit(0);
      break;
  }
}

// Set up message handler
if (parentPort) {
  parentPort.on('message', handleMessage);
}

// Initialize worker
initialize();

// Export for testing
export { processRequest, cancelRequest, handleMessage };
