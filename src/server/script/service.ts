/**
 * The Script stage: script versions, reviews and the jobs that produce them. Every function takes
 * the acting user and returns null when the project is missing, archived or not theirs. Jobs are
 * sent on the transaction that creates (or accepts) their version, so both commit together.
 *
 * The services live in `start`, `read` and `review`, their shared steps in `internal`; this file
 * keeps the module's service surface in one place (the index and `jobs.ts` import from it).
 */
export { markFailed } from "./internal";
export { getScriptState, getScriptVersion, type ScriptState } from "./read";
export { editAcceptedScript, retryScriptVersion, submitScriptReview } from "./review";
export { approveOutline, startFromBrief, startFromIdea, startFromUpload } from "./start";
