// Integration Test Setup
// These tests require real API keys and make actual API calls

import { config } from "dotenv";
config(); // Load .env file

import { describe, it, expect, beforeAll } from "vitest";

// Enable all L0 optional features for integration tests
import "../tests/enable-features";

export const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
export const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

export const hasOpenAI = !!OPENAI_API_KEY;
export const hasAnthropic = !!ANTHROPIC_API_KEY;

// Skip helper for conditional tests
export const describeIf = (condition: boolean) =>
  condition ? describe : describe.skip;

export const itIf = (condition: boolean) => (condition ? it : it.skip);

// Timeout for LLM calls (30 seconds)
export const LLM_TIMEOUT = 30000;

// Log which integrations are available
beforeAll(() => {
  console.log("\n=== Integration Test Environment ===");
  console.log(`OpenAI API Key: ${hasOpenAI ? "✓ Available" : "✗ Missing"}`);
  console.log(
    `Anthropic API Key: ${hasAnthropic ? "✓ Available" : "✗ Missing"}`,
  );
  console.log("");

  if (!hasOpenAI && !hasAnthropic) {
    console.log(
      "⚠ No API keys found. Set OPENAI_API_KEY or ANTHROPIC_API_KEY to run integration tests.",
    );
  }
});

// Helper to check response validity
export function expectValidResponse(content: string) {
  expect(content).toBeDefined();
  expect(content.length).toBeGreaterThan(0);
  expect(content.trim()).not.toBe("");
}

// Helper for JSON validation
export function expectValidJSON(content: string) {
  expectValidResponse(content);
  expect(() => JSON.parse(content)).not.toThrow();
  return JSON.parse(content);
}
