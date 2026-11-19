# syntax=docker/dockerfile:1

# Two images from one build:
#   web    (default target): node server.js   (Next standalone output)
#   worker (--target worker): node worker.cjs  (esbuild bundle + sharp + ffmpeg)
#   migrate (--target migrate): node migrate.cjs  (applies drizzle/ migrations, then exits)
# The worker is bundled with esbuild into a single file. Only native packages stay outside the
# bundle (`--external:sharp`); they are installed for the worker in /app/worker/node_modules.
# ffmpeg (sample video) comes from the distribution in the worker image only.

ARG NODE_VERSION=24

FROM node:${NODE_VERSION}-alpine AS base
RUN corepack enable
WORKDIR /app

FROM base AS deps
COPY package.json pnpm-lock.yaml ./
# ffmpeg-static is for local development only (the worker image uses the distribution's ffmpeg):
# pointing its installer at an existing file makes it skip downloading a binary nobody ships.
RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store \
    touch /tmp/no-ffmpeg-static \
 && FFMPEG_BIN=/tmp/no-ffmpeg-static pnpm install --frozen-lockfile

FROM deps AS build
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
# next.config.ts bakes the Content-Security-Policy into the build, and the policy must allow the
# origin browsers use for presigned S3 URLs: pass it with
# `docker build --build-arg S3_PUBLIC_ENDPOINT=https://s3.example.com .`
# (unset: images, media and uploads are allowed from any https: origin). Not a secret.
ARG S3_PUBLIC_ENDPOINT=""
ARG S3_ENDPOINT=""
ENV S3_PUBLIC_ENDPOINT=$S3_PUBLIC_ENDPOINT     S3_ENDPOINT=$S3_ENDPOINT
# Browser error tracking (optional): the DSN the browser reports with is inlined at build time.
ARG NEXT_PUBLIC_SENTRY_DSN=""
ARG NEXT_PUBLIC_SENTRY_ENVIRONMENT=""
ENV NEXT_PUBLIC_SENTRY_DSN=$NEXT_PUBLIC_SENTRY_DSN     NEXT_PUBLIC_SENTRY_ENVIRONMENT=$NEXT_PUBLIC_SENTRY_ENVIRONMENT
RUN pnpm build && pnpm worker:build && pnpm migrate:build

# The worker's native dependencies (sharp + its prebuilt libvips for this platform), at the exact
# version pinned in package.json, in a flat node_modules next to the bundle.
FROM base AS worker-deps
WORKDIR /opt/worker
COPY package.json /tmp/package.json
RUN SHARP_VERSION="$(node -p "require('/tmp/package.json').dependencies.sharp")" \
 && echo '{"private":true}' > package.json \
 && npm install --omit=dev --no-audit --no-fund --no-package-lock "sharp@${SHARP_VERSION}" \
 && node -e "require('sharp')"

# What both images share: Node and the unprivileged user.
FROM node:${NODE_VERSION}-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1
RUN addgroup -S -g 1001 app && adduser -S -u 1001 -G app app

FROM runtime AS worker
# Fonts for text in rendered images and clips (sample placeholders use DejaVu Sans), and ffmpeg
# for the sample provider's video (H.264 + AAC).
RUN apk add --no-cache fontconfig font-dejavu ffmpeg \
 && ffmpeg -hide_banner -encoders | grep -q libx264
ENV FFMPEG_PATH=/usr/bin/ffmpeg
COPY --from=build --chown=app:app /app/dist/worker.cjs ./worker/index.cjs
COPY --from=worker-deps --chown=app:app /opt/worker/node_modules ./worker/node_modules
# `node worker.cjs` is the entry point; modules resolve from /app/worker/node_modules.
RUN printf 'require("./worker/index.cjs");\n' > worker.cjs && chown app:app worker.cjs
# No HEALTHCHECK: the worker serves no port and writes no heartbeat, so a probe could only check
# that the process exists, which the container runtime already tracks (use a restart policy).
USER app
CMD ["node", "worker.cjs"]

FROM runtime AS web
ENV PORT=3000 \
    HOSTNAME=0.0.0.0
COPY --from=build --chown=app:app /app/.next/standalone ./
COPY --from=build --chown=app:app /app/.next/static ./.next/static
COPY --from=build --chown=app:app /app/public ./public
USER app
EXPOSE 3000
# GET /api/health (readiness) answers 200 while the database, the bucket and the queue answer, also when
# only the worker is down (200 "degraded"); alpine has no curl, so use node.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3   CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health',{signal:AbortSignal.timeout(4000)}).then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]
CMD ["node", "server.js"]
