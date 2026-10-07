import crypto from 'node:crypto';

export const COLORS = Object.freeze(['red', 'yellow', 'green', 'blue']);
export const HAND_SIZE = 8;
export const UNO_PENALTY = 4;

const isWild = (card) => card.value === 'W' || card.value === 'D4';
const isNumber = (card) => /^\d$/.test(card.value);

export class GameError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

const cryptoRandom = () => crypto.randomInt(0, 2 ** 31) / 2 ** 31;

/**
 * A standard 108-card UNO deck. Per colour: one 0, two each of 1-9, two Skip (S),
 * two Reverse (R), two Draw Two (D2). Plus four Wild (W) and four Wild Draw Four (D4).
 * Ids are assigned after shuffling, so an id never reveals which card it is.
 */
export function createDeck(rand = cryptoRandom) {
  const cards = [];
  for (const color of COLORS) {
    cards.push({ color, value: '0' });
    for (let n = 1; n <= 9; n++) cards.push({ color, value: String(n) }, { color, value: String(n) });
    for (const value of ['S', 'R', 'D2']) cards.push({ color, value }, { color, value });
  }
  for (let i = 0; i < 4; i++) cards.push({ color: null, value: 'W' }, { color: null, value: 'D4' });
  shuffle(cards, rand);
  return cards.map((card, i) => ({ id: `k${i}${crypto.randomBytes(3).toString('hex')}`, ...card }));
}

export function shuffle(cards, rand = cryptoRandom) {
  for (let i = cards.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [cards[i], cards[j]] = [cards[j], cards[i]];
  }
  return cards;
}

/**
 * Server-side UNO rules. Players are identified by id, in turn order.
 * House rules kept deliberately simple:
 * - you may only draw when you have nothing playable; drawing one card ends your turn,
 * - Wild Draw Four can be played any time,
 * - a player left with one card must press UNO before anyone else does, or draws 4.
 *   That chance ends once the next player acts.
 */
export class UnoGame {
  constructor(playerIds, { rand = cryptoRandom, handSize = HAND_SIZE, deck } = {}) {
    if (playerIds.length < 2) throw new GameError('not_enough_players', 'UNO needs at least 2 players');
    this.rand = rand;
    this.deck = deck ?? createDeck(rand);
    this.discard = [];
    this.players = playerIds.map((id) => ({ id, hand: [] }));
    this.turn = 0;
    this.direction = 1;
    this.color = null;
    this.winner = null;
    this.finished = false;
    this.unoPending = null; // id of a player sitting on one card who hasn't called UNO yet
    this.unoDeclared = new Set(); // players who called UNO before playing their second-to-last card
    this.lastEvent = 'Game started';

    for (let i = 0; i < handSize; i++) for (const p of this.players) this.#drawInto(p, 1);
    // Flip the first card; it has to be a plain number card.
    let first = this.deck.pop();
    while (!isNumber(first)) {
      this.deck.unshift(first);
      first = this.deck.pop();
    }
    this.discard.push(first);
    this.color = first.color;
  }

  get top() {
    return this.discard[this.discard.length - 1];
  }

  get current() {
    return this.players[this.turn];
  }

  player(id) {
    return this.players.find((p) => p.id === id);
  }

  hand(id) {
    return this.player(id)?.hand ?? [];
  }

  canPlay(card) {
    return isWild(card) || card.color === this.color || card.value === this.top.value;
  }

  hasPlayable(id) {
    return this.hand(id).some((c) => this.canPlay(c));
  }

  play(id, cardId, chosenColor) {
    const player = this.#requireTurn(id);
    const index = player.hand.findIndex((c) => c.id === cardId);
    if (index < 0) throw new GameError('no_card', "that card isn't in your hand");
    const card = player.hand[index];
    if (!this.canPlay(card)) throw new GameError('cant_play', `you can't play ${describe(card)} on ${describe(this.top)} (colour is ${this.color})`);
    if (isWild(card) && !COLORS.includes(chosenColor)) throw new GameError('pick_color', 'choose a colour for your wild card');

    this.#closeUnoWindow(id);
    player.hand.splice(index, 1);
    this.discard.push(card);
    this.color = isWild(card) ? chosenColor : card.color;
    const name = `${describe(card)}${isWild(card) ? ` → ${chosenColor}` : ''}`;

    if (player.hand.length === 0) {
      this.winner = id;
      this.finished = true;
      this.lastEvent = `played ${name} and won!`;
      return this.#event(id, 'won');
    }
    if (player.hand.length === 1) {
      if (this.unoDeclared.has(id)) this.lastEvent = `played ${name} — UNO!`;
      else this.unoPending = id;
    }
    this.unoDeclared.delete(id);

    const next = () => this.players[this.#index(1)];
    switch (card.value) {
      case 'S':
        this.lastEvent = `played ${name}: ${next().id} is skipped`;
        this.#advance(2);
        break;
      case 'R':
        if (this.players.length === 2) {
          this.lastEvent = `played ${name}: acts as a skip`;
          this.#advance(2);
        } else {
          this.direction *= -1;
          this.lastEvent = `played ${name}: direction reversed`;
          this.#advance(1);
        }
        break;
      case 'D2':
      case 'D4': {
        const victim = next();
        const n = card.value === 'D2' ? 2 : 4;
        this.#drawInto(victim, n);
        this.lastEvent = `played ${name}: ${victim.id} draws ${n} and is skipped`;
        this.#advance(2);
        break;
      }
      default:
        this.lastEvent = `played ${name}`;
        this.#advance(1);
    }
    return this.#event(id, 'played', card);
  }

  /** Draw one card (only allowed with nothing playable, unless `force` e.g. turn timeout). Ends the turn. */
  draw(id, { force = false } = {}) {
    const player = this.#requireTurn(id);
    if (!force && this.hasPlayable(id)) throw new GameError('must_play', 'you have a card you can play');
    this.#closeUnoWindow(id);
    if (this.unoPending === id) this.unoPending = null;
    this.unoDeclared.delete(id);
    const drawn = this.#drawInto(player, 1);
    this.lastEvent = force ? 'ran out of time and drew a card' : 'drew a card';
    this.#advance(1);
    return this.#event(id, 'drew', drawn[0]);
  }

  /**
   * The UNO button. The player on one card presses it to be safe; anyone else pressing it
   * first catches them and they draw 4. Pressing on your turn with two cards pre-declares UNO.
   */
  callUno(id) {
    if (!this.player(id)) throw new GameError('not_playing', "you're not in this game");
    if (this.unoPending === id) {
      this.unoPending = null;
      this.lastEvent = 'called UNO!';
      return this.#event(id, 'uno');
    }
    if (this.unoPending) {
      const caught = this.player(this.unoPending);
      this.unoPending = null;
      this.#drawInto(caught, UNO_PENALTY);
      this.lastEvent = `caught ${caught.id} not calling UNO: ${caught.id} draws ${UNO_PENALTY}`;
      return this.#event(id, 'caught', null, caught.id);
    }
    if (this.current.id === id && this.hand(id).length === 2) {
      this.unoDeclared.add(id);
      this.lastEvent = 'is about to call UNO';
      return this.#event(id, 'declared');
    }
    throw new GameError('no_uno', 'nobody is on one card right now');
  }

  /** Remove a player mid-game (stood up / disconnected). Their cards go back under the deck. */
  removePlayer(id) {
    const index = this.players.findIndex((p) => p.id === id);
    if (index < 0) return;
    const [gone] = this.players.splice(index, 1);
    this.deck.unshift(...gone.hand);
    if (this.unoPending === id) this.unoPending = null;
    this.unoDeclared.delete(id);

    if (this.players.length < 2) {
      this.finished = true;
      this.winner = this.players[0]?.id ?? null;
      this.lastEvent = 'left — not enough players to continue';
      return;
    }
    if (index < this.turn) this.turn -= 1;
    else if (index === this.turn) {
      // The seat that would have been next now sits at this index (or wraps around).
      this.turn = this.direction === 1 ? index % this.players.length : (index - 1 + this.players.length) % this.players.length;
    }
    this.lastEvent = 'left the game';
  }

  #requireTurn(id) {
    if (this.finished) throw new GameError('finished', 'the game is over');
    const player = this.player(id);
    if (!player) throw new GameError('not_playing', "you're not in this game");
    if (this.current.id !== id) throw new GameError('not_your_turn', "it's not your turn");
    return player;
  }

  /** The next player acting ends the previous player's chance to call UNO. */
  #closeUnoWindow(actorId) {
    if (this.unoPending && this.unoPending !== actorId) this.unoPending = null;
  }

  #index(steps) {
    const n = this.players.length;
    return (((this.turn + this.direction * steps) % n) + n) % n;
  }

  #advance(steps) {
    this.turn = this.#index(steps);
  }

  #drawInto(player, n) {
    const drawn = [];
    for (let i = 0; i < n; i++) {
      if (!this.deck.length) this.#reshuffle();
      if (!this.deck.length) break; // every card is in someone's hand
      const card = this.deck.pop();
      player.hand.push(card);
      drawn.push(card);
    }
    return drawn;
  }

  #reshuffle() {
    const top = this.discard.pop();
    this.deck = shuffle(this.discard, this.rand);
    this.discard = top ? [top] : [];
  }

  #event(actor, type, card = null, target = null) {
    return { actor, type, card, target };
  }

  /** Public view: everything except other players' cards. */
  publicState() {
    return {
      players: this.players.map((p) => ({ id: p.id, cards: p.hand.length })),
      turn: this.finished ? null : this.current.id,
      top: this.top,
      color: this.color,
      direction: this.direction,
      deckCount: this.deck.length,
      unoPending: this.unoPending,
      winner: this.winner,
      finished: this.finished,
      lastEvent: this.lastEvent,
    };
  }
}

/** Human-readable card name for event messages, e.g. "red 7", "blue D2", "W". */
export function describe(card) {
  return isWild(card) ? card.value : `${card.color} ${card.value}`;
}
