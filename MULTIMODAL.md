# Multimodal Support

L0 supports multimodal AI outputs including images, audio, video, and structured data. Build adapters for image generation models like Flux, Stable Diffusion, DALL-E, or audio models like TTS.

## Event Types

L0 extends the standard event system with multimodal-specific events:

| Event Type | Description                                            |
| ---------- | ------------------------------------------------------ |
| `token`    | Text token (standard LLM streaming)                    |
| `message`  | Structured message (tool calls, etc.)                  |
| `data`     | Multimodal content (images, audio, video, files, JSON) |
| `progress` | Progress updates for long-running operations           |
| `error`    | Error event                                            |
| `complete` | Stream completion                                      |

## Data Payload

The `data` event carries an `L0DataPayload`:

```typescript
interface L0DataPayload {
  contentType:
    | "text"
    | "image"
    | "audio"
    | "video"
    | "file"
    | "json"
    | "binary";
  mimeType?: string; // e.g., "image/png", "audio/mp3"
  base64?: string; // Base64-encoded data
  url?: string; // URL to content
  bytes?: Uint8Array; // Raw bytes
  json?: unknown; // Structured data
  metadata?: {
    width?: number; // Image/video dimensions
    height?: number;
    duration?: number; // Audio/video duration in seconds
    size?: number; // File size in bytes
    filename?: string;
    seed?: number; // Generation seed for reproducibility
    model?: string; // Model used
    [key: string]: unknown;
  };
}
```

## Progress Updates

The `progress` event carries an `L0Progress`:

```typescript
interface L0Progress {
  percent?: number; // 0-100
  step?: number; // Current step
  totalSteps?: number; // Total steps
  message?: string; // Status message
  eta?: number; // Estimated time remaining (ms)
}
```

## Building a Multimodal Adapter

### Using toMultimodalL0Events

The simplest way to build a multimodal adapter:

```typescript
import { toMultimodalL0Events, type L0Adapter } from "@ai2070/l0";

interface FluxChunk {
  type: "progress" | "image";
  percent?: number;
  status?: string;
  image?: string;
  width?: number;
  height?: number;
  seed?: number;
}

type FluxStream = AsyncIterable<FluxChunk>;

const fluxAdapter: L0Adapter<FluxStream> = {
  name: "flux",

  detect(input): input is FluxStream {
    return !!input && typeof input === "object" && "__flux" in input;
  },

  wrap(stream) {
    return toMultimodalL0Events(stream, {
      extractProgress: (chunk) => {
        if (chunk.type === "progress") {
          return { percent: chunk.percent, message: chunk.status };
        }
        return null;
      },
      extractData: (chunk) => {
        if (chunk.type === "image" && chunk.image) {
          return {
            contentType: "image",
            mimeType: "image/png",
            base64: chunk.image,
            metadata: {
              width: chunk.width,
              height: chunk.height,
              seed: chunk.seed,
            },
          };
        }
        return null;
      },
    });
  },
};
```

### Using Helper Functions

For more control, use the individual helper functions:

```typescript
import {
  createAdapterProgressEvent,
  createImageEvent,
  createAdapterDoneEvent,
  createAdapterErrorEvent,
  type L0Adapter,
  type L0Event,
} from "@ai2070/l0";

const fluxAdapter: L0Adapter<FluxStream> = {
  name: "flux",

  async *wrap(stream): AsyncGenerator<L0Event> {
    try {
      for await (const chunk of stream) {
        if (chunk.type === "progress") {
          yield createAdapterProgressEvent({
            percent: chunk.percent,
            message: chunk.status,
          });
        } else if (chunk.type === "image") {
          yield createImageEvent({
            base64: chunk.image,
            width: chunk.width,
            height: chunk.height,
            seed: chunk.seed,
            model: "flux-schnell",
          });
        }
      }
      yield createAdapterDoneEvent();
    } catch (err) {
      yield createAdapterErrorEvent(err);
    }
  },
};
```

## Helper Functions

| Function                                 | Description                               |
| ---------------------------------------- | ----------------------------------------- |
| `toMultimodalL0Events(stream, handlers)` | Convert multimodal stream with extractors |
| `createAdapterDataEvent(payload)`        | Create data event with full payload       |
| `createAdapterProgressEvent(progress)`   | Create progress event                     |
| `createImageEvent(options)`              | Convenience for image data                |
| `createAudioEvent(options)`              | Convenience for audio data                |
| `createJsonDataEvent(data, metadata?)`   | Convenience for JSON data                 |

## Consuming Multimodal Streams

```typescript
import { l0 } from "@ai2070/l0";

const result = await l0({
  stream: () => fluxGenerate({ prompt: "A cat in space" }),
  adapter: fluxAdapter,
});

for await (const event of result.stream) {
  switch (event.type) {
    case "progress":
      console.log(`Progress: ${event.progress?.percent}%`);
      break;
    case "data":
      if (event.data?.contentType === "image") {
        // Save or display the image
        const imageData = event.data.base64;
        const { width, height } = event.data.metadata ?? {};
        console.log(`Generated ${width}x${height} image`);
      }
      break;
    case "complete":
      console.log("Generation complete");
      break;
  }
}

// Access all generated data
console.log(`Total images: ${result.state.dataOutputs.length}`);
```

## State Tracking

L0 automatically tracks multimodal outputs in the state:

```typescript
interface L0State {
  // ... existing fields ...

  /** All data payloads received */
  dataOutputs: L0DataPayload[];

  /** Last progress update */
  lastProgress?: L0Progress;
}
```

## Important Notes

### Zero Token Detection

For streams that only produce `data` or `progress` events (no text tokens), disable zero token detection:

```typescript
const result = await l0({
  stream: () => imageGenerator.generate(prompt),
  adapter: imageAdapter,
  detectZeroTokens: false, // Required for non-text streams
});
```

### Checkpoint Continuation

`continueFromLastKnownGoodToken` only works with text content. It has no effect on data-only streams since there's no text to checkpoint. For multimodal streams that include text, only the text portion will be checkpointed and resumed.

## Complete Example: Flux Image Generation

```typescript
import { l0, toMultimodalL0Events, type L0Adapter } from "@ai2070/l0";

// Define the Flux stream types
interface FluxChunk {
  type: "queued" | "processing" | "completed" | "error";
  progress?: number;
  image?: { url: string; width: number; height: number };
  seed?: number;
  error?: string;
}

type FluxStream = AsyncIterable<FluxChunk> & { __flux: true };

// Create the adapter
const fluxAdapter: L0Adapter<FluxStream> = {
  name: "flux",
  detect: (input): input is FluxStream =>
    !!input && typeof input === "object" && "__flux" in input,
  wrap: (stream) =>
    toMultimodalL0Events(stream, {
      extractProgress: (chunk) => {
        if (chunk.type === "queued") return { percent: 0, message: "Queued" };
        if (chunk.type === "processing")
          return { percent: chunk.progress ?? 50, message: "Generating" };
        return null;
      },
      extractData: (chunk) => {
        if (chunk.type === "completed" && chunk.image) {
          return {
            contentType: "image",
            mimeType: "image/png",
            url: chunk.image.url,
            metadata: {
              width: chunk.image.width,
              height: chunk.image.height,
              seed: chunk.seed,
              model: "flux-1.1-pro",
            },
          };
        }
        return null;
      },
    }),
};

// Use with L0
async function generateImage(prompt: string) {
  const result = await l0({
    stream: () => fluxAPI.generate({ prompt }),
    adapter: fluxAdapter,
    timeout: {
      initialToken: 30000, // 30s for queue
      interToken: 60000, // 60s between updates
    },
    retry: { attempts: 2 },
  });

  for await (const event of result.stream) {
    if (event.type === "progress") {
      updateProgressBar(event.progress?.percent ?? 0);
    }
  }

  return result.state.dataOutputs[0]; // First generated image
}
```

## See Also

- [CUSTOM_ADAPTERS.md](./CUSTOM_ADAPTERS.md) - Full adapter development guide
- [API.md](./API.md) - Complete API reference
