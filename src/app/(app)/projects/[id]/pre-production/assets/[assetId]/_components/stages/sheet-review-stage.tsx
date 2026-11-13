"use client";

import { useState } from "react";
import type { LookView, SheetView } from "@/server/assets";
import { Button } from "@/ui";
import { lookShape } from "../../_lib/asset-view";
import {
  designRouteOption,
  splitSheetWarnings,
  type DetailCell,
  type SheetCatalogInfo,
} from "../../_lib/sheet-review";
import { MarkLayer, useMarking } from "../../../../_components/mark-layer";
import { StageHeading } from "../asset-context";
import { Caps } from "../desk";
import { Artwork, type Orientation } from "../shared";
import { SheetChangesPanel, type SheetChangesWords } from "../sheet-changes-panel";
import { Decision } from "./decision";
import { InsetImage, SAMPLE_OUTPUT, StageLayout, VersionLine } from "./stage-layout";
import { useReview } from "./use-review";

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
