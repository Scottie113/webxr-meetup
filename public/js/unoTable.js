/* global BABYLON */
import { canvasPlane, roundRect } from './world.js';
import { circle, box } from './collision.js';
import { loadModel, roomReflections, applyReflections } from './props.js';

const B = BABYLON;

export const CARD_COLORS = { red: '#e53935', yellow: '#fbc02d', green: '#43a047', blue: '#1e88e5' };
const COLOR_EMOJI = { red: '🔴', yellow: '🟡', green: '🟢', blue: '🔵' };

// Everything at a seat is laid out in that seat's frame: table centre at the origin, +Z pointing
// from the chair toward the centre, the chair at z = -chairRadius. Units are metres.
const CARD_W = 0.06;
const CARD_H = 0.088;
const CARD_GAP = 0.006;
const PER_ROW = 8; // a row of 8 spans ~0.53 m, which fits a desktop view from the chair
const HAND_Y = 0.92; // just above the 0.81 m playing surface
const HAND_Z = -1.0; // over the table, about half a metre in front of your eyes
const BUTTON_X = 0.37; // 3D buttons sit just left/right of the hand
const TILT = 0.6; // lean cards/buttons back so they face the seated player's eyes
const EYE = new B.Vector3(0, 1.22, -1.52); // seated eye position
// Seated players look between their hand and the pile, so both fit on screen.
const LOOK_AT = new B.Vector3(0, 0.72, -0.25);
const TABLE_RADIUS = 1.36;

const isWild = (card) => card.value === 'W' || card.value === 'D4';
export const canPlay = (card, top, color) => isWild(card) || card.color === color || card.value === top.value;

// ---- card artwork ----------------------------------------------------------

function drawCardFace(ctx, w, h, card) {
  ctx.clearRect(0, 0, w, h);
  roundRect(ctx, 0, 0, w, h, w * 0.12);
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  roundRect(ctx, w * 0.07, h * 0.05, w * 0.86, h * 0.9, w * 0.09);
  ctx.fillStyle = card.color ? CARD_COLORS[card.color] : '#16161a';
  ctx.fill();

  // Tilted white oval, the classic UNO face. Wild cards show the four colours inside it.
  ctx.save();
  ctx.translate(w / 2, h / 2);
  ctx.rotate(-0.45);
  ctx.beginPath();
  ctx.ellipse(0, 0, w * 0.34, h * 0.36, 0, 0, Math.PI * 2);
  if (card.color) {
    ctx.fillStyle = '#ffffff';
    ctx.fill();
  } else {
    ctx.clip();
    const quads = ['red', 'blue', 'yellow', 'green'];
    quads.forEach((c, i) => {
      ctx.fillStyle = CARD_COLORS[c];
      ctx.fillRect(i % 2 ? 0 : -w, i < 2 ? -h : 0, w, h);
    });
  }
  ctx.restore();

  const text = card.value;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `900 ${w * (text.length > 1 ? 0.36 : 0.5)}px system-ui, sans-serif`;
  ctx.lineWidth = w * 0.04;
  ctx.strokeStyle = '#000000';
  ctx.fillStyle = card.color ? CARD_COLORS[card.color] : '#ffffff';
  ctx.strokeText(text, w / 2, h / 2);
  ctx.fillText(text, w / 2, h / 2);

  // Corner indices.
  ctx.font = `800 ${w * 0.17}px system-ui, sans-serif`;
  ctx.fillStyle = '#ffffff';
  ctx.fillText(text, w * 0.2, h * 0.12);
  ctx.save();
  ctx.translate(w * 0.8, h * 0.88);
  ctx.rotate(Math.PI);
  ctx.fillText(text, 0, 0);
  ctx.restore();
}

function drawCardBack(ctx, w, h) {
  roundRect(ctx, 0, 0, w, h, w * 0.12);
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  roundRect(ctx, w * 0.07, h * 0.05, w * 0.86, h * 0.9, w * 0.09);
  ctx.fillStyle = '#111114';
  ctx.fill();
  ctx.save();
  ctx.translate(w / 2, h / 2);
  ctx.rotate(-0.45);
  ctx.beginPath();
  ctx.ellipse(0, 0, w * 0.34, h * 0.36, 0, 0, Math.PI * 2);
  ctx.fillStyle = '#e53935';
  ctx.fill();
  ctx.rotate(0.45);
  ctx.font = `italic 900 ${w * 0.3}px system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#fbc02d';
  ctx.fillText('UNO', 0, 0);
  ctx.restore();
}

/** One shared material per distinct card face (at most 54), so hands are cheap to rebuild. */
class CardMaterials {
  constructor(scene) {
    this.scene = scene;
    this.cache = new Map();
  }

  get(key, paint) {
    if (!this.cache.has(key)) {
      const tex = new B.DynamicTexture(`card-${key}`, { width: 128, height: 188 }, this.scene, true);
      tex.hasAlpha = true;
      paint(tex.getContext(), 128, 188);
      tex.update();
      const mat = new B.StandardMaterial(`card-mat-${key}`, this.scene);
      mat.diffuseTexture = tex;
      mat.emissiveColor = B.Color3.White();
      mat.disableLighting = true;
      mat.useAlphaFromDiffuseTexture = true;
      mat.backFaceCulling = false;
      this.cache.set(key, mat);
    }
    return this.cache.get(key);
  }

  face(card) {
    return this.get(`${card.color ?? 'wild'}-${card.value}`, (ctx, w, h) => drawCardFace(ctx, w, h, card));
  }

  back() {
    return this.get('back', drawCardBack);
  }
}

// ---- small canvas helpers -----------------------------------------------------

function drawButton(ctx, w, h, text, { bg = '#1e2a4a', fg = '#ffffff', dim = false } = {}) {
  ctx.clearRect(0, 0, w, h);
  roundRect(ctx, 2, 2, w - 4, h - 4, h * 0.35);
  ctx.globalAlpha = dim ? 0.45 : 1;
  ctx.fillStyle = bg;
  ctx.fill();
  ctx.lineWidth = 4;
  ctx.strokeStyle = 'rgba(255,255,255,0.8)';
  ctx.stroke();
  ctx.fillStyle = fg;
  ctx.font = `800 ${h * 0.46}px system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, w / 2, h / 2 + 2);
  ctx.globalAlpha = 1;
}

function drawLines(ctx, w, h, lines, { bg = 'rgba(10,14,28,0.82)', border = null } = {}) {
  ctx.clearRect(0, 0, w, h);
  roundRect(ctx, 4, 4, w - 8, h - 8, 24);
  ctx.fillStyle = bg;
  ctx.fill();
  if (border) {
    ctx.lineWidth = 10;
    ctx.strokeStyle = border;
    ctx.stroke();
  }
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const step = h / (lines.length + 1);
  lines.forEach((line, i) => {
    let size = line.size ?? h * 0.22;
    ctx.font = `${line.weight ?? 700} ${size}px system-ui, sans-serif`;
    while (ctx.measureText(line.text).width > w * 0.92 && size > 12) {
      size -= 2;
      ctx.font = `${line.weight ?? 700} ${size}px system-ui, sans-serif`;
    }
    ctx.fillStyle = line.color ?? '#eef2ff';
    ctx.fillText(line.text, w / 2, step * (i + 1));
  });
}

/**
 * An UNO card table with 8 chairs. Builds the furniture from the server's table definition,
 * then renders whatever public state + private hand the server sends. All clicks (mouse or VR
 * trigger) arrive through `handlePick(metadata)`; actions go back out via `send`.
 */
export class UnoTableView {
  constructor(scene, def, { selfId, send, toast, onSeatChange, onChange }) {
    this.scene = scene;
    this.def = def;
    this.selfId = selfId;
    this.send = send;
    this.toast = toast;
    this.onSeatChange = onSeatChange;
    this.onChange = onChange;
    this.state = def;
    this.hand = [];
    this.selfSeat = null;
    this.pendingWild = null;
    this.cards = new CardMaterials(scene);
    this.labelKeys = [];

    this.root = new B.TransformNode(`uno-${def.id}`, scene);
    this.root.position.set(def.x, 0, def.z);

    // One frame per seat (see the layout constants above).
    this.frames = [];
    this.chairNodes = [];
    for (let k = 0; k < def.seats; k++) {
      const frame = new B.TransformNode(`uno-seat-${k}`, scene);
      frame.parent = this.root;
      frame.rotation.y = this.#seatAngle(k) + Math.PI;
      const chair = new B.TransformNode(`uno-chair-${k}`, scene);
      chair.parent = frame;
      chair.position.z = -def.chairRadius;
      this.frames.push(frame);
      this.chairNodes.push(chair);
    }

    this.colliders = [circle(def.x, def.z, TABLE_RADIUS)];
    for (let k = 0; k < def.seats; k++) {
      const spot = this.seatSpot(k);
      this.colliders.push(box(spot.x, spot.z, 0.52, 0.51, this.#seatAngle(k) + Math.PI));
    }

    this.#buildLabels();
    this.#buildCentre();
    this.#buildOwnControls();
    this.setEnabled(false);
  }

  // ---- geometry -----------------------------------------------------------------

  #seatAngle(k) {
    return (k / this.def.seats) * Math.PI * 2;
  }

  /** World position of a chair (matches the server's seatPosition). */
  seatSpot(k) {
    const a = this.#seatAngle(k);
    return { x: this.def.x + Math.sin(a) * this.def.chairRadius, z: this.def.z + Math.cos(a) * this.def.chairRadius };
  }

  /** Where the seated player's eyes go, and what they look at. */
  seatEye(k) {
    const world = this.frames[k].computeWorldMatrix(true);
    return { position: B.Vector3.TransformCoordinates(EYE, world), target: B.Vector3.TransformCoordinates(LOOK_AT, world) };
  }

  /** A standing spot just behind a chair, for when you get up. */
  standSpot(k) {
    const a = this.#seatAngle(k);
    const r = this.def.chairRadius + 0.75;
    return new B.Vector3(this.def.x + Math.sin(a) * r, 1.7, this.def.z + Math.cos(a) * r);
  }

  nearestFreeSeat(pos, maxDist) {
    let best = null;
    let bestDist = maxDist;
    (this.state.seatState ?? []).forEach((s) => {
      if (s.player) return;
      const spot = this.seatSpot(s.seat);
      const d = Math.hypot(pos.x - spot.x, pos.z - spot.z);
      if (d <= bestDist) {
        best = s.seat;
        bestDist = d;
      }
    });
    return best;
  }

  // ---- building -----------------------------------------------------------------

  async load() {
    const table = await loadModel(this.scene, 'octagon_card_table.glb', this.root);
    const chair = await loadModel(this.scene, 'card_chair.glb', this.chairNodes[0]);
    for (const part of chair) part.metadata = { uno: 'sit', table: this.def.id, seat: 0 };
    // Seats 1..7 reuse the first chair's meshes as GPU instances.
    const instances = [];
    for (let k = 1; k < this.def.seats; k++) {
      for (const part of chair) {
        const inst = part.createInstance(`chair-${k}-${part.name}`);
        inst.parent = this.chairNodes[k];
        inst.metadata = { uno: 'sit', table: this.def.id, seat: k };
        instances.push(inst);
      }
    }
    for (const part of table) part.isPickable = false;
    const furniture = [...table, ...chair, ...instances];
    this.reflections = roomReflections(this.scene, new B.Vector3(this.def.x, 1.2, this.def.z), new Set(furniture));
    applyReflections([...table, ...chair], this.reflections);
    if (this.root.isEnabled()) this.reflections.capture();
  }

  #buildLabels() {
    this.sign = canvasPlane(this.scene, { name: 'uno-sign', width: 2.2, height: 0.45, res: 768, billboard: true });
    this.sign.mesh.parent = this.root;
    this.sign.mesh.position.y = 2.6;
    this.sign.draw((ctx, w, h) =>
      drawLines(ctx, w, h, [{ text: '🃏 UNO table — walk up to a chair', size: h * 0.42 }], { border: '#fbc02d' }),
    );

    // Billboards ignore a rotated parent's orientation, so place labels in (unrotated) table space.
    this.seatLabels = this.frames.map((frame, k) => {
      const label = canvasPlane(this.scene, { name: `uno-seat-label-${k}`, width: 0.62, height: 0.2, res: 384, billboard: true });
      const a = this.#seatAngle(k);
      const r = this.def.chairRadius + 0.1;
      label.mesh.parent = this.root;
      label.mesh.position.set(Math.sin(a) * r, 1.5, Math.cos(a) * r);
      return label;
    });

    this.highlight = B.MeshBuilder.CreateTorus('uno-seat-highlight', { diameter: 0.9, thickness: 0.04, tessellation: 32 }, this.scene);
    const mat = new B.StandardMaterial('uno-highlight-mat', this.scene);
    mat.emissiveColor = new B.Color3(0.24, 0.86, 0.6);
    mat.disableLighting = true;
    this.highlight.material = mat;
    this.highlight.isPickable = false;
    this.highlight.setEnabled(false);
  }

  #buildCentre() {
    // Draw pile: a short stack of face-down cards in the middle (clicking it draws).
    this.deck = B.MeshBuilder.CreateBox('uno-deck', { width: CARD_W * 1.6, height: 0.04, depth: CARD_H * 1.6 }, this.scene);
    this.deck.parent = this.root;
    this.deck.position.set(-0.16, 0.835, 0);
    const deckMat = new B.StandardMaterial('uno-deck-mat', this.scene);
    deckMat.diffuseColor = new B.Color3(0.08, 0.08, 0.1);
    this.deck.material = deckMat;
    const deckTop = B.MeshBuilder.CreatePlane('uno-deck-top', { width: CARD_W * 1.6, height: CARD_H * 1.6 }, this.scene);
    deckTop.parent = this.deck;
    deckTop.rotation.x = Math.PI / 2;
    deckTop.position.y = 0.021;
    deckTop.material = this.cards.back();
    this.deck.metadata = deckTop.metadata = { uno: 'draw', table: this.def.id };

    // The discard pile's top card floats above the table, turning to face everyone.
    this.topCard = B.MeshBuilder.CreatePlane('uno-top-card', { width: CARD_W * 2.2, height: CARD_H * 2.2 }, this.scene);
    this.topCard.parent = this.root;
    this.topCard.position.set(0.12, 1.12, 0);
    this.topCard.billboardMode = B.Mesh.BILLBOARDMODE_Y;
    this.topCard.isPickable = false;

    this.status = canvasPlane(this.scene, { name: 'uno-status', width: 1.9, height: 0.42, res: 1024, billboard: true });
    this.status.mesh.parent = this.root;
    this.status.mesh.position.y = 1.45;
  }

  #buildOwnControls() {
    // Everything here is re-parented to whichever seat you sit in.
    this.own = new B.TransformNode('uno-own', this.scene);
    this.own.parent = this.root;
    this.handMeshes = [];

    const mkButton = (name, x, y, action) => {
      const btn = canvasPlane(this.scene, { name: `uno-btn-${name}`, width: 0.15, height: 0.055, res: 256 });
      btn.mesh.parent = this.own;
      btn.mesh.position.set(x, y, HAND_Z - 0.03);
      btn.mesh.rotation.x = TILT;
      btn.mesh.isPickable = true;
      btn.mesh.metadata = { uno: action, table: this.def.id };
      return btn;
    };
    this.buttons = {
      ready: mkButton('ready', -BUTTON_X, 1.0, 'ready'),
      leave: mkButton('leave', -BUTTON_X, 0.93, 'leave'),
      uno: mkButton('uno', BUTTON_X, 1.0, 'uno'),
      draw: mkButton('draw', BUTTON_X, 0.93, 'draw'),
    };
    this.buttons.leave.draw((ctx, w, h) => drawButton(ctx, w, h, '🚪 Leave', { bg: '#5a2330' }));
    this.buttons.uno.draw((ctx, w, h) => drawButton(ctx, w, h, 'UNO!', { bg: '#e53935' }));
    this.buttons.draw.draw((ctx, w, h) => drawButton(ctx, w, h, '🂠 Draw', { bg: '#1e88e5' }));

    // Colour picker for wild cards.
    this.picker = Object.keys(CARD_COLORS).map((color, i) => {
      const chip = B.MeshBuilder.CreatePlane(`uno-pick-${color}`, { width: 0.065, height: 0.065 }, this.scene);
      chip.parent = this.own;
      chip.position.set(-0.11 + i * 0.075, 1.13, HAND_Z + 0.04);
      chip.rotation.x = TILT;
      const mat = new B.StandardMaterial(`uno-pick-mat-${color}`, this.scene);
      mat.emissiveColor = B.Color3.FromHexString(CARD_COLORS[color]);
      mat.disableLighting = true;
      chip.material = mat;
      chip.metadata = { uno: 'color', table: this.def.id, color };
      chip.setEnabled(false);
      return chip;
    });
    this.own.setEnabled(false);
  }

  setEnabled(on) {
    this.root.setEnabled(on);
    if (on) this.reflections?.capture();
    clearInterval(this.ticker);
    // Redraw the status panel each second for the turn countdown.
    if (on) this.ticker = setInterval(() => this.#drawStatus(), 1000);
  }

  highlightSeat(seat) {
    if (seat === null || seat === undefined) return this.highlight.setEnabled(false);
    const spot = this.seatSpot(seat);
    this.highlight.position.set(spot.x, 0.03, spot.z);
    this.highlight.setEnabled(true);
  }

  // ---- state from the server -------------------------------------------------------

  get mySeat() {
    return this.selfSeat === null ? null : this.state.seatState[this.selfSeat];
  }

  get myTurn() {
    return !!(this.state.game && this.mySeat?.inGame && this.state.game.turnSeat === this.selfSeat);
  }

  /** Controls summary for the 2D HUD panel. */
  controls() {
    const mine = this.mySeat;
    const g = this.state.game;
    const turnName = g ? (g.turnSeat === this.selfSeat ? 'Your turn' : `${this.state.seatState[g.turnSeat]?.player?.name ?? '?'}'s turn`) : null;
    return {
      // One-line summary for the 2D panel (the 3D sign above the table says the same).
      status: g ? `${turnName} · ${COLOR_EMOJI[g.color] ?? ''} ${g.color} · ${g.direction === 1 ? '↻' : '↺'} — ${this.state.event}` : (this.state.result ?? this.state.event ?? ''),
      seated: !!mine,
      ready: !!mine?.ready,
      playing: !!(mine?.inGame && this.state.game),
      waiting: !!(mine && !mine.inGame && this.state.game),
      myTurn: this.myTurn,
    };
  }

  update(state) {
    this.state = state;
    const seat = state.seatState.findIndex((s) => s.player?.id === this.selfId);
    const newSeat = seat >= 0 ? seat : null;
    if (newSeat !== this.selfSeat) {
      this.selfSeat = newSeat;
      if (newSeat === null) this.setHand([]);
      this.own.parent = newSeat === null ? this.root : this.frames[newSeat];
      this.own.setEnabled(newSeat !== null);
      this.onSeatChange?.(newSeat);
    }
    if (!state.game) this.pendingWild = null;

    this.#drawSeatLabels();
    this.#drawStatus();
    this.#drawCentre();
    this.#drawOpponents();
    this.#drawOwnControls();
    this.#layoutHand();
    this.onChange?.(this.controls());
  }

  setHand(cards) {
    this.hand = cards;
    if (this.pendingWild && !cards.some((c) => c.id === this.pendingWild)) this.pendingWild = null;
    this.#layoutHand();
  }

  #drawSeatLabels() {
    const g = this.state.game;
    this.state.seatState.forEach((s, k) => {
      let lines;
      let border = null;
      if (!s.player) lines = [{ text: '🪑 free seat', color: '#9aa6c4', size: 40 }];
      else {
        const turn = g && g.turnSeat === k;
        let status;
        if (g && s.inGame) status = `🃏 ${s.cards}${g.unoPendingSeat === k ? ' · UNO?!' : ''}${turn ? ' · ▶ turn' : ''}`;
        else if (g) status = '⏳ next game';
        else status = s.ready ? '✋ wants to play' : 'seated';
        lines = [
          { text: s.player.name, color: s.player.color, size: 44 },
          { text: status, size: 36, color: turn ? '#ffd166' : '#eef2ff' },
        ];
        if (turn) border = '#ffd166';
      }
      // Empty-seat labels are for people looking for a chair; hide them once you're seated.
      this.seatLabels[k].mesh.setEnabled(!!s.player || this.selfSeat === null);
      const key = JSON.stringify([lines, border]);
      if (this.labelKeys[k] === key) return;
      this.labelKeys[k] = key;
      this.seatLabels[k].draw((ctx, w, h) => drawLines(ctx, w, h, lines, { border }));
    });
  }

  #drawStatus() {
    const st = this.state;
    const g = st.game;
    let lines;
    let border = null;
    if (g) {
      const turnName = st.seatState[g.turnSeat]?.player?.name ?? '?';
      const secs = g.turnEndsAt ? Math.max(0, Math.round((g.turnEndsAt - Date.now()) / 1000)) : null;
      const whose = g.turnSeat === this.selfSeat ? 'Your turn!' : `${turnName}'s turn`;
      lines = [
        { text: `${whose}  ·  ${COLOR_EMOJI[g.color] ?? ''} ${g.color}  ·  ${g.direction === 1 ? '↻' : '↺'}${secs !== null ? `  ·  ${secs}s` : ''}`, size: 64 },
        { text: st.event ?? '', size: 44, color: '#9aa6c4', weight: 500 },
      ];
      border = CARD_COLORS[g.color];
    } else {
      const seated = st.seatState.filter((s) => s.player).length;
      const hint = seated < 2 ? 'Sit down to play — 2 to 8 players' : 'Starts when everyone at the table presses ✋ Play';
      lines = [
        { text: st.result ?? '🃏 UNO', size: 64, color: st.result ? '#ffd166' : '#eef2ff' },
        { text: hint, size: 44, color: '#9aa6c4', weight: 500 },
      ];
    }
    const key = JSON.stringify([lines, border]);
    if (key === this.statusKey) return;
    this.statusKey = key;
    this.status.draw((ctx, w, h) => drawLines(ctx, w, h, lines, { border }));
  }

  #drawCentre() {
    const g = this.state.game;
    this.deck.setEnabled(!!g);
    this.topCard.setEnabled(!!g);
    if (g) this.topCard.material = this.cards.face(g.top.color ? g.top : { ...g.top, color: null });
  }

  /** Face-down cards in front of everyone else who is playing: counts are public, faces aren't. */
  #drawOpponents() {
    if (!this.backBase) {
      this.backBase = B.MeshBuilder.CreatePlane('uno-back-base', { width: CARD_W * 0.8, height: CARD_H * 0.8 }, this.scene);
      this.backBase.material = this.cards.back();
      this.backBase.isPickable = false;
      this.backBase.setEnabled(false);
      this.backs = [];
    }
    for (const b of this.backs) b.dispose();
    this.backs = [];
    if (!this.state.game) return;
    this.state.seatState.forEach((s, k) => {
      if (!s.player || !s.inGame || k === this.selfSeat) return;
      const shown = Math.min(s.cards, 12);
      for (let i = 0; i < shown; i++) {
        const back = this.backBase.createInstance(`uno-back-${k}-${i}`);
        back.parent = this.frames[k];
        back.position.set((i - (shown - 1) / 2) * 0.035, HAND_Y, HAND_Z);
        back.rotation.x = TILT;
        back.isPickable = false;
        this.backs.push(back);
      }
    });
  }

  #drawOwnControls() {
    const c = this.controls();
    const { ready, uno, draw } = this.buttons;
    ready.mesh.setEnabled(c.seated && !c.playing);
    ready.draw((ctx, w, h) =>
      drawButton(ctx, w, h, c.waiting ? (c.ready ? '✓ Next game' : '✋ Next game') : c.ready ? '✓ Ready' : '✋ Play', {
        bg: c.ready ? '#2e7d32' : '#6a4fd8',
      }),
    );
    uno.mesh.setEnabled(c.playing);
    draw.mesh.setEnabled(c.playing);
    draw.draw((ctx, w, h) => drawButton(ctx, w, h, '🂠 Draw', { bg: '#1e88e5', dim: !c.myTurn }));
    for (const chip of this.picker) chip.setEnabled(!!this.pendingWild && c.myTurn);
  }

  #layoutHand() {
    for (const m of this.handMeshes) m.dispose();
    this.handMeshes = [];
    if (this.selfSeat === null || !this.hand.length) return;
    const g = this.state.game;
    const myTurn = this.myTurn;
    const n = this.hand.length;
    this.hand.forEach((card, i) => {
      const row = Math.floor(i / PER_ROW);
      const inRow = Math.min(PER_ROW, n - row * PER_ROW);
      const col = i % PER_ROW;
      const playable = myTurn && g && canPlay(card, g.top, g.color);
      const mesh = B.MeshBuilder.CreatePlane(`uno-card-${card.id}`, { width: CARD_W, height: CARD_H }, this.scene);
      mesh.parent = this.own;
      mesh.position.set((col - (inRow - 1) / 2) * (CARD_W + CARD_GAP), HAND_Y + row * 0.07 + (playable ? 0.018 : 0), HAND_Z + row * 0.045);
      mesh.rotation.x = TILT;
      mesh.material = this.cards.face(card);
      // On your turn, cards you can't play are dimmed and playable ones lift up.
      mesh.visibility = myTurn && !playable ? 0.5 : 1;
      if (card.id === this.pendingWild) mesh.position.y += 0.03;
      mesh.metadata = { uno: 'card', table: this.def.id, id: card.id };
      this.handMeshes.push(mesh);
    });
  }

  // ---- input -------------------------------------------------------------------------

  /** Handle a click / VR trigger on one of this table's meshes. */
  handlePick(meta) {
    const g = this.state.game;
    switch (meta.uno) {
      case 'sit':
        if (this.selfSeat === meta.seat) return;
        if (this.state.seatState[meta.seat]?.player) return this.toast('That seat is taken');
        return this.send({ t: 'table-sit', table: this.def.id, seat: meta.seat });
      case 'leave':
        return this.send({ t: 'table-stand' });
      case 'ready':
        return this.send({ t: 'uno-ready', ready: !this.mySeat?.ready });
      case 'uno':
        return this.send({ t: 'uno-call' });
      case 'draw':
        if (!this.myTurn) return this.toast("It's not your turn");
        return this.send({ t: 'uno-draw' });
      case 'card': {
        if (!this.myTurn) return this.toast("It's not your turn");
        const card = this.hand.find((c) => c.id === meta.id);
        if (!card) return;
        if (!canPlay(card, g.top, g.color)) return this.toast(`You can't play that on ${g.color} ${g.top.value}`);
        if (isWild(card)) {
          this.pendingWild = card.id;
          this.toast('Pick a colour for your wild card');
          this.#drawOwnControls();
          return this.#layoutHand();
        }
        return this.send({ t: 'uno-play', card: card.id });
      }
      case 'color':
        if (!this.pendingWild) return;
        this.send({ t: 'uno-play', card: this.pendingWild, color: meta.color });
        this.pendingWild = null;
        this.#drawOwnControls();
        return this.#layoutHand();
    }
  }
}
