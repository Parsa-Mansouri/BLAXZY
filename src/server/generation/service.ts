/**
 * Generations: one paid job at a generation provider. The model comes from the platform's policy
 * (`pickModel`), the price from the provider, and the credits are reserved in the same
 * transaction that creates the row. The `generation.run` job does the work (see `run.ts`).
 */
import { and, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod";
import { refund, reserve } from "@/server/billing";
import { projectStyleSchema } from "@/server/damis";
import { getDb, type DbTx } from "@/server/db/client";
import {
  GENERATION_PURPOSES,
  generation,
  project,
  type GenerationKind,
  type GenerationPurpose,
  type GenerationStatus,
  type ProjectStyle,
} from "@/server/db/schema";
import { enqueue, generationRun } from "@/server/jobs";
import { errorMessage, logLine } from "@/server/jobs/log";
import { getProvider, isSampleProvider, pickModel } from "@/server/providers";
import { getOwnedFileInfo, type FilePurpose } from "@/server/storage";
import { GenerationInputError } from "./errors";

export type GenerationRow = typeof generation.$inferSelect;

/** A generation as callers see it. */
export type GenerationView = {
  id: string;
  projectId: string;
  kind: GenerationKind;
  purpose: GenerationPurpose;
  model: string;
  params: Record<string, unknown>;
  prompt: string;
  referenceFileIds: string[];
  status: GenerationStatus;
  priceCredits: number;
  resultFileId: string | null;
  /** Video: the poster (a still of the clip), stored next to the result. */
  posterFileId: string | null;
  /** User-readable reason when failed. */
  error: string | null;
  attempts: number;
  /** Placeholder output (sample provider). */
  isSample: boolean;
  createdAt: Date;
  startedAt: Date | null;
  finishedAt: Date | null;
};

export type RequestGenerationInput = {
  userId: string;
  projectId: string;
  purpose: GenerationPurpose;
  prompt: string;
  referenceFileIds?: string[];
  /** Shown on sample output only (usually the asset's name). */
  label?: string;
  style: ProjectStyle;
  /** Video: clip length in seconds (clamped to 1..15 by the policy; default 5). */
  durationSeconds?: number;
  /** Video: with a sound track. */
  sound?: boolean;
  /**
   * `block_final` only, and required there: the succeeded `block_draft` generation (same user and
   * project) the final finishes.
   */
  draftGenerationId?: string;
};

export const MAX_PROMPT_LENGTH = 8_000;
export const MAX_REFERENCES = 8;
export const MAX_LABEL_LENGTH = 120;

/** Where each purpose's output is stored. Purposes without one cannot be requested yet. */
export const RESULT_FILE_PURPOSE: Readonly<Record<GenerationPurpose, FilePurpose | null>> = {
  asset_look: "generated_image",
  asset_sheet: "sheet_image",
  block_draft: "generated_video",
  block_final: "generated_video",
};

/** Where a video's poster is stored. */
export const POSTER_FILE_PURPOSE: FilePurpose = "video_poster";

/** Kept in `params` for the run (the provider gets it as `label`, not as a model parameter). */
export const LABEL_PARAM = "label";
/** Kept in `params` of a final: the draft generation it finishes (resolved at run time). */
export const DRAFT_PARAM = "draftGenerationId";
/**
 * Written into `params` when a video succeeds: its poster file (the table has no column for it,
 * and a repeated completion hook must still get it).
 */
export const POSTER_PARAM = "posterFileId";
/** `params` keys that are the platform's bookkeeping, never model parameters. */
export const RESERVED_PARAMS: readonly string[] = [LABEL_PARAM, DRAFT_PARAM, POSTER_PARAM];

const FINISHED: readonly GenerationStatus[] = ["succeeded", "failed", "cancelled"];
const ENQUEUE_FAILURE =
  "We could not start this generation. Your credits were returned; try again.";

const uuid = z.uuid();
const purposeSchema = z.enum(GENERATION_PURPOSES, { error: "Unknown kind of generation." });
const styleSchema = z.custom<ProjectStyle>((v) => projectStyleSchema.safeParse(v).success, {
  message: "The project's style is not valid.",
});

const quoteSchema = z.object({ purpose: purposeSchema, style: styleSchema });

const requestSchema = z.object({
  userId: z.string().trim().min(1).max(128),
  projectId: z.string(),
  purpose: purposeSchema,
  prompt: z
    .string({ error: "Write a prompt." })
    .trim()
    .min(1, "Write a prompt.")
    .max(MAX_PROMPT_LENGTH, `Keep the prompt under ${MAX_PROMPT_LENGTH} characters.`),
  referenceFileIds: z
    .array(z.string())
    .max(MAX_REFERENCES, `Use at most ${MAX_REFERENCES} reference images.`)
    .default([]),
  label: z.string().trim().max(MAX_LABEL_LENGTH).optional(),
  style: styleSchema,
  durationSeconds: z.number({ error: "The duration must be a number of seconds." }).optional(),
  sound: z.boolean().optional(),
  draftGenerationId: z.string().optional(),
});

function parse<S extends z.ZodType>(schema: S, input: unknown): z.output<S> {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw new GenerationInputError(result.error.issues[0]?.message ?? "That input is not valid.");
  }
  return result.data;
}

export function isFinished(status: GenerationStatus): boolean {
  return FINISHED.includes(status);
}

/** The poster file of a succeeded video, or null. */
export function posterFileIdOf(row: Pick<GenerationRow, "params">): string | null {
  const value = row.params[POSTER_PARAM];
  return typeof value === "string" ? value : null;
}

export function toView(row: GenerationRow): GenerationView {
  return {
    id: row.id,
    projectId: row.projectId,
    kind: row.kind,
    purpose: row.purpose,
    model: row.model,
    params: row.params,
    prompt: row.prompt,
    referenceFileIds: row.referenceFileIds,
    status: row.status,
    priceCredits: row.priceCredits,
    resultFileId: row.resultFileId,
    posterFileId: posterFileIdOf(row),
    error: row.error,
    attempts: row.attempts,
    isSample: isSampleProvider(row.provider),
    createdAt: row.createdAt,
    startedAt: row.startedAt,
    finishedAt: row.finishedAt,
  };
}

/** What a generation of this purpose costs in this project, in credits. Creates nothing. */
export async function quoteGeneration(input: {
  purpose: GenerationPurpose;
  style: ProjectStyle;
}): Promise<{ priceCredits: number }> {
  const { purpose, style } = parse(quoteSchema, input);
  const choice = pickModel(purpose, style);
  const priceCredits = await getProvider().price({
    kind: choice.kind,
    purpose,
    model: choice.model,
    prompt: "",
    params: choice.params,
  });
  return { priceCredits };
}

/** Checks every reference is a ready image the user owns; returns the ids without duplicates. */
async function checkReferences(ids: string[], userId: string): Promise<string[]> {
  const unique = [...new Set(ids)];
  for (const id of unique) {
    const info = uuid.safeParse(id).success ? await getOwnedFileInfo(id, userId) : null;
    if (!info || info.status !== "ready") {
      throw new GenerationInputError("A reference image was not found.");
    }
    if (!info.mimeType.startsWith("image/")) {
      throw new GenerationInputError("Reference files must be images.");
    }
  }
  return unique;
}

/**
 * A final's draft: a succeeded `block_draft` of the same user and project with a provider job.
 * Returns its id; throws `GenerationInputError` otherwise.
 */
async function checkDraft(
  db: DbTx,
  draftGenerationId: string,
  userId: string,
  projectId: string,
): Promise<string> {
  const notUsable = new GenerationInputError("The draft to finish was not found or is not ready.");
  if (!uuid.safeParse(draftGenerationId).success) throw notUsable;
  const [draft] = await db
    .select({
      id: generation.id,
      purpose: generation.purpose,
      status: generation.status,
      providerJobId: generation.providerJobId,
    })
    .from(generation)
    .where(
      and(
        eq(generation.id, draftGenerationId),
        eq(generation.userId, userId),
        eq(generation.projectId, projectId),
      ),
    )
    .limit(1);
  if (
    !draft ||
    draft.purpose !== "block_draft" ||
    draft.status !== "succeeded" ||
    !draft.providerJobId
  ) {
    throw notUsable;
  }
  return draft.id;
}

/**
 * Picks the model, prices it, inserts the generation (queued) and reserves its credits, in one
 * transaction; enqueues `generation.run` after commit. With `tx` it runs inside the caller's
 * transaction and the caller enqueues (`enqueueGeneration`) after its commit.
 *
 * Throws `GenerationInputError` (bad input, a project or reference that is not the user's, a
 * purpose not available yet) and `InsufficientCreditsError` (nothing is created).
 */
export async function requestGeneration(
  input: RequestGenerationInput,
  tx?: DbTx,
): Promise<{ generationId: string; priceCredits: number }> {
  const data = parse(requestSchema, input);
  if (!uuid.safeParse(data.projectId).success) {
    throw new GenerationInputError("That project was not found.");
  }
  if (!RESULT_FILE_PURPOSE[data.purpose]) {
    throw new GenerationInputError("This kind of generation is not available yet.");
  }
  const isFinal = data.purpose === "block_final";
  if (isFinal && !data.draftGenerationId) {
    throw new GenerationInputError("A final needs the accepted draft it finishes.");
  }
  if (!isFinal && data.draftGenerationId !== undefined) {
    throw new GenerationInputError("Only a final is made from a draft.");
  }
  const referenceFileIds = await checkReferences(data.referenceFileIds, data.userId);
  const choice = pickModel(data.purpose, data.style, {
    durationSeconds: data.durationSeconds,
    sound: data.sound,
  });
  const provider = getProvider();
  const priceCredits = await provider.price({
    kind: choice.kind,
    purpose: data.purpose,
    model: choice.model,
    prompt: data.prompt,
    params: choice.params,
    label: data.label,
  });

  const create = async (db: DbTx): Promise<string> => {
    const [owned] = await db
      .select({ id: project.id })
      .from(project)
      .where(
        and(
          eq(project.id, data.projectId),
          eq(project.ownerId, data.userId),
          isNull(project.archivedAt),
        ),
      )
      .limit(1);
    if (!owned) throw new GenerationInputError("That project was not found.");
    const params: Record<string, unknown> = { ...choice.params };
    if (data.label) params[LABEL_PARAM] = data.label;
    if (data.draftGenerationId) {
      params[DRAFT_PARAM] = await checkDraft(
        db,
        data.draftGenerationId,
        data.userId,
        data.projectId,
      );
    }
    const [row] = await db
      .insert(generation)
      .values({
        userId: data.userId,
        projectId: data.projectId,
        kind: choice.kind,
        purpose: data.purpose,
        provider: provider.id,
        model: choice.model,
        params,
        prompt: data.prompt,
        referenceFileIds,
        status: "queued",
        priceCredits,
      })
      .returning({ id: generation.id });
    if (!row) throw new Error("generation insert returned no row");
    await reserve({ userId: data.userId, generationId: row.id, amount: priceCredits }, db);
    return row.id;
  };

  if (tx) {
    const generationId = await create(tx);
    return { generationId, priceCredits };
  }
  const generationId = await getDb().transaction(create);
  logLine("info", "generation requested", {
    generationId,
    userId: data.userId,
    projectId: data.projectId,
    purpose: data.purpose,
    provider: provider.id,
    model: choice.model,
    priceCredits,
  });
  try {
    await enqueueGeneration(generationId);
  } catch (err) {
    logLine("error", "generation enqueue failed", { generationId, error: errorMessage(err) });
    await failGeneration(generationId, ENQUEUE_FAILURE);
  }
  return { generationId, priceCredits };
}

/** Queues the run of a generation (idempotent: one queued job per generation). */
export async function enqueueGeneration(generationId: string): Promise<void> {
  await enqueue(generationRun, { generationId });
}

/** The generation, or null when it is missing or not the user's. */
export async function getGeneration(
  generationId: string,
  userId: string,
): Promise<GenerationView | null> {
  if (!uuid.safeParse(generationId).success) return null;
  const [row] = await getDb()
    .select()
    .from(generation)
    .where(and(eq(generation.id, generationId), eq(generation.userId, userId)))
    .limit(1);
  return row ? toView(row) : null;
}

/**
 * queued/running → failed with a user-readable reason, and refunds its credits, in one
 * transaction. Returns whether this call changed it.
 */
export async function failGeneration(generationId: string, error: string): Promise<boolean> {
  return getDb().transaction(async (tx) => {
    const updated = await tx
      .update(generation)
      .set({ status: "failed", error, finishedAt: new Date() })
      .where(
        and(eq(generation.id, generationId), inArray(generation.status, ["queued", "running"])),
      )
      .returning({ id: generation.id });
    if (updated.length === 0) return false;
    await refund({ generationId }, tx);
    return true;
  });
}
