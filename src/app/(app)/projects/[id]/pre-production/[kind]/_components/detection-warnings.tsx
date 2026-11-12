"use client";

import { Button, StatusLine } from "@/ui";
import type { CategoryWarning, WarningFix } from "../../_lib/detection-review";

/** What each warning tag is about, in a word, before its text. */
const TAG_WORDS: Record<string, string> = {
  MERGE_CHECK: "Maybe the same",
  NO_LOCATION: "No place",
  AMBIGUOUS: "Unclear",
  REAL_PERSON: "Real person",
  APPROVED_CONFLICT: "No longer in the script",
  NOT_IN_SCRIPT: "Not in the script",
  SCRIPT_GAP: "Thin script",
};

/** The detector's notes about this list, each a calm line with its one-tap fix. */
export function DetectionWarnings({
  warnings,
  disabled,
  onFix,
}: {
  warnings: CategoryWarning[];
  disabled: boolean;
  onFix: (fix: WarningFix) => void;
}) {
  if (warnings.length === 0) return null;
  return (
    <ul aria-label="Notes about this list" className="flex flex-col gap-2">
      {warnings.map((w) => {
        const word = TAG_WORDS[w.tag];
        const fix = w.fix;
        return (
          <li
            key={w.key}
            className="flex flex-col gap-3 rounded-tile border border-outline-quiet bg-elevated/40 px-4 py-3 sm:flex-row sm:items-center"
          >
            <StatusLine tone="waiting" srPrefix="Note" className="min-w-0 flex-1">
              {word ? (
                <span className="mr-2 font-mono text-meta tracking-caps text-label-3 uppercase">
                  {word}
                </span>
              ) : null}
              <span className="text-pretty text-label-2">{w.text}</span>
            </StatusLine>
            {fix ? (
              <Button
                variant="outlined"
                size="small"
                disabled={disabled && fix.type !== "add" && fix.type !== "remove"}
                onClick={() => onFix(fix)}
                className="self-start sm:self-auto"
              >
                {fix.label}
              </Button>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
