import { UnoGame, GameError } from './uno.js';

/**
 * Card tables placed in rooms. Seat k sits at angle k * 360/seats around the table centre,
 * `chairRadius` metres out (angle measured like Babylon: 0 = +Z, 90deg = +X).
 * The client builds the furniture from this same definition.
 */
export const TABLES = Object.freeze([
  // Game Dev room: east of the plaza, outside the ring of teleport booths (radius 14).
  { id: 'uno-gamedev', room: 'gamedev', x: 21, z: 4, seats: 8, chairRadius: 1.68 },
]);

const SIT_DISTANCE = 2.5; // how close (m) you must be to a chair to sit on it
const STAND_DISTANCE = 3.5; // walking/teleporting this far from your chair stands you up
const MIN_PLAYERS = 2;

export function seatPosition(def, seat) {
  const a = (seat / def.seats) * Math.PI * 2;
  return { x: def.x + Math.sin(a) * def.chairRadius, z: def.z + Math.cos(a) * def.chairRadius };
}

/**
 * Seats, "want to play" flags and the UNO game for each table.
 * Talks to clients only through `broadcastRoom(room, msg)` and `send(playerId, msg)`, so it can
 * be tested without sockets. Each player is only ever sent their own hand.
 */
export class TableManager {
  constructor({ broadcastRoom, send, turnMs = 60_000, tables = TABLES }) {
    this.broadcastRoom = broadcastRoom;
    this.send = send;
    this.turnMs = turnMs;
    this.tables = new Map(
      tables.map((def) => [def.id, { def, seats: Array(def.seats).fill(null), game: null, event: '', result: null, timer: null, turnEndsAt: null }]),
    );
  }

  forRoom(room) {
    return [...this.tables.values()].filter((t) => t.def.room === room).map((t) => this.#publicState(t));
  }

  /** Where a player is seated: { table, seat } or null. */
  seatOf(playerId) {
    for (const table of this.tables.values()) {
      const seat = table.seats.findIndex((s) => s?.player.id === playerId);
      if (seat >= 0) return { table, seat };
    }
    return null;
  }

  sit(player, room, pose, tableId, seat) {
    const table = this.tables.get(tableId);
    if (!table || table.def.room !== room) throw new GameError('no_table', 'that table is not in this room');
    if (!Number.isInteger(seat) || seat < 0 || seat >= table.def.seats) throw new GameError('bad_seat', 'no such seat');
    if (table.seats[seat] && table.seats[seat].player.id !== player.id) throw new GameError('seat_taken', 'someone is already sitting there');
    const spot = seatPosition(table.def, seat);
    if (!pose || Math.hypot(pose[0] - spot.x, pose[2] - spot.z) > SIT_DISTANCE) {
      throw new GameError('too_far', 'walk up to the chair to sit down');
    }
    const current = this.seatOf(player.id);
    if (current?.table === table && current.seat === seat) return;
    if (current) {
      if (current.table.seats[current.seat].inGame) throw new GameError('in_game', 'leave your current game first');
      this.stand(player.id);
    }
    table.seats[seat] = { player: { id: player.id, name: player.name, color: player.color }, ready: false, inGame: false };
    table.event = table.game ? `${player.name} sat down and will join the next game` : `${player.name} sat down`;
    this.#update(table);
  }

  stand(playerId) {
    const where = this.seatOf(playerId);
    if (!where) return;
    const { table, seat } = where;
    const { player, inGame } = table.seats[seat];
    table.seats[seat] = null;
    this.send(playerId, { t: 'uno-hand', table: table.def.id, cards: [] });
    table.event = `${player.name} left the table`;
    if (inGame && table.game) {
      table.game.removePlayer(playerId);
      table.event = `${player.name} left the game`;
      if (table.game.finished) return this.#finish(table, 'not enough players left');
    }
    this.#update(table);
  }

  setReady(playerId, ready) {
    const where = this.seatOf(playerId);
    if (!where) throw new GameError('not_seated', 'sit at the table first');
    where.table.seats[where.seat].ready = !!ready;
    where.table.event = `${where.table.seats[where.seat].player.name} ${ready ? 'wants to play' : 'is not ready'}`;
    this.#update(where.table);
  }

  play(playerId, cardId, color) {
    this.#act(playerId, (game) => game.play(playerId, cardId, color));
  }

  draw(playerId) {
    this.#act(playerId, (game) => game.draw(playerId));
  }

  callUno(playerId) {
    this.#act(playerId, (game) => game.callUno(playerId));
  }

  /** Stand players up if they wander (or teleport) away from their chair. */
  onMove(playerId, pose) {
    const where = this.seatOf(playerId);
    if (!where) return;
    const spot = seatPosition(where.table.def, where.seat);
    if (Math.hypot(pose[0] - spot.x, pose[2] - spot.z) > STAND_DISTANCE) this.stand(playerId);
  }

  close() {
    for (const table of this.tables.values()) clearTimeout(table.timer);
  }

  #act(playerId, fn) {
    const where = this.seatOf(playerId);
    const game = where?.table.game;
    if (!game || !where.table.seats[where.seat].inGame) throw new GameError('not_playing', "you're not in a game");
    fn(game);
    this.#afterMove(where.table, playerId);
  }

  #afterMove(table, actorId) {
    const names = this.#names(table);
    let text = table.game.lastEvent;
    for (const [id, name] of names) text = text.replaceAll(id, name);
    table.event = `${names.get(actorId) ?? 'Someone'} ${text}`;
    if (table.game.finished) return this.#finish(table);
    this.#update(table);
  }

  #names(table) {
    return new Map(table.seats.filter(Boolean).map((s) => [s.player.id, s.player.name]));
  }

  #maybeStart(table) {
    if (table.game) return;
    const seated = table.seats.filter(Boolean);
    if (seated.length < MIN_PLAYERS || !seated.every((s) => s.ready)) return;
    // Turn order follows the seats around the table.
    table.game = new UnoGame(seated.map((s) => s.player.id));
    for (const s of seated) s.inGame = true;
    table.result = null;
    table.event = `New game! ${seated.length} players, 8 cards each. ${seated[0].player.name} goes first.`;
  }

  #finish(table, reason) {
    const game = table.game;
    const winner = table.seats.find((s) => s?.player.id === game.winner)?.player.name;
    table.result = winner ? `🏆 ${winner} wins!${reason ? ` (${reason})` : ''}` : `Game over${reason ? `: ${reason}` : ''}`;
    table.event = table.result;
    table.game = null;
    for (const s of table.seats.filter(Boolean)) {
      s.inGame = false;
      s.ready = false; // everyone presses "play" again for the next round
      this.send(s.player.id, { t: 'uno-hand', table: table.def.id, cards: [] });
    }
    this.#update(table);
  }

  /** Start a game if everyone is ready, restart the turn timer, then push state + private hands. */
  #update(table) {
    this.#maybeStart(table);
    clearTimeout(table.timer);
    table.timer = null;
    table.turnEndsAt = null;
    if (table.game) {
      const current = table.game.current.id;
      table.turnEndsAt = Date.now() + this.turnMs;
      table.timer = setTimeout(() => {
        if (table.game?.current.id !== current) return;
        table.game.draw(current, { force: true });
        this.#afterMove(table, current);
      }, this.turnMs);
      table.timer.unref?.();
    }
    this.broadcastRoom(table.def.room, { t: 'table', table: this.#publicState(table) });
    if (table.game) {
      for (const s of table.seats) {
        if (s?.inGame) this.send(s.player.id, { t: 'uno-hand', table: table.def.id, cards: table.game.hand(s.player.id) });
      }
    }
  }

  #publicState(table) {
    const g = table.game?.publicState();
    const seatOfId = (id) => table.seats.findIndex((s) => s?.player.id === id);
    return {
      ...table.def,
      seatState: table.seats.map((s, seat) =>
        s
          ? { seat, player: s.player, ready: s.ready, inGame: s.inGame, cards: s.inGame && g ? g.players.find((p) => p.id === s.player.id)?.cards ?? 0 : 0 }
          : { seat, player: null },
      ),
      game: g
        ? {
            turnSeat: seatOfId(g.turn),
            top: g.top,
            color: g.color,
            direction: g.direction,
            deckCount: g.deckCount,
            unoPendingSeat: g.unoPending ? seatOfId(g.unoPending) : -1,
            turnEndsAt: table.turnEndsAt,
          }
        : null,
      event: table.event,
      result: table.result,
    };
  }
}
