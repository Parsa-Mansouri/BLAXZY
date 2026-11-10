# BLAXZY

Self-hosted AI film-generation platform (Next.js web app + background worker, Postgres, S3-compatible storage, Claude API).

## Local setup

Requirements: Node >= 22, pnpm 9, Docker.

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

| Variable                                                              | Default                          | Notes                                                                                                       |
| --------------------------------------------------------------------- | -------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`, `DATABASE_POOL_MAX`                                   | `10` pool size                   | Postgres connection                                                                                         |
| `BETTER_AUTH_SECRET`                                                  | (required)                       | Signs cookies and tokens; use `openssl rand -base64 32` in production                                       |
| `BETTER_AUTH_URL`                                                     | `http://localhost:3000`          | Public origin of the app; the only trusted origin. Use `https://` in production                             |
| `EMAIL_TRANSPORT`                                                     | `console`                        | `console` prints emails and their links to the server log (development only); `smtp` is not implemented yet |
| `EMAIL_FROM`                                                          | `BLAXZY <no-reply@blaxzy.local>` | Sender address                                                                                              |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_SECURE` | unset                            | Reserved for the SMTP transport                                                                             |
| `S3_*`                                                                | see `.env.example`               | Object storage                                                                                              |
| `S3_PUBLIC_ENDPOINT`                                                  | `S3_ENDPOINT`                    | Origin browsers use in presigned upload/download URLs (only for presigning)                                 |
| `S3_CORS_ORIGINS`                                                     | `http://localhost:3000`          | Compose only: origins `minio-init` allows to PUT/GET the bucket (comma-separated)                           |
| `JOBS_SCHEMA`                                                         | `pgboss`                         | Postgres schema of the job queue (pg-boss, same `DATABASE_URL`)                                             |
| `JOBS_WEB_POOL_MAX`, `JOBS_WORKER_POOL_MAX`                           | `2`, `10`                        | Queue connection pool per web / worker process                                                              |
| `WORKER_CONCURRENCY_DEFAULT`                                          | `2`                              | Jobs of one type a worker process runs at once                                                              |
| `WORKER_CONCURRENCY`                                                  | empty                            | Per job type overrides, e.g. `script.generate=4,video.render=0` (`0` = not on this worker)                  |
| `WORKER_POLL_INTERVAL_SECONDS`                                        | `2`                              | How often an idle worker checks for jobs                                                                    |
| `WORKER_SHUTDOWN_TIMEOUT_SECONDS`                                     | `25`                             | Wait for in-flight jobs on SIGTERM; keep the container stop grace period longer                             |
| `ANTHROPIC_API_KEY`                                                   | unset                            | Claude API                                                                                                  |

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
the `pnpm dev` log. Auth endpoints are rate limited per client IP, with counters in the
`rate_limit` table so all web replicas share them. Behind a reverse proxy, make sure it sets
`X-Forwarded-For` to the single client address.

## Production image

One image runs either role:

```bash
docker build -t blaxzy .
docker run --env-file .env -p 3000:3000 blaxzy              # web
docker run --env-file .env --stop-timeout 30 blaxzy node worker.cjs   # worker
```

The worker drains in-flight jobs on SIGTERM for up to `WORKER_SHUTDOWN_TIMEOUT_SECONDS`; give the
container a longer stop timeout (Docker's default is 10 s).

See `CLAUDE.md` for commands, folder map and engineering rules.
