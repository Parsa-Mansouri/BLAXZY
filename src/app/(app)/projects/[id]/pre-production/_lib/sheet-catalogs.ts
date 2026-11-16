/**
 * What the sheet review screens read of the sheet makers' review catalogs (how many sent-back
 * rounds before the catalog's message, and what it says about a change that belongs to the design
 * step), read on the server from `@/server/damis/light` and handed to the client as plain data.
 * Server only: import it from pages, never from client components.
 */
import { getReviewCatalog, type ReviewCatalogKey } from "@/server/damis/light";
import type { PackKind, SheetCatalogInfo } from "../assets/[assetId]/_lib/sheet-review";

/** Rejected rounds in a row before the catalog's message, when the catalog says none. */
const DEFAULT_MAX_ATTEMPTS = 4;

function catalogInfo(key: ReviewCatalogKey): SheetCatalogInfo {
  const catalog = getReviewCatalog(key);
  const routing = catalog.rules.design_change_routing;
  const designChangeMessage =
    routing && typeof routing === "object" && "message_en" in routing
      ? typeof routing.message_en === "string"
        ? routing.message_en
        : null
      : null;
  return {
    maxAttempts: catalog.maxAttemptsBeforeSuggestion ?? DEFAULT_MAX_ATTEMPTS,
    attemptMessage: catalog.attemptMessage?.en ?? null,
    designChangeMessage,
  };
}

/** The character sheet maker's catalog. */
export function characterSheetCatalog(): SheetCatalogInfo {
  return catalogInfo("sheet-generator-character");
}

/** A location pack's or prop sheet's per-view catalog. */
export function packSheetCatalog(kind: PackKind): SheetCatalogInfo {
  return catalogInfo(kind === "location" ? "sheet-generator-location" : "sheet-generator-prop");
}
