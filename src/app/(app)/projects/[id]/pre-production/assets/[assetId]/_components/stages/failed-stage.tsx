"use client";

import { useSpend, useSpendTransition } from "@/app/(app)/_components/spend-confirm";
import { useState } from "react";
import { Button } from "@/ui";
import { isCreditsFailure, type ArtworkShape, type HeldImage } from "../../_lib/asset-view";
import { retryAction } from "../../actions";
import { StageHeading, useAssetScreen } from "../asset-context";
import { Artwork, MissingImage, PriceLine, type Orientation } from "../shared";
import { StageLayout, heldShape } from "./stage-layout";
import { Amount, ErrorLine } from "@/app/(app)/_components/values";
import { canAfford } from "@/app/(app)/_lib/format";

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
  const spend = useSpend();
  const [pending, startTransition] = useSpendTransition();
  const [error, setError] = useState<string | null>(null);
  const credits = isCreditsFailure(failed.failure);
  const title =
    failed.kind === "look"
      ? `${assetName}’s image could not be created.`
      : `${assetName}’s sheet could not be built.`;

  function retry() {
    setError(null);
    startTransition(async () => {
      const result = await spend.run({
        target: { kind: "asset", assetId, step: failed.kind },
        title: failed.kind === "look" ? "Try the image again?" : "Try the sheet again?",
        confirmLabel: "Try again",
        submit: (expectedCredits) =>
          retryAction(projectId, { kind: failed.kind, id: failed.id }, assetId, expectedCredits),
      });
      if (result === null) return;
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
