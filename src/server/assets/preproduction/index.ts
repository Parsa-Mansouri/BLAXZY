/**
 * Pre-production (Output_030): each asset gets an image (a "look": uploaded or generated, then
 * reviewed) and, once a look is accepted, a sheet built from it (generated, then reviewed). Voices
 * get a recording instead, accepted on upload, with no sheet.
 *
 * Every function takes the acting user and returns null (or false) when the project or asset is
 * missing, archived or not theirs; input the user can fix throws `AssetInputError` with a
 * user-safe message. Work that takes time (damis, generations) runs in jobs, sent on the
 * transaction that creates the look or sheet (the job exists exactly when the row does; a send
 * that fails rolls the change back and throws `AssetInputError`). Nothing is overwritten or
 * deleted: decisions change statuses, and new attempts are new versions.
 *
 * Lock order (every writer here, `detection-store` and the worker side): the project row
 * first (`FOR NO KEY UPDATE`, as `@/server/production` locks it before anything else), then asset
 * rows (`lockAsset`; several in id order), then a sheet row before its views. The worker's pack
 * advance takes only a sheet (shared) and then a view, the generation hook single look, sheet or
 * view rows. No path takes an asset lock without holding the project lock first.
 *
 * Layout: `inputs` (schemas, limits) and `messages` are leaves; `access` (ownership, stage, asset
 * lock), `versions` (new versions) and `enqueue` (jobs on the transaction) are the shared steps;
 * `read`, `start`, `look-review`, `sheet-review`, `retries`, `admin` and `complete` are the
 * services, `review-plans` their pure review planning. `packs` never imports from here.
 */
export { assertPreProductionOpen } from "./access";
export { addAsset, includeSkippedAsset, mergeAssets, removeAsset, updateAsset } from "./admin";
export { completePreProduction } from "./complete";
export { ENQUEUE_FAILURE, wakeOnTx } from "./enqueue";
export {
  DEFAULT_CARD_PAGE_SIZE,
  DUPLICATE_ADD_WINDOW_SECONDS,
  MAX_ASSET_DESCRIPTION_LENGTH,
  MAX_ASSET_NAME_LENGTH,
  MAX_CARD_PAGE_SIZE,
  MAX_GUIDED_ANSWER_LENGTH,
  MAX_GUIDED_ANSWERS,
  MAX_LOOK_PROMPT_LENGTH,
  MAX_REVIEW_NOTE_LENGTH,
} from "./inputs";
export { submitLookReview } from "./look-review";
export {
  getAssetDetail,
  getAssetKind,
  getPreProductionNavigator,
  getPreProductionOverview,
  listAssetCards,
  NAVIGATOR_BUSY_LIMIT,
  navigatorCounts,
  nextAssetNeedingInput,
  type AssetCard,
  type AssetDetail,
  type NextAsset,
  type PreProductionNavigator,
  type PreProductionOverview,
} from "./read";
export { replaceLook, retryLook, retrySheet } from "./retries";
export { fieldsToConfirm, SPEC_EDIT_CODE } from "./review-plans";
export {
  lockSheet,
  retrySheetView,
  submitSheetReview,
  submitSheetViewReview,
} from "./sheet-review";
export {
  answerLookQuestion,
  startDesign,
  startLookFromGuided,
  startLookFromPrompt,
  startLookFromUpload,
  startWithoutWaiting,
} from "./start";
