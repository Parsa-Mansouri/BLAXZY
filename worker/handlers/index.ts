import type { GenerationFinishedHandler } from "../../src/server/generation";
import type { JobHandler, JobSchedule } from "../../src/server/jobs";
import { assetGenerationHook } from "./asset-generation-hook";
import { assetLookFixHandler, assetLookGenerateHandler } from "./asset-look";
import { assetSheetFixHandler, assetSheetGenerateHandler } from "./asset-sheet";
import { generationRunHandler } from "./generation-run";
import { generationSweepHandler, generationSweepSchedule } from "./generation-sweep";
import { exportBuildHandler } from "./production-export";
import { productionGenerationHook } from "./production-generation-hook";
import { blockReviseHandler, productionPrepareHandler } from "./production-prepare";
import { takeFixHandler, takeGenerateHandler } from "./production-take";
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
export const schedules: JobSchedule[] = [generationSweepSchedule];

/** Every job handler this worker runs. Add new handlers here. */
export const handlers: JobHandler[] = [
  systemPingHandler,
  scriptWriteHandler,
  scriptWriteSegmentHandler,
  scriptEnhanceHandler,
  scriptCheckHandler,
  scriptReviseHandler,
  scriptDetectAssetsHandler,
  scriptSectionHandler,
  generationRunHandler,
  generationSweepHandler,
  assetLookGenerateHandler,
  assetLookFixHandler,
  assetSheetGenerateHandler,
  assetSheetFixHandler,
  productionPrepareHandler,
  blockReviseHandler,
  takeGenerateHandler,
  takeFixHandler,
  exportBuildHandler,
];
