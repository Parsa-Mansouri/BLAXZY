/** Starting a look: an uploaded recording, or a design (words, guided answers, photos). */
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { AI_DECIDES, type GuidedQuestion } from "@/server/damis";
import { type DbTx, getDb } from "@/server/db/client";
import { asset, type AssetKind, assetLook, project } from "@/server/db/schema";
import { logProjectEvent } from "@/server/projects";
import { FILE_PURPOSES, type FilePurpose, getOwnedFileInfo } from "@/server/storage";
import {
  checkReferences,
  locationsInFlight,
  questionsFor,
  type ReferenceInput,
  untouched,
} from "../designs";
import { type AssetRow, loadAssetState, loadLookView, type LookView } from "../looks";
import { AssetInputError, parse } from "../service";
import type { AssetStage } from "../stage";
import { assertActive, isUuid, lockAsset } from "./access";
import { enqueueLookJob } from "./enqueue";
import {
  answersSchema,
  assetRefInput,
  designInput,
  guidedInput,
  idSchema,
  promptInput,
  uploadInput,
  userIdSchema,
} from "./inputs";
import { BUSY_MESSAGE } from "./messages";
import { insertLook } from "./versions";

/**
 * Checks guided answers against the questions still asked for this asset (`questions`); returns
 * the trimmed, non-empty ones. A choice may be answered in the user's own words ("Not what you
 * have in mind?"), and any question with `ai_decides` ("I'm not sure"); only optional questions
 * may be left empty.
 */
function validateGuidedAnswers(
  questions: readonly GuidedQuestion[],
  answers: Record<string, string>,
): Record<string, string> {
  if (questions.length === 0) {
    throw new AssetInputError("This asset has no questions. Describe it or add photos instead.");
  }
  const byId = new Map(questions.map((q) => [q.id, q]));
  for (const id of Object.keys(answers)) {
    if (!byId.has(id)) throw new AssetInputError("One answer does not match any question.");
  }
  const result: Record<string, string> = {};
  for (const question of questions) {
    const value = (answers[question.id] ?? "").trim();
    if (value.length === 0) {
      if (!question.optional) {
        throw new AssetInputError(`Answer “${question.label}”, or choose I’m not sure.`);
      }
      continue;
    }
    result[question.id] = value === AI_DECIDES ? AI_DECIDES : value;
  }
  return result;
}

/** Which purpose an asset's upload must match, and what the user is told otherwise. */
function uploadRule(kind: AssetKind): { purpose: FilePurpose; message: string } {
  return kind === "voice"
    ? { purpose: "asset_audio", message: "Upload the voice as an .mp3, .wav or .m4a file." }
    : { purpose: "asset_image", message: "Upload the image as a .png, .jpg or .webp file." };
}

/** Refuses a new look unless the asset is waiting for one (or its last look failed). */
async function assertCanStartLook(tx: DbTx, row: AssetRow): Promise<void> {
  assertActive(row);
  if (row.details?.needsVisual === false) {
    throw new AssetInputError("This character is only a voice, so there is nothing to design.");
  }
  const { state } = await loadAssetState(tx, row);
  if (state.busy) throw new AssetInputError(BUSY_MESSAGE);
  if (row.kind === "voice") return; // a new recording replaces the accepted one
  switch (state.stage) {
    case "needs_image":
      return;
    case "failed":
      if (state.failed === "look") return;
      break;
    case "look_review":
      throw new AssetInputError("Review the current image first, then try another one.");
    case "needs_answer":
      throw new AssetInputError("Answer the designer’s question first.");
    default:
      break;
  }
  throw new AssetInputError("This asset already has an accepted image. Replace it to start over.");
}

/**
 * Uses an uploaded recording as a voice's look: a ready audio file, accepted at once (no sheet);
 * it replaces any previous recording. Image assets take photos as references of a design
 * (`startDesign`) instead: the designers read them, they never become the look directly.
 */
export async function startLookFromUpload(input: {
  assetId: string;
  userId: string;
  fileId: string;
}): Promise<LookView | null> {
  const { assetId, userId, fileId } = parse(uploadInput, input);
  if (!isUuid(assetId)) return null;
  const notUsable = new AssetInputError("That file is not available. Upload it again.");
  if (!isUuid(fileId)) throw notUsable;
  const file = await getOwnedFileInfo(fileId, userId);
  if (!file || file.status !== "ready") throw notUsable;

  const created = await getDb().transaction(async (tx) => {
    const locked = await lockAsset(tx, assetId, userId);
    if (!locked) return null;
    const { asset: row } = locked;
    if (row.kind !== "voice") {
      throw new AssetInputError(
        "Photos are references for the design: add them with a role, then create the image.",
      );
    }
    if (file.projectId !== null && file.projectId !== row.projectId) throw notUsable;
    const rule = uploadRule(row.kind);
    const allowed: Readonly<Record<string, readonly string[]>> = FILE_PURPOSES[rule.purpose].types;
    if (
      !(file.mimeType in allowed) ||
      (file.sizeBytes ?? 0) > FILE_PURPOSES[rule.purpose].maxBytes
    ) {
      throw new AssetInputError(rule.message);
    }
    await assertCanStartLook(tx, row);
    await tx
      .update(assetLook)
      .set({ status: "superseded" })
      .where(and(eq(assetLook.assetId, row.id), eq(assetLook.status, "accepted")));
    const look = await insertLook(tx, {
      assetId: row.id,
      projectId: row.projectId,
      source: "uploaded",
      status: "accepted",
      fileId,
      createdBy: userId,
      decidedAt: new Date(),
    });
    await logProjectEvent(tx, {
      projectId: row.projectId,
      userId,
      type: "asset.look_accepted",
      payload: {
        assetId: row.id,
        lookId: look.id,
        source: "uploaded",
      },
    });
    return look;
  });
  if (!created) return null;
  return loadLookView(getDb(), created.id);
}

/**
 * Starts a design: a pending look with what the user gave, then the designer's job. A prop that
 * stands in a location still being designed waits for it (no job yet): the location's accepted
 * Hero wakes it (`wakeWaitingLooks`), so the prop can match it.
 */
async function startGeneratedLook(
  assetId: string,
  userId: string,
  values: {
    userPrompt?: string;
    answers?: Record<string, string>;
    references?: ReferenceInput[];
  },
): Promise<LookView | null> {
  if (!isUuid(assetId)) return null;
  const db = getDb();
  // Photos are checked before the transaction (each reads the file table), and only on the
  // user's own asset: a foreign id is "missing" before anything about it is looked at.
  const [preview] = await db
    .select({ asset })
    .from(asset)
    .innerJoin(project, eq(project.id, asset.projectId))
    .where(and(eq(asset.id, assetId), eq(project.ownerId, userId), isNull(project.archivedAt)))
    .limit(1);
  if (!preview) return null;
  const references = values.references
    ? await checkReferences(preview.asset, userId, values.references)
    : [];
  const created = await db.transaction(async (tx) => {
    const locked = await lockAsset(tx, assetId, userId);
    if (!locked) return null;
    const { asset: row, project: owner } = locked;
    if (row.kind === "voice") {
      throw new AssetInputError("Voices are recorded, not generated. Upload a recording.");
    }
    const guidedAnswers = values.answers
      ? validateGuidedAnswers(questionsFor(row, owner.style), values.answers)
      : null;
    await assertCanStartLook(tx, row);
    const waitingFor = await locationsInFlight(tx, row);
    const look = await insertLook(tx, {
      assetId: row.id,
      projectId: row.projectId,
      source: "generated",
      status: "pending",
      userPrompt: values.userPrompt ?? null,
      guidedAnswers,
      references,
      createdBy: userId,
    });
    const source = guidedAnswers
      ? "guided"
      : values.userPrompt
        ? "prompt"
        : references.length > 0
          ? "references"
          : "auto";
    await logProjectEvent(tx, {
      projectId: row.projectId,
      userId,
      type: "asset.look_started",
      payload: {
        assetId: row.id,
        lookId: look.id,
        source,
        references: references.length,
        ...(waitingFor.length > 0 ? { waitingFor } : {}),
      },
    });
    if (waitingFor.length === 0) await enqueueLookJob(tx, look);
    return look;
  });
  if (!created) return null;
  return loadLookView(getDb(), created.id);
}

/** Generates a look from the user's own description: look pending, `asset.look.generate`. */
export async function startLookFromPrompt(input: {
  assetId: string;
  userId: string;
  prompt: string;
}): Promise<LookView | null> {
  const { assetId, userId, prompt } = parse(promptInput, input);
  return startGeneratedLook(assetId, userId, { userPrompt: prompt });
}

/**
 * Generates a look from answers to the asset's guided questions (keyed by question id; a choice
 * may be answered in the user's own words, any question with `ai_decides`).
 */
export async function startLookFromGuided(input: {
  assetId: string;
  userId: string;
  answers: Record<string, string>;
}): Promise<LookView | null> {
  const { assetId, userId, answers } = parse(guidedInput, input);
  return startGeneratedLook(assetId, userId, { answers });
}

/**
 * Starts a design from any mix of the user's words, guided answers and reference photos (each
 * with a role). With none of them it is "Design it for me": the designer works from the script
 * and the project alone.
 */
export async function startDesign(input: {
  assetId: string;
  userId: string;
  prompt?: string;
  answers?: Record<string, string>;
  references?: ReferenceInput[];
}): Promise<LookView | null> {
  const { assetId, userId, prompt, answers, references } = parse(designInput, input);
  return startGeneratedLook(assetId, userId, {
    ...(prompt ? { userPrompt: prompt } : {}),
    ...(answers && Object.keys(answers).length > 0 ? { answers } : {}),
    ...(references ? { references } : {}),
  });
}

/**
 * Starts a prop that waits for its locations without waiting any longer (it is then designed
 * without their Heroes). Returns the stage, or null when the asset is not the user's.
 */
export async function startWithoutWaiting(input: {
  assetId: string;
  userId: string;
}): Promise<AssetStage | null> {
  const { assetId, userId } = parse(assetRefInput, input);
  if (!isUuid(assetId)) return null;
  const look = await getDb().transaction(async (tx) => {
    const locked = await lockAsset(tx, assetId, userId);
    if (!locked) return null;
    const { look: latest } = await loadAssetState(tx, locked.asset);
    if (!latest || !untouched(latest)) {
      throw new AssetInputError("This design has already started. Reload the page.");
    }
    await logProjectEvent(tx, {
      projectId: locked.asset.projectId,
      userId,
      type: "asset.look_wait_skipped",
      payload: {
        assetId,
        lookId: latest.id,
      },
    });
    await enqueueLookJob(tx, latest);
    return latest;
  });
  if (!look) return null;
  return "generating";
}

/**
 * Answers the designer's questions on a look that waits for them (`needs_input`, the prop
 * designer's blocking question). The look is superseded and a new version is designed with the
 * answers (`clarify_answers`). An answer of `ai_decides` takes the question's default; blocking
 * questions must be answered.
 */
export async function answerLookQuestion(input: {
  lookId: string;
  userId: string;
  answers: Record<string, string>;
}): Promise<AssetStage | null> {
  const { lookId, userId, answers } = parse(
    z.object({ lookId: idSchema, userId: userIdSchema, answers: answersSchema }),
    input,
  );
  if (!isUuid(lookId)) return null;
  const next = await getDb().transaction(async (tx) => {
    const [target] = await tx
      .select({ assetId: assetLook.assetId })
      .from(assetLook)
      .where(eq(assetLook.id, lookId))
      .limit(1);
    if (!target) return null;
    const locked = await lockAsset(tx, target.assetId, userId);
    if (!locked) return null;
    const { asset: row } = locked;
    assertActive(row);
    const { look: latest } = await loadAssetState(tx, row);
    if (!latest || latest.id !== lookId || latest.status !== "needs_input") {
      throw new AssetInputError("There is no question waiting here. Reload the page.");
    }
    const questions = latest.spec?.questions ?? [];
    const byId = new Map(questions.map((q) => [q.id, q]));
    const clarify: Record<string, string> = { ...(latest.clarifyAnswers ?? {}) };
    for (const [id, raw] of Object.entries(answers)) {
      const question = byId.get(id);
      if (!question) throw new AssetInputError("One answer does not match any question.");
      const value = raw.trim();
      if (value) clarify[id] = value === AI_DECIDES ? question.default : value;
    }
    for (const q of questions) {
      if (q.blocking && !clarify[q.id]) {
        throw new AssetInputError(`Answer “${q.question}”, or choose I’m not sure.`);
      }
    }
    const now = new Date();
    await tx
      .update(assetLook)
      .set({ status: "superseded", decidedAt: now })
      .where(eq(assetLook.id, lookId));
    const look = await insertLook(tx, {
      assetId: row.id,
      projectId: row.projectId,
      parentId: lookId,
      source: "generated",
      status: "pending",
      userPrompt: latest.userPrompt,
      guidedAnswers: latest.guidedAnswers,
      references: latest.references,
      clarifyAnswers: clarify,
      createdBy: userId,
    });
    await logProjectEvent(tx, {
      projectId: row.projectId,
      userId,
      type: "asset.look_answered",
      payload: {
        assetId: row.id,
        lookId,
        nextLookId: look.id,
        questions: Object.keys(answers),
      },
    });
    await enqueueLookJob(tx, look, "generate");
    return look;
  });
  if (!next) return null;
  return "generating";
}
