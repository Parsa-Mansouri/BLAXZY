/**
 * Public API of the dami framework and the damis. Import from "@/server/damis" only.
 * Nothing here touches Claude or the database at import time.
 */
import { assetDetector } from "./asset-detector/dami";
import { characterGenerator } from "./character-generator/dami";
import { creativeDna } from "./creative-dna/dami";
import { locationGenerator } from "./location-generator/dami";
import { projectNamer } from "./project-namer/dami";
import { propGenerator } from "./prop-generator/dami";
import type { AnyDami } from "./framework/define";
import { scriptChecker } from "./script-checker/dami";
import { scriptReviser } from "./script-reviser/dami";
import { enhancer } from "./enhancer/dami";
import { scriptOutliner, scriptWriter } from "./script-writer/dami";
import { sheetGeneratorCharacter } from "./sheet-generator-character/dami";
import { sheetGeneratorLocation } from "./sheet-generator-location/dami";
import { sheetGeneratorProp } from "./sheet-generator-prop/dami";
import { director, directorPlan } from "./director/dami";
import { blockRevision } from "./block-revision/dami";
import { filmDirector, filmDirectorCard } from "./film-director/dami";
import { cinematographer } from "./cinematographer/dami";
import { videoReview } from "./video-review/dami";

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
export { scriptWriter, scriptOutliner, enhancer, assetDetector, scriptChecker, scriptReviser };
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
export { imageToken, IMAGE_TOKEN_PATTERN, MAX_REFERENCE_IMAGES } from "./shared/block";

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
  [characterGenerator.key]: characterGenerator,
  [locationGenerator.key]: locationGenerator,
  [propGenerator.key]: propGenerator,
  [sheetGeneratorCharacter.key]: sheetGeneratorCharacter,
  [sheetGeneratorLocation.key]: sheetGeneratorLocation,
  [sheetGeneratorProp.key]: sheetGeneratorProp,
  [director.key]: director,
  [directorPlan.key]: directorPlan,
  [blockRevision.key]: blockRevision,
  [videoReview.key]: videoReview,
  [filmDirector.key]: filmDirector,
  [filmDirectorCard.key]: filmDirectorCard,
  [cinematographer.key]: cinematographer,
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
  freeTextCode,
  freeTextFixRequest,
  getReviewCatalog,
  noteOutsideRequests,
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

// Director (owner v1.4, wired: `script.direct`) and Block Revision (owner v1.5, wired: `block.revise`)
export { director, directorPlan, DIRECTOR_VERSION, DIRECTOR_OWNER_VERSION } from "./director/dami";
export {
  assetRegistrySchema,
  blockSchema,
  platformConfigSchema,
  defaultPlatformConfig,
  continuityBibleSchema,
  directorInputSchema,
  directorOutputSchema,
  directorPlanInputSchema,
  directorPlanOutputSchema,
  isBlocked,
  parseBlockRange,
  planBlockSchema,
  registryAssetIds,
  shotSchema,
  stagingSchema,
  storedBlockSchema,
  storedContinuityBibleSchema,
  storedDirectorPlanOutputSchema,
  storedPlanBlockSchema,
  upgradeStoredBlock,
  HEARD_AS,
  BLOCK_MODES,
  DIRECTOR_MODES,
  type AssetRegistry,
  type Block as DirectorBlock,
  type PlatformConfigInput,
  type BlockMode,
  type ContinuityBible,
  type DirectorInput,
  type DirectorMode,
  type DirectorOutput,
  type DirectorPlanInput,
  type DirectorPlanOutput,
  type HeardAs,
  type PlanBlock,
  type Shot,
  type Staging,
} from "./director/schema";
export { checkDirector, checkDirectorPlan } from "./director/validate";

// Craft pipeline (not wired yet): FILM DIRECTOR (shot plan, Director Style Cards) and
// CINEMATOGRAPHER (the owner's six DP cards, modes look and scene)
export {
  filmDirector,
  filmDirectorCard,
  FILM_DIRECTOR_MAX_OUTPUT_TOKENS,
  FILM_DIRECTOR_OWNER_VERSION,
  FILM_DIRECTOR_VERSION,
} from "./film-director/dami";
export {
  beatSchema,
  filmDirectorCardInputSchema,
  filmDirectorCardOutputSchema,
  filmDirectorInputSchema,
  filmShotSchema,
  sceneGeographySchema,
  shotCameraSchema,
  shotPlanSchema,
  shotPropSchema,
  shotStagingSchema,
  FILM_DIRECTOR_BLOCK_MODES,
  FRAME_DEPTHS,
  FRAME_POSITIONS,
  type Beat,
  type FilmDirectorBlockMode,
  type FilmDirectorCardInput,
  type FilmDirectorCardOutput,
  type FilmDirectorInput,
  type FilmShot,
  type SceneGeography,
  type ShotCamera,
  type ShotPlan,
  type ShotProp,
  type ShotStaging,
} from "./film-director/schema";
export { checkShotPlan, checkStyleCard, MAX_SHOT_SECONDS } from "./film-director/validate";
export {
  DIRECTOR_STYLE_IDS,
  DIRECTOR_STYLES,
  directorStyle,
  directorStyleCard,
  isDirectorStyleId,
  type DirectorStyle,
  type DirectorStyleId,
} from "./film-director/styles";
export { cinematographer, CINEMATOGRAPHER_VERSION } from "./cinematographer/dami";
export {
  CINEMATOGRAPHER_IDS,
  CINEMATOGRAPHER_MODE_IDS,
  CINEMATOGRAPHERS,
  cinematographerCard,
  isCardMode,
  isCinematographerId,
  type Cinematographer,
  type CinematographerId,
  type CinematographerMode,
  type CinematographerModeId,
} from "./cinematographer/library";
export {
  cinematographerBible,
  cinematographerBibleSchema,
  cinematographerInputSchema,
  cinematographerOutputSchema,
  lookInputSchema,
  lookSchema,
  sceneInputSchema,
  sceneShotsFor,
  sceneVisualSchema,
  stagingSummary,
  type CinematographerBible,
  type CinematographerInput,
  type CinematographerOutput,
  type CinematographerResult,
  type Look,
  type LookInput,
  type LookSceneInput,
  type SceneInput,
  type SceneShotInput,
  type SceneVisual,
} from "./cinematographer/schema";
export { stubCreativeBible } from "./director/stub";
export { blockExcerpts } from "./director/excerpts";
export { creativeBibleShape } from "./creative-dna/schema";
export { WORDS_PER_MINUTE } from "./shared/style";
export {
  bindAssetTokens,
  bindingMap,
  buildAssetIds,
  tagAssetIds,
  idPrefixForKind,
  type AssetBinding,
  type AssetIdEntry,
  type BoundPrompt,
} from "./director/binding";
export {
  blockRevision,
  blockRevisionModel,
  blockRevisionRunContext,
  BLOCK_REVISION_VERSION,
  BLOCK_REVISION_OWNER_VERSION,
} from "./block-revision/dami";
export {
  blockRevisionInputSchema,
  blockRevisionOutputSchema,
  type BlockRevisionInput,
  type BlockRevisionOutput,
  type ReviewIssue as BlockRevisionIssue,
  type TimedNote,
} from "./block-revision/schema";
export { checkBlockRevision } from "./block-revision/validate";
// Video Review (the owner's VIDEO_REVIEW v1.0), run by the take.review job; the router is `production/router.ts`
export {
  checkVideoReview,
  ROUTE_FOR_CAUSE,
  videoReview,
  VIDEO_REVIEW_VERSION,
} from "./video-review/dami";
export { PREV_END_LABEL, sheetLabel } from "./video-review/prompt";
export {
  ISSUE_CAUSES,
  ISSUE_KINDS,
  ISSUE_ROUTES,
  ISSUE_SEVERITIES,
  videoReviewInputSchema,
  videoReviewOutputSchema,
  type IssueCause,
  type IssueKind,
  type IssueRoute,
  type KeepCandidate,
  type ReferenceBindingEntry,
  type ReviewBlock,
  type ReviewFrame,
  type ReviewIssue,
  type VideoReviewInput,
  type VideoReviewOutput,
} from "./video-review/schema";
