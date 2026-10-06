import { WebSocketServer, WebSocket } from 'ws';
import * as v from '../lib/validate.js';
import { HttpError } from '../lib/errors.js';

const TICK_MS = 1000 / 15; // pose broadcast rate
const JOIN_TIMEOUT_MS = 5000;
const HEARTBEAT_MS = 30_000;
// The HUD leaderboard lists everyone on the site (capped so messages stay small).
const LEADERBOARD_SIZE = 50;

/** Simple token bucket: `rate` messages refilled per `perMs`. */
function bucket(rate, perMs) {
  let tokens = rate;
  let last = Date.now();
  return () => {
    const now = Date.now();
    tokens = Math.min(rate, tokens + ((now - last) / perMs) * rate);
    last = now;
    if (tokens < 1) return false;
    tokens -= 1;
    return true;
  };
}

/**
 * Multiplayer layer on `/ws`.
 * client -> server: join | pose | chat | emote | connect | switch-room
 * server -> client: welcome | peer-join | peer-leave | poses | chat | emote | connected | leaderboard | error
 */
export function attachRealtime(server, { store, config }) {
  const wss = new WebSocketServer({
    server,
    path: '/ws',
    maxPayload: 4 * 1024,
    // Reject cross-site pages trying to open a socket to us.
    verifyClient: ({ origin, req }) => {
      if (!origin) return true; // non-browser clients (tests, tools) still need a valid token to join
      try {
        return new URL(origin).host === req.headers.host;
      } catch {
        return false;
      }
    },
  });

  /** @type {Map<WebSocket, {player, room, pose, hands, dirty, alive, limits}>} */
  const clients = new Map();

  const send = (ws, msg) => ws.readyState === WebSocket.OPEN && ws.send(JSON.stringify(msg));
  const inRoom = (room) => [...clients.entries()].filter(([, c]) => c.room === room);
  const broadcast = (room, msg, except) => {
    const data = JSON.stringify(msg);
    for (const [ws] of inRoom(room)) if (ws !== except && ws.readyState === WebSocket.OPEN) ws.send(data);
  };
  const broadcastAll = (msg) => {
    for (const ws of clients.keys()) send(ws, msg);
  };
  const peerState = (c) => ({ player: c.player, pose: c.pose, hands: c.hands });
  const fail = (ws, code, message) => send(ws, { t: 'error', code, message });

  /** Site-wide leaderboard; online players are tagged with the name of the room they're in. */
  function leaderboardRows() {
    const where = new Map([...clients.values()].map((c) => [c.player.id, c.room]));
    return store
      .leaderboard(LEADERBOARD_SIZE)
      .map((p) => ({ ...p, room: where.has(p.id) ? (store.getRoom(where.get(p.id))?.name ?? null) : null }));
  }
  const pushLeaderboard = () => broadcastAll({ t: 'leaderboard', top: leaderboardRows() });

  function handleJoin(ws, msg) {
    const player = store.authenticate(msg.id, msg.token);
    if (!player) {
      fail(ws, 'unauthorized', 'invalid player credentials');
      return ws.close(4001, 'unauthorized');
    }
    const room = store.getRoom(msg.room) ? msg.room : 'plaza';

    // One live session per player: kick the older tab/device.
    for (const [other, c] of clients) {
      if (c.player.id === player.id) {
        fail(other, 'replaced', 'you joined from another device');
        other.close(4002, 'replaced');
        clients.delete(other);
        broadcast(c.room, { t: 'peer-leave', id: player.id });
      }
    }

    const client = {
      player,
      room: null,
      pose: null,
      hands: [null, null],
      dirty: false,
      alive: true,
      limits: { pose: bucket(40, 1000), chat: bucket(5, 5000), action: bucket(5, 2000), room: bucket(3, 3000) },
    };
    clients.set(ws, client);
    clearTimeout(ws.joinTimer);
    enterRoom(ws, client, room);
    pushLeaderboard();
    store.touchPlayer(player.id).catch(() => {});
  }

  /** Place a client in a room: spawn them, send the room snapshot, and announce them to the room. */
  function enterRoom(ws, client, room) {
    // Spawn in the open gap between the benches on the +Z side of the fountain.
    const spawn = [(Math.random() - 0.5) * 3, 1.7, 7.5 + Math.random() * 2, 0, 1, 0, 0];
    client.room = room;
    client.pose = spawn;
    client.hands = [null, null];
    client.dirty = false;

    send(ws, {
      t: 'welcome',
      self: client.player,
      room: store.getRoom(room),
      spawn,
      connectDistance: config.connectDistance,
      peers: inRoom(room)
        .filter(([other]) => other !== ws)
        .map(([, c]) => peerState(c)),
      leaderboard: leaderboardRows(),
    });
    broadcast(room, { t: 'peer-join', ...peerState(client) }, ws);
  }

  /** Walking into a booth portal moves the player to another room without reconnecting. */
  function handleSwitchRoom(ws, client, roomId) {
    if (!client.limits.room()) return fail(ws, 'slow_down', 'you are switching rooms too fast');
    if (typeof roomId !== 'string' || !store.getRoom(roomId)) return fail(ws, 'not_found', 'that room does not exist');
    if (roomId === client.room) return;
    broadcast(client.room, { t: 'peer-leave', id: client.player.id }, ws);
    enterRoom(ws, client, roomId);
    pushLeaderboard();
  }

  async function handleConnect(ws, client, targetId) {
    const target = [...clients.values()].find((c) => c.player.id === targetId && c.room === client.room);
    if (!target) return fail(ws, 'not_here', 'that player is not in this room');
    const dx = client.pose[0] - target.pose[0];
    const dz = client.pose[2] - target.pose[2];
    if (Math.hypot(dx, dz) > config.connectDistance) {
      return fail(ws, 'too_far', `get within ${config.connectDistance}m of ${target.player.name} to connect`);
    }
    try {
      const result = await store.recordConnection(client.player.id, target.player.id);
      client.player = result.a;
      target.player = result.b;
      broadcast(client.room, {
        t: 'connected',
        a: result.a,
        b: result.b,
        earned: result.earned,
        shared: result.shared,
      });
      pushLeaderboard();
    } catch (err) {
      if (err instanceof HttpError) fail(ws, err.code, err.message);
      else throw err;
    }
  }

  function handleMessage(ws, raw) {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return fail(ws, 'bad_json', 'messages must be JSON');
    }
    if (!msg || typeof msg.t !== 'string') return;

    const client = clients.get(ws);
    if (!client) {
      if (msg.t === 'join') return handleJoin(ws, msg);
      return fail(ws, 'not_joined', 'send a join message first');
    }

    switch (msg.t) {
      case 'pose': {
        if (!client.limits.pose()) return;
        const head = v.pose(msg.h);
        if (!head) return;
        client.pose = head;
        client.hands = [v.pose(msg.l), v.pose(msg.r)];
        client.dirty = true;
        return;
      }
      case 'chat': {
        if (!client.limits.chat()) return fail(ws, 'slow_down', 'you are chatting too fast');
        const text = v.chatText(msg.text);
        if (text) broadcast(client.room, { t: 'chat', id: client.player.id, name: client.player.name, text, at: Date.now() });
        return;
      }
      case 'emote': {
        if (!client.limits.action() || !v.EMOTES.includes(msg.e)) return;
        broadcast(client.room, { t: 'emote', id: client.player.id, e: msg.e });
        return;
      }
      case 'switch-room':
        return handleSwitchRoom(ws, client, msg.room);
      case 'connect': {
        if (!client.limits.action()) return fail(ws, 'slow_down', 'slow down');
        if (typeof msg.target !== 'string') return;
        handleConnect(ws, client, msg.target).catch((err) => {
          console.error('[ws] connect failed', err);
          fail(ws, 'internal', 'could not record connection');
        });
        return;
      }
      default:
        return fail(ws, 'unknown_type', `unknown message type ${String(msg.t).slice(0, 20)}`);
    }
  }

  wss.on('connection', (ws) => {
    ws.joinTimer = setTimeout(() => ws.close(4000, 'join timeout'), JOIN_TIMEOUT_MS);
    ws.on('message', (raw) => handleMessage(ws, raw));
    ws.on('pong', () => {
      const c = clients.get(ws);
      if (c) c.alive = true;
    });
    ws.on('close', () => {
      clearTimeout(ws.joinTimer);
      const c = clients.get(ws);
      if (!c) return;
      clients.delete(ws);
      broadcast(c.room, { t: 'peer-leave', id: c.player.id });
      pushLeaderboard();
      store.touchPlayer(c.player.id).catch(() => {});
    });
    ws.on('error', () => {});
  });

  // Batch pose updates per room so each client gets one message per tick.
  const tick = setInterval(() => {
    const byRoom = new Map();
    for (const c of clients.values()) {
      if (!c.dirty) continue;
      c.dirty = false;
      if (!byRoom.has(c.room)) byRoom.set(c.room, []);
      byRoom.get(c.room).push({ id: c.player.id, h: c.pose, l: c.hands[0], r: c.hands[1] });
    }
    for (const [room, list] of byRoom) broadcast(room, { t: 'poses', list });
  }, TICK_MS);

  const heartbeat = setInterval(() => {
    for (const [ws, c] of clients) {
      if (!c.alive) {
        ws.terminate();
        continue;
      }
      c.alive = false;
      ws.ping();
    }
  }, HEARTBEAT_MS);

  return {
    wss,
    roomCounts() {
      const counts = {};
      for (const c of clients.values()) counts[c.room] = (counts[c.room] || 0) + 1;
      return counts;
    },
    close() {
      clearInterval(tick);
      clearInterval(heartbeat);
      for (const ws of wss.clients) ws.terminate();
      return new Promise((resolve) => wss.close(resolve));
    },
  };
}
