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
| `ANTHROPIC_API_KEY`                                                   | unset                            | Claude API                                                                                                  |

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
docker run --env-file .env blaxzy node worker.cjs           # worker
```

See `CLAUDE.md` for commands, folder map and engineering rules.
