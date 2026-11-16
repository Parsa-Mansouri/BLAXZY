/**
 * Pure helpers of the clips screens: the words for a shot's state, the board's status line, take
 * labels, the take shown in the player and the fingerprint the pages poll. No React, no server.
 */
import type { BlockProductionStage, TakeView } from "@/server/production";
import { SHOT_STATUS_LABELS } from "../../../_lib/shot-status";

export type Orientation = "landscape" | "portrait";

/** What a board tile needs of a shot. Plain data, so client components can hold it. */
export interface ClipTileData {
  lineageId: string;
  orderIndex: number;
  title: string | null;
  stage: BlockProductionStage;
  posterFileId: string | null;
}

/** Where a shot is, as the board and the clip page say it (the shared Production vocabulary). */
export const CLIP_STATE_LABELS: Record<BlockProductionStage, string> = SHOT_STATUS_LABELS;

/** Status colours of the kit's StatusLine / StatusDot. */
export type ClipTone = "done" | "waiting" | "working" | "failed";

/** Amber waits for the user, grey works or waits for something else, green is final, red failed. */
export const CLIP_STATE_TONES: Record<BlockProductionStage, ClipTone> = {
  preparing: "working",
  prepare_failed: "failed",
  block_review: "working",
  approved: "working",
  draft_generating: "working",
  draft_review: "waiting",
  final_generating: "working",
  final_review: "waiting",
  done: "done",
  failed: "failed",
};

export const REVIEW_STAGES: readonly BlockProductionStage[] = ["draft_review", "final_review"];
export const RENDERING_STAGES: readonly BlockProductionStage[] = [
  "draft_generating",
  "final_generating",
];
const ATTENTION_STAGES: readonly BlockProductionStage[] = ["failed", "prepare_failed"];
const BEFORE_CLIPS: readonly BlockProductionStage[] = ["preparing", "block_review", "approved"];

export const needsReview = (stage: BlockProductionStage) => REVIEW_STAGES.includes(stage);
export const isRendering = (stage: BlockProductionStage) => RENDERING_STAGES.includes(stage);
export const needsAttention = (stage: BlockProductionStage) => ATTENTION_STAGES.includes(stage);
/** The shot has no clip work yet: it is still in the shot review of this stage. */
export const isBeforeClips = (stage: BlockProductionStage) => BEFORE_CLIPS.includes(stage);

/** Something will change by itself: the worker is (or is about to be) producing a clip. */
export function isUnsettled(stage: BlockProductionStage, busy = false): boolean {
  return busy || isRendering(stage) || stage === "preparing";
}

/** "Shot 3" when a shot has no title. */
export function shotTitle(shot: { title: string | null; orderIndex: number }): string {
  const title = shot.title?.trim();
  return title ? title : `Shot ${shot.orderIndex + 1}`;
}

export const shotNumber = (orderIndex: number) => orderIndex + 1;

export type StageCounts = Record<BlockProductionStage, number>;

/**
 * The board's one status line, saying what needs attention rather than totals:
 * "2 to review · 1 rendering", "Every shot is final".
 */
export function statusLine(counts: StageCounts): string {
  const review = counts.draft_review + counts.final_review;
  const rendering = counts.draft_generating + counts.final_generating;
  const failed = counts.failed + counts.prepare_failed;
  const all = Object.values(counts).reduce((sum, n) => sum + n, 0);
  if (all === 0) return "No shots yet";
  if (counts.done === all) return "Every shot is final";
  const parts: string[] = [];
  if (review > 0) parts.push(`${review} to review`);
  if (failed > 0) parts.push(`${failed} failed`);
  if (rendering > 0) parts.push(`${rendering} rendering`);
  if (counts.preparing > 0) parts.push(`${counts.preparing} preparing`);
  if (counts.block_review > 0) parts.push(`${counts.block_review} to review in Shots`);
  if (counts.approved > 0) parts.push(`${counts.approved} waiting for drafts`);
  if (parts.length === 0) return "Nothing to review right now";
  return parts.join(" · ");
}

/** The colour of the board's status line. */
export function statusTone(counts: StageCounts): ClipTone {
  if (counts.failed + counts.prepare_failed > 0) return "failed";
  if (counts.draft_review + counts.final_review > 0) return "waiting";
  const all = Object.values(counts).reduce((sum, n) => sum + n, 0);
  if (all > 0 && counts.done === all) return "done";
  return "working";
}

/**
 * What the user should do in Shots for the shots that wait there (review them, or start their
 * drafts), or null when no shot waits for the user in Shots.
 */
export function shotsHint(counts: StageCounts): string | null {
  const review = counts.block_review + counts.prepare_failed;
  if (review > 0) {
    return review === 1
      ? "1 shot waits for its review in Shots. Review it, then generate its draft."
      : `${review} shots wait for their review in Shots. Review them, then generate their drafts.`;
  }
  if (counts.approved > 0 && counts.preparing === 0) {
    return counts.approved === 1
      ? "1 approved shot waits for its draft. Generate it in Shots."
      : `${counts.approved} approved shots wait for their drafts. Generate them in Shots.`;
  }
  return null;
}

/** "Draft 2", "Final", "Final 2": each take named by its kind and its place among that kind. */
export function takeLabels(takes: readonly TakeView[]): Map<string, string> {
  const ordered = [...takes].sort((a, b) => a.takeNumber - b.takeNumber);
  const finals = ordered.filter((t) => t.stage === "final").length;
  const seen = { draft: 0, final: 0 };
  const labels = new Map<string, string>();
  for (const take of ordered) {
    seen[take.stage] += 1;
    const n = seen[take.stage];
    labels.set(
      take.id,
      take.stage === "draft" ? `Draft ${n}` : finals > 1 ? `Final ${n}` : "Final",
    );
  }
  return labels;
}

export const TAKE_STATUS_LABELS: Record<TakeView["status"], string> = {
  pending: "Rendering",
  in_review: "To Review",
  accepted: "Accepted",
  rejected: "Changes Requested",
  failed: "Failed",
  superseded: "Replaced",
};

/** The newest take with a clip: what the player shows while a new take renders or after a failure. */
export function newestPlayable(takes: readonly TakeView[]): TakeView | null {
  return takes.find((t) => t.fileId !== null && t.status !== "superseded") ?? null;
}

/** A fingerprint of everything the clip page shows that the worker can change. */
export function detailKey(detail: {
  id: string;
  stage: BlockProductionStage;
  busy: boolean;
  takes: readonly (Pick<TakeView, "id" | "status" | "fileId" | "posterFileId"> & {
    review: Pick<TakeView["review"], "state">;
  })[];
}): string {
  const takes = detail.takes.map(
    (t) => `${t.id}:${t.status}:${t.fileId ?? ""}:${t.posterFileId ?? ""}:${t.review.state}`,
  );
  return [detail.id, detail.stage, detail.busy ? "busy" : "idle", ...takes].join("|");
}

/** True when a generation failed for lack of credits (the reason then names the balance). */
export function isCreditsFailure(failure: string | null): boolean {
  return failure !== null && /credit/i.test(failure);
}

export type PromptPart =
  { kind: "text"; text: string } | { kind: "asset"; name: string; index: number };

/**
 * The prepared prompt with each `<<<image_N>>>` token replaced by the name of the N-th asset, so it
 * reads as words. A token without an asset keeps a neutral name.
 */
export function promptParts(prompt: string, assets: readonly { name: string }[]): PromptPart[] {
  const parts: PromptPart[] = [];
  const pattern = /<<<image_(\d+)>>>/g;
  let last = 0;
  for (const match of prompt.matchAll(pattern)) {
    const at = match.index ?? 0;
    if (at > last) parts.push({ kind: "text", text: prompt.slice(last, at) });
    const index = Number(match[1]);
    parts.push({ kind: "asset", index, name: assets[index - 1]?.name ?? `Reference ${index}` });
    last = at + match[0].length;
  }
  if (last < prompt.length) parts.push({ kind: "text", text: prompt.slice(last) });
  return parts;
}

/** "0:04.2": minutes, seconds and tenths, for the player's clock. */
export function formatClock(seconds: number, tenths = true): string {
  const safe = Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
  const whole = Math.floor(safe);
  const m = Math.floor(whole / 60);
  const s = String(whole % 60).padStart(2, "0");
  if (!tenths) return `${m}:${s}`;
  const t = Math.floor((safe - whole) * 10);
  return `${m}:${s}.${t}`;
}

/** "5 seconds", "1 minute 5 seconds", for a shot's length. */
export function formatLength(seconds: number | null): string | null {
  if (seconds === null || seconds <= 0) return null;
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  const sec = `${s} ${s === 1 ? "second" : "seconds"}`;
  if (m === 0) return sec;
  const min = `${m} ${m === 1 ? "minute" : "minutes"}`;
  return s === 0 ? min : `${min} ${sec}`;
}
