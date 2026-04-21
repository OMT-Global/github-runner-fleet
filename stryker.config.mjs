export default {
  plugins: ["@stryker-mutator/vitest-runner"],
  testRunner: "vitest",
  reporters: ["html", "clear-text", "progress"],
  coverageAnalysis: "perTest",
  mutate: [
    "src/lib/autoscale.ts",
    "src/lib/config.ts",
    "src/lib/github.ts",
    "src/lib/doctor.ts",
    "src/lib/env.ts"
  ],
  thresholds: {
    high: 80,
    low: 60,
    break: 50
  }
};
