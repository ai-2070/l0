// Interceptor system for L0 - preprocessing and postprocessing hooks

import type { L0Options, L0Result, L0Interceptor } from "../types/l0";

/**
 * Interceptor execution context
 */
export interface InterceptorContext {
  /**
   * Interceptor name
   */
  name: string;

  /**
   * Execution phase
   */
  phase: "before" | "after" | "error";

  /**
   * Timestamp
   */
  timestamp: number;

  /**
   * Duration in milliseconds (for after/error phases)
   */
  duration?: number;
}

/**
 * Interceptor manager for executing before/after hooks
 */
export class InterceptorManager {
  private interceptors: L0Interceptor[];
  private contexts: InterceptorContext[] = [];

  constructor(interceptors: L0Interceptor[] = []) {
    this.interceptors = interceptors;
  }

  /**
   * Execute all "before" hooks in order
   * Each interceptor can modify the options
   */
  async executeBefore(options: L0Options): Promise<L0Options> {
    let currentOptions = options;

    for (const interceptor of this.interceptors) {
      if (interceptor.before) {
        const startTime = Date.now();
        const context: InterceptorContext = {
          name: interceptor.name || "anonymous",
          phase: "before",
          timestamp: startTime,
        };

        try {
          currentOptions = await interceptor.before(currentOptions);
          context.duration = Date.now() - startTime;
          this.contexts.push(context);
        } catch (error) {
          context.duration = Date.now() - startTime;
          this.contexts.push(context);
          throw new Error(
            `Interceptor "${context.name}" before hook failed: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }
    }

    return currentOptions;
  }

  /**
   * Execute all "after" hooks in order
   * Each interceptor can inspect/modify the result
   */
  async executeAfter(result: L0Result): Promise<L0Result> {
    let currentResult = result;

    for (const interceptor of this.interceptors) {
      if (interceptor.after) {
        const startTime = Date.now();
        const context: InterceptorContext = {
          name: interceptor.name || "anonymous",
          phase: "after",
          timestamp: startTime,
        };

        try {
          currentResult = await interceptor.after(currentResult);
          context.duration = Date.now() - startTime;
          this.contexts.push(context);
        } catch (error) {
          context.duration = Date.now() - startTime;
          this.contexts.push(context);
          throw new Error(
            `Interceptor "${context.name}" after hook failed: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }
    }

    return currentResult;
  }

  /**
   * Execute all "onError" hooks
   * Error hooks don't modify anything, just notify
   */
  async executeError(error: Error, options: L0Options): Promise<void> {
    for (const interceptor of this.interceptors) {
      if (interceptor.onError) {
        const startTime = Date.now();
        const context: InterceptorContext = {
          name: interceptor.name || "anonymous",
          phase: "error",
          timestamp: startTime,
        };

        try {
          await interceptor.onError(error, options);
          context.duration = Date.now() - startTime;
          this.contexts.push(context);
        } catch (err) {
          // Error in error handler - log but don't throw
          context.duration = Date.now() - startTime;
          this.contexts.push(context);
          console.error(
            `Interceptor "${context.name}" error hook failed:`,
            err,
          );
        }
      }
    }
  }

  /**
   * Get execution contexts for debugging
   */
  getContexts(): InterceptorContext[] {
    return [...this.contexts];
  }

  /**
   * Reset contexts
   */
  reset(): void {
    this.contexts = [];
  }
}

/**
 * Built-in interceptors
 */

/**
 * Logging interceptor - logs all L0 operations
 */
export function loggingInterceptor(
  logger: {
    info: (message: string, data?: any) => void;
    error: (message: string, data?: any) => void;
  } = console,
): L0Interceptor {
  return {
    name: "logging",
    before: async (options) => {
      logger.info("L0 execution starting", {
        hasGuardrails: !!options.guardrails?.length,
        hasRetry: !!options.retry,
        hasMonitoring: options.monitoring?.enabled,
      });
      return options;
    },
    after: async (result) => {
      logger.info("L0 execution completed", {
        completed: result.state.completed,
        tokens: result.state.tokenCount,
        retries: result.state.retryAttempts,
        networkRetries: result.state.networkRetries,
        violations: result.state.violations.length,
      });
      return result;
    },
    onError: async (error) => {
      logger.error("L0 execution failed", {
        error: error.message,
      });
    },
  };
}

/**
 * Metadata injection interceptor - adds metadata to monitoring
 */
export function metadataInterceptor(
  metadata: Record<string, any>,
): L0Interceptor {
  return {
    name: "metadata",
    before: async (options) => {
      return {
        ...options,
        monitoring: {
          ...options.monitoring,
          enabled: options.monitoring?.enabled ?? true,
          metadata: {
            ...options.monitoring?.metadata,
            ...metadata,
          },
        },
      };
    },
  };
}

/**
 * Authentication interceptor - adds auth headers or tokens
 */
export function authInterceptor(
  getAuth: () => Promise<Record<string, any>> | Record<string, any>,
): L0Interceptor {
  return {
    name: "auth",
    before: async (options) => {
      const auth = await getAuth();
      return {
        ...options,
        monitoring: {
          ...options.monitoring,
          metadata: {
            ...options.monitoring?.metadata,
            auth: auth,
          },
        },
      };
    },
  };
}

/**
 * Timing interceptor - adds detailed timing information
 */
export function timingInterceptor(): L0Interceptor {
  const startTimes = new Map<string, number>();

  return {
    name: "timing",
    before: async (options) => {
      const sessionId = `session_${Date.now()}`;
      startTimes.set(sessionId, Date.now());
      return {
        ...options,
        monitoring: {
          ...options.monitoring,
          enabled: true,
          includeTimings: true,
          metadata: {
            ...options.monitoring?.metadata,
            sessionId,
          },
        },
      };
    },
    after: async (result) => {
      const sessionId = result.telemetry?.sessionId;
      if (sessionId && startTimes.has(sessionId)) {
        // Duration tracked for potential future use
        startTimes.delete(sessionId);
      }
      return result;
    },
  };
}

/**
 * Validation interceptor - validates output against rules
 */
export function validationInterceptor(
  validate: (content: string) => boolean | Promise<boolean>,
  onInvalid?: (content: string) => void,
): L0Interceptor {
  return {
    name: "validation",
    after: async (result) => {
      const isValid = await validate(result.state.content);
      if (!isValid) {
        if (onInvalid) {
          onInvalid(result.state.content);
        }
        throw new Error("Output validation failed");
      }
      return result;
    },
  };
}

/**
 * Rate limiting interceptor - throttles requests
 */
export function rateLimitInterceptor(
  maxRequests: number,
  windowMs: number,
): L0Interceptor {
  const requests: number[] = [];

  return {
    name: "rate-limit",
    before: async (options) => {
      const now = Date.now();
      // Remove old requests outside the window
      while (requests.length > 0 && requests[0]! < now - windowMs) {
        requests.shift();
      }

      // Check if we're over the limit
      if (requests.length >= maxRequests) {
        const oldestRequest = requests[0] ?? now;
        const waitTime = windowMs - (now - oldestRequest);
        throw new Error(
          `Rate limit exceeded. Wait ${waitTime}ms before retrying.`,
        );
      }

      // Add current request
      requests.push(now);
      return options;
    },
  };
}

/**
 * Caching interceptor - caches results based on prompt hash
 */
export function cachingInterceptor(
  cache: Map<string, L0Result>,
  getCacheKey: (options: L0Options) => string,
): L0Interceptor {
  return {
    name: "caching",
    before: async (options) => {
      const key = getCacheKey(options);
      if (cache.has(key)) {
        // Return cached result wrapped in a promise that resolves immediately
        const cached = cache.get(key)!;
        throw new CachedResultError(cached);
      }
      return options;
    },
    after: async (result) => {
      // Store result in cache (need to get key somehow - store in metadata)
      return result;
    },
  };
}

/**
 * Error to signal cached result is available
 */
class CachedResultError extends Error {
  constructor(public result: L0Result) {
    super("Cached result available");
    this.name = "CachedResultError";
  }
}

/**
 * Content transformation interceptor - post-processes output
 */
export function transformInterceptor(
  transform: (content: string) => string | Promise<string>,
): L0Interceptor {
  return {
    name: "transform",
    after: async (result) => {
      const transformed = await transform(result.state.content);
      return {
        ...result,
        state: {
          ...result.state,
          content: transformed,
        },
      };
    },
  };
}

/**
 * Analytics interceptor - sends execution data to analytics
 */
export function analyticsInterceptor(
  track: (event: string, data: any) => void | Promise<void>,
): L0Interceptor {
  let startTime: number;

  return {
    name: "analytics",
    before: async (options) => {
      startTime = Date.now();
      await track("l0_started", {
        timestamp: startTime,
        hasGuardrails: !!options.guardrails?.length,
      });
      return options;
    },
    after: async (result) => {
      await track("l0_completed", {
        duration: Date.now() - startTime,
        tokens: result.state.tokenCount,
        retries: result.state.retryAttempts,
        completed: result.state.completed,
      });
      return result;
    },
    onError: async (error) => {
      await track("l0_failed", {
        duration: Date.now() - startTime,
        error: error.message,
      });
    },
  };
}

/**
 * Create an interceptor manager
 */
export function createInterceptorManager(
  interceptors: L0Interceptor[] = [],
): InterceptorManager {
  return new InterceptorManager(interceptors);
}
