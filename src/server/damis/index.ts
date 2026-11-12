/**
 * Public API of the dami framework and the damis. Import from "@/server/damis" only.
 * Nothing here touches Claude or the database at import time.
 */
import { assetDetector } from "./asset-detector/dami";
import { assetFixer } from "./asset-fixer/dami";
import { blockReviser } from "./block-reviser/dami";
import { assetPromptWriter } from "./asset-prompt-writer/dami";
import type { AnyDami } from "./framework/define";
import { promptSectioner } from "./prompt-sectioner/dami";
import { scriptChecker } from "./script-checker/dami";
import { scriptReviser } from "./script-reviser/dami";
import { enhancer } from "./enhancer/dami";
import { scriptOutliner, scriptWriter } from "./script-writer/dami";
import { sheetFixer } from "./sheet-fixer/dami";
import { sheetGenerator } from "./sheet-generator/dami";
import { takeFixer } from "./take-fixer/dami";
import { textBlocks } from "./text-blocks/dami";

// Framework
export { defineDami, isPromptImage, partText } from "./framework/define";
export type {
  AnyDami,
  DamiConfig,
  DamiDefinition,
  DamiEffort,
  DamiInput,
  DamiMessage,
  DamiPrompt,
  DamiResult,
  PromptImage,
  PromptPart,
  PromptText,
} from "./framework/define";
export { MAX_IMAGE_EDGE_PX, prepareImageBytes } from "./framework/images";
export type { ImageResolver, ResolvedImage } from "./framework/images";
export { runDami } from "./framework/runner";
export type {
  DamiRunContext,
  DamiRunnerDeps,
  DamiRunResult,
  DamiRuntimeConfig,
} from "./framework/runner";
export {
  DamiApiError,
  DamiConfigError,
  DamiError,
  DamiInputError,
  DamiOutputError,
  DamiRefusalError,
  DamiTruncatedError,
  type DamiErrorCode,
} from "./framework/errors";
export type { ClaudeClient, ClaudeRequest, ClaudeResponse } from "./framework/client";
export type { DamiRunStore, DamiRunStart, DamiRunFinish } from "./framework/store";
export { Semaphore } from "./framework/concurrency";
export { getDamiMode, resolveDamiMode, SAMPLE_MODEL, type DamiMode } from "./framework/mode";
export { createSampleClaudeClient, SAMPLE_GENERATORS } from "./sample/client";
export { CLAUDE_MODELS, FRAMEWORK_DEFAULT_MODEL } from "./framework/models";
export {
  MODEL_PRICING,
  computeCostUsd,
  type ModelPricing,
  type TokenUsage,
} from "./framework/pricing";

// Prompt modules
export {
  GENRE_MODULES,
  STYLE_MODULES,
  composeModules,
  resolveGenreModule,
  resolveStyleModule,
} from "./modules/registry";
export type { DamiTask, PromptModule } from "./modules/types";
export { projectStyleSchema, planDuration, type DurationPlan } from "./shared/style";

// The damis
export {
  scriptWriter,
  scriptOutliner,
  enhancer,
  assetDetector,
  promptSectioner,
  scriptChecker,
  scriptReviser,
};
export {
  scriptWriterInputSchema,
  scriptWriterOutputSchema,
  scriptOutlineInputSchema,
  screenplaySchema,
  screenplaySceneSchema,
  continuityLedgerSchema,
  submitOutlineSchema,
  submitScreenplaySchema,
  type ApprovedOutline,
  type ContinuityLedger,
  type Screenplay,
  type ScreenplayScene,
  type ScriptOutlineInput,
  type ScriptWriterInput,
  type ScriptWriterOutput,
  type SubmitOutline,
  type SubmitScreenplay,
  type WriterFeedback,
  type WriterProject,
} from "./script-writer/schema";
export { REVISE_RUN_SETTINGS, writerMaxTokens } from "./script-writer/dami";
export {
  episodeCount,
  needsOutline,
  singleCallTarget,
  writerProject,
} from "./script-writer/project";
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
export {
  enhancerInputSchema,
  enhancerOutputSchema,
  OWNER_ENHANCER_GENRES,
  OWNER_ENHANCER_STYLES,
  type EnhancerInput,
  type EnhancerOutput,
} from "./enhancer/schema";
export {
  durationBudget,
  estimate,
  HARD_MAX_SECONDS,
  MAX_SEQUENCE_SECONDS,
  parseDurationText,
  runtimeCorrectionNote,
  runtimeVerdict,
  SINGLE_CALL_MAX_SECONDS,
  toleranceSeconds,
  type DurationBudget,
  type RuntimeEstimate,
  type RuntimeVerdict,
} from "./shared/duration";
export {
  flattenForDetector,
  parseStoredScreenplay,
  renderScreenplay,
  sceneHeadingText,
  sceneNumberAt,
  type DetectorScene,
  type EpisodeMarker,
  type RenderedScreenplay,
  type StoredScreenplay,
} from "./shared/screenplay";
export {
  scriptCheckerInputSchema,
  scriptCheckerOutputSchema,
  SCRIPT_ISSUE_CATEGORIES,
  SCRIPT_ISSUE_SEVERITIES,
  type ScriptCheckerInput,
  type ScriptCheckerOutput,
  type ScriptCheckIssue,
  type ScriptIssueCategory,
  type ScriptIssueSeverity,
} from "./script-checker/schema";
export {
  scriptReviserInputSchema,
  scriptReviewSchema,
  reviewCommentSchema,
  type ScriptReviserInput,
  type ScriptReviserOutput,
  type ScriptChangeSummaryItem,
  type ScriptLineEdit,
} from "./script-reviser/schema";
export {
  SCRIPT_ISSUES,
  SCRIPT_ISSUE_CODES,
  SCRIPT_ISSUE_LIST,
  type ScriptIssueCode,
  type ScriptIssueDefinition,
} from "./script-reviser/issues";
export {
  ASSET_REF_PATTERN,
  ASSET_TAG_PATTERN,
  MAX_ASSET_NAME,
  assetNameSchema,
  assetRefSchema,
  assetTag,
  assetTagPattern,
  cleanAssetName,
  formatAssetRef,
  isAssetRef,
  isCleanAssetName,
  isVoiceRef,
  nameKey,
  parseAssetRef,
  replaceAssetTag,
  taggedRefs,
  uniqueName,
  type ParsedAssetRef,
} from "./shared/asset-ref";
export {
  assetDetectorInputSchema,
  assetDetectorOutputSchema,
  type AssetDetectorInput,
  type AssetDetectorOutput,
  type DetectedAsset,
  type KnownAsset,
} from "./asset-detector/schema";
export {
  promptSectionerInputSchema,
  MAX_BLOCK_SECONDS,
  type PromptSectionerInput,
  type PromptSectionerOutput,
  type PromptBlockDraft,
  type SectionerAsset,
} from "./prompt-sectioner/schema";
export {
  sectionScript,
  sectionScriptInputSchema,
  stitchSegments,
  type SectionScriptInput,
  type SectionScriptResult,
  type SectionedBlock,
} from "./prompt-sectioner/section-script";

// Reference images and sheets (pre-production)
export { assetPromptWriter, assetFixer, sheetGenerator, sheetFixer };
export {
  assetPromptWriterInputSchema,
  assetPromptWriterOutputSchema,
  type AssetPromptWriterInput,
  type AssetPromptWriterOutput,
} from "./asset-prompt-writer/schema";
export { ASSET_QUESTIONS, type GuidedQuestion } from "./asset-prompt-writer/questions";
export {
  assetFixerInputSchema,
  assetFixerOutputSchema,
  lookIssueCodeSchema,
  lookReviewSchema,
  type AssetFixerInput,
  type AssetFixerOutput,
} from "./asset-fixer/schema";
export {
  LOOK_ISSUES,
  LOOK_ISSUE_CODES,
  LOOK_ISSUE_LIST,
  LOOK_ISSUE_KINDS,
  lookIssueFits,
  lookIssuesFor,
  type LookIssueCode,
  type LookIssueDefinition,
} from "./asset-fixer/issues";
export {
  sheetGeneratorInputSchema,
  sheetGeneratorOutputSchema,
  type SheetGeneratorInput,
  type SheetGeneratorOutput,
} from "./sheet-generator/schema";
export {
  sheetFixerInputSchema,
  sheetFixerOutputSchema,
  sheetIssueCodeSchema,
  sheetReviewSchema,
  type SheetFixerInput,
  type SheetFixerOutput,
} from "./sheet-fixer/schema";
export {
  SHEET_ISSUES,
  SHEET_ISSUE_CODES,
  SHEET_ISSUE_LIST,
  SHEET_ISSUE_KINDS,
  sheetIssueFits,
  sheetIssuesFor,
  type SheetIssueCode,
  type SheetIssueDefinition,
} from "./sheet-fixer/issues";
export {
  referenceAssetSchema,
  type ChangeSummaryItem,
  type ReferenceAsset,
} from "./shared/reference";

// Production (text-blocks, block and take review)
export { textBlocks, blockReviser, takeFixer };
export {
  textBlocksInputSchema,
  textBlocksOutputSchema,
  type TextBlocksInput,
  type TextBlocksOutput,
} from "./text-blocks/schema";
export {
  blockReviserInputSchema,
  blockReviserOutputSchema,
  blockIssueCodeSchema,
  blockReviewSchema,
  type BlockReviserInput,
  type BlockReviserOutput,
} from "./block-reviser/schema";
export {
  BLOCK_ISSUES,
  BLOCK_ISSUE_CODES,
  BLOCK_ISSUE_LIST,
  type BlockIssueCode,
  type BlockIssueDefinition,
} from "./block-reviser/issues";
export {
  takeFixerInputSchema,
  takeFixerOutputSchema,
  takeIssueCodeSchema,
  takeReviewSchema,
  TAKE_STAGES,
  type TakeFixerInput,
  type TakeFixerOutput,
} from "./take-fixer/schema";
export {
  TAKE_ISSUES,
  TAKE_ISSUE_CODES,
  TAKE_ISSUE_LIST,
  type TakeIssueCode,
  type TakeIssueDefinition,
} from "./take-fixer/issues";
export {
  blockAssetSchema,
  checkBlockPrompt,
  imageToken,
  IMAGE_TOKEN_PATTERN,
  MAX_REFERENCE_IMAGES,
  type BlockAsset,
} from "./shared/block";

/** Every dami by key (for the CLI and, later, Pro's dami picker). */
export const DAMIS: Readonly<Record<string, AnyDami>> = {
  [scriptWriter.key]: scriptWriter,
  [scriptOutliner.key]: scriptOutliner,
  [enhancer.key]: enhancer,
  [scriptChecker.key]: scriptChecker,
  [scriptReviser.key]: scriptReviser,
  [assetDetector.key]: assetDetector,
  [promptSectioner.key]: promptSectioner,
  [assetPromptWriter.key]: assetPromptWriter,
  [assetFixer.key]: assetFixer,
  [sheetGenerator.key]: sheetGenerator,
  [sheetFixer.key]: sheetFixer,
  [textBlocks.key]: textBlocks,
  [blockReviser.key]: blockReviser,
  [takeFixer.key]: takeFixer,
};

// Review catalogs (the owner's complaint menus)
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
