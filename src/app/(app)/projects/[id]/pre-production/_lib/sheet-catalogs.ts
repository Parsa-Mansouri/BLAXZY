/**
 * The sheet makers' review catalogs as the screens show them (Wizard options, groups, messages),
 * read on the server from `@/server/damis/light`, projected to the client-safe option type (no
 * prompt text) and handed to the client as plain data. Server only:
 * import it from pages, never from client components.
 */
import { toClientOptions } from "@/lib/review-option";
import { getReviewCatalog, visibleOptions, type ReviewCatalogKey } from "@/server/damis/light";
import type { PackKind, SheetCatalogInfo } from "../assets/[assetId]/_lib/sheet-review";

/** Rejected rounds in a row before the catalog's message, when the catalog says none. */
const DEFAULT_MAX_ATTEMPTS = 4;

/** The owner's location sheet item for the concept sheet, which this flow does not make. */
const CONCEPT_ONLY = /\(concept only\)/i;

function catalogInfo(key: ReviewCatalogKey, context?: Record<string, boolean>): SheetCatalogInfo {
  const catalog = getReviewCatalog(key);
  const options = toClientOptions(
    visibleOptions(catalog, { sector: "wizard", context }).filter(
      (o) => !CONCEPT_ONLY.test(o.label),
    ),
  );
  const routing = catalog.rules.design_change_routing;
  const designChangeMessage =
    routing && typeof routing === "object" && "message_en" in routing
      ? typeof routing.message_en === "string"
        ? routing.message_en
        : null
      : null;
  return {
    options,
    groups: catalog.groups.map(({ id, label }) => ({ id, label })),
    maxAttempts: catalog.maxAttemptsBeforeSuggestion ?? DEFAULT_MAX_ATTEMPTS,
    attemptMessage: catalog.attemptMessage?.en ?? null,
    designChangeMessage,
  };
}

/** The character sheet's catalog: the digits 1 to 6 are drawn on the sheet. */
export function characterSheetCatalog(): SheetCatalogInfo {
  return catalogInfo("sheet-generator-character", { render_cell_numbers: true });
}

/** A location pack's or prop sheet's per-view catalog. */
export function packSheetCatalog(kind: PackKind): SheetCatalogInfo {
  return catalogInfo(kind === "location" ? "sheet-generator-location" : "sheet-generator-prop");
}
