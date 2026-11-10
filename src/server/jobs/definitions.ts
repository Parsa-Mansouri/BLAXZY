/**
 * The job registry: every job type, defined once. Web code imports a definition to enqueue it;
 * the worker binds a handler to it (`worker/handlers`). Keep this file free of heavy imports.
 */
import { z } from "zod";
import { defineJob } from "./define";

/** Health check: the handler logs the message. */
export const systemPing = defineJob({
  name: "system.ping",
  payload: z.object({ message: z.string().min(1).max(500) }),
  options: { retryLimit: 1, retryDelaySeconds: 1, expireInSeconds: 60 },
});
