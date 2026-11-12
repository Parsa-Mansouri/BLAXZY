"use server";

import { revalidatePath } from "next/cache";
import {
  AssetInputError,
  getAssetDetail,
  nextAssetNeedingInput,
  removeAsset,
  replaceLook,
  retryLook,
  retrySheet,
  startDesign,
  startLookFromGuided,
  startLookFromUpload,
  startWithoutWaiting,
  submitLookReview,
  submitSheetReview,
  updateAsset,
  answerLookQuestion,
  type AssetStage,
} from "@/server/assets";
import { requireUser } from "@/server/auth";
import type { FixSelection } from "@/server/damis";
import { confirmUpload, createUpload, StorageError } from "@/server/storage";
import { versionsKey } from "./_lib/asset-view";

export type ActionResult<T = null> = { ok: true; data: T } | { ok: false; error: string };

const MISSING = "This asset is no longer available. Go back to its category and reload.";
const SERVER_PROBLEM = "The server had a problem. Try again in a moment.";

function failure(error: unknown): { ok: false; error: string } {
  if (error instanceof AssetInputError) return { ok: false, error: error.message };
  console.error("[asset actions]", error);
  return { ok: false, error: SERVER_PROBLEM };
}

/**
 * An asset change shows in Pre-production's screens (this asset, its category, the overview); the
 * stage does not change and the sidebar's balance refreshes itself.
 */
function refreshPreProduction(projectId: string) {
  revalidatePath(`/projects/${projectId}/pre-production`, "layout");
}

const done = (projectId: string): ActionResult => {
  refreshPreProduction(projectId);
  return { ok: true, data: null };
};

/**
 * After an action that leaves nothing for the user to do on this asset (a job started, or it is
 * ready), where to go next: the next asset that waits for the user, or null when none does (the
 * client then goes to the pre-production overview). `data: null` means stay on this asset.
 */
export type MoveOn = { next: { assetId: string; name: string } | null };

/** Stages after which the user has nothing to do on the asset for now. */
const MOVE_ON_STAGES: readonly AssetStage[] = ["generating", "building_sheet", "ready"];

/** Refreshes like `done`, then finds the next asset; called after the job was enqueued. */
async function movedOn(
  projectId: string,
  userId: string,
  assetId: string,
): Promise<ActionResult<MoveOn | null>> {
  refreshPreProduction(projectId);
  try {
    const next = await nextAssetNeedingInput(projectId, userId, assetId);
    return { ok: true, data: { next: next ? { assetId: next.id, name: next.name } : null } };
  } catch (error) {
    // The action itself succeeded: stay on the asset rather than report a failure.
    console.error("[asset actions] next asset", error);
    return { ok: true, data: null };
  }
}

/** `movedOn` when `stage` leaves nothing to do here and the caller named the asset, else `done`. */
async function afterStage(
  projectId: string,
  userId: string,
  stage: AssetStage,
  assetId: string | undefined,
): Promise<ActionResult<MoveOn | null>> {
  if (assetId && MOVE_ON_STAGES.includes(stage)) return movedOn(projectId, userId, assetId);
  return done(projectId);
}

/** A fingerprint of the asset's state, polled while something is being produced. */
export async function pollAssetAction(assetId: string): Promise<string | null> {
  const user = await requireUser();
  try {
    const detail = await getAssetDetail(assetId, user.id);
    return detail ? versionsKey(detail) : null;
  } catch (error) {
    if (error instanceof AssetInputError) return null;
    throw error;
  }
}

/** A reference photo of a design: an uploaded image, the role picked for it, what to keep. */
export interface ReferencePhoto {
  fileId: string;
  role: string;
  note?: string;
}

/**
 * Starts a design from any mix of the user's words, reference photos and guided answers. With
 * none of them it is "Design It for Me": the designer works from the script and the project.
 */
export async function startDesignAction(
  projectId: string,
  assetId: string,
  input: { prompt?: string; answers?: Record<string, string>; references?: ReferencePhoto[] },
): Promise<ActionResult<MoveOn | null>> {
  const user = await requireUser();
  try {
    const look = await startDesign({ assetId, userId: user.id, ...input });
    return look ? await movedOn(projectId, user.id, assetId) : { ok: false, error: MISSING };
  } catch (error) {
    return failure(error);
  }
}

/** A prop waiting for its locations' Heroes is designed now, without them. */
export async function startWithoutWaitingAction(
  projectId: string,
  assetId: string,
): Promise<ActionResult<MoveOn | null>> {
  const user = await requireUser();
  try {
    const stage = await startWithoutWaiting({ assetId, userId: user.id });
    return stage
      ? await afterStage(projectId, user.id, stage, assetId)
      : { ok: false, error: MISSING };
  } catch (error) {
    return failure(error);
  }
}

/**
 * Answers the designer's question on a look that waits for it (keyed by question id; the
 * "I'm not sure" answer lets the designer take its default), then the design carries on.
 */
export async function answerQuestionAction(
  projectId: string,
  lookId: string,
  answers: Record<string, string>,
  assetId?: string,
): Promise<ActionResult<MoveOn | null>> {
  const user = await requireUser();
  try {
    const stage = await answerLookQuestion({ lookId, userId: user.id, answers });
    return stage
      ? await afterStage(projectId, user.id, stage, assetId)
      : { ok: false, error: MISSING };
  } catch (error) {
    return failure(error);
  }
}

export async function startFromGuidedAction(
  projectId: string,
  assetId: string,
  answers: Record<string, string>,
): Promise<ActionResult<MoveOn | null>> {
  const user = await requireUser();
  try {
    const look = await startLookFromGuided({ assetId, userId: user.id, answers });
    return look ? await movedOn(projectId, user.id, assetId) : { ok: false, error: MISSING };
  } catch (error) {
    return failure(error);
  }
}

export interface UploadTicketData {
  fileId: string;
  uploadUrl: string;
  headers: Record<string, string>;
}

/**
 * Records the file and returns where the browser sends its bytes: a voice's recording, or a
 * reference photo of an image asset (confirmed with `confirmReferenceUploadAction`).
 */
export async function createAssetUploadAction(
  assetId: string,
  file: { name: string; type: string; size: number },
): Promise<ActionResult<UploadTicketData>> {
  const user = await requireUser();
  try {
    const detail = await getAssetDetail(assetId, user.id);
    if (!detail || detail.asset.status !== "active") return { ok: false, error: MISSING };
    const voice = detail.asset.kind === "voice";
    try {
      const ticket = await createUpload({
        ownerId: user.id,
        projectId: detail.asset.projectId,
        originalName: file.name,
        mimeType: file.type,
        sizeBytes: file.size,
        purpose: voice ? "asset_audio" : "asset_image",
      });
      return {
        ok: true,
        data: { fileId: ticket.fileId, uploadUrl: ticket.uploadUrl, headers: ticket.headers },
      };
    } catch (error) {
      if (error instanceof StorageError && error.code === "invalid_file") {
        return {
          ok: false,
          error: voice
            ? "This file cannot be used. Choose an .mp3, .wav or .m4a file up to 25 MB."
            : "This file cannot be used. Choose a .png, .jpg or .webp image up to 25 MB.",
        };
      }
      throw error;
    }
  } catch (error) {
    return failure(error);
  }
}

/**
 * Checks the uploaded bytes of a reference photo (from `createAssetUploadAction`). Nothing starts:
 * the photo is sent with a design or a review.
 */
export async function confirmReferenceUploadAction(fileId: string): Promise<ActionResult> {
  const user = await requireUser();
  try {
    await confirmUpload({ fileId, ownerId: user.id });
    return { ok: true, data: null };
  } catch (error) {
    if (error instanceof StorageError) {
      return { ok: false, error: "The upload did not complete. Choose the photo again." };
    }
    return failure(error);
  }
}

/** Checks the uploaded bytes, then uses the file as the voice's recording. */
export async function finishAssetUploadAction(
  projectId: string,
  assetId: string,
  fileId: string,
): Promise<ActionResult<MoveOn | null>> {
  const user = await requireUser();
  try {
    await confirmUpload({ fileId, ownerId: user.id });
    const look = await startLookFromUpload({ assetId, userId: user.id, fileId });
    if (!look) return { ok: false, error: MISSING };
    // A recording is accepted on upload: the voice is ready. An image goes to review: stay.
    return look.status === "accepted"
      ? await movedOn(projectId, user.id, assetId)
      : done(projectId);
  } catch (error) {
    if (error instanceof StorageError) {
      return { ok: false, error: "The upload did not complete. Choose the file again." };
    }
    return failure(error);
  }
}

/** A sheet's review: the sheet's issues are not catalog-driven yet. */
export interface ReviewInput {
  decision: "accepted" | "rejected";
  issueCodes?: string[];
  note?: string;
}

/** A look's review (see `submitLookReview`). */
export interface LookReviewInput {
  decision: "accepted" | "rejected";
  /** Rejected: the designer's catalog options picked, with their chip, words and frame. */
  selections?: FixSelection[];
  note?: string;
  /** Rejected: the next version's photos (one replaced or dropped). */
  references?: ReferencePhoto[];
  /** Rejected: values written on the spec card. */
  specEdits?: { field: string; value: string }[];
  /** Rejected: answers to the designer's non-blocking questions. */
  clarifyAnswers?: Record<string, string>;
  /** Accepted: the critical spec fields the user checked. */
  confirmedFields?: string[];
}

export async function reviewLookAction(
  projectId: string,
  lookId: string,
  review: LookReviewInput,
  /** The look's asset: when given, a decision that starts a job moves on (see `MoveOn`). */
  assetId?: string,
): Promise<ActionResult<MoveOn | null>> {
  const user = await requireUser();
  try {
    const stage = await submitLookReview({ lookId, userId: user.id, ...review });
    return stage
      ? await afterStage(projectId, user.id, stage, assetId)
      : { ok: false, error: MISSING };
  } catch (error) {
    return failure(error);
  }
}

export async function reviewSheetAction(
  projectId: string,
  sheetId: string,
  review: ReviewInput,
  /** The sheet's asset: when given, the decision moves on (see `MoveOn`). */
  assetId?: string,
): Promise<ActionResult<MoveOn | null>> {
  const user = await requireUser();
  try {
    const stage = await submitSheetReview({ sheetId, userId: user.id, ...review });
    return stage
      ? await afterStage(projectId, user.id, stage, assetId)
      : { ok: false, error: MISSING };
  } catch (error) {
    return failure(error);
  }
}

export async function retryAction(
  projectId: string,
  target: { kind: "look" | "sheet"; id: string },
  /** The asset tried again: when given, the restarted job moves on (see `MoveOn`). */
  assetId?: string,
): Promise<ActionResult<MoveOn | null>> {
  const user = await requireUser();
  try {
    const stage =
      target.kind === "look"
        ? await retryLook({ lookId: target.id, userId: user.id })
        : await retrySheet({ sheetId: target.id, userId: user.id });
    return stage
      ? await afterStage(projectId, user.id, stage, assetId)
      : { ok: false, error: MISSING };
  } catch (error) {
    return failure(error);
  }
}

export async function startOverAction(projectId: string, assetId: string): Promise<ActionResult> {
  const user = await requireUser();
  try {
    const stage = await replaceLook({ assetId, userId: user.id });
    return stage ? done(projectId) : { ok: false, error: MISSING };
  } catch (error) {
    return failure(error);
  }
}

export async function updateDetailsAction(
  projectId: string,
  assetId: string,
  details: { name: string; description: string },
): Promise<ActionResult> {
  const user = await requireUser();
  try {
    const asset = await updateAsset({ assetId, userId: user.id, ...details });
    return asset ? done(projectId) : { ok: false, error: MISSING };
  } catch (error) {
    return failure(error);
  }
}

export async function removeAssetAction(projectId: string, assetId: string): Promise<ActionResult> {
  const user = await requireUser();
  try {
    const removed = await removeAsset({ assetId, userId: user.id });
    return removed ? done(projectId) : { ok: false, error: MISSING };
  } catch (error) {
    return failure(error);
  }
}
