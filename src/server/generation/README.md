# generation

Paid jobs at a generation provider (`@/server/generation`, contract in
`docs/M2_M3_CONTRACTS.md`). Owns the `generation` table.

- `quoteGeneration({ purpose, style })`: the price, creates nothing.
- `requestGeneration(input, tx?)`: checks references (ready images the user owns), `pickModel`,
  prices at the active provider, then in one transaction checks the project, inserts the row
  (`queued`) and reserves the credits. Enqueues `generation.run` after commit; with `tx` the
  caller enqueues with `enqueueGeneration` after its own commit. Video purposes are refused until
  a video file purpose exists. The optional `label` is stored as `params.label` and passed to the
  provider as `label` (sample output only).
- `getGeneration(id, userId)`: `GenerationView` or null.
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
5. Success: store the bytes with `putFileBytes` (`generated_image` / `sheet_image`), then in one
   transaction set `succeeded` + `resultFileId` (only if still `running`) and `settle`.
6. A non-retryable failure, or any failure on the last attempt (including an expired attempt):
   `failed` with a user-readable `error`, and `refund`, in one transaction. Retryable failures
   before the last attempt rethrow so pg-boss retries.

Every step logs one JSON line with `generationId`, `jobId` and `attempt`.

Development: `pnpm worker` and `pnpm dev:generation [email]`.
