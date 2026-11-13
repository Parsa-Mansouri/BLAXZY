/**
 * Prompt blocks (Output_022): the script cut into generation units, versioned by lineage.
 * `replaceBlocks`, `markBlocksStale`, `hasCurrentBlocksFor`, `setSectioningState` and
 * `rewriteAssetRefs` (asset merges) are for other services and job handlers; the rest take the
 * acting user and check ownership.
 */
export {
  BlocksInputError,
  excerptSimilarity,
  DEFAULT_BLOCK_PAGE_SIZE,
  getSectioningStatus,
  hasCurrentBlocksFor,
  listBlocks,
  markBlocksStale,
  MAX_BLOCK_PAGE_SIZE,
  normalizeExcerpt,
  readSectioningRecord,
  replaceBlocks,
  retrySectioning,
  rewriteAssetRefs,
  SECTIONING_STATES,
  setSectioningState,
  type PromptBlock,
  type ReplaceBlocksResult,
  type SectioningRecord,
  type SectioningState,
  type SectioningStatus,
} from "./service";
/** For `@/server/production` and its job handlers (no ownership checks). */
export {
  approveBlocks,
  claimBlocksForPreparation,
  createNextBlockVersion,
  failBlockPreparation,
  getBlockVersion,
  getCurrentBlock,
  getCurrentBlocks,
  getPreviousCurrentBlock,
  getPreviousVersion,
  listCurrentBlockStates,
  listScriptResetBlocks,
  MAX_PRODUCTION_BLOCKS,
  pageCurrentBlocks,
  restartBlockPreparation,
  storeBlockPreparation,
  type BlockStateRow,
} from "./production";
