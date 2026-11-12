/**
 * What the Review All screen shows of an asset's sheet: a character sheet (its image and numbered
 * detail frames), or a location pack or prop sheet (its pictures, the Hero first, and the contact
 * sheet once locked). Pure: built from `getAssetDetail` by the page and its action.
 */
import type { AssetDetail } from "@/server/assets";
import {
  packPictures,
  sheetRejectedInARow,
  splitSheetWarnings,
  type DetailCell,
  type PackKind,
  type PackPicture,
} from "../../assets/[assetId]/_lib/sheet-review";

export type ReviewSheet =
  | {
      kind: "character";
      sheetId: string;
      fileId: string;
      status: "accepted" | "in_review";
      cells: DetailCell[];
      /** Design changes the sheet maker refused (offered as a design change). */
      designChanges: string[];
      /** Sheets of this design sent back in a row before this one. */
      rejectedInARow: number;
    }
  | {
      kind: "pack";
      pack: PackKind;
      sheetId: string;
      status: "accepted" | "in_review";
      /** The locked pack's contact sheet; null while it is put together (or not locked). */
      contactFileId: string | null;
      /** The Hero first, then the views with an image (only approved ones once locked). */
      pictures: PackPicture[];
    };

/**
 * The sheet of an asset as the review shows it: the accepted one of a ready asset, or the one in
 * review. Null when there is nothing to show (a sheet is being built again, or it went back).
 */
export function toReviewSheet(
  detail: Pick<AssetDetail, "stage" | "looks" | "sheets" | "packViews">,
  pack: PackKind | null,
): ReviewSheet | null {
  const sheet =
    detail.stage === "ready"
      ? detail.sheets.find((s) => s.status === "accepted")
      : detail.stage === "sheet_review" && detail.sheets[0]?.status === "in_review"
        ? detail.sheets[0]
        : undefined;
  if (!sheet || (sheet.status !== "accepted" && sheet.status !== "in_review")) return null;
  if (pack) {
    const hero = detail.looks.find((l) => l.status === "accepted") ?? null;
    return {
      kind: "pack",
      pack,
      sheetId: sheet.id,
      status: sheet.status,
      contactFileId: sheet.status === "accepted" ? sheet.fileId : null,
      pictures: packPictures(
        hero ? { fileId: hero.fileId, aspectRatio: hero.aspectRatio } : null,
        detail.packViews,
        sheet.status === "accepted" ? ["accepted"] : ["in_review", "accepted"],
      ),
    };
  }
  if (!sheet.fileId) return null;
  const spec = sheet.spec;
  const designChanges = spec?.designChanges.length
    ? spec.designChanges
    : splitSheetWarnings(spec?.warnings ?? []).designChanges;
  return {
    kind: "character",
    sheetId: sheet.id,
    fileId: sheet.fileId,
    status: sheet.status,
    cells: spec?.detailCells ?? [],
    designChanges,
    rejectedInARow: sheetRejectedInARow(detail.sheets),
  };
}

/** The picture the review shows large: the sheet, the contact sheet, or the pack's Hero. */
export function reviewPicture(sheet: ReviewSheet): string | null {
  if (sheet.kind === "character") return sheet.fileId;
  return sheet.contactFileId ?? sheet.pictures[0]?.fileId ?? null;
}
