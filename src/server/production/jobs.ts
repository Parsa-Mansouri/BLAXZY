/**
 * Production's surface for job handlers and the generation completion hook (worker only): load
 * what a job needs, build the damis' input, store their output, request a take's generation and
 * record the outcome, always with conditional updates so a duplicate or stale run cannot
 * overwrite newer state.
 */
import { and, asc, desc, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { describeAssetRefs, listReadyReferenceAssets, type ReferenceAsset } from "@/server/assets";
import {
  failBlockPreparation,
  getBlockVersion,
  getCurrentBlock,
  getPreviousVersion,
  MAX_PRODUCTION_BLOCKS,
  storeBlockPreparation,
  type PromptBlock,
} from "@/server/blocks";
import { ASSET_TAG_PATTERN, assetTag, isVoiceRef } from "@/server/damis";
import { getDb } from "@/server/db/client";
import {
  blockTake,
  generation,
  project,
  promptBlock,
  review,
  type ProjectStyle,
} from "@/server/db/schema";
import { enqueueGeneration, requestGeneration, type FinishedGeneration } from "@/server/generation";
import { logProjectEvent } from "@/server/projects";
import { blockRevise, enqueue, productionPrepare, takeGenerate, takeReview } from "@/server/jobs";
import { isUuid, STALE_MESSAGE } from "./access";
import { ProductionInputError } from "./errors";
import { MAX_BLOCK_ASSETS } from "./inputs";
import { type RevisionRequest, revisionRequestSchema } from "./revision-request";
import { startDraftAfterRevision } from "./revision-draft";
import { usableDirection } from "./take-check";
import { getTake, type TakeRow } from "./takes";

export type ProductionJobProject = { id: string; ownerId: string; style: ProjectStyle | null };
export type ProductionJobReview = { issueCodes: string[]; note: string | null };

export type PreparationJob = {
  block: PromptBlock;
  project: ProductionJobProject;
  /** Set when this version answers a revision request on its predecessor (`block.revise`). */
  revision: { parent: PromptBlock; request: RevisionRequest } | null;
  /** The project's ready image assets: what the block may reference. */
  readyAssets: ReferenceAsset[];
};

export type TakeJob = {
  take: TakeRow;
  /** The block version the take was made for. */
  block: PromptBlock;
  /** The lineage's current version (null when the block left the film). */
  current: PromptBlock | null;
  project: ProductionJobProject;
};

export const TAKE_FAILED =
  "The clip could not be generated. Your credits were returned; try again.";

/** Longest tail of the previous block's prompt handed over for continuity. */
export const PROMPT_TAIL_LENGTH = 300;
const LABEL_LENGTH = 120;

/** A `[kind:Name]` tag with the space before it: group 1 the space, group 2 the ref. */
const TAG_PATTERN = new RegExp(`( ?)${ASSET_TAG_PATTERN.source}`, "g");

function clip(text: string, max: number): string {
  const trimmed = text.trim();
  return trimmed.length > max ? trimmed.slice(0, max) : trimmed;
}

/**
 * The end of the previous shot's prompt for continuity: at most `max` characters, starting at a
 * sentence (or, failing that, a word) so it never begins mid-word. The whole prompt when short.
 */
export function promptTail(prompt: string, max = PROMPT_TAIL_LENGTH): string {
  const text = prompt.replace(/\s+/g, " ").trim();
  if (text.length <= max) return text;
  const window = text.slice(-max);
  // The first sentence end in the window (a full stop, maybe closing a quote or bracket).
  const sentence = window.search(/[.!?]["'”’)\]]*\s+(?=\S)/);
  if (sentence >= 0) {
    const rest = window.slice(sentence + 1).replace(/^["'”’)\]]*\s+/, "");
    if (rest.length >= max / 4) return rest;
  }
  const space = window.indexOf(" ");
  return space >= 0 && space < max / 2 ? window.slice(space + 1) : window;
}

export function blockTitle(block: Pick<PromptBlock, "title" | "orderIndex">): string {
  return clip(block.title || `Shot ${block.orderIndex + 1}`, 200);
}

/** The newest revision request on a block version (a rejected review that carries one). */
async function loadRevisionRequest(blockId: string): Promise<RevisionRequest | null> {
  const [row] = await getDb()
    .select({ request: review.revisionRequest })
    .from(review)
    .where(
      and(
        eq(review.subjectType, "prompt_block"),
        eq(review.subjectId, blockId),
        eq(review.decision, "rejected"),
        isNotNull(review.revisionRequest),
      ),
    )
    .orderBy(desc(review.createdAt))
    .limit(1);
  const parsed = revisionRequestSchema.safeParse(row?.request);
  return parsed.success ? parsed.data : null;
}

async function loadProject(projectId: string): Promise<ProductionJobProject | null> {
  const [row] = await getDb()
    .select({ id: project.id, ownerId: project.ownerId, style: project.style })
    .from(project)
    .where(and(eq(project.id, projectId), isNull(project.archivedAt)))
    .limit(1);
  return row ?? null;
}

/* ------------------------------------------------------------------------------------------ */
/* Preparation                                                                                 */
/* ------------------------------------------------------------------------------------------ */

/** Everything a preparation job needs, or null when the block or its project is gone. */
export async function loadPreparationJob(blockId: string): Promise<PreparationJob | null> {
  if (!isUuid(blockId)) return null;
  const block = await getBlockVersion(blockId);
  if (!block) return null;
  const owner = await loadProject(block.projectId);
  if (!owner) return null;
  const parent = await getPreviousVersion(block);
  const request = parent ? await loadRevisionRequest(parent.id) : null;
  return {
    block,
    project: owner,
    revision: parent && request ? { parent, request } : null,
    readyAssets: await listReadyReferenceAssets(block.projectId),
  };
}

/**
 * The block's prompt for a user's choice of references: tags of image assets left out are
 * removed (the name stays as words), chosen assets the prompt does not tag are added in a line.
 */
export function promptForChosenAssets(
  prompt: string,
  chosen: readonly string[],
  names: ReadonlyMap<string, string>,
): string {
  const keep = new Set(chosen);
  const tagged = new Set<string>();
  const stripped = prompt.replace(TAG_PATTERN, (all, space: string, ref: string) => {
    if (isVoiceRef(ref) || keep.has(ref)) {
      tagged.add(ref);
      return all;
    }
    return "";
  });
  const missing = chosen.filter((ref) => !tagged.has(ref));
  if (missing.length === 0) return stripped;
  const line = missing.map((ref) => `${names.get(ref) ?? ref} ${assetTag(ref)}`).join(", ");
  return `${stripped.trimEnd()}\nALSO IN THIS SHOT: ${line}.`;
}

/** The message when a prepared shot calls more references than a clip can take. */
export function tooManyAssetsMessage(count: number): string {
  return `This shot uses ${count} assets, but a clip can use at most ${MAX_BLOCK_ASSETS}. Change its assets to choose which ones.`;
}

/** pending → ready with the dami's output. False when the block is no longer pending. */
export async function storePreparation(input: {
  blockId: string;
  prompt: string;
  assetRefs: string[];
  notes: string[];
  damiRunId: string | null;
  revised?: { direction: unknown; prompt: string; assetRefs: string[] };
}): Promise<boolean> {
  return getDb().transaction(async (tx) => {
    const row = await storeBlockPreparation(input, tx);
    if (!row) return false;
    // A shot revised from a clip review goes straight to its new draft.
    await startDraftAfterRevision(tx, row);
    await logProjectEvent(tx, {
      projectId: row.projectId,
      userId: null,
      type: "production.block_prepared",
      payload: {
        lineageId: row.lineageId,
        blockId: row.id,
        assetRefs: input.assetRefs,
        damiRunId: input.damiRunId,
      },
    });
    return true;
  });
}

/** pending → failed with a user-readable reason. Returns whether this call changed it. */
export async function failPreparation(
  blockId: string,
  failure: string,
  damiRunId?: string | null,
): Promise<boolean> {
  return getDb().transaction(async (tx) => {
    const row = await failBlockPreparation({ blockId, failure, damiRunId }, tx);
    if (!row) return false;
    await logProjectEvent(tx, {
      projectId: row.projectId,
      userId: null,
      type: "production.block_prepare_failed",
      payload: {
        lineageId: row.lineageId,
        blockId,
        failure,
      },
    });
    return true;
  });
}

/* ------------------------------------------------------------------------------------------ */
/* Takes                                                                                       */
/* ------------------------------------------------------------------------------------------ */

/** Everything a take job needs, or null when the take or its project is gone. */
export async function loadTakeJob(takeId: string): Promise<TakeJob | null> {
  if (!isUuid(takeId)) return null;
  const db = getDb();
  const take = await getTake(db, takeId);
  if (!take) return null;
  const owner = await loadProject(take.projectId);
  const block = await getBlockVersion(take.blockId);
  if (!owner || !block) return null;
  return { take, block, current: await getCurrentBlock(take.lineageId), project: owner };
}

/** Refuses work on a take whose block changed under it or is waiting for a script edit. */
export function assertTakeBlockUsable(job: TakeJob): void {
  const { current } = job;
  if (!current) throw new ProductionInputError("This shot is no longer in the film.");
  if (current.stale) throw new ProductionInputError(STALE_MESSAGE);
  if (current.productionState !== "ready") {
    throw new ProductionInputError("This shot is being prepared again. Review it first.");
  }
}

/**
 * The files a draft attaches, in token order: the accepted sheet (else look) of each asset of the
 * block's prepared references. An asset that is not ready any more stops the take with a clear
 * message instead of generating without its reference.
 */
async function draftReferences(block: PromptBlock): Promise<string[]> {
  const refs = block.productionAssetRefs ?? [];
  if (refs.length > MAX_BLOCK_ASSETS) {
    throw new ProductionInputError(tooManyAssetsMessage(refs.length));
  }
  const found = await describeAssetRefs(block.projectId, refs);
  return refs.map((ref) => {
    const asset = found.get(ref);
    if (!asset) {
      throw new ProductionInputError(
        `An asset of this shot (${ref}) is no longer in the project. Its shot must be prepared again.`,
      );
    }
    if (!asset.ready || !asset.referenceFileId) {
      throw new ProductionInputError(
        `“${asset.name}” is not ready in Pre-production any more. Finish it there, then try this clip again.`,
      );
    }
    return asset.referenceFileId;
  });
}

type RequestOutcome = "requested" | "already_requested" | "not_pending";

/**
 * Requests the take's generation and records it on the take, in one transaction with the take
 * locked (the generation's run job is sent in it too): a duplicate run finds the generation and
 * only makes sure it is queued. A draft attaches
 * the block's references; a final finishes its accepted draft (same prompt and references, the
 * draft's generation). Throws `ProductionInputError`, `InsufficientCreditsError` or
 * `GenerationInputError` (nothing is created).
 */
export async function requestTakeGeneration(takeId: string): Promise<RequestOutcome> {
  const job = await loadTakeJob(takeId);
  if (!job || job.take.status !== "pending") return "not_pending";
  if (job.take.generationId) {
    await enqueueGeneration(job.take.generationId);
    return "already_requested";
  }
  assertTakeBlockUsable(job);
  const { take, block, project: owner } = job;
  if (!owner.style) throw new ProductionInputError("Choose the project's style first.");
  if (!take.prompt) throw new Error(`take ${takeId} has no prompt to generate from`);

  let referenceFileIds: string[];
  let draftGenerationId: string | undefined;
  if (take.stage === "final") {
    const draft = take.draftTakeId ? await getTake(getDb(), take.draftTakeId) : null;
    if (!draft?.generationId || draft.status !== "accepted") {
      throw new ProductionInputError("The draft this clip finishes is not available. Start again.");
    }
    referenceFileIds = draft.referenceFileIds;
    draftGenerationId = draft.generationId;
  } else {
    // A draft that already carries its references (a rebind's corrected ones, a reroll's) keeps
    // them; any other draft attaches what its block's assets are now.
    referenceFileIds =
      take.referenceFileIds.length > 0 ? take.referenceFileIds : await draftReferences(block);
  }
  const label = clip(
    `B${String(block.orderIndex + 1).padStart(3, "0")} ${blockTitle(block)}`,
    LABEL_LENGTH,
  );
  const style = owner.style;

  // The generation, its reserved credits, its run job and the take's link to it are written in
  // one transaction: none of them can exist without the others.
  return getDb().transaction(async (tx): Promise<RequestOutcome> => {
    const [row] = await tx.select().from(blockTake).where(eq(blockTake.id, takeId)).for("update");
    if (!row || row.status !== "pending") return "not_pending";
    if (row.generationId) {
      await enqueueGeneration(row.generationId, { tx });
      return "already_requested";
    }
    const { generationId } = await requestGeneration(
      {
        userId: owner.ownerId,
        projectId: owner.id,
        purpose: take.stage === "final" ? "block_final" : "block_draft",
        prompt: take.prompt ?? "",
        referenceFileIds,
        label,
        style,
        durationSeconds: block.durationSeconds ?? undefined,
        sound: true,
        draftGenerationId,
        // A reroll or a rebind is the same request again: a new variant makes it a new render.
        ...(take.route === "reroll" || take.route === "rebind" ? { variant: take.id } : {}),
        maxCredits: row.confirmedCredits,
      },
      tx,
    );
    await tx
      .update(blockTake)
      .set({ generationId, referenceFileIds })
      .where(eq(blockTake.id, takeId));
    return "requested";
  });
}

/** pending → failed with a user-readable reason. Returns whether this call changed it. */
export async function failTake(
  takeId: string,
  failure: string,
  damiRunId?: string | null,
): Promise<boolean> {
  return getDb().transaction(async (tx) => {
    const [row] = await tx
      .update(blockTake)
      .set({ status: "failed", failure, ...(damiRunId ? { damiRunId } : {}) })
      .where(and(eq(blockTake.id, takeId), eq(blockTake.status, "pending")))
      .returning();
    if (!row) return false;
    await logProjectEvent(tx, {
      projectId: row.projectId,
      userId: null,
      type: "production.take_failed",
      payload: {
        lineageId: row.lineageId,
        takeId,
        stage: row.stage,
        failure,
      },
    });
    return true;
  });
}

/**
 * The generation completion hook of Production: moves the pending take that requested this
 * generation to `in_review` with its clip and poster, or to `failed` with the generation's
 * user-readable error. Idempotent (only a pending take holding this generation changes), so it
 * may be called any number of times. Generations of other purposes are ignored.
 */
export async function applyTakeGenerationResult(g: FinishedGeneration): Promise<void> {
  if (g.purpose !== "block_draft" && g.purpose !== "block_final") return;
  if (g.status !== "succeeded" && g.status !== "failed" && g.status !== "cancelled") return;
  const succeeded = g.status === "succeeded" && g.resultFileId !== null;
  const values = succeeded
    ? {
        status: "in_review" as const,
        fileId: g.resultFileId,
        posterFileId: g.posterFileId ?? null,
        failure: null,
      }
    : { status: "failed" as const, failure: g.error ?? TAKE_FAILED };
  // The project narrows the update to the (project, status) index of takes.
  const [owner] = await getDb()
    .select({ projectId: generation.projectId })
    .from(generation)
    .where(eq(generation.id, g.id))
    .limit(1);
  if (!owner) return;
  const { projectId } = owner;
  await getDb().transaction(async (tx) => {
    const [row] = await tx
      .update(blockTake)
      .set(values)
      .where(
        and(
          eq(blockTake.projectId, projectId),
          eq(blockTake.status, "pending"),
          eq(blockTake.generationId, g.id),
        ),
      )
      .returning({
        id: blockTake.id,
        blockId: blockTake.blockId,
        lineageId: blockTake.lineageId,
        stage: blockTake.stage,
      });
    if (row) {
      if (succeeded) {
        // The Video Review runs beside the user's own review; blocks cut before the Director
        // (no usable direction) are not reviewed, so they never wait for it.
        const [blockRow] = await tx
          .select({ direction: promptBlock.direction })
          .from(promptBlock)
          .where(eq(promptBlock.id, row.blockId))
          .limit(1);
        if (usableDirection(blockRow?.direction)) {
          await tx.update(blockTake).set({ autoReview: "pending" }).where(eq(blockTake.id, row.id));
          await enqueue(takeReview, { takeId: row.id }, { tx });
        }
      }
      await logProjectEvent(tx, {
        projectId,
        userId: null,
        type: succeeded ? "production.take_ready" : "production.take_failed",
        payload: { lineageId: row.lineageId, takeId: row.id, stage: row.stage, generationId: g.id },
      });
    }
  });
}

/* ------------------------------------------------------------------------------------------ */
/* Fan-out (`production.dispatch`)                                                             */
/* ------------------------------------------------------------------------------------------ */

/**
 * Queues the per-row job of every pending row of a project (worker, `production.dispatch`):
 * `prepare`: each current, non-stale block waiting for preparation gets `block.revise` when it
 * answers a revision request on its predecessor, else `production.prepare`; `takes`: each
 * pending take without a generation gets `take.generate`. Safe to
 * run any number of times: the per-row jobs are keyed by their row (a duplicate send is dropped)
 * and their handlers check the row is still waiting. Returns how many rows it covered.
 */
export async function dispatchProductionJobs(
  projectId: string,
  kind: "prepare" | "takes",
): Promise<number> {
  if (!isUuid(projectId)) return 0;
  const db = getDb();
  if (kind === "prepare") {
    const blocks = await db
      .select({
        id: promptBlock.id,
        lineageId: promptBlock.lineageId,
        versionNumber: promptBlock.versionNumber,
      })
      .from(promptBlock)
      .where(
        and(
          eq(promptBlock.projectId, projectId),
          isNull(promptBlock.supersededAt),
          eq(promptBlock.stale, false),
          eq(promptBlock.productionState, "pending"),
        ),
      )
      .orderBy(asc(promptBlock.orderIndex), asc(promptBlock.id))
      .limit(MAX_PRODUCTION_BLOCKS);
    if (blocks.length === 0) return 0;
    // A revision answers a rejected review with a revision request on the version right before it.
    const previous = alias(promptBlock, "previous");
    const revisions = await db
      .selectDistinct({ id: promptBlock.id })
      .from(promptBlock)
      .innerJoin(
        previous,
        and(
          eq(previous.lineageId, promptBlock.lineageId),
          eq(previous.versionNumber, sql`${promptBlock.versionNumber} - 1`),
        ),
      )
      .innerJoin(
        review,
        and(
          eq(review.subjectType, "prompt_block"),
          eq(review.subjectId, previous.id),
          eq(review.decision, "rejected"),
          isNotNull(review.revisionRequest),
        ),
      )
      .where(
        inArray(
          promptBlock.id,
          blocks.map((b) => b.id),
        ),
      );
    const revise = new Set(revisions.map((r) => r.id));
    for (const block of blocks) {
      await enqueue(revise.has(block.id) ? blockRevise : productionPrepare, { blockId: block.id });
    }
    return blocks.length;
  }
  const takes = await db
    .select({ id: blockTake.id, prompt: blockTake.prompt })
    .from(blockTake)
    .where(
      and(
        eq(blockTake.projectId, projectId),
        eq(blockTake.status, "pending"),
        isNull(blockTake.generationId),
      ),
    )
    .orderBy(asc(blockTake.createdAt))
    .limit(MAX_PRODUCTION_BLOCKS);
  for (const take of takes) {
    await enqueue(takeGenerate, { takeId: take.id });
  }
  return takes.length;
}
