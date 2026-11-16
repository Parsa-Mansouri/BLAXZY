"use client";

import { useState, useTransition } from "react";
import {
  reviewLookAction,
  reviewSheetAction,
  type LookReviewInput,
  type ReviewInput,
} from "../../actions";
import { useSpend } from "@/app/(app)/_components/spend-confirm";
import { useAssetScreen } from "../asset-context";

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
export function useReview(
  projectId: string,
  asset: { id: string; name: string },
  initialAsking: boolean,
) {
  const { moveOn } = useAssetScreen();
  const spend = useSpend();
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
      const accepted = review.decision === "accepted";
      const result = await spend.run({
        target: {
          kind: "asset_review",
          assetId: asset.id,
          subject: target.kind,
          decision: review.decision,
          designChange: "designChange" in review ? review.designChange : undefined,
        },
        title:
          target.kind === "look"
            ? accepted
              ? "Build the sheet?"
              : "Make a new image?"
            : "Make a new sheet?",
        description:
          target.kind === "look" && accepted
            ? `Accepting this image starts ${asset.name}’s sheet.`
            : undefined,
        confirmLabel: target.kind === "look" && accepted ? "Accept and build" : "Make it",
        submit: (expectedCredits) =>
          target.kind === "look"
            ? reviewLookAction(projectId, target.id, review, asset.id, expectedCredits)
            : reviewSheetAction(projectId, target.id, review, asset.id, expectedCredits),
      });
      if (result === null) return;
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
