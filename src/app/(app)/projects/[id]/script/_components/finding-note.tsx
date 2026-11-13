import { StatusLine } from "@/ui";
import type { Finding } from "./version-types";

const SEVERITY: Record<Finding["severity"], string> = {
  blocker: "Must fix",
  major: "Important",
  minor: "Minor",
};

/** A script check finding: a status line, what is wrong, and what to do. */
export function FindingNote({ finding }: { finding: Finding }) {
  return (
    <div className="flex flex-col gap-1">
      <StatusLine tone="waiting">Script check · {SEVERITY[finding.severity]}</StatusLine>
      <p className="text-secondary text-pretty text-label">{finding.explanation}</p>
      {finding.suggestion ? (
        <p className="text-secondary text-pretty text-label-2">{finding.suggestion}</p>
      ) : null}
    </div>
  );
}
