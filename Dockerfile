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
COPY package.json package-lock.json tsconfig.json ./
RUN npm ci --ignore-scripts
COPY src ./src
RUN npm run build && npm prune --omit=dev

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json LICENSE ./
USER node
CMD ["node", "dist/index.js"]
