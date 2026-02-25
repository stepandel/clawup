import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/cli/__e2e__/**/*.e2e.test.ts"],
    testTimeout: 600_000, // 10 minutes per test
    hookTimeout: 300_000, // 5 minutes for setup/teardown
    sequence: { concurrent: false },
    fileParallelism: false, // Run test files sequentially
    env: {
      PULUMI_SKIP_UPDATE_CHECK: "true",
    },
  },
});
