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

/* Script stage (see docs/M1_CONTRACTS.md). Dami calls can run for minutes. */
const scriptPayload = z.object({ scriptVersionId: z.string().uuid() });
const damiJob = { retryLimit: 2, retryDelaySeconds: 15, expireInSeconds: 40 * 60 } as const;

/** Write a script from the user's brief. */
export const scriptWrite = defineJob({
  name: "script.write",
  payload: scriptPayload,
  options: damiJob,
  dedupeKey: (p) => p.scriptVersionId,
});

/** Extract an uploaded script's text and check it. */
export const scriptCheck = defineJob({
  name: "script.check",
  payload: scriptPayload,
  options: damiJob,
  dedupeKey: (p) => p.scriptVersionId,
});

/** Revise a rejected script from its review. */
export const scriptRevise = defineJob({
  name: "script.revise",
  payload: scriptPayload,
  options: damiJob,
  dedupeKey: (p) => p.scriptVersionId,
});

/** Detect the assets of an accepted script, then queue sectioning. */
export const scriptDetectAssets = defineJob({
  name: "script.detect-assets",
  payload: scriptPayload,
  options: damiJob,
});

/** Cut an accepted script into prompt blocks. */
export const scriptSection = defineJob({
  name: "script.section",
  payload: scriptPayload,
  options: { ...damiJob, expireInSeconds: 90 * 60 },
});
