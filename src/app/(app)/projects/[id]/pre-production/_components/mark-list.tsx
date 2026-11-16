"use client";

import { useId, type ReactNode } from "react";
import { Plus, X } from "lucide-react";
import { Button, IconButton, cn } from "@/ui";
import { MAX_MARKS, MAX_MARK_TEXT, regionWords } from "../_lib/marks";
import { focusSoon, markFieldId, markPinId, type Marking } from "./mark-layer";

/** The small mono capitals over the list. */
function Caps({ id, children }: { id?: string; children: ReactNode }) {
  return (
    <span id={id} className="font-mono text-meta tracking-caps text-label-2 uppercase">
      {children}
    </span>
  );
}

/** The marks on the picture, one row each: number, where, and what is wrong there. */
export function MarkList({
  marking,
  subject,
  disabled,
}: {
  marking: Marking;
  subject: "image" | "sheet";
  disabled: boolean;
}) {
  const id = useId();
  const { marks } = marking;
  const full = marks.length >= MAX_MARKS;

  function addCentre() {
    const added = marking.add();
    if (added) focusSoon(markPinId(added));
  }

  return (
    <section aria-labelledby={`${id}-title`} className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-3">
        <Caps id={`${id}-title`}>On the {subject}</Caps>
        {marks.length > 0 ? (
          <span className="font-mono text-meta text-label-3 tabular-nums">
            {marks.length}/{MAX_MARKS}
          </span>
        ) : null}
      </div>
      <div className="overflow-hidden rounded-tile border border-outline-quiet bg-ground">
        {marks.length === 0 ? (
          <p className="px-4 pt-3.5 text-secondary text-pretty text-label-2">
            Click or tap the {subject} to pin a spot, then say what is wrong there.
          </p>
        ) : (
          <ol className="divide-y divide-outline-quiet">
            {marks.map((mark, i) => {
              const n = i + 1;
              const where = regionWords(mark.x, mark.y);
              const on = marking.active === mark.id;
              return (
                <li
                  key={mark.id}
                  onPointerEnter={() => marking.setActive(mark.id)}
                  onPointerLeave={() => marking.setActive(null)}
                  className={cn(
                    "flex swap-in items-center gap-3 py-2 pr-1.5 pl-3 transition-colors duration-(--dur-press) motion-reduce:transition-none",
                    on && "bg-brand/10",
                  )}
                >
                  <span
                    aria-hidden="true"
                    className="flex size-6 shrink-0 items-center justify-center rounded-inset bg-brand font-mono text-meta font-semibold text-ground tabular-nums"
                  >
                    {n}
                  </span>
                  <label className="flex min-w-0 flex-1 flex-col">
                    <span className="font-mono text-meta tracking-caps text-label-3 uppercase">
                      {where}
                    </span>
                    <input
                      id={markFieldId(mark.id)}
                      value={mark.text}
                      maxLength={MAX_MARK_TEXT}
                      disabled={disabled}
                      aria-label={`Mark ${n}, ${where}: what is wrong here?`}
                      placeholder="What is wrong here?"
                      onFocus={() => marking.setActive(mark.id)}
                      onChange={(e) => marking.setText(mark.id, e.target.value)}
                      className="min-w-0 bg-transparent py-0.5 text-body text-label outline-none placeholder:text-label-3 disabled:text-label-3"
                    />
                  </label>
                  <IconButton
                    label={`Remove mark ${n}`}
                    icon={<X />}
                    size="small"
                    tooltip={false}
                    disabled={disabled}
                    onClick={() => marking.remove(mark.id)}
                  />
                </li>
              );
            })}
          </ol>
        )}
        <div
          className={cn(
            "px-2 pb-2",
            marks.length > 0 ? "border-t border-outline-quiet pt-2" : "pt-1.5",
          )}
        >
          <Button
            variant="plain"
            size="small"
            leadingIcon={<Plus />}
            disabled={disabled || full}
            onClick={addCentre}
          >
            {full ? `Up to ${MAX_MARKS} marks` : "Add a Mark"}
          </Button>
        </div>
      </div>
    </section>
  );
}
