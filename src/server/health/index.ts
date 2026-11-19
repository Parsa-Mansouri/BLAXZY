/** Health checks for probes. Route handlers call this service, never the database directly. */
export { isDatabaseHealthy } from "@/server/db/health";
export {
  isWorkerAlive,
  newWorkerInstance,
  pruneHeartbeats,
  recordHeartbeat,
  removeHeartbeat,
  startHeartbeat,
  type WorkerInstance,
} from "./heartbeat";
export {
  checkReadiness,
  raiseRateLimitedAlert,
  withTimeout,
  type CheckState,
  type Readiness,
  type WorkerState,
} from "./readiness";
