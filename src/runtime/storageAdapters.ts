// Storage Adapters for L0 Event Sourcing
//
// Provides pluggable storage backends for event persistence.
// Implement L0EventStore interface to create custom adapters.

import type {
  L0EventStore,
  L0EventStoreWithSnapshots,
  L0EventEnvelope,
  L0RecordedEvent,
  L0Snapshot,
} from "../types/events";
import { InMemoryEventStore } from "./eventStore";

/**
 * Storage adapter configuration
 */
export interface StorageAdapterConfig {
  /** Adapter type identifier */
  type: string;
  /** Connection string or configuration */
  connection?: string;
  /** Table/collection/key prefix */
  prefix?: string;
  /** TTL for events in milliseconds (0 = no expiry) */
  ttl?: number;
  /** Custom options passed to the adapter */
  options?: Record<string, unknown>;
}

/**
 * Factory function type for creating storage adapters
 */
export type StorageAdapterFactory = (
  config: StorageAdapterConfig,
) => L0EventStore | Promise<L0EventStore>;

/**
 * Registry of storage adapter factories
 */
const adapterRegistry = new Map<string, StorageAdapterFactory>();

/**
 * Register a custom storage adapter factory
 *
 * @example
 * ```typescript
 * registerStorageAdapter("redis", (config) => {
 *   return new RedisEventStore(config.connection, config.options);
 * });
 *
 * const store = await createEventStore({ type: "redis", connection: "redis://localhost" });
 * ```
 */
export function registerStorageAdapter(
  type: string,
  factory: StorageAdapterFactory,
): void {
  adapterRegistry.set(type, factory);
}

/**
 * Unregister a storage adapter
 */
export function unregisterStorageAdapter(type: string): boolean {
  return adapterRegistry.delete(type);
}

/**
 * Get list of registered adapter types
 */
export function getRegisteredAdapters(): string[] {
  return Array.from(adapterRegistry.keys());
}

/**
 * Create an event store using a registered adapter
 *
 * @example
 * ```typescript
 * // Use built-in memory adapter
 * const memStore = await createEventStore({ type: "memory" });
 *
 * // Use custom registered adapter
 * const redisStore = await createEventStore({
 *   type: "redis",
 *   connection: "redis://localhost:6379",
 *   prefix: "l0_events",
 *   ttl: 7 * 24 * 60 * 60 * 1000, // 7 days
 * });
 * ```
 */
export async function createEventStore(
  config: StorageAdapterConfig,
): Promise<L0EventStore> {
  const factory = adapterRegistry.get(config.type);

  if (!factory) {
    const available = getRegisteredAdapters().join(", ") || "none";
    throw new Error(
      `Unknown storage adapter type: "${config.type}". Available adapters: ${available}`,
    );
  }

  return factory(config);
}

// Register built-in memory adapter
registerStorageAdapter("memory", () => new InMemoryEventStore());

/**
 * Base class for implementing custom storage adapters
 * Provides default implementations that can be overridden
 */
export abstract class BaseEventStore implements L0EventStore {
  protected prefix: string;
  protected ttl: number;

  constructor(config: StorageAdapterConfig = { type: "base" }) {
    this.prefix = config.prefix ?? "l0";
    this.ttl = config.ttl ?? 0;
  }

  /**
   * Get the storage key for a stream
   */
  protected getStreamKey(streamId: string): string {
    return `${this.prefix}:stream:${streamId}`;
  }

  /**
   * Get the storage key for stream metadata
   */
  protected getMetaKey(streamId: string): string {
    return `${this.prefix}:meta:${streamId}`;
  }

  /**
   * Check if an event has expired based on TTL
   */
  protected isExpired(timestamp: number): boolean {
    if (this.ttl === 0) return false;
    return Date.now() - timestamp > this.ttl;
  }

  // Abstract methods that must be implemented
  abstract append(streamId: string, event: L0RecordedEvent): Promise<void>;
  abstract getEvents(streamId: string): Promise<L0EventEnvelope[]>;
  abstract exists(streamId: string): Promise<boolean>;
  abstract delete(streamId: string): Promise<void>;
  abstract listStreams(): Promise<string[]>;

  // Default implementations that can be overridden for optimization
  async getLastEvent(streamId: string): Promise<L0EventEnvelope | null> {
    const events = await this.getEvents(streamId);
    return events.length > 0 ? events[events.length - 1]! : null;
  }

  async getEventsAfter(
    streamId: string,
    afterSeq: number,
  ): Promise<L0EventEnvelope[]> {
    const events = await this.getEvents(streamId);
    return events.filter((e) => e.seq > afterSeq);
  }
}

/**
 * Base class for storage adapters with snapshot support
 */
export abstract class BaseEventStoreWithSnapshots
  extends BaseEventStore
  implements L0EventStoreWithSnapshots
{
  /**
   * Get the storage key for snapshots
   */
  protected getSnapshotKey(streamId: string): string {
    return `${this.prefix}:snapshot:${streamId}`;
  }

  // Abstract snapshot methods
  abstract saveSnapshot(snapshot: L0Snapshot): Promise<void>;
  abstract getSnapshot(streamId: string): Promise<L0Snapshot | null>;

  // Default implementation
  async getSnapshotBefore(
    streamId: string,
    seq: number,
  ): Promise<L0Snapshot | null> {
    const snapshot = await this.getSnapshot(streamId);
    if (snapshot && snapshot.seq <= seq) {
      return snapshot;
    }
    return null;
  }
}

/**
 * File-based event store for local persistence
 * Stores events as JSON files
 */
export class FileEventStore extends BaseEventStoreWithSnapshots {
  private basePath: string;
  private fs: typeof import("fs/promises") | null = null;
  private path: typeof import("path") | null = null;

  constructor(config: StorageAdapterConfig & { basePath?: string }) {
    super(config);
    this.basePath = config.basePath ?? config.connection ?? "./l0-events";
  }

  private async ensureFs(): Promise<void> {
    if (!this.fs) {
      // Dynamic import to avoid issues in browser environments
      this.fs = await import("fs/promises");
      this.path = await import("path");
      await this.fs.mkdir(this.basePath, { recursive: true });
    }
  }

  /**
   * Validate stream ID to prevent path traversal attacks.
   * Only allows alphanumeric characters, hyphens, and underscores.
   * @internal Exposed as static for testing
   * @throws Error if stream ID contains invalid characters
   */
  static validateStreamId(streamId: string): string {
    if (!streamId || streamId.length === 0) {
      throw new Error("Invalid stream ID: must not be empty");
    }
    if (!/^[a-zA-Z0-9_-]+$/.test(streamId)) {
      throw new Error(
        "Invalid stream ID: only alphanumeric characters, hyphens, and underscores are allowed",
      );
    }
    return streamId;
  }

  private getFilePath(streamId: string): string {
    const safeId = FileEventStore.validateStreamId(streamId);
    return this.path!.join(this.basePath, `${safeId}.json`);
  }

  private getSnapshotFilePath(streamId: string): string {
    const safeId = FileEventStore.validateStreamId(streamId);
    return this.path!.join(this.basePath, `${safeId}.snapshot.json`);
  }

  async append(streamId: string, event: L0RecordedEvent): Promise<void> {
    await this.ensureFs();
    const filePath = this.getFilePath(streamId);

    let events: L0EventEnvelope[] = [];
    try {
      const content = await this.fs!.readFile(filePath, "utf-8");
      events = JSON.parse(content);
    } catch {
      // File doesn't exist yet
    }

    const envelope: L0EventEnvelope = {
      streamId,
      seq: events.length,
      event,
    };

    events.push(envelope);
    await this.fs!.writeFile(filePath, JSON.stringify(events, null, 2));
  }

  async getEvents(streamId: string): Promise<L0EventEnvelope[]> {
    await this.ensureFs();
    const filePath = this.getFilePath(streamId);

    try {
      const content = await this.fs!.readFile(filePath, "utf-8");
      const events: L0EventEnvelope[] = JSON.parse(content);

      // Filter expired events if TTL is set
      if (this.ttl > 0) {
        return events.filter((e) => !this.isExpired(e.event.ts));
      }

      return events;
    } catch {
      return [];
    }
  }

  async exists(streamId: string): Promise<boolean> {
    await this.ensureFs();
    const filePath = this.getFilePath(streamId);

    try {
      await this.fs!.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  async delete(streamId: string): Promise<void> {
    await this.ensureFs();
    const filePath = this.getFilePath(streamId);
    const snapshotPath = this.getSnapshotFilePath(streamId);

    try {
      await this.fs!.unlink(filePath);
    } catch {
      // Ignore if file doesn't exist
    }

    try {
      await this.fs!.unlink(snapshotPath);
    } catch {
      // Ignore if file doesn't exist
    }
  }

  async listStreams(): Promise<string[]> {
    await this.ensureFs();

    try {
      const files = await this.fs!.readdir(this.basePath);
      return files
        .filter((f) => f.endsWith(".json") && !f.endsWith(".snapshot.json"))
        .map((f) => f.replace(".json", ""));
    } catch {
      return [];
    }
  }

  async saveSnapshot(snapshot: L0Snapshot): Promise<void> {
    await this.ensureFs();
    const filePath = this.getSnapshotFilePath(snapshot.streamId);
    await this.fs!.writeFile(filePath, JSON.stringify(snapshot, null, 2));
  }

  async getSnapshot(streamId: string): Promise<L0Snapshot | null> {
    await this.ensureFs();
    const filePath = this.getSnapshotFilePath(streamId);

    try {
      const content = await this.fs!.readFile(filePath, "utf-8");
      return JSON.parse(content);
    } catch {
      return null;
    }
  }
}

// Register file adapter
registerStorageAdapter(
  "file",
  (config) =>
    new FileEventStore(config as StorageAdapterConfig & { basePath?: string }),
);

/**
 * Storage interface matching Web Storage API
 */
interface WebStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/**
 * LocalStorage-based event store for browser environments
 */
export class LocalStorageEventStore extends BaseEventStoreWithSnapshots {
  private storage: WebStorage;

  constructor(config: StorageAdapterConfig = { type: "localStorage" }) {
    super(config);

    // Check for browser environment
    const globalObj = typeof globalThis !== "undefined" ? globalThis : {};
    const ls = (globalObj as { localStorage?: WebStorage }).localStorage;

    if (!ls) {
      throw new Error("LocalStorage is not available in this environment");
    }

    this.storage = ls;
  }

  async append(streamId: string, event: L0RecordedEvent): Promise<void> {
    const key = this.getStreamKey(streamId);
    const existing = this.storage.getItem(key);
    const events: L0EventEnvelope[] = existing ? JSON.parse(existing) : [];

    const envelope: L0EventEnvelope = {
      streamId,
      seq: events.length,
      event,
    };

    events.push(envelope);
    this.storage.setItem(key, JSON.stringify(events));

    // Update stream list
    this.addToStreamList(streamId);
  }

  async getEvents(streamId: string): Promise<L0EventEnvelope[]> {
    const key = this.getStreamKey(streamId);
    const content = this.storage.getItem(key);

    if (!content) return [];

    const events: L0EventEnvelope[] = JSON.parse(content);

    // Filter expired events if TTL is set
    if (this.ttl > 0) {
      return events.filter((e) => !this.isExpired(e.event.ts));
    }

    return events;
  }

  async exists(streamId: string): Promise<boolean> {
    const key = this.getStreamKey(streamId);
    return this.storage.getItem(key) !== null;
  }

  async delete(streamId: string): Promise<void> {
    this.storage.removeItem(this.getStreamKey(streamId));
    this.storage.removeItem(this.getSnapshotKey(streamId));
    this.removeFromStreamList(streamId);
  }

  async listStreams(): Promise<string[]> {
    const listKey = `${this.prefix}:streams`;
    const content = this.storage.getItem(listKey);
    return content ? JSON.parse(content) : [];
  }

  async saveSnapshot(snapshot: L0Snapshot): Promise<void> {
    const key = this.getSnapshotKey(snapshot.streamId);
    this.storage.setItem(key, JSON.stringify(snapshot));
  }

  async getSnapshot(streamId: string): Promise<L0Snapshot | null> {
    const key = this.getSnapshotKey(streamId);
    const content = this.storage.getItem(key);
    return content ? JSON.parse(content) : null;
  }

  private addToStreamList(streamId: string): void {
    const listKey = `${this.prefix}:streams`;
    const existing = this.storage.getItem(listKey);
    const streams: string[] = existing ? JSON.parse(existing) : [];

    if (!streams.includes(streamId)) {
      streams.push(streamId);
      this.storage.setItem(listKey, JSON.stringify(streams));
    }
  }

  private removeFromStreamList(streamId: string): void {
    const listKey = `${this.prefix}:streams`;
    const existing = this.storage.getItem(listKey);
    if (!existing) return;

    const streams: string[] = JSON.parse(existing);
    const filtered = streams.filter((s) => s !== streamId);
    this.storage.setItem(listKey, JSON.stringify(filtered));
  }
}

// Register localStorage adapter (only in browser environments)
registerStorageAdapter("localStorage", (config) => {
  return new LocalStorageEventStore(config);
});

/**
 * Composite event store that writes to multiple backends
 * Useful for write-through caching or redundancy
 */
export class CompositeEventStore implements L0EventStore {
  private stores: L0EventStore[];
  private primaryIndex: number;

  /**
   * @param stores - Array of event stores to write to
   * @param primaryIndex - Index of the primary store for reads (default: 0)
   */
  constructor(stores: L0EventStore[], primaryIndex: number = 0) {
    if (stores.length === 0) {
      throw new Error("CompositeEventStore requires at least one store");
    }
    this.stores = stores;
    this.primaryIndex = primaryIndex;
  }

  private get primary(): L0EventStore {
    return this.stores[this.primaryIndex]!;
  }

  async append(streamId: string, event: L0RecordedEvent): Promise<void> {
    // Write to all stores in parallel
    await Promise.all(
      this.stores.map((store) => store.append(streamId, event)),
    );
  }

  async getEvents(streamId: string): Promise<L0EventEnvelope[]> {
    // Read from primary only
    return this.primary.getEvents(streamId);
  }

  async exists(streamId: string): Promise<boolean> {
    return this.primary.exists(streamId);
  }

  async getLastEvent(streamId: string): Promise<L0EventEnvelope | null> {
    return this.primary.getLastEvent(streamId);
  }

  async getEventsAfter(
    streamId: string,
    afterSeq: number,
  ): Promise<L0EventEnvelope[]> {
    return this.primary.getEventsAfter(streamId, afterSeq);
  }

  async delete(streamId: string): Promise<void> {
    // Delete from all stores
    await Promise.all(this.stores.map((store) => store.delete(streamId)));
  }

  async listStreams(): Promise<string[]> {
    return this.primary.listStreams();
  }
}

/**
 * Create a composite event store from multiple stores
 *
 * @example
 * ```typescript
 * // Write-through cache: memory + file
 * const store = createCompositeStore([
 *   createInMemoryEventStore(),
 *   new FileEventStore({ type: "file", basePath: "./events" }),
 * ]);
 * ```
 */
export function createCompositeStore(
  stores: L0EventStore[],
  primaryIndex?: number,
): CompositeEventStore {
  return new CompositeEventStore(stores, primaryIndex);
}

/**
 * Wrapper that adds TTL expiration to any event store
 */
export class TTLEventStore implements L0EventStore {
  private store: L0EventStore;
  private ttl: number;

  constructor(store: L0EventStore, ttlMs: number) {
    this.store = store;
    this.ttl = ttlMs;
  }

  private isExpired(timestamp: number): boolean {
    return Date.now() - timestamp > this.ttl;
  }

  private filterExpired(events: L0EventEnvelope[]): L0EventEnvelope[] {
    return events.filter((e) => !this.isExpired(e.event.ts));
  }

  async append(streamId: string, event: L0RecordedEvent): Promise<void> {
    return this.store.append(streamId, event);
  }

  async getEvents(streamId: string): Promise<L0EventEnvelope[]> {
    const events = await this.store.getEvents(streamId);
    return this.filterExpired(events);
  }

  async exists(streamId: string): Promise<boolean> {
    const events = await this.getEvents(streamId);
    return events.length > 0;
  }

  async getLastEvent(streamId: string): Promise<L0EventEnvelope | null> {
    const events = await this.getEvents(streamId);
    return events.length > 0 ? events[events.length - 1]! : null;
  }

  async getEventsAfter(
    streamId: string,
    afterSeq: number,
  ): Promise<L0EventEnvelope[]> {
    const events = await this.getEvents(streamId);
    return events.filter((e) => e.seq > afterSeq);
  }

  async delete(streamId: string): Promise<void> {
    return this.store.delete(streamId);
  }

  async listStreams(): Promise<string[]> {
    return this.store.listStreams();
  }
}

/**
 * Wrap an event store with TTL expiration
 *
 * @example
 * ```typescript
 * const store = withTTL(createInMemoryEventStore(), 24 * 60 * 60 * 1000); // 24 hours
 * ```
 */
export function withTTL(store: L0EventStore, ttlMs: number): TTLEventStore {
  return new TTLEventStore(store, ttlMs);
}
