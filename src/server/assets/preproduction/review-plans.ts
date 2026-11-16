/** Pure planning of reviews: catalog picks and spec edits become fix requests. */
import {
  DESIGNER_CATALOGS,
  designerFor,
  freeTextFixRequest,
  type ReviewCatalogKey,
} from "@/server/damis";
import type { AssetKind, LookReference, LookSpecField, ReviewFixRequest } from "@/server/db/schema";
import { packKindOf } from "../packs";
import { AssetInputError } from "../service";
import { ISSUE_NOT_FOR_KIND } from "./messages";

/** The design route's code of each sheet maker (SX01, LSX01, ASX01): back to the designer. */
const DESIGN_ROUTE_CODES = { character: "SX01", location: "LSX01", prop: "ASX01" } as const;

/** The code of a spec-card edit sent to the designer as a fix request. */
export const SPEC_EDIT_CODE = "SPEC_EDIT";

/**
 * The critical spec fields the designer filled in itself (inferred). The owner: they are reviewed
 * by the user before the design is locked, even when the user let the designer decide.
 */
export function fieldsToConfirm(spec: { fields: readonly LookSpecField[] } | null): string[] {
  return (spec?.fields ?? [])
    .filter((f) => f.critical && f.status === "inferred")
    .map((f) => f.field);
}

type LookReviewPlan = {
  fixRequests: ReviewFixRequest[];
};

/**
 * The fix requests for a look's rejection: the user's note as one free-text request (the
 * designer's "other" option, with the words as its custom text) and the spec card's edits.
 * Asking again without changes (a re-roll) is the caller's, and makes no request.
 */
export function planLookReview(
  kind: AssetKind,
  note: string | null,
  specEdits: readonly { field: string; value: string }[],
): LookReviewPlan {
  const designer = designerFor(kind);
  if (!designer) throw new AssetInputError(ISSUE_NOT_FOR_KIND);
  const fixRequests: ReviewFixRequest[] = note
    ? [freeTextFixRequest(DESIGNER_CATALOGS[designer], note)]
    : [];
  for (const edit of specEdits) {
    fixRequests.push({
      type: "preference",
      code: SPEC_EDIT_CODE,
      instruction: `Set the spec field "${edit.field}" to: ${edit.value}. The user confirmed it (status confirmed, source user): keep the rest of the spec, the DNA and the prompt consistent with it.`,
    });
  }
  return { fixRequests };
}

export function sameReferences(a: readonly LookReference[], b: readonly LookReference[]): boolean {
  return (
    a.length === b.length &&
    a.every((r, i) => r.fileId === b[i]?.fileId && r.role === b[i]?.role && r.note === b[i]?.note)
  );
}

/** The sheet maker's catalog of an asset kind. */
function sheetCatalogKey(kind: AssetKind): ReviewCatalogKey {
  const pack = packKindOf(kind);
  return pack === "location"
    ? "sheet-generator-location"
    : pack === "prop"
      ? "sheet-generator-prop"
      : "sheet-generator-character";
}

type SheetReviewPlan = {
  fixRequests: ReviewFixRequest[];
  /** The design change asked for (back to the designer), with the user's words. */
  route: { code: string; text: string | null } | null;
};

/**
 * The plan for a sheet's (or a view's) rejection. A design change goes back to the designer with
 * the note (the design route of the sheet maker). Anything else is the note as one free-text
 * request to the sheet maker; it never changes the design (the maker answers a design request with
 * a `DESIGN_CHANGE_REQUESTED:` warning, and the screen offers the design route then).
 */
export function planSheetReview(
  kind: AssetKind,
  input: { note: string | null; designChange: boolean },
): SheetReviewPlan {
  if (input.designChange) {
    const designer = designerFor(kind);
    if (!designer) throw new AssetInputError(ISSUE_NOT_FOR_KIND);
    return { fixRequests: [], route: { code: DESIGN_ROUTE_CODES[designer], text: input.note } };
  }
  return {
    fixRequests: input.note ? [freeTextFixRequest(sheetCatalogKey(kind), input.note)] : [],
    route: null,
  };
}
