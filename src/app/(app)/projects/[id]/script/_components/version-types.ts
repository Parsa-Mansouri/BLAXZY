import type { ScriptVersionSummary, ScriptVersionView } from "@/server/script";

export type VersionView = ScriptVersionView;
export type VersionSummary = ScriptVersionSummary;
export type Finding = NonNullable<VersionView["findings"]>[number];

export const SAMPLE_LINE = "Sample output. Add an API key to write real scripts.";

const STATUS_LABELS: Record<VersionSummary["status"], string> = {
  pending: "In progress",
  in_review: "In review",
  accepted: "Accepted",
  rejected: "Changes requested",
  superseded: "Replaced",
  failed: "Failed",
};

export const statusLabel = (status: VersionSummary["status"]) => STATUS_LABELS[status];
