/**
 * Production (Output_04), contract in `docs/M4_CONTRACTS.md`. Owns `block_take` and
 * `export_bundle`; block versions go through `@/server/blocks`, assets through `@/server/assets`.
 * The services take the acting user and check ownership; the job surface is for the worker.
 */
export { PRICE_CHANGED_MESSAGE, PriceChangedError, ProductionInputError } from "./errors";
export {
  BLOCK_PRODUCTION_STAGES,
  canStartDraftsFrom,
  deriveBlockStage,
  derivePhase,
  isBusy,
  type BlockProductionStage,
  type ProductionPhase,
  type StageBlock,
  type StageTake,
} from "./stage";
export type { TakeView } from "./takes";
export type { ProductionBlock, ProductionBlockAsset } from "./views";
/*
 * The services: every current block is prepared (text-blocks, `preparation`), reviewed and
 * approved (`block-review`); then each approved block gets a cheap draft take (`drafts`), an
 * accepted draft is finished as a final take (`take-review`), and the project is done when every
 * block has an accepted final (`complete`). `read` serves the screens.
 *
 * Every function takes the acting user and returns null (or false) when the project or block is
 * missing, archived or not theirs; input the user can fix throws `ProductionInputError` with a
 * user-safe message. Damis and generations run in jobs, sent on the transaction that created
 * their row (`enqueue(..., { tx })`): the row and its job commit together or not at all. Nothing
 * is overwritten or deleted: decisions change statuses, new attempts are new takes, and a changed
 * block is a new block version. Shared checks and locks are in `access`.
 */
export { approveAllBlocks, setBlockAssets, submitBlockReview } from "./block-review";
export { completeProduction } from "./complete";
export { quoteProduction, startDrafts, type ProductionQuote } from "./drafts";
export {
  DEFAULT_BLOCK_PAGE_SIZE,
  MAX_BLOCK_ASSETS,
  MAX_BLOCK_PAGE_SIZE,
  MAX_REVIEW_NOTE_LENGTH,
} from "./inputs";
export { notFinalMessage } from "./messages";
export { ensurePrepared, reopenProductionAfterScriptEdit, retryPreparation } from "./preparation";
export {
  getBlockDetail,
  getProductionOverview,
  listProductionBlocks,
  type BlockDetail,
  type ProductionOverview,
} from "./read";
export { retryTake, submitTakeReview } from "./take-review";
export {
  DEFAULT_CLIP_PAGE_SIZE,
  getClipDownloadUrl,
  getExport,
  listFinishedClips,
  MAX_CLIP_PAGE_SIZE,
  requestExport,
  type ExportView,
  type FinishedClip,
} from "./exports";
export { clipDownloadName, exportDownloadName, fileSlug, shotsCsv } from "./names";
/** Worker only. */
export {
  applyTakeGenerationResult,
  assertTakeBlockUsable,
  blockReviserInput,
  dispatchProductionJobs,
  failPreparation,
  failTake,
  loadPreparationJob,
  loadTakeJob,
  promptForChosenAssets,
  promptTail,
  requestTakeGeneration,
  storePreparation,
  storeTakePrompt,
  takeFixerInput,
  TAKE_FAILED,
  textBlocksInput,
  tooManyAssetsMessage,
  type PreparationJob,
  type TakeJob,
} from "./jobs";
export { buildExport, EXPORT_CHANGED, EXPORT_TOO_LARGE, failExport } from "./exports";
