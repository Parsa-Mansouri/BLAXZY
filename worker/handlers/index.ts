import type { JobHandler } from "../../src/server/jobs";
import { scriptCheckHandler } from "./script-check";
import { scriptDetectAssetsHandler } from "./script-detect-assets";
import { scriptReviseHandler } from "./script-revise";
import { scriptSectionHandler } from "./script-section";
import { scriptWriteHandler } from "./script-write";
import { generationRunHandler } from "./generation-run";
import { systemPingHandler } from "./system-ping";

/** Every job handler this worker runs. Add new handlers here. */
export const handlers: JobHandler[] = [
  systemPingHandler,
  scriptWriteHandler,
  scriptCheckHandler,
  scriptReviseHandler,
  scriptDetectAssetsHandler,
  scriptSectionHandler,
  generationRunHandler,
];
