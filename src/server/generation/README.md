# generation

Paid jobs at a generation provider (`@/server/generation`, contract in
`docs/M2_M3_CONTRACTS.md`). Owns the `generation` table.

- `quoteGeneration({ purpose, style })`: the price, creates nothing.
- `requestGeneration(input, tx?)`: checks references (ready images the user owns), `pickModel`,
  prices at the active provider, then in one transaction checks the project, inserts the row
  (`queued`) and reserves the credits. Enqueues `generation.run` after commit; with `tx` the
  caller enqueues with `enqueueGeneration` after its own commit. The optional `label` is stored
  as `params.label` and passed to the provider as `label` (sample output only). Video
  (`block_draft`, `block_final`) takes `durationSeconds` and `sound`. A `block_final` requires
  `draftGenerationId`: a succeeded `block_draft` of the same user and project (checked inside the
  transaction), stored as `params.draftGenerationId`; the run passes that draft's provider job id
  to the provider as `draftProviderJobId`. Other purposes refuse a `draftGenerationId`.
- `getGeneration(id, userId)`: `GenerationView` or null (with `posterFileId` for a video).
- `onGenerationFinished(handler)`: completion hooks, registered by the worker. At-least-once:
  hooks must be idempotent.

## The `generation.run` job (`run.ts`)

Dedupe key: the generation id, with `allowFollowUp` (pg-boss `stately`: one queued job beside the
running one, never two running).

1. Finished generation: skip (hooks are called again).
2. Claim under a per-user advisory lock: a queued generation becomes `running` unless the user
   already has `GENERATION_MAX_PER_USER` running (running rows older than 2 h are ignored); then
   the job enqueues a follow-up of itself 10 to 20 s later and completes. Rescheduled, not failed;
   no attempt is used.
3. The provider job is created once: references are read (ownership checked again), then
   `create` runs while the row is locked and its id is stored before polling. A retry or a
   duplicate run resumes the stored provider job.
4. Poll with backoff (or the provider's `retryAfterMs`) within the attempt's budget (job expiry
   minus 60 s).
5. Success: store the output with `putFileBytes` (`generated_image` / `sheet_image` /
   `generated_video`; a streamed result is uploaded as a stream, never held in memory) and a
   video's poster (`video_poster`), then in one transaction set `succeeded` + `resultFileId`
   (only if still `running`) and `settle`. The poster id is written to `params.posterFileId`
   in that update (the table has no column for it) so a repeated hook call still gets it.
6. A non-retryable failure, or any failure on the last attempt (including an expired attempt):
   `failed` with a user-readable `error`, and `refund`, in one transaction. Retryable failures
   before the last attempt rethrow so pg-boss retries.

Hooks receive `{ id, purpose, status, resultFileId, posterFileId, error }`.

## The `generation.sweep` job (`sweep.ts`)

Scheduled by every worker at startup (cron `*/5 * * * *`, UTC; pg-boss keeps one schedule per job
name and sends each occurrence once, and the queue's dedupe key allows one sweep at a time).
Generations `queued` or `running` since before `GENERATION_STUCK_AFTER_MINUTES` (default 120;
measured from `startedAt`, else `createdAt`) are failed with a user-readable error and refunded
through the same conditional update as a failed run, then the hooks are called (only by the call
that changed the row). If a hook throws, a `generation.run` job is queued, which finds the
generation finished and calls the hooks again with retries. Idempotent: a second sweep changes
nothing. `pnpm dev:sweep` runs one sweep in-process with the worker's hooks.

Every step logs one JSON line with `generationId`, `jobId` and `attempt`.

Development: `pnpm worker` and `pnpm dev:generation [email]`.
