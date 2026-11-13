/** Pure planning of reviews: catalog picks and spec edits become fix requests. */
import {
  buildFixRequests,
  DESIGNER_CATALOGS,
  designerFor,
  findReviewOption,
  type FixSelection,
  getReviewCatalog,
  ReviewCatalogError,
} from "@/server/damis";
import type { AssetKind, LookReference, LookSpecField, ReviewFixRequest } from "@/server/db/schema";
import { packKindOf } from "../packs";
import { AssetInputError } from "../service";
import { ISSUE_NOT_FOR_KIND } from "./messages";

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
  /** The re-roll option picked (no dami call), when it is the only thing asked. */
  regenerate: string | null;
};

/**
 * The fix requests for a rejection, from the designer's catalog (the Wizard hides Pro-only
 * options) and the spec card's edits. A re-roll option (`regenerate`) makes no request.
 */
export function planLookReview(
  kind: AssetKind,
  selections: readonly FixSelection[],
  specEdits: readonly { field: string; value: string }[],
): LookReviewPlan {
  const designer = designerFor(kind);
  if (!designer) throw new AssetInputError(ISSUE_NOT_FOR_KIND);
  const catalog = getReviewCatalog(DESIGNER_CATALOGS[designer]);
  let regenerate: string | null = null;
  for (const selection of selections) {
    const option = findReviewOption(catalog, selection.code);
    if (!option || option.proOnly) throw new AssetInputError(ISSUE_NOT_FOR_KIND);
    if (option.kind === "regenerate") regenerate = option.code;
  }
  let fixRequests: ReviewFixRequest[];
  try {
    fixRequests = buildFixRequests(catalog, selections);
  } catch (error) {
    if (error instanceof ReviewCatalogError) {
      const code = selections.find((s) => error.message.includes(s.code))?.code;
      const label = code ? findReviewOption(catalog, code)?.label : undefined;
      throw new AssetInputError(
        label ? `Say what you want for “${label}”.` : "Say what you want for each reason.",
      );
    }
    throw error;
  }
  for (const edit of specEdits) {
    fixRequests.push({
      type: "preference",
      code: SPEC_EDIT_CODE,
      instruction: `Set the spec field "${edit.field}" to: ${edit.value}. The user confirmed it (status confirmed, source user): keep the rest of the spec, the DNA and the prompt consistent with it.`,
    });
  }
  return { fixRequests, regenerate };
}

export function sameReferences(a: readonly LookReference[], b: readonly LookReference[]): boolean {
  return (
    a.length === b.length &&
    a.every((r, i) => r.fileId === b[i]?.fileId && r.role === b[i]?.role && r.note === b[i]?.note)
  );
}

/** The sheet maker's catalog of an asset kind. */
function sheetCatalogFor(kind: AssetKind) {
  const pack = packKindOf(kind);
  return getReviewCatalog(
    pack === "location"
      ? "sheet-generator-location"
      : pack === "prop"
        ? "sheet-generator-prop"
        : "sheet-generator-character",
  );
}

type SheetReviewPlan = {
  fixRequests: ReviewFixRequest[];
  /** The re-roll option picked (no dami call). */
  regenerate: string | null;
  /** The design-change option picked (back to the designer), with the user's words. */
  route: { code: string; text: string | null } | null;
};

/** The fix requests for a sheet's (or a view's) rejection, from the sheet maker's catalog. */
export function planSheetReview(
  kind: AssetKind,
  selections: readonly FixSelection[],
): SheetReviewPlan {
  const catalog = sheetCatalogFor(kind);
  let regenerate: string | null = null;
  let route: SheetReviewPlan["route"] = null;
  for (const selection of selections) {
    const option = findReviewOption(catalog, selection.code);
    if (!option || option.proOnly) throw new AssetInputError(ISSUE_NOT_FOR_KIND);
    if (option.kind === "regenerate") regenerate = option.code;
    if (option.kind === "route") {
      route = { code: option.code, text: selection.customText?.trim() || null };
    }
  }
  try {
    return { fixRequests: buildFixRequests(catalog, selections), regenerate, route };
  } catch (error) {
    if (error instanceof ReviewCatalogError) {
      const code = selections.find((s) => error.message.includes(s.code))?.code;
      const label = code ? findReviewOption(catalog, code)?.label : undefined;
      throw new AssetInputError(
        label ? `Say what you want for “${label}”.` : "Say what you want for each reason.",
      );
    }
    throw error;
  }
}
