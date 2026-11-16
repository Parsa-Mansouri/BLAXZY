# generation

Paid jobs at a generation provider (`@/server/generation`, contract in
`docs/M2_M3_CONTRACTS.md`). Owns the `generation` table.

- `quoteGeneration({ purpose, style })`: the price, creates nothing.
- `requestGeneration(input, tx?)`: checks references (ready images the user owns), `pickModel`,
  prices at the active provider, then in one transaction checks the project and the
  references, inserts the row (`queued`), reserves the credits and sends `generation.run` (all on
  that transaction). With `tx` all of it runs on the caller's transaction and connection (never a
  second pool connection while the caller holds locks); the run starts when the caller commits. The optional `label` is stored
  as `params.label` and passed to the provider as `label` (sample output only). Video
  (`block_draft`, `block_final`) takes `durationSeconds` and `sound`. A `block_final` requires
  `draftGenerationId`: a succeeded `block_draft` of the same user and project (checked inside the
  transaction), stored as `params.draftGenerationId`; the run passes that draft's provider job id
  to the provider as `draftProviderJobId`. Other purposes refuse a `draftGenerationId`.
- `maxCredits` (required): the price the user confirmed, stored on the look, sheet, view or take
  the generation is made for (`confirmed_credits`). A price above it, or `null` (never
  confirmed), throws `PriceChangedError` and creates nothing: a worker never spends more than the
  user agreed to. The user-facing side is `spend.ts`: `quoteSpend` (the price, the balance) and
  `confirmSpend` (re-quote, compare with `expectedCredits`, check the balance), used by every
  action that leads to a paid generation (pre-production designs, fixes, re-rolls, sheets, pack
  views and their retries; production drafts, finals, new drafts and retries). There is no cap on
  how many generations a block or asset may have.
- `getGeneration(id, userId)`: `GenerationView` or null (with `posterFileId` for a video).
- `onGenerationFinished(handler)`: completion hooks, registered by the worker. At-least-once:
  hooks must be idempotent.

## The `generation.run` job (`run.ts`)

Dedupe key: the generation id, with `allowFollowUp` (pg-boss `stately`: one queued job beside the
running one, never two running).

1. Finished generation: skip (hooks are called again).
2. Claim under a per-user advisory lock: a queued generation becomes `running` unless the user
   already has `GENERATION_MAX_PER_USER` running (running rows older than 2 h are ignored) or
   older queued generations of the user (created within the last 6 h; an older one no longer holds
   others back) wait for the free slots (first come, first served); then
   the job enqueues a follow-up of itself 10 to 20 s later and completes. Rescheduled, not failed;
   no attempt is used.
3. The provider job is created once: references are read (ownership checked again), a lease on
   the row (`provider_claimed_at`, 2 min) is taken, then `create` runs outside any transaction
   with the generation id as `idempotencyKey` and the attempt's signal, and its id is stored
   before polling. A concurrent run waits for the stored id; a retry resumes it.
4. Poll with backoff (or the provider's `retryAfterMs`) within the attempt's budget (job expiry
   minus 60 s).
5. Success (an upload recorded by an earlier attempt in `params.uploadedResultFileId` is reused):
   store the output with `putFileBytes` (`generated_image` / `sheet_image` /
   `generated_video`; a streamed result is uploaded as a stream, never held in memory) and a
   video's poster (`video_poster`), then in one transaction set `succeeded` + `resultFileId`
   (only if still `running`) and `settle`. The poster id is written to `params.posterFileId`
   in that update (the table has no column for it) so a repeated hook call still gets it.
6. A non-retryable failure, or any failure on the last attempt (including an expired attempt):
   `failed` with a user-readable `error`, and `refund`, in one transaction. Retryable failures
   before the last attempt rethrow so pg-boss retries. An attempt interrupted by a worker
   shutdown changes nothing (the queue delivers it again).
7. The hooks run; once all return, `notified_at` is set.

Hooks receive `{ id, purpose, status, resultFileId, posterFileId, error }`.

## The `generation.sweep` job (`sweep.ts`)

Scheduled by every worker at startup (cron `*/5 * * * *`, UTC; pg-boss keeps one schedule per job
name and sends each occurrence once, and the queue's dedupe key allows one sweep at a time).
`running` generations started before `GENERATION_STUCK_AFTER_MINUTES` (default 120), and
`queued` ones never started and created before `QUEUED_STUCK_AFTER_MINUTES` (12 h: they may be
waiting behind the per-user limit), are failed with a user-readable error and refunded through the
same conditional update as a failed run, then the hooks are called. Queued generations older than
30 min get their run job sent again (deduplicated). Finished generations whose `notified_at` is
still null 2 min after finishing get their hooks called again (bounded batch, partial index), so a
hook that kept failing or a worker that died after the final commit never leaves a look, sheet,
view or take pending. Idempotent: a second sweep changes nothing. `pnpm dev:sweep` runs one sweep in-process with the worker's hooks.

Every step logs one JSON line with `generationId`, `jobId` and `attempt`.

Development: `pnpm worker` and `pnpm dev:generation [email]`.
