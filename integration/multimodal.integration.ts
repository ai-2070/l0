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
    // Adapter for DALL-E image generation
    const dalleAdapter: L0Adapter = {
      name: "dalle",

      detect(input): input is any {
        return false; // Always use explicitly
      },

      async *wrap(
        responsePromise: Promise<OpenAI.Images.ImagesResponse>,
      ): AsyncGenerator<L0Event> {
        yield createAdapterProgressEvent({
          percent: 0,
          message: "Generating image...",
        });

        const response = await responsePromise;

        for (const image of response.data!) {
          if (image.url) {
            yield createImageEvent({
              url: image.url,
              model: "dall-e-3",
            });
          } else if (image.b64_json) {
            yield createImageEvent({
              base64: image.b64_json,
              mimeType: "image/png",
              model: "dall-e-3",
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
        const result = await l0({
          stream: () =>
            client!.images.generate({
              model: "dall-e-2", // Use DALL-E 2 for faster/cheaper tests
              prompt: "A simple red circle on white background",
              n: 1,
              size: "256x256",
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
  });
});
