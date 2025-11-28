// Retry types
export interface RetryConfig {
  maxAttempts: number;
  baseDelay: number;
  maxDelay?: number;
}

export interface RetryState {
  attempt: number;
  lastError?: Error;
}
