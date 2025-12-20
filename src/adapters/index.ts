// L0 SDK Adapters
// Adapters for using various LLM SDKs with L0

// Adapter registry (BYOA - Bring Your Own Adapter)
export {
  registerAdapter,
  unregisterAdapter,
  getAdapter,
  getRegisteredStreamAdapters,
  clearAdapters,
  detectAdapter,
  hasMatchingAdapter,
  DEFAULT_ADAPTER_PRIORITY,
} from "./registry";

// Adapter helpers for building custom adapters
export {
  toL0Events,
  toL0EventsWithMessages,
  createAdapterTokenEvent,
  createAdapterDoneEvent,
  createAdapterErrorEvent,
  createAdapterMessageEvent,
} from "./helpers";

// Built-in adapters
// Note: Using explicit exports to avoid forcing SDK imports at runtime.
// Users who don't use a specific adapter won't need that SDK installed.
export {
  wrapOpenAIStream,
  openaiAdapter,
  openaiStream,
  openaiText,
  openaiJSON,
  openaiWithTools,
  isOpenAIChunk,
  isOpenAIStream,
  extractOpenAIText,
} from "./openai";

export {
  wrapAnthropicStream,
  anthropicAdapter,
  anthropicStream,
  anthropicText,
  isAnthropicStream,
  isAnthropicStreamEvent,
} from "./anthropic";

export {
  wrapVercelAIStream,
  vercelAIAdapter,
  isVercelAIStream,
} from "./vercel-ai";

export {
  wrapVercelAIObjectStream,
  vercelAIObjectAdapter,
  isVercelAIObjectStream,
} from "./vercel-ai-object";

export type {
  VercelStreamObjectResult,
  VercelAIObjectAdapterOptions,
} from "./vercel-ai-object";
