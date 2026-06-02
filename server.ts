import express from 'express';
import { createServer as createHttpServer } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Server, type Socket } from 'socket.io';
import { createServer as createViteServer } from 'vite';
import { GameEngine } from './src/core/GameEngine';
import { DEFAULT_SETTINGS, otherPlayer, type GameSettings, type MoveOutcome, type Player } from './src/core/types';
import type {
  ClientToServerEvents,
  OnlineAction,
  OnlineRole,
  ServerToClientEvents,
  UndoRequest
} from './src/network/types';

interface Room {
  code: string;
  engine: GameEngine;
  sockets: Map<string, OnlineRole>;
  hostId: string;
  lastTick: number;
  pendingUndoRequest: UndoRequest | null;
}

type GameSocket = Socket<ClientToServerEvents, ServerToClientEvents>;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isProd = process.argv.includes('--prod') || process.env.NODE_ENV === 'production';
const port = Number(process.env.PORT ?? 5173);
const host = process.env.HOST ?? '0.0.0.0';
const rooms = new Map<string, Room>();
const socketRooms = new Map<string, string>();

const app = express();
const httpServer = createHttpServer(app);
const io = new Server<ClientToServerEvents, ServerToClientEvents>(httpServer);

if (isProd) {
  const distPath = path.join(__dirname, 'dist');
  app.use(express.static(distPath));
  app.get(/.*/, (_request, response) => {
    response.sendFile(path.join(distPath, 'index.html'));
  });
} else {
  const vite = await createViteServer({
    server: {
      middlewareMode: true,
      hmr: { server: httpServer }
    },
    appType: 'spa'
  });
  app.use(vite.middlewares);
}

io.on('connection', (socket) => {
  socket.on('room:create', (settings) => {
    leaveCurrentRoom(socket);

    const code = createRoomCode();
    const engine = new GameEngine(forceOnlineSettings(settings));
    const room: Room = {
      code,
      engine,
      sockets: new Map([[socket.id, 1]]),
      hostId: socket.id,
      lastTick: Date.now(),
      pendingUndoRequest: null
    };

    rooms.set(code, room);
    socketRooms.set(socket.id, code);
    socket.join(code);
    emitRoomState(room, '房间已创建');
  });

  socket.on('room:join', (rawCode) => {
    leaveCurrentRoom(socket);

    const code = rawCode.trim().toUpperCase();
    const room = rooms.get(code);
    if (!room) {
      socket.emit('room:error', { message: '没有找到这个房间' });
      return;
    }

    const role = nextRole(room);
    room.sockets.set(socket.id, role);
    socketRooms.set(socket.id, code);
    socket.join(code);
    ensureHost(room);
    emitRoomState(room, role === 'spectator' ? '已作为观战者加入' : '已加入房间');
  });

  socket.on('room:leave', () => {
    leaveCurrentRoom(socket);
  });

  socket.on('game:action', (action) => {
    const room = getSocketRoom(socket);
    if (!room) {
      socket.emit('room:error', { message: '尚未加入房间' });
      return;
    }

    const role = room.sockets.get(socket.id);
    if (!role || role === 'spectator') {
      socket.emit('room:error', { message: '观战者不能操作棋局' });
      return;
    }

    const outcome = applyAction(room, socket, role, action);
    if (!outcome.ok) {
      socket.emit('room:error', { message: outcome.message ?? '操作失败' });
      emitRoomState(room);
      return;
    }

    emitRoomState(room, outcome.message, outcome);
  });

  socket.on('disconnect', () => {
    leaveCurrentRoom(socket);
  });
});

setInterval(() => {
  const now = Date.now();
  for (const room of rooms.values()) {
    const delta = Math.min(0.5, (now - room.lastTick) / 1000);
    room.lastTick = now;
    if (room.engine.tick(delta)) {
      emitRoomState(room);
    }
  }
}, 250);

httpServer.listen(port, host, () => {
  const urls = getLanUrls(port);
  console.log(`Gravity Chess LAN server running at http://127.0.0.1:${port}/`);
  for (const url of urls) {
    console.log(`LAN: ${url}`);
  }
});

function applyAction(room: Room, socket: GameSocket, role: Player, action: OnlineAction): MoveOutcome {
  if (action.kind === 'reset') {
    if (socket.id !== room.hostId) {
      return { ok: false, message: '只有房主可以重开或应用设置' };
    }
    room.pendingUndoRequest = null;
    room.engine.reset(forceOnlineSettings(action.settings ?? room.engine.settings));
    return { ok: true, message: '房主已重开' };
  }

  if (action.kind === 'undo-request') {
    if (room.pendingUndoRequest) {
      return { ok: false, message: '已经有一个悔棋请求在等待回应' };
    }
    if (room.engine.history.length === 0) {
      return { ok: false, message: '没有可悔棋的步骤' };
    }
    if (!hasOpponent(room, role)) {
      return { ok: false, message: '对方不在线，无法请求悔棋' };
    }

    room.pendingUndoRequest = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      requester: role
    };
    room.engine.appendExternalLog('undo-request', `${room.engine.getPlayerName(role)}请求悔棋`, role);
    return { ok: true, message: `${room.engine.getPlayerName(role)}请求悔棋` };
  }

  if (action.kind === 'undo-accept') {
    const request = room.pendingUndoRequest;
    if (!request) {
      return { ok: false, message: '当前没有悔棋请求' };
    }
    if (role !== otherPlayer(request.requester)) {
      return { ok: false, message: '只有对方可以同意悔棋' };
    }

    room.engine.appendExternalLog('undo-accept', `${room.engine.getPlayerName(role)}同意悔棋`, role);
    const undone = room.engine.undo();
    room.pendingUndoRequest = null;
    return { ok: undone, message: undone ? '对方已同意悔棋' : '没有可悔棋的步骤' };
  }

  if (action.kind === 'undo-decline') {
    const request = room.pendingUndoRequest;
    if (!request) {
      return { ok: false, message: '当前没有悔棋请求' };
    }
    if (role !== otherPlayer(request.requester) && role !== request.requester) {
      return { ok: false, message: '不能回应这个悔棋请求' };
    }

    room.pendingUndoRequest = null;
    room.engine.appendExternalLog('undo-decline', `${room.engine.getPlayerName(role)}拒绝悔棋`, role);
    return { ok: true, message: role === request.requester ? '已取消悔棋请求' : '对方拒绝悔棋' };
  }

  if (room.engine.status !== 'playing') {
    return { ok: false, message: '对局已结束' };
  }

  if (room.engine.currentPlayer !== role) {
    return { ok: false, message: '还没轮到你' };
  }

  if (room.pendingUndoRequest) {
    return { ok: false, message: '请先处理悔棋请求' };
  }

  if (action.kind === 'check') {
    return room.engine.checkWinManually();
  }

  if (action.kind === 'flip') {
    return room.engine.flipGravity();
  }

  if (action.kind === 'drop') {
    if (typeof action.col !== 'number') {
      return { ok: false, message: '缺少列号' };
    }
    return room.engine.playColumn(action.col, action.mode === 'bomb' ? 'bomb' : 'drop');
  }

  return { ok: false, message: '未知操作' };
}

function emitRoomState(room: Room, message?: string, outcome?: MoveOutcome): void {
  ensureHost(room);
  const players = getPlayers(room);

  for (const [socketId, role] of room.sockets) {
    io.to(socketId).emit('room:state', {
      roomCode: room.code,
      role,
      isHost: socketId === room.hostId,
      players,
      pendingUndoRequest: room.pendingUndoRequest ? { ...room.pendingUndoRequest } : null,
      state: room.engine.exportState(),
      message,
      outcome
    });
  }
}

function leaveCurrentRoom(socket: GameSocket): void {
  const code = socketRooms.get(socket.id);
  if (!code) return;

  const room = rooms.get(code);
  socketRooms.delete(socket.id);
  socket.leave(code);

  if (!room) return;

  room.pendingUndoRequest = null;
  room.sockets.delete(socket.id);
  if (room.sockets.size === 0) {
    rooms.delete(code);
    return;
  }

  ensureHost(room);
  emitRoomState(room, '有玩家离开房间');
}

function getSocketRoom(socket: GameSocket): Room | null {
  const code = socketRooms.get(socket.id);
  return code ? rooms.get(code) ?? null : null;
}

function ensureHost(room: Room): void {
  if (room.sockets.has(room.hostId)) return;
  const firstPlayer = [...room.sockets.entries()].find(([, role]) => role === 1 || role === 2);
  const firstSocket = firstPlayer ?? [...room.sockets.entries()][0];
  if (firstSocket) {
    room.hostId = firstSocket[0];
  }
}

function nextRole(room: Room): OnlineRole {
  const roles = new Set(room.sockets.values());
  if (!roles.has(2)) return 2;
  if (!roles.has(1)) return 1;
  return 'spectator';
}

function getPlayers(room: Room) {
  const roles = [...room.sockets.values()];
  return {
    red: roles.includes(1),
    gold: roles.includes(2),
    spectators: roles.filter((role) => role === 'spectator').length
  };
}

function hasOpponent(room: Room, player: Player): boolean {
  const opponent = otherPlayer(player);
  return [...room.sockets.values()].includes(opponent);
}

function createRoomCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  for (let attempt = 0; attempt < 100; attempt += 1) {
    let code = '';
    for (let index = 0; index < 4; index += 1) {
      code += alphabet[Math.floor(Math.random() * alphabet.length)];
    }
    if (!rooms.has(code)) return code;
  }
  return String(Date.now()).slice(-4);
}

function forceOnlineSettings(settings: GameSettings): GameSettings {
  return {
    ...DEFAULT_SETTINGS,
    ...settings,
    matchMode: 'local'
  };
}

function getLanUrls(portNumber: number): string[] {
  const urls: string[] = [];
  for (const entries of Object.values(os.networkInterfaces())) {
    for (const entry of entries ?? []) {
      if (entry.family !== 'IPv4' || entry.internal) continue;
      urls.push(`http://${entry.address}:${portNumber}/`);
    }
  }
  return urls;
}
