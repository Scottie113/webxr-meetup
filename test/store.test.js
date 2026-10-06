import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { JsonStore, POINTS_PER_CONNECTION, POINTS_PER_SHARED_INTEREST } from '../server/store/jsonStore.js';
import { tempFile } from './helpers.js';

const newPlayer = (store, name, interests = []) => store.createPlayer({ name, color: '#ff0000', interests });

test('createPlayer never exposes the token hash and authenticates with the token', async () => {
  const store = new JsonStore(null);
  const { player, token } = await newPlayer(store, 'Ada');
  assert.equal(player.tokenHash, undefined);
  assert.equal(store.authenticate(player.id, token).name, 'Ada');
  assert.equal(store.authenticate(player.id, 'wrong-token'), null);
  assert.equal(store.authenticate('nope', token), null);
});

test('recordConnection awards points with a shared-interest bonus, once per pair', async () => {
  const store = new JsonStore(null);
  const { player: a } = await newPlayer(store, 'Ada', ['webxr', 'music']);
  const { player: b } = await newPlayer(store, 'Bo', ['music', 'ai']);

  const result = await store.recordConnection(a.id, b.id);
  assert.deepEqual(result.shared, ['music']);
  assert.equal(result.earned, POINTS_PER_CONNECTION + POINTS_PER_SHARED_INTEREST);
  assert.equal(store.getPlayer(a.id).points, result.earned);
  assert.equal(store.getPlayer(b.id).points, result.earned);

  await assert.rejects(store.recordConnection(b.id, a.id), { status: 409 });
  await assert.rejects(store.recordConnection(a.id, a.id), { status: 400 });
});

test('leaderboard is sorted by points', async () => {
  const store = new JsonStore(null);
  const { player: a } = await newPlayer(store, 'Ada');
  const { player: b } = await newPlayer(store, 'Bo');
  const { player: c } = await newPlayer(store, 'Cy');
  await store.recordConnection(a.id, b.id);
  await store.recordConnection(a.id, c.id);
  const board = store.leaderboard();
  assert.deepEqual(board.map((p) => p.name).slice(0, 1), ['Ada']);
  assert.equal(board[0].connections, 2);
});

test('rooms: default plaza exists and duplicate names are rejected', async () => {
  const store = new JsonStore(null);
  assert.ok(store.getRoom('plaza'));
  const room = await store.createRoom({ name: 'XR Devs', createdBy: null });
  assert.match(room.id, /^xr-devs-[0-9a-f]{6}$/);
  await assert.rejects(store.createRoom({ name: 'xr devs', createdBy: null }), { status: 409 });
});

test('data persists to the JSON file and reloads', async () => {
  const { file, cleanup } = await tempFile();
  try {
    const store = await JsonStore.open(file);
    const { player, token } = await newPlayer(store, 'Persisted');
    await store.createRoom({ name: 'Saved Room', createdBy: player.id });

    const json = JSON.parse(await fs.readFile(file, 'utf8'));
    assert.equal(json.players[player.id].name, 'Persisted');

    const reopened = await JsonStore.open(file);
    assert.equal(reopened.authenticate(player.id, token).name, 'Persisted');
    assert.ok(reopened.listRooms().some((r) => r.name === 'Saved Room'));
  } finally {
    await cleanup();
  }
});

test('a corrupt JSON file is backed up instead of crashing', async () => {
  const { file, cleanup } = await tempFile();
  try {
    await fs.writeFile(file, '{ not json');
    const store = await JsonStore.open(file);
    assert.ok(store.getRoom('plaza'));
    const files = await fs.readdir((await import('node:path')).dirname(file));
    assert.ok(files.some((f) => f.includes('.corrupt-')));
  } finally {
    await cleanup();
  }
});
