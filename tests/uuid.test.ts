/**
 * Tests for UUID v7 implementation
 *
 * Validates our built-in implementation against the uuid package.
 * The uuidv7 function auto-detects and uses the uuid package if available,
 * otherwise falls back to the built-in implementation.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { uuidv7, internalV7, _resetState } from "../src/utils/uuid";
import { v7 as uuidv7Reference, validate, version } from "uuid";

describe("uuidv7 (auto-detect)", () => {
  it("should generate valid UUID format", () => {
    const uuid = uuidv7();
    expect(uuid).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });

  it("should generate version 7 UUIDs", () => {
    const uuid = uuidv7();
    expect(uuid[14]).toBe("7");
  });

  it("should be validated by uuid package", () => {
    const uuid = uuidv7();
    expect(validate(uuid)).toBe(true);
    expect(version(uuid)).toBe(7);
  });
});

describe("internalV7 (built-in implementation)", () => {
  beforeEach(() => {
    // Reset state between tests for isolation
    _resetState();
  });

  it("should generate valid UUID format", () => {
    const uuid = internalV7();
    // UUID format: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
    expect(uuid).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });

  it("should generate version 7 UUIDs", () => {
    const uuid = internalV7();
    // Version is in the 7th position (index 14-15 after removing dashes)
    // Format: xxxxxxxx-xxxx-7xxx-xxxx-xxxxxxxxxxxx
    expect(uuid[14]).toBe("7");
  });

  it("should generate UUIDs with correct variant", () => {
    const uuid = internalV7();
    // Variant bits are in position 8 of the 4th group
    // Should be 8, 9, a, or b (10xx binary)
    const variantChar = uuid[19];
    expect(["8", "9", "a", "b"]).toContain(variantChar);
  });

  it("should generate unique UUIDs", () => {
    const uuids = new Set<string>();
    for (let i = 0; i < 1000; i++) {
      uuids.add(internalV7());
    }
    expect(uuids.size).toBe(1000);
  });

  it("should generate time-sortable UUIDs", () => {
    const uuid1 = internalV7();
    // Small delay to ensure different timestamp
    const start = Date.now();
    while (Date.now() === start) {
      // busy wait for next millisecond
    }
    _resetState(); // Reset to get fresh timestamp
    const uuid2 = internalV7();

    // UUIDs should be lexicographically sortable by time
    expect(uuid1 < uuid2).toBe(true);
  });

  it("should be validated by uuid package", () => {
    const uuid = internalV7();
    expect(validate(uuid)).toBe(true);
  });

  it("should be detected as version 7 by uuid package", () => {
    const uuid = internalV7();
    expect(version(uuid)).toBe(7);
  });

  it("should have similar structure to reference implementation", () => {
    const ours = internalV7();
    const reference = uuidv7Reference();

    // Both should be valid
    expect(validate(ours)).toBe(true);
    expect(validate(reference)).toBe(true);

    // Both should be version 7
    expect(version(ours)).toBe(7);
    expect(version(reference)).toBe(7);

    // Both should have same length
    expect(ours.length).toBe(reference.length);
    expect(ours.length).toBe(36);
  });

  it("should extract correct timestamp from UUID", () => {
    const before = Date.now();
    const uuid = internalV7();
    const after = Date.now();

    // Extract timestamp from UUID (first 48 bits = 12 hex chars)
    const hex = uuid.replace(/-/g, "").slice(0, 12);
    const timestamp = parseInt(hex, 16);

    expect(timestamp).toBeGreaterThanOrEqual(before);
    expect(timestamp).toBeLessThanOrEqual(after);
  });

  describe("monotonicity guarantees", () => {
    it("should generate monotonically increasing UUIDs within same millisecond", () => {
      // Generate multiple UUIDs rapidly (likely within same ms)
      const uuids: string[] = [];
      for (let i = 0; i < 100; i++) {
        uuids.push(internalV7());
      }

      // All UUIDs should be strictly increasing
      for (let i = 1; i < uuids.length; i++) {
        expect(uuids[i] > uuids[i - 1]).toBe(true);
      }
    });

    it("should handle sequence increment correctly", () => {
      // Generate UUIDs in rapid succession
      const uuid1 = internalV7();
      const uuid2 = internalV7();
      const uuid3 = internalV7();

      // Should all be unique and increasing
      expect(uuid1 < uuid2).toBe(true);
      expect(uuid2 < uuid3).toBe(true);
    });

    it("should maintain ordering across timestamp boundaries", () => {
      const uuid1 = internalV7();

      // Wait for next millisecond
      const start = Date.now();
      while (Date.now() === start) {
        // busy wait
      }

      const uuid2 = internalV7();

      // UUID from later time should be greater
      expect(uuid2 > uuid1).toBe(true);
    });

    it("sorts 10k UUIDs correctly", () => {
      // Stress test: generate 10k UUIDs and verify they're already sorted
      const ids = Array.from({ length: 10000 }, () => internalV7());
      const sorted = [...ids].sort();
      expect(ids).toEqual(sorted);
    });

    it("monotonic within same ms", () => {
      _resetState();
      const now = Date.now();

      const ids: string[] = [];
      while (Date.now() === now) {
        ids.push(internalV7());
      }

      // Validate monotonicity for whatever IDs were generated
      // (count varies based on timing - may be 1 if ms boundary was near)
      for (let i = 1; i < ids.length; i++) {
        expect(ids[i]! > ids[i - 1]!).toBe(true);
      }
    });
  });

  describe("timestamp handling edge cases", () => {
    it("should handle large timestamps correctly (no 32-bit overflow)", () => {
      // Current timestamps are around 1.7 trillion (well over 32-bit max of ~4 billion)
      const uuid = internalV7();
      const hex = uuid.replace(/-/g, "").slice(0, 12);
      const timestamp = parseInt(hex, 16);

      // Should be a reasonable current timestamp (after 2020)
      const year2020 = new Date("2020-01-01").getTime();
      const year2100 = new Date("2100-01-01").getTime();

      expect(timestamp).toBeGreaterThan(year2020);
      expect(timestamp).toBeLessThan(year2100);
    });
  });
});
