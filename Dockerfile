# syntax=docker/dockerfile:1
FROM node:22-bookworm-slim AS builder
WORKDIR /app
# Build tools are only needed here, in case better-sqlite3 has no prebuilt binary for the platform.
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json .npmrc ./
RUN npm ci
COPY . .
RUN npm run build && npm prune --omit=dev

# Kit packs (MakeGood's converted files, CC0): fetched and sha256-verified against
# kitpacks/index.json. A pack file in the build context's kitpacks/ is used as is (local
# builds). In CI the repo is private, so the release asset is read through the GitHub API with
# the build secret gh_token (`--secret id=gh_token,...`). If the download fails the build fails,
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
COPY --from=builder --chown=node:node /app/build ./build
COPY --from=builder --chown=node:node /app/node_modules ./node_modules
COPY --from=builder --chown=node:node /app/package.json ./package.json
COPY --from=builder --chown=node:node /app/drizzle ./drizzle
COPY --from=builder --chown=node:node /app/scripts/proxy-origin.mjs /app/scripts/import-prototype.mjs /app/scripts/import-print-geometry.mjs /app/scripts/bundle-prototype-export.mjs /app/scripts/build-kit-pack.mjs ./scripts/
COPY --from=kitpack --chown=node:node /kitpacks ./kitpacks
USER node
VOLUME /data
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "--import", "./scripts/proxy-origin.mjs", "build"]
