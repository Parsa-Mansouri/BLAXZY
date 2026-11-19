/**
 * The automatic Video Review of a generated clip (worker side, job `take.review`): downloads the
 * clip, finds its cuts, takes the planned keyframes, builds the dami's input from the block's
 * direction, the Creative and Continuity Bibles, the reference binding, the asset sheets and the
 * previous block's last frame, runs the dami and stores its report on the take. The clip's last
 * frame is stored too (it is PREV_END for the next block's review). Never blocks the user: the
 * take is reviewable as soon as it is `in_review`, and a failed check only marks `auto_review`.
 */
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { and, desc, eq, isNotNull } from "drizzle-orm";
import { getBlockVersion, getPreviousCurrentBlock, type PromptBlock } from "@/server/blocks";
import {
  storedBlockSchema,
  runDami,
  videoReview,
  type DirectorBlock,
  type VideoReviewInput,
} from "@/server/damis";
import { MAX_PROMPT_IMAGES } from "@/server/damis/framework/images";
import { getDb } from "@/server/db/client";
import { blockTake, generation, project } from "@/server/db/schema";
import { getLatestDirection } from "@/server/direction";
import { getReadyBible } from "@/server/projects";
import { probeMedia } from "@/server/providers/ffmpeg";
import { readFileBytes } from "@/server/storage";
import { isUuid } from "./access";
import { parseWindow, windowLabel, type PlannedWindow } from "./frame-plan";
import { detectCuts, extractFrames, lastFrame, planFrames, storeReviewFrames } from "./frames";
import {
  actualBinding,
  expectedBinding,
  loadBoundAssets,
  readyFileOwners,
  type BoundAsset,
} from "./review-binding";
import { getTake, type TakeRow } from "./takes";

export const REVIEW_LANGUAGE = "English";
/** Sheets of people the clip might be confused with, beyond the bound assets (an image each). */
export const MAX_CONFUSABLE_SHEETS = 6;

export type TakeReviewJob = {
  take: TakeRow;
  block: PromptBlock;
  project: { id: string; ownerId: string };
};

/** The Director's block when the stored direction is complete enough to review against. */
export function usableDirection(raw: unknown): DirectorBlock | null {
  if (!raw || typeof raw !== "object") return null;
  const parsed = storedBlockSchema.safeParse(raw);
  return parsed.success && parsed.data.shots.length > 0 ? parsed.data : null;
}

/** The take, its block version and its project, or null when any is gone. */
export async function loadTakeReviewJob(takeId: string): Promise<TakeReviewJob | null> {
  if (!isUuid(takeId)) return null;
  const db = getDb();
  const take = await getTake(db, takeId);
  if (!take) return null;
  const [owner] = await db
    .select({ id: project.id, ownerId: project.ownerId })
    .from(project)
    .where(eq(project.id, take.projectId))
    .limit(1);
  const block = await getBlockVersion(take.blockId);
  return owner && block ? { take, block, project: owner } : null;
}

/** The shot windows of the block as the frame plan wants them. */
export function plannedWindows(block: DirectorBlock): PlannedWindow[] {
  const windows: PlannedWindow[] = [];
  for (const shot of block.shots) {
    const parsed = parseWindow(shot.window);
    if (!parsed) continue;
    windows.push({
      label: windowLabel(parsed.startS, parsed.endS),
      startS: parsed.startS,
      endS: parsed.endS,
      shot: shot.shot_number,
    });
  }
  return windows;
}

/** The last frame of the newest accepted take of the block right before this one, if stored. */
async function previousEndFile(block: PromptBlock): Promise<string | null> {
  const previous = await getPreviousCurrentBlock(block);
  if (!previous) return null;
  const [row] = await getDb()
    .select({ fileId: blockTake.lastFrameFileId })
    .from(blockTake)
    .where(
      and(
        eq(blockTake.lineageId, previous.lineageId),
        eq(blockTake.status, "accepted"),
        isNotNull(blockTake.lastFrameFileId),
      ),
    )
    .orderBy(desc(blockTake.takeNumber))
    .limit(1);
  return row?.fileId ?? null;
}

type ContinuityBible = NonNullable<VideoReviewInput["continuity_bible"]>;

/** The Continuity Bible subset the review reads: descriptors and landmarks, from the direction run. */
export function continuityOf(header: unknown): ContinuityBible | undefined {
  if (!header || typeof header !== "object") return undefined;
  const bible = (header as { continuity_bible?: unknown }).continuity_bible;
  if (!bible || typeof bible !== "object") return undefined;
  const b = bible as Record<string, unknown>;
  const list = (key: string): Record<string, unknown>[] =>
    Array.isArray(b[key]) ? (b[key] as Record<string, unknown>[]) : [];
  const descriptors = [...list("characters"), ...list("locations"), ...list("props")].map((e) => ({
    asset_id: e.asset_id,
    name: e.name,
    descriptor: e.descriptor,
  }));
  const landmarks = list("locations").flatMap((l) =>
    Array.isArray(l.landmarks) ? [{ asset_id: l.asset_id, landmarks: l.landmarks }] : [],
  );
  return { descriptors, landmarks };
}

/** The sheets handed to the review: the bound assets, then other characters, within the image budget. */
export function pickSheets(input: {
  bound: readonly BoundAsset[];
  others: readonly { reviewId: string; name: string; fileId: string }[];
  imageBudget: number;
}): { asset_id: string; name: string; fileId: string }[] {
  const sheets: { asset_id: string; name: string; fileId: string }[] = [];
  const seen = new Set<string>();
  for (const b of input.bound) {
    if (!b.fileId || seen.has(b.reviewId)) continue;
    seen.add(b.reviewId);
    sheets.push({ asset_id: b.reviewId, name: b.name, fileId: b.fileId });
  }
  let extra = 0;
  for (const o of input.others) {
    if (extra >= MAX_CONFUSABLE_SHEETS) break;
    if (seen.has(o.reviewId)) continue;
    seen.add(o.reviewId);
    sheets.push({ asset_id: o.reviewId, name: o.name, fileId: o.fileId });
    extra++;
  }
  return sheets.slice(0, Math.max(0, Math.min(20, input.imageBudget)));
}

async function setAutoReview(takeId: string, value: "skipped" | "failed"): Promise<boolean> {
  const rows = await getDb()
    .update(blockTake)
    .set({ autoReview: value })
    .where(and(eq(blockTake.id, takeId), eq(blockTake.autoReview, "pending")))
    .returning({ id: blockTake.id });
  return rows.length > 0;
}

/** Marks a review that gave up. Only a still pending review changes; true when this call did it. */
export const failTakeReview = (takeId: string) => setAutoReview(takeId, "failed");

export type CheckOutcome = "reviewed" | "skipped" | "last_frame_only" | "nothing";

/**
 * Runs what the take still needs: its report (while `auto_review` is `pending`) and its last
 * frame (while missing). Idempotent: a finished take returns "nothing". Throws on a failure the
 * caller handles (retry, or `failTakeReview` on the last attempt).
 */
export async function runTakeCheck(
  takeId: string,
  options: { signal?: AbortSignal } = {},
): Promise<CheckOutcome> {
  const { signal } = options;
  const job = await loadTakeReviewJob(takeId);
  if (!job) return "nothing";
  const { take, block, project: owner } = job;
  if (!take.fileId || take.status === "pending" || take.status === "superseded") return "nothing";
  const needsReview = take.autoReview === "pending";
  const needsLast = take.lastFrameFileId === null;
  if (!needsReview && !needsLast) return "nothing";
  const direction = usableDirection(block.direction);
  if (!direction) {
    if (needsReview) await setAutoReview(take.id, "skipped");
    return "skipped";
  }

  const dir = await mkdtemp(join(tmpdir(), "blaxzy-check-"));
  try {
    const path = join(dir, "clip.mp4");
    await writeFile(path, await readFileBytes(take.fileId, { signal }));
    const probe = await probeMedia(path, signal);
    const durationS = probe.durationSeconds ?? block.durationSeconds ?? 0;
    const takeKey = `take-${take.id.slice(0, 8)}`;

    if (needsLast) {
      const last = await lastFrame(path, { signal });
      const [stored] = await storeReviewFrames({
        ownerId: owner.ownerId,
        projectId: owner.id,
        takeKey,
        frames: [{ id: "last", t: durationS, bytes: last.bytes }],
        signal,
      });
      if (stored) {
        await getDb()
          .update(blockTake)
          .set({ lastFrameFileId: stored.fileId })
          .where(and(eq(blockTake.id, take.id), eq(blockTake.projectId, take.projectId)));
      }
    }
    if (!needsReview) return "last_frame_only";

    const cuts = await detectCuts(path, { signal });
    const plan = planFrames({ durationS, windows: plannedWindows(direction), cuts });
    if (plan.length === 0) throw new Error(`take ${take.id}: the clip has no length to review`);
    const extracted = await extractFrames(
      path,
      plan.map((f) => f.t),
      { signal },
    );
    const stored = await storeReviewFrames({
      ownerId: owner.ownerId,
      projectId: owner.id,
      takeKey,
      frames: plan.map((f, i) => ({ id: f.id, t: f.t, bytes: extracted[i]!.bytes })),
      signal,
    });

    const bound = await loadBoundAssets(block);
    const { owners, assets } = await readyFileOwners(block);
    const previousEnd = await previousEndFile(block);
    const sheets = pickSheets({
      bound,
      others: assets.flatMap((a) =>
        a.kind === "character" && a.referenceFileId
          ? [{ reviewId: a.reviewId, name: a.name, fileId: a.referenceFileId }]
          : [],
      ),
      imageBudget: MAX_PROMPT_IMAGES - plan.length - (previousEnd ? 1 : 0),
    });
    const bible = await getReadyBible(owner.id);
    const directionRow = await getLatestDirection(owner.id, block.scriptVersionId);
    const [gen] = take.generationId
      ? await getDb()
          .select({ model: generation.model })
          .from(generation)
          .where(eq(generation.id, take.generationId))
          .limit(1)
      : [];
    const continuity = continuityOf(directionRow?.header);
    const input: VideoReviewInput = {
      ui_language: REVIEW_LANGUAGE,
      creative_bible: {
        anti_cliche_guards: bible?.bible.anti_cliche_guards ?? [],
        continuity_locks: bible?.bible.continuity_locks ?? [],
      },
      ...(continuity ? { continuity_bible: continuity } : {}),
      block: {
        block_id: direction.block_id,
        version: direction.version,
        prompt_text: direction.prompt_text,
        shots: direction.shots.map((s) => ({
          window: s.window,
          shot_number: s.shot_number,
          owner: s.owner,
          shot: s.shot,
          angle: s.angle,
          camera: s.camera,
        })),
        start_staging: direction.start_staging,
        end_staging: direction.end_staging,
        opening_frame: direction.opening_frame,
        in_progress_at_end: direction.in_progress_at_end,
        assets: expectedBinding(bound),
        budgets: { shot_budget: direction.budgets.shot_budget },
      },
      reference_binding: actualBinding(bound, take.referenceFileIds, owners),
      sheets,
      frames: plan.map((f) => {
        const fileId = stored.find((s) => s.id === f.id)?.fileId;
        if (!fileId) throw new Error(`frame ${f.id} was not stored`);
        return { id: f.id, t: f.t, label: f.label, fileId };
      }),
      ...(previousEnd ? { previous_end_frame: { fileId: previousEnd } } : {}),
      detected_cuts: cuts,
      generation_meta: {
        model: gen?.model ?? "unknown",
        seed: null,
        attempt: take.takeNumber,
        video_version: take.takeNumber,
        ...(durationS > 0 ? { duration_s: durationS } : {}),
      },
    };
    const run = await runDami(videoReview, input, {
      userId: owner.ownerId,
      projectId: owner.id,
      signal,
    });
    const done = await getDb()
      .update(blockTake)
      .set({ autoReview: "ready", reviewReport: run.output })
      .where(and(eq(blockTake.id, take.id), eq(blockTake.autoReview, "pending")))
      .returning({ id: blockTake.id });
    return done.length > 0 ? "reviewed" : "nothing";
  } finally {
    await rm(dir, { recursive: true, force: true, maxRetries: 3 });
  }
}
