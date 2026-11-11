import "dotenv/config";
import { closeDb } from "../src/server/db/client";
import { getEnv } from "../src/server/env";
import { onGenerationFinished } from "../src/server/generation";
import { startWorker, stopWorker } from "../src/server/jobs";
import { assetGenerationHook, handlers } from "./handlers";

async function main(): Promise<void> {
  const env = getEnv(); // fail fast on invalid configuration

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`worker received ${signal}, shutting down`);
    try {
      // Drain in-flight jobs first: handlers may still use the database.
      await stopWorker(env.WORKER_SHUTDOWN_TIMEOUT_SECONDS * 1000);
      await closeDb();
    } catch (err) {
      console.error("worker shutdown failed", err);
      process.exitCode = 1;
    } finally {
      clearInterval(keepAlive);
      console.log("worker stopped");
      // Exit even if a library left a handle open.
      setTimeout(() => process.exit(), 5_000).unref();
    }
  };

  // Keeps the event loop alive until a shutdown signal arrives.
  const keepAlive = setInterval(() => {}, 1 << 30);
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));

  // Completion hooks first, so no generation finishes before they are in place. Once per process.
  onGenerationFinished(assetGenerationHook);

  await startWorker({
    handlers,
    concurrency: { default: env.WORKER_CONCURRENCY_DEFAULT, perJob: env.WORKER_CONCURRENCY },
    pollingIntervalSeconds: env.WORKER_POLL_INTERVAL_SECONDS,
  });
  console.log("worker started");
}

main().catch((err: unknown) => {
  console.error("worker failed to start", err);
  process.exit(1);
});
