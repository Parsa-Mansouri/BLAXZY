import { StatusLine, cn } from "@/ui";
import { FindingNote } from "./finding-note";
import type { VersionView, Finding } from "./version-types";

/**
 * The notes that came with a version (titled by where it came from), and any script check that
 * is about the whole script rather than one line.
 */
export function VersionNotes({
  version,
  looseFindings = [],
  className,
}: {
  version: VersionView;
  looseFindings?: Finding[];
  className?: string;
}) {
  if (version.notes.length === 0 && looseFindings.length === 0) return null;
  const title =
    version.source === "revised"
      ? "What Changed"
      : version.source === "uploaded"
        ? "Script Check"
        : version.source === "enhanced"
          ? "Where Your Words Won"
          : "Writer’s Notes";
  return (
    <section
      aria-labelledby="version-notes"
      className={cn("mt-16 flex w-full max-w-205 flex-col gap-4", className)}
    >
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <h2 id="version-notes" className="text-section text-balance">
          {title}
        </h2>
        {version.checkVerdict === "ready" ? (
          <StatusLine tone="done">Ready to film</StatusLine>
        ) : version.checkVerdict === "needs_attention" ? (
          <StatusLine tone="waiting">Needs attention</StatusLine>
        ) : null}
      </div>
      {version.notes.length > 0 ? (
        <ul className="flex flex-col gap-2.5">
          {version.notes.map((note, i) => (
            <li key={i} className="text-body text-pretty text-label-2">
              {note}
            </li>
          ))}
        </ul>
      ) : null}
      {looseFindings.length > 0 ? (
        <ul className="flex flex-col gap-4">
          {looseFindings.map((finding, i) => (
            <li key={i}>
              <FindingNote finding={finding} />
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
