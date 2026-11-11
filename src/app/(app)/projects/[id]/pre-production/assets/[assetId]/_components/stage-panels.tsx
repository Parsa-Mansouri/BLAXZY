"use client";

import { useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import type { LookView, SheetView } from "@/server/assets";
import { Alert, Button, ProgressBar, cn } from "@/ui";
import { isCreditsFailure, lookOrigin, type HeldImage } from "../_lib/asset-view";
import { retryAction, reviewLookAction, reviewSheetAction, startOverAction } from "../actions";
import { RequestChangesSheet } from "./request-changes-sheet";
import {
  Artwork,
  ErrorLine,
  MissingImage,
  PriceLine,
  When,
  canAfford,
  formatNumber,
  type IssueChoice,
  type Orientation,
} from "./shared";

const SAMPLE_IMAGE = "Sample image. A placeholder from the test generator, not a real result.";
const SAMPLE_SHEET = "Sample sheet. A placeholder from the test generator, not a real result.";

/** The image large on the leading side, what to do with it on the trailing side. */
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
    <div className="grid items-start gap-x-12 gap-y-8 @4xl:grid-cols-[minmax(0,1fr)_minmax(17rem,21rem)]">
      <div className={cn("min-w-0", frameClassName)}>{frame}</div>
      <div className="flex min-w-0 flex-col gap-5 @4xl:pt-1">{rail}</div>
    </div>
  );
}

/** "Image 2 · From your answers · 11 Nov, 14:02". */
function VersionLine({ label, origin, date }: { label: string; origin?: string; date: Date }) {
  return (
    <p className="text-callout text-label-2">
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
        className={orientation === "portrait" ? "max-w-44" : undefined}
      />
      <figcaption className="text-callout text-label-2">{caption}</figcaption>
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
  const title = kind === "look" ? "Creating the Image…" : "Building the Reference Sheet…";
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
            className={held ? undefined : "animate-pulse motion-reduce:animate-none"}
          />
          {heldCaption ? (
            <figcaption className="text-callout text-label-2">{heldCaption}</figcaption>
          ) : null}
        </figure>
      }
      rail={
        <div role="status" aria-live="polite" className="flex flex-col gap-4">
          <h3 className="text-title-2">{title}</h3>
          <ProgressBar value={null} aria-label={title} />
          <p className="text-reading text-label-2">
            {kind === "look"
              ? "You can leave this page. The image appears here when it is ready."
              : "The sheet shows the accepted image from several views. You can leave this page and carry on with another asset."}
          </p>
        </div>
      }
    />
  );
}

/** Accept or reject one look or sheet; reports errors in place. */
function useReview(projectId: string) {
  const router = useRouter();
  const [accepting, startAccepting] = useTransition();
  const [sending, startSending] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [sheetError, setSheetError] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);

  function run(
    target: { kind: "look" | "sheet"; id: string },
    review: { decision: "accepted" | "rejected"; issueCodes?: string[]; note?: string },
    fromSheet: boolean,
  ) {
    const start = review.decision === "accepted" ? startAccepting : startSending;
    (fromSheet ? setSheetError : setError)(null);
    start(async () => {
      const result =
        target.kind === "look"
          ? await reviewLookAction(projectId, target.id, review)
          : await reviewSheetAction(projectId, target.id, review);
      if (!result.ok) {
        (fromSheet ? setSheetError : setError)(result.error);
        return;
      }
      setSheetOpen(false);
      router.refresh();
    });
  }

  return {
    accepting,
    sending,
    error,
    sheetError,
    sheetOpen,
    setSheetOpen: (open: boolean) => {
      setSheetError(null);
      setSheetOpen(open);
    },
    run,
  };
}

export function LookReviewStage({
  projectId,
  assetName,
  look,
  orientation,
  issues,
  maxNote,
  prices,
  balance,
}: {
  projectId: string;
  assetName: string;
  look: LookView;
  orientation: Orientation;
  issues: IssueChoice[];
  maxNote: number;
  prices: { look: number | null; sheet: number | null };
  balance: number;
}) {
  const review = useReview(projectId);
  const uploaded = look.source === "uploaded";
  const target = { kind: "look" as const, id: look.id };
  const busy = review.accepting || review.sending;
  return (
    <StageLayout
      frame={
        <Artwork fileId={look.fileId} alt={`${assetName}, image to review`} shape={orientation} />
      }
      rail={
        <>
          <div className="flex flex-col gap-2">
            <h3 className="text-title-2">Review the Image</h3>
            <p className="text-reading text-pretty text-label-2">
              Check that it shows {assetName} as the script describes. Once accepted, a reference
              sheet is built from it.
            </p>
            <VersionLine
              label={`Image ${look.versionNumber}`}
              origin={lookOrigin(look)}
              date={look.createdAt}
            />
            {look.isSample ? <p className="text-callout text-label-2">{SAMPLE_IMAGE}</p> : null}
          </div>
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap gap-3">
              <Button
                variant="prominent"
                size="large"
                loading={review.accepting}
                disabled={busy || !canAfford(prices.sheet, balance)}
                onClick={() => review.run(target, { decision: "accepted" }, false)}
              >
                Accept
              </Button>
              {uploaded ? (
                <Button
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
              ) : (
                <Button size="large" disabled={busy} onClick={() => review.setSheetOpen(true)}>
                  Request Changes
                </Button>
              )}
            </div>
            {prices.sheet !== null ? (
              <div className="flex flex-col gap-1">
                <p className="text-callout text-label-2">Accepting builds the sheet.</p>
                <PriceLine price={prices.sheet} balance={balance} />
              </div>
            ) : null}
            <ErrorLine>{review.error}</ErrorLine>
          </div>
          {review.sheetOpen ? (
            <RequestChangesSheet
              open
              onOpenChange={review.setSheetOpen}
              subject="image"
              issues={issues}
              maxNote={maxNote}
              sending={review.sending}
              serverError={review.sheetError}
              price={prices.look}
              balance={balance}
              onSubmit={(input) => review.run(target, { decision: "rejected", ...input }, true)}
            />
          ) : null}
        </>
      }
    />
  );
}

export function SheetReviewStage({
  projectId,
  assetName,
  sheet,
  look,
  orientation,
  issues,
  maxNote,
  sheetPrice,
  balance,
}: {
  projectId: string;
  assetName: string;
  sheet: SheetView;
  look: LookView | null;
  orientation: Orientation;
  issues: IssueChoice[];
  maxNote: number;
  sheetPrice: number | null;
  balance: number;
}) {
  const review = useReview(projectId);
  const target = { kind: "sheet" as const, id: sheet.id };
  const busy = review.accepting || review.sending;
  return (
    <StageLayout
      frame={
        <Artwork
          fileId={sheet.fileId}
          alt={`${assetName}, reference sheet to review`}
          shape="sheet"
        />
      }
      rail={
        <>
          <div className="flex flex-col gap-2">
            <h3 className="text-title-2">Review the Sheet</h3>
            <p className="text-reading text-pretty text-label-2">
              Every view should show the same {assetName} as the accepted image.
            </p>
            <VersionLine label={`Sheet ${sheet.versionNumber}`} date={sheet.createdAt} />
            {sheet.isSample ? <p className="text-callout text-label-2">{SAMPLE_SHEET}</p> : null}
          </div>
          {look?.fileId ? (
            <InsetImage
              fileId={look.fileId}
              caption={`Accepted image (Image ${look.versionNumber})`}
              alt={`${assetName}, accepted image`}
              orientation={orientation}
            />
          ) : null}
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap gap-3">
              <Button
                variant="prominent"
                size="large"
                loading={review.accepting}
                disabled={busy}
                onClick={() => review.run(target, { decision: "accepted" }, false)}
              >
                Accept
              </Button>
              <Button size="large" disabled={busy} onClick={() => review.setSheetOpen(true)}>
                Request Changes
              </Button>
            </div>
            <ErrorLine>{review.error}</ErrorLine>
          </div>
          {review.sheetOpen ? (
            <RequestChangesSheet
              open
              onOpenChange={review.setSheetOpen}
              subject="sheet"
              issues={issues}
              maxNote={maxNote}
              sending={review.sending}
              serverError={review.sheetError}
              price={sheetPrice}
              balance={balance}
              onSubmit={(input) => review.run(target, { decision: "rejected", ...input }, true)}
            />
          ) : null}
        </>
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
}: {
  projectId: string;
  assetId: string;
  assetName: string;
  sheet: SheetView | null;
  look: LookView | null;
  orientation: Orientation;
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
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
      router.refresh();
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
          <div className="flex flex-col gap-2">
            <h3 className="text-title-2">Ready</h3>
            <p className="text-reading text-pretty text-label-2">
              This sheet and image keep {assetName} the same in every shot.
            </p>
            {sheet ? (
              <VersionLine
                label={`Sheet ${sheet.versionNumber}`}
                origin="Accepted"
                date={sheet.decidedAt ?? sheet.createdAt}
              />
            ) : null}
            {sheet?.isSample ? <p className="text-callout text-label-2">{SAMPLE_SHEET}</p> : null}
          </div>
          {look?.fileId ? (
            <InsetImage
              fileId={look.fileId}
              caption={`Accepted image (Image ${look.versionNumber})`}
              alt={`${assetName}, accepted image`}
              orientation={orientation}
            />
          ) : null}
          <div>
            <Button onClick={() => setConfirming(true)}>Start Over</Button>
          </div>
          <Alert
            open={confirming}
            onOpenChange={(open) => {
              setConfirming(open);
              if (!open) setError(null);
            }}
            title={`Start ${assetName} Over?`}
            message="The image and sheet stay in History. You then add a new image."
            confirmLabel="Start Over"
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
  assetName,
  failed,
  held,
  orientation,
  price,
  balance,
  onAnotherWay,
}: {
  projectId: string;
  assetName: string;
  failed: { kind: "look" | "sheet"; id: string; failure: string | null };
  held: HeldImage | null;
  orientation: Orientation;
  price: number | null;
  balance: number;
  onAnotherWay: (() => void) | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const credits = isCreditsFailure(failed.failure);
  const title =
    failed.kind === "look" ? "The image could not be created." : "The sheet could not be built.";

  function retry() {
    setError(null);
    startTransition(async () => {
      const result = await retryAction(projectId, { kind: failed.kind, id: failed.id });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      router.refresh();
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
        <div role="alert" className="flex flex-col gap-5">
          <div className="flex flex-col gap-2">
            <h3 className="text-title-2 text-balance">{title}</h3>
            <p className="text-reading text-pretty text-label-2">
              {failed.failure ?? "Something went wrong while it was being made."}
            </p>
            {credits ? (
              <p className="text-reading text-label tabular-nums">
                You now have {formatNumber(balance)} {balance === 1 ? "credit" : "credits"}.
              </p>
            ) : null}
          </div>
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap gap-3">
              <Button
                variant="prominent"
                size="large"
                loading={pending}
                disabled={!canAfford(price, balance)}
                onClick={retry}
              >
                Try Again
              </Button>
              {onAnotherWay ? (
                <Button size="large" onClick={onAnotherWay} disabled={pending}>
                  Add Image Another Way
                </Button>
              ) : null}
            </div>
            <PriceLine price={price} balance={balance} />
            <ErrorLine>{error}</ErrorLine>
          </div>
        </div>
      }
    />
  );
}
