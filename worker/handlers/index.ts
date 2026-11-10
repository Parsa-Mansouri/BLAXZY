import type { JobHandler } from "../../src/server/jobs";
import { systemPingHandler } from "./system-ping";

/** Every job handler this worker runs. Add new handlers here. */
export const handlers: JobHandler[] = [systemPingHandler];
