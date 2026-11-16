"use client";

import type { LookView } from "@/server/assets";
import { Button } from "@/ui";
import { lookOrigin, lookShape } from "../../_lib/asset-view";
import type { DesignerInfo } from "../../_lib/designer-view";
import { exactReferences, splitWarnings } from "../../_lib/look-review";
import { MarkLayer, useMarking } from "../../../../_components/mark-layer";
import { StageHeading } from "../asset-context";
import { LookChangesPanel } from "../look-changes-panel";
import { ReferenceThumbs } from "../reference-conflict";
import { Artwork, PriceLine, type Orientation } from "../shared";
import { SpecCard, specChanged } from "../spec-card";
import { Decision } from "./decision";
import { SAMPLE_OUTPUT, StageLayout, VersionLine } from "./stage-layout";
import { LookNotices } from "./look-notices";
import { useLookSpec } from "./use-look-spec";
import { useReview } from "./use-review";
import { canAfford } from "@/app/(app)/_lib/format";

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
  const { spec, specErrorLocal, specInput, sendSpec, changeSpec } = useLookSpec(review, target);
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
              onChange={changeSpec}
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
          notices={
            <LookNotices
              assetId={assetId}
              look={look}
              designer={designer}
              warnings={warnings}
              conflictPhotos={conflictPhotos}
              busy={busy}
              review={review}
              target={target}
            />
          }
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
                    ...(input.note ? { note: input.note } : {}),
                    ...specInput(),
                  },
                  "panel",
                )
              }
              onReroll={() =>
                review.run(
                  target,
                  { decision: "rejected", regenerate: true },
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
