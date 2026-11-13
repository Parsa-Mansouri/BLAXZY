import type { ReactNode } from "react";
import { Button, SwapFade } from "@/ui";
import { DrawnTick } from "../../../../_components/drawn-tick";
import type { Marking } from "../../../../_components/mark-layer";
import { StageHeading } from "../asset-context";
import type { useReview } from "./use-review";
import { ErrorLine } from "@/app/(app)/_components/values";

/**
 * "Is this Mara?" with Accept and Request Changes; Request Changes swaps in `panel` (the
 * request-changes panel, mounted only while asking).
 */
export function Decision({
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
