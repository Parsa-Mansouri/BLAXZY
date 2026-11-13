"use client";

import { useState, useTransition } from "react";
import type { LookView } from "@/server/assets";
import { Button, ProgressBar } from "@/ui";
import type { HeldImage } from "../../_lib/asset-view";
import type { DesignerInfo } from "../../_lib/designer-view";
import { startWithoutWaitingAction } from "../../actions";
import { StageHeading, useAssetScreen } from "../asset-context";
import { ReferenceThumbs } from "../reference-conflict";
import { Artwork, type Orientation } from "../shared";
import { StageLayout, heldShape } from "./stage-layout";
import { ErrorLine } from "@/app/(app)/_components/values";

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
