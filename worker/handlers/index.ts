import type { GenerationFinishedHandler } from "../../src/server/generation";
import type { JobHandler, JobSchedule } from "../../src/server/jobs";
import { assetDetectFixHandler } from "./asset-detect-fix";
import { assetGenerationHook } from "./asset-generation-hook";
import { assetLookFixHandler, assetLookGenerateHandler } from "./asset-look";
import { assetSheetFixHandler, assetSheetGenerateHandler } from "./asset-sheet";
import {
  assetSheetAssembleHandler,
  assetSheetPlanHandler,
  assetSheetViewsAdvanceHandler,
} from "./asset-sheet-pack";
import { generationRunHandler } from "./generation-run";
import { generationSweepHandler, generationSweepSchedule } from "./generation-sweep";
import {
  damiSweepHandler,
  damiSweepSchedule,
  fileSweepHandler,
  fileSweepSchedule,
} from "./maintenance-sweeps";
import { productionDispatchHandler } from "./production-dispatch";
import { exportBuildHandler } from "./production-export";
import { productionGenerationHook } from "./production-generation-hook";
import { blockReviseHandler, productionPrepareHandler } from "./production-prepare";
import { takeFixHandler, takeGenerateHandler } from "./production-take";
import { projectCreativeDnaHandler } from "./project-creative-dna";
import { ratelimitPruneHandler, ratelimitPruneSchedule } from "./ratelimit-prune";
import { scriptCheckHandler } from "./script-check";
import { scriptDetectAssetsHandler } from "./script-detect-assets";
import { scriptEnhanceHandler } from "./script-enhance";
import { scriptReviseHandler } from "./script-revise";
import { scriptSectionHandler } from "./script-section";
import { scriptWriteHandler } from "./script-write";
import { scriptWriteSegmentHandler } from "./script-write-segment";
import { systemPingHandler } from "./system-ping";

export { assetGenerationHook, productionGenerationHook };

/** Generation completion hooks, registered once per process (worker, `dev:sweep`). */
export const generationHooks: GenerationFinishedHandler[] = [
  assetGenerationHook,
  productionGenerationHook,
];

/** Recurring jobs (one schedule per job type for the whole fleet). */
export const schedules: JobSchedule[] = [
  generationSweepSchedule,
  damiSweepSchedule,
  fileSweepSchedule,
  ratelimitPruneSchedule,
];

/** Every job handler this worker runs. Add new handlers here. */
export const handlers: JobHandler[] = [
  systemPingHandler,
  projectCreativeDnaHandler,
  scriptWriteHandler,
  scriptWriteSegmentHandler,
  scriptEnhanceHandler,
  scriptCheckHandler,
  scriptReviseHandler,
  scriptDetectAssetsHandler,
  scriptSectionHandler,
  assetDetectFixHandler,
  generationRunHandler,
  generationSweepHandler,
  damiSweepHandler,
  fileSweepHandler,
  ratelimitPruneHandler,
  assetLookGenerateHandler,
  assetLookFixHandler,
  assetSheetGenerateHandler,
  assetSheetFixHandler,
  assetSheetPlanHandler,
  assetSheetViewsAdvanceHandler,
  assetSheetAssembleHandler,
  productionPrepareHandler,
  blockReviseHandler,
  takeGenerateHandler,
  takeFixHandler,
  exportBuildHandler,
  productionDispatchHandler,
];
