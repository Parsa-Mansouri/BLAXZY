import { fileURLToPath } from "node:url";
import "dotenv/config";
import { defineConfig } from "vitest/config";

// An optional dedicated test database replaces DATABASE_URL for the whole run (workers inherit
// it through `env` below; dotenv never overrides a variable that is already set).
const testDatabaseUrl = process.env.TEST_DATABASE_URL;
if (testDatabaseUrl) process.env.DATABASE_URL = testDatabaseUrl;

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    environment: "node",
    // Probes Postgres, migrations, S3 and ffmpeg once, applies the local-host guard and the
    // CI / REQUIRE_INTEGRATION / SKIP_INTEGRATION policy (see the file's header).
    globalSetup: ["./src/server/test-support/global-setup.ts"],
    // Damis answer from the sample generators, instantly (dotenv never overrides these).
    // Generations use the sample provider and finish at once.
    env: {
      DAMI_MODE: "sample",
      DAMI_SAMPLE_DELAY_MS: "0",
      GENERATION_PROVIDER: "sample",
      GENERATION_SAMPLE_DELAY_MS: "0",
      // The per-user limit test assumes the default, whatever a local .env sets.
      GENERATION_MAX_PER_USER: "3",
      // Every integration file has its own pg pool and pg-boss pools and files run in
      // parallel: small pools keep the total far below Postgres' default 100 connections.
      DATABASE_POOL_MAX: process.env.DATABASE_POOL_MAX ?? "3",
      JOBS_WEB_POOL_MAX: process.env.JOBS_WEB_POOL_MAX ?? "2",
      JOBS_WORKER_POOL_MAX: process.env.JOBS_WORKER_POOL_MAX ?? "3",
      ...(testDatabaseUrl ? { DATABASE_URL: testDatabaseUrl } : {}),
    },
    // Integration tests hit Postgres and the object store; on a busy machine the 5 s default
    // produces false failures.
    testTimeout: 30_000,
    hookTimeout: 30_000,
    // At most 4 files at once (about 4 x (3 + 2 + 3) connections at worst).
    maxWorkers: 4,
    include: ["{src,worker,scripts}/**/*.{test,spec}.{ts,tsx}"],
  },
});
