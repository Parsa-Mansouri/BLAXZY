/**
 * The stuck-row sweep (part of `dami.sweep`): domain rows that a job moves out of `pending` but
 * whose job is gone. The hole it closes: a worker killed hard (OOM, SIGKILL) during the last
 * attempt of a job never runs the handler's failure path; pg-boss later expires the attempt and,
 * with no retry left, fails the job without calling anyone, so the row would stay pending forever.
 *
 * Safety, for every row:
 * 1. It is in the state its job moves it out of, and not owned by something else (a look or take
 *    with a generation belongs to the generation and its hooks, swept by `generation.sweep`; an
 *    untouched prop look may be waiting for a location on purpose).
 * 2. It is older than `STUCK_ROW_GRACE_MINUTES` (rows whose "pending since" is not recorded, such
 *    as a project's sectioning state, rely on 3 alone).
 * 3. No job that can still move it exists in the queue: none of its job types is queued (also
 *    delayed, such as a Creative Bible wait), waiting for a retry or running with its id in the
 *    payload, and none finished within the grace window (a job that just finished may have sent
 *    its follow-up a moment ago). The check runs again right before the write.
 * 4. The write is the area's own failure path (`failLook`, `failTake`, ...), conditional on the row
 *    still being pending, so a job finishing at the same time wins and the sweep skips the row.
 *
 * The row ends in its normal failed state with the copy a "took too long" failure shows (the same
 * as a last attempt that expired), so the screens offer their usual retry. Append-only data is
 * respected: rows are moved to `failed`, never deleted. Rows are paged by id in batches, bounded per
 * sweep; any number of workers may run it (every write is conditional). Each recovered row raises
 * an alert (aggregated per kind when many).
 */
import { and, asc, eq, gt, inArray, isNull, lt, sql, type SQL } from "drizzle-orm";
import { failLook, failSheet, failSheetView } from "../../src/server/assets";
import { setSectioningState, readSectioningRecord } from "../../src/server/blocks";
import { designerFor } from "../../src/server/damis";
import { getDb } from "../../src/server/db/client";
import {
  assetLook,
  assetSheet,
  assetSheetView,
  asset,
  blockTake,
  creativeBible,
  direction,
  exportBundle,
  project,
  promptBlock,
  scriptVersion,
} from "../../src/server/db/schema";
import { failDirection } from "../../src/server/direction";
import { getEnv } from "../../src/server/env";
import {
  assetLookFix,
  assetLookGenerate,
  assetSheetFix,
  assetSheetGenerate,
  assetSheetPlan,
  blockRevise,
  directionWrite,
  exportBuild,
  jobRefsInFlight,
  productionPrepare,
  projectCreativeDna,
  scriptCheck,
  scriptDetectAssets,
  scriptDirect,
  scriptEnhance,
  scriptRevise,
  scriptWrite,
  scriptWriteSegment,
  takeGenerate,
  takeReview,
  type JobDefinition,
} from "../../src/server/jobs";
import { productionDispatch } from "../../src/server/jobs/definitions";
import { errorMessage, logLine } from "../../src/server/jobs/log";
import { failExport, failPreparation, failTake, failTakeReview } from "../../src/server/production";
import { failCreativeBible } from "../../src/server/projects";
import { failScriptVersion } from "../../src/server/script";
import { TOOK_TOO_LONG } from "./failure";
import { EXPORT_FAILED } from "./production-export";
import { keepUserIdea } from "./script-enhance";

const BATCH_SIZE = 100;
/** Upper bound of batches per kind and sweep; the next sweep continues. */
const MAX_BATCHES = 10;
/** Above this many rows of one kind in one sweep, one aggregated alert is raised for the kind. */
const ALERT_EACH_UP_TO = 5;

/** A job that may still move a row: one of `jobs` with `value` in its payload's `field`. */
type Ref = { jobs: readonly JobDefinition[]; field: string; value: string };

type Row = { id: string; projectId: string };

type Page<T extends Row> = {
  /** Rows to consider (already filtered), in id order. */
  rows: T[];
  /** The last id read (the next page starts after it), or null when nothing was read. */
  lastId: string | null;
  /** True when fewer rows than asked for were read: the kind is done for this sweep. */
  done: boolean;
};

type Kind<T extends Row> = {
  name: string;
  page: (input: PageInput) => Promise<Page<T>>;
  refs: (row: T) => Ref[];
  /** The area's own failure path; true when this call changed the row. */
  recover: (row: T) => Promise<boolean>;
};

type PageInput = {
  after: string | null;
  cutoff: Date;
  limit: number;
  /** Only these projects' rows (tests). */
  projectIds: readonly string[] | undefined;
};

export type RecoveredRow = { kind: string; id: string; projectId: string };

type SweepContext = {
  finishedSince: Date;
  cutoff: Date;
  projectIds: readonly string[] | undefined;
};

/** Pages a query by id: `rows` are the read rows narrowed by `keep`. */
function pageOf<T extends Row>(read: T[], limit: number, keep: (row: T) => boolean = () => true) {
  return {
    rows: read.filter(keep),
    lastId: read.at(-1)?.id ?? null,
    done: read.length < limit,
  };
}

/** `id > after` and the test scope, for a table's id and project id columns. */
function scope(
  input: PageInput,
  id: Parameters<typeof gt>[0],
  projectId: Parameters<typeof inArray>[0],
): SQL | undefined {
  return and(
    input.after ? gt(id, input.after) : undefined,
    input.projectIds ? inArray(projectId, [...input.projectIds]) : undefined,
  );
}

const SCRIPT_JOBS = [scriptWrite, scriptWriteSegment, scriptEnhance, scriptCheck, scriptRevise];

const scriptVersions: Kind<Row & { source: string; brief: string | null }> = {
  name: "script_version",
  page: async (input) => {
    const read = await getDb()
      .select({
        id: scriptVersion.id,
        projectId: scriptVersion.projectId,
        source: scriptVersion.source,
        brief: scriptVersion.brief,
      })
      .from(scriptVersion)
      .where(
        and(
          eq(scriptVersion.status, "pending"),
          lt(scriptVersion.createdAt, input.cutoff),
          scope(input, scriptVersion.id, scriptVersion.projectId),
        ),
      )
      .orderBy(asc(scriptVersion.id))
      .limit(input.limit);
    return pageOf(read, input.limit);
  },
  refs: (row) => [{ jobs: SCRIPT_JOBS, field: "scriptVersionId", value: row.id }],
  // An enhanced version keeps the user's own words when the Enhancer gives up (as its job does).
  recover: (row) =>
    row.source === "enhanced" && row.brief?.trim()
      ? keepUserIdea(row.id, row.brief, null)
      : failScriptVersion(row.id, TOOK_TOO_LONG),
};

const creativeBibles: Kind<Row> = {
  name: "creative_bible",
  page: async (input) => {
    const read = await getDb()
      .select({ id: creativeBible.id, projectId: creativeBible.projectId })
      .from(creativeBible)
      .where(
        and(
          eq(creativeBible.status, "pending"),
          lt(creativeBible.createdAt, input.cutoff),
          scope(input, creativeBible.id, creativeBible.projectId),
        ),
      )
      .orderBy(asc(creativeBible.id))
      .limit(input.limit);
    return pageOf(read, input.limit);
  },
  refs: (row) => [{ jobs: [projectCreativeDna], field: "bibleId", value: row.id }],
  recover: (row) => failCreativeBible({ bibleId: row.id, failure: TOOK_TOO_LONG, damiRunId: null }),
};

/** A Director run in flight (`pending`, `planned`, `writing`); failing it fails its sectioning. */
const directions: Kind<Row & { scriptVersionId: string }> = {
  name: "direction",
  page: async (input) => {
    const read = await getDb()
      .select({
        id: direction.id,
        projectId: direction.projectId,
        scriptVersionId: direction.scriptVersionId,
      })
      .from(direction)
      .where(
        and(
          inArray(direction.status, ["pending", "planned", "writing"]),
          lt(direction.createdAt, input.cutoff),
          scope(input, direction.id, direction.projectId),
        ),
      )
      .orderBy(asc(direction.id))
      .limit(input.limit);
    return pageOf(read, input.limit);
  },
  refs: (row) => [
    { jobs: [scriptDirect], field: "scriptVersionId", value: row.scriptVersionId },
    { jobs: [directionWrite], field: "directionId", value: row.id },
  ],
  recover: async (row) => {
    const { failed } = await failDirection(row.id, TOOK_TOO_LONG);
    if (failed) {
      await setSectioningState({
        projectId: row.projectId,
        state: "failed",
        scriptVersionId: row.scriptVersionId,
        failure: TOOK_TOO_LONG,
        onlyFor: row.scriptVersionId,
      });
    }
    return failed;
  },
};

/** A project whose sectioning (asset detection, then the Director) says `running`. */
const sectionings: Kind<Row & { scriptVersionId: string; directionIds: string[] }> = {
  name: "sectioning",
  page: async (input) => {
    const db = getDb();
    const read = await db
      .select({ id: project.id, stageState: project.stageState })
      .from(project)
      .where(
        and(
          sql`(${project.stageState}->'sectioning'->>'state') = 'running'`,
          scope(input, project.id, project.id),
        ),
      )
      .orderBy(asc(project.id))
      .limit(input.limit);
    const rows: (Row & { scriptVersionId: string; directionIds: string[] })[] = [];
    for (const r of read) {
      const record = readSectioningRecord(r.stageState);
      if (record?.state !== "running" || !record.scriptVersionId) continue;
      const open = await db
        .select({ id: direction.id })
        .from(direction)
        .where(
          and(
            eq(direction.scriptVersionId, record.scriptVersionId),
            inArray(direction.status, ["pending", "planned", "writing"]),
          ),
        );
      rows.push({
        id: r.id,
        projectId: r.id,
        scriptVersionId: record.scriptVersionId,
        directionIds: open.map((d) => d.id),
      });
    }
    return { rows, lastId: read.at(-1)?.id ?? null, done: read.length < input.limit };
  },
  refs: (row) => [
    {
      jobs: [scriptDetectAssets, scriptDirect],
      field: "scriptVersionId",
      value: row.scriptVersionId,
    },
    ...row.directionIds.map((id) => ({ jobs: [directionWrite], field: "directionId", value: id })),
  ],
  recover: (row) =>
    setSectioningState({
      projectId: row.id,
      state: "failed",
      scriptVersionId: row.scriptVersionId,
      failure: TOOK_TOO_LONG,
      onlyFor: row.scriptVersionId,
      onlyIfRunning: true,
    }),
};

type LookCandidate = Row & {
  prompt: string | null;
  damiRunId: string | null;
  parentId: string | null;
  kind: Parameters<typeof designerFor>[0];
};

/**
 * A prop's first look that no job has touched may be waiting for a location of its project on
 * purpose (`wakeWaitingLooks`); the asset screen offers to start it without waiting, so it is left.
 */
const mayBeWaiting = (l: LookCandidate) =>
  l.prompt === null &&
  l.damiRunId === null &&
  l.parentId === null &&
  designerFor(l.kind) === "prop";

const looks: Kind<LookCandidate> = {
  name: "asset_look",
  page: async (input) => {
    const read = await getDb()
      .select({
        id: assetLook.id,
        projectId: assetLook.projectId,
        prompt: assetLook.prompt,
        damiRunId: assetLook.damiRunId,
        parentId: assetLook.parentId,
        kind: asset.kind,
      })
      .from(assetLook)
      .innerJoin(asset, eq(asset.id, assetLook.assetId))
      .where(
        and(
          eq(assetLook.status, "pending"),
          isNull(assetLook.generationId),
          lt(assetLook.createdAt, input.cutoff),
          scope(input, assetLook.id, assetLook.projectId),
        ),
      )
      .orderBy(asc(assetLook.id))
      .limit(input.limit);
    return pageOf(read, input.limit, (l) => !mayBeWaiting(l));
  },
  refs: (row) => [{ jobs: [assetLookGenerate, assetLookFix], field: "lookId", value: row.id }],
  recover: (row) => failLook(row.id, TOOK_TOO_LONG),
};

const sheets: Kind<Row> = {
  name: "asset_sheet",
  page: async (input) => {
    const read = await getDb()
      .select({ id: assetSheet.id, projectId: assetSheet.projectId })
      .from(assetSheet)
      .where(
        and(
          eq(assetSheet.status, "pending"),
          isNull(assetSheet.generationId),
          lt(assetSheet.createdAt, input.cutoff),
          scope(input, assetSheet.id, assetSheet.projectId),
        ),
      )
      .orderBy(asc(assetSheet.id))
      .limit(input.limit);
    return pageOf(read, input.limit);
  },
  refs: (row) => [
    {
      jobs: [assetSheetGenerate, assetSheetFix, assetSheetPlan],
      field: "sheetId",
      value: row.id,
    },
  ],
  recover: (row) => failSheet(row.id, TOOK_TOO_LONG),
};

/** A view a fix round is re-writing (planned, its prompt cleared). */
const sheetViews: Kind<Row> = {
  name: "asset_sheet_view",
  page: async (input) => {
    const read = await getDb()
      .select({ id: assetSheetView.id, projectId: assetSheetView.projectId })
      .from(assetSheetView)
      .where(
        and(
          eq(assetSheetView.status, "planned"),
          isNull(assetSheetView.prompt),
          lt(assetSheetView.createdAt, input.cutoff),
          scope(input, assetSheetView.id, assetSheetView.projectId),
        ),
      )
      .orderBy(asc(assetSheetView.id))
      .limit(input.limit);
    return pageOf(read, input.limit);
  },
  refs: (row) => [{ jobs: [assetSheetPlan], field: "viewRowId", value: row.id }],
  recover: (row) => failSheetView(row.id, TOOK_TOO_LONG),
};

/** A current block waiting for its preparation (or revision); stale ones are being replaced. */
const blocks: Kind<Row> = {
  name: "prompt_block",
  page: async (input) => {
    const read = await getDb()
      .select({ id: promptBlock.id, projectId: promptBlock.projectId })
      .from(promptBlock)
      .where(
        and(
          eq(promptBlock.productionState, "pending"),
          isNull(promptBlock.supersededAt),
          eq(promptBlock.stale, false),
          lt(promptBlock.createdAt, input.cutoff),
          scope(input, promptBlock.id, promptBlock.projectId),
        ),
      )
      .orderBy(asc(promptBlock.id))
      .limit(input.limit);
    return pageOf(read, input.limit);
  },
  refs: (row) => [
    { jobs: [productionPrepare, blockRevise], field: "blockId", value: row.id },
    { jobs: [productionDispatch], field: "projectId", value: row.projectId },
  ],
  recover: (row) => failPreparation(row.id, TOOK_TOO_LONG),
};

const takes: Kind<Row> = {
  name: "block_take",
  page: async (input) => {
    const read = await getDb()
      .select({ id: blockTake.id, projectId: blockTake.projectId })
      .from(blockTake)
      .where(
        and(
          eq(blockTake.status, "pending"),
          isNull(blockTake.generationId),
          lt(blockTake.createdAt, input.cutoff),
          scope(input, blockTake.id, blockTake.projectId),
        ),
      )
      .orderBy(asc(blockTake.id))
      .limit(input.limit);
    return pageOf(read, input.limit);
  },
  refs: (row) => [
    { jobs: [takeGenerate], field: "takeId", value: row.id },
    { jobs: [productionDispatch], field: "projectId", value: row.projectId },
  ],
  recover: (row) => failTake(row.id, TOOK_TOO_LONG),
};

/** A take's Video Review that never finished: marked failed (the user reviews the clip unaided). */
const takeReviews: Kind<Row> = {
  name: "take_review",
  page: async (input) => {
    const read = await getDb()
      .select({ id: blockTake.id, projectId: blockTake.projectId })
      .from(blockTake)
      .where(
        and(
          eq(blockTake.autoReview, "pending"),
          lt(blockTake.createdAt, input.cutoff),
          scope(input, blockTake.id, blockTake.projectId),
        ),
      )
      .orderBy(asc(blockTake.id))
      .limit(input.limit);
    return pageOf(read, input.limit);
  },
  refs: (row) => [{ jobs: [takeReview], field: "takeId", value: row.id }],
  recover: (row) => failTakeReview(row.id),
};

const exportBundles: Kind<Row> = {
  name: "export_bundle",
  page: async (input) => {
    const read = await getDb()
      .select({ id: exportBundle.id, projectId: exportBundle.projectId })
      .from(exportBundle)
      .where(
        and(
          eq(exportBundle.status, "pending"),
          lt(exportBundle.createdAt, input.cutoff),
          scope(input, exportBundle.id, exportBundle.projectId),
        ),
      )
      .orderBy(asc(exportBundle.id))
      .limit(input.limit);
    return pageOf(read, input.limit);
  },
  refs: (row) => [{ jobs: [exportBuild], field: "exportId", value: row.id }],
  recover: (row) => failExport(row.id, EXPORT_FAILED),
};

/** The ids among `rows` that a job may still move (see the module comment, rule 3). */
async function heldByJobs<T extends Row>(
  kind: Kind<T>,
  rows: readonly T[],
  finishedSince: Date,
): Promise<Set<string>> {
  // One query per (job types, field) group.
  const groups = new Map<
    string,
    { jobs: readonly JobDefinition[]; field: string; values: Set<string> }
  >();
  const refsOf = new Map<string, Ref[]>();
  for (const row of rows) {
    const refs = kind.refs(row);
    refsOf.set(row.id, refs);
    for (const ref of refs) {
      const key = `${ref.jobs.map((j) => j.name).join(",")}|${ref.field}`;
      let group = groups.get(key);
      if (!group) {
        group = { jobs: ref.jobs, field: ref.field, values: new Set() };
        groups.set(key, group);
      }
      group.values.add(ref.value);
    }
  }
  const live = new Map<string, Set<string>>();
  for (const [key, group] of groups) {
    live.set(
      key,
      await jobRefsInFlight({
        jobs: group.jobs,
        field: group.field,
        values: [...group.values],
        finishedSince,
      }),
    );
  }
  const held = new Set<string>();
  for (const [id, refs] of refsOf) {
    const anyLive = refs.some((ref) =>
      live.get(`${ref.jobs.map((j) => j.name).join(",")}|${ref.field}`)?.has(ref.value),
    );
    if (anyLive) held.add(id);
  }
  return held;
}

async function sweepKind<T extends Row>(kind: Kind<T>, ctx: SweepContext): Promise<RecoveredRow[]> {
  const recovered: RecoveredRow[] = [];
  let after: string | null = null;
  for (let batch = 0; batch < MAX_BATCHES; batch++) {
    const page: Page<T> = await kind.page({
      after,
      cutoff: ctx.cutoff,
      limit: BATCH_SIZE,
      projectIds: ctx.projectIds,
    });
    if (page.rows.length > 0) {
      const held = await heldByJobs(kind, page.rows, ctx.finishedSince);
      for (const row of page.rows) {
        if (held.has(row.id)) continue;
        // Again right before the write: a job sent since the batch check keeps the row.
        if ((await heldByJobs(kind, [row], ctx.finishedSince)).size > 0) continue;
        if (await kind.recover(row)) {
          recovered.push({ kind: kind.name, id: row.id, projectId: row.projectId });
        }
      }
    }
    if (page.done || page.lastId === null) break;
    after = page.lastId;
  }
  return recovered;
}

/**
 * In order: a Director run is failed before its project's sectioning is looked at (failing the
 * run fails the sectioning with it).
 */
const sweeper = <T extends Row>(kind: Kind<T>) => ({
  name: kind.name,
  sweep: (ctx: SweepContext) => sweepKind(kind, ctx),
});

const KINDS = [
  sweeper(scriptVersions),
  sweeper(creativeBibles),
  sweeper(directions),
  sweeper(sectionings),
  sweeper(looks),
  sweeper(sheets),
  sweeper(sheetViews),
  sweeper(blocks),
  sweeper(takes),
  sweeper(takeReviews),
  sweeper(exportBundles),
];

export const STUCK_ROW_KINDS: readonly string[] = KINDS.map((k) => k.name);

/** Raises the alert: one per row, or one per kind when a sweep recovered many of that kind. */
function alertRecovered(rows: readonly RecoveredRow[], graceMinutes: number): void {
  const byKind = new Map<string, RecoveredRow[]>();
  for (const row of rows) byKind.set(row.kind, [...(byKind.get(row.kind) ?? []), row]);
  for (const [kind, list] of byKind) {
    if (list.length <= ALERT_EACH_UP_TO) {
      for (const row of list) {
        logLine("error", "stuck row recovered: its job was lost", {
          alert: true,
          kind,
          id: row.id,
          projectId: row.projectId,
          graceMinutes,
        });
      }
    } else {
      logLine("error", "stuck rows recovered: their jobs were lost", {
        alert: true,
        kind,
        count: list.length,
        sample: list.slice(0, 10).map((r) => r.id),
        graceMinutes,
      });
    }
  }
}

/**
 * Moves rows stuck in a pending state whose job is gone to their failed state (see the module
 * comment). Idempotent: a second run finds nothing (the rows are no longer pending).
 */
export async function sweepStuckRows(
  options: {
    /** Default `STUCK_ROW_GRACE_MINUTES`. */
    graceMinutes?: number;
    now?: Date;
    /** Only these projects' rows (tests: other suites share the database). */
    projectIds?: readonly string[];
  } = {},
): Promise<{ recovered: RecoveredRow[] }> {
  const graceMinutes = options.graceMinutes ?? getEnv().STUCK_ROW_GRACE_MINUTES;
  if (!Number.isFinite(graceMinutes) || graceMinutes < 0) {
    throw new Error(`graceMinutes must not be negative, got ${graceMinutes}`);
  }
  const now = (options.now ?? new Date()).getTime();
  const since = new Date(now - graceMinutes * 60_000);
  const ctx: SweepContext = { cutoff: since, finishedSince: since, projectIds: options.projectIds };
  const recovered: RecoveredRow[] = [];
  for (const kind of KINDS) {
    try {
      recovered.push(...(await kind.sweep(ctx)));
    } catch (err) {
      // One kind's failure (a query, a failure path) never stops the others; the next sweep retries.
      logLine("error", "stuck-row sweep failed for a kind", {
        kind: kind.name,
        error: errorMessage(err),
      });
    }
  }
  alertRecovered(recovered, graceMinutes);
  return { recovered };
}
