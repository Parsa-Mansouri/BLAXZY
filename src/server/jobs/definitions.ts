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

/*
 * Generation engine (see docs/M2_M3_CONTRACTS.md). One job per generation: create the provider job
 * once, poll it, store the result, settle or refund. A handler over the per-user limit schedules a
 * follow-up of itself (`allowFollowUp`) instead of failing.
 */
export const generationRun = defineJob({
  name: "generation.run",
  payload: z.object({ generationId: z.string().uuid() }),
  options: {
    retryLimit: 3,
    retryDelaySeconds: 5,
    retryBackoff: true,
    retryDelayMaxSeconds: 120,
    expireInSeconds: 20 * 60,
  },
  dedupeKey: (p) => p.generationId,
  allowFollowUp: true,
});

/**
 * Fails and refunds generations stuck in `queued` or `running` (see docs/M4_CONTRACTS.md). Run by
 * the worker's schedule every 5 minutes (one schedule for the whole fleet); one sweep at a time.
 */
export const generationSweep = defineJob({
  name: "generation.sweep",
  payload: z.object({}),
  options: { retryLimit: 1, retryDelaySeconds: 60, retryBackoff: false, expireInSeconds: 10 * 60 },
  dedupeKey: () => "sweep",
});

/*
 * Pre-production (see docs/M2_M3_CONTRACTS.md). Each job writes the image prompt with a dami
 * (unless one is stored already), then requests the generation; the generation's completion hook
 * moves the look or sheet to review.
 */
const lookPayload = z.object({ lookId: z.string().uuid() });
const sheetPayload = z.object({ sheetId: z.string().uuid() });

/** Write a look's prompt (asset-prompt-writer) and request its image. */
export const assetLookGenerate = defineJob({
  name: "asset.look.generate",
  payload: lookPayload,
  options: damiJob,
  dedupeKey: (p) => p.lookId,
});

/** Fix a rejected look's prompt from its review (asset-fixer) and request the new image. */
export const assetLookFix = defineJob({
  name: "asset.look.fix",
  payload: lookPayload,
  options: damiJob,
  dedupeKey: (p) => p.lookId,
});

/** Write a sheet's prompt (sheet-generator) and request it with the accepted look attached. */
export const assetSheetGenerate = defineJob({
  name: "asset.sheet.generate",
  payload: sheetPayload,
  options: damiJob,
  dedupeKey: (p) => p.sheetId,
});

/** Fix a rejected sheet's prompt from its review (sheet-fixer) and request the new sheet. */
export const assetSheetFix = defineJob({
  name: "asset.sheet.fix",
  payload: sheetPayload,
  options: damiJob,
  dedupeKey: (p) => p.sheetId,
});
