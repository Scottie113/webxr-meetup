import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { WebSocket } from 'ws';
import { JsonStore } from '../server/store/jsonStore.js';
import { createApp } from '../server/app.js';
import { attachRealtime } from '../server/realtime/socket.js';
import { testConfig } from './helpers.js';

// The realtime layer is transport-agnostic, so plain HTTP is fine for tests.
let server, realtime, store, url;

before(async () => {
  const config = testConfig({ connectDistance: 3 });
  store = new JsonStore(null);
  server = http.createServer(createApp({ store, config, presence: { roomCounts: () => realtime.roomCounts() } }));
  realtime = attachRealtime(server, { store, config });
  server.listen(0);
  await once(server, 'listening');
  url = `ws://127.0.0.1:${server.address().port}/ws`;
});

after(async () => {
  await realtime.close();
  server.close();
});

/** Open a socket and collect messages; `next(type)` resolves with the next message of that type. */
function client() {
  const ws = new WebSocket(url);
  const inbox = [];
  const waiters = [];
  ws.on('message', (raw) => {
    const msg = JSON.parse(raw);
    const i = waiters.findIndex((w) => w.type === msg.t);
    if (i >= 0) waiters.splice(i, 1)[0].resolve(msg);
    else inbox.push(msg);
  });
  return {
    ws,
    send: (msg) => ws.send(JSON.stringify(msg)),
    next(type, timeout = 2000) {
      const i = inbox.findIndex((m) => m.t === type);
      if (i >= 0) return Promise.resolve(inbox.splice(i, 1)[0]);
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`timed out waiting for ${type}`)), timeout);
        waiters.push({ type, resolve: (m) => (clearTimeout(timer), resolve(m)) });
      });
    },
    opened: once(ws, 'open'),
  };
}

async function joined(name, interests = []) {
  const creds = await store.createPlayer({ name, color: '#336699', interests });
  const c = client();
  await c.opened;
  c.send({ t: 'join', id: creds.player.id, token: creds.token, room: 'plaza' });
  c.welcome = await c.next('welcome');
  c.id = creds.player.id;
  return c;
}

const at = (x, z) => [x, 1.7, z, 0, 0, 0, 1];

test('rejects a join with a bad token', async () => {
  const c = client();
  await c.opened;
  c.send({ t: 'join', id: 'x', token: 'y' });
  const err = await c.next('error');
  assert.equal(err.code, 'unauthorized');
  const [code] = await once(c.ws, 'close');
  assert.equal(code, 4001);
});

test('players see each other, chat, and sync poses', async () => {
  const a = await joined('Ana');
  const b = await joined('Ben');
  assert.ok(b.welcome.peers.some((p) => p.player.id === a.id));
  assert.equal((await a.next('peer-join')).player.id, b.id);
  assert.equal(realtime.roomCounts().plaza, 2);

  b.send({ t: 'chat', text: 'hello <b>world</b>\u0007' });
  const chat = await a.next('chat');
  assert.equal(chat.text, 'hello <b>world</b>');
  assert.equal(chat.name, 'Ben');

  b.send({ t: 'pose', h: at(1, 2), l: null, r: null });
  const poses = await a.next('poses');
  assert.deepEqual(poses.list.find((p) => p.id === b.id).h, at(1, 2));

  a.ws.close();
  assert.equal((await b.next('peer-leave')).id, a.id);
  b.ws.close();
});

test('connect only works when players are close, and awards points', async () => {
  const a = await joined('Cat', ['webxr', 'ai']);
  const b = await joined('Dan', ['ai']);

  a.send({ t: 'pose', h: at(0, 0) });
  b.send({ t: 'pose', h: at(10, 0) });
  await new Promise((r) => setTimeout(r, 50));
  a.send({ t: 'connect', target: b.id });
  assert.equal((await a.next('error')).code, 'too_far');

  b.send({ t: 'pose', h: at(1.5, 1) });
  await new Promise((r) => setTimeout(r, 50));
  a.send({ t: 'connect', target: b.id });
  const done = await b.next('connected');
  assert.deepEqual(done.shared, ['ai']);
  assert.equal(done.earned, 15);
  // Leaderboards are also pushed on join/leave, so skip any that predate the connection.
  let board;
  do board = await b.next('leaderboard');
  while (!board.top.some((p) => p.name === 'Cat' && p.points === 15));
  assert.equal(board.top.find((p) => p.name === 'Cat').room, 'Main Plaza', 'online players show their room');

  a.send({ t: 'connect', target: b.id });
  assert.equal((await a.next('error')).code, 'conflict');
  a.ws.close();
  b.ws.close();
});

test('switch-room moves a player between rooms without reconnecting', async () => {
  const a = await joined('Eve');
  const b = await joined('Fay');
  await a.next('peer-join');

  b.send({ t: 'switch-room', room: 'ai' });
  const welcome = await b.next('welcome');
  assert.equal(welcome.room.id, 'ai');
  assert.equal(welcome.room.name, 'AI Room');
  assert.deepEqual(welcome.peers, []);
  assert.equal((await a.next('peer-leave')).id, b.id);
  assert.equal(realtime.roomCounts().ai, 1);

  // Eve follows Fay into the AI room and they see each other again.
  a.send({ t: 'switch-room', room: 'ai' });
  await a.next('welcome');
  assert.equal((await b.next('peer-join')).player.id, a.id);

  b.send({ t: 'switch-room', room: 'nope' });
  assert.equal((await b.next('error')).code, 'not_found');

  // Connecting still works in the new room.
  a.send({ t: 'pose', h: at(0, 0) });
  b.send({ t: 'pose', h: at(1, 0) });
  await new Promise((r) => setTimeout(r, 50));
  a.send({ t: 'connect', target: b.id });
  assert.equal((await b.next('connected')).earned, 10);
  a.ws.close();
  b.ws.close();
});

test('UNO over the socket: sit, ready up, and each player only receives their own hand', async () => {
  const { TABLES, seatPosition } = await import('../server/game/tables.js');
  const def = TABLES[0];
  const a = await joined('Uno1');
  const b = await joined('Uno2');
  for (const c of [a, b]) {
    c.send({ t: 'switch-room', room: def.room });
    const w = await c.next('welcome');
    assert.equal(w.tables[0].id, def.id, 'welcome includes the table in this room');
  }
  const sit = async (c, seat) => {
    const spot = seatPosition(def, seat);
    c.send({ t: 'pose', h: [spot.x, 1.2, spot.z, 0, 0, 0, 1] });
    await new Promise((r) => setTimeout(r, 30));
    c.send({ t: 'table-sit', table: def.id, seat });
  };
  await sit(a, 0);
  await sit(b, 4);
  a.send({ t: 'uno-ready', ready: true });
  b.send({ t: 'uno-ready', ready: true });

  let handA;
  do handA = await a.next('uno-hand');
  while (!handA.cards.length);
  let handB;
  do handB = await b.next('uno-hand');
  while (!handB.cards.length);
  assert.equal(handA.cards.length, 8);
  assert.equal(handB.cards.length, 8);
  const idsA = new Set(handA.cards.map((c) => c.id));
  assert.ok(handB.cards.every((c) => !idsA.has(c.id)));

  let table;
  do table = (await a.next('table')).table;
  while (!table.game);
  const json = JSON.stringify(table);
  assert.ok([...idsA].every((id) => !json.includes(id)), 'room-wide table state must not contain hand cards');

  b.send({ t: 'uno-draw' });
  a.send({ t: 'table-stand' });
  a.ws.close();
  b.ws.close();
});

test('rejects sockets from a foreign origin', async () => {
  const ws = new WebSocket(url, { origin: 'https://evil.example' });
  const [err] = await once(ws, 'error');
  assert.match(err.message, /401/);
});
