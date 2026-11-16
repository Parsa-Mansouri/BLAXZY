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

/*
 * A job that runs a Creative Bible consumer waits for a bible that is still compiling by queueing
 * a delayed copy of itself with `bibleWaits` raised by one (worker/handlers/creative-bible.ts).
 * The count is part of the dedupe key from the first wait on, so each follow-up has a key of its
 * own: it is not deduped against the job that queues it (which is still running) and never
 * against a fresh request (key without a count). The count is bounded by the 10-minute limit.
 */
const bibleWaits = z.number().int().min(1).max(200).optional();
const waitKey = (key: string, p: { bibleWaits?: number | undefined }) =>
  p.bibleWaits ? `${key}:wait${p.bibleWaits}` : key;

/* Script stage (see docs/M1_CONTRACTS.md). Dami calls can run for minutes. */
const scriptPayload = z.object({ scriptVersionId: z.string().uuid() });
const scriptBiblePayload = scriptPayload.extend({ bibleWaits });
const damiJob = { retryLimit: 2, retryDelaySeconds: 15, expireInSeconds: 40 * 60 } as const;

/**
 * Compile a project's Creative Bible (the Creative DNA dami) after its Style is saved. Keyed by the
 * bible row; the handler skips a row that is no longer pending.
 */
export const projectCreativeDna = defineJob({
  name: "project.creative-dna",
  payload: z.object({ bibleId: z.string().uuid() }),
  options: damiJob,
  dedupeKey: (p) => p.bibleId,
});

/**
 * Name a project (the Project Namer dami) from the first story the user gave: the script version
 * that holds it. One per project; the handler does nothing unless the title is still the
 * placeholder, and applies the name only if it still is.
 */
export const projectName = defineJob({
  name: "project.name",
  payload: z.object({ projectId: z.string().uuid(), scriptVersionId: z.string().uuid() }),
  options: { ...damiJob, expireInSeconds: 10 * 60 },
  dedupeKey: (p) => p.projectId,
});

/** Write a script from the user's brief. */
export const scriptWrite = defineJob({
  name: "script.write",
  payload: scriptBiblePayload,
  options: damiJob,
  dedupeKey: (p) => waitKey(p.scriptVersionId, p),
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
    bibleWaits,
  }),
  options: damiJob,
  dedupeKey: (p) => waitKey(`${p.scriptVersionId}:${p.segmentIndex}`, p),
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
  payload: scriptBiblePayload,
  options: damiJob,
  dedupeKey: (p) => waitKey(p.scriptVersionId, p),
});

/** Revise a rejected script from its review. */
export const scriptRevise = defineJob({
  name: "script.revise",
  payload: scriptBiblePayload,
  options: damiJob,
  dedupeKey: (p) => waitKey(p.scriptVersionId, p),
});

/**
 * Detect the assets of an accepted script, then queue the Director. One run per version at a time
 * (the detector is paid). The queue predates the dedupe key; `ensureQueue` upgrades it in place.
 */
export const scriptDetectAssets = defineJob({
  name: "script.detect-assets",
  payload: scriptPayload,
  options: damiJob,
  dedupeKey: (p) => p.scriptVersionId,
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
 * Direct an accepted script (the Director dami): its blocks, with staging, shots and prompts.
 * `resection`: direct it again although it has blocks (the detected assets changed in a
 * correction round, so the blocks must name the new list). A script of up to ~8 blocks is one
 * `full` call; a longer one is a `plan` call and then one `direction.write` job per batch.
 * Waits for a Creative Bible that is still compiling, like the other bible consumers.
 */
export const scriptDirect = defineJob({
  name: "script.direct",
  payload: scriptBiblePayload.extend({ resection: z.boolean().optional() }),
  options: { ...damiJob, expireInSeconds: 90 * 60 },
  // One run per version (and kind) at a time: the Director is paid.
  dedupeKey: (p) => waitKey(`${p.scriptVersionId}:${p.resection ? "resection" : "direct"}`, p),
});

/**
 * One `write_blocks` batch of a planned direction. Keyed by the batch: a duplicate send is
 * dropped, and the handler stores a batch once (the last one to finish assembles the blocks).
 */
export const directionWrite = defineJob({
  name: "direction.write",
  payload: z.object({
    directionId: z.string().uuid(),
    batchIndex: z.number().int().min(0).max(1000),
  }),
  options: { ...damiJob, expireInSeconds: 60 * 60 },
  dedupeKey: (p) => `${p.directionId}:${p.batchIndex}`,
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

/**
 * Marks dami runs stuck in `running` (their process died) as aborted. Run by the worker's schedule
 * every 15 minutes (one schedule for the whole fleet); one sweep at a time.
 */
export const damiSweep = defineJob({
  name: "dami.sweep",
  payload: z.object({}),
  options: { retryLimit: 1, retryDelaySeconds: 60, retryBackoff: false, expireInSeconds: 10 * 60 },
  dedupeKey: () => "sweep",
});

/**
 * Marks uploads still `pending` long after they started as abandoned and removes their objects.
 * Every 15 minutes, one sweep at a time.
 */
export const fileSweep = defineJob({
  name: "file.sweep",
  payload: z.object({}),
  options: { retryLimit: 1, retryDelaySeconds: 60, retryBackoff: false, expireInSeconds: 10 * 60 },
  dedupeKey: () => "sweep",
});

/**
 * Deletes old server-action rate-limit windows (`src/server/ratelimit`). Every 5 minutes, one
 * prune at a time.
 */
export const ratelimitPrune = defineJob({
  name: "ratelimit.prune",
  payload: z.object({}),
  options: { retryLimit: 1, retryDelaySeconds: 60, retryBackoff: false, expireInSeconds: 5 * 60 },
  dedupeKey: () => "prune",
});

/*
 * Pre-production (see docs/M2_M3_CONTRACTS.md). Each job writes the image prompt with a dami
 * (unless one is stored already), then requests the generation; the generation's completion hook
 * moves the look or sheet to review.
 */
const lookPayload = z.object({ lookId: z.string().uuid(), bibleWaits });
const sheetPayload = z.object({ sheetId: z.string().uuid() });
const sheetBiblePayload = sheetPayload.extend({ bibleWaits });

/** Design a look with the asset's designer (character, location or prop generator) and request its image. */
export const assetLookGenerate = defineJob({
  name: "asset.look.generate",
  payload: lookPayload,
  options: damiJob,
  dedupeKey: (p) => waitKey(p.lookId, p),
});

/** A rejected look's next version: the designer in fix mode (or a re-roll), then the new image. */
export const assetLookFix = defineJob({
  name: "asset.look.fix",
  payload: lookPayload,
  options: damiJob,
  dedupeKey: (p) => waitKey(p.lookId, p),
});

/** A character sheet: sheet-generator-character writes its prompt, then the sheet is requested with the approved board attached. */
export const assetSheetGenerate = defineJob({
  name: "asset.sheet.generate",
  payload: sheetBiblePayload,
  options: damiJob,
  dedupeKey: (p) => waitKey(p.sheetId, p),
});

/** A rejected character sheet's next version: sheet-generator-character in fix mode (or a re-roll), then the new sheet. */
export const assetSheetFix = defineJob({
  name: "asset.sheet.fix",
  payload: sheetBiblePayload,
  options: damiJob,
  dedupeKey: (p) => waitKey(p.sheetId, p),
});

/**
 * A location pack or prop sheet: the sheet maker (sheet-generator-location or -prop) writes the
 * views and they are stored as planned `asset_sheet_view` rows. With `viewRowId`: a fix round
 * that re-writes that one view (only_views) from its review.
 */
export const assetSheetPlan = defineJob({
  name: "asset.sheet.plan",
  payload: sheetBiblePayload.extend({ viewRowId: z.string().uuid().optional() }),
  options: damiJob,
  dedupeKey: (p) => waitKey(`${p.sheetId}:${p.viewRowId ?? "plan"}`, p),
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

/** Prepare a block version for generation (code only: binds the prompt's asset tags to image tokens). */
export const productionPrepare = defineJob({
  name: "production.prepare",
  payload: blockPayload,
  options: damiJob,
  dedupeKey: (p) => p.blockId,
});

/** Revise a block version from the review of its predecessor (Block Revision). */
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

/**
 * Check a generated clip (the Video Review): cut detection, keyframes, the dami's report, and the
 * clip's last frame. Keyed by the take. Never blocks the user: a failure only marks the review
 * `failed`.
 */
export const takeReview = defineJob({
  name: "take.review",
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

/**
 * Fan-out of a project's production work, sent on the transaction that created it: `prepare`
 * queues the preparation (or revision) job of every pending block, `takes` the job of every
 * pending take without a generation. Idempotent (each per-row job is keyed by its row), and one
 * may be queued beside a running one, so rows claimed while it runs are not missed.
 */
export const productionDispatch = defineJob({
  name: "production.dispatch",
  payload: z.object({ projectId: z.string().uuid(), kind: z.enum(["prepare", "takes"]) }),
  options: { retryLimit: 3, retryDelaySeconds: 10, retryBackoff: true, expireInSeconds: 10 * 60 },
  dedupeKey: (p) => `${p.projectId}:${p.kind}`,
  allowFollowUp: true,
});

/**
 * Every job type. Their queues are created once per process before the first send, so a send on a
 * caller's transaction (`enqueue(..., { tx })`) never creates a queue inside it.
 */
export const ALL_JOBS = [
  systemPing,
  projectCreativeDna,
  projectName,
  scriptWrite,
  scriptWriteSegment,
  scriptEnhance,
  scriptCheck,
  scriptRevise,
  scriptDetectAssets,
  assetDetectFix,
  scriptDirect,
  directionWrite,
  generationRun,
  generationSweep,
  damiSweep,
  fileSweep,
  ratelimitPrune,
  assetLookGenerate,
  assetLookFix,
  assetSheetGenerate,
  assetSheetFix,
  assetSheetPlan,
  assetSheetViewsAdvance,
  assetSheetAssemble,
  productionPrepare,
  blockRevise,
  takeGenerate,
  takeReview,
  exportBuild,
  productionDispatch,
] as const;
