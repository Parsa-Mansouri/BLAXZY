"use client";

import { cn, stagger } from "@/ui";

/** The key that picks each offered answer, and the letter on its card. */
export const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

/** The large display question of the guided flow and the designer's questions. */
export const QUESTION_TITLE =
  "text-display text-balance break-words @5xl:text-[3.75rem] @5xl:leading-[1.04] @5xl:tracking-[-0.03em]";

/**
 * A question's offered answers as lettered cards in a two-column grid (one is picked; picking it
 * again takes it back). The letter keys are wired by the caller (see `aria-keyshortcuts`).
 */
export function AnswerTiles({
  labelledBy,
  options,
  selected,
  disabled,
  onPick,
}: {
  labelledBy: string;
  options: readonly { value: string; label: string }[];
  /** The picked value; null when none (or the answer is in the user's own words). */
  selected: string | null;
  disabled: boolean;
  onPick: (value: string) => void;
}) {
  return (
    <div
      role="group"
      aria-labelledby={labelledBy}
      className="grid grid-cols-1 gap-3 @xl:grid-cols-2"
    >
      {options.map((option, i) => {
        const on = selected === option.value;
        const letter = LETTERS[i];
        return (
          <button
            key={option.value}
            type="button"
            data-option
            aria-pressed={on}
            aria-keyshortcuts={letter}
            disabled={disabled}
            onClick={() => onPick(option.value)}
            className={cn(
              "flex min-h-20 press enter flex-col justify-between gap-4 rounded-inset border p-4 text-left focus-ring @xl:min-h-28",
              on
                ? "border-brand bg-brand/12"
                : "border-separator-opaque bg-elevated hover:bg-elevated-2",
            )}
            style={stagger(i, 40)}
          >
            {letter ? (
              <span
                aria-hidden="true"
                className={cn("font-script text-meta", on ? "text-brand" : "text-label-3")}
              >
                {letter}
              </span>
            ) : null}
            <span className="text-control-lg text-pretty text-label">{option.label}</span>
          </button>
        );
      })}
    </div>
  );
}
