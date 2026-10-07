import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDeck, UnoGame, HAND_SIZE } from '../server/game/uno.js';
import { TableManager, seatPosition } from '../server/game/tables.js';

const card = (color, value, id = `${color}-${value}-${Math.random()}`) => ({ id, color, value });

/** A game whose hands/discard we then set by hand for each scenario. */
function rigged(n = 3) {
  const game = new UnoGame(['a', 'b', 'c', 'd'].slice(0, n));
  game.discard = [card('red', '5', 'top')];
  game.color = 'red';
  return game;
}

test('the deck is a standard 108-card UNO deck with unique ids', () => {
  const deck = createDeck();
  assert.equal(deck.length, 108);
  assert.equal(new Set(deck.map((c) => c.id)).size, 108);
  const count = (pred) => deck.filter(pred).length;
  assert.equal(count((c) => c.value === 'W'), 4);
  assert.equal(count((c) => c.value === 'D4'), 4);
  for (const color of ['red', 'yellow', 'green', 'blue']) {
    assert.equal(count((c) => c.color === color), 25);
    assert.equal(count((c) => c.color === color && c.value === '0'), 1);
    assert.equal(count((c) => c.color === color && c.value === '7'), 2);
    for (const v of ['S', 'R', 'D2']) assert.equal(count((c) => c.color === color && c.value === v), 2);
  }
});

test('a new game deals 8 cards each from one deck (no duplicates) and flips a number card', () => {
  const game = new UnoGame(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']);
  const all = [...game.players.flatMap((p) => p.hand), ...game.deck, ...game.discard];
  assert.equal(all.length, 108);
  assert.equal(new Set(all.map((c) => c.id)).size, 108, 'every card exists exactly once');
  for (const p of game.players) assert.equal(p.hand.length, HAND_SIZE);
  assert.match(game.top.value, /^\d$/);
  assert.equal(game.color, game.top.color);
});

test('play follows colour/number matching and wilds need a colour', () => {
  const game = rigged();
  game.players[0].hand = [card('blue', '7', 'b7'), card('red', '2', 'r2'), card(null, 'W', 'w'), card('blue', '5', 'b5'), card('green', '1')];
  assert.throws(() => game.play('b', 'x'), { code: 'not_your_turn' });
  assert.throws(() => game.play('a', 'b7'), { code: 'cant_play' });
  assert.throws(() => game.play('a', 'w'), { code: 'pick_color' });
  game.play('a', 'b5'); // same number, different colour
  assert.equal(game.color, 'blue');
  assert.equal(game.current.id, 'b');
});

test('skip, reverse and draw cards', () => {
  let game = rigged(3);
  game.players[0].hand = [card('red', 'S', 's'), card('red', '1')];
  game.play('a', 's');
  assert.equal(game.current.id, 'c', 'b was skipped');

  game = rigged(3);
  game.players[0].hand = [card('red', 'R', 'r'), card('red', '1')];
  game.play('a', 'r');
  assert.equal(game.direction, -1);
  assert.equal(game.current.id, 'c', 'play goes the other way');

  game = rigged(2);
  game.players[0].hand = [card('red', 'R', 'r'), card('red', '1')];
  game.play('a', 'r');
  assert.equal(game.current.id, 'a', 'with two players reverse acts as a skip');

  game = rigged(3);
  const before = game.players[1].hand.length;
  game.players[0].hand = [card('red', 'D2', 'd2'), card('red', '1')];
  game.play('a', 'd2');
  assert.equal(game.players[1].hand.length, before + 2);
  assert.equal(game.current.id, 'c');

  game = rigged(3);
  game.players[0].hand = [card(null, 'D4', 'd4'), card('red', '1')];
  game.play('a', 'd4', 'green');
  assert.equal(game.players[1].hand.length, before + 4);
  assert.equal(game.color, 'green');
  assert.equal(game.current.id, 'c');
});

test('drawing is only allowed with nothing playable, and passes the turn', () => {
  const game = rigged();
  game.players[0].hand = [card('red', '9', 'r9'), card('blue', '1')];
  assert.throws(() => game.draw('a'), { code: 'must_play' });
  game.players[0].hand = [card('blue', '1'), card('green', '2')];
  game.draw('a');
  assert.equal(game.players[0].hand.length, 3);
  assert.equal(game.current.id, 'b');
});

test('UNO: calling it keeps you safe, being caught first costs 4 cards', () => {
  let game = rigged();
  game.players[0].hand = [card('red', '1', 'r1'), card('blue', '2')];
  game.play('a', 'r1');
  assert.equal(game.unoPending, 'a');
  game.callUno('a');
  assert.equal(game.unoPending, null);
  assert.equal(game.players[0].hand.length, 1);

  game = rigged();
  game.players[0].hand = [card('red', '1', 'r1'), card('blue', '2')];
  game.play('a', 'r1');
  game.callUno('c'); // someone else hits UNO first
  assert.equal(game.players[0].hand.length, 1 + 4);
  assert.equal(game.unoPending, null);

  game = rigged();
  game.players[0].hand = [card('red', '1', 'r1'), card('blue', '2')];
  game.callUno('a'); // pre-declared on your own turn with two cards
  game.play('a', 'r1');
  assert.equal(game.unoPending, null);

  game = rigged();
  game.players[0].hand = [card('red', '1', 'r1'), card('blue', '2')];
  game.play('a', 'r1');
  game.players[1].hand = [card('green', '9'), card('yellow', '8')];
  game.draw('b'); // next player acts: the chance to catch 'a' is over
  assert.equal(game.unoPending, null);
  assert.throws(() => game.callUno('c'), { code: 'no_uno' });
});

test('emptying your hand wins', () => {
  const game = rigged();
  game.players[0].hand = [card('red', '3', 'last')];
  game.play('a', 'last');
  assert.equal(game.winner, 'a');
  assert.equal(game.finished, true);
  assert.throws(() => game.play('b', 'x'), { code: 'finished' });
});

test('a player leaving mid-game hands the turn on; one player left ends it', () => {
  const game = rigged(3);
  game.removePlayer('a'); // it was a's turn
  assert.equal(game.current.id, 'b');
  game.removePlayer('c');
  assert.equal(game.finished, true);
  assert.equal(game.winner, 'b');
});

// ---- table manager -------------------------------------------------------

function tableHarness(turnMs = 60_000) {
  const roomMsgs = [];
  const sent = new Map();
  const tables = new TableManager({
    broadcastRoom: (room, msg) => roomMsgs.push(msg),
    send: (id, msg) => sent.set(id, [...(sent.get(id) ?? []), msg]),
    turnMs,
  });
  const def = [...tables.tables.values()][0].def;
  const sitAt = (id, seat) => {
    const spot = seatPosition(def, seat);
    tables.sit({ id, name: id.toUpperCase(), color: '#ffffff' }, def.room, [spot.x, 1.2, spot.z, 0, 0, 0, 1], def.id, seat);
  };
  const lastTable = () => roomMsgs.filter((m) => m.t === 'table').at(-1).table;
  const lastHand = (id) => (sent.get(id) ?? []).filter((m) => m.t === 'uno-hand').at(-1)?.cards;
  return { tables, def, sitAt, lastTable, lastHand, sent };
}

test('table: a game starts once 2+ seated players all want to play', () => {
  const h = tableHarness();
  h.sitAt('ana', 0);
  h.tables.setReady('ana', true);
  assert.equal(h.lastTable().game, null, 'one player is not enough');
  h.sitAt('ben', 3);
  assert.equal(h.lastTable().game, null, 'ben has not pressed play yet');
  h.tables.setReady('ben', true);
  const state = h.lastTable();
  assert.ok(state.game);
  assert.equal(state.seatState[0].cards, 8);
  assert.equal(h.lastHand('ana').length, 8);
  assert.equal(h.lastHand('ben').length, 8);
  h.tables.close();
});

test('table: hands are private and public state never contains cards', () => {
  const h = tableHarness();
  h.sitAt('ana', 0);
  h.sitAt('ben', 1);
  h.tables.setReady('ana', true);
  h.tables.setReady('ben', true);
  const ana = new Set(h.lastHand('ana').map((c) => c.id));
  const ben = h.lastHand('ben').map((c) => c.id);
  assert.ok(ben.every((id) => !ana.has(id)), 'no shared cards');
  for (const msgs of h.sent.values()) for (const m of msgs) if (m.t === 'uno-hand') assert.ok(m.cards.length === 0 || m.cards.every((c) => c.id));
  const json = JSON.stringify(h.lastTable());
  for (const id of [...ana, ...ben]) assert.ok(!json.includes(id), 'public table state leaks a hand card');
  // Each player only ever received their own hand.
  for (const m of h.sent.get('ana')) if (m.cards?.length) assert.ok(m.cards.every((c) => ana.has(c.id) || !ben.includes(c.id)));
  h.tables.close();
});

test('table: sitting down mid-game means waiting for the next game', () => {
  const h = tableHarness();
  h.sitAt('ana', 0);
  h.sitAt('ben', 1);
  h.tables.setReady('ana', true);
  h.tables.setReady('ben', true);
  h.sitAt('cat', 2);
  h.tables.setReady('cat', true);
  const cat = h.lastTable().seatState[2];
  assert.equal(cat.inGame, false);
  assert.equal(h.lastHand('cat'), undefined, 'cat gets no cards this round');
  assert.throws(() => h.tables.draw('cat'), { code: 'not_playing' });
  h.tables.close();
});

test('table: you must be at the chair to sit, and leaving ends a 2-player game', () => {
  const h = tableHarness();
  assert.throws(
    () => h.tables.sit({ id: 'far', name: 'Far', color: '#fff' }, h.def.room, [0, 1.7, 0, 0, 0, 0, 1], h.def.id, 0),
    { code: 'too_far' },
  );
  h.sitAt('ana', 0);
  assert.throws(() => h.sitAt('ben', 0), { code: 'seat_taken' });
  h.sitAt('ben', 1);
  h.tables.setReady('ana', true);
  h.tables.setReady('ben', true);
  h.tables.stand('ben');
  const state = h.lastTable();
  assert.equal(state.game, null);
  assert.match(state.result, /ANA wins/);
  assert.deepEqual(h.lastHand('ben'), []);
  h.tables.close();
});

test('table: an idle player auto-draws when their turn times out', async () => {
  const h = tableHarness(30);
  h.sitAt('ana', 0);
  h.sitAt('ben', 1);
  h.tables.setReady('ana', true);
  h.tables.setReady('ben', true);
  await new Promise((r) => setTimeout(r, 80));
  // Each timeout draws one card for the idle player (several may have fired by now).
  const counts = h.lastTable().seatState.slice(0, 2).map((s) => s.cards);
  assert.ok(counts.some((n) => n > 8), `someone should have auto-drawn, got ${counts}`);
  assert.match(h.lastTable().event, /ran out of time/);
  h.tables.close();
});
