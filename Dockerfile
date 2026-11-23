# syntax=docker/dockerfile:1
# App build, once, on the machine running the build (BUILDPLATFORM), never under QEMU: the
# multi-platform image build runs on an amd64 runner, and the bundler (Vite) intermittently hangs
# when emulated for arm64. build/ is platform-independent JavaScript (the three vite builds in
# `npm run build` emit only .js/.css/assets/JSON; better-sqlite3 stays an external import and is
# resolved from node_modules at run time), so one build serves every target platform.
FROM --platform=$BUILDPLATFORM node:22-bookworm-slim AS build
WORKDIR /app
# Build tools are only needed here, in case better-sqlite3 has no prebuilt binary for the platform.
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json .npmrc ./
RUN npm ci
COPY . .
RUN npm run build

# Production dependencies, installed for the target platform (the native better-sqlite3 binary
# must match the architecture of the final image), without dev dependencies and without building
# the app.
FROM node:22-bookworm-slim AS deps
WORKDIR /app
# Build tools only in case better-sqlite3 has no prebuilt binary for the platform.
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json .npmrc ./
RUN npm ci --omit=dev

# Kit packs (MakeGood's converted files, CC0, plus jeepxj's one-piece push handle, CC BY-NC): fetched and sha256-verified against
# kitpacks/index.json. A pack file in the build context's kitpacks/ is used as is (local
# builds). In CI the release asset is read through the GitHub API with the build secret
# gh_token (`--secret id=gh_token,...`; needed only for a private fork, the plain release URL works
# on the public repository). If the download fails the build fails,
# unless --build-arg KITPACK_OPTIONAL=1 (the app then tries again at first start).
FROM node:22-bookworm-slim AS kitpack
ARG KITPACK_URL=""
ARG KITPACK_OPTIONAL=0
ARG KITPACK_REPO=ayostepht/TMT-Build-Tracker
RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates \
    && rm -rf /var/lib/apt/lists/*
COPY scripts/fetch-kitpacks.sh /usr/local/bin/fetch-kitpacks
COPY kitpacks /kitpacks-context
RUN --mount=type=secret,id=gh_token,required=false \
    KITPACK_URL="$KITPACK_URL" KITPACK_OPTIONAL="$KITPACK_OPTIONAL" KITPACK_REPO="$KITPACK_REPO" \
    GH_TOKEN_FILE=/run/secrets/gh_token \
    fetch-kitpacks /kitpacks-context/index.json /kitpacks-context /kitpacks

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production \
    BODY_SIZE_LIMIT=1100M \
    PORT=3000 \
    HOST=0.0.0.0 \
    DATABASE_URL=/data/tmt.db \
    KITPACK_DIR=/app/kitpacks
# PUBLIC_URL is intentionally unset: the origin is then taken from each request
# (http by default, https when a proxy sends X-Forwarded-Proto). See the README.
WORKDIR /app
RUN mkdir -p /data && chown node:node /data
COPY --from=build --chown=node:node /app/build ./build
COPY --from=deps --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/package.json ./package.json
COPY --from=build --chown=node:node /app/drizzle ./drizzle
COPY --from=build --chown=node:node /app/scripts/proxy-origin.mjs /app/scripts/response-defaults.mjs /app/scripts/import-print-geometry.mjs /app/scripts/build-kit-pack.mjs /app/scripts/reset-password-link.mjs ./scripts/
COPY --from=kitpack --chown=node:node /kitpacks ./kitpacks
USER node
VOLUME /data
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "--import", "./scripts/proxy-origin.mjs", "build"]
