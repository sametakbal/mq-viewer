import { defineConfig } from "vitest/config";

// Unit tests for the frontend logic (src/lib, state). React components are not part of the coverage gate.
export default defineConfig({
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.ts"],
    restoreMocks: true,
    coverage: {
      provider: "v8",
      include: ["src/lib/**/*.ts", "src/state.ts"],
      exclude: ["src/**/*.test.ts", "src/lib/types.ts", "src/lib/mock.ts"],
      reporter: ["text", "html", "lcov"],
      thresholds: { lines: 90, statements: 90, functions: 90, branches: 90 },
    },
  },
});
