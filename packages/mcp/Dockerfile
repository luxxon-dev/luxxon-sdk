# Dockerfile for catalog hosting (Glama, Smithery, etc.). Builds
# @luxxon/mcp from local sources, runs it over stdio.
#
# Catalogs use this for introspection: they spin up the container,
# negotiate MCP `initialize` + `tools/list` over stdin/stdout, and
# read the static tool schema. The server boots without
# LUXXON_API_KEY (added in v0.1.x — earlier versions hard-exited);
# tool *invocation* still requires a key, which catalogs don't do
# during introspection.

FROM node:20-alpine AS build
WORKDIR /app

# Workspace metadata first — lets pnpm resolve the workspace + a
# focused install for the mcp package without touching unrelated
# code.
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages/sdk/package.json ./packages/sdk/
COPY packages/mcp/package.json ./packages/mcp/

RUN corepack enable && corepack prepare pnpm@9 --activate \
    && pnpm install --frozen-lockfile --filter @luxxon/mcp...

COPY packages/sdk ./packages/sdk
COPY packages/mcp ./packages/mcp

RUN pnpm --filter @luxxon/sdk build \
    && pnpm --filter @luxxon/mcp build

FROM node:20-alpine AS runtime
WORKDIR /app

COPY --from=build /app/package.json /app/pnpm-workspace.yaml /app/pnpm-lock.yaml ./
COPY --from=build /app/packages/sdk ./packages/sdk
COPY --from=build /app/packages/mcp ./packages/mcp
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages/mcp/node_modules ./packages/mcp/node_modules
COPY --from=build /app/packages/sdk/node_modules ./packages/sdk/node_modules

WORKDIR /app/packages/mcp
# stdio transport — no port to expose. Catalog runtime pipes
# stdin/stdout to the MCP client.
CMD ["node", "dist/server.js"]
