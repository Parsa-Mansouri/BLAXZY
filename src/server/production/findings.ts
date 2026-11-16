/**
 * A clip's Video Review as the review screen shows it (pure): the findings as short plain
 * sentences with the seconds they are about, and the "looks good" points the user may keep. The
 * technical report (causes, routes, frames) stays on the server.
 */
import type { TakeAutoReview } from "@/server/db/schema";
import { videoReviewOutputSchema, type VideoReviewOutput } from "@/server/damis";

/** The report stored on a take, when it is a valid one. */
export function readReport(take: { reviewReport: unknown }): VideoReviewOutput | null {
  if (!take.reviewReport) return null;
  const parsed = videoReviewOutputSchema.safeParse(take.reviewReport);
  return parsed.success ? parsed.data : null;
}

export type ReviewFinding = {
  id: string;
  /** One plain sentence, in the user's language. */
  label: string;
  fromS: number;
  toS: number;
  severity: "blocker" | "major" | "minor";
};

export type KeepPoint = { id: string; label: string; window: string };

export type ReviewFindings = {
  /** `pending` while the clip is being checked; `ready` once the findings are in. */
  state: TakeAutoReview;
  findings: ReviewFinding[];
  keeps: KeepPoint[];
};

/** The most findings and keep points one screen lists. */
export const MAX_SHOWN_FINDINGS = 12;
export const MAX_SHOWN_KEEPS = 8;

const SEVERITY_RANK = { blocker: 0, major: 1, minor: 2 } as const;

export function reviewFindings(
  state: TakeAutoReview,
  report: VideoReviewOutput | null,
): ReviewFindings {
  if (state !== "ready" || !report)
    return { state: state === "ready" ? "failed" : state, findings: [], keeps: [] };
  const findings = [...report.issues]
    .sort(
      (a, b) =>
        SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] ||
        a.from_s - b.from_s ||
        a.issue_id.localeCompare(b.issue_id),
    )
    .slice(0, MAX_SHOWN_FINDINGS)
    .map((i) => ({
      id: i.issue_id,
      label: i.label,
      fromS: i.from_s,
      toS: i.to_s,
      severity: i.severity,
    }));
  const keeps = report.keep_candidates
    .slice(0, MAX_SHOWN_KEEPS)
    .map((k) => ({ id: k.id, label: k.label, window: k.window }));
  return { state: "ready", findings, keeps };
}
