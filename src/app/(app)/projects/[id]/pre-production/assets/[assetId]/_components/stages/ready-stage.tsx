"use client";

import { useState, useTransition, type ReactNode } from "react";
import type { LookView, SheetView } from "@/server/assets";
import { Alert, Button } from "@/ui";
import { lookShape } from "../../_lib/asset-view";
import { startOverAction } from "../../actions";
import { StageHeading, useAssetScreen } from "../asset-context";
import { Artwork, type Orientation } from "../shared";
import { InsetImage, SAMPLE_OUTPUT, StageLayout, VersionLine } from "./stage-layout";

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
