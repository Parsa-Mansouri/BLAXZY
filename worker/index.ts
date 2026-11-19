import "dotenv/config";
import { closeDb, setDbApplicationName } from "../src/server/db/client";
import { getEnv } from "../src/server/env";
import { onGenerationFinished } from "../src/server/generation";
import { startHeartbeat } from "../src/server/health";
import { startWorker, stopWorker } from "../src/server/jobs";
import { errorMessage, logLine } from "../src/server/jobs/log";
import { generationHooks, handlers, schedules } from "./handlers";

async function main(): Promise<void> {
  const env = getEnv(); // fail fast on invalid configuration
  setDbApplicationName("blaxzy-worker");

  // Worker liveness for the readiness check (set once the worker runs; stopped before the db).
  const liveness: { heartbeat?: ReturnType<typeof startHeartbeat> } = {};
  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    logLine("info", "worker shutting down", { signal });
    try {
      // Resolves once no handler runs any more (finished, or interrupted and given back to the
      // queue): only then is the database closed under them.
      await stopWorker(env.WORKER_SHUTDOWN_TIMEOUT_SECONDS * 1000);
      await liveness.heartbeat?.stop();
      await closeDb();
    } catch (err) {
      logLine("error", "worker shutdown failed", { error: errorMessage(err) });
      process.exitCode = 1;
    } finally {
      clearInterval(keepAlive);
      logLine("info", "worker stopped");
      // Exit even if a library left a handle open.
      setTimeout(() => process.exit(), 5_000).unref();
    }
  };

  // Keeps the event loop alive until a shutdown signal arrives.
  const keepAlive = setInterval(() => {}, 1 << 30);
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));

  // Completion hooks first, so no generation finishes before they are in place. Once per process.
  for (const hook of generationHooks) onGenerationFinished(hook);

  await startWorker({
    handlers,
    schedules,
    concurrency: { default: env.WORKER_CONCURRENCY_DEFAULT, perJob: env.WORKER_CONCURRENCY },
    pollingIntervalSeconds: env.WORKER_POLL_INTERVAL_SECONDS,
  });
  liveness.heartbeat = startHeartbeat();
  logLine("info", "worker started", { instance: liveness.heartbeat.instance.id });
}

main().catch((err: unknown) => {
  logLine("error", "worker failed to start", { error: errorMessage(err) });
  process.exit(1);
});
