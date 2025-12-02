/**
 * UUID v7 Generator
 *
 * Generates time-sortable UUIDs per RFC 9562.
 * Format: tttttttt-tttt-7xxx-yxxx-xxxxxxxxxxxx
 * - t: 48-bit Unix timestamp in milliseconds
 * - 7: version (7)
 * - x: sequence + random bits
 * - y: variant (8, 9, a, or b)
 *
 * Uses the `uuid` package if available, otherwise falls back to built-in implementation.
 * Based on https://github.com/uuidjs/uuid/blob/main/src/v7.ts
 */

// Auto-detect optional uuid dependency at runtime
let externalV7: undefined | (() => string);

try {
  // Optional dependency - don't error if missing
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { v7 } = require("uuid");
  if (typeof v7 === "function") externalV7 = v7;
} catch {
  // Ignore - use built-in fallback
}

/**
 * Generate a UUID v7 string
 * @returns UUID v7 in standard format (xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx)
 */
export function uuidv7(): string {
  if (externalV7) {
    return externalV7();
  }
  return internalV7();
}

// Internal state for monotonicity
type V7State = {
  msecs: number; // last timestamp
  seq: number; // sequence number (32-bits)
};

const _state: V7State = {
  msecs: -Infinity,
  seq: 0,
};

/**
 * Get random bytes using crypto API or Math.random fallback
 */
function getRandomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  if (typeof crypto !== "undefined" && crypto.getRandomValues) {
    crypto.getRandomValues(bytes);
  } else {
    // Fallback for environments without crypto
    for (let i = 0; i < length; i++) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }
  return bytes;
}

/**
 * Update state for monotonic UUID generation
 * Based on uuid package's updateV7State
 */
function updateV7State(state: V7State, now: number, rnds: Uint8Array): void {
  if (now > state.msecs) {
    // New millisecond - reset sequence from random
    state.seq =
      (rnds[6]! << 23) | (rnds[7]! << 16) | (rnds[8]! << 8) | rnds[9]!;
    state.msecs = now;
  } else {
    // Same or earlier millisecond - increment sequence
    state.seq = (state.seq + 1) | 0;

    // Handle sequence overflow by advancing time
    if (state.seq === 0) {
      state.msecs++;
    }
  }
}

/**
 * Convert bytes to UUID string format
 */
function bytesToUuid(bytes: Uint8Array): string {
  const hex = Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * Built-in UUID v7 implementation (exported for testing)
 * Based on https://github.com/uuidjs/uuid/blob/main/src/v7.ts
 */
export function internalV7(): string {
  const now = Date.now();
  const rnds = getRandomBytes(16);

  // Update state for monotonicity
  updateV7State(_state, now, rnds);

  const msecs = _state.msecs;
  const seq = _state.seq;

  // Build the UUID bytes
  const buf = new Uint8Array(16);

  // bytes 0-5: 48-bit timestamp (big-endian)
  // Use right-shift assignment to avoid floating-point division
  // and unsafe bitwise operations on >32-bit numbers
  let ts = msecs;
  buf[5] = ts & 0xff;
  ts = Math.floor(ts / 256);
  buf[4] = ts & 0xff;
  ts = Math.floor(ts / 256);
  buf[3] = ts & 0xff;
  ts = Math.floor(ts / 256);
  buf[2] = ts & 0xff;
  ts = Math.floor(ts / 256);
  buf[1] = ts & 0xff;
  ts = Math.floor(ts / 256);
  buf[0] = ts & 0xff;

  // byte 6: version (4 bits) | sequence bits 28-31 (4 bits)
  buf[6] = 0x70 | ((seq >>> 28) & 0x0f);

  // byte 7: sequence bits 20-27 (8 bits)
  buf[7] = (seq >>> 20) & 0xff;

  // byte 8: variant (2 bits) | sequence bits 14-19 (6 bits)
  buf[8] = 0x80 | ((seq >>> 14) & 0x3f);

  // byte 9: sequence bits 6-13 (8 bits)
  buf[9] = (seq >>> 6) & 0xff;

  // byte 10: sequence bits 0-5 (6 bits) | random (2 bits)
  buf[10] = ((seq << 2) & 0xff) | (rnds[10]! & 0x03);

  // bytes 11-15: random (40 bits)
  buf[11] = rnds[11]!;
  buf[12] = rnds[12]!;
  buf[13] = rnds[13]!;
  buf[14] = rnds[14]!;
  buf[15] = rnds[15]!;

  return bytesToUuid(buf);
}

/**
 * Reset internal state (exported for testing only)
 */
export function _resetState(): void {
  _state.msecs = -Infinity;
  _state.seq = 0;
}
