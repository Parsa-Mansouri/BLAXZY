/**
 * Light entry point for pages and client-adjacent server code: only what the screens need to
 * read the designers' catalogs and notes, with no runner, no sample client, no prompt text and no
 * dami definitions. Import from "@/server/damis/light" instead of "@/server/damis" when that is
 * all you need, so the web bundle does not pull in the dami framework.
 */
export { getDamiMode } from "./framework/mode";
export { getReviewCatalog, type ReviewCatalogKey } from "./shared/review-catalog";
export { AI_DECIDES, MAX_DESIGN_REFERENCES } from "./shared/designer";
export { DESIGNER_CATALOGS, designerFor, REFERENCE_ROLES } from "./designers";
