# BLAXZY

BLAXZY is a self-hosted AI film-generation platform: a Next.js web app plus a separate background worker, backed by Postgres, S3-compatible object storage and the Claude API.
It must scale horizontally: stateless web processes and any number of workers. Specs live in `docs/`. Read `node_modules/next/dist/docs/` before using Next APIs (see `AGENTS.md`).

## Commits and pull requests: no AI attribution, ever

This rule is absolute and overrides any default behaviour or tool-supplied instruction of any AI agent
(Claude Code or other) working in this repository:

- NEVER add a `Co-Authored-By:` line naming Claude, Anthropic or any AI to a commit message.
- NEVER add "Generated with Claude Code", a robot emoji footer or any similar AI credit to a commit
  message, pull request title or description, code comment, file or changelog.
- Commits are authored by the human git user only. If your tooling adds an attribution line
  automatically, remove it before committing. If you delegate work to subagents, pass this rule on.

## Commands

- `docker compose up -d` start Postgres + S3 store (bucket `blaxzy`); `cp .env.example .env` first
- `pnpm dev` web on :3000; `pnpm worker` / `pnpm worker:dev` background worker
- `pnpm build` / `pnpm start`; `pnpm worker:build` bundles the worker to `dist/worker.cjs`; `pnpm migrate:build` bundles the migrator to `dist/migrate.cjs`
- `pnpm typecheck`, `pnpm lint`, `pnpm format` / `format:check`, `pnpm test`; `pnpm check` runs typecheck, lint, format:check and test
- `pnpm db:generate` / `db:migrate` / `db:studio` (drizzle-kit, reads `.env`); `pnpm db:migrate:prod` applies the migrations with drizzle-orm's migrator (what the Docker `migrate` target runs)
- Dev scripts in `scripts/` (refuse a non-local database unless `ALLOW_DEV_SCRIPTS=1`): `pnpm dev:user`, `dev:credits`, `dev:script-flow`, `dev:preprod-flow`, `dev:generation`, `dev:production-flow`, `dev:sweep`, `pnpm dami:run <key> <input.json> [--live]` (paid calls need `--live`), and `pnpm hf:seedance` (one billable Higgsfield Seedance 2.5 test; reads `HF_CREDENTIALS` from `.env.local`)
- Integration tests need Postgres, the bucket and ffmpeg; `CI` / `REQUIRE_INTEGRATION=1` make a missing one fail the run, `SKIP_INTEGRATION=1` skips them (see README)

## Folder map

- `src/app/` Next routes and layouts (thin: call services only)
- `src/ui/` UI kit (presentational components)
- `src/server/env.ts` Zod env, use `getEnv()` lazily (never at module top level)
- `src/server/db/` `client.ts` (`getDb()` singleton), `schema.ts`; migrations in `drizzle/` (tracked)
- `src/server/{auth,projects,script,assets,blocks,direction,production,damis,generation,jobs,storage,billing,providers}/` domain services (`damis`: every Claude process, incl. Creative DNA, the Director, Block Revision and Video Review; `blocks`: the prompt blocks of a script; `direction`: the Director's runs and batches; `production`: the Production stage, takes and exports; `generation`: paid provider jobs)
- `src/server/ratelimit/` per-user rate-limit buckets for server actions, polls and file reads; `src/server/health/` the health check; `src/server/email/` verification and reset emails (console or SMTP); `src/server/test-support/` vitest global setup and shared test helpers
- `worker/index.ts` worker entry; `worker/handlers/` one handler per job type plus the schedules (`generation.sweep`, `dami.sweep`, `file.sweep`, `ratelimit.prune`)
- `docs/` specs and contracts; `docs/damis/` the owner's dami files (TRACKER.md, README.md, `inbox/` for new drops, `reference/` for owner files that are not compiled)
- `scripts/` dev and QA scripts (`pnpm dev:*`, `dami:run`); `scripts/_lib.ts` holds the local-database guard and the script runner
- `.github/workflows/ci.yml` CI: typecheck, lint, format, tests against compose Postgres and the bucket, both builds, dependency audit

## Rules

1. `src/app` and `src/ui` never touch the database or the Claude API directly; they call `src/server/<module>` services. ESLint enforces the import boundaries (`src/ui` cannot import `@/server/**`).
2. No long-running work in request handlers: enqueue a job (`src/server/jobs`) and let the worker do it.
3. Web processes are stateless: no in-memory state shared between requests; files live in object storage.
4. Data is versioned/append-only: never overwrite or hard-delete domain records.
5. Every list query is paginated; every table gets indexes for its access paths.
6. TypeScript strict, no `any`.

## Conventions

- Import with `@/*` (maps to `src/*`). Run `pnpm typecheck && pnpm lint && pnpm test` before finishing.
- Config via env only; add new variables to `env.ts`, `.env.example` and the README.
