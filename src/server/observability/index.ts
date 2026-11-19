/**
 * Observability: error tracking (`reportError`, `reportMessage`, or `logLine` with level "error"
 * or `alert: true`), request ids and the request/job scope they live in. See `tracker.ts`.
 */
export {
  flushTracker,
  isTracking,
  reportError,
  reportMessage,
  type ReportContext,
  type Severity,
} from "./tracker";
export { inRequestScope } from "./request";
export {
  isWellFormedRequestId,
  REQUEST_ID_HEADER,
  requestIdFrom,
  shortReference,
} from "./request-id";
export {
  currentRequestId,
  currentScope,
  setScopeUser,
  withJobScope,
  withRequestScope,
} from "./scope";
