/**
 * Assets (Output_021) and pre-production (Output_030). `applyDetection`, `hasDetectionFor`,
 * `getKnownAssets`, `getSectionerAssets` and the job surface (`loadLookJob` ... `applyGenerationResult`)
 * are for job handlers and the worker; the rest take the acting user and check ownership.
 */
export {
  applyDetection,
  AssetInputError,
  countAssetsByKind,
  DEFAULT_ASSET_PAGE_SIZE,
  getKnownAssets,
  getSectionerAssets,
  hasDetectionFor,
  listAssets,
  MAX_ASSET_PAGE_SIZE,
  type Asset,
} from "./service";
export {
  ASSET_STAGES,
  deriveAssetStage,
  deriveAssetState,
  stageNeedsUser,
  type AssetStage,
  type AssetState,
} from "./stage";
export type { LookView, SheetView } from "./looks";
export {
  DEFAULT_FINISHED_PAGE_SIZE,
  finishedFeedCursorNow,
  listFinishedAssetEvents,
  MAX_FINISHED_PAGE_SIZE,
  parseFinishedCursor,
  type FinishedAssetEvent,
  type FinishedFeedPage,
} from "./finished-feed";
export {
  addAsset,
  completePreProduction,
  DEFAULT_CARD_PAGE_SIZE,
  getAssetDetail,
  getPreProductionOverview,
  listAssetCards,
  MAX_ASSET_DESCRIPTION_LENGTH,
  MAX_ASSET_NAME_LENGTH,
  MAX_CARD_PAGE_SIZE,
  MAX_GUIDED_ANSWER_LENGTH,
  MAX_LOOK_PROMPT_LENGTH,
  MAX_REVIEW_NOTE_LENGTH,
  mergeAssets,
  nextAssetNeedingInput,
  removeAsset,
  replaceLook,
  retryLook,
  retrySheet,
  startLookFromGuided,
  startLookFromPrompt,
  startLookFromUpload,
  submitLookReview,
  submitSheetReview,
  updateAsset,
  validateGuidedAnswers,
  type AssetCard,
  type AssetDetail,
  type NextAsset,
  type PreProductionOverview,
} from "./preproduction";
/** For `@/server/production`: assets as block references (no ownership checks). */
export {
  describeAssetRefs,
  describeAssetsById,
  listReadyReferenceAssets,
  parseAssetRef,
  type ReferenceAsset,
} from "./references";
/** Worker only. */
export {
  applyGenerationResult,
  failLook,
  failSheet,
  loadLookJob,
  loadSheetJob,
  requestLookGeneration,
  requestSheetGeneration,
  storeLookPrompt,
  storeSheetPrompt,
  type AssetJobReview,
  type LookJobContext,
  type SheetJobContext,
} from "./jobs";
