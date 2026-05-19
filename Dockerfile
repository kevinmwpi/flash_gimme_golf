# Flash Golf game server — WebSocket lobby + authoritative sim.
# Used by fly.toml. The frontend on Vercel must point VITE_WS_URL at
# wss://<this-app>.fly.dev/ws after the first successful deploy.

FROM node:20-alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY server ./server
COPY src/game ./src/game
COPY src/net ./src/net

ENV NODE_ENV=production
EXPOSE 8080

CMD ["npx", "tsx", "server/index.ts"]
