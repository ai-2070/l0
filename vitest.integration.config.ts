import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["integration/**/*.integration.ts"],
    testTimeout: 120000, // 120s timeout for LLM calls
    hookTimeout: 60000,
    globals: true,
    // Run tests sequentially to avoid rate limits
    pool: "forks",
    poolOptions: {
      forks: {
        singleFork: true,
      },
    },
  },
});
