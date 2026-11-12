"use client";

import { useState, useTransition, type ReactNode } from "react";
import type { ReviewOption } from "@/server/damis";
import { fileSrc } from "@/lib/file-src";
import { Button, Field, Sheet, Textarea, cn } from "@/ui";
import type { GalleryItem } from "../../_components/gallery-item";
import {
  buildSelections,
  chipsOf,
  reasonLabel,
  reasonsFor,
  RESCAN_CODE,
  targetsWanted,
  textPrompt,
  textRequired,
  toggleTarget,
  type ReviewDraft,
  type ReviewSide,
} from "../../_lib/detection-review";
import { submitDetectionReviewAction } from "../actions";

const SIDES: readonly { side: ReviewSide; title: string; line: string }[] = [
  {
    side: "technical",
    title: "Something’s wrong",
    line: "Missing, doubled, mixed up or in the wrong place.",
  },
  {
    side: "preference",
    title: "I’d like it different",
    line: "Leave something out, or give something its own asset.",
  },
];

function SectionLabel({ children }: { children: ReactNode }) {
  return <h3 className="font-mono text-meta tracking-caps text-label-2 uppercase">{children}</h3>;
}

/** The square tick of the mixing desk's tiles. */
function CheckMark({ on, round = false }: { on: boolean; round?: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "flex size-4 shrink-0 items-center justify-center border transition-colors motion-reduce:transition-none",
        round ? "rounded-full" : "rounded-[3px]",
        on ? "border-brand bg-brand" : "border-outline",
      )}
    >
      {on ? (
        round ? (
          <span className="size-1.5 rounded-full bg-ground" />
        ) : (
          <svg viewBox="0 0 10 10" className="size-2.5 text-ground" fill="none">
            <path d="M2 5.2 4.2 7.4 8 2.8" stroke="currentColor" strokeWidth="1.6" />
          </svg>
        )
      ) : null}
    </span>
  );
}

function SideTile({
  title,
  line,
  on,
  disabled,
  onPick,
}: {
  title: string;
  line: string;
  on: boolean;
  disabled: boolean;
  onPick: () => void;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={on}
      disabled={disabled}
      onClick={onPick}
      className={cn(
        "flex min-h-28 flex-col items-start justify-between gap-3 rounded-item border p-4 text-left focus-ring transition-colors motion-reduce:transition-none",
        on
          ? "border-brand bg-brand/10 text-label"
          : "border-outline-quiet bg-elevated text-label-2 hover:border-outline",
      )}
    >
      <CheckMark on={on} round />
      <span className="flex flex-col gap-1">
        <span className="text-heading-sm text-balance text-label">{title}</span>
        <span className="text-secondary text-pretty text-label-2">{line}</span>
      </span>
    </button>
  );
}

function ReasonTile({
  option,
  on,
  disabled,
  onToggle,
}: {
  option: ReviewOption;
  on: boolean;
  disabled: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={on}
      disabled={disabled}
      onClick={onToggle}
      className={cn(
        "relative flex aspect-square flex-col items-start justify-end rounded-item border p-3 text-left text-body text-pretty focus-ring transition-colors motion-reduce:transition-none",
        on
          ? "border-brand bg-brand/10 text-label"
          : "border-outline-quiet bg-elevated text-label-2 hover:border-outline",
      )}
    >
      <span className="absolute top-2.5 left-2.5">
        <CheckMark on={on} />
      </span>
      {reasonLabel(option)}
    </button>
  );
}

/** One asset of the category as a selectable row (radio for one target, checkbox for several). */
function TargetRow({
  item,
  on,
  single,
  disabled,
  onToggle,
}: {
  item: GalleryItem;
  on: boolean;
  single: boolean;
  disabled: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      role={single ? "radio" : "checkbox"}
      aria-checked={on}
      disabled={disabled}
      onClick={onToggle}
      className={cn(
        "flex min-h-11 w-full min-w-0 items-center gap-3 rounded-row border px-3 py-1.5 text-left text-body focus-ring transition-colors motion-reduce:transition-none",
        on
          ? "border-brand bg-brand/10 text-label"
          : "border-transparent text-label-2 hover:bg-fill-4 hover:text-label",
      )}
    >
      <CheckMark on={on} round={single} />
      {item.thumbnailFileId ? (
        // eslint-disable-next-line @next/next/no-img-element -- user media from object storage
        <img
          src={fileSrc(item.thumbnailFileId)}
          alt=""
          loading="lazy"
          decoding="async"
          className="size-7 shrink-0 rounded-[4px] object-cover object-top"
        />
      ) : null}
      <span className="min-w-0 flex-1 truncate">{item.name}</span>
      {item.priority === "skipped" ? (
        <span className="font-mono text-meta tracking-caps text-label-3 uppercase">Skipped</span>
      ) : null}
    </button>
  );
}

/** What one picked reason still needs: its assets, its category chip, its words. */
function ReasonStrip({
  option,
  draft,
  items,
  disabled,
  highlight,
  onChange,
}: {
  option: ReviewOption;
  draft: ReviewDraft;
  items: GalleryItem[];
  disabled: boolean;
  highlight: boolean;
  onChange: (next: ReviewDraft) => void;
}) {
  const code = option.code;
  const wanted = targetsWanted(option);
  const chips = chipsOf(option);
  const prompt = textPrompt(option);
  const targets = draft.targets[code] ?? [];
  if (wanted === 0 && chips.length === 0 && !prompt) return null;
  const single = wanted === 1;

  return (
    <section
      aria-label={reasonLabel(option)}
      className={cn(
        "flex flex-col gap-4 border-t border-outline-quiet p-4 first:border-t-0 sm:p-5",
        highlight && "bg-red/5",
      )}
    >
      <SectionLabel>{reasonLabel(option)}</SectionLabel>
      {wanted > 0 ? (
        <div className="flex flex-col gap-2">
          <p className="text-secondary text-label-2">
            {single ? "Tap the one it is about." : "Tap the ones that are the same."}
          </p>
          {items.length > 0 ? (
            <div
              role={single ? "radiogroup" : "group"}
              aria-label={`Assets for “${reasonLabel(option)}”`}
              className="grid max-h-56 grid-cols-1 gap-1 overflow-y-auto overscroll-contain sm:grid-cols-2"
            >
              {items.map((item) => (
                <TargetRow
                  key={item.id}
                  item={item}
                  single={single}
                  on={targets.includes(item.id)}
                  disabled={disabled}
                  onToggle={() =>
                    onChange({
                      ...draft,
                      targets: { ...draft.targets, [code]: toggleTarget(targets, item.id, wanted) },
                    })
                  }
                />
              ))}
            </div>
          ) : (
            <p className="text-secondary text-label-3">This category has no assets yet.</p>
          )}
        </div>
      ) : null}
      {chips.length > 0 ? (
        <div className="flex flex-col gap-2">
          <p className="text-secondary text-label-2">Where does it belong?</p>
          <div role="radiogroup" aria-label="Category" className="grid grid-cols-3 gap-2">
            {chips.map((chip) => {
              const on = draft.values[code] === chip.value;
              return (
                <button
                  key={chip.value}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  disabled={disabled}
                  onClick={() =>
                    onChange({ ...draft, values: { ...draft.values, [code]: chip.value } })
                  }
                  className={cn(
                    "flex min-h-16 flex-col items-start justify-between gap-2 rounded-item border p-3 text-left text-body focus-ring transition-colors motion-reduce:transition-none",
                    on
                      ? "border-brand bg-brand/10 text-label"
                      : "border-outline-quiet bg-elevated text-label-2 hover:border-outline",
                  )}
                >
                  <CheckMark on={on} round />
                  {chip.label}
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
      {prompt ? (
        <Field label={prompt} optional={!textRequired(option)}>
          <Textarea
            value={draft.texts[code] ?? ""}
            onChange={(e) =>
              onChange({ ...draft, texts: { ...draft.texts, [code]: e.target.value } })
            }
            disabled={disabled}
            minRows={2}
            maxRows={5}
            maxLength={4000}
          />
        </Field>
      ) : null}
    </section>
  );
}

/**
 * "Something wrong with this list?": first the kind of problem (two large tiles), then its
 * reasons as square checkbox tiles; each picked reason that needs more opens a strip below to tap
 * its assets, pick a category or say what is meant. Re-scanning the whole script is the quiet
 * way out.
 */
export function DetectionReviewSheet({
  open,
  onOpenChange,
  projectId,
  options,
  items,
  seed,
  onSent,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  options: ReviewOption[];
  items: GalleryItem[];
  /** The draft to start from (a reason picked from a card's menu or a warning). */
  seed: ReviewDraft;
  onSent: (result: { skipped: number; started: boolean }) => void;
}) {
  const [draft, setDraft] = useState(seed);
  const firstSide = options.find((o) => o.code === seed.picked[0])?.kind;
  const [side, setSide] = useState<ReviewSide | null>(
    firstSide === "technical" || firstSide === "preference" ? firstSide : null,
  );
  const [error, setError] = useState<{ text: string; code?: string } | null>(null);
  const [sending, startSending] = useTransition();
  const [rescanning, startRescan] = useTransition();
  const busy = sending || rescanning;
  const canRescan = options.some((o) => o.code === RESCAN_CODE);

  function change(next: ReviewDraft) {
    setError(null);
    setDraft(next);
  }

  function toggle(code: string) {
    change({
      ...draft,
      picked: draft.picked.includes(code)
        ? draft.picked.filter((c) => c !== code)
        : [...draft.picked, code],
    });
  }

  function send() {
    const built = buildSelections(draft, options, items);
    if (!built.ok) {
      setError({ text: built.error, code: built.code });
      return;
    }
    setError(null);
    startSending(async () => {
      const result = await submitDetectionReviewAction(projectId, built.selections, built.note);
      if (!result.ok) {
        setError({ text: result.error });
        return;
      }
      onSent(result.data);
    });
  }

  function rescan() {
    setError(null);
    startRescan(async () => {
      const note = draft.note.trim();
      const result = await submitDetectionReviewAction(
        projectId,
        [{ code: RESCAN_CODE }],
        note || undefined,
      );
      if (!result.ok) {
        setError({ text: result.error });
        return;
      }
      onSent(result.data);
    });
  }

  const reasons = side ? reasonsFor(options, side) : [];
  const strips = draft.picked
    .map((code) => options.find((o) => o.code === code))
    .filter((o): o is ReviewOption => o !== undefined)
    .filter((o) => targetsWanted(o) > 0 || chipsOf(o).length > 0 || textPrompt(o) !== null);
  // Picks made on the other side stay picked; say so, so they are not sent by surprise.
  const otherPicks = draft.picked
    .map((code) => options.find((o) => o.code === code))
    .filter((o): o is ReviewOption => o !== undefined && side !== null && o.kind !== side);

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!busy) onOpenChange(next);
      }}
      size="lg"
      title="Something Wrong With This List?"
      description="Say what is off. The list is corrected in the background and comes back here."
      footer={
        <div className="flex w-full flex-wrap items-center gap-3">
          {canRescan ? (
            <Button
              variant="plain"
              className="mr-auto"
              onClick={rescan}
              loading={rescanning}
              disabled={sending}
            >
              Re-scan the Whole Script
            </Button>
          ) : (
            <span className="mr-auto" />
          )}
          <Button variant="plain" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" loading={sending} disabled={rescanning} onClick={send}>
            Send
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-6">
        <section aria-label="Kind of problem" className="flex flex-col gap-2">
          <SectionLabel>Kind of problem</SectionLabel>
          <div role="radiogroup" aria-label="Kind of problem" className="grid gap-2 sm:grid-cols-2">
            {SIDES.map((s) => (
              <SideTile
                key={s.side}
                title={s.title}
                line={s.line}
                on={side === s.side}
                disabled={busy}
                onPick={() => {
                  setError(null);
                  setSide(s.side);
                }}
              />
            ))}
          </div>
        </section>

        {side ? (
          <section key={side} aria-label="What exactly" className="flex swap-in flex-col gap-2">
            <SectionLabel>What exactly</SectionLabel>
            <div role="group" className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {reasons.map((option) => (
                <ReasonTile
                  key={option.code}
                  option={option}
                  on={draft.picked.includes(option.code)}
                  disabled={busy}
                  onToggle={() => toggle(option.code)}
                />
              ))}
            </div>
            {otherPicks.length > 0 ? (
              <p className="text-secondary text-label-2">
                Also sending: {otherPicks.map((o) => reasonLabel(o)).join(", ")}.
              </p>
            ) : null}
          </section>
        ) : null}

        {strips.length > 0 ? (
          <div className="overflow-hidden rounded-tile border border-outline-quiet bg-ground">
            {strips.map((option) => (
              <ReasonStrip
                key={option.code}
                option={option}
                draft={draft}
                items={items}
                disabled={busy}
                highlight={error?.code === option.code}
                onChange={change}
              />
            ))}
          </div>
        ) : null}

        {side || draft.picked.length > 0 ? (
          <Field
            label={
              <span className="font-mono text-meta tracking-caps uppercase">Anything else</span>
            }
            optional
          >
            <Textarea
              value={draft.note}
              onChange={(e) => change({ ...draft, note: e.target.value })}
              disabled={busy}
              placeholder="A note for the correction, in your own words."
              minRows={2}
              maxRows={6}
              maxLength={8000}
            />
          </Field>
        ) : null}

        {error ? (
          <p role="alert" className="swap-in text-secondary text-red">
            {error.text}
          </p>
        ) : null}
      </div>
    </Sheet>
  );
}
