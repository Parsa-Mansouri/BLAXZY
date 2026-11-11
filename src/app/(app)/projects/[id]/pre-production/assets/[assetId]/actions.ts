"use server";

import { revalidatePath } from "next/cache";
import {
  AssetInputError,
  getAssetDetail,
  removeAsset,
  replaceLook,
  retryLook,
  retrySheet,
  startLookFromGuided,
  startLookFromPrompt,
  startLookFromUpload,
  submitLookReview,
  submitSheetReview,
  updateAsset,
} from "@/server/assets";
import { requireUser } from "@/server/auth";
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

export async function startFromPromptAction(
  projectId: string,
  assetId: string,
  prompt: string,
): Promise<ActionResult> {
  const user = await requireUser();
  try {
    const look = await startLookFromPrompt({ assetId, userId: user.id, prompt });
    return look ? done(projectId) : { ok: false, error: MISSING };
  } catch (error) {
    return failure(error);
  }
}

export async function startFromGuidedAction(
  projectId: string,
  assetId: string,
  answers: Record<string, string>,
): Promise<ActionResult> {
  const user = await requireUser();
  try {
    const look = await startLookFromGuided({ assetId, userId: user.id, answers });
    return look ? done(projectId) : { ok: false, error: MISSING };
  } catch (error) {
    return failure(error);
  }
}

export interface UploadTicketData {
  fileId: string;
  uploadUrl: string;
  headers: Record<string, string>;
}

/** Records the file and returns where the browser sends its bytes. */
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

/** Checks the uploaded bytes, then uses the file as the asset's image or recording. */
export async function finishAssetUploadAction(
  projectId: string,
  assetId: string,
  fileId: string,
): Promise<ActionResult> {
  const user = await requireUser();
  try {
    await confirmUpload({ fileId, ownerId: user.id });
    const look = await startLookFromUpload({ assetId, userId: user.id, fileId });
    return look ? done(projectId) : { ok: false, error: MISSING };
  } catch (error) {
    if (error instanceof StorageError) {
      return { ok: false, error: "The upload did not complete. Choose the file again." };
    }
    return failure(error);
  }
}

export interface ReviewInput {
  decision: "accepted" | "rejected";
  issueCodes?: string[];
  note?: string;
}

export async function reviewLookAction(
  projectId: string,
  lookId: string,
  review: ReviewInput,
): Promise<ActionResult> {
  const user = await requireUser();
  try {
    const stage = await submitLookReview({ lookId, userId: user.id, ...review });
    return stage ? done(projectId) : { ok: false, error: MISSING };
  } catch (error) {
    return failure(error);
  }
}

export async function reviewSheetAction(
  projectId: string,
  sheetId: string,
  review: ReviewInput,
): Promise<ActionResult> {
  const user = await requireUser();
  try {
    const stage = await submitSheetReview({ sheetId, userId: user.id, ...review });
    return stage ? done(projectId) : { ok: false, error: MISSING };
  } catch (error) {
    return failure(error);
  }
}

export async function retryAction(
  projectId: string,
  target: { kind: "look" | "sheet"; id: string },
): Promise<ActionResult> {
  const user = await requireUser();
  try {
    const stage =
      target.kind === "look"
        ? await retryLook({ lookId: target.id, userId: user.id })
        : await retrySheet({ sheetId: target.id, userId: user.id });
    return stage ? done(projectId) : { ok: false, error: MISSING };
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
