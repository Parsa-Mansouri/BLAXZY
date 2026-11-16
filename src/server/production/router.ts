/**
 * The router of the video review (the owner's <router>): code, not a dami, and pure (no database,
 * no Claude). It takes the review report after the user has confirmed, dismissed or added issues
 * and returns an ordered plan: what to fix in the binding, what to send to the block revision, and
 * whether to regenerate with the same prompt (a reroll). `take-routing.ts` builds its input from the
 * database and carries the plan out when a clip is rejected.
 *
 * Rules, in the owner's order:
 * 1. rebind: a confirmed binding_suspect issue whose asset's binding is wrong (token missing, wrong
 *    asset, wrong sheet, compared with the block's assets) is fixed in code. When the binding is
 *    right the model confused people anyway: the issue becomes an instruction_miss of kind
 *    "identity" and goes to revise.
 * 2. reroll: a confirmed ai_artifact issue, only when nothing needs revise. The same artifact kind
 *    in the same window in 2 rerolls in a row goes to revise (the prompt provokes it).
 * 3. revise: everything else, in one block-revision call with the report's keep list.
 * 4. Mixed: rebind, then revise, then reroll (a reroll only when nothing needs revise).
 *
 * Deliberately NOT here: the owner's cap of 6 generations per block, after which the block is
 * "needs attention". The product decision (docs/damis/TRACKER.md) is that generations are
 * unlimited: every paid generation needs the user's credit confirmation, so the user, not a
 * counter, is the limit. The attempt history is read only for the reroll-loop rule.
 *
 * Only issues the user confirmed are routed: dismissed ones are dropped, and so are issues the
 * user has not decided on (the review screen asks about each one before the router runs).
 */
import type { KeepCandidate, ReferenceBindingEntry, ReviewIssue } from "@/server/damis";

/** How a generation attempt came about. */
export type AttemptRoute = "initial" | "reroll" | "revise" | "rebind";

/** What an earlier attempt's review found, for the reroll-loop rule. */
export type AttemptRecord = {
  /** How this attempt was produced. */
  route: AttemptRoute;
  /** The attempt's confirmed ai_artifact issues. */
  artifacts: { kind: string; window: string }[];
};

/** A note the user wrote on the review screen. Free text only: it always goes to revise. */
export type UserNote = {
  text: string;
  /** The seconds the note is about, when the user gave them. */
  fromS?: number;
  toS?: number;
};

export type RouterInput = {
  issues: readonly ReviewIssue[];
  /** The report's identity rows (to find which asset a binding_suspect issue is about). */
  identity?: readonly { character_id: string; window: string; result: string }[];
  keepCandidates?: readonly KeepCandidate[];
  confirmedIssueIds: readonly string[];
  dismissedIssueIds?: readonly string[];
  notes?: readonly UserNote[];
  /** What was attached to the generation. */
  referenceBinding: readonly ReferenceBindingEntry[];
  /** What the block says to attach. */
  blockAssets: readonly ReferenceBindingEntry[];
  /** The attempts before the one under review, oldest first. */
  attemptHistory?: readonly AttemptRecord[];
  /** How the attempt under review was produced. */
  currentAttemptRoute?: AttemptRoute;
};

export type BindingProblem = "missing_token" | "wrong_asset" | "wrong_sheet";

/** One correction of the reference binding, in code. */
export type BindingFix = {
  token: string;
  assetId: string;
  problem: BindingProblem;
  /** What the block says. */
  expected: { assetId: string; sheetId: string };
  /** What was attached (null when the token was missing). */
  actual: { assetId: string; sheetId: string } | null;
  /** The confirmed binding_suspect issues this fix resolves. */
  issueIds: string[];
};

export type RouteReasonCode =
  | "nothing_to_fix"
  | "dismissed"
  | "undecided"
  | "binding_fixed"
  | "binding_correct"
  | "artifact_loop"
  | "artifact_deferred"
  | "artifact_reroll"
  | "revise_issue"
  | "user_note";

export type RouteReason = { code: RouteReasonCode; issueId?: string; text: string };

/** An issue as the revision sees it (the router may have changed its cause). */
export type RoutedIssue = ReviewIssue & {
  /** The cause the dami reported, when the router changed it. */
  originalCause?: ReviewIssue["cause"];
};

export type RoutePlan = {
  /** Fixes to the binding, applied first. */
  rebind: BindingFix[];
  /** One block-revision call, or null when nothing needs revising. */
  revise: { issues: RoutedIssue[]; notes: UserNote[]; keep: KeepCandidate[] } | null;
  /** Regenerate with the same prompt and a new seed. Only when nothing needs revise. */
  reroll: boolean;
  /** Confirmed artifacts that were not rerolled because a revision comes first. */
  deferredArtifacts: ReviewIssue[];
  /** The steps to run, in order (`rebind`, `revise`, `reroll`). */
  steps: ("rebind" | "revise" | "reroll")[];
  /** True when a new generation follows (any step). */
  regenerate: boolean;
  reasons: RouteReason[];
};

const norm = (text: string) => text.replace(/\s+/g, "").toLowerCase();

/** The binding problems of `actual` against the block's `expected` assets, one per token. */
export function bindingProblems(
  expected: readonly ReferenceBindingEntry[],
  actual: readonly ReferenceBindingEntry[],
): Omit<BindingFix, "issueIds">[] {
  const byToken = new Map(actual.map((a) => [a.token, a]));
  const problems: Omit<BindingFix, "issueIds">[] = [];
  for (const want of expected) {
    const have = byToken.get(want.token);
    const exp = { assetId: want.asset_id, sheetId: want.sheet_id };
    if (!have) {
      problems.push({
        token: want.token,
        assetId: want.asset_id,
        problem: "missing_token",
        expected: exp,
        actual: null,
      });
    } else if (have.asset_id !== want.asset_id) {
      problems.push({
        token: want.token,
        assetId: want.asset_id,
        problem: "wrong_asset",
        expected: exp,
        actual: { assetId: have.asset_id, sheetId: have.sheet_id },
      });
    } else if (want.sheet_id !== "" && have.sheet_id !== want.sheet_id) {
      problems.push({
        token: want.token,
        assetId: want.asset_id,
        problem: "wrong_sheet",
        expected: exp,
        actual: { assetId: have.asset_id, sheetId: have.sheet_id },
      });
    }
  }
  return problems;
}

/**
 * The assets a binding_suspect issue is about: the characters the report found wrong (matches
 * another asset or none) in the issue's window. Empty when the report does not say, and the issue
 * is then checked against every binding problem.
 */
function suspectAssets(issue: ReviewIssue, input: RouterInput): Set<string> {
  const rows = (input.identity ?? []).filter(
    (r) => r.result === "matches_other_asset" || r.result === "matches_none",
  );
  const inWindow = rows.filter((r) => issue.window !== "" && norm(r.window) === norm(issue.window));
  return new Set(inWindow.map((r) => r.character_id));
}

/** The same artifact kind in the same window in the last two rerolls (this one and the one before). */
function loopsOnArtifact(issue: ReviewIssue, input: RouterInput): boolean {
  if (input.currentAttemptRoute !== "reroll") return false;
  const previous = input.attemptHistory?.[input.attemptHistory.length - 1];
  if (!previous || previous.route !== "reroll") return false;
  return previous.artifacts.some(
    (a) => a.kind === issue.kind && norm(a.window) === norm(issue.window),
  );
}

/** Builds the plan for one reviewed clip. Pure; the input is not changed. */
export function routeReview(input: RouterInput): RoutePlan {
  const reasons: RouteReason[] = [];
  const confirmed = new Set(input.confirmedIssueIds);
  const dismissed = new Set(input.dismissedIssueIds ?? []);
  const notes = (input.notes ?? []).filter((n) => n.text.trim() !== "");

  const accepted: ReviewIssue[] = [];
  for (const issue of input.issues) {
    if (confirmed.has(issue.issue_id)) accepted.push(issue);
    else if (dismissed.has(issue.issue_id)) {
      reasons.push({ code: "dismissed", issueId: issue.issue_id, text: "Dismissed by the user." });
    } else {
      reasons.push({
        code: "undecided",
        issueId: issue.issue_id,
        text: "The user neither confirmed nor dismissed it; it is not acted on.",
      });
    }
  }

  const problems = bindingProblems(input.blockAssets, input.referenceBinding);
  const fixes = new Map<string, BindingFix>();
  const reviseIssues: RoutedIssue[] = [];
  const artifacts: ReviewIssue[] = [];

  for (const issue of accepted) {
    if (issue.cause === "binding_suspect") {
      const suspects = suspectAssets(issue, input);
      const relevant = problems.filter((p) => suspects.size === 0 || suspects.has(p.assetId));
      if (relevant.length > 0) {
        for (const p of relevant) {
          const fix = fixes.get(p.token) ?? { ...p, issueIds: [] };
          fix.issueIds.push(issue.issue_id);
          fixes.set(p.token, fix);
        }
        reasons.push({
          code: "binding_fixed",
          issueId: issue.issue_id,
          text: `The reference binding is wrong (${relevant.map((p) => `${p.token}: ${p.problem}`).join(", ")}): fixed in code.`,
        });
      } else {
        reviseIssues.push({
          ...issue,
          cause: "instruction_miss",
          kind: "identity",
          suggested_route: "revise",
          originalCause: "binding_suspect",
        });
        reasons.push({
          code: "binding_correct",
          issueId: issue.issue_id,
          text: "The binding is right, so the model confused people despite it: sent to revise as an identity miss.",
        });
      }
    } else if (issue.cause === "ai_artifact") {
      if (loopsOnArtifact(issue, input)) {
        reviseIssues.push({
          ...issue,
          cause: "instruction_miss",
          suggested_route: "revise",
          originalCause: "ai_artifact",
        });
        reasons.push({
          code: "artifact_loop",
          issueId: issue.issue_id,
          text: `The same ${issue.kind} artifact in ${issue.window || "the same window"} came back in 2 rerolls in a row: the prompt provokes it, sent to revise to simplify.`,
        });
      } else {
        artifacts.push(issue);
      }
    } else {
      reviseIssues.push(issue);
      reasons.push({
        code: "revise_issue",
        issueId: issue.issue_id,
        text: "A missed instruction: sent to revise.",
      });
    }
  }
  if (notes.length > 0) {
    reasons.push({
      code: "user_note",
      text: `${notes.length} free-text note${notes.length === 1 ? "" : "s"} from the user: sent to revise.`,
    });
  }

  const needsRevise = reviseIssues.length > 0 || notes.length > 0;
  const rebind = [...fixes.values()];
  const reroll = !needsRevise && artifacts.length > 0;
  for (const issue of artifacts) {
    reasons.push(
      reroll
        ? {
            code: "artifact_reroll",
            issueId: issue.issue_id,
            text: "A rendering failure: regenerate with the same prompt.",
          }
        : {
            code: "artifact_deferred",
            issueId: issue.issue_id,
            text: "A rendering failure, but a revision is needed first; it is regenerated with the revised prompt.",
          },
    );
  }

  const steps: RoutePlan["steps"] = [];
  if (rebind.length > 0) steps.push("rebind");
  if (needsRevise) steps.push("revise");
  if (reroll) steps.push("reroll");
  if (steps.length === 0 && accepted.length === 0 && notes.length === 0) {
    reasons.push({ code: "nothing_to_fix", text: "Nothing was confirmed and there are no notes." });
  }

  return {
    rebind,
    revise: needsRevise
      ? { issues: reviseIssues, notes, keep: [...(input.keepCandidates ?? [])] }
      : null,
    reroll,
    deferredArtifacts: needsRevise ? artifacts : [],
    steps,
    regenerate: steps.length > 0,
    reasons,
  };
}

/** What the next block was written from, or what an accepted block ends with. */
export type BlockBoundary = {
  end_staging: unknown;
  in_progress_at_end?: unknown;
};

/** A canonical text of a staging value: keys sorted, strings trimmed, collapsed and lower-cased. */
function canonical(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value.replace(/\s+/g, " ").trim().toLowerCase();
  if (Array.isArray(value)) return value.length === 0 ? "" : `[${value.map(canonical).join("|")}]`;
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .map(([k, v]) => [k, canonical(v)] as const)
      .filter(([, v]) => v !== "")
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return entries.length === 0 ? "" : `{${entries.map(([k, v]) => `${k}:${v}`).join(",")}}`;
  }
  return String(value);
}

/**
 * Whether an accepted block's end differs from what the next block was written from (its
 * `end_staging` or `in_progress_at_end`). Differences in case, spacing and key order do not count;
 * a missing `in_progress_at_end` equals an empty one. Null `writtenFrom` (nothing recorded) is not
 * stale.
 */
export function nextBlockIsStale(
  accepted: BlockBoundary,
  nextBlockWrittenFrom: BlockBoundary | null,
): boolean {
  if (!nextBlockWrittenFrom) return false;
  return (
    canonical(accepted.end_staging) !== canonical(nextBlockWrittenFrom.end_staging) ||
    canonical(accepted.in_progress_at_end) !== canonical(nextBlockWrittenFrom.in_progress_at_end)
  );
}

/**
 * The owner's rule 6 as one decision: mark the next block "stale" and send it to the block revision
 * with the new neighbours when it has already been generated and its source boundary changed. A
 * next block that was never generated is simply written from the new boundary later.
 */
export function shouldMarkNextStale(input: {
  accepted: BlockBoundary;
  nextBlockWrittenFrom: BlockBoundary | null;
  nextBlockGenerated: boolean;
}): boolean {
  return input.nextBlockGenerated && nextBlockIsStale(input.accepted, input.nextBlockWrittenFrom);
}
