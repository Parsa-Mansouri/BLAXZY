# jobs

Typed background jobs over pg-boss (Postgres). Only `pg-boss.ts` imports pg-boss, so the queue can
be replaced (for example by BullMQ) without touching callers.

## Defining and enqueueing

Job types live in `definitions.ts` (the registry): a name, a Zod payload schema, retry/expiry
defaults and an optional dedupe key. Definitions import no handler code.

```ts
export const scriptGenerate = defineJob({
  name: "script.generate",
  payload: z.object({ scriptVersionId: z.uuid() }),
  options: { retryLimit: 3, expireInSeconds: 600 },
  dedupeKey: (p) => p.scriptVersionId,
});

// In a service (web process or another handler):
await enqueue(scriptGenerate, { scriptVersionId }); // job id, or null if deduplicated
```

With `allowFollowUp: true` (needs a dedupe key) the queue keeps one queued job beside the running
one per key, so a running handler can enqueue a delayed follow-up of itself (`generation.run` does
this to wait for a free per-user slot); two jobs with the same key still never run at once.

`enqueue` validates the payload (throws `InvalidJobPayloadError`) and connects lazily on first use,
so importing this module never opens a connection (`next build` needs no env). On the first send a
process creates the queue of every job type in `ALL_JOBS` (`definitions.ts`; add new job types
there), so no send ever creates a queue inside a caller's transaction.

## Transactional enqueue (required pattern)

pg-boss lives in the same Postgres, so a job can be written in the caller's transaction:

```ts
await getDb().transaction(async (tx) => {
  await tx.update(scriptVersion).set({ damiNotes }).where(eq(scriptVersion.id, id)); // the change
  await enqueue(scriptWriteSegment, { scriptVersionId: id, segmentIndex }, { tx }); // its follow-up
});
```

The job exists only if the transaction commits, and no worker sees it before. **Whenever a job is
enqueued because of a row written in the same unit of work, send it with `{ tx }`**: committing the
row and enqueueing afterwards leaves the row waiting forever if the process dies (or the enqueue
fails) in between, and a retry usually finds the row done and returns early. Dedupe keys behave as
without `tx` (a duplicate returns `null`; a concurrent transaction sending the same key waits for
this one). `enqueueGeneration(id, { tx })` does the same for `generation.run`, and
`requestGeneration(input, tx)` sends the run job on `tx` itself.

A retry that finds its state already written should still re-issue the follow-up it owes (a no-op
while it is queued, thanks to the dedupe key): this also covers rows written before the follow-up
was transactional.

## Handlers (worker only)

Handlers are bound in `worker/handlers/` with `defineHandler(job, async (payload, ctx) => ...)` and
listed in `worker/handlers/index.ts`. The worker validates the payload again on receipt: an invalid
payload fails the job without retries. A thrown error fails the attempt and pg-boss retries it with
the job type's `retryLimit` / `retryDelaySeconds` / `retryBackoff`. An attempt running longer than
`expireInSeconds` is aborted (`ctx.signal`) and retried. Only an invalid payload on receipt fails
the job for good; an `InvalidJobPayloadError` thrown inside a handler (a nested enqueue) is an
ordinary, retried failure.

Aborts have two reasons. An expired attempt is a failure: on the last attempt record a "took too
long" failure on the domain row, then rethrow (`handleFailure` in `worker/handlers/failure.ts`). A
worker shutdown aborts with a `JobShutdownError` reason (`isShutdownAbort(ctx.signal)`): it is not
a failure, the attempt is given back (the job's retry limit is raised by one, see `ctx.retryLimit`)
and the queue delivers it again; never record a failure for it. Use `isLastAttempt(job, ctx)`,
which honours `ctx.retryLimit`. Every attempt logs one JSON line with
`job`, `id`, `attempt`, `ms` and `outcome` (`completed`, `failed`, `rejected`).

## Recurring jobs

`startWorker({ schedules: [{ job, cron, payload }] })` registers cron schedules (UTC) through
`scheduleJob`. pg-boss stores one schedule per job name, so every worker may register it; only
worker processes evaluate cron, and pg-boss sends each occurrence once across them. Give the job a
dedupe key so a slow run and the next occurrence never overlap (`generation.sweep`).

Schedules registered by every worker (`worker/handlers`, all UTC):

| Job                | Cron           | Does                                                                        |
| ------------------ | -------------- | --------------------------------------------------------------------------- |
| `generation.sweep` | `*/5 * * * *`  | fails and refunds stuck generations, re-queues lost runs, re-notifies hooks |
| `dami.sweep`       | `*/15 * * * *` | marks dami runs still `running` after 90 minutes as `aborted`               |
| `file.sweep`       | `*/15 * * * *` | abandons uploads still `pending` after 6 hours and deletes their objects    |
| `ratelimit.prune`  | `*/5 * * * *`  | deletes expired server-action rate-limit windows                            |

`production.dispatch` (`{ projectId, kind: "prepare" | "takes" }`) is not scheduled: a service sends
it on the transaction that claimed the blocks or created the drafts, and the handler fans out one
per-row job (`production.prepare` / `block.revise`, `take.generate`) for each pending row. It has
`allowFollowUp`, so one may wait beside a running one and rows claimed meanwhile are not missed.

## Idempotency (required)

Delivery is at-least-once: a job can run again after a crash, an expired attempt, a worker shutdown
or a second enqueue. Every handler must be safe to run twice. The pattern:

1. **Dedupe on enqueue** when the work is "per entity": `dedupeKey: (p) => p.scriptVersionId`
   keeps at most one queued/running job per key.
2. **Check the domain row first** and return early if the work is already done
   (`status === "succeeded"`, `content !== null`, ...).
3. **Write the result with a conditional update** so a duplicate run cannot overwrite a newer state:
   `update ... set status = 'in_review', content = $1 where id = $2 and status = 'pending'`.
   Zero rows updated means another run won; treat it as success.
4. **External side effects** (paid API calls, uploads) happen after step 2, and anything they
   create is recorded on the domain row in step 3, so a retry can find and reuse it.

## Scaling

- Any number of web replicas send; any number of worker processes consume. Postgres
  (`SKIP LOCKED`) guarantees one worker per job attempt.
- Concurrency is per process and per job type: `WORKER_CONCURRENCY_DEFAULT`, overridden by
  `WORKER_CONCURRENCY=script.generate=4,video.render=0`. The fleet-wide total is the sum over
  processes; `0` leaves a job type to other workers (dedicated worker pools).
- Any process may install or migrate the pg-boss schema (`JOBS_SCHEMA`); pg-boss serialises this
  with an advisory lock, so replicas can start together. Queues are created on first use per
  process (idempotent). Only workers run pg-boss maintenance; web replicas keep a small pool
  (`JOBS_WEB_POOL_MAX`).
- `stopWorker(timeoutMs)` stops fetching, waits for running jobs, aborts the ones still running
  with a shutdown reason (their attempt is given back) and waits for them to unwind, all within
  `timeoutMs`; only then does it close the queue, so the caller can close the database after it. Keep the orchestrator's stop grace period above
  `WORKER_SHUTDOWN_TIMEOUT_SECONDS`.

## Changing a queue's policy

pg-boss cannot change an existing queue's policy. The one change that is safe in place (a job type
gaining a dedupe key: `standard` to `exclusive`) is done by `ensureQueue` automatically; any other
change (`allowFollowUp`, removing a key) needs a new queue name.
