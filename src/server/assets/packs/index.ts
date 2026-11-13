/**
 * Location packs and prop sheets: a sheet made of separate views (`asset_sheet_view`), each
 * generated in dependency order with the approved Hero and approved views as references, and
 * reviewed on its own. The backend never re-renders an approved view: the pack's human-facing
 * contact sheet is assembled with sharp once the pack is locked.
 *
 * This module holds the rules (`rules`, pure), the queries (`queries`), the worker's side (`worker`:
 * storing a plan, re-writing a view, advancing the generations, settling a view's image) and the
 * contact sheet (`contact-sheet`). The user's actions on views (review, retry, lock) are in
 * `preproduction/`, which imports from here and never the other way. Nothing is overwritten: a fix
 * or a re-roll is a new version of the view, decisions change statuses.
 */
export { assemblePackSheet } from "./contact-sheet";
export {
  acceptedPackViews,
  latestViewRows,
  listPackViews,
  loadPackJob,
  loadViewRejection,
  loadViewRow,
  type PackJobContext,
} from "./queries";
export {
  dnaCardOf,
  heroViewIdOf,
  MAX_VIEWS,
  packKindOf,
  packLockGate,
  type DnaCard,
  type PackKind,
  type PackLockGate,
  type PackView,
  type PackViewRow,
} from "./rules";
export {
  advanceSheetViews,
  applyViewGenerationResult,
  enqueueAdvance,
  enqueueAssemble,
  failSheetView,
  storePackPlan,
  storeViewFix,
  type PlannedView,
} from "./worker";
