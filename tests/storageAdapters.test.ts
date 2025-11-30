// Storage Adapters Tests

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  registerStorageAdapter,
  unregisterStorageAdapter,
  getRegisteredAdapters,
  createEventStore,
  BaseEventStore,
  CompositeEventStore,
  TTLEventStore,
  createCompositeStore,
  withTTL,
  FileEventStore,
} from "../src/runtime/storageAdapters";
import { InMemoryEventStore } from "../src/runtime/eventStore";
import type { L0RecordedEvent, L0EventEnvelope } from "../src/types/events";

describe("Storage Adapters", () => {
  describe("Adapter Registry", () => {
    const testAdapterType = "test-adapter";

    afterEach(() => {
      unregisterStorageAdapter(testAdapterType);
    });

    it("should register a custom adapter", () => {
      const factory = () => new InMemoryEventStore();
      registerStorageAdapter(testAdapterType, factory);

      expect(getRegisteredAdapters()).toContain(testAdapterType);
    });

    it("should unregister an adapter", () => {
      registerStorageAdapter(testAdapterType, () => new InMemoryEventStore());
      expect(getRegisteredAdapters()).toContain(testAdapterType);

      const result = unregisterStorageAdapter(testAdapterType);
      expect(result).toBe(true);
      expect(getRegisteredAdapters()).not.toContain(testAdapterType);
    });

    it("should return false when unregistering non-existent adapter", () => {
      const result = unregisterStorageAdapter("non-existent");
      expect(result).toBe(false);
    });

    it("should have memory adapter registered by default", () => {
      expect(getRegisteredAdapters()).toContain("memory");
    });

    it("should create event store using registered adapter", async () => {
      const store = await createEventStore({ type: "memory" });
      expect(store).toBeInstanceOf(InMemoryEventStore);
    });

    it("should throw for unknown adapter type", async () => {
      await expect(createEventStore({ type: "unknown-type" })).rejects.toThrow(
        /Unknown storage adapter type/,
      );
    });

    it("should support async adapter factories", async () => {
      registerStorageAdapter(testAdapterType, async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        return new InMemoryEventStore();
      });

      const store = await createEventStore({ type: testAdapterType });
      expect(store).toBeInstanceOf(InMemoryEventStore);
    });

    it("should pass config to adapter factory", async () => {
      let receivedConfig: any;

      registerStorageAdapter(testAdapterType, (config) => {
        receivedConfig = config;
        return new InMemoryEventStore();
      });

      await createEventStore({
        type: testAdapterType,
        prefix: "custom-prefix",
        ttl: 3600000,
        options: { custom: "value" },
      });

      expect(receivedConfig.prefix).toBe("custom-prefix");
      expect(receivedConfig.ttl).toBe(3600000);
      expect(receivedConfig.options).toEqual({ custom: "value" });
    });
  });

  describe("BaseEventStore", () => {
    class TestEventStore extends BaseEventStore {
      private events: Map<string, L0EventEnvelope[]> = new Map();

      async append(streamId: string, event: L0RecordedEvent): Promise<void> {
        let events = this.events.get(streamId);
        if (!events) {
          events = [];
          this.events.set(streamId, events);
        }
        events.push({ streamId, seq: events.length, event });
      }

      async getEvents(streamId: string): Promise<L0EventEnvelope[]> {
        return this.events.get(streamId) ?? [];
      }

      async exists(streamId: string): Promise<boolean> {
        return this.events.has(streamId);
      }

      async delete(streamId: string): Promise<void> {
        this.events.delete(streamId);
      }

      async listStreams(): Promise<string[]> {
        return Array.from(this.events.keys());
      }
    }

    let store: TestEventStore;

    beforeEach(() => {
      store = new TestEventStore({ type: "test" });
    });

    it("should provide default getLastEvent implementation", async () => {
      await store.append("stream-1", {
        type: "TOKEN",
        ts: 1000,
        value: "a",
        index: 0,
      });
      await store.append("stream-1", {
        type: "TOKEN",
        ts: 1100,
        value: "b",
        index: 1,
      });

      const last = await store.getLastEvent("stream-1");
      expect(last?.seq).toBe(1);
      expect((last?.event as any).value).toBe("b");
    });

    it("should return null for empty stream getLastEvent", async () => {
      const last = await store.getLastEvent("non-existent");
      expect(last).toBeNull();
    });

    it("should provide default getEventsAfter implementation", async () => {
      for (let i = 0; i < 5; i++) {
        await store.append("stream-1", {
          type: "TOKEN",
          ts: 1000 + i * 100,
          value: `${i}`,
          index: i,
        });
      }

      const events = await store.getEventsAfter("stream-1", 2);
      expect(events).toHaveLength(2);
      expect(events[0]?.seq).toBe(3);
      expect(events[1]?.seq).toBe(4);
    });

    it("should use prefix for stream keys", () => {
      const storeWithPrefix = new TestEventStore({
        type: "test",
        prefix: "myapp",
      });
      // Access protected method via any
      expect((storeWithPrefix as any).getStreamKey("test")).toBe(
        "myapp:stream:test",
      );
    });

    it("should check expiration based on TTL", () => {
      const storeWithTTL = new TestEventStore({ type: "test", ttl: 1000 });

      // Not expired (within TTL)
      expect((storeWithTTL as any).isExpired(Date.now() - 500)).toBe(false);

      // Expired (beyond TTL)
      expect((storeWithTTL as any).isExpired(Date.now() - 2000)).toBe(true);
    });

    it("should not expire when TTL is 0", () => {
      const storeNoTTL = new TestEventStore({ type: "test", ttl: 0 });

      // Very old timestamp should not be expired
      expect((storeNoTTL as any).isExpired(Date.now() - 999999999)).toBe(false);
    });
  });

  describe("CompositeEventStore", () => {
    let store1: InMemoryEventStore;
    let store2: InMemoryEventStore;
    let composite: CompositeEventStore;

    beforeEach(() => {
      store1 = new InMemoryEventStore();
      store2 = new InMemoryEventStore();
      composite = new CompositeEventStore([store1, store2]);
    });

    it("should write to all stores", async () => {
      await composite.append("stream-1", {
        type: "TOKEN",
        ts: 1000,
        value: "test",
        index: 0,
      });

      const events1 = await store1.getEvents("stream-1");
      const events2 = await store2.getEvents("stream-1");

      expect(events1).toHaveLength(1);
      expect(events2).toHaveLength(1);
    });

    it("should read from primary store only", async () => {
      // Add directly to store2 (not primary)
      await store2.append("stream-1", {
        type: "TOKEN",
        ts: 1000,
        value: "test",
        index: 0,
      });

      // Should not see it from composite (reads from store1)
      const events = await composite.getEvents("stream-1");
      expect(events).toHaveLength(0);
    });

    it("should use custom primary index", async () => {
      const compositeWithPrimary = new CompositeEventStore([store1, store2], 1);

      await store2.append("stream-1", {
        type: "TOKEN",
        ts: 1000,
        value: "test",
        index: 0,
      });

      const events = await compositeWithPrimary.getEvents("stream-1");
      expect(events).toHaveLength(1);
    });

    it("should delete from all stores", async () => {
      await composite.append("stream-1", {
        type: "TOKEN",
        ts: 1000,
        value: "test",
        index: 0,
      });
      await composite.delete("stream-1");

      expect(await store1.exists("stream-1")).toBe(false);
      expect(await store2.exists("stream-1")).toBe(false);
    });

    it("should check existence on primary", async () => {
      await store1.append("stream-1", {
        type: "TOKEN",
        ts: 1000,
        value: "test",
        index: 0,
      });

      expect(await composite.exists("stream-1")).toBe(true);
      expect(await composite.exists("stream-2")).toBe(false);
    });

    it("should throw if no stores provided", () => {
      expect(() => new CompositeEventStore([])).toThrow(/at least one store/);
    });

    it("should work with createCompositeStore helper", async () => {
      const helper = createCompositeStore([store1, store2]);
      await helper.append("stream-1", {
        type: "TOKEN",
        ts: 1000,
        value: "test",
        index: 0,
      });

      expect(await store1.getEvents("stream-1")).toHaveLength(1);
      expect(await store2.getEvents("stream-1")).toHaveLength(1);
    });
  });

  describe("TTLEventStore", () => {
    let baseStore: InMemoryEventStore;
    let ttlStore: TTLEventStore;

    beforeEach(() => {
      baseStore = new InMemoryEventStore();
      ttlStore = new TTLEventStore(baseStore, 1000); // 1 second TTL
    });

    it("should pass through writes to underlying store", async () => {
      await ttlStore.append("stream-1", {
        type: "TOKEN",
        ts: Date.now(),
        value: "test",
        index: 0,
      });

      const baseEvents = await baseStore.getEvents("stream-1");
      expect(baseEvents).toHaveLength(1);
    });

    it("should filter expired events on read", async () => {
      const now = Date.now();

      // Add old event (expired)
      await baseStore.append("stream-1", {
        type: "TOKEN",
        ts: now - 2000,
        value: "old",
        index: 0,
      });

      // Add recent event (not expired)
      await baseStore.append("stream-1", {
        type: "TOKEN",
        ts: now,
        value: "new",
        index: 1,
      });

      const events = await ttlStore.getEvents("stream-1");
      expect(events).toHaveLength(1);
      expect((events[0]?.event as any).value).toBe("new");
    });

    it("should report exists based on non-expired events", async () => {
      // Add only expired event
      await baseStore.append("stream-1", {
        type: "TOKEN",
        ts: Date.now() - 2000,
        value: "old",
        index: 0,
      });

      expect(await ttlStore.exists("stream-1")).toBe(false);
    });

    it("should filter expired events in getLastEvent", async () => {
      const now = Date.now();

      await baseStore.append("stream-1", {
        type: "TOKEN",
        ts: now,
        value: "recent",
        index: 0,
      });
      await baseStore.append("stream-1", {
        type: "TOKEN",
        ts: now - 2000,
        value: "expired",
        index: 1,
      });

      const last = await ttlStore.getLastEvent("stream-1");
      expect((last?.event as any).value).toBe("recent");
    });

    it("should work with withTTL helper", async () => {
      const store = withTTL(new InMemoryEventStore(), 1000);
      await store.append("stream-1", {
        type: "TOKEN",
        ts: Date.now() - 2000,
        value: "old",
        index: 0,
      });

      expect(await store.getEvents("stream-1")).toHaveLength(0);
    });

    it("should delegate delete to underlying store", async () => {
      await ttlStore.append("stream-1", {
        type: "TOKEN",
        ts: Date.now(),
        value: "test",
        index: 0,
      });
      await ttlStore.delete("stream-1");

      expect(await baseStore.exists("stream-1")).toBe(false);
    });

    it("should delegate listStreams to underlying store", async () => {
      await baseStore.append("stream-1", {
        type: "TOKEN",
        ts: Date.now(),
        value: "test",
        index: 0,
      });
      await baseStore.append("stream-2", {
        type: "TOKEN",
        ts: Date.now(),
        value: "test",
        index: 0,
      });

      const streams = await ttlStore.listStreams();
      expect(streams).toContain("stream-1");
      expect(streams).toContain("stream-2");
    });
  });

  describe("Integration Patterns", () => {
    it("should support write-through cache pattern", async () => {
      const cache = new InMemoryEventStore();
      const persistent = new InMemoryEventStore();

      const store = createCompositeStore([cache, persistent], 0);

      // Write goes to both
      await store.append("stream-1", {
        type: "TOKEN",
        ts: Date.now(),
        value: "test",
        index: 0,
      });

      // Both have the data
      expect(await cache.getEvents("stream-1")).toHaveLength(1);
      expect(await persistent.getEvents("stream-1")).toHaveLength(1);

      // Reads come from cache (primary)
      expect(await store.getEvents("stream-1")).toHaveLength(1);
    });

    it("should support TTL cache with persistent backing", async () => {
      const persistent = new InMemoryEventStore();
      const cache = withTTL(new InMemoryEventStore(), 100); // 100ms TTL

      const store = createCompositeStore([cache, persistent], 0);

      // Write to both
      await store.append("stream-1", {
        type: "TOKEN",
        ts: Date.now(),
        value: "test",
        index: 0,
      });

      // Initially both have data
      expect(await cache.getEvents("stream-1")).toHaveLength(1);

      // Wait for TTL
      await new Promise((resolve) => setTimeout(resolve, 150));

      // Cache expired, but persistent still has it
      expect(await cache.getEvents("stream-1")).toHaveLength(0);
      expect(await persistent.getEvents("stream-1")).toHaveLength(1);
    });

    it("should allow custom adapter registration and usage", async () => {
      // Custom adapter that wraps events with metadata
      class MetadataStore extends InMemoryEventStore {
        private metadata: Map<string, Record<string, unknown>> = new Map();

        setMetadata(streamId: string, meta: Record<string, unknown>): void {
          this.metadata.set(streamId, meta);
        }

        getMetadata(streamId: string): Record<string, unknown> | undefined {
          return this.metadata.get(streamId);
        }
      }

      registerStorageAdapter("metadata", () => new MetadataStore());

      const store = (await createEventStore({
        type: "metadata",
      })) as MetadataStore;

      store.setMetadata("stream-1", { user: "test-user", purpose: "demo" });
      await store.append("stream-1", {
        type: "TOKEN",
        ts: Date.now(),
        value: "hello",
        index: 0,
      });

      expect(store.getMetadata("stream-1")).toEqual({
        user: "test-user",
        purpose: "demo",
      });
      expect(await store.getEvents("stream-1")).toHaveLength(1);

      unregisterStorageAdapter("metadata");
    });
  });

  describe("FileEventStore Path Traversal Protection", () => {
    const validate = FileEventStore.validateStreamId;

    it("should reject stream IDs with path traversal attempts", () => {
      expect(() => validate("../../../etc/passwd")).toThrow(
        /Invalid stream ID/,
      );
      expect(() => validate("..\\..\\windows\\system32")).toThrow(
        /Invalid stream ID/,
      );
      expect(() => validate("foo/../bar")).toThrow(/Invalid stream ID/);
    });

    it("should reject stream IDs with special characters", () => {
      expect(() => validate("stream:with:colons")).toThrow(/Invalid stream ID/);
      expect(() => validate("stream/with/slashes")).toThrow(
        /Invalid stream ID/,
      );
      expect(() => validate("stream<with>brackets")).toThrow(
        /Invalid stream ID/,
      );
      expect(() => validate("stream|with|pipes")).toThrow(/Invalid stream ID/);
    });

    it("should allow valid stream IDs unchanged", () => {
      // Valid IDs should pass through
      expect(validate("valid-stream-id")).toBe("valid-stream-id");
      expect(validate("stream_with_underscores")).toBe(
        "stream_with_underscores",
      );
      expect(validate("Stream123")).toBe("Stream123");
      expect(validate("UPPERCASE")).toBe("UPPERCASE");
      expect(validate("a")).toBe("a");
      expect(validate("123")).toBe("123");
    });

    it("should throw for empty stream ID", () => {
      expect(() => validate("")).toThrow(/must not be empty/);
    });

    it("should reject IDs with only special characters", () => {
      expect(() => validate("...")).toThrow(/Invalid stream ID/);
      expect(() => validate("///")).toThrow(/Invalid stream ID/);
    });

    it("should reject null byte injection", () => {
      expect(() => validate("stream\x00.json")).toThrow(/Invalid stream ID/);
      expect(() => validate("test\x00../etc")).toThrow(/Invalid stream ID/);
    });
  });
});
