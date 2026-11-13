/**
 * Prompt blocks (Output_022): the script cut into generation units, versioned by lineage.
 * `replaceBlocks`, `markBlocksStale`, `hasCurrentBlocksFor`, `setSectioningState` and
 * `rewriteAssetRefs` (asset merges) are for other services and job handlers; the rest take the
 * acting user and check ownership.
 */
export { BlocksInputError, type PromptBlock } from "./common";
export { DEFAULT_BLOCK_PAGE_SIZE, listBlocks, MAX_BLOCK_PAGE_SIZE } from "./list";
export {
  hasCurrentBlocksFor,
  markBlocksStale,
  replaceBlocks,
  type ReplaceBlocksResult,
} from "./replace";
export { rewriteAssetRefs } from "./rewrite";
export {
  getSectioningStatus,
  readSectioningRecord,
  retrySectioning,
  SECTIONING_STATES,
  setSectioningState,
  type SectioningRecord,
  type SectioningState,
  type SectioningStatus,
} from "./sectioning";
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
