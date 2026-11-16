/**
 * Public API of the dami framework and the damis. Import from "@/server/damis" only.
 * Nothing here touches Claude or the database at import time.
 */
import { assetDetector } from "./asset-detector/dami";
import { characterGenerator } from "./character-generator/dami";
import { creativeDna } from "./creative-dna/dami";
import { blockReviser } from "./block-reviser/dami";
import { locationGenerator } from "./location-generator/dami";
import { projectNamer } from "./project-namer/dami";
import { propGenerator } from "./prop-generator/dami";
import type { AnyDami } from "./framework/define";
import { promptSectioner } from "./prompt-sectioner/dami";
import { scriptChecker } from "./script-checker/dami";
import { scriptReviser } from "./script-reviser/dami";
import { enhancer } from "./enhancer/dami";
import { scriptOutliner, scriptWriter } from "./script-writer/dami";
import { sheetGeneratorCharacter } from "./sheet-generator-character/dami";
import { sheetGeneratorLocation } from "./sheet-generator-location/dami";
import { sheetGeneratorProp } from "./sheet-generator-prop/dami";
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
  DamiAbortedError,
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
export { DEFAULT_STUCK_AFTER_MINUTES, sweepStuckDamiRuns } from "./framework/sweep";
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
  CHARACTER_KINDS,
  DETECTOR_MODES,
  type AssetDetectorInput,
  type AssetDetectorOutput,
  type DetectedCharacter,
  type DetectedLocation,
  type DetectedProp,
  type DetectorFact,
  type DetectorFixRequest,
  type DetectorMode,
  type KnownAsset,
  type SceneIndexEntry,
} from "./asset-detector/schema";
export { checkDetection, detectorScriptText } from "./asset-detector/dami";
export { containsQuote, normalizeQuoteText } from "./shared/quotes";
export { isSceneHeading } from "./shared/script-lines";
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

// Designers (pre-production): character, location and prop generators
export { characterGenerator, locationGenerator, propGenerator };
export {
  CHARACTER_DETAIL_FIELDS,
  CHARACTER_REFERENCE_ROLES,
  characterGeneratorInputSchema,
  characterGeneratorOutputSchema,
  type CharacterDetailField,
  type CharacterGeneratorInput,
  type CharacterGeneratorOutput,
} from "./character-generator/schema";
export {
  LOCATION_REFERENCE_ROLES,
  locationGeneratorInputSchema,
  locationGeneratorOutputSchema,
  type LocationGeneratorInput,
  type LocationGeneratorOutput,
} from "./location-generator/schema";
export { LOCATION_FIX_EFFORT, isLocationFix } from "./location-generator/dami";
export {
  PROP_ADVANCED_FIELDS,
  PROP_REFERENCE_ROLES,
  propGeneratorInputSchema,
  propGeneratorOutputSchema,
  type PropAdvancedField,
  type PropGeneratorInput,
  type PropGeneratorOutput,
} from "./prop-generator/schema";
export { PROP_FIX_EFFORT, isPropFix, notAProp } from "./prop-generator/dami";
export { ADVANCED_PREFIX } from "./prop-generator/questions";
export {
  AI_DECIDES,
  designerProject,
  MAX_DESIGN_REFERENCES,
  type DesignerFixRequest,
  type DesignerProject,
  type DesignerScene,
  type DesignerScript,
} from "./shared/designer";
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

// Sheet makers (pre-production): the character sheet, the location pack and the prop sheet
export { sheetGeneratorCharacter, sheetGeneratorLocation, sheetGeneratorProp };
export {
  CHARACTER_SHEET_REFERENCE_ROLES,
  characterSheetInputSchema,
  characterSheetOutputSchema,
  DESIGN_CHANGE_PREFIX,
  designChangeRequests,
  type CharacterSheetInput,
  type CharacterSheetOutput,
  type DetailCell,
} from "./sheet-generator-character/schema";
export { CHARACTER_SHEET_EDIT_CODES } from "./sheet-generator-character/edit-eligible";
export {
  locationSheetInputSchema,
  locationSheetOutputSchema,
  type LocationSheetFixRequest,
  type LocationSheetInput,
  type LocationSheetOutput,
  type LocationSheetView,
} from "./sheet-generator-location/schema";
export {
  isReverseView,
  LOCATION_HERO_VIEWS,
  MAX_VIEW_REFERENCES,
} from "./sheet-generator-location/dami";
export {
  PROP_REVIEW_FOCUS,
  propSheetInputSchema,
  propSheetOutputSchema,
  type PropScaleCard,
  type PropSheetFixRequest,
  type PropSheetInput,
  type PropSheetOutput,
  type PropSheetView,
} from "./sheet-generator-prop/schema";
export {
  MAX_PROP_VIEW_REFERENCES,
  minimumPropLevel,
  nonDefaultStates,
  PROP_LEVEL_MAX_IMAGES,
} from "./sheet-generator-prop/dami";
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
  [creativeDna.key]: creativeDna,
  [projectNamer.key]: projectNamer,
  [scriptWriter.key]: scriptWriter,
  [scriptOutliner.key]: scriptOutliner,
  [enhancer.key]: enhancer,
  [scriptChecker.key]: scriptChecker,
  [scriptReviser.key]: scriptReviser,
  [assetDetector.key]: assetDetector,
  [promptSectioner.key]: promptSectioner,
  [characterGenerator.key]: characterGenerator,
  [locationGenerator.key]: locationGenerator,
  [propGenerator.key]: propGenerator,
  [sheetGeneratorCharacter.key]: sheetGeneratorCharacter,
  [sheetGeneratorLocation.key]: sheetGeneratorLocation,
  [sheetGeneratorProp.key]: sheetGeneratorProp,
  [textBlocks.key]: textBlocks,
  [blockReviser.key]: blockReviser,
  [takeFixer.key]: takeFixer,
};

// Creative DNA (DAMI-00): the per-project Creative Bible and what later damis read from it
export { creativeDna, checkCreativeBible, CREATIVE_DNA_VERSION } from "./creative-dna/dami";
export {
  creativeBibleSchema,
  creativeDnaInputSchema,
  REVIEW_POINTS,
  type CreativeBible,
  type CreativeDnaInput,
  type CreativeReviewOption,
  type CreativeRule,
  type ReviewPoint,
} from "./creative-dna/schema";
export { creativeBibleKey, creativeDnaInputFromStyle } from "./creative-dna/input";
export {
  CREATIVE_REGISTRY,
  getCreativeModule,
  registryIdsForStyle,
  type CreativeModule,
  type CreativeModuleIds,
} from "./creative-dna/registry";
export {
  CREATIVE_CONSUMERS,
  getReviewOptions,
  QC_STAGE,
  renderCreativeDna,
  type CreativeConsumer,
} from "./shared/creative-context";
export { PLATFORM_CONFIG } from "./shared/platform";

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

// Project namer: the automatic title of a project
export { projectNamer, checkProjectName, PROJECT_NAMER_VERSION } from "./project-namer/dami";
export {
  NAME_MAX_CHARS,
  NAME_STORY_MAX_CHARS,
  projectNamerInputSchema,
  projectNamerOutputSchema,
  storyExcerpt,
  type ProjectNamerInput,
  type ProjectNamerOutput,
} from "./project-namer/schema";
