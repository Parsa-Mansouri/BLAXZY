import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    environment: "node",
    // Damis answer from the sample generators, instantly (dotenv never overrides these).
    env: { DAMI_MODE: "sample", DAMI_SAMPLE_DELAY_MS: "0" },
    include: ["src/**/*.test.ts", "worker/**/*.test.ts"],
  },
});
