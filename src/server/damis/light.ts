/**
 * Light entry point for pages and client-adjacent server code: only what the screens need to
 * render menus and notes, with no runner, no sample client, no prompt text and no dami
 * definitions. Import from "@/server/damis/light" instead of "@/server/damis" when that is all
 * you need, so the web bundle does not pull in the dami framework.
 */
export { getDamiMode, resolveDamiMode, SAMPLE_MODEL, type DamiMode } from "./framework/mode";
export {
  AUTO_VALUE,
  buildFixRequests,
  findReviewOption,
  fixRequestCodes,
  getReviewCatalog,
  REVIEW_CATALOG_KEYS,
  REVIEW_OPTION_KINDS,
  ReviewCatalogError,
  visibleOptions,
  type FixRequest,
  type FixSelection,
  type FollowupChoice,
  type FollowupStep,
  type ReviewCatalog,
  type ReviewCatalogKey,
  type ReviewCondition,
  type ReviewFollowup,
  type ReviewGroup,
  type ReviewOption,
  type ReviewOptionKind,
  type ReviewSector,
} from "./shared/review-catalog";
export {
  BLOCK_ISSUES,
  BLOCK_ISSUE_CODES,
  BLOCK_ISSUE_LIST,
  type BlockIssueCode,
  type BlockIssueDefinition,
} from "./block-reviser/issues";
export {
  TAKE_ISSUES,
  TAKE_ISSUE_CODES,
  TAKE_ISSUE_LIST,
  type TakeIssueCode,
  type TakeIssueDefinition,
} from "./take-fixer/issues";
export {
  isWriterReasonCode,
  issueTypeFor,
  writerReason,
  WRITER_PREFERENCE_REASONS,
  WRITER_REASON_CODES,
  WRITER_REASONS,
  WRITER_TECHNICAL_REASONS,
  type WriterReason,
  type WriterReasonCode,
} from "./script-writer/reasons";
export { AI_DECIDES, MAX_DESIGN_REFERENCES } from "./shared/designer";
export {
  DESIGNER_CATALOGS,
  DESIGNER_DAMI_KEYS,
  designerFor,
  designerQuestions,
  LOOK_FRAMES,
  REFERENCE_CONFLICTS,
  REFERENCE_ROLES,
  type DesignerKey,
  type GuidedQuestion,
  type QuestionContext,
  type ReferenceRoleChoice,
} from "./designers";
