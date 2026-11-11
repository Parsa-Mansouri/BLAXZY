import type { JobHandler } from "../../src/server/jobs";
import { assetLookFixHandler, assetLookGenerateHandler } from "./asset-look";
import { assetSheetFixHandler, assetSheetGenerateHandler } from "./asset-sheet";
import { generationRunHandler } from "./generation-run";
import { scriptCheckHandler } from "./script-check";
import { scriptDetectAssetsHandler } from "./script-detect-assets";
import { scriptReviseHandler } from "./script-revise";
import { scriptSectionHandler } from "./script-section";
import { scriptWriteHandler } from "./script-write";
import { systemPingHandler } from "./system-ping";

export { assetGenerationHook } from "./asset-generation-hook";

/** Every job handler this worker runs. Add new handlers here. */
export const handlers: JobHandler[] = [
  systemPingHandler,
  scriptWriteHandler,
  scriptCheckHandler,
  scriptReviseHandler,
  scriptDetectAssetsHandler,
  scriptSectionHandler,
  generationRunHandler,
  assetLookGenerateHandler,
  assetLookFixHandler,
  assetSheetGenerateHandler,
  assetSheetFixHandler,
];
