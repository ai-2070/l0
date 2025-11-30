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
export * from "./openai";
export * from "./anthropic";
