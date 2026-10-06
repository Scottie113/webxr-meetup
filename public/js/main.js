/* global BABYLON */
import { api, loadCreds, saveCreds, clearCreds } from './api.js';
import { Net } from './net.js';
import { createWorld } from './world.js';
import { resolveCollisions } from './collision.js';
import { Avatar, floatingText, EMOTE_ICONS } from './avatars.js';
import * as ui from './ui.js';

const B = BABYLON;
const $ = (id) => document.getElementById(id);
const EYE_HEIGHT = 1.7;
const WORLD_LIMIT = 38;
const PLAYER_RADIUS = 0.35;
const POSE_INTERVAL_MS = 66;

let meta;
let creds = loadCreds();

// ---------------------------------------------------------------- lobby ----

async function initLobby() {
  meta = await api.meta();
  $('interests').replaceChildren(
    ...meta.interests.map((i) => ui.el('label', {}, [ui.el('input', { type: 'checkbox', value: i }), i])),
  );
  $('interests').addEventListener('change', (e) => {
    if (selectedInterests().length > 3) {
      e.target.checked = false;
      showLobbyError('Pick at most 3 interests');
    }
  });

  if (creds) {
    try {
      const me = await api.me(creds);
      $('name').value = me.name;
      $('color').value = me.color;
      for (const box of $('interests').querySelectorAll('input')) box.checked = me.interests.includes(box.value);
    } catch (err) {
      if (err.status === 401 || err.status === 404) {
        clearCreds();
        creds = null;
      }
    }
  }
  await loadRooms();

  $('create-room').addEventListener('click', () =>
    withLobbyErrors(async () => {
      const name = $('new-room').value.trim();
      if (!name) throw new Error('Type a room name first');
      await ensurePlayer();
      const room = await api.createRoom(creds, name);
      $('new-room').value = '';
      await loadRooms(room.id);
    }),
  );

  $('join-form').addEventListener('submit', (e) => {
    e.preventDefault();
    withLobbyErrors(async () => {
      const player = await ensurePlayer();
      startGame(player, $('room').value || 'plaza');
    });
  });
}

const selectedInterests = () => [...$('interests').querySelectorAll('input:checked')].map((b) => b.value);
const profile = () => ({ name: $('name').value, color: $('color').value, interests: selectedInterests() });

function showLobbyError(message) {
  $('lobby-error').textContent = message;
}

async function withLobbyErrors(fn) {
  showLobbyError('');
  try {
    await fn();
  } catch (err) {
    showLobbyError(err.message);
  }
}

async function loadRooms(selectId) {
  const current = selectId || $('room').value || 'plaza';
  const rooms = await api.rooms();
  $('room').replaceChildren(
    ...rooms.map((r) => ui.el('option', { value: r.id, textContent: `${r.name} (${r.online} online)`, selected: r.id === current })),
  );
}

/** Register on first visit, otherwise save profile edits. Returns the public player. */
async function ensurePlayer() {
  if (!$('name').value.trim()) throw new Error('Pick a display name first');
  if (creds) return api.updateMe(creds, profile());
  const { player, token } = await api.register(profile());
  creds = { id: player.id, token };
  saveCreds(creds);
  return player;
}

// ----------------------------------------------------------------- game ----

async function startGame(initialPlayer, roomId) {
  $('lobby').hidden = true;
  $('hud').hidden = false;

  let self = initialPlayer;
  let connectDistance = meta.connectDistance;
  const avatars = new Map();
  const net = new Net();

  const canvas = $('scene');
  const engine = new B.Engine(canvas, true, { stencil: true }, true);
  const scene = new B.Scene(engine);
  const world = createWorld(scene, meta.interests);

  // Desktop / phone camera. In XR, Babylon swaps in its own WebXRCamera.
  const camera = new B.UniversalCamera('camera', new B.Vector3(0, EYE_HEIGHT, 8), scene);
  camera.setTarget(new B.Vector3(0, EYE_HEIGHT, 0));
  camera.attachControl(canvas, true);
  camera.minZ = 0.05;
  camera.speed = 0.18;
  camera.angularSensibility = 3000;
  camera.keysUp.push(87); // W
  camera.keysDown.push(83); // S
  camera.keysLeft.push(65); // A
  camera.keysRight.push(68); // D

  // Keep the walker at eye height, inside the plaza, and out of benches/booths/fountain.
  // Runs right after the camera applies keyboard/touch movement, before the frame is drawn.
  camera.onAfterCheckInputsObservable.add(() => {
    const p = camera.position;
    p.y = EYE_HEIGHT;
    p.x = Math.max(-WORLD_LIMIT, Math.min(WORLD_LIMIT, p.x));
    p.z = Math.max(-WORLD_LIMIT, Math.min(WORLD_LIMIT, p.z));
    resolveCollisions(p, PLAYER_RADIUS, world.colliders);
  });

  // ---- WebXR -------------------------------------------------------------
  const controllers = { left: null, right: null };
  let xr = null;
  const inXR = () => xr?.baseExperience.state === B.WebXRState.IN_XR;
  if (navigator.xr && (await navigator.xr.isSessionSupported('immersive-vr').catch(() => false))) {
    try {
      xr = await scene.createDefaultXRExperienceAsync({ floorMeshes: [world.ground] });
      xr.input.onControllerAddedObservable.add((controller) => {
        const hand = controller.inputSource.handedness;
        if (hand === 'left' || hand === 'right') controllers[hand] = controller;
        controller.onMotionControllerInitObservable.add((mc) => {
          const bind = (ids, fn) => {
            for (const id of ids) {
              mc.getComponent(id)?.onButtonStateChangedObservable.add((c) => {
                if (c.changes.pressed && c.pressed) fn();
              });
            }
          };
          bind(['a-button', 'x-button'], () => sendEmote('wave'));
          bind(['b-button', 'y-button'], () => connectNearest());
        });
      });
      xr.input.onControllerRemovedObservable.add((controller) => {
        const hand = controller.inputSource.handedness;
        if (controllers[hand] === controller) controllers[hand] = null;
      });
      xr.baseExperience.onStateChangedObservable.add((state) => {
        if (state === B.WebXRState.IN_XR) ui.toast('Point at someone and pull the trigger to connect 🤝');
      });
    } catch (err) {
      console.warn('WebXR unavailable', err);
    }
  }

  // ---- networking --------------------------------------------------------
  function addAvatar({ player, pose, hands }) {
    if (player.id === self.id || avatars.has(player.id)) return;
    const avatar = new Avatar(scene, player);
    if (pose) avatar.setTarget(pose, hands?.[0], hands?.[1]);
    avatars.set(player.id, avatar);
  }

  function removeAvatar(id) {
    avatars.get(id)?.dispose();
    avatars.delete(id);
  }

  net.on('status', ui.setStatus);

  net.on('welcome', (msg) => {
    self = msg.self;
    connectDistance = msg.connectDistance;
    for (const id of [...avatars.keys()]) removeAvatar(id); // fresh state after a reconnect
    msg.peers.forEach(addAvatar);
    ui.setRoomName(msg.room.name);
    ui.setScore(self);
    ui.renderBoard(msg.leaderboard, self.id);
    world.updateBoard(msg.leaderboard, self.id);
    if (!welcomed) {
      camera.position.set(msg.spawn[0], EYE_HEIGHT, msg.spawn[2]);
      ui.toast(`Welcome, ${self.name}! ${msg.peers.length} other(s) here.`, 'good');
      welcomed = true;
    }
  });
  let welcomed = false;

  net.on('peer-join', (msg) => {
    addAvatar(msg);
    ui.toast(`${msg.player.name} joined`);
  });

  net.on('peer-leave', ({ id }) => {
    const name = avatars.get(id)?.player.name;
    removeAvatar(id);
    if (name) ui.toast(`${name} left`);
  });

  net.on('poses', ({ list }) => {
    for (const p of list) avatars.get(p.id)?.setTarget(p.h, p.l, p.r);
  });

  net.on('chat', ({ id, name, text }) => {
    const avatar = avatars.get(id);
    ui.addChat(name, text, id === self.id ? self.color : avatar?.player.color);
    avatar?.say(text);
  });

  net.on('emote', ({ id, e }) => {
    if (id === self.id) {
      const cam = scene.activeCamera;
      floatingText(scene, cam.globalPosition.add(cam.getDirection(B.Axis.Z).scale(1.5)), EMOTE_ICONS[e], { size: 0.4 });
    } else {
      avatars.get(id)?.emote(e);
    }
  });

  net.on('connected', ({ a, b, earned, shared }) => {
    for (const p of [a, b]) {
      if (p.id === self.id) self = p;
      else avatars.get(p.id)?.updatePlayer(p);
    }
    ui.setScore(self);
    if (a.id === self.id || b.id === self.id) {
      const other = a.id === self.id ? b : a;
      const bonus = shared.length ? ` (shared: ${shared.join(', ')})` : '';
      ui.toast(`🤝 You connected with ${other.name}! +${earned}${bonus}`, 'good');
      const avatar = avatars.get(other.id);
      if (avatar) floatingText(scene, avatar.head.position.add(new B.Vector3(0, 0.7, 0)), `+${earned}`, { color: '#3ddc97' });
    } else {
      ui.toast(`${a.name} 🤝 ${b.name}`);
    }
  });

  net.on('leaderboard', ({ top }) => {
    ui.renderBoard(top, self.id);
    world.updateBoard(top, self.id);
  });

  net.on('error', ({ code, message }) => {
    ui.toast(message, 'bad');
    if (code === 'unauthorized') {
      clearCreds();
      setTimeout(() => location.reload(), 1500);
    }
  });

  net.connect({ id: creds.id, token: creds.token, room: roomId });

  // ---- actions -----------------------------------------------------------
  const selfPos = () => scene.activeCamera.globalPosition;
  const isConnected = (id) => self.connections.includes(id);

  function nearest() {
    let best = null;
    let bestDist = Infinity;
    const me = selfPos();
    for (const avatar of avatars.values()) {
      const p = avatar.head.position;
      const d = Math.hypot(p.x - me.x, p.z - me.z);
      if (d <= connectDistance && d < bestDist) {
        best = avatar;
        bestDist = d;
      }
    }
    return best;
  }

  function connectTo(id) {
    if (isConnected(id)) return ui.toast(`Already connected with ${avatars.get(id)?.player.name ?? 'them'}`);
    net.send({ t: 'connect', target: id });
  }

  function connectNearest() {
    const target = nearest();
    if (target && !isConnected(target.player.id)) connectTo(target.player.id);
    else ui.toast(`Get within ${connectDistance}m of someone new to connect`);
  }

  function sendEmote(e) {
    net.send({ t: 'emote', e });
  }

  // Click / XR-trigger on an avatar to connect.
  scene.onPointerObservable.add((info) => {
    if (info.type !== B.PointerEventTypes.POINTERPICK) return;
    const id = info.pickInfo?.pickedMesh?.metadata?.playerId;
    if (id) connectTo(id);
  });

  $('connect-btn').addEventListener('click', connectNearest);
  for (const btn of document.querySelectorAll('[data-emote]')) btn.addEventListener('click', () => sendEmote(btn.dataset.emote));
  $('leave').addEventListener('click', () => {
    net.close();
    location.reload();
  });

  $('chat-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const text = $('chat-input').value.trim();
    if (text) net.send({ t: 'chat', text });
    $('chat-input').value = '';
    $('chat-input').blur();
    canvas.focus();
  });

  window.addEventListener('keydown', (e) => {
    if (e.target instanceof HTMLInputElement) {
      if (e.key === 'Escape') e.target.blur();
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      $('chat-input').focus();
    } else if (e.key === 'c' || e.key === 'C') connectNearest();
    else if (['1', '2', '3', '4'].includes(e.key)) sendEmote(meta.emotes[Number(e.key) - 1]);
  });

  // ---- per-frame ---------------------------------------------------------
  let lastSent = 0;
  let lastPoseKey = '';
  const poseOf = (node) => {
    const p = node.absolutePosition ?? node.globalPosition;
    const q = node.absoluteRotationQuaternion ?? node.absoluteRotation;
    return [p.x, p.y, p.z, q.x, q.y, q.z, q.w].map((n) => Math.round(n * 1000) / 1000);
  };

  scene.onBeforeRenderObservable.add(() => {
    const dt = engine.getDeltaTime() / 1000;

    for (const avatar of avatars.values()) avatar.update(dt);

    const near = nearest();
    for (const avatar of avatars.values()) {
      const id = avatar.player.id;
      avatar.setHighlight(isConnected(id) ? 'connected' : avatar === near ? 'near' : 'none');
    }
    ui.setConnectTarget(near, near && isConnected(near.player.id));

    // Send our pose ~15x/s, only when it changed (plus a 1s keep-alive).
    const now = performance.now();
    if (now - lastSent < POSE_INTERVAL_MS) return;
    const cam = scene.activeCamera;
    const head = [cam.globalPosition.x, cam.globalPosition.y, cam.globalPosition.z, ...cam.absoluteRotation.asArray()].map(
      (n) => Math.round(n * 1000) / 1000,
    );
    const handNode = (c) => c && (c.grip || c.pointer);
    const l = inXR() && handNode(controllers.left) ? poseOf(handNode(controllers.left)) : null;
    const r = inXR() && handNode(controllers.right) ? poseOf(handNode(controllers.right)) : null;
    const key = JSON.stringify([head, l, r]);
    if (key !== lastPoseKey || now - lastSent > 1000) {
      net.send({ t: 'pose', h: head, l, r });
      lastPoseKey = key;
      lastSent = now;
    }
  });

  engine.runRenderLoop(() => scene.render());
  window.addEventListener('resize', () => engine.resize());
  canvas.focus();
}

initLobby().catch((err) => showLobbyError(`Could not reach the server: ${err.message}`));
