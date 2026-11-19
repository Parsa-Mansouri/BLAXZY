import "dotenv/config";
import { closeDb, setDbApplicationName } from "../src/server/db/client";
import { getEnv } from "../src/server/env";
import { onGenerationFinished } from "../src/server/generation";
import { startHeartbeat } from "../src/server/health";
import { startWorker, stopWorker } from "../src/server/jobs";
import { logLine } from "../src/server/jobs/log";
import { flushTracker } from "../src/server/observability/tracker";
import { generationHooks, handlers, schedules } from "./handlers";
import { startWorkerTracking } from "./tracking";

// --- Error tracking and fatal process errors --------------------------------------------------
/** Longest wait for the error tracker to send what is queued before the process goes on. */
const FLUSH_TIMEOUT_MS = 2_000;
/** Set by main() once the worker runs: stops it gracefully (jobs given back, database closed). */
let gracefulShutdown: ((reason: string) => Promise<void>) | undefined;
let failing = false;

/**
 * An unhandled rejection or uncaught exception leaves the process in an unknown state: log and
 * report it, flush the tracker (bounded), then shut down gracefully and exit non-zero. A hard
 * deadline makes sure the process exits even if the shutdown hangs.
 */
async function onFatal(kind: string, err: unknown): Promise<void> {
  logLine("error", `worker ${kind}`, { exception: err, alert: true });
  if (failing) return;
  failing = true;
  process.exitCode = 1;
  let shutdownSeconds = 25;
  try {
    shutdownSeconds = getEnv().WORKER_SHUTDOWN_TIMEOUT_SECONDS;
  } catch {
    // Invalid configuration: keep the default.
  }
  setTimeout(() => process.exit(1), shutdownSeconds * 1000 + 20_000).unref();
  await flushTracker(FLUSH_TIMEOUT_MS);
  if (gracefulShutdown) await gracefulShutdown(kind);
  else process.exit(1);
}

process.on("unhandledRejection", (reason) => void onFatal("unhandledRejection", reason));
process.on("uncaughtException", (err) => void onFatal("uncaughtException", err));
// --- end error tracking ------------------------------------------------------------------------

async function main(): Promise<void> {
  await startWorkerTracking(); // before anything else can fail; a no-op without SENTRY_DSN
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
      logLine("error", "worker shutdown failed", { exception: err });
      process.exitCode = 1;
    } finally {
      clearInterval(keepAlive);
      logLine("info", "worker stopped");
      await flushTracker(FLUSH_TIMEOUT_MS);
      // Exit even if a library left a handle open.
      setTimeout(() => process.exit(), 5_000).unref();
    }
  };

  // Keeps the event loop alive until a shutdown signal arrives.
  const keepAlive = setInterval(() => {}, 1 << 30);
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  gracefulShutdown = shutdown;

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

main().catch(async (err: unknown) => {
  logLine("error", "worker failed to start", { exception: err });
  await flushTracker(FLUSH_TIMEOUT_MS);
  process.exit(1);
});
