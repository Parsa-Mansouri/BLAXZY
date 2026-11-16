# M1 contracts: Style and Script stages

The interfaces every M1 work package builds against. Change them only with the lead's agreement.
All functions are server-only, validate input with Zod, take the acting `userId`, and return `null`
(or throw the module's `*InputError` with a user-safe message) when the project is missing,
archived or not the user's. Never leak existence.

A job that exists because of a row is sent on the transaction that writes the row
(`enqueue(job, payload, { tx })`, see `src/server/jobs/README.md`): the row and its job commit
together or not at all. If the send fails the transaction rolls back and the request fails, so a
service never leaves a pending row without its job and never records a failed row for a job that
was not sent (the user sees an error, or "This step could not start. Try again in a moment." where
a service maps it to its own error, and tries again).

## Stage flow

`style → script → pre_production → production → done` (stored in `project.stage`).

- Saving Style moves `style → script`.
- Accepting a script moves `script → pre_production` (and stays there on later re-accepts).
- A stage can be opened when it is the current stage or an earlier one.

## `@/server/projects` (additions)

```ts
saveStyle(input: { projectId: string; userId: string; style: ProjectStyle }): Promise<Project | null>
// validates with projectStyleSchema (@/server/damis); stores project.style; on first save moves
// style → script, creates episode rows (movie: 1; series: ceil(total / perEpisode)), logs
// "style.saved". Later saves update style, reconcile episodes (add missing, never delete) and log
// "style.changed".
canOpenStage(project: Project, stage: WizardStage): boolean
advanceStage(input: { projectId: string; from: WizardStage; to: WizardStage }): Promise<boolean>
// internal use by other services; compare-and-set on project.stage, logs "stage.advanced".
listEpisodes(projectId: string, userId: string): Promise<Episode[] | null>
```

## `@/server/script`

```ts
type ScriptVersionView = {
  id: string; versionNumber: number; source: ScriptSource; status: ScriptStatus;
  content: string | null; brief: string | null;
  title: string | null; logline: string | null;      // from the writer's output, kept in damiNotes
  notes: string[];                                    // writer notes / reviser change summary
  findings: ScriptCheckIssue[] | null;                // checker result for uploads
  checkVerdict: "ready" | "needs_attention" | null;
  failure: string | null;                             // user-readable reason when status is failed
  isSample: boolean;                                  // produced in sample mode
  createdAt: Date; decidedAt: Date | null;
};

startFromBrief(input: { projectId; userId; brief: string }): Promise<ScriptVersionView | null>
// new version (source generated, status pending), enqueues script.write (on the same transaction)
startFromUpload(input: { projectId; userId; fileId: string }): Promise<ScriptVersionView | null>
// file must be ready (not pending or abandoned) and owned; new version (source uploaded, pending),
// enqueues script.check (the job extracts the text first)
startFromIdea(input: { projectId; userId; idea: string }): Promise<ScriptVersionView | null>
// new version (source enhanced, pending), enqueues script.enhance: the Enhancer rewrites the quick
// idea as prose; review, acceptance, detection and sectioning then work as for an upload
approveOutline(input: { projectId; userId; versionId; approvedAdditions?: number[] }): Promise<ScriptVersionView | null>
// long pieces: the outline version in review is superseded and the next version (generated,
// pending) is written sequence by sequence (script.write-segment) from it
getScriptState(projectId, userId): Promise<{
  current: ScriptVersionView | null;                  // latest version
  accepted: ScriptVersionView | null;                 // the accepted one, if any
  versions: { id; versionNumber; status; source; createdAt }[];
  busy: boolean;                                      // a job for the latest version is in flight
} | null>
getScriptVersion(versionId, userId): Promise<ScriptVersionView | null>
submitScriptReview(input: {
  projectId; userId; versionId;
  decision: "accepted" | "rejected";
  issueCodes?: ScriptIssueCode[]; note?: string; comments?: ReviewComment[];
}): Promise<ScriptVersionView | null>
// only on a version in_review. Writes a review row (with the version's damiRunId).
// rejected: needs at least one of issueCodes / note / comments; marks the version rejected,
//   creates the next version (source revised, pending, parentId) and enqueues script.revise.
// accepted: marks it accepted (previous accepted → superseded), advances script → pre_production,
//   enqueues script.detect-assets.
editAcceptedScript(input: { projectId; userId; content: string }): Promise<ScriptVersionView | null>
// new version (source edited, parentId = accepted) accepted immediately; previous → superseded;
// enqueues script.detect-assets. No-op when the content is unchanged.
retryScriptVersion(input: { projectId; userId; versionId }): Promise<ScriptVersionView | null>
// only on a failed version: back to pending and re-enqueue its job.
```

## `@/server/assets`

```ts
applyDetection(input: { projectId; scriptVersionId; damiRunId: string | null; mode: AssetDetectionMode;
  output: AssetDetectorOutput; byTemp: ReadonlyMap<string, Asset> }): Promise<{
  detectionId: string; added: number; kept: number; removed: number; diff: DetectionPlan["diff"];
}>
// byTemp: the run's temporary ids (char_1, loc_1 ...) from detectorView → stored assets. One
// transaction under the project lock; the answer is recorded in the append-only asset_detection
// table. The detector's diff by (kind, name; names never change, new names are made unique):
// new → insert active; present → update details/lastScriptVersionId; an approved asset the
// detector drops is only flagged in a warning. Manual assets and skipped priorities are kept as
// the user left them. An asset the user removed (details.removedBy = "user") is never revived by
// a detection: an entry that matches it is dropped. Legacy creature/costume/other rows untouched.
listAssets(projectId, userId, opts?: { kind?: AssetKind; includeRemoved?: boolean; limit?; cursor? }):
  Promise<{ items: Asset[]; nextCursor: string | null } | null>
countAssetsByKind(projectId, userId): Promise<Record<AssetKind, number> | null>
```

## `@/server/blocks`

```ts
replaceBlocks(input: { projectId; scriptVersionId; blocks: SectionedBlock[]; damiRunIds: string[] }):
  Promise<{ created: number; carried: number; superseded: number; reset: number; skipped?: "not_latest" }>
// `skipped: "not_latest"`: the version is no longer the newest accepted one (checked under the
// project lock), so nothing changed.
// A current block whose scriptExcerpt (whitespace-normalised) equals a new block's keeps its
// lineageId (new row, versionNumber + 1 only if prompt/assets differ, else the row is re-pointed by
// inserting an identical next version), and so does an edited shot (a similar excerpt, word Dice
// ≥ 0.6, within 3 positions); others get a new lineage. Assets are compared with what sectioning
// gave the block last time, so a user's own choice (setBlockAssets) survives an unrelated edit.
// `reset`: blocks that must be prepared again while the project was in production (stored as
// `stageState.sectioning.resetBlocks`). Previous current rows get supersededAt. One transaction.
markBlocksStale(input: { projectId; reason: string }): Promise<number>   // current blocks only
listBlocks(projectId, userId, opts?: { limit?; cursor? }): Promise<{ items: PromptBlock[]; nextCursor } | null>
getSectioningStatus(projectId, userId): Promise<{
  state: "idle" | "running" | "done" | "failed" | "stale"; blockCount: number; failure: string | null;
} | null>
```

Sectioning state lives in `project.stageState.sectioning`
(`{ state, scriptVersionId, failure }`), written by the services/handlers.

## Jobs (`@/server/jobs`, defined in `definitions.ts`)

| Job | Payload | Dedupe key | Handler does |
|---|---|---|---|
| `script.enhance` | `{ scriptVersionId }` | version id | runDami(enhancer) on the quick idea → content (the user's own text is kept if it fails) → `in_review` |
| `script.write-segment` | `{ scriptVersionId, segmentIndex }` | `<version id>:<segmentIndex>` | long pieces: write one sequence of the approved outline, then queue the next; the last one stitches the script |
| `script.write` | `{ scriptVersionId }` | version id | runDami(scriptWriter) → content, title/logline/notes → `in_review` |
| `script.check` | `{ scriptVersionId }` | version id | extract text from the file → content; runDami(scriptChecker) → findings → `in_review` |
| `script.revise` | `{ scriptVersionId }` | version id | runDami(scriptReviser) on the parent's content + its review → content, notes → `in_review` |
| `script.detect-assets` | `{ scriptVersionId }` | version id (one paid detection per version at a time; the handler also skips a version that is no longer the accepted one) | runDami(assetDetector, knownAssets) → `applyDetection`; mark blocks stale; enqueue `script.direct` |
| `script.direct` | `{ scriptVersionId, resection?, bibleWaits? }` | `<version id>:direct`, or `:resection` when `resection` is set (a re-direction although blocks exist, after a correction round changed the detected assets); one run per key at a time | Director: `full` (about 8 blocks or fewer) stored with `replaceBlocks`, else `director-plan`, a `direction` row and one `direction.write` job per batch; sectioning state done when the blocks are stored. Skips a version that is no longer the accepted one; defers while the Creative Bible compiles |
| `direction.write` | `{ directionId, batchIndex }` | `<direction id>:<batch index>` | `write_blocks` for the batch's block range over the saved plan; the last batch to finish assembles all blocks in one transaction (idempotent) |
| `asset.detect.fix` | `{ reviewId }` | review id | one correction round of the detected asset list ("Something wrong with this list?"): the Asset Detector in fix mode or a re-scan → `applyDetection`; may send `script.section` with `resection` |

Every handler first loads the row and returns if the work is already done (idempotent), stores
`damiRunId` on what it produced, and on a non-retryable failure (or the last attempt) records a
user-readable `failure` and status `failed`. A handler for a version that is no longer the latest
does nothing. The queue of `script.detect-assets` predates its dedupe key;
`ensureQueue` upgrades it in place (`standard` to `exclusive`).

## Dami mode

`DAMI_MODE=auto|live|sample` (default `sample`; `auto` is sample when `ANTHROPIC_API_KEY` is unset).
`getDamiMode(): "live" | "sample"` from `@/server/damis` (or `@/server/damis/light`). In sample mode `runDami` uses a sample
client; rows in `dami_run` carry model `sample` and cost null.

## Text extraction

`extractScriptText(bytes: Uint8Array, mimeType: string, name: string): Promise<string>` in
`@/server/script` for `.txt`, `.md`, `.docx`, `.pdf`; throws `ScriptInputError` with a user-safe
message for empty, unreadable or over-long documents (limit 400,000 characters).
