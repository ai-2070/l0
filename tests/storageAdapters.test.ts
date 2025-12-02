import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  registerStorageAdapter,
  unregisterStorageAdapter,
  getRegisteredAdapters,
  createEventStore,
  BaseEventStore,
  BaseEventStoreWithSnapshots,
  FileEventStore,
  LocalStorageEventStore,
  CompositeEventStore,
  createCompositeStore,
  TTLEventStore,
  withTTL,
} from "../src/runtime/storageAdapters";
import { InMemoryEventStore } from "../src/runtime/eventStore";
import type {
  L0EventEnvelope,
  L0RecordedEvent,
  L0Snapshot,
} from "../src/types/events";

describe("Storage Adapters", () => {
  describe("Adapter Registry", () => {
    const testAdapterType = "test-adapter";

    afterEach(() => {
      unregisterStorageAdapter(testAdapterType);
    });

    it("should register a custom adapter", () => {
      const factory = vi.fn(() => new InMemoryEventStore());
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

    it("should create event store using registered adapter", async () => {
      const mockStore = new InMemoryEventStore();
      registerStorageAdapter(testAdapterType, () => mockStore);

      const store = await createEventStore({ type: testAdapterType });
      expect(store).toBe(mockStore);
    });

    it("should throw for unknown adapter type", async () => {
      await expect(
        createEventStore({ type: "unknown-adapter" }),
      ).rejects.toThrow("Unknown storage adapter type");
    });

    it("should include memory adapter by default", () => {
      expect(getRegisteredAdapters()).toContain("memory");
    });

    it("should create memory store", async () => {
      const store = await createEventStore({ type: "memory" });
      expect(store).toBeInstanceOf(InMemoryEventStore);
    });
  });

  describe("BaseEventStore", () => {
    // Create a concrete implementation for testing
    class TestEventStore extends BaseEventStore {
      private events: Map<string, L0EventEnvelope[]> = new Map();

      async append(streamId: string, event: L0RecordedEvent): Promise<void> {
        const key = this.getStreamKey(streamId);
        const events = this.events.get(key) || [];
        events.push({ streamId, seq: events.length, event });
        this.events.set(key, events);
      }

      async getEvents(streamId: string): Promise<L0EventEnvelope[]> {
        return this.events.get(this.getStreamKey(streamId)) || [];
      }

      async exists(streamId: string): Promise<boolean> {
        return this.events.has(this.getStreamKey(streamId));
      }

      async delete(streamId: string): Promise<void> {
        this.events.delete(this.getStreamKey(streamId));
      }

      async listStreams(): Promise<string[]> {
        return Array.from(this.events.keys());
      }

      // Expose protected methods for testing
      testGetStreamKey(streamId: string): string {
        return this.getStreamKey(streamId);
      }

      testGetMetaKey(streamId: string): string {
        return this.getMetaKey(streamId);
      }

      testIsExpired(timestamp: number): boolean {
        return this.isExpired(timestamp);
      }
    }

    it("should generate correct stream key", () => {
      const store = new TestEventStore({ type: "test", prefix: "myprefix" });
      expect(store.testGetStreamKey("stream1")).toBe("myprefix:stream:stream1");
    });

    it("should generate correct meta key", () => {
      const store = new TestEventStore({ type: "test", prefix: "myprefix" });
      expect(store.testGetMetaKey("stream1")).toBe("myprefix:meta:stream1");
    });

    it("should use default prefix", () => {
      const store = new TestEventStore({ type: "test" });
      expect(store.testGetStreamKey("stream1")).toBe("l0:stream:stream1");
    });

    it("should not expire when TTL is 0", () => {
      const store = new TestEventStore({ type: "test", ttl: 0 });
      expect(store.testIsExpired(Date.now() - 1000000)).toBe(false);
    });

    it("should expire old events when TTL is set", () => {
      const store = new TestEventStore({ type: "test", ttl: 1000 });
      expect(store.testIsExpired(Date.now() - 2000)).toBe(true);
      expect(store.testIsExpired(Date.now())).toBe(false);
    });

    it("should get last event", async () => {
      const store = new TestEventStore({ type: "test" });
      const event1: L0RecordedEvent = {
        type: "START",
        ts: Date.now(),
        options: {},
      };
      const event2: L0RecordedEvent = {
        type: "TOKEN",
        ts: Date.now(),
        value: "test",
        index: 0,
      };

      await store.append("stream1", event1);
      await store.append("stream1", event2);

      const lastEvent = await store.getLastEvent("stream1");
      expect(lastEvent?.event.type).toBe("TOKEN");
    });

    it("should return null for getLastEvent on empty stream", async () => {
      const store = new TestEventStore({ type: "test" });
      const lastEvent = await store.getLastEvent("nonexistent");
      expect(lastEvent).toBeNull();
    });

    it("should get events after sequence", async () => {
      const store = new TestEventStore({ type: "test" });
      await store.append("stream1", {
        type: "START",
        ts: Date.now(),
        options: {},
      });
      await store.append("stream1", {
        type: "TOKEN",
        ts: Date.now(),
        value: "a",
        index: 0,
      });
      await store.append("stream1", {
        type: "TOKEN",
        ts: Date.now(),
        value: "b",
        index: 1,
      });

      const events = await store.getEventsAfter("stream1", 0);
      expect(events).toHaveLength(2);
      expect(events[0]?.seq).toBe(1);
    });
  });

  describe("BaseEventStoreWithSnapshots", () => {
    class TestSnapshotStore extends BaseEventStoreWithSnapshots {
      private events: Map<string, L0EventEnvelope[]> = new Map();
      private snapshots: Map<string, L0Snapshot> = new Map();

      async append(streamId: string, event: L0RecordedEvent): Promise<void> {
        const events = this.events.get(streamId) || [];
        events.push({ streamId, seq: events.length, event });
        this.events.set(streamId, events);
      }

      async getEvents(streamId: string): Promise<L0EventEnvelope[]> {
        return this.events.get(streamId) || [];
      }

      async exists(streamId: string): Promise<boolean> {
        return this.events.has(streamId);
      }

      async delete(streamId: string): Promise<void> {
        this.events.delete(streamId);
        this.snapshots.delete(streamId);
      }

      async listStreams(): Promise<string[]> {
        return Array.from(this.events.keys());
      }

      async saveSnapshot(snapshot: L0Snapshot): Promise<void> {
        this.snapshots.set(snapshot.streamId, snapshot);
      }

      async getSnapshot(streamId: string): Promise<L0Snapshot | null> {
        return this.snapshots.get(streamId) || null;
      }

      // Expose for testing
      testGetSnapshotKey(streamId: string): string {
        return this.getSnapshotKey(streamId);
      }
    }

    it("should generate correct snapshot key", () => {
      const store = new TestSnapshotStore({ type: "test", prefix: "myprefix" });
      expect(store.testGetSnapshotKey("stream1")).toBe(
        "myprefix:snapshot:stream1",
      );
    });

    it("should get snapshot before sequence", async () => {
      const store = new TestSnapshotStore({ type: "test" });
      const snapshot: L0Snapshot = {
        streamId: "stream1",
        seq: 5,
        ts: Date.now(),
        content: "test content",
        tokenCount: 10,
        checkpoint: "checkpoint1",
        violations: [],
        driftDetected: false,
        retryAttempts: 0,
        networkRetryCount: 0,
        fallbackIndex: 0,
      };

      await store.saveSnapshot(snapshot);

      const result = await store.getSnapshotBefore("stream1", 10);
      expect(result).toEqual(snapshot);
    });

    it("should return null if snapshot is after sequence", async () => {
      const store = new TestSnapshotStore({ type: "test" });
      const snapshot: L0Snapshot = {
        streamId: "stream1",
        seq: 10,
        ts: Date.now(),
        content: "test content",
        tokenCount: 10,
        checkpoint: "checkpoint1",
        violations: [],
        driftDetected: false,
        retryAttempts: 0,
        networkRetryCount: 0,
        fallbackIndex: 0,
      };

      await store.saveSnapshot(snapshot);

      const result = await store.getSnapshotBefore("stream1", 5);
      expect(result).toBeNull();
    });
  });

  describe("FileEventStore", () => {
    describe("validateStreamId", () => {
      it("should accept valid stream IDs", () => {
        expect(FileEventStore.validateStreamId("valid-id")).toBe("valid-id");
        expect(FileEventStore.validateStreamId("valid_id")).toBe("valid_id");
        expect(FileEventStore.validateStreamId("ValidId123")).toBe(
          "ValidId123",
        );
      });

      it("should reject empty stream ID", () => {
        expect(() => FileEventStore.validateStreamId("")).toThrow(
          "must not be empty",
        );
      });

      it("should reject stream ID with path traversal", () => {
        expect(() => FileEventStore.validateStreamId("../malicious")).toThrow(
          "only alphanumeric",
        );
        expect(() => FileEventStore.validateStreamId("path/to/file")).toThrow(
          "only alphanumeric",
        );
      });

      it("should reject stream ID with special characters", () => {
        expect(() => FileEventStore.validateStreamId("id with spaces")).toThrow(
          "only alphanumeric",
        );
        expect(() => FileEventStore.validateStreamId("id@special")).toThrow(
          "only alphanumeric",
        );
      });
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

    it("should throw if no stores provided", () => {
      expect(() => new CompositeEventStore([])).toThrow("at least one store");
    });

    it("should append to all stores", async () => {
      const event: L0RecordedEvent = {
        type: "START",
        ts: Date.now(),
        options: {},
      };
      await composite.append("stream1", event);

      const events1 = await store1.getEvents("stream1");
      const events2 = await store2.getEvents("stream1");

      expect(events1).toHaveLength(1);
      expect(events2).toHaveLength(1);
    });

    it("should read from primary store", async () => {
      const event: L0RecordedEvent = {
        type: "START",
        ts: Date.now(),
        options: {},
      };
      await store1.append("stream1", event);
      // Don't add to store2

      const events = await composite.getEvents("stream1");
      expect(events).toHaveLength(1);
    });

    it("should use custom primary index", async () => {
      const customComposite = new CompositeEventStore([store1, store2], 1);
      const event: L0RecordedEvent = {
        type: "START",
        ts: Date.now(),
        options: {},
      };
      await store2.append("stream1", event);
      // Don't add to store1

      const events = await customComposite.getEvents("stream1");
      expect(events).toHaveLength(1);
    });

    it("should check existence on primary", async () => {
      await store1.append("stream1", {
        type: "START",
        ts: Date.now(),
        options: {},
      });

      expect(await composite.exists("stream1")).toBe(true);
      expect(await composite.exists("stream2")).toBe(false);
    });

    it("should delete from all stores", async () => {
      await composite.append("stream1", {
        type: "START",
        ts: Date.now(),
        options: {},
      });

      await composite.delete("stream1");

      expect(await store1.exists("stream1")).toBe(false);
      expect(await store2.exists("stream1")).toBe(false);
    });

    it("should get last event from primary", async () => {
      await composite.append("stream1", {
        type: "START",
        ts: Date.now(),
        options: {},
      });
      await composite.append("stream1", {
        type: "TOKEN",
        ts: Date.now(),
        value: "test",
        index: 0,
      });

      const lastEvent = await composite.getLastEvent("stream1");
      expect(lastEvent?.event.type).toBe("TOKEN");
    });

    it("should get events after from primary", async () => {
      await composite.append("stream1", {
        type: "START",
        ts: Date.now(),
        options: {},
      });
      await composite.append("stream1", {
        type: "TOKEN",
        ts: Date.now(),
        value: "a",
        index: 0,
      });
      await composite.append("stream1", {
        type: "TOKEN",
        ts: Date.now(),
        value: "b",
        index: 1,
      });

      const events = await composite.getEventsAfter("stream1", 0);
      expect(events).toHaveLength(2);
    });

    it("should list streams from primary", async () => {
      await composite.append("stream1", {
        type: "START",
        ts: Date.now(),
        options: {},
      });
      await composite.append("stream2", {
        type: "START",
        ts: Date.now(),
        options: {},
      });

      const streams = await composite.listStreams();
      expect(streams).toContain("stream1");
      expect(streams).toContain("stream2");
    });
  });

  describe("createCompositeStore", () => {
    it("should create composite store", () => {
      const store1 = new InMemoryEventStore();
      const store2 = new InMemoryEventStore();
      const composite = createCompositeStore([store1, store2]);

      expect(composite).toBeInstanceOf(CompositeEventStore);
    });

    it("should accept custom primary index", () => {
      const store1 = new InMemoryEventStore();
      const store2 = new InMemoryEventStore();
      const composite = createCompositeStore([store1, store2], 1);

      expect(composite).toBeInstanceOf(CompositeEventStore);
    });
  });

  describe("TTLEventStore", () => {
    let baseStore: InMemoryEventStore;
    let ttlStore: TTLEventStore;
    const TTL_MS = 1000;

    beforeEach(() => {
      baseStore = new InMemoryEventStore();
      ttlStore = new TTLEventStore(baseStore, TTL_MS);
    });

    it("should append events to underlying store", async () => {
      const event: L0RecordedEvent = {
        type: "START",
        ts: Date.now(),
        options: {},
      };
      await ttlStore.append("stream1", event);

      const baseEvents = await baseStore.getEvents("stream1");
      expect(baseEvents).toHaveLength(1);
    });

    it("should filter expired events on getEvents", async () => {
      const oldTs = Date.now() - TTL_MS - 100;
      const newTs = Date.now();

      await baseStore.append("stream1", {
        type: "START",
        ts: oldTs,
        options: {},
      });
      await baseStore.append("stream1", {
        type: "TOKEN",
        ts: newTs,
        value: "test",
        index: 0,
      });

      const events = await ttlStore.getEvents("stream1");
      expect(events).toHaveLength(1);
      expect(events[0]?.event.type).toBe("TOKEN");
    });

    it("should check existence based on non-expired events", async () => {
      const oldTs = Date.now() - TTL_MS - 100;
      await baseStore.append("stream1", {
        type: "START",
        ts: oldTs,
        options: {},
      });

      // All events expired
      expect(await ttlStore.exists("stream1")).toBe(false);
    });

    it("should get last non-expired event", async () => {
      const oldTs = Date.now() - TTL_MS - 100;
      const newTs = Date.now();

      await baseStore.append("stream1", {
        type: "START",
        ts: oldTs,
        options: {},
      });
      await baseStore.append("stream1", {
        type: "TOKEN",
        ts: newTs,
        value: "test",
        index: 0,
      });

      const lastEvent = await ttlStore.getLastEvent("stream1");
      expect(lastEvent?.event.type).toBe("TOKEN");
    });

    it("should return null for getLastEvent when all expired", async () => {
      const oldTs = Date.now() - TTL_MS - 100;
      await baseStore.append("stream1", {
        type: "START",
        ts: oldTs,
        options: {},
      });

      const lastEvent = await ttlStore.getLastEvent("stream1");
      expect(lastEvent).toBeNull();
    });

    it("should filter expired events in getEventsAfter", async () => {
      const oldTs = Date.now() - TTL_MS - 100;
      const newTs = Date.now();

      await baseStore.append("stream1", {
        type: "START",
        ts: oldTs,
        options: {},
      });
      await baseStore.append("stream1", {
        type: "TOKEN",
        ts: oldTs,
        value: "old",
        index: 0,
      });
      await baseStore.append("stream1", {
        type: "TOKEN",
        ts: newTs,
        value: "new",
        index: 1,
      });

      const events = await ttlStore.getEventsAfter("stream1", 0);
      expect(events).toHaveLength(1);
      expect(events[0]?.event.type).toBe("TOKEN");
    });

    it("should delegate delete to underlying store", async () => {
      await ttlStore.append("stream1", {
        type: "START",
        ts: Date.now(),
        options: {},
      });
      await ttlStore.delete("stream1");

      expect(await baseStore.exists("stream1")).toBe(false);
    });

    it("should delegate listStreams to underlying store", async () => {
      await ttlStore.append("stream1", {
        type: "START",
        ts: Date.now(),
        options: {},
      });
      await ttlStore.append("stream2", {
        type: "START",
        ts: Date.now(),
        options: {},
      });

      const streams = await ttlStore.listStreams();
      expect(streams).toContain("stream1");
      expect(streams).toContain("stream2");
    });
  });

  describe("withTTL", () => {
    it("should create TTLEventStore wrapper", () => {
      const baseStore = new InMemoryEventStore();
      const ttlStore = withTTL(baseStore, 5000);

      expect(ttlStore).toBeInstanceOf(TTLEventStore);
    });
  });

  describe("LocalStorageEventStore", () => {
    // Mock localStorage
    let mockStorage: Map<string, string>;
    let mockLocalStorage: {
      getItem: (key: string) => string | null;
      setItem: (key: string, value: string) => void;
      removeItem: (key: string) => void;
    };

    beforeEach(() => {
      mockStorage = new Map();
      mockLocalStorage = {
        getItem: (key: string) => mockStorage.get(key) ?? null,
        setItem: (key: string, value: string) => mockStorage.set(key, value),
        removeItem: (key: string) => mockStorage.delete(key),
      };

      // Mock globalThis.localStorage
      (globalThis as any).localStorage = mockLocalStorage;
    });

    afterEach(() => {
      delete (globalThis as any).localStorage;
    });

    it("should throw if localStorage is not available", () => {
      delete (globalThis as any).localStorage;
      expect(() => new LocalStorageEventStore()).toThrow(
        "LocalStorage is not available",
      );
    });

    it("should append events", async () => {
      const store = new LocalStorageEventStore();
      const event: L0RecordedEvent = {
        type: "START",
        ts: Date.now(),
        options: {},
      };

      await store.append("stream1", event);

      const events = await store.getEvents("stream1");
      expect(events).toHaveLength(1);
      expect(events[0]?.event.type).toBe("START");
    });

    it("should append multiple events with correct sequence", async () => {
      const store = new LocalStorageEventStore();

      await store.append("stream1", {
        type: "START",
        ts: Date.now(),
        options: {},
      });
      await store.append("stream1", {
        type: "TOKEN",
        ts: Date.now(),
        value: "hello",
        index: 0,
      });

      const events = await store.getEvents("stream1");
      expect(events).toHaveLength(2);
      expect(events[0]?.seq).toBe(0);
      expect(events[1]?.seq).toBe(1);
    });

    it("should return empty array for non-existent stream", async () => {
      const store = new LocalStorageEventStore();
      const events = await store.getEvents("nonexistent");
      expect(events).toEqual([]);
    });

    it("should check stream existence", async () => {
      const store = new LocalStorageEventStore();
      expect(await store.exists("stream1")).toBe(false);

      await store.append("stream1", {
        type: "START",
        ts: Date.now(),
        options: {},
      });

      expect(await store.exists("stream1")).toBe(true);
    });

    it("should delete stream and snapshot", async () => {
      const store = new LocalStorageEventStore();

      await store.append("stream1", {
        type: "START",
        ts: Date.now(),
        options: {},
      });
      await store.saveSnapshot({
        streamId: "stream1",
        seq: 0,
        ts: Date.now(),
        content: "test",
        tokenCount: 1,
        checkpoint: "",
        violations: [],
        driftDetected: false,
        retryAttempts: 0,
        networkRetryCount: 0,
        fallbackIndex: 0,
      });

      await store.delete("stream1");

      expect(await store.exists("stream1")).toBe(false);
      expect(await store.getSnapshot("stream1")).toBeNull();
    });

    it("should list streams", async () => {
      const store = new LocalStorageEventStore();

      await store.append("stream1", {
        type: "START",
        ts: Date.now(),
        options: {},
      });
      await store.append("stream2", {
        type: "START",
        ts: Date.now(),
        options: {},
      });

      const streams = await store.listStreams();
      expect(streams).toContain("stream1");
      expect(streams).toContain("stream2");
    });

    it("should return empty list when no streams", async () => {
      const store = new LocalStorageEventStore();
      const streams = await store.listStreams();
      expect(streams).toEqual([]);
    });

    it("should save and get snapshot", async () => {
      const store = new LocalStorageEventStore();
      const snapshot: L0Snapshot = {
        streamId: "stream1",
        seq: 5,
        ts: Date.now(),
        content: "test content",
        tokenCount: 10,
        checkpoint: "checkpoint1",
        violations: [],
        driftDetected: false,
        retryAttempts: 0,
        networkRetryCount: 0,
        fallbackIndex: 0,
      };

      await store.saveSnapshot(snapshot);
      const retrieved = await store.getSnapshot("stream1");

      expect(retrieved).toEqual(snapshot);
    });

    it("should return null for non-existent snapshot", async () => {
      const store = new LocalStorageEventStore();
      const snapshot = await store.getSnapshot("nonexistent");
      expect(snapshot).toBeNull();
    });

    it("should filter expired events when TTL is set", async () => {
      const store = new LocalStorageEventStore({
        type: "localStorage",
        ttl: 1000,
      });
      const oldTs = Date.now() - 2000;
      const newTs = Date.now();

      // Manually set events with old timestamps
      const key = "l0:stream:stream1";
      mockStorage.set(
        key,
        JSON.stringify([
          {
            streamId: "stream1",
            seq: 0,
            event: { type: "START", ts: oldTs, options: {} },
          },
          {
            streamId: "stream1",
            seq: 1,
            event: { type: "TOKEN", ts: newTs, value: "new", index: 0 },
          },
        ]),
      );

      const events = await store.getEvents("stream1");
      expect(events).toHaveLength(1);
      expect(events[0]?.event.type).toBe("TOKEN");
    });

    it("should not duplicate stream in list on multiple appends", async () => {
      const store = new LocalStorageEventStore();

      await store.append("stream1", {
        type: "START",
        ts: Date.now(),
        options: {},
      });
      await store.append("stream1", {
        type: "TOKEN",
        ts: Date.now(),
        value: "test",
        index: 0,
      });

      const streams = await store.listStreams();
      expect(streams.filter((s) => s === "stream1")).toHaveLength(1);
    });

    it("should use custom prefix", async () => {
      const store = new LocalStorageEventStore({
        type: "localStorage",
        prefix: "custom",
      });

      await store.append("stream1", {
        type: "START",
        ts: Date.now(),
        options: {},
      });

      // Check the key uses custom prefix
      expect(mockStorage.has("custom:stream:stream1")).toBe(true);
    });

    it("should remove stream from list on delete", async () => {
      const store = new LocalStorageEventStore();

      await store.append("stream1", {
        type: "START",
        ts: Date.now(),
        options: {},
      });
      await store.append("stream2", {
        type: "START",
        ts: Date.now(),
        options: {},
      });

      await store.delete("stream1");

      const streams = await store.listStreams();
      expect(streams).not.toContain("stream1");
      expect(streams).toContain("stream2");
    });
  });
});
