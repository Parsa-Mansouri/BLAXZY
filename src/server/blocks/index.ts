/**
 * Prompt blocks (Output_022): the script cut into generation units, versioned by lineage.
 * `replaceBlocks`, `markBlocksStale`, `hasCurrentBlocksFor` and `setSectioningState` are for the
 * script services and job handlers; the rest take the acting user and check ownership.
 */
export {
  BlocksInputError,
  DEFAULT_BLOCK_PAGE_SIZE,
  getSectioningStatus,
  hasCurrentBlocksFor,
  listBlocks,
  markBlocksStale,
  MAX_BLOCK_PAGE_SIZE,
  normalizeExcerpt,
  readSectioningRecord,
  replaceBlocks,
  SECTIONING_STATES,
  setSectioningState,
  type PromptBlock,
  type SectioningRecord,
  type SectioningState,
  type SectioningStatus,
} from "./service";
