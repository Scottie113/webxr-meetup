/* global BABYLON */
import { api, loadCreds, saveCreds, clearCreds } from './api.js';
import { Net } from './net.js';
import { createWorld } from './world.js';
import { resolveCollisions, touchedPortal } from './collision.js';
import { Avatar, floatingText, EMOTE_ICONS } from './avatars.js';
import * as ui from './ui.js';
import { UnoTableView } from './unoTable.js';
import { createFader, createAimBeam, captureView } from './portals.js';
import { paintingArrival, paintingViewpoint } from './gallery.js';

const B = BABYLON;
const $ = (id) => document.getElementById(id);
const EYE_HEIGHT = 1.7;
const WORLD_LIMIT = 38;
const PLAYER_RADIUS = 0.35;
const PORTAL_REACH = 6; // metres: how close PC players must be to double-click a painting portal
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
  const world = createWorld(scene, await api.rooms(), meta.interests);
  let currentRoomId = null;
  let switchingTo = null; // room id we asked the server for, until its welcome arrives
  let portalCooldownUntil = 0; // after a failed switch, wait before a portal can fire again

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
    // Sitting at a card table: stay in the chair (mouse-look still works).
    if (seated) {
      p.copyFrom(seated.eye);
      return;
    }
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

  // In-world board: only the players in this room. The HUD board lists everyone on the site.
  function refreshRoomBoard() {
    const here = [self, ...[...avatars.values()].map((a) => a.player)];
    here.sort((x, y) => y.points - x.points || x.name.localeCompare(y.name));
    world.updateBoard(here, self.id);
  }

  // ---- card tables -----------------------------------------------------
  const tableViews = new Map(); // table id -> UnoTableView (kept once built)
  const activeTables = new Set(); // views in the current room
  let seated = null; // { view, seat, eye } while sitting at a table

  function toggleTable(view, on) {
    view.setEnabled(on);
    for (const c of view.colliders) {
      const i = world.colliders.indexOf(c);
      if (on && i < 0) world.colliders.push(c);
      if (!on && i >= 0) world.colliders.splice(i, 1);
    }
    if (on) activeTables.add(view);
    else {
      activeTables.delete(view);
      view.highlightSeat(null);
    }
  }

  function syncTables(list) {
    seated = null;
    updateUnoPanel(null);
    for (const view of tableViews.values()) toggleTable(view, false);
    for (const def of list ?? []) {
      let view = tableViews.get(def.id);
      if (!view) {
        view = new UnoTableView(scene, def, {
          selfId: creds.id,
          send: (m) => net.send(m),
          toast: (m) => ui.toast(m),
          onSeatChange: (seat) => onSeatChange(view, seat),
          onChange: (controls) => updateUnoPanel(controls),
        });
        tableViews.set(def.id, view);
        view.load().catch((err) => console.warn('Could not load the card table models', err));
      }
      toggleTable(view, true);
      view.update(def);
    }
  }

  function placeCamera(position, target) {
    camera.cameraDirection.setAll(0);
    camera.position.copyFrom(position);
    if (target) camera.setTarget(target);
    if (inXR()) {
      const xrCam = xr.baseExperience.camera;
      xrCam.position.x = position.x;
      xrCam.position.z = position.z;
    }
  }

  function onSeatChange(view, seat) {
    if (seat !== null) {
      const { position, target } = view.seatEye(seat);
      seated = { view, seat, eye: position };
      placeCamera(position, target);
      ui.toast("You sat down. Press ✋ Play when you're ready · Q to leave", 'good');
    } else if (seated?.view === view) {
      const spot = view.standSpot(seated.seat);
      seated = null;
      placeCamera(spot);
    }
  }

  function updateUnoPanel(c) {
    $('uno-panel').hidden = !c?.seated;
    if (!c?.seated) return;
    $('uno-status').textContent = c.status;
    $('uno-ready').hidden = c.playing;
    $('uno-ready').textContent = c.waiting ? (c.ready ? '✓ Joining next game' : '✋ Join next game') : c.ready ? '✓ Ready' : '✋ Play';
    $('uno-draw').hidden = !c.playing;
    $('uno-call').hidden = !c.playing;
    $('uno-draw').disabled = !c.myTurn;
    $('uno-hint').textContent = c.playing
      ? c.myTurn
        ? 'Your turn — click a card to play it, or Draw if you have nothing to play.'
        : 'Wait for your turn. Hit UNO! fast if someone is down to one card.'
      : c.waiting
        ? "A game is in progress — you'll join the next one."
        : 'The game starts when everyone at the table has pressed ✋ Play.';
  }

  const tableAction = (action) => seated?.view.handlePick({ uno: action, table: seated.view.def.id });
  $('uno-ready').addEventListener('click', () => tableAction('ready'));
  $('uno-draw').addEventListener('click', () => tableAction('draw'));
  $('uno-call').addEventListener('click', () => tableAction('uno'));
  $('uno-leave').addEventListener('click', () => tableAction('leave'));

  net.on('table', ({ table }) => tableViews.get(table.id)?.update(table));
  net.on('uno-hand', ({ table, cards }) => tableViews.get(table)?.setHand(cards));

  // Sent on first join, after a reconnect, and every time we teleport to another room.
  net.on('welcome', (msg) => {
    self = msg.self;
    connectDistance = msg.connectDistance;
    for (const id of [...avatars.keys()]) removeAvatar(id);
    msg.peers.forEach(addAvatar);

    const changedRoom = msg.room.id !== currentRoomId;
    currentRoomId = msg.room.id;
    switchingTo = null;
    net.join.room = msg.room.id; // reconnects rejoin the room we're in now
    world.setRoom(msg.room);
    syncTables(msg.tables);
    ui.setRoomName(msg.room.name);
    ui.setScore(self);
    ui.renderBoard(msg.leaderboard, self.id);
    refreshRoomBoard();

    const arrival = portalTrip;
    portalTrip = null;
    if (changedRoom) {
      // Arrive at the room's spawn point facing the fountain, or just in front of the painting
      // you stepped out of.
      const out = arrival?.from && paintingArrival(arrival.from);
      const pos = out?.position ?? new B.Vector3(msg.spawn[0], EYE_HEIGHT, msg.spawn[2]);
      placeCamera(pos, out?.target ?? new B.Vector3(msg.spawn[0], EYE_HEIGHT, 0));
      const others = msg.peers.length;
      const company = others ? `${others} other${others === 1 ? '' : 's'} here` : 'nobody else here yet';
      if (msg.room.kind === 'painting') {
        ui.toast(`✨ You stepped into ${msg.room.name}. The window behind you leads back. (${company})`, 'good');
        // Show the room we just left in the window back.
        world.prop(msg.room.id).then((p) => p?.setWindowView?.(arrival?.snapshot ?? null));
      } else {
        ui.toast(`📍 ${msg.room.name}: ${company}`, 'good');
      }
    }
    syncFloors();
    if (arrival) fader.fadeIn();
  });

  net.on('peer-join', (msg) => {
    addAvatar(msg);
    refreshRoomBoard();
    ui.toast(`${msg.player.name} joined`);
  });

  net.on('peer-leave', ({ id }) => {
    const name = avatars.get(id)?.player.name;
    removeAvatar(id);
    refreshRoomBoard();
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
    refreshRoomBoard();
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
  });

  net.on('error', ({ code, message }) => {
    ui.toast(message, 'bad');
    if (switchingTo) {
      // The switch failed: allow portals again, but not instantly (we're still touching the booth).
      switchingTo = null;
      portalCooldownUntil = performance.now() + 2500;
      if (portalTrip) {
        portalTrip = null;
        fader.fadeIn();
      }
    }
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

  // ---- painting portals ----------------------------------------------------
  const fader = createFader(scene);
  let portalTrip = null; // { from, to, snapshot } while travelling through a painting/window
  const isPortalMesh = (m) => !!m.metadata?.portal && m.isEnabled() && m.isVisible;

  /** Step through a painting (or the window back out of one) into another room. */
  async function travelThroughPortal(meta) {
    if (switchingTo || portalTrip || meta.portal === currentRoomId) return;
    if (seated) tableAction('leave');
    // Leaving the art room through a painting: snapshot the room from the painting's point of
    // view, so the window inside the painting shows where you came from.
    portalTrip = { from: currentRoomId, to: meta.portal, snapshot: null };
    switchingTo = meta.portal;
    const view = paintingViewpoint(meta.portal);
    if (view) {
      try {
        portalTrip.snapshot = await captureView(scene, view.position, view.target);
      } catch (err) {
        console.warn('Could not capture the window view', err);
      }
    }
    await fader.fadeOut();
    net.send({ t: 'switch-room', room: meta.portal });
    setTimeout(() => {
      // Never leave someone stuck behind the fade if the server doesn't answer.
      if (portalTrip?.to === meta.portal) {
        portalTrip = null;
        switchingTo = null;
        fader.fadeIn();
      }
    }, 5000);
  }

  // Shimmer effects of every portal mesh, registered as paintings load.
  const portalFx = new Set();
  scene.onNewMeshAddedObservable.add((m) => {
    queueMicrotask(() => m.metadata?.fx && portalFx.add(m.metadata.fx));
  });

  // Which portal (if any) the mouse / each VR controller is aiming at this frame.
  const aimBeams = { left: createAimBeam(scene, 'aim-left'), right: createAimBeam(scene, 'aim-right') };
  const aimRay = new B.Ray(B.Vector3.Zero(), B.Vector3.Forward(), 200);
  function updatePortalAiming() {
    const targets = new Set();
    let hint = '';
    if (inXR()) {
      // VR: a gold beam from each controller to the spot it's pointing at on a portal.
      for (const hand of ['left', 'right']) {
        const c = controllers[hand];
        if (!c) {
          aimBeams[hand].hide();
          continue;
        }
        c.getWorldPointerRayToRef(aimRay);
        const hit = scene.pickWithRay(aimRay, isPortalMesh);
        if (hit?.hit) {
          aimBeams[hand].show(aimRay.origin, hit.pickedPoint);
          targets.add(hit.pickedMesh.metadata.fx);
          hint = `Pull the trigger to step into ${hit.pickedMesh.metadata.label}`;
        } else aimBeams[hand].hide();
      }
    } else {
      aimBeams.left.hide();
      aimBeams.right.hide();
      // PC: hovering the mouse over a portal.
      const hit = scene.pick(scene.pointerX, scene.pointerY, isPortalMesh);
      if (hit?.hit) {
        targets.add(hit.pickedMesh.metadata.fx);
        const far = B.Vector3.Distance(selfPos(), hit.pickedPoint) > PORTAL_REACH;
        const name = hit.pickedMesh.metadata.label;
        hint = far ? `Walk closer to ${name} to step inside` : `Double-click to step into ${name}`;
      }
    }
    for (const fx of portalFx) fx.setActive(targets.has(fx));
    $('portal-hint').hidden = !hint;
    $('portal-hint').textContent = hint ? `✨ ${hint}` : '';
  }

  // Click (mouse) or trigger (VR controller) on things: avatars to connect, card-table chairs,
  // cards and buttons, and painting portals. VR selection arrives as a pointer-down with
  // pointerType "xr"; PC players double-click a portal from close by.
  scene.onPointerObservable.add((info) => {
    const isXR = info.event?.pointerType === 'xr';
    const meta = info.pickInfo?.pickedMesh?.metadata;
    if (!isXR && info.type === B.PointerEventTypes.POINTERDOUBLETAP && meta?.portal) {
      const dist = B.Vector3.Distance(selfPos(), info.pickInfo.pickedPoint);
      if (dist > PORTAL_REACH) ui.toast(`Walk closer to ${meta.label} to step inside`);
      else travelThroughPortal(meta);
      return;
    }
    if (info.type !== (isXR ? B.PointerEventTypes.POINTERDOWN : B.PointerEventTypes.POINTERPICK)) return;
    if (isXR && meta?.portal) travelThroughPortal(meta);
    else if (meta?.uno) tableViews.get(meta.table)?.handlePick(meta);
    else if (meta?.playerId) connectTo(meta.playerId);
  });

  // VR teleporting needs to know each room's floors (marble, the painting's hillside, ...).
  const knownFloors = new Set();
  function syncFloors() {
    world.floors().then((list) => {
      for (const mesh of list) {
        if (!xr || knownFloors.has(mesh)) continue;
        xr.teleportation.addFloorMesh(mesh);
        knownFloors.add(mesh);
      }
    });
  }

  function nearestFreeChair() {
    for (const view of activeTables) {
      const seat = view.nearestFreeSeat(selfPos(), 1.6);
      if (seat !== null) return { view, seat };
    }
    return null;
  }

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
    // Card table keys: E sit, Q leave, F draw, U call UNO.
    else if ((e.key === 'e' || e.key === 'E') && !seated) {
      const chair = nearestFreeChair();
      if (chair) chair.view.handlePick({ uno: 'sit', table: chair.view.def.id, seat: chair.seat });
    } else if ((e.key === 'q' || e.key === 'Q') && seated) tableAction('leave');
    else if ((e.key === 'f' || e.key === 'F') && seated) tableAction('draw');
    else if ((e.key === 'u' || e.key === 'U') && seated) tableAction('uno');
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

    // Walked into a booth? Ask the server to move us to that room (once per attempt).
    const portal = touchedPortal(selfPos(), PLAYER_RADIUS, world.colliders);
    if (portal && !switchingTo && portal.portal !== currentRoomId && performance.now() > portalCooldownUntil) {
      switchingTo = portal.portal;
      ui.toast('✨ Teleporting…');
      net.send({ t: 'switch-room', room: switchingTo });
      setTimeout(() => {
        if (switchingTo === portal.portal) switchingTo = null; // server never answered: allow a retry
      }, 4000);
    }

    // Standing near a free chair: highlight it and show how to sit.
    const chair = seated ? null : nearestFreeChair();
    for (const view of activeTables) view.highlightSeat(chair?.view === view ? chair.seat : null);
    $('sit-hint').hidden = !chair;
    updatePortalAiming();

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
