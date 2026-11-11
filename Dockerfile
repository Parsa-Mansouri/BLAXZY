# syntax=docker/dockerfile:1

# Two images from one build:
#   web    (default target): node server.js   (Next standalone output)
#   worker (--target worker): node worker.cjs  (esbuild bundle + sharp + ffmpeg)
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
RUN pnpm build && pnpm worker:build

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
CMD ["node", "server.js"]
