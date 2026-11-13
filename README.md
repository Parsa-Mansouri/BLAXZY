# BLAXZY

Self-hosted AI film-generation platform (Next.js web app + background worker, Postgres, S3-compatible storage, Claude API).

## Local setup

Requirements: Node >= 22.2, pnpm 9, Docker.

```bash
pnpm install
cp .env.example .env          # adjust values / host ports if needed
docker compose up -d          # Postgres 17 + S3 store, creates bucket "blaxzy"
pnpm db:migrate               # apply migrations
pnpm dev                      # web at http://localhost:3000
pnpm worker:dev               # background worker (separate terminal)
```

Default host ports (override in `.env`): Postgres `5432`, S3 API `9100`, S3 console `9101`.
The S3 store is RustFS (the official MinIO images are no longer published); console login is `blaxzy` / `blaxzy-secret`.

## Environment

All configuration is read from the environment (see `.env.example` and `src/server/env.ts`).

| Variable                          | Default                          | Notes                                                                                                                                                                                                                    |
| --------------------------------- | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `NODE_ENV`                        | `development`                    | `development`, `test` or `production`. `production` turns on the extra checks listed below                                                                                                                               |
| `DATABASE_URL`                    | (required)                       | Postgres connection string                                                                                                                                                                                               |
| `DATABASE_POOL_MAX`               | `10`                             | Connections in each process's own pool (web and worker); see the connection budget below                                                                                                                                 |
| `BETTER_AUTH_SECRET`              | (required)                       | Signs cookies and tokens; at least 32 characters (`openssl rand -base64 32`). In production it must not be the `.env.example` value                                                                                      |
| `BETTER_AUTH_URL`                 | `http://localhost:3000`          | Public origin of the app; the only trusted origin. In production it must be set explicitly and be `https://`                                                                                                             |
| `AUTH_TRUSTED_PROXIES`            | empty                            | Comma-separated IPs/CIDRs of reverse proxies whose forwarded client address auth rate limiting trusts; see Reverse proxy and client IP                                                                                   |
| `AUTH_IP_HEADER`                  | unset                            | Header your proxy always overwrites with the client address (e.g. `x-real-ip`); lower-cased; see Reverse proxy and client IP                                                                                             |
| `EMAIL_TRANSPORT`                 | `console`                        | `console` prints emails and their links to the server log (development only; refused in production); `smtp` sends them                                                                                                   |
| `EMAIL_FROM`                      | `BLAXZY <no-reply@blaxzy.local>` | Sender address (one address, no line breaks; checked when `EMAIL_TRANSPORT=smtp`)                                                                                                                                        |
| `SMTP_HOST`                       | unset                            | SMTP server; required when `EMAIL_TRANSPORT=smtp`                                                                                                                                                                        |
| `SMTP_PORT`                       | unset                            | SMTP port (587 for STARTTLS, 465 for implicit TLS); required when `EMAIL_TRANSPORT=smtp`                                                                                                                                 |
| `SMTP_USER`                       | unset                            | SMTP login (used only together with `SMTP_PASSWORD`)                                                                                                                                                                     |
| `SMTP_PASSWORD`                   | unset                            | SMTP password                                                                                                                                                                                                            |
| `SMTP_SECURE`                     | unset                            | `true`: TLS from the first byte (port 465). `false`/unset: STARTTLS is mandatory and a server without it is refused (only a loopback host in development may stay plain, for a local mail catcher)                       |
| `S3_ENDPOINT`                     | (required)                       | Object storage endpoint the server talks to                                                                                                                                                                              |
| `S3_REGION`                       | `us-east-1`                      | Object storage region                                                                                                                                                                                                    |
| `S3_BUCKET`                       | (required)                       | Bucket name                                                                                                                                                                                                              |
| `S3_ACCESS_KEY_ID`                | (required)                       | Object storage access key                                                                                                                                                                                                |
| `S3_SECRET_ACCESS_KEY`            | (required)                       | Object storage secret key                                                                                                                                                                                                |
| `S3_FORCE_PATH_STYLE`             | `true`                           | Path-style addressing (needed by most self-hosted S3 stores)                                                                                                                                                             |
| `S3_PUBLIC_ENDPOINT`              | `S3_ENDPOINT`                    | Origin browsers use in presigned upload/download URLs (only for presigning). It is also baked into the Content-Security-Policy at `next build` time: set it when building (Docker: `--build-arg S3_PUBLIC_ENDPOINT=...`) |
| `S3_CORS_ORIGINS`                 | `http://localhost:3000`          | Compose only: origins `minio-init` allows to PUT/GET the bucket (comma-separated)                                                                                                                                        |
| `POSTGRES_PORT`                   | `5432`                           | Compose only: host port of Postgres (bound to 127.0.0.1)                                                                                                                                                                 |
| `MINIO_API_PORT`                  | `9100`                           | Compose only: host port of the S3 API (bound to 127.0.0.1)                                                                                                                                                               |
| `MINIO_CONSOLE_PORT`              | `9101`                           | Compose only: host port of the S3 console (bound to 127.0.0.1)                                                                                                                                                           |
| `JOBS_SCHEMA`                     | `pgboss`                         | Postgres schema of the job queue (pg-boss, same `DATABASE_URL`)                                                                                                                                                          |
| `JOBS_WEB_POOL_MAX`               | `2`                              | Queue connection pool per web process                                                                                                                                                                                    |
| `JOBS_WORKER_POOL_MAX`            | `10`                             | Queue connection pool per worker process                                                                                                                                                                                 |
| `WORKER_CONCURRENCY_DEFAULT`      | `2`                              | Jobs of one type a worker process runs at once                                                                                                                                                                           |
| `WORKER_CONCURRENCY`              | empty                            | Per job type overrides, e.g. `script.generate=4,video.render=0` (`0` = not on this worker)                                                                                                                               |
| `WORKER_POLL_INTERVAL_SECONDS`    | `2`                              | How often an idle worker checks for jobs                                                                                                                                                                                 |
| `WORKER_SHUTDOWN_TIMEOUT_SECONDS` | `25`                             | Wait for in-flight jobs on SIGTERM; keep the container stop grace period longer                                                                                                                                          |
| `ANTHROPIC_API_KEY`               | unset                            | Claude API; without it damis run in sample mode                                                                                                                                                                          |
| `ANTHROPIC_WORKSPACE_ID`          | unset                            | Only for an API key that is not scoped to a workspace: the workspace to bill (sent as `anthropic-workspace-id`)                                                                                                          |
| `DAMI_MODE`                       | `sample`                         | `sample` returns generated sample output (testing-phase default); `live` calls Claude; `auto` = `sample` without an API key                                                                                              |
| `DAMI_SAMPLE_DELAY_MS`            | `3000`                           | Artificial latency of one sample-mode dami call (`0` in tests)                                                                                                                                                           |
| `DAMI_DEFAULT_MODEL`              | unset                            | Overrides every dami's default Claude model (unset = per-dami defaults)                                                                                                                                                  |
| `DAMI_MAX_CONCURRENCY`            | `4`                              | Per-process limit on concurrent Claude calls made by damis; see Claude concurrency below                                                                                                                                 |
| `DAMI_MAX_RETRIES`                | `4`                              | Retries per Claude call for rate limits, overloads and network errors                                                                                                                                                    |
| `GENERATION_PROVIDER`             | `sample`                         | `sample` renders placeholder images and MP4 clips locally (no cost); `higgsfield` is not wired yet                                                                                                                       |
| `GENERATION_SAMPLE_DELAY_MS`      | `3000`                           | How long one sample generation takes (`0` in tests)                                                                                                                                                                      |
| `GENERATION_MAX_PER_USER`         | `3`                              | Generations one user may have running at once; extra jobs are rescheduled, not failed                                                                                                                                    |
| `GENERATION_STUCK_AFTER_MINUTES`  | `120`                            | `generation.sweep` (every 5 min) fails and refunds generations queued or running longer than this                                                                                                                        |
| `FFMPEG_PATH`                     | unset                            | ffmpeg used for sample video; unset = the `ffmpeg-static` package (dev dependency), else `ffmpeg` on the PATH                                                                                                            |

In production (`NODE_ENV=production`) the app refuses to start with: a `BETTER_AUTH_SECRET` shorter than 32
characters or equal to the example value, a `BETTER_AUTH_URL` that is unset or not `https://`, or
`EMAIL_TRANSPORT=console`. With `EMAIL_TRANSPORT=smtp` (any environment) `SMTP_HOST`, `SMTP_PORT` and a valid
`EMAIL_FROM` are required. `DAMI_MODE` and `GENERATION_PROVIDER` keep their `sample` defaults in production on
purpose until real providers are switched on.

### Database connection budget

Every process opens its own pools. Per web process: `DATABASE_POOL_MAX` + `JOBS_WEB_POOL_MAX` (default 10 + 2).
Per worker process: `DATABASE_POOL_MAX` + `JOBS_WORKER_POOL_MAX` (default 10 + 10). The sum over all web
and worker processes must stay below Postgres `max_connections` (default 100, minus what migrations,
admin tools and monitoring use). With many replicas, lower the pool sizes or put a pooler (PgBouncer in
transaction mode, or your provider's pooler) between the processes and Postgres.

### Claude concurrency

`DAMI_MAX_CONCURRENCY` limits concurrent Claude calls **per process**. The total is the number of
processes that run damis (workers) times this value: 3 workers at 4 allow up to 12 calls at once, so size it
against your Claude API rate limits.

### Reverse proxy and client IP

Auth endpoints are rate limited per client IP, so the app has to know the real client address. Behind a
reverse proxy or load balancer set one of:

- `AUTH_TRUSTED_PROXIES`: the proxy's IPs/CIDRs (e.g. `10.0.0.0/8`); the forwarded address is believed only
  when the request really comes from one of them;
- `AUTH_IP_HEADER`: a header your proxy always overwrites with the client address (e.g. `x-real-ip`);
  the proxy must drop any value the client sends.

With neither, the rate limiter cannot identify clients reliably (all clients may share one bucket, or a
client may forge its address).

### Migrations in production

The images contain no drizzle-kit. A third image target, `migrate`, bundles drizzle-orm's migrator and the
tracked `drizzle/` folder; run it once per deploy, before starting the new web and worker containers:

```bash
docker build --target migrate -t blaxzy-migrate .
docker run --rm -e DATABASE_URL=postgresql://... blaxzy-migrate
```

It needs only `DATABASE_URL`, logs what it applies, exits 0 when the database is up to date and 1 on failure.
A Postgres advisory lock makes two concurrent runs queue instead of racing. It writes the same journal
(`drizzle.__drizzle_migrations`) as `pnpm db:migrate`, so a database migrated in development is not migrated
twice. From a checkout: `pnpm db:migrate:prod`.

### Health endpoint

`GET /api/health` needs no session and is never cached. It answers `200 {"status":"ok"}` when `select 1`
succeeds within 2 seconds and `503 {"status":"unavailable"}` otherwise, with no version or error details.
The web image has a Docker `HEALTHCHECK` on it; use it as the readiness probe of your orchestrator. The worker
serves no port and has no heartbeat, so its image has no health check; rely on a restart policy.

## Damis

Damis are the Claude-powered processes (`src/server/damis`, see its README). To run one for real
once `ANTHROPIC_API_KEY` is set (the run is recorded in `dami_run`):

```bash
pnpm dami:run script-writer src/server/damis/script-writer/fixtures/input.json [--project <id>]
```

By default (`DAMI_MODE=sample`, the testing-phase setting) every dami answers in **sample mode**: output is
generated from the actual input by small deterministic generators (`src/server/damis/sample/`),
stored in `dami_run` with model `sample` and no cost, and script versions show `isSample`. The
whole Script stage then runs end to end locally:

```bash
pnpm worker            # in one terminal
pnpm dev:script-flow   # creates a project for testuser@gmail.com and runs brief → blocks
```

## Generation and credits

Images (and later video) are made through the provider layer (`src/server/providers`), paid with
credits (`src/server/billing`) and run by the `generation.run` job (`src/server/generation`; see
their READMEs). By default the **sample provider** renders placeholder PNGs and MP4 clips (ffmpeg) locally:

```bash
pnpm dev:credits testuser@gmail.com 100   # grant credits (development only)
pnpm worker                               # in one terminal
pnpm dev:generation                       # a look, a sheet, a draft clip and its final on the latest project
pnpm dev:sweep                            # fail + refund generations stuck past GENERATION_STUCK_AFTER_MINUTES
pnpm dev:preprod-flow                     # a character (look, sheet), a location pack and a prop sheet on "The Lighthouse Keeper"
pnpm dev:production-flow [email] [title]  # drafts and finals on a project in production (default "QA Run 14:03")
```

## Background jobs and storage

Long work runs in workers through the typed job queue in `src/server/jobs` (pg-boss on Postgres):
web code calls `enqueue(job, payload)`, handlers live in `worker/handlers/`. Run as many web and
worker processes as needed; see `src/server/jobs/README.md` for concurrency and the idempotency
rule every handler must follow.

Files go straight from the browser to the S3 store through presigned URLs
(`src/server/storage`, see its README). The bucket needs CORS for the app origins; locally
`minio-init` applies it (`docker compose up --no-deps minio-init` after changing
`S3_CORS_ORIGINS`).

## Accounts

better-auth (email + password) is served at `/api/auth/*`. Sign-up is open; the email must be
verified before signing in. In development the verification and password-reset links appear in
the `pnpm dev` log (console transport); production sends them over SMTP. Auth endpoints are rate limited per client IP, with counters in the
`rate_limit` table so all web replicas share them. Behind a reverse proxy, make sure it sets
`X-Forwarded-For` to the single client address and configure `AUTH_TRUSTED_PROXIES` or `AUTH_IP_HEADER` (see above).

## Production image

One Dockerfile, two images: the web image (default target) and the worker image, which adds
sharp, fonts and ffmpeg (for sample video; `FFMPEG_PATH` is set in the image):

```bash
docker build -t blaxzy .                                  # web
docker build --target worker -t blaxzy-worker .           # worker
docker run --env-file .env -p 3000:3000 blaxzy
docker run --env-file .env --stop-timeout 30 blaxzy-worker
```

The web build bakes the Content-Security-Policy in, so pass the S3 browser origin when building:
`docker build --build-arg S3_PUBLIC_ENDPOINT=https://s3.example.com -t blaxzy .` (see the environment table).

Locally, sample video uses the `ffmpeg-static` package (a dev dependency), or
`ffmpeg` on the PATH. Every worker registers the `generation.sweep` schedule (every 5 minutes);
there is one schedule however many workers run, and `pnpm dev:sweep` runs one sweep by hand.

The worker drains in-flight jobs on SIGTERM for up to `WORKER_SHUTDOWN_TIMEOUT_SECONDS`; give the
container a longer stop timeout (Docker's default is 10 s).

See `CLAUDE.md` for commands, folder map and engineering rules.
