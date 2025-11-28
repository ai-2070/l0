// L0 - A Lightweight Runtime for Reliable LLM Apps
// Main entry point

// Core runtime
export { l0, getText, consumeStream } from "./runtime/l0";

// Structured output
export {
  structured,
  structuredObject,
  structuredArray,
  structuredStream,
} from "./structured";

export type {
  StructuredOptions,
  StructuredResult,
  StructuredState,
  StructuredTelemetry,
  CorrectionInfo,
  CorrectionType,
  AutoCorrectOptions,
  AutoCorrectResult,
} from "./types/structured";

export {
  minimalStructured,
  recommendedStructured,
  strictStructured,
} from "./types/structured";

// Auto-correction utilities
export {
  autoCorrectJSON,
  extractJSON,
  isValidJSON,
  describeJSONError,
  repairJSON,
  safeJSONParse,
} from "./utils/autoCorrect";

// Types
export type {
  L0Options,
  L0Result,
  L0State,
  L0Event,
  L0Telemetry,
  CategorizedNetworkError,
  L0Interceptor,
  RetryOptions,
  GuardrailRule,
  GuardrailViolation,
  GuardrailContext,
  GuardrailResult,
} from "./types";

// Guardrails
export {
  GuardrailEngine,
  createGuardrailEngine,
  checkGuardrails,
  jsonRule,
  strictJsonRule,
  markdownRule,
  latexRule,
  patternRule,
  customPatternRule,
  zeroOutputRule,
  minimalGuardrails,
  recommendedGuardrails,
  strictGuardrails,
  jsonOnlyGuardrails,
  markdownOnlyGuardrails,
  latexOnlyGuardrails,
} from "./guardrails";

// Retry presets
export { minimalRetry, recommendedRetry, strictRetry } from "./types/l0";

// Retry utilities
export {
  RetryManager,
  createRetryManager,
  isRetryableError,
  getErrorCategory,
} from "./runtime/retry";

// Drift detection
export {
  DriftDetector,
  createDriftDetector,
  checkDrift,
} from "./runtime/drift";

// Zero token detection
export {
  detectZeroToken,
  detectZeroTokenBeforeFirstMeaningful,
  detectInstantFinish,
  analyzeZeroToken,
} from "./runtime/zeroToken";

// Event normalization
export {
  normalizeStreamEvent,
  normalizeStreamEvents,
  createTokenEvent,
  createMessageEvent,
  createDoneEvent,
  createErrorEvent,
  filterEventsByType,
  extractTokens,
  reconstructText,
} from "./runtime/events";

// Monitoring and telemetry
export {
  L0Monitor,
  createMonitor,
  TelemetryExporter,
} from "./runtime/monitoring";

export type { MonitoringConfig } from "./runtime/monitoring";

// Interceptors
export {
  InterceptorManager,
  createInterceptorManager,
  loggingInterceptor,
  metadataInterceptor,
  authInterceptor,
  timingInterceptor,
  validationInterceptor,
  rateLimitInterceptor,
  cachingInterceptor,
  transformInterceptor,
  analyticsInterceptor,
} from "./runtime/interceptors";

export type { InterceptorContext } from "./runtime/interceptors";

// Parallel operations
export {
  parallel,
  parallelAll,
  sequential,
  batched,
  race,
  OperationPool,
  createPool,
} from "./runtime/parallel";

export type {
  ParallelOptions,
  ParallelResult,
  AggregatedTelemetry,
} from "./runtime/parallel";

// Format helpers
export {
  formatContext,
  formatMultipleContexts,
  formatDocument,
  formatInstructions,
  escapeDelimiters,
  unescapeDelimiters,
} from "./format/context";

export {
  formatMemory,
  createMemoryEntry,
  mergeMemory,
  filterMemoryByRole,
  getLastNEntries,
  calculateMemorySize,
  truncateMemory,
} from "./format/memory";

export {
  formatJsonOutput,
  formatStructuredOutput,
  formatOutputConstraints,
  createOutputFormatSection,
  extractJsonFromOutput,
  cleanOutput,
} from "./format/output";

export {
  formatTool,
  formatTools,
  createTool,
  createParameter,
  validateTool,
  formatFunctionArguments,
  parseFunctionCall,
} from "./format/tools";

export type {
  FormatContextOptions,
  FormatMemoryOptions,
  MemoryEntry,
  FormatJsonOutputOptions,
  ToolDefinition,
  ToolParameter,
  FormatToolOptions,
} from "./format";

// Utility helpers
export {
  normalizeNewlines,
  normalizeWhitespace,
  normalizeIndentation,
  normalizeForModel,
  dedent,
  indent,
  trimText,
  normalizeText,
} from "./utils/normalize";

export {
  repairJson,
  balanceBraces,
  balanceBrackets,
  removeTrailingCommas,
  repairMarkdownFences,
  repairLatexEnvironments,
  repairToolCallArguments,
  isValidJson,
  parseOrRepairJson,
  extractJson,
  ensureJson,
} from "./utils/repair";

export {
  isMeaningfulToken,
  hasMeaningfulContent,
  countMeaningfulTokens,
  extractMeaningfulTokens,
  detectRepeatedTokens,
  estimateTokenCount,
  endsAbruptly,
} from "./utils/tokens";

export {
  exponentialBackoff,
  linearBackoff,
  fixedBackoff,
  fullJitterBackoff,
  calculateBackoff,
  sleep,
  timeout,
  withTimeout,
  Timer,
} from "./utils/timers";

// Re-export commonly used types
export type {
  ErrorCategory,
  RetryReason,
  CategorizedError,
  ErrorTypeDelays,
} from "./types/retry";
export type { DriftResult, DriftType, DriftConfig } from "./runtime/drift";

// Network error detection utilities
export {
  NetworkErrorType,
  isNetworkError,
  analyzeNetworkError,
  isConnectionDropped,
  isFetchTypeError,
  isECONNRESET,
  isECONNREFUSED,
  isSSEAborted,
  isNoBytes,
  isPartialChunks,
  isRuntimeKilled,
  isBackgroundThrottle,
  isDNSError,
  isSSLError,
  isTimeoutError,
  isStreamInterrupted,
  describeNetworkError,
  suggestRetryDelay,
} from "./utils/errors";

export type { NetworkErrorAnalysis } from "./utils/errors";
