/* global BABYLON */
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

export function createWorld(scene, interests) {
  scene.clearColor = new B.Color4(0.42, 0.6, 0.86, 1);
  scene.ambientColor = new B.Color3(0.3, 0.3, 0.35);
  scene.fogMode = B.Scene.FOGMODE_EXP2;
  scene.fogDensity = 0.012;
  scene.fogColor = new B.Color3(0.42, 0.6, 0.86);

  const hemi = new B.HemisphericLight('hemi', new B.Vector3(0, 1, 0), scene);
  hemi.intensity = 0.8;
  hemi.groundColor = new B.Color3(0.25, 0.25, 0.35);
  const sun = new B.DirectionalLight('sun', new B.Vector3(-0.4, -1, -0.3), scene);
  sun.intensity = 0.6;

  const ground = B.MeshBuilder.CreateGround('ground', { width: 80, height: 80 }, scene);
  ground.material = groundMaterial(scene);
  ground.checkCollisions = true;

  // Central fountain / meeting point.
  const basin = B.MeshBuilder.CreateCylinder('basin', { diameter: 5, height: 0.5, tessellation: 48 }, scene);
  basin.position.y = 0.25;
  basin.material = colorMat(scene, 'basin-mat', '#c9d2e8');
  basin.checkCollisions = true;
  const water = B.MeshBuilder.CreateCylinder('water', { diameter: 4.4, height: 0.05, tessellation: 48 }, scene);
  water.position.y = 0.5;
  water.material = colorMat(scene, 'water-mat', '#46b3ff', 0.4);
  const orb = B.MeshBuilder.CreateSphere('orb', { diameter: 0.9, segments: 24 }, scene);
  orb.position.y = 2.2;
  orb.material = colorMat(scene, 'orb-mat', '#ffd166', 0.8);
  const ring = B.MeshBuilder.CreateTorus('orb-ring', { diameter: 1.6, thickness: 0.06, tessellation: 48 }, scene);
  ring.position.y = 2.2;
  ring.material = orb.material;
  scene.onBeforeRenderObservable.add(() => {
    const t = performance.now() / 1000;
    orb.position.y = 2.2 + Math.sin(t * 1.5) * 0.15;
    ring.position.y = orb.position.y;
    ring.rotation.x = t * 0.7;
    ring.rotation.z = t * 0.4;
  });

  // Interest booths in a ring: hang out at a booth to find like-minded people.
  const radius = 14;
  interests.forEach((interest, i) => {
    const angle = (i / interests.length) * Math.PI * 2;
    const x = Math.sin(angle) * radius;
    const z = Math.cos(angle) * radius;
    const hue = Math.round((i / interests.length) * 360);
    const hex = B.Color3.FromHSV(hue, 0.55, 0.9).toHexString();

    const pillar = B.MeshBuilder.CreateBox(`booth-${interest}`, { width: 1.4, height: 2.4, depth: 1.4 }, scene);
    pillar.position.set(x, 1.2, z);
    pillar.material = colorMat(scene, `booth-mat-${interest}`, hex, 0.25);
    pillar.checkCollisions = true;

    const pad = B.MeshBuilder.CreateDisc(`pad-${interest}`, { radius: 3, tessellation: 48 }, scene);
    pad.rotation.x = Math.PI / 2;
    pad.position.set(x, 0.01, z);
    const padMat = colorMat(scene, `pad-mat-${interest}`, hex, 0.3);
    padMat.alpha = 0.35;
    pad.material = padMat;

    const label = canvasPlane(scene, { name: `label-${interest}`, width: 2.6, height: 0.6, billboard: true });
    label.mesh.position.set(x, 3, z);
    label.draw((ctx, w, h) => drawLabel(ctx, w, h, `${INTEREST_ICONS[interest] || '⭐'} ${interest}`, { color: hex }));
  });

  // Benches around the fountain.
  const benchMat = colorMat(scene, 'bench-mat', '#8b5e3c');
  for (let i = 0; i < 6; i++) {
    const angle = (i / 6) * Math.PI * 2 + Math.PI / 6;
    const bench = B.MeshBuilder.CreateBox(`bench-${i}`, { width: 2, height: 0.45, depth: 0.5 }, scene);
    bench.position.set(Math.sin(angle) * 6, 0.225, Math.cos(angle) * 6);
    bench.rotation.y = angle;
    bench.material = benchMat;
    bench.checkCollisions = true;
  }

  // Leaderboard billboard on the far side of the plaza, facing spawn (+Z).
  const board = canvasPlane(scene, { name: 'leaderboard', width: 6, height: 4, res: 1024 });
  board.mesh.position.set(0, 3.4, -20);
  board.mesh.rotation.y = Math.PI;
  const frame = B.MeshBuilder.CreateBox('board-frame', { width: 6.3, height: 4.3, depth: 0.2 }, scene);
  frame.position.set(0, 3.4, -20.12);
  frame.material = colorMat(scene, 'frame-mat', '#1b2238');
  const post = B.MeshBuilder.CreateBox('board-post', { width: 0.3, height: 1.3, depth: 0.3 }, scene);
  post.position.set(0, 0.65, -20.12);
  post.material = frame.material;

  function updateBoard(list, selfId) {
    board.draw((ctx, w, h) => {
      roundRect(ctx, 0, 0, w, h, 24);
      ctx.fillStyle = '#10162a';
      ctx.fill();
      ctx.fillStyle = '#ffd166';
      ctx.font = 'bold 64px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillText('🏆 Top Connectors', w / 2, 30);
      ctx.textAlign = 'left';
      ctx.font = '44px system-ui, sans-serif';
      list.slice(0, 10).forEach((p, i) => {
        const y = 130 + i * 52;
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(80, y + 22, 14, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = p.id === selfId ? '#3ddc97' : '#eef2ff';
        ctx.fillText(`${i + 1}. ${p.name}`, 110, y);
        ctx.textAlign = 'right';
        ctx.fillText(`${p.points}`, w - 60, y);
        ctx.textAlign = 'left';
      });
      if (!list.length) {
        ctx.fillStyle = '#9aa6c4';
        ctx.fillText('No connections yet — go say hi!', 80, 140);
      }
    });
  }
  updateBoard([], null);

  return { ground, updateBoard };
}
