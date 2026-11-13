"use client";

import { useState, useTransition, type ReactNode } from "react";
import type { LookView, SheetView } from "@/server/assets";
import { Alert, Button, ProgressBar, SwapFade, cn } from "@/ui";
import {
  isCreditsFailure,
  lookOrigin,
  lookShape,
  type ArtworkShape,
  type HeldImage,
} from "../_lib/asset-view";
import type { DesignerInfo } from "../_lib/designer-view";
import { exactReferences, nextReferences, splitWarnings } from "../_lib/look-review";
import {
  designRouteOption,
  splitSheetWarnings,
  type DetailCell,
  type SheetCatalogInfo,
} from "../_lib/sheet-review";
import {
  retryAction,
  reviewLookAction,
  reviewSheetAction,
  startOverAction,
  startWithoutWaitingAction,
  type LookReviewInput,
  type ReviewInput,
} from "../actions";
import { DrawnTick } from "../../../_components/drawn-tick";
import { MarkLayer, useMarking, type Marking } from "../../../_components/mark-layer";
import { StageHeading, useAssetScreen } from "./asset-context";
import { Caps } from "./desk";
import { LookChangesPanel } from "./look-changes-panel";
import { ReferenceConflictChoice, ReferenceThumbs } from "./reference-conflict";
import { Artwork, MissingImage, PriceLine, type Orientation } from "./shared";
import { SheetChangesPanel, type SheetChangesWords } from "./sheet-changes-panel";
import { EMPTY_SPEC_DRAFT, SpecCard, specChanged, type SpecDraft } from "./spec-card";
import { Amount, ErrorLine, When } from "@/app/(app)/_components/values";
import { canAfford } from "@/app/(app)/_lib/format";

export const SAMPLE_OUTPUT = "Sample output from the test generator.";

/** The picture large on the leading side (`in-2`), what to do with it beside it (`in-3`). */
export function StageLayout({
  frame,
  rail,
  frameClassName,
}: {
  frame: ReactNode;
  rail: ReactNode;
  frameClassName?: string;
}) {
  return (
    <div className="flex flex-wrap items-start gap-x-16 gap-y-10">
      <div className={cn("min-w-0 flex-[3_1_480px] in-2", frameClassName)}>{frame}</div>
      <div className="flex max-w-105 min-w-0 flex-[1_1_340px] in-3 flex-col gap-8">{rail}</div>
    </div>
  );
}

/** "Image 2 · From your answers · 11 Nov, 14:02". */
export function VersionLine({
  label,
  origin,
  date,
}: {
  label: string;
  origin?: string;
  date: Date;
}) {
  return (
    <p className="text-meta text-label-2">
      {label}
      {origin ? ` · ${origin}` : ""} · <When date={date} />
    </p>
  );
}

/** A smaller image in the rail, for comparison. */
export function InsetImage({
  fileId,
  caption,
  alt,
  shape,
}: {
  fileId: string;
  caption: string;
  alt: string;
  shape: ArtworkShape;
}) {
  const tall = shape === "portrait" || shape === "9:16" || shape === "3:4";
  return (
    <figure className="flex flex-col gap-2">
      <Artwork
        fileId={fileId}
        alt={alt}
        shape={shape}
        size="inset"
        className={tall ? "max-w-44" : "max-w-72"}
      />
      <figcaption className="text-meta text-label-2">{caption}</figcaption>
    </figure>
  );
}

/** The shape of a held image: a sheet, or a look in its own ratio. */
function heldShape(held: HeldImage, orientation: Orientation): ArtworkShape {
  return held.kind === "sheet" ? "sheet" : lookShape(held.aspectRatio, orientation);
}

/** "Old Harbour", "Old Harbour and the Lighthouse", "A, B and C". */
function namesList(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/**
 * Generating a look or building a sheet: plain words, indeterminate progress, the last image. A
 * prop that stands in a location still being designed waits for its Hero (so it matches it) and
 * can start without it. With no image to hold, the words stand alone: no empty frame.
 */
export function WaitingStage({
  projectId,
  assetId,
  assetName,
  kind,
  held,
  orientation,
  waitingFor = [],
  references = [],
  designer = null,
  pack = false,
}: {
  projectId: string;
  assetId: string;
  assetName: string;
  kind: "look" | "sheet";
  held: HeldImage | null;
  orientation: Orientation;
  /** Locations whose Heroes the prop waits for (by name). */
  waitingFor?: string[];
  /** The photos the design starts from. */
  references?: LookView["references"];
  designer?: DesignerInfo | null;
  /** A location pack or prop sheet being planned (its views follow one by one). */
  pack?: boolean;
}) {
  const { moveOn } = useAssetScreen();
  const [starting, startStarting] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const waiting = kind === "look" && waitingFor.length > 0;
  const title = waiting
    ? `${assetName} Waits for ${namesList(waitingFor)}`
    : kind === "look"
      ? `Creating ${assetName}’s Image`
      : pack
        ? `Planning ${assetName}’s Views`
        : `Building ${assetName}’s Reference Sheet`;
  const heldCaption = held
    ? held.kind === "sheet"
      ? `Sheet ${held.versionNumber}, shown while the new sheet is built.`
      : kind === "sheet"
        ? pack
          ? "The approved Hero every view is planned from."
          : "The accepted image the sheet is built from."
        : `Image ${held.versionNumber}, shown while the new image is made.`
    : null;

  function startNow() {
    setError(null);
    startStarting(async () => {
      const result = await startWithoutWaitingAction(projectId, assetId);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      moveOn(result.data, `Creating ${assetName}’s image`);
    });
  }

  const words = (
    <div className="flex flex-col gap-4">
      <StageHeading className="text-heading-sm text-balance break-words">{title}</StageHeading>
      {waiting ? (
        <>
          <p className="max-w-(--measure) text-body text-pretty text-label-2">
            {assetName} appears in {namesList(waitingFor)}. Its design starts once{" "}
            {waitingFor.length === 1
              ? "that place’s Hero image is"
              : "those places’ Hero images are"}{" "}
            accepted, so it matches them. Nothing is charged while it waits.
          </p>
          <div className="flex flex-col items-start gap-2">
            <Button variant="outlined" loading={starting} onClick={startNow}>
              Start Without Waiting
            </Button>
            <ErrorLine>{error}</ErrorLine>
          </div>
        </>
      ) : (
        <>
          <ProgressBar value={null} aria-label={title} />
          <p className="max-w-(--measure) text-body text-pretty text-label-2">
            {kind === "look"
              ? "This carries on while you work on other assets. The image appears here when it is ready."
              : pack
                ? "The views that keep it the same from every side are being planned. Each one appears here to review as soon as it is made."
                : "This carries on while you work on other assets. The sheet appears here when it is ready."}
          </p>
        </>
      )}
      {references.length > 0 ? (
        <div className="flex flex-col gap-2 pt-2">
          <p className="font-mono text-meta tracking-caps text-label-2 uppercase">Your photos</p>
          <ReferenceThumbs references={references} designer={designer} />
        </div>
      ) : null}
    </div>
  );

  if (!held) return <div className="flex in-2 flex-col">{words}</div>;
  return (
    <StageLayout
      frame={
        <figure className="flex flex-col gap-2">
          <Artwork
            fileId={held.fileId}
            alt={`${assetName}, ${held.kind === "sheet" ? "previous sheet" : "image"}`}
            shape={heldShape(held, orientation)}
          />
          {heldCaption ? (
            <figcaption className="text-meta text-label-2">{heldCaption}</figcaption>
          ) : null}
        </figure>
      }
      rail={words}
    />
  );
}

/** What a decision started, for the line shown while moving on to the next asset. */
function decisionWords(
  kind: "look" | "sheet",
  decision: "accepted" | "rejected",
  assetName: string,
): string {
  if (kind === "look") {
    return decision === "accepted"
      ? `Building ${assetName}’s sheet`
      : `Making a new image of ${assetName}`;
  }
  return decision === "accepted"
    ? `${assetName} is ready`
    : `Building a new sheet for ${assetName}`;
}

/** Where an error of a decision is shown: under the decision, in the panel, or on the spec card. */
type ErrorPlace = "decision" | "panel" | "spec";

/**
 * Accept or reject one look or sheet; reports errors in place. A decision that starts a job (or
 * makes the asset ready) moves on to the next asset that waits for the user.
 */
function useReview(projectId: string, asset: { id: string; name: string }, initialAsking: boolean) {
  const { moveOn } = useAssetScreen();
  const [accepting, startAccepting] = useTransition();
  const [sending, startSending] = useTransition();
  const [errors, setErrors] = useState<Partial<Record<ErrorPlace, string>>>({});
  const [asking, setAsking] = useState(initialAsking);
  const [accepted, setAccepted] = useState(false);

  function run(
    target: { kind: "look" | "sheet"; id: string },
    review: LookReviewInput | ReviewInput,
    place: ErrorPlace,
    words?: string,
  ) {
    const start = review.decision === "accepted" ? startAccepting : startSending;
    setErrors({});
    start(async () => {
      const result =
        target.kind === "look"
          ? await reviewLookAction(projectId, target.id, review, asset.id)
          : await reviewSheetAction(projectId, target.id, review, asset.id);
      if (!result.ok) {
        setErrors({ [place]: result.error });
        return;
      }
      if (review.decision === "accepted") setAccepted(true);
      setAsking(false);
      moveOn(result.data, words ?? decisionWords(target.kind, review.decision, asset.name));
    });
  }

  return {
    accepted,
    accepting,
    sending,
    error: errors.decision ?? null,
    panelError: errors.panel ?? null,
    specError: errors.spec ?? null,
    asking,
    setAsking: (open: boolean) => {
      setErrors({});
      setAsking(open);
    },
    run,
  };
}

/**
 * "Is this Mara?" with Accept and Request Changes; Request Changes swaps in `panel` (the
 * request-changes panel, mounted only while asking).
 */
function Decision({
  assetName,
  lead,
  meta,
  notices,
  review,
  acceptLabel,
  acceptDisabled,
  acceptReason,
  onAccept,
  secondary,
  footer,
  panel,
  marking,
}: {
  assetName: string;
  lead: string;
  meta: ReactNode;
  /** The designer's warnings and questions about this version, under the meta line. */
  notices?: ReactNode;
  review: ReturnType<typeof useReview>;
  acceptLabel: string;
  acceptDisabled: boolean;
  /** Why Accept is not available yet, in one line. */
  acceptReason?: string | null;
  onAccept: () => void;
  /** Replaces Request Changes (an uploaded image is replaced, not fixed). */
  secondary?: ReactNode;
  footer?: ReactNode;
  panel: ReactNode;
  /** The marks on the picture beside the panel. */
  marking: Marking;
}) {
  const busy = review.accepting || review.sending;
  return (
    <SwapFade swapKey={review.asking ? "asking" : "deciding"} className="flex flex-col gap-8">
      {review.asking ? (
        panel
      ) : (
        <>
          <div className="flex flex-col gap-3">
            <StageHeading className="text-heading text-balance break-words">
              Is this {assetName}?
            </StageHeading>
            <p className="text-body text-pretty text-label-2">{lead}</p>
            {meta}
          </div>
          {notices}
          <div className="flex flex-col gap-3">
            <Button
              variant="primary"
              size="large"
              loading={review.accepting}
              disabled={busy || acceptDisabled}
              leadingIcon={review.accepted ? <DrawnTick /> : undefined}
              onClick={review.accepted ? undefined : onAccept}
              className={review.accepted ? "pl-5" : undefined}
            >
              {review.accepted ? "Accepted" : acceptLabel}
            </Button>
            {acceptReason ? (
              <p className="text-secondary text-pretty text-label-2">{acceptReason}</p>
            ) : null}
            {secondary ?? (
              <Button
                variant="outlined"
                size="large"
                disabled={busy}
                onClick={() => {
                  marking.clear();
                  review.setAsking(true);
                }}
              >
                Request Changes
              </Button>
            )}
            <ErrorLine>{review.error}</ErrorLine>
          </div>
          {footer}
        </>
      )}
    </SwapFade>
  );
}

/** The designer's notes on a version: its warnings, and what it assumed (folded). */
function DesignerNotes({ warnings, assumptions }: { warnings: string[]; assumptions: string[] }) {
  if (warnings.length === 0 && assumptions.length === 0) return null;
  return (
    <div className="flex flex-col gap-3">
      {warnings.length > 0 ? (
        <ul className="flex flex-col gap-2 border-l-2 border-outline pl-4">
          {warnings.map((w) => (
            <li key={w} className="text-secondary text-pretty text-label-2">
              {w}
            </li>
          ))}
        </ul>
      ) : null}
      {assumptions.length > 0 ? (
        <details className="group">
          <summary className="cursor-pointer rounded-mark text-secondary text-label-2 focus-ring marker:text-label-3 hover:text-label">
            What the designer assumed
          </summary>
          <ul className="mt-2 flex list-disc flex-col gap-1.5 pl-5">
            {assumptions.map((a) => (
              <li key={a} className="text-secondary text-pretty text-label-2">
                {a}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}

export function LookReviewStage({
  projectId,
  assetId,
  assetName,
  look,
  parent,
  orientation,
  designer,
  toConfirm,
  rejectedInARow,
  maxNote,
  prices,
  balance,
  initialAsking = false,
}: {
  projectId: string;
  assetId: string;
  assetName: string;
  look: LookView;
  /** The look this one answers (for how it was made). */
  parent: LookView | null;
  orientation: Orientation;
  designer: DesignerInfo;
  /** Critical spec fields the designer inferred: checked before Accept. */
  toConfirm: string[];
  rejectedInARow: number;
  maxNote: number;
  prices: { look: number | null; sheet: number | null };
  balance: number;
  /** Open with the request-changes panel (a card's Request Changes led here). */
  initialAsking?: boolean;
}) {
  const uploaded = look.source === "uploaded";
  const review = useReview(projectId, { id: assetId, name: assetName }, initialAsking && !uploaded);
  const target = { kind: "look" as const, id: look.id };
  const busy = review.accepting || review.sending;
  const marking = useMarking();
  const [spec, setSpec] = useState<SpecDraft>(EMPTY_SPEC_DRAFT);
  const [specErrorLocal, setSpecError] = useState<string | null>(null);
  const warnings = splitWarnings(look.spec?.warnings ?? []);
  const conflictPhotos =
    warnings.referenceConflict && look.references.length > 0
      ? exactReferences(look.references)
      : [];
  const unchecked = toConfirm.filter((f) => !spec.confirmed.includes(f));
  const changed = specChanged(spec);
  const acceptReason = changed
    ? "Send your changes on the specification, or undo them, before accepting."
    : unchecked.length > 0
      ? "Check the highlighted fields on the specification first."
      : null;
  const showSpec = !uploaded && look.spec !== null && designer.key !== "character";

  /** What the spec card adds to a rejection: changed values and answers. */
  function specInput(): Pick<LookReviewInput, "specEdits" | "clarifyAnswers"> {
    const edits = Object.entries(spec.edits).map(([field, value]) => ({
      field,
      value: value.trim(),
    }));
    return {
      ...(edits.length > 0 ? { specEdits: edits } : {}),
      ...(Object.keys(spec.clarify).length > 0 ? { clarifyAnswers: spec.clarify } : {}),
    };
  }

  function sendSpec() {
    const blank = Object.entries(spec.edits).find(([, value]) => !value.trim());
    if (blank) {
      setSpecError("Write the new value, or undo the change.");
      return;
    }
    setSpecError(null);
    review.run(target, { decision: "rejected", ...specInput() }, "spec");
  }

  const notices = (
    <>
      {warnings.locationConflict ? (
        <p className="border-l-2 border-outline pl-4 text-secondary text-pretty text-label-2">
          {warnings.locationConflict}
        </p>
      ) : null}
      {warnings.referenceConflict && conflictPhotos.length > 0 ? (
        <ReferenceConflictChoice
          assetId={assetId}
          title="Your change goes against a photo"
          message={warnings.referenceConflict}
          photos={conflictPhotos}
          designer={designer}
          sending={busy}
          onReplace={(fileId) =>
            review.run(
              target,
              {
                decision: "rejected",
                references: nextReferences(look.references, conflictPhotos, { fileId }),
              },
              "decision",
            )
          }
          onDrop={() =>
            review.run(
              target,
              { decision: "rejected", references: nextReferences(look.references, conflictPhotos) },
              "decision",
            )
          }
        />
      ) : warnings.referenceConflict ? (
        <p className="border-l-2 border-outline pl-4 text-secondary text-pretty text-label-2">
          {warnings.referenceConflict}
        </p>
      ) : null}
      <DesignerNotes warnings={warnings.others} assumptions={look.spec?.assumptions ?? []} />
    </>
  );

  return (
    <StageLayout
      frame={
        <div className="flex flex-col gap-8">
          <Artwork
            fileId={look.fileId}
            alt={`${assetName}, image to review`}
            shape={lookShape(look.aspectRatio, orientation)}
            overlay={
              review.asking ? (
                <MarkLayer marking={marking} subject="image" disabled={review.sending} />
              ) : null
            }
          />
          {showSpec && look.spec ? (
            <SpecCard
              spec={look.spec}
              toConfirm={toConfirm}
              answered={look.clarifyAnswers}
              draft={spec}
              disabled={busy}
              sending={review.sending}
              error={specErrorLocal ?? review.specError}
              price={prices.look}
              balance={balance}
              onChange={(next) => {
                setSpecError(null);
                setSpec(next);
              }}
              onSend={sendSpec}
            />
          ) : null}
        </div>
      }
      rail={
        <Decision
          assetName={assetName}
          lead="Accepting builds the reference sheet from this image."
          meta={
            <>
              <VersionLine
                label={`Image ${look.versionNumber}`}
                origin={lookOrigin(look, parent)}
                date={look.createdAt}
              />
              {look.isSample ? <p className="text-meta text-label-2">{SAMPLE_OUTPUT}</p> : null}
              {look.references.length > 0 && conflictPhotos.length === 0 ? (
                <ReferenceThumbs
                  references={look.references}
                  designer={designer}
                  className="pt-1"
                />
              ) : null}
            </>
          }
          notices={notices}
          review={review}
          acceptLabel="Accept Image"
          acceptDisabled={!canAfford(prices.sheet, balance) || acceptReason !== null}
          acceptReason={acceptReason}
          onAccept={() =>
            review.run(
              target,
              {
                decision: "accepted",
                confirmedFields: spec.confirmed.filter((f) => toConfirm.includes(f)),
              },
              "decision",
            )
          }
          secondary={
            uploaded ? (
              <Button
                variant="outlined"
                size="large"
                loading={review.sending}
                disabled={busy}
                onClick={() =>
                  review.run(
                    target,
                    { decision: "rejected", note: "Replaced with a different upload." },
                    "decision",
                  )
                }
              >
                Use a Different Image
              </Button>
            ) : undefined
          }
          footer={<PriceLine price={prices.sheet} balance={balance} action="sheet" />}
          marking={marking}
          panel={
            <LookChangesPanel
              assetId={assetId}
              look={look}
              designer={designer}
              rejectedInARow={rejectedInARow}
              maxNote={maxNote}
              sending={review.sending}
              serverError={review.panelError}
              price={prices.look}
              balance={balance}
              marking={marking}
              headingAs={StageHeading}
              onSubmit={(input) =>
                review.run(
                  target,
                  {
                    decision: "rejected",
                    selections: input.selections,
                    ...(input.note ? { note: input.note } : {}),
                    ...(input.references ? { references: input.references } : {}),
                    ...specInput(),
                  },
                  "panel",
                )
              }
              onReroll={(code) =>
                review.run(
                  target,
                  { decision: "rejected", selections: [{ code }] },
                  "panel",
                  `Making a new variation of ${assetName}`,
                )
              }
              onCancel={() => {
                marking.clear();
                review.setAsking(false);
              }}
            />
          }
        />
      }
    />
  );
}

/** The six numbered detail frames of a character sheet, laid out as on the sheet (1 top left). */
export function DetailFrames({ cells }: { cells: readonly DetailCell[] }) {
  if (cells.length === 0) return null;
  const sorted = [...cells].sort((a, b) => a.slot - b.slot);
  return (
    <section aria-label="Detail frames" className="flex flex-col gap-3">
      <Caps as="h3">Detail frames</Caps>
      <ol className="grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-3">
        {sorted.map((cell) => (
          <li key={cell.slot} className="flex min-w-0 items-baseline gap-3">
            <span className="w-4 shrink-0 font-mono text-body text-label tabular-nums">
              {cell.slot}
            </span>
            <span className="min-w-0 text-secondary text-pretty break-words text-label-2">
              {cell.subject}
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}

/**
 * A design change the sheet maker refused (the design is approved before the sheet): what was
 * asked, and the way to make it at the design step.
 */
export function DesignChangeNotice({
  requests,
  message,
  disabled,
  onChange,
}: {
  requests: readonly string[];
  message: string | null;
  disabled: boolean;
  onChange: (text: string) => void;
}) {
  if (requests.length === 0) return null;
  const text = requests.join("\n");
  return (
    <div className="flex flex-col items-start gap-3 rounded-tile border border-outline-quiet bg-elevated p-4">
      <Caps as="h3">Not changed here</Caps>
      <ul className="flex flex-col gap-1.5">
        {requests.map((r) => (
          <li key={r} className="text-body text-pretty break-words text-label">
            “{r}”
          </li>
        ))}
      </ul>
      <p className="text-secondary text-pretty text-label-2">
        {message ?? "This changes the approved design, so it is made at the design step, not here."}
      </p>
      <Button variant="outlined" disabled={disabled} onClick={() => onChange(text)}>
        Change the Design
      </Button>
    </div>
  );
}

/** A sheet maker's other notes and the fixes it applied, kept quiet. */
export function SheetNotes({
  warnings,
  appliedFixes,
}: {
  warnings: readonly string[];
  appliedFixes: readonly { code: string; change: string }[];
}) {
  if (warnings.length === 0 && appliedFixes.length === 0) return null;
  return (
    <div className="flex flex-col gap-3">
      {warnings.length > 0 ? (
        <ul className="flex flex-col gap-2 border-l-2 border-outline pl-4">
          {warnings.map((w) => (
            <li key={w} className="text-secondary text-pretty text-label-2">
              {w}
            </li>
          ))}
        </ul>
      ) : null}
      {appliedFixes.length > 0 ? (
        <details className="group">
          <summary className="cursor-pointer rounded-mark text-secondary text-label-2 focus-ring marker:text-label-3 hover:text-label">
            What was changed from the last one
          </summary>
          <ul className="mt-2 flex list-disc flex-col gap-1.5 pl-5">
            {appliedFixes.map((f) => (
              <li key={`${f.code}:${f.change}`} className="text-secondary text-pretty text-label-2">
                {f.change}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}

/** The panel's words for a character sheet. */
export const CHARACTER_SHEET_WORDS: SheetChangesWords = {
  subject: "sheet",
  designTile: {
    title: "Change the character’s design",
    line: "Face, hair, body, outfit or colours: made at the character step.",
  },
  designHint:
    "The character goes back to its design step with your words. Once you accept the new board, the sheet is rebuilt by itself.",
};

export function SheetReviewStage({
  projectId,
  assetId,
  assetName,
  sheet,
  look,
  orientation,
  catalog,
  rejectedInARow,
  maxNote,
  sheetPrice,
  balance,
  initialAsking = false,
}: {
  projectId: string;
  assetId: string;
  assetName: string;
  sheet: SheetView;
  look: LookView | null;
  orientation: Orientation;
  /** The character sheet maker's catalog, as the Wizard shows it. */
  catalog: SheetCatalogInfo;
  /** Sheets of this design sent back in a row before this one. */
  rejectedInARow: number;
  maxNote: number;
  sheetPrice: number | null;
  balance: number;
  initialAsking?: boolean;
}) {
  const review = useReview(projectId, { id: assetId, name: assetName }, initialAsking);
  const target = { kind: "sheet" as const, id: sheet.id };
  const busy = review.accepting || review.sending;
  const marking = useMarking();
  // A refused design change opens the panel on the design step, with the request written.
  const [designText, setDesignText] = useState<string | null>(null);
  const spec = sheet.spec;
  const cells = spec?.detailCells ?? [];
  const notes = splitSheetWarnings(spec?.warnings ?? []);
  const designChanges = spec?.designChanges.length ? spec.designChanges : notes.designChanges;
  const routeCode = designRouteOption(catalog.options)?.code;
  return (
    <StageLayout
      frame={
        <div className="flex flex-col gap-6">
          <Artwork
            fileId={sheet.fileId}
            alt={`${assetName}, reference sheet to review`}
            shape="sheet"
            overlay={
              review.asking ? (
                <MarkLayer marking={marking} subject="sheet" disabled={review.sending} />
              ) : null
            }
          />
          <DetailFrames cells={cells} />
        </div>
      }
      rail={
        <Decision
          assetName={assetName}
          lead={`Accepting the sheet makes ${assetName} ready for Production.`}
          meta={
            <>
              <VersionLine
                label={`Sheet ${sheet.versionNumber}`}
                origin={
                  spec?.editMode === "edit_previous_sheet"
                    ? "Edited from the last sheet"
                    : sheet.parentId
                      ? "Revised after review"
                      : undefined
                }
                date={sheet.createdAt}
              />
              {sheet.isSample ? <p className="text-meta text-label-2">{SAMPLE_OUTPUT}</p> : null}
            </>
          }
          notices={
            <>
              <DesignChangeNotice
                requests={designChanges}
                message={catalog.designChangeMessage}
                disabled={busy}
                onChange={(text) => {
                  marking.clear();
                  setDesignText(text);
                  review.setAsking(true);
                }}
              />
              <SheetNotes warnings={notes.others} appliedFixes={spec?.appliedFixes ?? []} />
            </>
          }
          review={review}
          acceptLabel="Accept Sheet"
          acceptDisabled={false}
          onAccept={() => review.run(target, { decision: "accepted" }, "decision")}
          footer={
            look?.fileId ? (
              <InsetImage
                fileId={look.fileId}
                caption={`Accepted image (Image ${look.versionNumber})`}
                alt={`${assetName}, accepted image`}
                shape={lookShape(look.aspectRatio, orientation)}
              />
            ) : null
          }
          marking={marking}
          panel={
            <SheetChangesPanel
              catalog={catalog}
              cells={cells}
              words={CHARACTER_SHEET_WORDS}
              initialDesignText={designText}
              rejectedInARow={rejectedInARow}
              maxNote={maxNote}
              sending={review.sending}
              serverError={review.panelError}
              price={sheetPrice}
              priceAction="sheet"
              balance={balance}
              marking={marking}
              markSubject="sheet"
              headingAs={StageHeading}
              onSubmit={(input) =>
                review.run(
                  target,
                  {
                    decision: "rejected",
                    selections: input.selections,
                    ...(input.note ? { note: input.note } : {}),
                  },
                  "panel",
                  input.selections.some((s) => s.code === routeCode)
                    ? `${assetName} goes back to its design`
                    : undefined,
                )
              }
              onReroll={(code) =>
                review.run(
                  target,
                  { decision: "rejected", selections: [{ code }] },
                  "panel",
                  `Making ${assetName}’s sheet again`,
                )
              }
              onCancel={() => {
                marking.clear();
                setDesignText(null);
                review.setAsking(false);
              }}
            />
          }
        />
      }
    />
  );
}

export function ReadyStage({
  projectId,
  assetId,
  assetName,
  sheet,
  look,
  orientation,
  initialConfirming = false,
  frame,
  line,
}: {
  projectId: string;
  assetId: string;
  assetName: string;
  sheet: SheetView | null;
  look: LookView | null;
  orientation: Orientation;
  /** Replaces the sheet as the picture (a pack shows its contact sheet or its Hero). */
  frame?: ReactNode;
  /** Replaces the line under the title. */
  line?: string;
  /** Open with the confirmation to change the image (a card's Change Image led here). */
  initialConfirming?: boolean;
}) {
  const { refresh } = useAssetScreen();
  const [confirming, setConfirming] = useState(initialConfirming);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function startOver() {
    setError(null);
    startTransition(async () => {
      const result = await startOverAction(projectId, assetId);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setConfirming(false);
      refresh();
    });
  }

  return (
    <StageLayout
      frame={
        frame !== undefined ? (
          frame
        ) : (
          <Artwork
            fileId={sheet?.fileId ?? null}
            alt={`${assetName}, reference sheet`}
            shape="sheet"
          />
        )
      }
      rail={
        <>
          <div className="flex flex-col gap-3">
            <StageHeading className="text-heading-sm text-balance break-words">
              {assetName} is ready.
            </StageHeading>
            <p className="text-body text-pretty text-label-2">
              {line ?? `This sheet keeps ${assetName} the same in every shot.`}
            </p>
            {sheet ? (
              <VersionLine
                label={`Sheet ${sheet.versionNumber}`}
                origin="Accepted"
                date={sheet.decidedAt ?? sheet.createdAt}
              />
            ) : null}
            {sheet?.isSample ? <p className="text-meta text-label-2">{SAMPLE_OUTPUT}</p> : null}
          </div>
          <div>
            <Button variant="outlined" size="large" onClick={() => setConfirming(true)}>
              Change Image
            </Button>
          </div>
          {look?.fileId ? (
            <InsetImage
              fileId={look.fileId}
              caption={`Accepted image (Image ${look.versionNumber})`}
              alt={`${assetName}, accepted image`}
              shape={lookShape(look.aspectRatio, orientation)}
            />
          ) : null}
          <Alert
            open={confirming}
            onOpenChange={(open) => {
              setConfirming(open);
              if (!open) setError(null);
            }}
            title={`Change ${assetName}’s Image?`}
            message="The image and sheet stay in History. You then add a new image."
            confirmLabel="Change Image"
            onConfirm={startOver}
            loading={pending}
            error={error}
          />
        </>
      }
    />
  );
}

export function FailedStage({
  projectId,
  assetId,
  assetName,
  failed,
  held,
  orientation,
  price,
  balance,
  onAnotherWay,
}: {
  projectId: string;
  assetId: string;
  assetName: string;
  failed: { kind: "look" | "sheet"; id: string; failure: string | null };
  held: HeldImage | null;
  orientation: Orientation;
  price: number | null;
  balance: number;
  onAnotherWay: (() => void) | null;
}) {
  const { moveOn } = useAssetScreen();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const credits = isCreditsFailure(failed.failure);
  const title =
    failed.kind === "look"
      ? `${assetName}’s image could not be created.`
      : `${assetName}’s sheet could not be built.`;

  function retry() {
    setError(null);
    startTransition(async () => {
      const result = await retryAction(projectId, { kind: failed.kind, id: failed.id }, assetId);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      moveOn(
        result.data,
        failed.kind === "look"
          ? `Trying ${assetName}’s image again`
          : `Trying ${assetName}’s sheet again`,
      );
    });
  }

  const shape: ArtworkShape = held
    ? heldShape(held, orientation)
    : failed.kind === "sheet"
      ? "sheet"
      : orientation;
  return (
    <StageLayout
      frame={
        <Artwork
          fileId={held?.fileId ?? null}
          alt={held ? `${assetName}, last image` : ""}
          shape={shape}
        >
          {held ? null : <MissingImage label="No image" />}
        </Artwork>
      }
      rail={
        <div role="alert" className="flex flex-col gap-8">
          <div className="flex flex-col gap-3">
            <StageHeading className="text-heading-sm text-balance break-words">
              {title}
            </StageHeading>
            <p className="text-body text-pretty text-label-2">
              {failed.failure ?? "Something went wrong while it was being made."}
            </p>
            {credits ? (
              <p className="text-body text-label">
                You now have <Amount n={balance} /> {balance === 1 ? "credit" : "credits"}.
              </p>
            ) : null}
          </div>
          <div className="flex flex-col gap-3">
            <Button
              variant="primary"
              size="large"
              loading={pending}
              disabled={!canAfford(price, balance)}
              onClick={retry}
            >
              Try Again
            </Button>
            {onAnotherWay ? (
              <Button variant="outlined" size="large" onClick={onAnotherWay} disabled={pending}>
                Add Image Another Way
              </Button>
            ) : null}
            <PriceLine
              price={price}
              balance={balance}
              action={failed.kind === "look" ? "image" : "sheet"}
            />
            <ErrorLine>{error}</ErrorLine>
          </div>
        </div>
      }
    />
  );
}
