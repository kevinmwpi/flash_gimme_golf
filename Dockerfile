# Flash Golf game server (WebSocket rooms + authoritative sim). Used by fly.toml.
# Drop-in contract: HTTP 200 on /, WebSocket on /ws, PORT from env (8080 on Fly), single process, no DB.
# Multi-stage (ARCH.md §6): bundle server/index.ts with esbuild, run it on node:22-alpine as `node`.

FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json tsconfig.server.json ./
COPY server ./server
COPY src/sim ./src/sim
COPY src/net/protocol.ts ./src/net/protocol.ts
RUN npm run build:server

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist-server ./dist-server
USER node
EXPOSE 8080
CMD ["node", "dist-server/index.mjs"]
