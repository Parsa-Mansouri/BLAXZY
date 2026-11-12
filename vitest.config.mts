import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    environment: "node",
    // Damis answer from the sample generators, instantly (dotenv never overrides these).
    // Generations use the sample provider and finish at once.
    env: {
      DAMI_MODE: "sample",
      DAMI_SAMPLE_DELAY_MS: "0",
      GENERATION_PROVIDER: "sample",
      GENERATION_SAMPLE_DELAY_MS: "0",
      // The per-user limit test assumes the default, whatever a local .env sets.
      GENERATION_MAX_PER_USER: "3",
    },
    // Integration tests hit Postgres and the object store; on a busy machine the 5 s default
    // produces false failures.
    testTimeout: 30_000,
    hookTimeout: 30_000,
    include: ["src/**/*.test.ts", "worker/**/*.test.ts"],
  },
});
