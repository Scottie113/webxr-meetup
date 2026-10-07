/* global BABYLON */
import { circle, box } from './collision.js';
import { loadGrandPiano } from './props.js';

const B = BABYLON;

const INTEREST_ICONS = {
  webxr: '🥽',
  gamedev: '🎮',
  '3d-art': '🎨',
  music: '🎵',
  ai: '🤖',
  hardware: '🔧',
  design: '✏️',
  web: '🌐',
  fitness: '💪',
  startups: '🚀',
};

/**
 * A plane carrying a canvas texture. `draw(ctx, w, h)` paints it.
 * Planes face -Z in Babylon, so rotate by PI when the viewer is on the +Z side.
 */
export function canvasPlane(scene, { name, width, height, res = 512, billboard = false }) {
  const plane = B.MeshBuilder.CreatePlane(name, { width, height, sideOrientation: B.Mesh.FRONTSIDE }, scene);
  const tex = new B.DynamicTexture(`${name}-tex`, { width: res, height: Math.round((res * height) / width) }, scene, true);
  tex.hasAlpha = true;
  const mat = new B.StandardMaterial(`${name}-mat`, scene);
  mat.diffuseTexture = tex;
  mat.emissiveColor = B.Color3.White();
  mat.disableLighting = true;
  mat.useAlphaFromDiffuseTexture = true;
  plane.material = mat;
  plane.isPickable = false;
  if (billboard) plane.billboardMode = B.Mesh.BILLBOARDMODE_ALL;

  return {
    mesh: plane,
    draw(fn) {
      const ctx = tex.getContext();
      const { width: w, height: h } = tex.getSize();
      ctx.clearRect(0, 0, w, h);
      fn(ctx, w, h);
      tex.update();
    },
    dispose() {
      plane.dispose(false, true);
    },
  };
}

export function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(x, y, w, h, r);
  else ctx.rect(x, y, w, h);
}

/** A single line of text on a dark rounded label. */
export function drawLabel(ctx, w, h, text, { color = '#fff', bg = 'rgba(10,14,28,0.75)', font = 'bold' } = {}) {
  roundRect(ctx, 0, 0, w, h, h * 0.3);
  ctx.fillStyle = bg;
  ctx.fill();
  let size = h * 0.6;
  ctx.font = `${font} ${size}px system-ui, sans-serif`;
  while (ctx.measureText(text).width > w * 0.9 && size > 10) {
    size -= 2;
    ctx.font = `${font} ${size}px system-ui, sans-serif`;
  }
  ctx.fillStyle = color;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, w / 2, h / 2 + size * 0.05);
}

function groundMaterial(scene) {
  const tex = new B.DynamicTexture('ground-tex', 256, scene, true);
  const ctx = tex.getContext();
  ctx.fillStyle = '#2b3550';
  ctx.fillRect(0, 0, 256, 256);
  ctx.strokeStyle = '#3c4a6e';
  ctx.lineWidth = 4;
  ctx.strokeRect(0, 0, 256, 256);
  tex.update();
  tex.uScale = 40;
  tex.vScale = 40;
  const mat = new B.StandardMaterial('ground-mat', scene);
  mat.diffuseTexture = tex;
  mat.specularColor = B.Color3.Black();
  return mat;
}

const colorMat = (scene, name, hex, emissive = 0) => {
  const mat = new B.StandardMaterial(name, scene);
  mat.diffuseColor = B.Color3.FromHexString(hex);
  mat.emissiveColor = B.Color3.FromHexString(hex).scale(emissive);
  mat.specularColor = new B.Color3(0.1, 0.1, 0.1);
  return mat;
};

const SKY = new B.Color3(0.42, 0.6, 0.86);
const ROOM_TINT = 0.35;

/**
 * Builds the shared plaza layout. Every room uses it, re-themed by `setRoom`:
 * - each interest booth (the coloured square pillar) is a portal to that interest's room,
 * - the booth of the room you're in is dimmed and marked "you are here",
 * - outside the plaza a gold "Main Plaza" portal leads home.
 * Portals are colliders tagged with `portal: roomId` (see collision.js).
 */
export function createWorld(scene, rooms, interests) {
  scene.clearColor = SKY.toColor4(1);
  scene.ambientColor = new B.Color3(0.3, 0.3, 0.35);
  scene.fogMode = B.Scene.FOGMODE_EXP2;
  scene.fogDensity = 0.012;
  scene.fogColor = SKY.clone();

  const hemi = new B.HemisphericLight('hemi', new B.Vector3(0, 1, 0), scene);
  hemi.intensity = 0.8;
  hemi.groundColor = new B.Color3(0.25, 0.25, 0.35);
  const sun = new B.DirectionalLight('sun', new B.Vector3(-0.4, -1, -0.3), scene);
  sun.intensity = 0.6;

  const ground = B.MeshBuilder.CreateGround('ground', { width: 80, height: 80 }, scene);
  ground.material = groundMaterial(scene);
  // Walkable-space obstacles for the desktop player (see collision.js).
  const colliders = [];

  // Central fountain / meeting point.
  const basin = B.MeshBuilder.CreateCylinder('basin', { diameter: 5, height: 0.5, tessellation: 48 }, scene);
  basin.position.y = 0.25;
  basin.material = colorMat(scene, 'basin-mat', '#c9d2e8');
  colliders.push(circle(0, 0, 2.5));
  const water = B.MeshBuilder.CreateCylinder('water', { diameter: 4.4, height: 0.05, tessellation: 48 }, scene);
  water.position.y = 0.5;
  water.material = colorMat(scene, 'water-mat', '#46b3ff', 0.4);
  const orb = B.MeshBuilder.CreateSphere('orb', { diameter: 0.9, segments: 24 }, scene);
  orb.position.y = 2.2;
  orb.material = colorMat(scene, 'orb-mat', '#ffd166', 0.8);
  const ring = B.MeshBuilder.CreateTorus('orb-ring', { diameter: 1.6, thickness: 0.06, tessellation: 48 }, scene);
  ring.position.y = 2.2;
  ring.material = orb.material;

  // Sign floating above the fountain naming the current room.
  const title = canvasPlane(scene, { name: 'room-title', width: 5, height: 0.9, res: 1024, billboard: true });
  title.mesh.position.set(0, 3.6, 0);

  // ---- interest booths: walk into the square pillar to teleport to that room ----
  // Booths are always built from the interest list, so they never vanish. A booth only
  // becomes a portal if the server actually has that interest's room.
  const booths = [];
  const radius = 14;
  interests.forEach((interest, i) => {
    const serverRoom = rooms.find((r) => r.id === interest);
    const room = serverRoom ?? { id: interest, name: interest };
    const angle = (i / interests.length) * Math.PI * 2;
    const x = Math.sin(angle) * radius;
    const z = Math.cos(angle) * radius;
    const hue = Math.round((i / interests.length) * 360);
    const hex = B.Color3.FromHSV(hue, 0.55, 0.9).toHexString();

    const pillar = B.MeshBuilder.CreateBox(`booth-${room.id}`, { width: 1.4, height: 2.4, depth: 1.4 }, scene);
    pillar.position.set(x, 1.2, z);
    const mat = colorMat(scene, `booth-mat-${room.id}`, hex, 0.25);
    pillar.material = mat;
    const collider = box(x, z, 1.4, 1.4);
    colliders.push(collider);

    const pad = B.MeshBuilder.CreateDisc(`pad-${room.id}`, { radius: 3, tessellation: 48 }, scene);
    pad.rotation.x = Math.PI / 2;
    pad.position.set(x, 0.01, z);
    const padMat = colorMat(scene, `pad-mat-${room.id}`, hex, 0.3);
    padMat.alpha = 0.35;
    pad.material = padMat;

    const label = canvasPlane(scene, { name: `label-${room.id}`, width: 3, height: 0.6, billboard: true });
    label.mesh.position.set(x, 3, z);
    const hint = canvasPlane(scene, { name: `hint-${room.id}`, width: 2.2, height: 0.3, billboard: true });
    hint.mesh.position.set(x, 2.6, z);

    booths.push({ room, available: !!serverRoom, mat, hex, hue, collider, label, hint });
  });

  // ---- "Main Plaza" portal, shown in every room except the plaza ----
  const plazaRoom = rooms.find((r) => r.id === 'plaza') ?? { id: 'plaza', name: 'Main Plaza' };
  const homePillar = B.MeshBuilder.CreateBox('portal-home', { width: 1.4, height: 2.4, depth: 1.4 }, scene);
  homePillar.position.set(-6, 1.2, -17);
  const home = { hex: '#ffd166', mat: colorMat(scene, 'portal-home-mat', '#ffd166', 0.35), collider: box(-6, -17, 1.4, 1.4) };
  homePillar.material = home.mat;
  const homeLabel = canvasPlane(scene, { name: 'label-home', width: 3.4, height: 0.6, billboard: true });
  homeLabel.mesh.position.set(-6, 3, -17);
  homeLabel.draw((ctx, w, h) => drawLabel(ctx, w, h, `🏠 ${plazaRoom.name}`, { color: '#ffd166' }));
  const homeHint = canvasPlane(scene, { name: 'hint-home', width: 2.2, height: 0.3, billboard: true });
  homeHint.mesh.position.set(-6, 2.6, -17);
  homeHint.draw((ctx, w, h) => drawLabel(ctx, w, h, 'walk in to teleport', { color: '#eef2ff', font: '' }));

  // Animate the orb and pulse every active portal so it reads as "walk into me".
  scene.onBeforeRenderObservable.add(() => {
    const t = performance.now() / 1000;
    orb.position.y = 2.2 + Math.sin(t * 1.5) * 0.15;
    ring.position.y = orb.position.y;
    ring.rotation.x = t * 0.7;
    ring.rotation.z = t * 0.4;
    const glow = 0.25 + (Math.sin(t * 3) + 1) * 0.15;
    for (const b of [...booths, home]) {
      if (b.collider.portal) b.mat.emissiveColor = B.Color3.FromHexString(b.hex).scale(glow);
    }
  });

  // Benches around the fountain.
  const benchMat = colorMat(scene, 'bench-mat', '#8b5e3c');
  for (let i = 0; i < 6; i++) {
    const angle = (i / 6) * Math.PI * 2 + Math.PI / 6;
    const bench = B.MeshBuilder.CreateBox(`bench-${i}`, { width: 2, height: 0.45, depth: 0.5 }, scene);
    bench.position.set(Math.sin(angle) * 6, 0.225, Math.cos(angle) * 6);
    bench.rotation.y = angle;
    bench.material = benchMat;
    colliders.push(box(bench.position.x, bench.position.z, 2, 0.5, angle));
  }

  // Room board on the far side of the plaza, facing spawn (+Z): ranks only who is in this room.
  const board = canvasPlane(scene, { name: 'leaderboard', width: 6, height: 4, res: 1024 });
  board.mesh.position.set(0, 3.4, -20);
  board.mesh.rotation.y = Math.PI;
  const frame = B.MeshBuilder.CreateBox('board-frame', { width: 6.3, height: 4.3, depth: 0.2 }, scene);
  frame.position.set(0, 3.4, -20.12);
  frame.material = colorMat(scene, 'frame-mat', '#1b2238');
  const post = B.MeshBuilder.CreateBox('board-post', { width: 0.3, height: 1.3, depth: 0.3 }, scene);
  post.position.set(0, 0.65, -20.12);
  post.material = frame.material;
  colliders.push(box(0, -20.12, 0.3, 0.3));

  let currentRoom = plazaRoom;

  // ---- per-room 3D models, loaded the first time someone visits their room ----
  const ROOM_PROPS = {
    // West side, outside the ring of teleport booths (radius 14) in the gap between two of them:
    // the keyboard and bench face the fountain and the raised lid opens toward spawn.
    music: () => loadGrandPiano(scene, { position: new B.Vector3(-21, 0, 0), rotationY: Math.PI / 2 }),
  };
  const props = new Map(); // roomId -> Promise<prop handle | null>

  function toggleProp(prop, on) {
    prop.setEnabled(on);
    const i = colliders.indexOf(prop.collider);
    if (on && i < 0) colliders.push(prop.collider);
    if (!on && i >= 0) colliders.splice(i, 1);
  }

  function showPropsFor(roomId) {
    if (ROOM_PROPS[roomId] && !props.has(roomId)) {
      props.set(
        roomId,
        ROOM_PROPS[roomId]().catch((err) => {
          console.warn(`Could not load the ${roomId} room models`, err);
          return null;
        }),
      );
    }
    // Loads finish asynchronously, so decide visibility against the room we're in by then.
    for (const [id, pending] of props) pending.then((prop) => prop && toggleProp(prop, id === currentRoom.id));
  }

  /** Re-theme the world for `room` and enable the right portals. */
  function setRoom(room) {
    currentRoom = room;
    const here = booths.find((b) => b.room.id === room.id);

    for (const b of booths) {
      const isHere = b === here;
      b.collider.portal = isHere || !b.available ? null : b.room.id;
      b.mat.emissiveColor = B.Color3.FromHexString(b.hex).scale(isHere ? 0.05 : 0.25);
      b.mat.alpha = isHere ? 0.45 : 1;
      const icon = INTEREST_ICONS[b.room.id] || '⭐';
      b.label.draw((ctx, w, h) => drawLabel(ctx, w, h, `${icon} ${b.room.name}`, { color: b.hex }));
      const hintText = isHere ? '📍 you are here' : b.available ? 'walk in to teleport' : '⚠ restart server to open';
      b.hint.draw((ctx, w, h) => drawLabel(ctx, w, h, hintText, { color: '#eef2ff', font: '' }));
    }

    // The home portal only exists (visually and as a collider) outside the plaza.
    const inPlaza = room.id === 'plaza';
    home.collider.portal = inPlaza ? null : 'plaza';
    for (const node of [homePillar, homeLabel.mesh, homeHint.mesh]) node.setEnabled(!inPlaza);
    const homeIndex = colliders.indexOf(home.collider);
    if (inPlaza && homeIndex >= 0) colliders.splice(homeIndex, 1);
    if (!inPlaza && homeIndex < 0) colliders.push(home.collider);

    // Tint the sky and the fountain orb with the room's colour.
    const sky = here ? B.Color3.Lerp(SKY, B.Color3.FromHSV(here.hue, 0.6, 0.85), ROOM_TINT) : SKY.clone();
    scene.clearColor = sky.toColor4(1);
    scene.fogColor = sky;
    const accent = here ? here.hex : '#ffd166';
    orb.material.diffuseColor = B.Color3.FromHexString(accent);
    orb.material.emissiveColor = B.Color3.FromHexString(accent).scale(0.8);
    const icon = here ? INTEREST_ICONS[room.id] || '⭐' : '📍';
    title.draw((ctx, w, h) => drawLabel(ctx, w, h, `${icon} ${room.name}`, { color: accent }));
    showPropsFor(room.id);
  }

  /** `list` = the players currently in this room. */
  function updateBoard(list, selfId) {
    board.draw((ctx, w, h) => {
      roundRect(ctx, 0, 0, w, h, 24);
      ctx.fillStyle = '#10162a';
      ctx.fill();
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillStyle = '#ffd166';
      ctx.font = 'bold 60px system-ui, sans-serif';
      ctx.fillText('🏆 Top Connectors', w / 2, 24);
      ctx.fillStyle = '#9aa6c4';
      ctx.font = '36px system-ui, sans-serif';
      ctx.fillText(`in ${currentRoom.name} right now`, w / 2, 92);
      ctx.textAlign = 'left';
      ctx.font = '42px system-ui, sans-serif';
      list.slice(0, 10).forEach((p, i) => {
        const y = 150 + i * 50;
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(80, y + 21, 14, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = p.id === selfId ? '#3ddc97' : '#eef2ff';
        ctx.fillText(`${i + 1}. ${p.name}${p.id === selfId ? ' (you)' : ''}`, 110, y);
        ctx.textAlign = 'right';
        ctx.fillText(`${p.points}`, w - 60, y);
        ctx.textAlign = 'left';
      });
      if (list.length > 10) {
        ctx.fillStyle = '#9aa6c4';
        ctx.fillText(`+${list.length - 10} more in this room`, 110, 150 + 10 * 50);
      }
    });
  }

  setRoom(plazaRoom);
  updateBoard([], null);

  return { ground, colliders, setRoom, updateBoard };
}
