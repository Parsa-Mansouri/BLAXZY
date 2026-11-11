# syntax=docker/dockerfile:1

# One image, two roles:
#   web    (default): node server.js            (Next standalone output)
#   worker          : node worker.cjs           (docker run <image> node worker.cjs)
# The worker is bundled with esbuild into a single file. Only native packages stay outside the
# bundle (`--external:sharp`); they are installed for the worker in /app/worker/node_modules.

ARG NODE_VERSION=24

FROM node:${NODE_VERSION}-alpine AS base
RUN corepack enable
WORKDIR /app

FROM base AS deps
COPY package.json pnpm-lock.yaml ./
RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile

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

FROM node:${NODE_VERSION}-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0
# Fonts for text in rendered images (sample provider placeholders use DejaVu Sans).
RUN apk add --no-cache fontconfig font-dejavu \
 && addgroup -S -g 1001 app && adduser -S -u 1001 -G app app
COPY --from=build --chown=app:app /app/.next/standalone ./
COPY --from=build --chown=app:app /app/.next/static ./.next/static
COPY --from=build --chown=app:app /app/public ./public
COPY --from=build --chown=app:app /app/dist/worker.cjs ./worker/index.cjs
COPY --from=worker-deps --chown=app:app /opt/worker/node_modules ./worker/node_modules
# `node worker.cjs` stays the entry point; modules resolve from /app/worker/node_modules.
RUN printf 'require("./worker/index.cjs");\n' > worker.cjs && chown app:app worker.cjs
USER app
EXPOSE 3000
CMD ["node", "server.js"]
