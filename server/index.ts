// OWNER: net
/**
 * Process glue (ARCH.md §1.15): HTTP health on `/` (Fly), JSON stats on `/healthz`, WebSocket on
 * `/ws` behind an origin allow-list, 8 ms tick driver, heartbeat, graceful SIGTERM. PORT from env
 * (8080 on Fly, 3001 for the Vite dev proxy), HOST 0.0.0.0, single process, no database.
 */
import { createServer, type IncomingMessage } from 'node:http';
import { WebSocketServer, type WebSocket } from 'ws';
import { LIMITS } from '../src/net/protocol';
import { RoomManager, type SocketLike } from './rooms';

const PORT = Number(process.env.PORT ?? 3001);
const HOST = '0.0.0.0';
const TICK_INTERVAL_MS = 8;
const DEFAULT_ORIGINS: readonly string[] = [
  'https://flash-golf.vercel.app',
  'https://flash-golf-*.vercel.app',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
];

function globToRegExp(glob: string): RegExp {
  const escaped = glob.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp(`^${escaped}$`);
}

const allowedOrigins = (process.env.ALLOWED_ORIGINS ?? DEFAULT_ORIGINS.join(','))
  .split(',')
  .map((s) => s.trim())
  .filter((s) => s.length > 0)
  .map(globToRegExp);

function originAllowed(origin: string | undefined): boolean {
  if (origin === undefined) return false;
  return allowedOrigins.some((re) => re.test(origin));
}

/** `fly-client-ip` when present, else the first X-Forwarded-For hop, else the socket address. */
function clientIp(req: IncomingMessage): string {
  const fly = req.headers['fly-client-ip'];
  if (typeof fly === 'string' && fly.length > 0) return fly;
  const forwarded = req.headers['x-forwarded-for'];
  const first = (Array.isArray(forwarded) ? forwarded[0] : forwarded)?.split(',')[0]?.trim();
  if (first !== undefined && first.length > 0) return first;
  return req.socket.remoteAddress ?? 'unknown';
}

function wrapSocket(ws: WebSocket, ip: string): SocketLike {
  return {
    ip,
    isAlive: true,
    send: (data) => ws.send(data),
    close: (code, reason) => ws.close(code, reason),
    terminate: () => ws.terminate(),
    ping: () => ws.ping(),
    get readyState() {
      return ws.readyState;
    },
    get bufferedAmount() {
      return ws.bufferedAmount;
    },
  };
}

const log = (msg: string): void => {
  process.stdout.write(`${new Date().toISOString()} ${msg}\n`);
};

const rooms = new RoomManager({ now: () => performance.now(), log });
const sockets = new Map<WebSocket, SocketLike>();

/** The title screen's health pill fetches cross-origin from the client host: allowed origins get CORS. */
function httpHeaders(origin: string | undefined, contentType: string): Record<string, string> {
  const headers: Record<string, string> = { 'content-type': contentType, 'cache-control': 'no-store', vary: 'origin' };
  if (origin !== undefined && originAllowed(origin)) headers['access-control-allow-origin'] = origin;
  return headers;
}

const server = createServer((req, res) => {
  if (req.url === '/healthz') {
    res.writeHead(200, httpHeaders(req.headers.origin, 'application/json'));
    res.end(JSON.stringify(rooms.stats()));
    return;
  }
  res.writeHead(200, httpHeaders(req.headers.origin, 'text/plain'));
  res.end('ok');
});

const wss = new WebSocketServer({ noServer: true, maxPayload: LIMITS.maxPayloadBytes, perMessageDeflate: false });

server.on('upgrade', (req, socket, head) => {
  const path = (req.url ?? '').split('?')[0];
  if (path !== '/ws' || !originAllowed(req.headers.origin)) {
    socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => {
    const wrapped = wrapSocket(ws, clientIp(req));
    sockets.set(ws, wrapped);
    rooms.handleOpen(wrapped);
    ws.on('pong', () => rooms.handlePong(wrapped));
    ws.on('message', (data) => rooms.handleMessage(wrapped, data.toString()));
    ws.on('close', () => {
      sockets.delete(ws);
      rooms.handleClose(wrapped);
    });
    ws.on('error', () => ws.terminate());
  });
});

const tickTimer = setInterval(() => rooms.tickAll(performance.now()), TICK_INTERVAL_MS);
const heartbeatTimer = setInterval(() => {
  rooms.heartbeat();
  for (const [ws, wrapped] of sockets) {
    wrapped.isAlive = false;
    ws.ping();
  }
}, LIMITS.heartbeatMs);

function shutdown(): void {
  clearInterval(tickTimer);
  clearInterval(heartbeatTimer);
  rooms.shutdown();
  wss.close();
  server.close(() => process.exit(0));
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
process.on('uncaughtException', (err) => log(`uncaughtException ${err.stack ?? err.message}`));
// A failed bind (EADDRINUSE, EACCES) must not leave a zombie kept alive by the timers: exit so Fly restarts us.
server.on('error', (err) => {
  log(`listen failed: ${err.message}`);
  process.exit(1);
});

server.listen(PORT, HOST, () => log(`flash-golf server listening on ${HOST}:${PORT}`));
