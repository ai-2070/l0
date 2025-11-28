// Backoff helpers
export function exponentialBackoff(attempt: number, baseDelay: number = 1000): number {
  // TODO: Implement exponential backoff
  return baseDelay * Math.pow(2, attempt);
}
