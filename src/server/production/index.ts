/**
 * Production (Output_04), contract in `docs/M4_CONTRACTS.md`. Owns `block_take` and
 * `export_bundle`; block versions go through `@/server/blocks`, assets through `@/server/assets`.
 * The services take the acting user and check ownership; the job surface is for the worker.
 */
export { ProductionInputError } from "./errors";
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
export {
  approveAllBlocks,
  completeProduction,
  DEFAULT_BLOCK_PAGE_SIZE,
  ensurePrepared,
  getBlockDetail,
  getProductionOverview,
  listProductionBlocks,
  MAX_BLOCK_ASSETS,
  MAX_BLOCK_PAGE_SIZE,
  MAX_REVIEW_NOTE_LENGTH,
  quoteProduction,
  retryPreparation,
  retryTake,
  setBlockAssets,
  startDrafts,
  submitBlockReview,
  submitTakeReview,
  type BlockDetail,
  type ProductionOverview,
  type ProductionQuote,
} from "./service";
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
  failPreparation,
  failTake,
  loadPreparationJob,
  loadTakeJob,
  promptForChosenAssets,
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
