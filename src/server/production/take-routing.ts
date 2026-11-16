/**
 * What rejecting a clip does, decided by the router (`router.ts`, pure) from the Video Review
 * report and what the user confirmed. This file is the database side: it reads the take's report,
 * the block's expected references, what the take was attached with and the earlier attempts of the
 * lineage, builds the router's input, and turns its plan into the one thing that happens next:
 *
 * - `revise`: a block revision is requested with the confirmed issues, the user's notes and the
 *   keep list; the revised block version then gets its draft (`revision-draft.ts`);
 * - `rebind`: a new draft with the same prompt and the references fixed in code;
 * - `reroll`: a new draft with the same prompt and references (a new variant: a new render).
 *
 * Revise wins over rebind over reroll; every route ends in exactly one new draft, so the price
 * the user confirms is always one draft's. Nothing is written here.
 */
import { and, asc, desc, eq, inArray, lt } from "drizzle-orm";
import type { PromptBlock } from "@/server/blocks";
import type { DbExecutor } from "@/server/db/client";
import { blockTake, review, type TakeRoute } from "@/server/db/schema";
import { ProductionInputError } from "./errors";
import { readReport } from "./findings";
import { directedBlockOf, NOT_DIRECTED_MESSAGE } from "./revision";
import { NEEDS_REASON } from "./messages";
import {
  actualBinding,
  correctedReferences,
  expectedBinding,
  loadBoundAssets,
  readyFileOwners,
} from "./review-binding";
import { revisionRequestSchema, type RevisionRequest, type TimedNote } from "./revision-request";
import {
  routeReview,
  type AttemptRecord,
  type AttemptRoute,
  type RouterInput,
  type RoutePlan,
} from "./router";
import type { TakeRow } from "./takes";

/** What the user decided on the review screen. */
export type TakeChoice = {
  /** The findings the user left standing (the others were dismissed). */
  confirmedIssueIds: readonly string[];
  /** The "looks good" points the user wants kept; every one when not given. */
  keepIds?: readonly string[];
  timedNotes: readonly TimedNote[];
  note: string | null;
};

export type TakePlan = {
  route: Extract<TakeRoute, "reroll" | "revise" | "rebind">;
  plan: RoutePlan;
  /** What a block revision is asked to do; stored on the rejecting review. */
  request: RevisionRequest;
  /** The references of the new draft for `rebind`/`reroll`. */
  referenceFileIds: string[];
};

const cut = (text: string, max: number) => (text.length > max ? text.slice(0, max) : text);

/** What earlier rejected drafts of the lineage found (their confirmed artifacts), oldest first. */
async function attemptHistory(db: DbExecutor, take: TakeRow): Promise<AttemptRecord[]> {
  const rows = await db
    .select({ id: blockTake.id, route: blockTake.route })
    .from(blockTake)
    .where(
      and(
        eq(blockTake.lineageId, take.lineageId),
        eq(blockTake.status, "rejected"),
        lt(blockTake.takeNumber, take.takeNumber),
      ),
    )
    .orderBy(desc(blockTake.takeNumber))
    .limit(20);
  const earlier = rows.reverse();
  if (earlier.length === 0) return [];
  const reviews = await db
    .select({ subjectId: review.subjectId, request: review.revisionRequest })
    .from(review)
    .where(
      and(
        eq(review.subjectType, "generation"),
        eq(review.decision, "rejected"),
        inArray(
          review.subjectId,
          earlier.map((t) => t.id),
        ),
      ),
    )
    .orderBy(asc(review.createdAt));
  const artifacts = new Map<string, { kind: string; window: string }[]>();
  for (const r of reviews) {
    artifacts.set(
      r.subjectId,
      (r.request?.observedIssues ?? [])
        .filter((i) => i.cause === "ai_artifact")
        .map((i) => ({ kind: i.kind, window: i.window })),
    );
  }
  return earlier.map((t) => ({
    route: t.route as AttemptRoute,
    artifacts: artifacts.get(t.id) ?? [],
  }));
}

/**
 * The router's plan for rejecting `take` with this choice. Throws a `ProductionInputError` when
 * there is nothing to act on (no note, no timed note, no confirmed finding).
 */
export async function planTakeRoute(
  db: DbExecutor,
  input: { take: TakeRow; block: PromptBlock; choice: TakeChoice },
): Promise<TakePlan> {
  const { take, block, choice } = input;
  const report = readReport(take);
  const issues = report?.issues ?? [];
  const known = new Set(issues.map((i) => i.issue_id));
  const confirmedIds = [...new Set(choice.confirmedIssueIds)].filter((id) => known.has(id));
  const keepWanted = choice.keepIds ? new Set(choice.keepIds) : null;
  const keep = (report?.keep_candidates ?? []).filter((k) => !keepWanted || keepWanted.has(k.id));

  const bound = await loadBoundAssets(block, db);
  const { owners } = await readyFileOwners(block, db);
  const notes = [
    ...(choice.note ? [{ text: choice.note }] : []),
    ...choice.timedNotes.map((n) => ({ text: n.text, fromS: n.fromS, toS: n.toS })),
  ];
  const routerInput: RouterInput = {
    issues,
    identity: report?.identity ?? [],
    keepCandidates: keep,
    confirmedIssueIds: confirmedIds,
    dismissedIssueIds: issues.map((i) => i.issue_id).filter((id) => !confirmedIds.includes(id)),
    notes,
    referenceBinding: actualBinding(bound, take.referenceFileIds, owners),
    blockAssets: expectedBinding(bound),
    attemptHistory: await attemptHistory(db, take),
    currentAttemptRoute: take.route,
  };
  const plan = routeReview(routerInput);
  if (plan.steps.length === 0) throw new ProductionInputError(NEEDS_REASON);

  const route: TakePlan["route"] = plan.revise
    ? "revise"
    : plan.rebind.length > 0
      ? "rebind"
      : "reroll";
  // Block Revision works from the Director's data: a shot cut before the Director cannot be
  // revised, and the user is told so (a silent reroll would drop what they asked for).
  if (route === "revise" && !directedBlockOf(block)) {
    throw new ProductionInputError(NOT_DIRECTED_MESSAGE);
  }
  const confirmed = issues.filter((i) => confirmedIds.includes(i.issue_id));
  const asked = plan.revise ? plan.revise.issues : confirmed;
  const request = revisionRequestSchema.parse({
    source: "take_review",
    ...(choice.note ? { note: choice.note } : {}),
    timedNotes: choice.timedNotes,
    observedIssues: asked.map((i) => ({
      issue_id: cut(i.issue_id, 40),
      cause: i.cause,
      kind: i.kind,
      severity: i.severity,
      window: cut(i.window, 20),
      planned: cut(i.planned, 2000),
      observed: cut(i.observed, 2000),
      label: cut(i.label, 500),
    })),
    keep: keep.map((k) => ({ window: cut(k.window, 20), what: cut(k.what, 500) })),
    takeId: take.id,
    regenerate: plan.reasons.some((r) => r.code === "artifact_loop"),
  });

  let referenceFileIds = take.referenceFileIds;
  if (route === "rebind") {
    referenceFileIds = correctedReferences(
      bound,
      take.referenceFileIds,
      new Set(plan.rebind.map((f) => f.token)),
      (asset) =>
        new ProductionInputError(
          `“${asset.name}” is not ready in Pre-production any more. Finish it there, then try again.`,
        ),
    );
  }
  return { route, plan, request, referenceFileIds };
}
