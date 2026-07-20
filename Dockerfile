# Container image for the LabelGrid MCP server (stdio transport).
#
# The server reads its configuration from environment variables; without
# LABELGRID_API_TOKEN it starts in guided setup mode, so the container always
# boots and responds to MCP introspection.
#
#   docker build -t labelgrid-mcp .
#   docker run --rm -i -e LABELGRID_API_TOKEN=your-token labelgrid-mcp

FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/core/package.json packages/core/
COPY packages/mcp/package.json packages/mcp/
RUN npm ci --ignore-scripts
COPY packages/core packages/core
COPY packages/mcp packages/mcp
RUN npm run build && npm prune --omit=dev

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
# The workspace layout is preserved so the @labelgrid/core symlink in
# node_modules keeps resolving to packages/core.
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages/core/package.json ./packages/core/package.json
COPY --from=build /app/packages/core/dist ./packages/core/dist
COPY --from=build /app/packages/mcp/package.json ./packages/mcp/package.json
COPY --from=build /app/packages/mcp/dist ./packages/mcp/dist
COPY LICENSE ./
USER node
CMD ["node", "packages/mcp/dist/index.js"]
