# Build stage
FROM node:24-alpine@sha256:d32cdf619f63fe0471182d08996dd516c6275bb5fd31ae06e55a570bd9e1ad43 AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY tsconfig.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev --ignore-scripts

# Runtime
FROM node:24-alpine@sha256:d32cdf619f63fe0471182d08996dd516c6275bb5fd31ae06e55a570bd9e1ad43
WORKDIR /app
ENV NODE_ENV=production

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
# The server reports its version from package.json at runtime.
COPY package.json package-lock.json ./

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
