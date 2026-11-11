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
so importing this module never opens a connection (`next build` needs no env).

## Handlers (worker only)

Handlers are bound in `worker/handlers/` with `defineHandler(job, async (payload, ctx) => ...)` and
listed in `worker/handlers/index.ts`. The worker validates the payload again on receipt: an invalid
payload fails the job without retries. A thrown error fails the attempt and pg-boss retries it with
the job type's `retryLimit` / `retryDelaySeconds` / `retryBackoff`. An attempt running longer than
`expireInSeconds` is aborted (`ctx.signal`) and retried. Every attempt logs one JSON line with
`job`, `id`, `attempt`, `ms` and `outcome` (`completed`, `failed`, `rejected`).

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
- `stopWorker(timeoutMs)` stops fetching, waits for running jobs, then fails the rest so another
  worker retries them. Keep the orchestrator's stop grace period above
  `WORKER_SHUTDOWN_TIMEOUT_SECONDS`.
