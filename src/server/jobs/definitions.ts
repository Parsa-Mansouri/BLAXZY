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

/**
 * Long pieces: write one sequence of the approved outline (write_segment), then queue the next;
 * the last one stitches the script. Sequential, so each continues from the previous one's ledger.
 */
export const scriptWriteSegment = defineJob({
  name: "script.write-segment",
  payload: z.object({
    scriptVersionId: z.string().uuid(),
    segmentIndex: z.number().int().min(0).max(1000),
  }),
  options: damiJob,
  dedupeKey: (p) => `${p.scriptVersionId}:${p.segmentIndex}`,
});

/** Rewrite the user's quick idea with the Enhancer (their own text is kept if it fails). */
export const scriptEnhance = defineJob({
  name: "script.enhance",
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

/**
 * One correction round of the detected asset list ("Something wrong with this list?"): the
 * Asset Detector in fix mode with the review's fix requests, or a re-scan (incremental).
 */
export const assetDetectFix = defineJob({
  name: "asset.detect.fix",
  payload: z.object({ reviewId: z.string().uuid() }),
  options: damiJob,
  dedupeKey: (p) => p.reviewId,
});

/**
 * Cut an accepted script into prompt blocks. `resection`: cut it again although it has blocks (the
 * detected assets changed in a correction round, so the blocks must name the new list).
 */
export const scriptSection = defineJob({
  name: "script.section",
  payload: scriptPayload.extend({ resection: z.boolean().optional() }),
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

/** Design a look with the asset's designer (character, location or prop generator) and request its image. */
export const assetLookGenerate = defineJob({
  name: "asset.look.generate",
  payload: lookPayload,
  options: damiJob,
  dedupeKey: (p) => p.lookId,
});

/** A rejected look's next version: the designer in fix mode (or a re-roll), then the new image. */
export const assetLookFix = defineJob({
  name: "asset.look.fix",
  payload: lookPayload,
  options: damiJob,
  dedupeKey: (p) => p.lookId,
});

/** A character sheet: sheet-generator-character writes its prompt, then the sheet is requested with the approved board attached. */
export const assetSheetGenerate = defineJob({
  name: "asset.sheet.generate",
  payload: sheetPayload,
  options: damiJob,
  dedupeKey: (p) => p.sheetId,
});

/** A rejected character sheet's next version: sheet-generator-character in fix mode (or a re-roll), then the new sheet. */
export const assetSheetFix = defineJob({
  name: "asset.sheet.fix",
  payload: sheetPayload,
  options: damiJob,
  dedupeKey: (p) => p.sheetId,
});

/**
 * A location pack or prop sheet: the sheet maker (sheet-generator-location or -prop) writes the
 * views and they are stored as planned `asset_sheet_view` rows. With `viewRowId`: a fix round
 * that re-writes that one view (only_views) from its review.
 */
export const assetSheetPlan = defineJob({
  name: "asset.sheet.plan",
  payload: sheetPayload.extend({ viewRowId: z.string().uuid().optional() }),
  options: damiJob,
  dedupeKey: (p) => `${p.sheetId}:${p.viewRowId ?? "plan"}`,
});

/**
 * Requests every planned view of a pack whose dependencies are approved (at most four approved
 * views attached). Enqueued after planning, after a view's image settles and after a view is
 * approved; one run per sheet at a time, with one follow-up queued beside it.
 */
export const assetSheetViewsAdvance = defineJob({
  name: "asset.sheet.views.advance",
  payload: sheetPayload,
  options: { retryLimit: 3, retryDelaySeconds: 5, retryBackoff: true, expireInSeconds: 10 * 60 },
  dedupeKey: (p) => p.sheetId,
  allowFollowUp: true,
});

/** Builds a locked pack's contact sheet (people only; never sent to a model) with sharp. */
export const assetSheetAssemble = defineJob({
  name: "asset.sheet.assemble",
  payload: sheetPayload,
  options: { retryLimit: 3, retryDelaySeconds: 10, retryBackoff: true, expireInSeconds: 10 * 60 },
  dedupeKey: (p) => p.sheetId,
});

/*
 * Production (see docs/M4_CONTRACTS.md). Preparation and fixes run a dami; a take's job requests
 * its generation, whose completion hook moves the take to review. Every job is keyed by its row,
 * and every handler checks the row is still waiting for it.
 */
const blockPayload = z.object({ blockId: z.string().uuid() });
const takePayload = z.object({ takeId: z.string().uuid() });

/** Prepare a block version for generation (text-blocks). */
export const productionPrepare = defineJob({
  name: "production.prepare",
  payload: blockPayload,
  options: damiJob,
  dedupeKey: (p) => p.blockId,
});

/** Revise a block version from the review of its predecessor (block-reviser). */
export const blockRevise = defineJob({
  name: "block.revise",
  payload: blockPayload,
  options: damiJob,
  dedupeKey: (p) => p.blockId,
});

/** Request a take's generation (a draft, or a final from its accepted draft). */
export const takeGenerate = defineJob({
  name: "take.generate",
  payload: takePayload,
  options: damiJob,
  dedupeKey: (p) => p.takeId,
});

/** Fix a rejected take's prompt from its review (take-fixer), then request the new draft. */
export const takeFix = defineJob({
  name: "take.fix",
  payload: takePayload,
  options: damiJob,
  dedupeKey: (p) => p.takeId,
});

/** Build the ZIP of a project's finished clips, streamed from and to object storage. */
export const exportBuild = defineJob({
  name: "export.build",
  payload: z.object({ exportId: z.string().uuid() }),
  options: { retryLimit: 2, retryDelaySeconds: 30, retryBackoff: true, expireInSeconds: 60 * 60 },
  dedupeKey: (p) => p.exportId,
});
