import "dotenv/config";
import { closeDb } from "../src/server/db/client";
import { getEnv } from "../src/server/env";

async function main(): Promise<void> {
  getEnv(); // fail fast on invalid configuration
  console.log("worker started");

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`worker received ${signal}, shutting down`);
    try {
      await closeDb();
    } finally {
      clearInterval(keepAlive);
      console.log("worker stopped");
    }
  };

  // Keeps the event loop alive until a shutdown signal arrives.
  const keepAlive = setInterval(() => {}, 1 << 30);
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((err: unknown) => {
  console.error("worker failed to start", err);
  process.exit(1);
});
