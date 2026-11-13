import type { LookView } from "@/server/assets";
import { exactReferences, nextReferences, type splitWarnings } from "../../_lib/look-review";
import type { DesignerInfo } from "../../_lib/designer-view";
import { ReferenceConflictChoice } from "../reference-conflict";
import type { useReview } from "./use-review";

/** The designer's notes on a version: its warnings, and what it assumed (folded). */
function DesignerNotes({ warnings, assumptions }: { warnings: string[]; assumptions: string[] }) {
  if (warnings.length === 0 && assumptions.length === 0) return null;
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
      {assumptions.length > 0 ? (
        <details className="group">
          <summary className="cursor-pointer rounded-mark text-secondary text-label-2 focus-ring marker:text-label-3 hover:text-label">
            What the designer assumed
          </summary>
          <ul className="mt-2 flex list-disc flex-col gap-1.5 pl-5">
            {assumptions.map((a) => (
              <li key={a} className="text-secondary text-pretty text-label-2">
                {a}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}

/** The designer's warnings and questions under a look's meta line. */
export function LookNotices({
  assetId,
  look,
  designer,
  warnings,
  conflictPhotos,
  busy,
  review,
  target,
}: {
  assetId: string;
  look: LookView;
  designer: DesignerInfo;
  warnings: ReturnType<typeof splitWarnings>;
  conflictPhotos: ReturnType<typeof exactReferences>;
  busy: boolean;
  review: ReturnType<typeof useReview>;
  target: { kind: "look"; id: string };
}) {
  return (
    <>
      {warnings.locationConflict ? (
        <p className="border-l-2 border-outline pl-4 text-secondary text-pretty text-label-2">
          {warnings.locationConflict}
        </p>
      ) : null}
      {warnings.referenceConflict && conflictPhotos.length > 0 ? (
        <ReferenceConflictChoice
          assetId={assetId}
          title="Your change goes against a photo"
          message={warnings.referenceConflict}
          photos={conflictPhotos}
          designer={designer}
          sending={busy}
          onReplace={(fileId) =>
            review.run(
              target,
              {
                decision: "rejected",
                references: nextReferences(look.references, conflictPhotos, { fileId }),
              },
              "decision",
            )
          }
          onDrop={() =>
            review.run(
              target,
              { decision: "rejected", references: nextReferences(look.references, conflictPhotos) },
              "decision",
            )
          }
        />
      ) : warnings.referenceConflict ? (
        <p className="border-l-2 border-outline pl-4 text-secondary text-pretty text-label-2">
          {warnings.referenceConflict}
        </p>
      ) : null}
      <DesignerNotes warnings={warnings.others} assumptions={look.spec?.assumptions ?? []} />
    </>
  );
}
