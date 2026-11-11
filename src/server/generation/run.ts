/**
 * The `generation.run` job's work (worker only). Safe to run twice and to resume:
 *
 * 1. A finished generation is skipped (its completion hooks are called again).
 * 2. Claim: under a per-user advisory lock, a queued generation becomes running unless the user
 *    already has `GENERATION_MAX_PER_USER` running; then the job schedules a follow-up of itself
 *    and ends (rescheduled, not failed).
 * 3. The provider job is created once: `create` runs while the row is locked and its id is stored
 *    before any polling, so a retry (or a duplicate run) resumes the same provider job.
 * 4. Poll with backoff within the attempt's time budget; on success store the output (streamed
 *    when the provider streams it; a video's poster too), mark the generation succeeded and settle
 *    its credits in one transaction (conditional on `running`).
 * 5. A non-retryable failure, or any failure on the last attempt, marks it failed and refunds.
 */
import { and, eq, gt, ne, sql } from "drizzle-orm";
import { settle } from "@/server/billing";
import { getDb } from "@/server/db/client";
import { generation } from "@/server/db/schema";
import { getEnv } from "@/server/env";
import { enqueue, generationRun, type JobContext } from "@/server/jobs";
import { errorMessage, logLine } from "@/server/jobs/log";
import {
  getProvider,
  ProviderError,
  type GenerationProvider,
  type GenerationReference,
  type GenerationRequest,
} from "@/server/providers";
import {
  getOwnedFileInfo,
  putFileBytes,
  readFileBytes,
  StorageError,
  type FileInfo,
} from "@/server/storage";
import { GenerationRunError } from "./errors";
import { notifyGenerationFinished } from "./hooks";
import {
  DRAFT_PARAM,
  failGeneration,
  isFinished,
  LABEL_PARAM,
  POSTER_FILE_PURPOSE,
  POSTER_PARAM,
  posterFileIdOf,
  RESERVED_PARAMS,
  RESULT_FILE_PURPOSE,
  type GenerationRow,
} from "./service";

export type RunOutcome = "skipped" | "deferred" | "succeeded" | "failed";

/** A running generation older than this no longer counts against the per-user limit. */
const STALE_RUNNING_MS = 2 * 60 * 60 * 1000;
/** Follow-up delay when the user is at the limit: base plus jitter. */
const DEFER_BASE_MS = 10_000;
const DEFER_JITTER_MS = 10_000;
/** Poll backoff (when the provider gives no `retryAfterMs`). */
const POLL_FIRST_MS = 500;
const POLL_MAX_MS = 15_000;
const POLL_MIN_MS = 200;
/** Time kept free at the end of an attempt (storing the result, bookkeeping). */
const BUDGET_RESERVE_MS = 60_000;

const GENERIC_FAILURE = "The generation failed. Your credits were returned; try again.";

const MIME_EXTENSIONS: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "video/mp4": "mp4",
};

type Log = (
  level: "info" | "warn" | "error",
  msg: string,
  fields?: Record<string, unknown>,
) => void;

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(signal.reason ?? new Error("aborted"));
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal.reason ?? new Error("aborted"));
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

async function loadRow(generationId: string): Promise<GenerationRow | undefined> {
  const [row] = await getDb()
    .select()
    .from(generation)
    .where(eq(generation.id, generationId))
    .limit(1);
  return row;
}

/** Calls the completion hooks for a finished generation (also used by the sweep). */
export async function notify(row: GenerationRow): Promise<void> {
  await notifyGenerationFinished({
    id: row.id,
    purpose: row.purpose,
    status: row.status,
    resultFileId: row.resultFileId,
    posterFileId: posterFileIdOf(row),
    error: row.error,
  });
}

type Claim = { kind: "claimed"; row: GenerationRow } | { kind: "deferred" } | { kind: "finished" };

/** queued → running (or a resumed running one), unless the user is at the limit. */
async function claim(generationId: string, userId: string, maxPerUser: number): Promise<Claim> {
  return getDb().transaction(async (tx) => {
    // Serialises claims per user, so the limit holds across worker processes.
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`generation.user:${userId}`}, 0))`,
    );
    const [row] = await tx
      .select()
      .from(generation)
      .where(eq(generation.id, generationId))
      .for("update");
    if (!row || isFinished(row.status)) return { kind: "finished" };
    if (row.status === "queued") {
      const [{ running } = { running: 0 }] = await tx
        .select({ running: sql<number>`count(*)::int` })
        .from(generation)
        .where(
          and(
            eq(generation.userId, userId),
            eq(generation.status, "running"),
            ne(generation.id, generationId),
            gt(generation.startedAt, new Date(Date.now() - STALE_RUNNING_MS)),
          ),
        );
      if (running >= maxPerUser) return { kind: "deferred" };
    }
    const [claimed] = await tx
      .update(generation)
      .set({
        status: "running",
        startedAt: row.startedAt ?? new Date(),
        attempts: sql`${generation.attempts} + 1`,
      })
      .where(eq(generation.id, generationId))
      .returning();
    if (!claimed) throw new Error(`generation ${generationId} vanished during claim`);
    return { kind: "claimed", row: claimed };
  });
}

/** Reads the reference files, checking each still belongs to the generation's user. */
async function loadReferences(
  row: GenerationRow,
  signal: AbortSignal,
): Promise<GenerationReference[]> {
  const references: GenerationReference[] = [];
  for (const fileId of row.referenceFileIds) {
    const info = await getOwnedFileInfo(fileId, row.userId);
    if (!info || info.status !== "ready") {
      throw new GenerationRunError("A reference image is missing or not available.", false);
    }
    const bytes = await readFileBytes(fileId, { signal });
    references.push({ bytes, mimeType: info.mimeType, name: info.originalName ?? fileId });
  }
  return references;
}

/** A final's draft: its provider job id, checking it is still the user's succeeded draft. */
async function loadDraftProviderJobId(row: GenerationRow): Promise<string | undefined> {
  const draftId = row.params[DRAFT_PARAM];
  if (draftId === undefined) return undefined;
  const [draft] =
    typeof draftId === "string"
      ? await getDb()
          .select({ status: generation.status, providerJobId: generation.providerJobId })
          .from(generation)
          .where(
            and(
              eq(generation.id, draftId),
              eq(generation.userId, row.userId),
              eq(generation.purpose, "block_draft"),
            ),
          )
          .limit(1)
      : [];
  if (!draft || draft.status !== "succeeded" || !draft.providerJobId) {
    throw new GenerationRunError("The draft to finish is no longer available.", false);
  }
  return draft.providerJobId;
}

function buildRequest(
  row: GenerationRow,
  references: GenerationReference[],
  draftProviderJobId: string | undefined,
): GenerationRequest {
  const params = Object.fromEntries(
    Object.entries(row.params).filter(([key]) => !RESERVED_PARAMS.includes(key)),
  );
  const label = row.params[LABEL_PARAM];
  return {
    kind: row.kind,
    purpose: row.purpose,
    model: row.model,
    prompt: row.prompt,
    params,
    references,
    label: typeof label === "string" ? label : undefined,
    ...(draftProviderJobId !== undefined ? { draftProviderJobId } : {}),
  };
}

/** The stored provider job id, creating the provider job if there is none yet (once). */
async function ensureProviderJob(
  row: GenerationRow,
  provider: GenerationProvider,
  signal: AbortSignal,
  log: Log,
): Promise<string> {
  if (row.providerJobId) return row.providerJobId;
  const draftProviderJobId = await loadDraftProviderJobId(row);
  const request = buildRequest(row, await loadReferences(row, signal), draftProviderJobId);
  return getDb().transaction(async (tx) => {
    // The row lock makes a concurrent duplicate run wait here, then reuse the stored id.
    const [locked] = await tx
      .select({ providerJobId: generation.providerJobId })
      .from(generation)
      .where(eq(generation.id, row.id))
      .for("update");
    if (locked?.providerJobId) return locked.providerJobId;
    const { providerJobId } = await provider.create(request);
    await tx.update(generation).set({ providerJobId }).where(eq(generation.id, row.id));
    log("info", "provider job created", { provider: provider.id, providerJobId });
    return providerJobId;
  });
}

type PollResult = { state: "succeeded" } | { state: "failed"; reason: string; retryable: boolean };

async function pollUntilDone(
  provider: GenerationProvider,
  providerJobId: string,
  deadline: number,
  signal: AbortSignal,
): Promise<PollResult> {
  let delay = POLL_FIRST_MS;
  for (;;) {
    if (signal.aborted) throw signal.reason ?? new Error("aborted");
    const status = await provider.getStatus(providerJobId);
    if (status.state !== "running") return status;
    const wait = Math.min(Math.max(status.retryAfterMs ?? delay, POLL_MIN_MS), POLL_MAX_MS);
    if (Date.now() + wait > deadline) {
      throw new GenerationRunError(
        "The generation is taking longer than expected. Your credits were returned; try again.",
        true,
      );
    }
    await sleep(wait, signal);
    delay = Math.min(delay * 2, POLL_MAX_MS);
  }
}

/** Stores the result and marks the generation succeeded + settled. False if another run won. */
async function storeResult(
  row: GenerationRow,
  provider: GenerationProvider,
  providerJobId: string,
  signal: AbortSignal,
  log: Log,
): Promise<boolean> {
  const purpose = RESULT_FILE_PURPOSE[row.purpose];
  if (!purpose)
    throw new GenerationRunError("This kind of generation cannot be stored yet.", false);
  const baseName = `${row.purpose.replace("_", "-")}-${row.id}`;
  const result = await provider.fetchResult(providerJobId, { signal });
  let stored: FileInfo;
  let poster: FileInfo | null = null;
  try {
    const extension = MIME_EXTENSIONS[result.mimeType.toLowerCase()] ?? "bin";
    const common = {
      ownerId: row.userId,
      projectId: row.projectId,
      name: `${baseName}.${extension}`,
      mimeType: result.mimeType,
      purpose,
      signal,
    };
    // A streamed result goes to the store as a stream of known length (no copy in memory).
    stored = await putFileBytes(
      "stream" in result
        ? { ...common, bytes: result.stream, sizeBytes: result.sizeBytes }
        : { ...common, bytes: result.bytes },
    );
    if (row.kind === "video" && result.poster) {
      const posterExtension = MIME_EXTENSIONS[result.poster.mimeType.toLowerCase()] ?? "bin";
      poster = await putFileBytes({
        ownerId: row.userId,
        projectId: row.projectId,
        name: `${baseName}-poster.${posterExtension}`,
        mimeType: result.poster.mimeType,
        purpose: POSTER_FILE_PURPOSE,
        bytes: result.poster.bytes,
        signal,
      });
    }
  } finally {
    await result.dispose?.();
  }
  const posterId = poster?.id;
  const won = await getDb().transaction(async (tx) => {
    const updated = await tx
      .update(generation)
      .set({
        status: "succeeded",
        resultFileId: stored.id,
        error: null,
        finishedAt: new Date(),
        ...(posterId ? { params: { ...row.params, [POSTER_PARAM]: posterId } } : {}),
      })
      .where(and(eq(generation.id, row.id), eq(generation.status, "running")))
      .returning({ id: generation.id });
    if (updated.length === 0) return false;
    await settle({ generationId: row.id }, tx);
    return true;
  });
  const fields = { fileId: stored.id, posterFileId: posterId ?? null };
  if (!won) log("warn", "generation already finished by another run", fields);
  else log("info", "generation result stored", { ...fields, bytes: stored.sizeBytes });
  return won;
}

type FailureDecision = { message: string; retryable: boolean };

function classify(error: unknown, aborted: boolean): FailureDecision {
  if (aborted) {
    return {
      message: "The generation took too long and was stopped. Your credits were returned.",
      retryable: true,
    };
  }
  if (error instanceof GenerationRunError || error instanceof ProviderError) {
    return { message: error.message, retryable: error.retryable };
  }
  if (error instanceof StorageError) {
    return {
      message:
        error.code === "invalid_file"
          ? "The provider returned a file that cannot be used. Your credits were returned."
          : "A file needed for this generation is missing. Your credits were returned.",
      retryable: false,
    };
  }
  return { message: GENERIC_FAILURE, retryable: true };
}

async function finishFailed(
  generationId: string,
  message: string,
  log: Log,
  fields: Record<string, unknown>,
): Promise<void> {
  const changed = await failGeneration(generationId, message);
  log("error", "generation failed", { ...fields, failure: message, refunded: changed });
}

/**
 * Runs one attempt of `generation.run`. Throws to have the queue retry the attempt (transient
 * failures before the last attempt, an aborted attempt); returns otherwise.
 */
export async function runGeneration(generationId: string, ctx: JobContext): Promise<RunOutcome> {
  const env = getEnv();
  const last = ctx.attempt > generationRun.options.retryLimit;
  const base = { generationId, jobId: ctx.jobId, attempt: ctx.attempt };
  const log: Log = (level, msg, fields = {}) => logLine(level, msg, { ...base, ...fields });

  const initial = await loadRow(generationId);
  if (!initial) {
    log("warn", "generation not found");
    return "skipped";
  }
  if (isFinished(initial.status)) {
    await notify(initial);
    return "skipped";
  }

  const claimed = await claim(generationId, initial.userId, env.GENERATION_MAX_PER_USER);
  if (claimed.kind === "finished") {
    const row = await loadRow(generationId);
    if (row) await notify(row);
    return "skipped";
  }
  if (claimed.kind === "deferred") {
    const startAfter = new Date(Date.now() + DEFER_BASE_MS + Math.random() * DEFER_JITTER_MS);
    const followUp = await enqueue(generationRun, { generationId }, { startAfter });
    log("info", "generation deferred", {
      userId: initial.userId,
      limit: env.GENERATION_MAX_PER_USER,
      startAfter: startAfter.toISOString(),
      followUpJobId: followUp,
    });
    return "deferred";
  }

  const row = claimed.row;
  const provider = getProvider(row.provider);
  const fields = { userId: row.userId, purpose: row.purpose, provider: row.provider };
  const started = Date.now();
  const deadline =
    started + Math.max(generationRun.options.expireInSeconds * 1000 - BUDGET_RESERVE_MS, 30_000);
  log("info", "generation attempt started", { ...fields, resumed: row.providerJobId !== null });

  let outcome: RunOutcome;
  try {
    const providerJobId = await ensureProviderJob(row, provider, ctx.signal, log);
    const status = await pollUntilDone(provider, providerJobId, deadline, ctx.signal);
    if (status.state === "failed") {
      if (status.retryable && !last) throw new GenerationRunError(status.reason, true);
      await finishFailed(row.id, status.reason, log, { ...fields, providerJobId });
      outcome = "failed";
    } else {
      const won = await storeResult(row, provider, providerJobId, ctx.signal, log);
      if (won) log("info", "generation succeeded", { ...fields, ms: Date.now() - started });
      outcome = won ? "succeeded" : "skipped";
    }
  } catch (error) {
    const aborted = ctx.signal.aborted;
    const decision = classify(error, aborted);
    if (decision.retryable && !last) {
      log("warn", "generation attempt failed, will retry", {
        ...fields,
        aborted,
        error: errorMessage(error),
      });
      throw error;
    }
    await finishFailed(row.id, decision.message, log, { ...fields, error: errorMessage(error) });
    outcome = "failed";
  }

  // Outside the try: a hook that throws fails the attempt, and the retry calls the hooks again.
  const finished = await loadRow(row.id);
  if (finished && isFinished(finished.status)) await notify(finished);
  return outcome;
}
