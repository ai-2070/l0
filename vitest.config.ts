import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    // Test environment
    environment: "node",

    // Global test setup
    globals: true,

    // Coverage configuration
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html", "lcov"],
      exclude: [
        "node_modules/**",
        "dist/**",
        "tests/**",
        "**/*.test.ts",
        "**/*.spec.ts",
        "**/types/**",
        "vitest.config.ts",
      ],
      include: ["src/**/*.ts"],
      all: true,
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 80,
        statements: 80,
      },
    },

    // Test file patterns
    include: ["tests/**/*.test.ts", "tests/**/*.spec.ts"],

    // Test timeout
    testTimeout: 10000,
    hookTimeout: 10000,

    // Retry failed tests
    retry: 0,

    // Reporter
    reporter: ["verbose", "json", "html"],

    // Mock options
    mockReset: true,
    restoreMocks: true,
    clearMocks: true,
  },

  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
