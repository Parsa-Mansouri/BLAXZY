"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { OutlineView } from "@/server/script";
import {
  Button,
  Field,
  OptionRow,
  PageHeader,
  Sheet,
  StatusLine,
  Textarea,
  cn,
  formatDuration,
  stagger,
  useToast,
} from "@/ui";
import { approveOutlineAction, submitReviewAction } from "../actions";
import { SAMPLE_LINE, type VersionView } from "./version-types";

const MAX_NOTE_CHARS = 8000;

/** Act bands on the runtime ribbon, light to dark. */
const ACT_TONES = ["bg-label/80", "bg-label/55", "bg-label/30"] as const;

/**
 * The whole runtime as one ribbon: each sequence a segment as wide as its share of the film,
 * grouped by act. A long piece is read at a glance before a single page is written.
 */
function RuntimeRibbon({ outline }: { outline: OutlineView }) {
  const total = outline.acts.reduce((n, a) => n + a.targetSeconds, 0) || 1;
  return (
    <figure className="flex flex-col gap-3" aria-label="Runtime by act and sequence">
      <div className="flex h-14 w-full gap-1 overflow-hidden rounded-tile">
        {outline.acts.flatMap((act, a) =>
          act.sequences.map((seq) => (
            <div
              key={seq.id}
              title={`${seq.id} · ${formatDuration(seq.targetSeconds)}`}
              className={cn(
                "flex min-w-0 items-end px-2 pb-1.5 font-mono text-meta text-ground",
                ACT_TONES[a % ACT_TONES.length],
              )}
              style={{ flexGrow: seq.targetSeconds, flexBasis: 0 }}
            >
              <span className="truncate">{seq.id}</span>
            </div>
          )),
        )}
      </div>
      <figcaption className="flex w-full gap-1">
        {outline.acts.map((act) => (
          <span
            key={act.act}
            className="min-w-0 truncate font-mono text-meta tracking-caps text-label-2 uppercase"
            style={{ flexGrow: act.targetSeconds, flexBasis: 0 }}
          >
            Act {act.act} · {formatDuration(act.targetSeconds)}
          </span>
        ))}
      </figcaption>
      <span className="sr-only">Total {formatDuration(total)}</span>
    </figure>
  );
}

function NameColumn({ title, names }: { title: string; names: string[] }) {
  if (names.length === 0) return null;
  return (
    <div className="flex min-w-0 flex-[1_1_10rem] flex-col gap-2">
      <h3 className="font-mono text-meta tracking-caps text-label-2 uppercase">{title}</h3>
      <ul className="flex flex-col gap-1">
        {names.map((n) => (
          <li key={n} className="text-body text-label">
            {n}
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * The outline of a long piece, for approval before any scene is written: the runtime ribbon,
 * the locked names, every act's sequences and scenes, and the material the writer proposes to
 * add (each addition is approved on its own).
 */
export function OutlineReview({
  projectId,
  version,
  outline,
  sample,
}: {
  projectId: string;
  version: VersionView;
  outline: OutlineView;
  sample: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const [additions, setAdditions] = useState<number[]>([]);
  const [approving, startApproving] = useTransition();
  const [sending, startSending] = useTransition();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sheetError, setSheetError] = useState<string | null>(null);

  function approve() {
    setError(null);
    startApproving(async () => {
      const result = await approveOutlineAction(projectId, version.id, additions);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      toast.success("Outline approved. Writing the script.");
      router.refresh();
    });
  }

  function requestChanges() {
    const trimmed = note.trim();
    if (!trimmed) {
      setSheetError("Say what the outline should do differently.");
      return;
    }
    if (trimmed.length > MAX_NOTE_CHARS) {
      setSheetError("Keep the note under 8,000 characters.");
      return;
    }
    setSheetError(null);
    startSending(async () => {
      const result = await submitReviewAction(projectId, version.id, {
        decision: "rejected",
        note: trimmed,
      });
      if (!result.ok) {
        setSheetError(result.error);
        return;
      }
      setSheetOpen(false);
      toast.success("The outline is being reworked.");
      router.refresh();
    });
  }

  return (
    <>
      <PageHeader
        title="Script"
        description="A long film is planned before it is written. Read the outline, choose what may be added, then approve it."
        actions={
          <>
            <Button
              variant="outlined"
              size="large"
              onClick={() => setSheetOpen(true)}
              disabled={approving}
            >
              Request Changes
            </Button>
            <Button variant="primary" size="large" onClick={approve} loading={approving}>
              Approve Outline
            </Button>
          </>
        }
      />
      {error ? (
        <p role="alert" className="-mt-4 mb-6 text-secondary text-red">
          {error}
        </p>
      ) : null}
      {sample || version.isSample ? (
        <StatusLine className="mb-6 in-1">{SAMPLE_LINE}</StatusLine>
      ) : null}

      <div className="flex max-w-240 in-2 flex-col gap-14">
        <p className="max-w-(--measure) text-heading text-balance">{outline.logline}</p>

        <RuntimeRibbon outline={outline} />

        <section aria-label="Locked names" className="flex flex-wrap gap-x-10 gap-y-6">
          <NameColumn title="Cast" names={outline.canonicalNames.characters} />
          <NameColumn title="Places" names={outline.canonicalNames.locations} />
          <NameColumn title="Objects" names={outline.canonicalNames.props} />
        </section>

        {outline.warnings.length > 0 ? (
          <ul className="flex flex-col gap-2">
            {outline.warnings.map((w, i) => (
              <li key={i}>
                <StatusLine tone="waiting">{w}</StatusLine>
              </li>
            ))}
          </ul>
        ) : null}

        {outline.proposedAdditions.length > 0 ? (
          <section aria-labelledby="additions" className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <h2 id="additions" className="text-section text-balance">
                The Writer Proposes to Add
              </h2>
              <p className="max-w-(--measure) text-secondary text-pretty text-label-2">
                Your story is short for this length. Tick what may be added; anything left unticked
                stays out.
              </p>
            </div>
            <div className="flex flex-col gap-2">
              {outline.proposedAdditions.map((p, i) => {
                const on = additions.includes(p.index);
                return (
                  <OptionRow
                    key={p.index}
                    selected={on}
                    disabled={approving}
                    className="enter"
                    style={stagger(i)}
                    onSelect={() =>
                      setAdditions((list) =>
                        on ? list.filter((x) => x !== p.index) : [...list, p.index],
                      )
                    }
                  >
                    <span className="flex flex-col gap-1 text-left">
                      <span className="text-body text-label">{p.text}</span>
                      <span className="text-secondary text-label-2">{p.reason}</span>
                    </span>
                  </OptionRow>
                );
              })}
            </div>
          </section>
        ) : null}

        {outline.acts.map((act) => (
          <section key={act.act} aria-labelledby={`act-${act.act}`} className="flex flex-col gap-6">
            <div className="flex items-baseline gap-4 border-b border-outline-quiet pb-3">
              <h2 id={`act-${act.act}`} className="text-section">
                Act {act.act}
              </h2>
              <p className="min-w-0 flex-1 text-body text-pretty text-label-2">{act.purpose}</p>
              <span className="font-mono text-meta text-label-3 tabular-nums">
                {formatDuration(act.targetSeconds)}
              </span>
            </div>
            {act.sequences.map((seq) => (
              <div key={seq.id} className="grid gap-x-8 gap-y-3 sm:grid-cols-[8rem_1fr]">
                <div className="flex flex-col gap-1">
                  <span className="font-mono text-meta tracking-caps text-label uppercase">
                    {seq.id}
                  </span>
                  <span className="font-mono text-meta text-label-3 tabular-nums">
                    {formatDuration(seq.targetSeconds)}
                  </span>
                </div>
                <div className="flex flex-col gap-4">
                  <p className="text-body text-pretty text-label">{seq.summary}</p>
                  <ol className="flex flex-col gap-3">
                    {seq.scenes.map((scene) => (
                      <li key={scene.sceneNumber} className="flex flex-col gap-0.5">
                        <span className="font-script text-secondary text-label">
                          {scene.sceneNumber}. {scene.heading}
                        </span>
                        <span className="text-secondary text-pretty text-label-2">
                          {scene.purpose} {scene.change}
                        </span>
                      </li>
                    ))}
                  </ol>
                </div>
              </div>
            ))}
          </section>
        ))}
      </div>

      <Sheet
        open={sheetOpen}
        onOpenChange={(open) => {
          if (!sending) setSheetOpen(open);
        }}
        size="lg"
        title="Request Changes"
        description="The outline is planned again from your note. Nothing has been written yet."
        footer={
          <div className="flex w-full items-center justify-end gap-3">
            <Button variant="plain" onClick={() => setSheetOpen(false)} disabled={sending}>
              Cancel
            </Button>
            <Button variant="primary" loading={sending} onClick={requestChanges}>
              Request Changes
            </Button>
          </div>
        }
      >
        <div className="flex flex-col gap-4">
          <Field
            label={<span className="font-mono text-meta tracking-caps uppercase">Your note</span>}
          >
            <Textarea
              autoFocus
              value={note}
              onChange={(e) => {
                setNote(e.target.value);
                setSheetError(null);
              }}
              placeholder="What should the outline do differently?"
              minRows={4}
              maxRows={10}
            />
          </Field>
          {sheetError ? (
            <p role="alert" className="swap-in text-secondary text-red">
              {sheetError}
            </p>
          ) : null}
        </div>
      </Sheet>
    </>
  );
}
