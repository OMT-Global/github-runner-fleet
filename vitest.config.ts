import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov", "html"],
      include: ["src/**/*.ts"],
      reportsDirectory: "coverage",
      thresholds: {
        lines: 80,
        branches: 75,
        functions: 80,
        statements: 80,
        "src/lib/**/*.ts": {
          lines: 80
        }
      }
    }
  }
});
