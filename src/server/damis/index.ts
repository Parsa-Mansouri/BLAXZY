/**
 * Public API of the dami framework and the damis. Import from "@/server/damis" only.
 * Nothing here touches Claude or the database at import time.
 */
import { assetDetector } from "./asset-detector/dami";
import type { AnyDami } from "./framework/define";
import { promptSectioner } from "./prompt-sectioner/dami";
import { scriptChecker } from "./script-checker/dami";
import { scriptReviser } from "./script-reviser/dami";
import { scriptWriter } from "./script-writer/dami";

// Framework
export { defineDami } from "./framework/define";
export type {
  AnyDami,
  DamiConfig,
  DamiDefinition,
  DamiEffort,
  DamiInput,
  DamiMessage,
  DamiPrompt,
  DamiResult,
  PromptText,
} from "./framework/define";
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
export { scriptWriter, assetDetector, promptSectioner, scriptChecker, scriptReviser };
export {
  scriptWriterInputSchema,
  scriptWriterOutputSchema,
  type ScriptWriterInput,
  type ScriptWriterOutput,
} from "./script-writer/schema";
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
  assetDetectorInputSchema,
  assetDetectorOutputSchema,
  ASSET_SLUG_PATTERN,
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

/** Every dami by key (for the CLI and, later, Pro's dami picker). */
export const DAMIS: Readonly<Record<string, AnyDami>> = {
  [scriptWriter.key]: scriptWriter,
  [scriptChecker.key]: scriptChecker,
  [scriptReviser.key]: scriptReviser,
  [assetDetector.key]: assetDetector,
  [promptSectioner.key]: promptSectioner,
};
