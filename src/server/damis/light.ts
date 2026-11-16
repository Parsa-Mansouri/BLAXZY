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
export { AI_DECIDES, MAX_DESIGN_REFERENCES } from "./shared/designer";
export {
  DESIGNER_CATALOGS,
  DESIGNER_DAMI_KEYS,
  designerFor,
  designerQuestions,
  REFERENCE_ROLES,
  type DesignerKey,
  type GuidedQuestion,
  type QuestionContext,
  type ReferenceRoleChoice,
} from "./designers";
