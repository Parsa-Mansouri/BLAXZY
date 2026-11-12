"use client";

import { useState, type CSSProperties } from "react";
import { cn } from "@/ui";

export interface DossierRow {
  id: string;
  /** The field's name ("Face"), set in capitals. */
  label: string;
  /** The answer as the sheet shows it; null while unanswered. */
  value: string | null;
}

/** How long the newest answer takes to type in, at most, whatever its length. */
const TYPE_MS = 360;
/** The longest pause between two typed characters. */
const CHAR_MS = 22;

/**
 * The answer typing into its row, one character after another. Each character holds hidden until
 * its turn and then appears (a 1ms step of the kit's `page-in`); reduced motion shows the text at
 * once. Keyed by the text by the caller, so a new answer types again.
 */
function TypedText({ text }: { text: string }) {
  const chars = Array.from(text);
  const step = Math.min(CHAR_MS, TYPE_MS / Math.max(chars.length, 1));
  return (
    <>
      {chars.map((char, i) => (
        <span
          key={i}
          style={
            {
              animation: `page-in 1ms steps(1, end) ${Math.round(i * step)}ms both`,
            } satisfies CSSProperties
          }
        >
          {char}
        </span>
      ))}
    </>
  );
}

/** The block cursor on the row being filled in; it stands still under reduced motion. */
function Cursor() {
  return (
    <span
      aria-hidden="true"
      className="ml-0.5 inline-block h-[1.1em] w-[0.6em] translate-y-[0.2em] [animation:demo-type-blink_1.06s_steps(1,end)_infinite] bg-ink motion-reduce:[animation:none]"
    />
  );
}

/**
 * The casting sheet beside the questions: the asset's name, the script's description and one ruled
 * field per question, in the screenplay's typewriter on paper. Answered fields show the answer, the
 * current one carries a brand rule and the cursor, and any field opens its question again. Below
 * the two-column width it folds to the current field, with the rest a press away.
 */
export function CastingDossier({
  name,
  description,
  rows,
  step,
  typedId,
  disabled,
  onJump,
  className,
}: {
  name: string;
  description: string | null;
  rows: DossierRow[];
  step: number;
  /** The field whose answer was just picked: it types in. */
  typedId: string | null;
  disabled: boolean;
  onJump: (index: number) => void;
  className?: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const total = rows.length;
  const answered = rows.filter((r) => r.value !== null).length;
  const complete = total > 0 && answered === total;
  const stamp = complete ? "Ready" : "In casting";

  return (
    <aside
      aria-label={`Casting sheet for ${name}`}
      className={cn(
        "relative flex w-full max-w-160 flex-col gap-5 rounded-paper px-[clamp(20px,4vw,40px)] pt-7 pb-8 font-script text-script paper @5xl:pb-24",
        className,
      )}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
        <p className="min-w-0 text-heading-sm font-bold break-words uppercase">{name}</p>
        <p className="shrink-0 text-meta tracking-[0.12em] uppercase tabular-nums">
          <span aria-hidden="true">Casting · No. {Math.min(step + 1, total)}</span>
          <span className="sr-only">Question {Math.min(step + 1, total)}</span>
        </p>
      </div>
      {description ? (
        <p className="line-clamp-2 max-w-[60ch] text-meta text-pretty text-ink/70 @5xl:line-clamp-4">
          “{description}”
        </p>
      ) : null}

      <ol className="flex flex-col">
        {rows.map((row, i) => {
          const current = i === step;
          const words = row.value ?? "not answered yet";
          return (
            <li key={row.id} className={cn(!expanded && !current && "@max-5xl:hidden")}>
              <button
                type="button"
                aria-current={current ? "step" : undefined}
                aria-label={`${row.label}: ${words}${current ? "" : " — edit"}`}
                disabled={disabled}
                onClick={() => (current ? undefined : onJump(i))}
                className={cn(
                  "grid w-full grid-cols-[minmax(6rem,9rem)_minmax(0,1fr)] items-baseline gap-x-4 py-2.5 text-left focus-ring transition-colors duration-(--dur-press) ease-out",
                  current
                    ? "border-b-2 border-brand font-bold"
                    : "border-b border-ink/25 hover:bg-ink/5",
                )}
              >
                <span
                  className={cn(
                    "text-meta tracking-caps uppercase",
                    current || row.value !== null ? "text-ink" : "text-ink/70",
                  )}
                >
                  {row.label}
                </span>
                <span className="min-h-6 min-w-0 break-words">
                  <span className="line-clamp-3">
                    {row.value === null ? null : row.id === typedId ? (
                      <TypedText key={row.value} text={row.value} />
                    ) : (
                      row.value
                    )}
                    {current ? <Cursor /> : null}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ol>

      {total > 1 ? (
        <button
          type="button"
          aria-expanded={expanded}
          onClick={() => setExpanded((open) => !open)}
          className="self-start rounded-mark text-meta underline underline-offset-4 focus-ring @5xl:hidden"
        >
          {expanded ? "Show the current field only" : "Show every field"}
        </button>
      ) : null}

      {/* A rubber stamp on the sheet: decoration, the counter above says the same. */}
      <span
        key={stamp}
        aria-hidden="true"
        className="pointer-events-none absolute right-7 bottom-7 hidden -rotate-6 settle rounded-mark border-2 border-red px-3 py-1 text-meta font-bold tracking-[0.2em] text-red uppercase opacity-85 @5xl:block"
      >
        {stamp}
      </span>
    </aside>
  );
}
