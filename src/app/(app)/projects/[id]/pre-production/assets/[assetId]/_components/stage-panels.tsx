"use client";

import { useState, useTransition, type ReactNode } from "react";
import type { LookView, SheetView } from "@/server/assets";
import { Alert, Button, ProgressBar, SwapFade, cn } from "@/ui";
import { isCreditsFailure, lookOrigin, type HeldImage } from "../_lib/asset-view";
import { retryAction, reviewLookAction, reviewSheetAction, startOverAction } from "../actions";
import { DrawnTick } from "../../../_components/drawn-tick";
import { MarkLayer, useMarking, type Marking } from "../../../_components/mark-layer";
import { RequestChangesPanel } from "../../../_components/request-changes-panel";
import { StageHeading, useAssetScreen } from "./asset-context";
import {
  Amount,
  Artwork,
  ErrorLine,
  MissingImage,
  PriceLine,
  When,
  canAfford,
  type IssueChoice,
  type Orientation,
} from "./shared";

const SAMPLE_OUTPUT = "Sample output from the test generator.";

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
function VersionLine({ label, origin, date }: { label: string; origin?: string; date: Date }) {
  return (
    <p className="text-meta text-label-2">
      {label}
      {origin ? ` · ${origin}` : ""} · <When date={date} />
    </p>
  );
}

/** A smaller image in the rail, for comparison. */
function InsetImage({
  fileId,
  caption,
  alt,
  orientation,
}: {
  fileId: string;
  caption: string;
  alt: string;
  orientation: Orientation;
}) {
  return (
    <figure className="flex flex-col gap-2">
      <Artwork
        fileId={fileId}
        alt={alt}
        shape={orientation}
        size="inset"
        className={orientation === "portrait" ? "max-w-44" : "max-w-72"}
      />
      <figcaption className="text-meta text-label-2">{caption}</figcaption>
    </figure>
  );
}

/** Generating a look or building a sheet: plain words, indeterminate progress, the last image. */
export function WaitingStage({
  assetName,
  kind,
  held,
  orientation,
}: {
  assetName: string;
  kind: "look" | "sheet";
  held: HeldImage | null;
  orientation: Orientation;
}) {
  const title =
    kind === "look" ? `Creating ${assetName}’s Image` : `Building ${assetName}’s Reference Sheet`;
  const shape = held
    ? held.kind === "sheet"
      ? "sheet"
      : orientation
    : kind === "sheet"
      ? "sheet"
      : orientation;
  const heldCaption = held
    ? held.kind === "sheet"
      ? `Sheet ${held.versionNumber}, shown while the new sheet is built.`
      : kind === "sheet"
        ? "The accepted image the sheet is built from."
        : `Image ${held.versionNumber}, shown while the new image is made.`
    : null;
  return (
    <StageLayout
      frame={
        <figure className="flex flex-col gap-2">
          <Artwork
            fileId={held?.fileId ?? null}
            alt={held ? `${assetName}, ${held.kind === "sheet" ? "previous sheet" : "image"}` : ""}
            shape={shape}
          />
          {heldCaption ? (
            <figcaption className="text-meta text-label-2">{heldCaption}</figcaption>
          ) : null}
        </figure>
      }
      rail={
        <div className="flex flex-col gap-4">
          <StageHeading className="text-heading-sm text-balance break-words">{title}</StageHeading>
          <ProgressBar value={null} aria-label={title} />
          <p className="text-body text-pretty text-label-2">
            {kind === "look"
              ? "This carries on while you work on other assets. The image appears here when it is ready."
              : "This carries on while you work on other assets. The sheet appears here when it is ready."}
          </p>
        </div>
      }
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

/**
 * Accept or reject one look or sheet; reports errors in place. A decision that starts a job (or
 * makes the asset ready) moves on to the next asset that waits for the user.
 */
function useReview(projectId: string, asset: { id: string; name: string }, initialAsking: boolean) {
  const { moveOn } = useAssetScreen();
  const [accepting, startAccepting] = useTransition();
  const [sending, startSending] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [panelError, setPanelError] = useState<string | null>(null);
  const [asking, setAsking] = useState(initialAsking);
  const [accepted, setAccepted] = useState(false);

  function run(
    target: { kind: "look" | "sheet"; id: string },
    review: { decision: "accepted" | "rejected"; issueCodes?: string[]; note?: string },
    fromPanel: boolean,
  ) {
    const start = review.decision === "accepted" ? startAccepting : startSending;
    (fromPanel ? setPanelError : setError)(null);
    start(async () => {
      const result =
        target.kind === "look"
          ? await reviewLookAction(projectId, target.id, review, asset.id)
          : await reviewSheetAction(projectId, target.id, review, asset.id);
      if (!result.ok) {
        (fromPanel ? setPanelError : setError)(result.error);
        return;
      }
      if (review.decision === "accepted") setAccepted(true);
      setAsking(false);
      moveOn(result.data, decisionWords(target.kind, review.decision, asset.name));
    });
  }

  return {
    accepted,
    accepting,
    sending,
    error,
    panelError,
    asking,
    setAsking: (open: boolean) => {
      setPanelError(null);
      setAsking(open);
    },
    run,
  };
}

/** "Is this Mara?" with Accept and Request Changes; Request Changes swaps in the issue panel. */
function Decision({
  assetName,
  subject,
  lead,
  meta,
  review,
  acceptLabel,
  acceptDisabled,
  onAccept,
  secondary,
  footer,
  issues,
  maxNote,
  price,
  balance,
  onSend,
  marking,
}: {
  assetName: string;
  subject: "image" | "sheet";
  lead: string;
  meta: ReactNode;
  review: ReturnType<typeof useReview>;
  acceptLabel: string;
  acceptDisabled: boolean;
  onAccept: () => void;
  /** Replaces Request Changes (an uploaded image is replaced, not fixed). */
  secondary?: ReactNode;
  footer?: ReactNode;
  issues: IssueChoice[];
  maxNote: number;
  price: number | null;
  balance: number;
  onSend: (input: { issueCodes: string[]; note: string }) => void;
  /** The marks on the picture beside the panel. */
  marking: Marking;
}) {
  const busy = review.accepting || review.sending;
  return (
    <SwapFade swapKey={review.asking ? "asking" : "deciding"} className="flex flex-col gap-8">
      {review.asking ? (
        <RequestChangesPanel
          subject={subject}
          issues={issues}
          maxNote={maxNote}
          sending={review.sending}
          serverError={review.panelError}
          price={price}
          balance={balance}
          marking={marking}
          onSubmit={onSend}
          onCancel={() => {
            marking.clear();
            review.setAsking(false);
          }}
          headingAs={StageHeading}
        />
      ) : (
        <>
          <div className="flex flex-col gap-3">
            <StageHeading className="text-heading text-balance break-words">
              Is this {assetName}?
            </StageHeading>
            <p className="text-body text-pretty text-label-2">{lead}</p>
            {meta}
          </div>
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

export function LookReviewStage({
  projectId,
  assetId,
  assetName,
  look,
  orientation,
  issues,
  maxNote,
  prices,
  balance,
  initialAsking = false,
}: {
  projectId: string;
  assetId: string;
  assetName: string;
  look: LookView;
  orientation: Orientation;
  issues: IssueChoice[];
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
  return (
    <StageLayout
      frame={
        <Artwork
          fileId={look.fileId}
          alt={`${assetName}, image to review`}
          shape={orientation}
          overlay={
            review.asking ? (
              <MarkLayer marking={marking} subject="image" disabled={review.sending} />
            ) : null
          }
        />
      }
      rail={
        <Decision
          assetName={assetName}
          subject="image"
          lead="Accepting builds the reference sheet from this image."
          meta={
            <>
              <VersionLine
                label={`Image ${look.versionNumber}`}
                origin={lookOrigin(look)}
                date={look.createdAt}
              />
              {look.isSample ? <p className="text-meta text-label-2">{SAMPLE_OUTPUT}</p> : null}
            </>
          }
          review={review}
          acceptLabel="Accept Image"
          acceptDisabled={!canAfford(prices.sheet, balance)}
          onAccept={() => review.run(target, { decision: "accepted" }, false)}
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
                    false,
                  )
                }
              >
                Use a Different Image
              </Button>
            ) : undefined
          }
          footer={<PriceLine price={prices.sheet} balance={balance} action="sheet" />}
          issues={issues}
          maxNote={maxNote}
          price={prices.look}
          balance={balance}
          marking={marking}
          onSend={(input) => review.run(target, { decision: "rejected", ...input }, true)}
        />
      }
    />
  );
}

export function SheetReviewStage({
  projectId,
  assetId,
  assetName,
  sheet,
  look,
  orientation,
  issues,
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
  issues: IssueChoice[];
  maxNote: number;
  sheetPrice: number | null;
  balance: number;
  initialAsking?: boolean;
}) {
  const review = useReview(projectId, { id: assetId, name: assetName }, initialAsking);
  const target = { kind: "sheet" as const, id: sheet.id };
  const marking = useMarking();
  return (
    <StageLayout
      frame={
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
      }
      rail={
        <Decision
          assetName={assetName}
          subject="sheet"
          lead={`Accepting the sheet makes ${assetName} ready for Production.`}
          meta={
            <>
              <VersionLine label={`Sheet ${sheet.versionNumber}`} date={sheet.createdAt} />
              {sheet.isSample ? <p className="text-meta text-label-2">{SAMPLE_OUTPUT}</p> : null}
            </>
          }
          review={review}
          acceptLabel="Accept Sheet"
          acceptDisabled={false}
          onAccept={() => review.run(target, { decision: "accepted" }, false)}
          footer={
            look?.fileId ? (
              <InsetImage
                fileId={look.fileId}
                caption={`Accepted image (Image ${look.versionNumber})`}
                alt={`${assetName}, accepted image`}
                orientation={orientation}
              />
            ) : null
          }
          issues={issues}
          maxNote={maxNote}
          price={sheetPrice}
          balance={balance}
          marking={marking}
          onSend={(input) => review.run(target, { decision: "rejected", ...input }, true)}
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
}: {
  projectId: string;
  assetId: string;
  assetName: string;
  sheet: SheetView | null;
  look: LookView | null;
  orientation: Orientation;
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
        <Artwork
          fileId={sheet?.fileId ?? null}
          alt={`${assetName}, reference sheet`}
          shape="sheet"
        />
      }
      rail={
        <>
          <div className="flex flex-col gap-3">
            <StageHeading className="text-heading-sm text-balance break-words">
              {assetName} is ready.
            </StageHeading>
            <p className="text-body text-pretty text-label-2">
              This sheet keeps {assetName} the same in every shot.
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
              orientation={orientation}
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

  const shape = held
    ? held.kind === "sheet"
      ? "sheet"
      : orientation
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
