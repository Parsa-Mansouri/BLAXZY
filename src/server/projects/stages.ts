import { and, asc, eq, isNull } from "drizzle-orm";
import { getDb, type DbTx } from "@/server/db/client";
import {
  episode,
  project,
  WIZARD_STAGES,
  type ProjectStyle,
  type WizardStage,
} from "@/server/db/schema";
import { z } from "zod";
import { projectStyleSchema } from "@/server/damis";
import { refreshCreativeBible } from "./creative-bible";
import { episodeCount, episodeCountOf } from "./episodes";
import { logProjectEvent } from "./events";
import { findOwnedProject } from "./ownership";
import type { Project } from "./service";
import { ProjectInputError, uuidSchema } from "./schemas";
import { applyStyleReferences, assertReferenceFiles, referenceFileIds } from "./style-references";

export type Episode = typeof episode.$inferSelect;

/** A transaction handle, so other services can advance the stage inside their own transaction. */
export type DbTransaction = DbTx;

export type SaveStyleInput = { projectId: string; userId: string; style: unknown };
export type AdvanceStageInput = { projectId: string; from: WizardStage; to: WizardStage };

export const MIN_DURATION_SECONDS = 5;
export const MAX_DURATION_SECONDS = 4 * 60 * 60;
export const MAX_EPISODES = 100;

const notArchived = isNull(project.archivedAt);

function stageIndex(stage: string): number {
  return WIZARD_STAGES.indexOf(stage as WizardStage);
}

/** A stage can be opened when it is the current stage or an earlier one; `done` opens all. */
export function canOpenStage(current: Pick<Project, "stage">, stage: WizardStage): boolean {
  if (current.stage === "done") return true;
  const cur = stageIndex(current.stage);
  const want = stageIndex(stage);
  return cur >= 0 && want >= 0 && want <= cur;
}

/**
 * Throws `new ErrorClass(message)` unless `stage` can be opened (`canOpenStage`). Projects whose
 * stage is not a Wizard stage (Pro) are not gated.
 */
export function assertStageOpen(
  row: Pick<Project, "stage">,
  stage: WizardStage,
  ErrorClass: new (message: string) => Error,
  message: string,
): void {
  const wizardStage = (WIZARD_STAGES as readonly string[]).includes(row.stage);
  if (wizardStage && !canOpenStage(row, stage)) throw new ErrorClass(message);
}

/**
 * Compare-and-set on `project.stage` (`WHERE stage = from`). Returns whether it changed.
 * Pass `tx` to run inside the caller's transaction.
 */
export async function advanceStage(input: AdvanceStageInput, tx?: DbTransaction): Promise<boolean> {
  const run = async (db: DbTransaction): Promise<boolean> => {
    const changed = await db
      .update(project)
      .set({ stage: input.to })
      .where(and(eq(project.id, input.projectId), eq(project.stage, input.from)))
      .returning({ id: project.id });
    if (changed.length === 0) return false;
    await logProjectEvent(db, {
      projectId: input.projectId,
      userId: null,
      type: "stage.advanced",
      payload: { from: input.from, to: input.to },
    });
    return true;
  };
  return tx ? run(tx) : getDb().transaction(run);
}

/**
 * The one way back in the stage machine: a finished film whose shots changed (a script edit sent
 * some back through preparation) is in production again. Compare-and-set `done → production`,
 * logged as `stage.reopened` with the reason; false (and nothing logged) when the project is not
 * done, so calling it again is harmless. Pass `tx` to run inside the caller's transaction.
 */
export async function reopenProduction(
  input: { projectId: string; reason: string; userId?: string | null },
  tx?: DbTransaction,
): Promise<boolean> {
  const run = async (db: DbTransaction): Promise<boolean> => {
    const changed = await db
      .update(project)
      .set({ stage: "production" })
      .where(and(eq(project.id, input.projectId), eq(project.stage, "done")))
      .returning({ id: project.id });
    if (changed.length === 0) return false;
    await logProjectEvent(db, {
      projectId: input.projectId,
      userId: input.userId ?? null,
      type: "stage.reopened",
      payload: { from: "done", to: "production", reason: input.reason },
    });
    console.info(`[projects] production reopened for ${input.projectId}: ${input.reason}`);
    return true;
  };
  return tx ? run(tx) : getDb().transaction(run);
}

function validateStyle(style: unknown) {
  const parsed = projectStyleSchema.safeParse(style);
  if (!parsed.success) {
    const path = parsed.error.issues[0]?.path[0];
    const friendly: Record<string, string> = {
      visualStyle: "Choose a visual style.",
      genre: "Choose a genre.",
      format: "Choose movie or series.",
      orientation: "Choose landscape or portrait.",
      totalDurationSeconds: "Enter a valid total duration.",
      episodeDurationSeconds: "Enter a valid episode duration.",
      blockLength: "Choose 15-second or 30-second blocks.",
      references: "Add a film or show name, a reference image or a description.",
    };
    throw new ProjectInputError(
      (typeof path === "string" ? friendly[path] : undefined) ?? "That style is not valid.",
    );
  }
  const s = parsed.data;
  const inRange = (n: number) => n >= MIN_DURATION_SECONDS && n <= MAX_DURATION_SECONDS;
  if (!inRange(s.totalDurationSeconds)) {
    throw new ProjectInputError("The total duration must be between 5 seconds and 4 hours.");
  }
  if (s.format === "movie") {
    if (s.episodeDurationSeconds !== undefined) {
      throw new ProjectInputError("A movie has no episode duration.");
    }
    return s;
  }
  if (s.episodeDurationSeconds === undefined) {
    throw new ProjectInputError("A series needs an episode duration.");
  }
  if (!inRange(s.episodeDurationSeconds)) {
    throw new ProjectInputError("The episode duration must be between 5 seconds and 4 hours.");
  }
  if (s.episodeDurationSeconds > s.totalDurationSeconds) {
    throw new ProjectInputError("An episode cannot be longer than the whole series.");
  }
  if (episodeCount(s.totalDurationSeconds, s.episodeDurationSeconds) > MAX_EPISODES) {
    throw new ProjectInputError(
      `That would be more than ${MAX_EPISODES} episodes. Make the episodes longer.`,
    );
  }
  return s;
}

/**
 * Style fields the Style form does not collect: written by the damis (`mergeDamiStyle`) or by
 * other stages. A save of the form keeps them unless its input sets them.
 */
const CARRIED_STYLE_FIELDS = [
  "lookLine",
  "styleDescriptor",
  "extras",
  "eraSetting",
  "artDirectionNotes",
  "audienceRating",
] as const satisfies readonly (keyof ProjectStyle)[];

function carryStoredFields(answers: ProjectStyle, stored: ProjectStyle | null): ProjectStyle {
  if (!stored) return answers;
  const carried: Partial<ProjectStyle> = {};
  for (const key of CARRIED_STYLE_FIELDS) {
    if (answers[key] === undefined && stored[key] !== undefined) {
      Object.assign(carried, { [key]: stored[key] });
    }
  }
  return { ...answers, ...carried };
}

/**
 * Stores the Style answers (fields the form does not collect, such as the damis' look line and
 * style descriptor, are kept from the stored style unless the input sets them), reconciles episode rows (adds missing, updates targets, never deletes),
 * requests a new Creative Bible when its inputs changed (`refreshCreativeBible`),
 * moves `style → script` when still at `style`, and logs `style.saved` / `style.changed`.
 * Returns null when the project is not the user's.
 */
export async function saveStyle(input: SaveStyleInput): Promise<Project | null> {
  if (!uuidSchema.safeParse(input.projectId).success) return null;
  const answers = applyStyleReferences(validateStyle(input.style));
  return getDb().transaction(async (tx) => {
    const existing = await findOwnedProject(tx, input.projectId, input.userId, { lock: "update" });
    if (!existing) return null;
    const style = carryStoredFields(answers, existing.style);
    await assertReferenceFiles(referenceFileIds(style), {
      userId: input.userId,
      projectId: existing.id,
    });

    const count = episodeCountOf(style);
    const target =
      style.format === "series" && style.episodeDurationSeconds !== undefined
        ? style.episodeDurationSeconds
        : style.totalDurationSeconds;

    const rows = await tx.select().from(episode).where(eq(episode.projectId, existing.id));
    const byNumber = new Map(rows.map((r) => [r.number, r]));
    const missing: { projectId: string; number: number; targetDurationSeconds: number }[] = [];
    for (let n = 1; n <= count; n++) {
      const row = byNumber.get(n);
      if (!row) {
        missing.push({ projectId: existing.id, number: n, targetDurationSeconds: target });
      } else if (row.targetDurationSeconds !== target) {
        await tx
          .update(episode)
          .set({ targetDurationSeconds: target })
          .where(eq(episode.id, row.id));
      }
    }
    if (missing.length > 0) await tx.insert(episode).values(missing);

    const first = existing.style === null;
    const [updated] = await tx
      .update(project)
      .set({ style })
      .where(eq(project.id, existing.id))
      .returning();
    await logProjectEvent(tx, {
      projectId: existing.id,
      userId: input.userId,
      type: first ? "style.saved" : "style.changed",
      // The whole style, so the event log keeps every version of the answers.
      payload: { format: style.format, episodes: count, style },
    });
    // The Creative Bible follows the style: a new version when what it depends on changed.
    await refreshCreativeBible(tx, {
      projectId: existing.id,
      userId: input.userId,
      previous: existing.style,
      style,
    });
    if (existing.stage === "style") {
      await advanceStage({ projectId: existing.id, from: "style", to: "script" }, tx);
    }
    const [fresh] = await tx.select().from(project).where(eq(project.id, existing.id));
    return fresh ?? updated ?? null;
  });
}

/** The project's episodes in order (bounded to MAX_EPISODES + leftovers), or null when not the user's. */
export async function listEpisodes(projectId: string, userId: string): Promise<Episode[] | null> {
  if (!(await findOwnedProject(getDb(), projectId, userId))) return null;
  return getDb()
    .select()
    .from(episode)
    .where(eq(episode.projectId, projectId))
    .orderBy(asc(episode.number))
    .limit(500);
}

/** Style fields a dami fills in on the user's behalf (never the user's own answers). */
export type DamiStylePatch = Partial<Pick<ProjectStyle, "lookLine" | "styleDescriptor">>;

const damiStylePatchSchema = z.strictObject({
  lookLine: projectStyleSchema.shape.lookLine,
  styleDescriptor: projectStyleSchema.shape.styleDescriptor,
}) satisfies z.ZodType<DamiStylePatch>;

/**
 * Worker only: merges dami-written fields into the project's style and logs `style.enriched`
 * with the whole style (the event log keeps every version). Returns false when the project has no
 * style or is gone.
 */
export async function mergeDamiStyle(
  projectId: string,
  patch: DamiStylePatch,
  options: {
    /** Only fill fields the style does not have yet (the first character's descriptor). */
    onlyMissing?: boolean;
  } = {},
): Promise<boolean> {
  if (!uuidSchema.safeParse(projectId).success) return false;
  return getDb().transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(project)
      .where(and(eq(project.id, projectId), notArchived))
      .for("update");
    if (!existing?.style) return false;
    const current = existing.style;
    const given = (Object.keys(patch) as (keyof DamiStylePatch)[]).filter(
      (k) => patch[k] !== undefined,
    );
    const fields = options.onlyMissing ? given.filter((k) => current[k] === undefined) : given;
    if (fields.length === 0) return false;
    // Only the patch is validated: the stored style may predate today's rules (it was valid when
    // saved), and an enrichment must not fail because of answers the dami did not write.
    const parsed = damiStylePatchSchema.safeParse(
      Object.fromEntries(fields.map((k) => [k, patch[k]])),
    );
    if (!parsed.success) {
      throw new ProjectInputError(
        `That style enrichment is not valid (${parsed.error.issues[0]?.path.join(".") ?? "patch"}).`,
      );
    }
    patch = parsed.data;
    const style: ProjectStyle = { ...current, ...patch };
    await tx.update(project).set({ style }).where(eq(project.id, existing.id));
    await logProjectEvent(tx, {
      projectId: existing.id,
      userId: null,
      type: "style.enriched",
      payload: { fields: Object.keys(patch), style },
    });
    return true;
  });
}
