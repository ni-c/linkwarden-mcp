# Build stage
FROM node:24-alpine@sha256:e67514e5d0f6c46656005e1b693b2ec9d52e80b641307de684d4a015ba7a4eaf AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY tsconfig.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev --ignore-scripts

# Runtime
FROM node:24-alpine@sha256:e67514e5d0f6c46656005e1b693b2ec9d52e80b641307de684d4a015ba7a4eaf
WORKDIR /app
ENV NODE_ENV=production

# CVE-2026-14456: the pinned base image carries OpenSSL 3.5.7-r0, and Alpine's
# fixed 3.5.8-r0 has not been rebuilt into node:24-alpine yet. Upgrading these
# two packages by name rather than running a blanket `apk upgrade` keeps the
# rest of the image exactly as the digest pins it. Drop this once the base
# image ships the fix.
RUN apk add --no-cache --upgrade libcrypto3 libssl3

# Remove the npm and corepack that ship inside the base image. The entrypoint is
# plain `node`, so neither is ever used at runtime, and the packages they bundle
# are the only source of HIGH/CRITICAL findings in this image: on
# 2026-08-17 that was brace-expansion 5.0.6 (CVE-2026-13149, CVE-2026-14257,
# CVE-2026-69152), ip-address 10.2.0 (CVE-2026-69192) and tar 7.5.16
# (CVE-2026-59873, CVE-2026-59874). Deleting them fixes the scan rather than
# suppressing it. Dependencies are installed in the build stage, which keeps its
# npm.
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
    /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
# The server reports its version from package.json at runtime. The lockfile is not
# copied: nothing installs in this stage, so it would only be dead weight.
COPY package.json ./

# Ownership proof for the MCP Registry: must match server.json's name exactly.
LABEL io.modelcontextprotocol.server.name="io.github.ni-c/linkwarden-mcp"

# Drop root: the node image ships an unprivileged `node` user (uid 1000). A
# bind-mounted host directory must be chowned to 1000:1000 on the HOST — the image
# layer's ownership does not apply to it.
USER node

# stdio transport only — no port, no healthcheck. The server starts without
# credentials (tools are listable, so registries and inspectors can introspect it);
# every call then fails with setup instructions instead of reaching the API.
ENTRYPOINT ["node", "dist/index.js"]
