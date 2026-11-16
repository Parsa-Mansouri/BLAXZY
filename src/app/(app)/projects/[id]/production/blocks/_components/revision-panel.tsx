import type { BlockRevisionNotes } from "@/server/production";
import { Button } from "@/ui";
import { Section } from "./section";

const SUGGESTIONS: Record<string, string> = {
  split_block: "Splitting this shot into two would work better than changing it.",
  start_frame: "Starting this shot from a still frame would hold it steadier.",
  reduce_cast_in_frame: "Fewer people in the frame at once would make this shot more reliable.",
  manual_review: "This change keeps failing in the same place. It needs your own look.",
};

/** The suggestion in plain words, or null when there is none. */
export function suggestionText(value: string): string | null {
  return value === "none" ? null : (SUGGESTIONS[value] ?? null);
}

/**
 * "What changed" after a revision: the change log in plain lines, then what Block Revision could
 * not do or suggests instead (nothing is split or applied behind the user's back), and the next
 * shot's update when this revision moved the ending it opens from.
 */
export function RevisionPanel({
  revision,
  updating,
  onUpdateNext,
}: {
  revision: BlockRevisionNotes;
  updating: boolean;
  onUpdateNext: () => void;
}) {
  const suggestion = suggestionText(revision.structuralSuggestion);
  const notices = [
    ...(revision.splitRequired
      ? ["This shot has more in it than one clip can hold. Consider splitting it."]
      : []),
    ...(suggestion ? [suggestion] : []),
  ];
  return (
    <Section title="What Changed">
      <div className="flex max-w-(--measure) flex-col gap-6">
        <ul className="flex flex-col gap-1.5">
          {revision.changeLog.map((line, i) => (
            <li key={i} className="text-body text-pretty text-label">
              {line}
            </li>
          ))}
        </ul>
        {revision.notApplied.length > 0 ? (
          <div className="flex flex-col gap-1.5 rounded-card bg-elevated p-5">
            <p className="text-body text-label">Not changed</p>
            <ul className="flex flex-col gap-1.5">
              {revision.notApplied.map((line, i) => (
                <li key={i} className="text-secondary text-pretty text-label-2">
                  {line}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {notices.length > 0 ? (
          <ul role="note" className="flex flex-col gap-1.5">
            {notices.map((line, i) => (
              <li key={i} className="text-body text-pretty text-label">
                {line}
              </li>
            ))}
          </ul>
        ) : null}
        {revision.nextNeedsUpdate ? (
          <div className="flex flex-col items-start gap-3 rounded-card bg-elevated p-5">
            <p className="text-body text-pretty text-label">
              This change moved how the shot ends. The next shot still opens from the old ending.
            </p>
            <Button loading={updating} onClick={onUpdateNext}>
              Update the Next Shot
            </Button>
          </div>
        ) : null}
      </div>
    </Section>
  );
}
