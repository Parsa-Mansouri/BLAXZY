"use client";

import { useState, useTransition } from "react";
import {
  reviewLookAction,
  reviewSheetAction,
  type LookReviewInput,
  type ReviewInput,
} from "../../actions";
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
