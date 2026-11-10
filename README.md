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

## Production image

One image runs either role:

```bash
docker build -t blaxzy .
docker run --env-file .env -p 3000:3000 blaxzy              # web
docker run --env-file .env blaxzy node worker.cjs           # worker
```

See `CLAUDE.md` for commands, folder map and engineering rules.
