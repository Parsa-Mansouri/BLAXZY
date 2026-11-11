/**
 * The Script stage (see docs/M1_CONTRACTS.md). User-facing services take the acting user;
 * `loadScriptJob`, `completeScriptVersion` and `failScriptVersion` are for job handlers.
 */
export { ScriptInputError } from "./errors";
export { extractScriptText, MAX_SCRIPT_CHARS } from "./extract";
export {
  editAcceptedScript,
  getScriptState,
  getScriptVersion,
  retryScriptVersion,
  startFromBrief,
  startFromUpload,
  submitScriptReview,
  type ScriptState,
} from "./service";
export {
  completeScriptVersion,
  failScriptVersion,
  loadScriptJob,
  type ScriptJobContext,
} from "./jobs";
export { MAX_BRIEF_CHARS, MAX_LISTED_VERSIONS, MAX_REVIEW_COMMENTS } from "./schemas";
export { readNotes as readScriptNotes } from "./views";
export type {
  ScriptDamiNotes,
  ScriptVersionRow,
  ScriptVersionSummary,
  ScriptVersionView,
} from "./views";
