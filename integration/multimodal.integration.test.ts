// Multimodal Integration Tests (Audio, Voice, Video)
// Run: OPENAI_API_KEY=sk-... npm run test:integration
//
// These tests demonstrate L0's multimodal support with OpenAI's APIs:
// - Audio transcription (Whisper)
// - Text-to-speech (TTS)
// - Image generation (DALL-E)
//
// Note: Video generation would follow the same pattern when available.

import { describe, it, expect } from "vitest";
import { describeIf, hasOpenAI, LLM_TIMEOUT } from "./setup";
import {
  l0,
  toMultimodalL0Events,
  createImageEvent,
  createAudioEvent,
  createAdapterProgressEvent,
  createAdapterDoneEvent,
  parallel,
  race,
  pipe,
  createInMemoryEventStore,
  createEventRecorder,
  createEventReplayer,
  type L0Adapter,
  type L0Event,
  type L0DataPayload,
} from "../src/index";
import OpenAI from "openai";

const client = hasOpenAI ? new OpenAI() : null;

// Extended timeout for multimodal operations (image generation can be slow)
const MULTIMODAL_TIMEOUT = 60000;

describeIf(hasOpenAI)("Multimodal Integration", () => {
  describe("Image Generation (DALL-E)", () => {
    // Input type for DALL-E adapter that includes model info
    interface DalleInput {
      response: Promise<OpenAI.Images.ImagesResponse>;
      model: string;
    }

    // Adapter for DALL-E image generation
    const dalleAdapter: L0Adapter<DalleInput> = {
      name: "dalle",

      detect(input): input is DalleInput {
        return false; // Always use explicitly
      },

      async *wrap(input: DalleInput): AsyncGenerator<L0Event> {
        yield createAdapterProgressEvent({
          percent: 0,
          message: "Generating image...",
        });

        const response = await input.response;

        for (const image of response.data!) {
          if (image.url) {
            yield createImageEvent({
              url: image.url,
              model: input.model,
            });
          } else if (image.b64_json) {
            yield createImageEvent({
              base64: image.b64_json,
              mimeType: "image/png",
              model: input.model,
            });
          }
        }

        yield createAdapterProgressEvent({ percent: 100, message: "Complete" });
        yield createAdapterDoneEvent();
      },
    };

    it(
      "should generate image with DALL-E adapter",
      async () => {
        const model = "dall-e-2"; // Use DALL-E 2 for faster/cheaper tests
        const result = await l0({
          stream: () => ({
            response: client!.images.generate({
              model,
              prompt: "A simple red circle on white background",
              n: 1,
              size: "256x256",
            }),
            model,
          }),
          adapter: dalleAdapter,
          detectZeroTokens: false, // Image generation has no text tokens
        });

        const events: L0Event[] = [];
        for await (const event of result.stream) {
          events.push(event);
        }

        // Should have progress events
        const progressEvents = events.filter((e) => e.type === "progress");
        expect(progressEvents.length).toBeGreaterThan(0);

        // Should have data event with image
        const dataEvents = events.filter((e) => e.type === "data");
        expect(dataEvents.length).toBe(1);
        expect(dataEvents[0].data?.contentType).toBe("image");
        expect(
          dataEvents[0].data?.url || dataEvents[0].data?.base64,
        ).toBeTruthy();

        // State should track the image
        expect(result.state.dataOutputs).toHaveLength(1);
        expect(result.state.dataOutputs[0].contentType).toBe("image");
      },
      MULTIMODAL_TIMEOUT,
    );
  });

  describe("Text-to-Speech (TTS)", () => {
    // Adapter for OpenAI TTS
    const ttsAdapter: L0Adapter = {
      name: "openai-tts",

      detect(input): input is any {
        return false; // Always use explicitly
      },

      async *wrap(responsePromise: Promise<Response>): AsyncGenerator<L0Event> {
        yield createAdapterProgressEvent({
          percent: 0,
          message: "Generating speech...",
        });

        const response = await responsePromise;
        const arrayBuffer = await response.arrayBuffer();
        const base64 = Buffer.from(arrayBuffer).toString("base64");

        yield createAudioEvent({
          base64,
          mimeType: "audio/mpeg",
          model: "tts-1",
        });

        yield createAdapterProgressEvent({ percent: 100, message: "Complete" });
        yield createAdapterDoneEvent();
      },
    };

    it(
      "should generate audio with TTS adapter",
      async () => {
        const result = await l0({
          stream: () =>
            client!.audio.speech.create({
              model: "tts-1",
              voice: "alloy",
              input: "Hello, this is a test of L0 multimodal support.",
            }),
          adapter: ttsAdapter,
          detectZeroTokens: false, // TTS has no text tokens
        });

        const events: L0Event[] = [];
        for await (const event of result.stream) {
          events.push(event);
        }

        // Should have progress events
        const progressEvents = events.filter((e) => e.type === "progress");
        expect(progressEvents.length).toBeGreaterThan(0);

        // Should have data event with audio
        const dataEvents = events.filter((e) => e.type === "data");
        expect(dataEvents.length).toBe(1);
        expect(dataEvents[0].data?.contentType).toBe("audio");
        expect(dataEvents[0].data?.mimeType).toBe("audio/mpeg");
        expect(dataEvents[0].data?.base64).toBeTruthy();

        // State should track the audio
        expect(result.state.dataOutputs).toHaveLength(1);
        expect(result.state.dataOutputs[0].contentType).toBe("audio");

        // Verify it's actual audio data (MP3 starts with ID3 or 0xFF)
        const audioBytes = Buffer.from(
          result.state.dataOutputs[0].base64!,
          "base64",
        );
        expect(audioBytes.length).toBeGreaterThan(1000); // Should be substantial
      },
      MULTIMODAL_TIMEOUT,
    );
  });

  describe("Audio Transcription (Whisper)", () => {
    // Adapter for Whisper transcription with streaming simulation
    const whisperAdapter: L0Adapter = {
      name: "whisper",

      detect(input): input is any {
        return false; // Always use explicitly
      },

      async *wrap(
        responsePromise: Promise<OpenAI.Audio.Transcription>,
      ): AsyncGenerator<L0Event> {
        yield createAdapterProgressEvent({
          percent: 0,
          message: "Transcribing audio...",
        });

        const response = await responsePromise;

        // Emit transcription as tokens (simulating streaming)
        const words = response.text.split(" ");
        for (let i = 0; i < words.length; i++) {
          yield {
            type: "token",
            value: (i > 0 ? " " : "") + words[i],
            timestamp: Date.now(),
          };

          // Update progress
          yield createAdapterProgressEvent({
            percent: Math.round(((i + 1) / words.length) * 100),
            message: "Transcribing...",
          });
        }

        yield createAdapterDoneEvent();
      },
    };

    it(
      "should transcribe audio with Whisper adapter",
      async () => {
        // First generate some audio to transcribe
        const ttsResponse = await client!.audio.speech.create({
          model: "tts-1",
          voice: "alloy",
          input: "Hello world, this is a test.",
        });

        const audioBuffer = Buffer.from(await ttsResponse.arrayBuffer());

        // Create a File-like object for the API
        const audioFile = new File([audioBuffer], "test.mp3", {
          type: "audio/mpeg",
        });

        const result = await l0({
          stream: () =>
            client!.audio.transcriptions.create({
              model: "whisper-1",
              file: audioFile,
            }),
          adapter: whisperAdapter,
        });

        const events: L0Event[] = [];
        for await (const event of result.stream) {
          events.push(event);
        }

        // Should have token events (transcription text)
        const tokenEvents = events.filter((e) => e.type === "token");
        expect(tokenEvents.length).toBeGreaterThan(0);

        // Should have progress events
        const progressEvents = events.filter((e) => e.type === "progress");
        expect(progressEvents.length).toBeGreaterThan(0);

        // State should have the transcription
        expect(result.state.content.toLowerCase()).toContain("hello");
        expect(result.state.tokenCount).toBeGreaterThan(0);
      },
      MULTIMODAL_TIMEOUT,
    );
  });

  describe("Video Generation (Mock)", () => {
    // Mock video generation adapter (OpenAI doesn't have video yet)
    // This demonstrates the pattern for when video APIs become available
    interface MockVideoChunk {
      type: "queued" | "processing" | "completed";
      progress?: number;
      video?: { url: string; duration: number };
    }

    type MockVideoStream = AsyncIterable<MockVideoChunk> & {
      __mockVideo: true;
    };

    const mockVideoAdapter: L0Adapter<MockVideoStream> = {
      name: "mock-video",

      detect(input): input is MockVideoStream {
        return !!input && typeof input === "object" && "__mockVideo" in input;
      },

      wrap(stream) {
        return toMultimodalL0Events(stream, {
          extractProgress: (chunk) => {
            if (chunk.type === "queued") {
              return { percent: 0, message: "Queued" };
            }
            if (chunk.type === "processing") {
              return {
                percent: chunk.progress ?? 50,
                message: "Generating video",
              };
            }
            return null;
          },
          extractData: (chunk) => {
            if (chunk.type === "completed" && chunk.video) {
              return {
                contentType: "video",
                mimeType: "video/mp4",
                url: chunk.video.url,
                metadata: {
                  duration: chunk.video.duration,
                  model: "mock-video-gen",
                },
              };
            }
            return null;
          },
        });
      },
    };

    // Helper to create mock video stream
    function createMockVideoStream(prompt: string): MockVideoStream {
      const stream = {
        __mockVideo: true as const,
        async *[Symbol.asyncIterator](): AsyncGenerator<MockVideoChunk> {
          yield { type: "queued" };
          await new Promise((r) => setTimeout(r, 100));

          for (let i = 1; i <= 5; i++) {
            yield { type: "processing", progress: i * 20 };
            await new Promise((r) => setTimeout(r, 50));
          }

          yield {
            type: "completed",
            video: {
              url: `https://example.com/video/${Date.now()}.mp4`,
              duration: 5.0,
            },
          };
        },
      };
      return stream;
    }

    it("should handle video generation with mock adapter", async () => {
      const result = await l0({
        stream: () => createMockVideoStream("A cat playing piano"),
        adapter: mockVideoAdapter,
        detectZeroTokens: false,
      });

      const events: L0Event[] = [];
      for await (const event of result.stream) {
        events.push(event);
      }

      // Should have progress events
      const progressEvents = events.filter((e) => e.type === "progress");
      expect(progressEvents.length).toBeGreaterThan(0);
      expect(progressEvents[0].progress?.message).toBe("Queued");

      // Should have data event with video
      const dataEvents = events.filter((e) => e.type === "data");
      expect(dataEvents.length).toBe(1);
      expect(dataEvents[0].data?.contentType).toBe("video");
      expect(dataEvents[0].data?.mimeType).toBe("video/mp4");
      expect(dataEvents[0].data?.url).toContain("example.com/video");
      expect(dataEvents[0].data?.metadata?.duration).toBe(5.0);

      // State should track the video
      expect(result.state.dataOutputs).toHaveLength(1);
      expect(result.state.dataOutputs[0].contentType).toBe("video");
      expect(result.state.lastProgress?.percent).toBe(100);
    });
  });

  describe("Mixed Multimodal Workflows", () => {
    it(
      "should handle text + image generation workflow",
      async () => {
        // Custom adapter that generates text description then image
        const textAndImageAdapter: L0Adapter = {
          name: "text-and-image",

          detect(input): input is any {
            return false;
          },

          async *wrap(params: {
            textPromise: Promise<string>;
            imagePromise: Promise<OpenAI.Images.ImagesResponse>;
          }): AsyncGenerator<L0Event> {
            // First emit text tokens
            yield createAdapterProgressEvent({
              percent: 0,
              message: "Generating description...",
            });

            const text = await params.textPromise;
            for (const word of text.split(" ")) {
              yield { type: "token", value: word + " ", timestamp: Date.now() };
            }

            yield createAdapterProgressEvent({
              percent: 50,
              message: "Generating image...",
            });

            // Then emit image
            const imageResponse = await params.imagePromise;
            if (imageResponse.data![0]?.url) {
              yield createImageEvent({
                url: imageResponse.data![0].url,
                model: "dall-e-2",
              });
            }

            yield createAdapterProgressEvent({
              percent: 100,
              message: "Complete",
            });
            yield createAdapterDoneEvent();
          },
        };

        const prompt = "A red square";

        const result = await l0({
          stream: () => ({
            textPromise: Promise.resolve(`Here is an image of: ${prompt}`),
            imagePromise: client!.images.generate({
              model: "dall-e-2",
              prompt,
              n: 1,
              size: "256x256",
            }),
          }),
          adapter: textAndImageAdapter,
        });

        const events: L0Event[] = [];
        for await (const event of result.stream) {
          events.push(event);
        }

        // Should have tokens
        const tokenEvents = events.filter((e) => e.type === "token");
        expect(tokenEvents.length).toBeGreaterThan(0);

        // Should have image
        const dataEvents = events.filter((e) => e.type === "data");
        expect(dataEvents.length).toBe(1);
        expect(dataEvents[0].data?.contentType).toBe("image");

        // State should have both text and image
        expect(result.state.content).toContain("red square");
        expect(result.state.dataOutputs).toHaveLength(1);
      },
      MULTIMODAL_TIMEOUT,
    );
  });

  describe("State Tracking", () => {
    it("should clear dataOutputs on retry", async () => {
      let callCount = 0;

      // Adapter that fails on first call
      const retryAdapter: L0Adapter = {
        name: "retry-test",

        detect(input): input is any {
          return false;
        },

        async *wrap(_input: any): AsyncGenerator<L0Event> {
          callCount++;

          yield createImageEvent({
            url: `https://example.com/image-${callCount}.png`,
          });

          if (callCount === 1) {
            const err = new Error("read ECONNRESET");
            (err as any).code = "ECONNRESET";
            throw err;
          }

          yield createAdapterDoneEvent();
        },
      };

      const result = await l0({
        stream: () => ({}),
        adapter: retryAdapter,
        retry: { attempts: 2 },
        detectZeroTokens: false,
      });

      for await (const _ of result.stream) {
        // consume
      }

      // Should only have image from successful attempt
      expect(callCount).toBe(2);
      expect(result.state.dataOutputs).toHaveLength(1);
      expect(result.state.dataOutputs[0].url).toBe(
        "https://example.com/image-2.png",
      );
    });

    it("should clear dataOutputs on fallback", async () => {
      let streamCall = 0;
      const combinedAdapter: L0Adapter<any> = {
        name: "combined",
        detect(input): input is any {
          return false; // Always use explicitly
        },
        async *wrap(_input: any): AsyncGenerator<L0Event> {
          streamCall++;
          if (streamCall === 1) {
            yield createImageEvent({ url: "https://example.com/primary.png" });
            yield createAdapterProgressEvent({
              percent: 50,
              message: "Primary",
            });
            throw new Error("Primary failed");
          } else {
            yield createImageEvent({ url: "https://example.com/fallback.png" });
            yield createAdapterProgressEvent({
              percent: 100,
              message: "Fallback",
            });
            yield createAdapterDoneEvent();
          }
        },
      };

      const result = await l0({
        stream: () => ({}),
        adapter: combinedAdapter,
        fallbackStreams: [() => ({})],
        retry: { attempts: 1 },
        detectZeroTokens: false,
      });

      for await (const _ of result.stream) {
        // consume
      }

      // Should only have data from fallback
      expect(streamCall).toBe(2);
      expect(result.state.dataOutputs).toHaveLength(1);
      expect(result.state.dataOutputs[0].url).toBe(
        "https://example.com/fallback.png",
      );
      expect(result.state.lastProgress?.message).toBe("Fallback");
    });
  });

  describe("Parallel Operations with Multimodal", () => {
    // Mock stream marker interface
    interface MockImageStream {
      __mockImage: true;
      id: string;
      delay: number;
    }

    // Adapter for mock image streams
    const mockImageAdapter: L0Adapter<MockImageStream> = {
      name: "mock-image",

      detect(input): input is MockImageStream {
        return !!input && typeof input === "object" && "__mockImage" in input;
      },

      async *wrap(stream: MockImageStream): AsyncGenerator<L0Event> {
        const { id, delay } = stream;
        yield createAdapterProgressEvent({
          percent: 0,
          message: `Starting ${id}`,
        });
        await new Promise((r) => setTimeout(r, delay));
        yield createAdapterProgressEvent({
          percent: 50,
          message: `Processing ${id}`,
        });
        await new Promise((r) => setTimeout(r, delay));
        yield createImageEvent({
          url: `https://example.com/${id}.png`,
        });
        yield createAdapterProgressEvent({
          percent: 100,
          message: `Complete ${id}`,
        });
        yield createAdapterDoneEvent();
      },
    };

    // Helper to create a mock multimodal stream config
    function createMockImageStream(
      id: string,
      delay: number = 100,
    ): MockImageStream {
      return { __mockImage: true, id, delay };
    }

    it("should handle parallel() with multiple multimodal streams", async () => {
      const parallelResult = await parallel([
        {
          stream: () => createMockImageStream("image-1", 50),
          adapter: mockImageAdapter,
          detectZeroTokens: false,
        },
        {
          stream: () => createMockImageStream("image-2", 100),
          adapter: mockImageAdapter,
          detectZeroTokens: false,
        },
        {
          stream: () => createMockImageStream("image-3", 75),
          adapter: mockImageAdapter,
          detectZeroTokens: false,
        },
      ]);

      // parallel() consumes streams internally, so check state directly
      expect(parallelResult.results).toHaveLength(3);

      for (let i = 0; i < 3; i++) {
        const result = parallelResult.results[i];
        expect(result).not.toBeNull();

        // State should track the image from each stream
        expect(result!.state.dataOutputs).toHaveLength(1);
        expect(result!.state.dataOutputs[0].url).toContain(`image-${i + 1}`);

        // Progress should have been tracked
        expect(result!.state.lastProgress?.percent).toBe(100);
      }
    });

    it("should handle race() with multimodal streams - fastest wins", async () => {
      const raceResult = await race([
        {
          stream: () => createMockImageStream("slow", 500),
          adapter: mockImageAdapter,
          detectZeroTokens: false,
        },
        {
          stream: () => createMockImageStream("fast", 50),
          adapter: mockImageAdapter,
          detectZeroTokens: false,
        },
        {
          stream: () => createMockImageStream("medium", 200),
          adapter: mockImageAdapter,
          detectZeroTokens: false,
        },
      ]);

      // race() extends L0Result, so winning result is directly on raceResult
      expect(raceResult.winnerIndex).toBe(1); // "fast" is at index 1

      // State should only have the winning image (state is directly on raceResult)
      expect(raceResult.state.dataOutputs).toHaveLength(1);
      expect(raceResult.state.dataOutputs[0].url).toContain("fast");

      // Progress should have been tracked
      expect(raceResult.state.lastProgress?.percent).toBe(100);
    });

    it("should forward all event types unchanged in parallel()", async () => {
      // Marker interface for full event stream
      interface FullEventStream {
        __fullEvent: true;
      }

      // Adapter that emits all multimodal event types
      const fullEventAdapter: L0Adapter<FullEventStream> = {
        name: "full-event",

        detect(input): input is FullEventStream {
          return !!input && typeof input === "object" && "__fullEvent" in input;
        },

        async *wrap(_stream: FullEventStream): AsyncGenerator<L0Event> {
          yield { type: "token", value: "Hello ", timestamp: Date.now() };
          yield createAdapterProgressEvent({
            percent: 25,
            step: 1,
            totalSteps: 4,
          });
          yield { type: "token", value: "world", timestamp: Date.now() };
          yield createAdapterProgressEvent({
            percent: 50,
            step: 2,
            totalSteps: 4,
          });
          yield createImageEvent({
            base64: "iVBORw0KGgo=",
            mimeType: "image/png",
            width: 256,
            height: 256,
          });
          yield createAdapterProgressEvent({
            percent: 75,
            step: 3,
            totalSteps: 4,
          });
          yield createAudioEvent({
            base64: "SUQzBAA=",
            mimeType: "audio/mpeg",
            duration: 5.0,
          });
          yield createAdapterProgressEvent({
            percent: 100,
            step: 4,
            totalSteps: 4,
          });
          yield createAdapterDoneEvent();
        },
      };

      const parallelResult = await parallel([
        {
          stream: () => ({ __fullEvent: true }) as FullEventStream,
          adapter: fullEventAdapter,
          detectZeroTokens: false,
        },
        {
          stream: () => ({ __fullEvent: true }) as FullEventStream,
          adapter: fullEventAdapter,
          detectZeroTokens: false,
        },
      ]);

      // parallel() consumes streams internally, verify state captures all data
      expect(parallelResult.results).toHaveLength(2);

      for (const result of parallelResult.results) {
        expect(result).not.toBeNull();

        // State should have both data outputs (image + audio)
        expect(result!.state.dataOutputs).toHaveLength(2);

        // Verify image data is preserved
        const imageOutput = result!.state.dataOutputs.find(
          (d) => d.contentType === "image",
        );
        expect(imageOutput?.base64).toBe("iVBORw0KGgo=");
        expect(imageOutput?.metadata?.width).toBe(256);
        expect(imageOutput?.metadata?.height).toBe(256);

        // Verify audio data is preserved
        const audioOutput = result!.state.dataOutputs.find(
          (d) => d.contentType === "audio",
        );
        expect(audioOutput?.base64).toBe("SUQzBAA=");
        expect(audioOutput?.metadata?.duration).toBe(5.0);

        // Text tokens should be accumulated
        expect(result!.state.content).toBe("Hello world");

        // Progress should have been tracked
        expect(result!.state.lastProgress?.percent).toBe(100);
        expect(result!.state.lastProgress?.step).toBe(4);
      }
    });
  });

  describe("Pipeline with Multimodal Events", () => {
    it("should forward multimodal events through pipeline stages", async () => {
      // Stage 1: Generate an image
      const stage1 = {
        name: "generate-image",
        fn: (_input: string) => ({
          stream: (): AsyncIterable<L0Event> => ({
            async *[Symbol.asyncIterator]() {
              yield createAdapterProgressEvent({
                percent: 0,
                message: "Generating",
              });
              yield createImageEvent({
                url: "https://example.com/generated.png",
                width: 512,
                height: 512,
                model: "test-model",
              });
              yield {
                type: "token",
                value: "Image generated",
                timestamp: Date.now(),
              };
              yield createAdapterProgressEvent({
                percent: 100,
                message: "Done",
              });
              yield { type: "done", timestamp: Date.now() };
            },
          }),
          detectZeroTokens: false,
        }),
      };

      // Stage 2: Describe the image (receives previous output)
      const stage2 = {
        name: "describe-image",
        fn: (prevOutput: string, context: any) => ({
          stream: (): AsyncIterable<L0Event> => ({
            async *[Symbol.asyncIterator]() {
              // Access the image URL from previous stage output
              yield {
                type: "token",
                value: `Describing: ${prevOutput}`,
                timestamp: Date.now(),
              };
              yield createAdapterProgressEvent({
                percent: 100,
                message: "Described",
              });
              yield { type: "done", timestamp: Date.now() };
            },
          }),
        }),
      };

      const result = await pipe([stage1, stage2], "test-prompt");

      // Pipeline returns stepResults, not a stream
      expect(result.steps).toHaveLength(2);
      expect(result.steps[0].output).toContain("Image generated");
      expect(result.steps[1].output).toContain("Describing");
    });

    it("should preserve L0Event.data through pipeline", async () => {
      const imageData: L0DataPayload = {
        contentType: "image",
        mimeType: "image/png",
        base64:
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
        metadata: {
          width: 1,
          height: 1,
          seed: 12345,
          model: "test",
          custom: "value",
        },
      };

      const stage1 = {
        name: "emit-data",
        fn: (_input: string) => ({
          stream: (): AsyncIterable<L0Event> => ({
            async *[Symbol.asyncIterator]() {
              yield { type: "data", data: imageData, timestamp: Date.now() };
              yield {
                type: "token",
                value: "with-data",
                timestamp: Date.now(),
              };
              yield { type: "done", timestamp: Date.now() };
            },
          }),
        }),
      };

      const result = await pipe([stage1], "input");

      // Verify stage completed and has data outputs
      expect(result.steps).toHaveLength(1);
      expect(result.steps[0].l0Result.state.dataOutputs).toHaveLength(1);
      expect(result.steps[0].l0Result.state.dataOutputs[0].contentType).toBe(
        "image",
      );
      expect(result.steps[0].l0Result.state.dataOutputs[0].base64).toBe(
        imageData.base64,
      );
      expect(result.steps[0].l0Result.state.dataOutputs[0].metadata?.seed).toBe(
        12345,
      );
    });
  });

  describe("Event Recording and Replay with Multimodal", () => {
    it("should record and replay multimodal tokens", async () => {
      const store = createInMemoryEventStore();
      const streamId = `multimodal-test-${Date.now()}`;
      const recorder = createEventRecorder(store, streamId);

      // Record a multimodal stream
      await recorder.recordStart({ prompt: "Generate image" });
      await recorder.recordToken("Processing ", 0);
      await recorder.recordToken("image...", 1);
      await recorder.recordComplete("Processing image...", 2);

      // Replay and verify
      const replayer = createEventReplayer(store);
      const tokens: string[] = [];
      for await (const token of replayer.replayTokens(streamId)) {
        tokens.push(token);
      }

      expect(tokens.join("")).toBe("Processing image...");
    });

    it("should preserve event sequence during replay", async () => {
      const store = createInMemoryEventStore();
      const streamId = `sequence-test-${Date.now()}`;
      const recorder = createEventRecorder(store, streamId);

      // Record events
      await recorder.recordStart({ prompt: "test" });
      await recorder.recordToken("A", 0);
      await recorder.recordToken("B", 1);
      await recorder.recordToken("C", 2);
      await recorder.recordComplete("ABC", 3);

      // Verify sequence via getEvents
      const events = await store.getEvents(streamId);
      expect(events).toHaveLength(5); // START + 3 tokens + COMPLETE

      // Verify sequence numbers
      for (let i = 0; i < events.length; i++) {
        expect(events[i].seq).toBe(i);
      }

      // Verify token order
      const tokenEvents = events.filter((e) => e.event.type === "TOKEN");
      expect(tokenEvents[0].event).toMatchObject({ type: "TOKEN", value: "A" });
      expect(tokenEvents[1].event).toMatchObject({ type: "TOKEN", value: "B" });
      expect(tokenEvents[2].event).toMatchObject({ type: "TOKEN", value: "C" });
    });

    it("should replay to correct final state", async () => {
      const store = createInMemoryEventStore();
      const streamId = `state-test-${Date.now()}`;
      const recorder = createEventRecorder(store, streamId);

      const content = "Hello multimodal world!";

      await recorder.recordStart({ prompt: "test", model: "test-model" });
      for (let i = 0; i < content.length; i++) {
        await recorder.recordToken(content[i], i);
      }
      await recorder.recordComplete(content, content.length);

      // Replay to state
      const replayer = createEventReplayer(store);
      const state = await replayer.replayToState(streamId);

      expect(state.content).toBe(content);
      expect(state.completed).toBe(true);
    });
  });
});
