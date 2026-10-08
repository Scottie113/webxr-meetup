import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { conflict, badRequest, notFound } from '../lib/errors.js';
import { INTERESTS, INTEREST_LABELS } from '../lib/validate.js';

export const POINTS_PER_CONNECTION = 10;
export const POINTS_PER_SHARED_INTEREST = 5;
const MAX_ROOMS = 60;

const builtInRoom = (id, name, kind) => ({ id, name, kind, createdBy: null, createdAt: new Date(0).toISOString() });

/** The plaza plus one room per interest. Merged into every loaded db, so old files gain new rooms. */
export const BUILT_IN_ROOMS = Object.freeze([
  builtInRoom('plaza', 'Main Plaza', 'plaza'),
  ...INTERESTS.map((i) => builtInRoom(i, `${INTEREST_LABELS[i]} Room`, 'interest')),
  // Rooms you enter by stepping through a painting in the 3D Art Room.
  builtInRoom('starry-night', 'The Starry Night', 'painting'),
]);

const emptyDb = () => ({
  version: 1,
  players: {},
  rooms: Object.fromEntries(BUILT_IN_ROOMS.map((r) => [r.id, { ...r }])),
});

const hashToken = (token) => crypto.createHash('sha256').update(token).digest();

/** Strip secrets before a player leaves the server. */
export function publicPlayer(p) {
  if (!p) return null;
  const { tokenHash, ...rest } = p;
  return rest;
}

/**
 * Tiny JSON-file database. All data lives in memory and every mutation is
 * flushed to disk through a serialised write queue (write temp file, then rename)
 * so a crash mid-write never leaves a half-written db.json.
 * Pass `file = null` for a purely in-memory store (used by tests).
 */
export class JsonStore {
  constructor(file) {
    this.file = file;
    this.data = emptyDb();
    this.queue = Promise.resolve();
  }

  static async open(file) {
    const store = new JsonStore(file);
    await store.load();
    return store;
  }

  async load() {
    if (!this.file) return;
    let raw;
    try {
      raw = await fs.readFile(this.file, 'utf8');
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
      await this.save();
      return;
    }
    try {
      const parsed = JSON.parse(raw);
      const base = emptyDb();
      // Built-in rooms always come from code, so renames and new interests apply to old db files.
      this.data = { ...base, ...parsed, rooms: { ...parsed.rooms, ...base.rooms } };
    } catch {
      const backup = `${this.file}.corrupt-${Date.now()}`;
      await fs.rename(this.file, backup);
      console.warn(`[store] ${this.file} was not valid JSON; moved to ${backup} and started fresh`);
      await this.save();
    }
  }

  save() {
    if (!this.file) return Promise.resolve();
    const snapshot = JSON.stringify(this.data, null, 2);
    const file = this.file;
    this.queue = this.queue
      .catch(() => {})
      .then(async () => {
        await fs.mkdir(path.dirname(file), { recursive: true });
        const tmp = `${file}.${process.pid}.tmp`;
        await fs.writeFile(tmp, snapshot);
        await fs.rename(tmp, file);
      });
    return this.queue;
  }

  // ---- players -------------------------------------------------------------

  async createPlayer({ name, color, interests }) {
    const id = crypto.randomUUID();
    const token = crypto.randomBytes(24).toString('base64url');
    const now = new Date().toISOString();
    const player = {
      id,
      name,
      color,
      interests,
      points: 0,
      connections: [],
      createdAt: now,
      lastSeen: now,
      tokenHash: hashToken(token).toString('hex'),
    };
    this.data.players[id] = player;
    await this.save();
    return { player: publicPlayer(player), token };
  }

  getPlayer(id) {
    return publicPlayer(this.data.players[id]);
  }

  /** Returns the public player if the token matches, otherwise null. */
  authenticate(id, token) {
    const p = typeof id === 'string' ? this.data.players[id] : undefined;
    if (!p || typeof token !== 'string') return null;
    const expected = Buffer.from(p.tokenHash, 'hex');
    const actual = hashToken(token);
    return crypto.timingSafeEqual(expected, actual) ? publicPlayer(p) : null;
  }

  async updatePlayer(id, changes) {
    const p = this.data.players[id];
    if (!p) throw notFound('player not found');
    for (const key of ['name', 'color', 'interests']) if (changes[key] !== undefined) p[key] = changes[key];
    await this.save();
    return publicPlayer(p);
  }

  async touchPlayer(id) {
    const p = this.data.players[id];
    if (!p) return;
    p.lastSeen = new Date().toISOString();
    await this.save();
  }

  /**
   * Record a meetup "connection" between two players. Both earn points,
   * with a bonus for each interest they share. Each pair can connect once.
   */
  async recordConnection(aId, bId) {
    if (aId === bId) throw badRequest('you cannot connect with yourself');
    const a = this.data.players[aId];
    const b = this.data.players[bId];
    if (!a || !b) throw notFound('player not found');
    if (a.connections.includes(bId)) throw conflict(`already connected with ${b.name}`);

    const shared = a.interests.filter((i) => b.interests.includes(i));
    const earned = POINTS_PER_CONNECTION + shared.length * POINTS_PER_SHARED_INTEREST;
    a.connections.push(bId);
    b.connections.push(aId);
    a.points += earned;
    b.points += earned;
    await this.save();
    return { earned, shared, a: publicPlayer(a), b: publicPlayer(b) };
  }

  leaderboard(limit = 10) {
    return Object.values(this.data.players)
      .sort((x, y) => y.points - x.points || x.createdAt.localeCompare(y.createdAt))
      .slice(0, Math.max(1, Math.min(50, limit)))
      .map((p) => ({ id: p.id, name: p.name, color: p.color, points: p.points, connections: p.connections.length }));
  }

  // ---- rooms ---------------------------------------------------------------

  listRooms() {
    return Object.values(this.data.rooms);
  }

  getRoom(id) {
    return this.data.rooms[id] || null;
  }

  async createRoom({ name, createdBy }) {
    const rooms = this.listRooms();
    if (rooms.length >= MAX_ROOMS) throw conflict('room limit reached');
    if (rooms.some((r) => r.name.toLowerCase() === name.toLowerCase())) throw conflict('a room with that name exists');
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'room';
    const id = `${slug}-${crypto.randomBytes(3).toString('hex')}`;
    const room = { id, name, kind: 'custom', createdBy, createdAt: new Date().toISOString() };
    this.data.rooms[id] = room;
    await this.save();
    return room;
  }
}
