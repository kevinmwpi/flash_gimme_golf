import { createServer } from 'node:http';
import { WebSocket, WebSocketServer } from 'ws';
import type { ClientMessage } from '../src/net/protocol';
import { handleClientMessage, handleDisconnect } from './rooms';

const PORT = Number(process.env.PORT) || 3001;

const httpServer = createServer((_req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('Flash Golf game server\n');
});

const wss = new WebSocketServer({ server: httpServer, path: '/ws' });

wss.on('connection', (ws) => {
  ws.on('message', (data) => {
    try {
      const message = JSON.parse(String(data)) as ClientMessage;
      handleClientMessage(ws, message);
    } catch {
      ws.send(JSON.stringify({ type: 'error', message: 'Invalid message' }));
    }
  });

  ws.on('close', () => handleDisconnect(ws));
});

httpServer.listen(PORT, () => {
  console.log(`Flash Golf server listening on http://localhost:${PORT} (ws path /ws)`);
});
