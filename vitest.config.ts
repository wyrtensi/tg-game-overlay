import { defineConfig } from "vitest/config";

// The app's unit tests only; server/ has its own node:test suite.
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
  },
});
