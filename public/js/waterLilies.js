/* global BABYLON */
// Monet's "Water Lilies" as a place: you stand on a little wooden dock reaching out over the
// pond. All around, the water is painted in short horizontal dabs of lavender, sky blue, cream
// and pink, streaked with the green reflections of weeping willows. Clusters of lily pads and
// pink/white blossoms float on it, willows sway on the banks, the green Japanese footbridge arches
// across the far end, and a soft pastel sky hangs over everything. Procedural, no downloads.
import { wall, circle } from './collision.js';
import { NOISE, shaderMat, buildReturnWindow } from './starryNight.js';
import { woodTexture } from './textures.js';

const B = BABYLON;

const POND = { x: 0, z: -24, rx: 58, rz: 46 }; // the pond (an ellipse)
const WATER_Y = -0.35;
const DECK = { x: 0, z: 10, r: 6.5 }; // the dock you stand on (players spawn at z ~8.5)
const HAZE = 'vec3(0.86, 0.85, 0.93)';

/** 0 at the pond's centre, 1 on its shoreline, >1 on the banks. */
function pondDistance(x, z) {
  return Math.hypot((x - POND.x) / POND.rx, (z - POND.z) / POND.rz);
}

// ---- pastel sky of soft cloud dabs -------------------------------------------------
B.Effect.ShadersStore.monetSkyVertexShader = `
precision highp float;
attribute vec3 position;
uniform mat4 worldViewProjection;
varying vec3 vDir;
void main() { vDir = position; gl_Position = worldViewProjection * vec4(position, 1.0); }`;

B.Effect.ShadersStore.monetSkyFragmentShader = `
precision highp float;
varying vec3 vDir;
uniform float time;
${NOISE}
void main() {
  vec3 d = normalize(vDir);
  vec2 p = d.xz / (1.0 + max(d.y, -0.6)) * 4.0;
  float cloud = fbm(p * 0.7 + vec2(time * 0.006, 0.0));
  vec2 warp = vec2(fbm(p * 0.9 + 3.0), fbm(p * 0.9 - 5.0)) - 0.5;
  p += warp * 0.35;
  float band = length(p) * 14.0 + cloud * 4.0;
  float row = floor(band);
  float f = fract(band);
  float segPos = atan(p.y, p.x) * 11.0 + hash(vec2(row, 2.0)) * 6.2831;
  float segF = fract(segPos);
  float h = mix(hash(vec2(row, floor(segPos))), hash(vec2(row, floor(segPos) + 1.0)), smoothstep(0.75, 1.0, segF));
  vec3 blue = vec3(0.66, 0.78, 0.92);
  vec3 lav = vec3(0.78, 0.75, 0.91);
  vec3 cream = vec3(0.98, 0.94, 0.85);
  vec3 peach = vec3(0.98, 0.85, 0.77);
  vec3 pink = vec3(0.95, 0.80, 0.86);
  // Cloudy patches get warm creams and pinks; clear sky gets blues and lavender.
  vec3 clear = h < 0.5 ? blue : lav;
  vec3 warm = h < 0.4 ? cream : (h < 0.7 ? peach : pink);
  float cloudy = smoothstep(0.46, 0.64, cloud);
  vec3 base = mix(mix(blue, lav, 0.5), mix(cream, peach, 0.4), cloudy);
  vec3 dab = mix(base, mix(clear, warm, cloudy), 0.55);
  float body = smoothstep(0.0, 0.3, f) * smoothstep(1.0, 0.7, f) * (0.7 + 0.3 * smoothstep(0.0, 0.2, segF));
  vec3 col = mix(base * 0.97, dab, body);
  col = mix(col, ${HAZE}, smoothstep(0.35, 0.0, d.y) * 0.6); // hazy horizon
  gl_FragColor = vec4(col, 1.0);
}`;

// ---- the pond --------------------------------------------------------------------
B.Effect.ShadersStore.monetWaterVertexShader = `
precision highp float;
attribute vec3 position;
uniform mat4 world;
uniform mat4 worldViewProjection;
varying vec3 vPos;
void main() {
  vPos = (world * vec4(position, 1.0)).xyz;
  gl_Position = worldViewProjection * vec4(position, 1.0);
}`;

B.Effect.ShadersStore.monetWaterFragmentShader = `
precision highp float;
varying vec3 vPos;
uniform float time;
uniform vec3 eye;
uniform vec4 pond; // centre xz, radii
${NOISE}
void main() {
  vec2 p = vPos.xz;
  float t = time;
  // Flowing warp so the brush marks never line up into a grid, plus gentle ripples.
  vec2 warp = vec2(fbm(p * 0.12 + vec2(t * 0.02, 0.0)), fbm(p * 0.12 + vec2(9.0, -t * 0.02))) - 0.5;
  vec2 rp = p + warp * 2.4 + vec2(sin(p.y * 0.45 + t * 0.6), cos(p.x * 0.38 + t * 0.5)) * 0.12;
  // Long, thin horizontal dabs, each row offset by a random amount.
  vec2 cell = vec2(rp.x / 1.7, rp.y / 0.3);
  cell.x += hash(vec2(floor(cell.y), 7.0)) * 1.7;
  vec2 id = floor(cell);
  vec2 f = fract(cell);
  float h = hash(id);
  float h2 = hash(id + 31.7);

  // Underlying colour field: the sky's reflection drifting between lavender and blue.
  float skyLight = fbm(p * 0.035 + vec2(t * 0.01, 0.0));
  vec3 lav = vec3(0.72, 0.70, 0.89);
  vec3 blue = vec3(0.56, 0.67, 0.89);
  vec3 deep = vec3(0.34, 0.42, 0.70);
  vec3 cream = vec3(0.95, 0.92, 0.85);
  vec3 pink = vec3(0.92, 0.78, 0.86);
  vec3 green = vec3(0.34, 0.52, 0.42);
  vec3 teal = vec3(0.26, 0.45, 0.50);
  vec3 olive = vec3(0.48, 0.58, 0.40);
  vec3 base = mix(blue, lav, smoothstep(0.35, 0.65, skyLight));

  // Willow reflections: long streaks running toward you; banks darken the water near the shore.
  float willow = smoothstep(0.5, 0.68, fbm(vec2(p.x * 0.07, p.y * 0.012 + 3.0)));
  float shore = smoothstep(0.75, 1.0, length((p - pond.xy) / pond.zw));
  float greenness = clamp(willow + shore * 0.8, 0.0, 1.0);
  base = mix(base, mix(teal, green, skyLight), greenness * 0.8);

  vec3 skyDab = h < 0.3 ? lav : (h < 0.6 ? blue : (h < 0.75 ? deep : (h < 0.9 ? cream : pink)));
  vec3 greenDab = h2 < 0.4 ? green : (h2 < 0.7 ? teal : (h2 < 0.88 ? olive : deep));
  vec3 dab = mix(skyDab, greenDab, greenness);
  dab = mix(base, dab, 0.6); // soft: dabs vary the field rather than tile it

  float body = smoothstep(0.0, 0.3, f.y) * smoothstep(1.0, 0.7, f.y) * smoothstep(0.0, 0.25, f.x) * smoothstep(1.0, 0.75, f.x);
  vec3 col = mix(base * 0.96, dab, body);
  // The odd bright catch-light dab.
  col = mix(col, cream * 1.05, step(0.985, h) * body * (1.0 - greenness));
  float dist = length(vPos - eye);
  col = mix(col, ${HAZE}, (1.0 - exp(-dist * 0.012)) * 0.65);
  gl_FragColor = vec4(col, 1.0);
}`;

// ---- the banks -------------------------------------------------------------------
B.Effect.ShadersStore.monetBankVertexShader = B.Effect.ShadersStore.monetWaterVertexShader;
B.Effect.ShadersStore.monetBankFragmentShader = `
precision highp float;
varying vec3 vPos;
uniform vec3 eye;
${NOISE}
void main() {
  vec2 p = vPos.xz;
  // Warped, slanted dabs (like grass and foliage strokes) rather than a regular grid.
  vec2 warp = vec2(fbm(p * 0.1), fbm(p * 0.1 + 7.0)) - 0.5;
  vec2 q = p + warp * 3.0;
  vec2 cell = vec2(q.x / 1.3 + q.y * 0.35, (q.y + vPos.y * 1.5) / 0.45);
  cell.x += hash(vec2(floor(cell.y), 3.0)) * 1.3;
  vec2 id = floor(cell);
  vec2 f = fract(cell);
  float h = hash(id);
  float light = fbm(p * 0.05);
  vec3 c0 = vec3(0.30, 0.45, 0.25);
  vec3 c1 = vec3(0.42, 0.58, 0.30);
  vec3 c2 = vec3(0.22, 0.38, 0.33);
  vec3 c3 = vec3(0.62, 0.68, 0.38);
  vec3 c4 = vec3(0.40, 0.38, 0.55);
  vec3 dab = h < 0.3 ? c0 : (h < 0.55 ? c1 : (h < 0.75 ? c2 : (h < 0.9 ? c3 : c4)));
  vec3 base = mix(c0, c1, light);
  dab = mix(base, dab * (0.85 + 0.3 * light), 0.6);
  float body = smoothstep(0.0, 0.3, f.y) * smoothstep(1.0, 0.7, f.y) * smoothstep(0.0, 0.2, f.x) * smoothstep(1.0, 0.8, f.x);
  vec3 col = mix(base * 0.95, dab, body);
  float dist = length(vPos - eye);
  col = mix(col, ${HAZE}, (1.0 - exp(-dist * 0.012)) * 0.7);
  gl_FragColor = vec4(col, 1.0);
}`;

// ---- weeping willows: curtains of hanging strands that sway --------------------------
B.Effect.ShadersStore.willowVertexShader = `
precision highp float;
attribute vec3 position;
attribute vec2 uv;
uniform mat4 world;
uniform mat4 worldViewProjection;
uniform float time;
uniform float seed;
varying vec2 vUV;
varying vec3 vPos;
void main() {
  vec3 p = position;
  float hang = 1.0 - uv.y; // 0 at the top of the curtain, 1 at the trailing ends
  p.x += sin(time * 0.7 + uv.x * 18.0 + seed) * 0.35 * hang * hang;
  p.z += cos(time * 0.55 + uv.x * 14.0 + seed) * 0.3 * hang * hang;
  vUV = uv;
  vPos = (world * vec4(p, 1.0)).xyz;
  gl_Position = worldViewProjection * vec4(p, 1.0);
}`;

B.Effect.ShadersStore.willowFragmentShader = `
precision highp float;
varying vec2 vUV;
varying vec3 vPos;
uniform vec3 eye;
uniform float seed;
${NOISE}
void main() {
  // Narrow vertical strands with ragged ends; gaps between them are see-through.
  float strand = vUV.x * 140.0 + fbm(vec2(vUV.x * 30.0, vUV.y * 2.0 + seed)) * 3.0;
  float lane = fract(strand);
  float len = 0.25 + 0.75 * hash(vec2(floor(strand), seed));
  if (lane > 0.82 || vUV.y < 1.0 - len) discard;
  float h = hash(vec2(floor(strand), floor(vUV.y * 9.0) + seed));
  vec3 c0 = vec3(0.32, 0.50, 0.28);
  vec3 c1 = vec3(0.46, 0.62, 0.32);
  vec3 c2 = vec3(0.22, 0.38, 0.30);
  vec3 c3 = vec3(0.60, 0.70, 0.40);
  vec3 col = h < 0.35 ? c0 : (h < 0.65 ? c1 : (h < 0.85 ? c2 : c3));
  col *= 0.8 + 0.3 * vUV.y;
  float dist = length(vPos - eye);
  col = mix(col, ${HAZE}, (1.0 - exp(-dist * 0.012)) * 0.6);
  gl_FragColor = vec4(col, 1.0);
}`;

function tickTime(mat, start, extra = 0) {
  mat.onBindObservable.add(() => mat.setFloat('time', (performance.now() - start) / 1000 + extra));
}

function bindEye(scene, mat) {
  mat.onBindObservable.add(() => mat.setVector3('eye', scene.activeCamera.globalPosition));
}

function buildSky(scene, root, start) {
  const sky = B.MeshBuilder.CreateSphere('monet-sky', { diameter: 900, segments: 32, sideOrientation: B.Mesh.BACKSIDE }, scene);
  const mat = shaderMat(scene, 'monet-sky-mat', 'monetSky', ['time']);
  tickTime(mat, start);
  sky.material = mat;
  sky.infiniteDistance = true;
  sky.isPickable = false;
  sky.parent = root;
}

function buildWater(scene, root, start) {
  const water = B.MeshBuilder.CreateGround('monet-water', { width: 420, height: 420, subdivisions: 2 }, scene);
  water.position.y = WATER_Y;
  const mat = shaderMat(scene, 'monet-water-mat', 'monetWater', ['time', 'eye', 'pond']);
  mat.setVector4('pond', new B.Vector4(POND.x, POND.z, POND.rx, POND.rz));
  tickTime(mat, start);
  bindEye(scene, mat);
  water.material = mat;
  water.parent = root;
  return water;
}

function buildBanks(scene, root) {
  const banks = B.MeshBuilder.CreateGround('monet-banks', { width: 420, height: 420, subdivisions: 160, updatable: true }, scene);
  const pos = banks.getVerticesData(B.VertexBuffer.PositionKind);
  for (let i = 0; i < pos.length; i += 3) {
    const x = pos[i];
    const z = pos[i + 2];
    const d = pondDistance(x, z);
    const rise = Math.min(1, Math.max(0, (d - 0.98) / 0.25));
    pos[i + 1] = -1.2 + rise * (4.2 + Math.sin(x * 0.07) * 1.2 + Math.sin(z * 0.09 + 1) * 1.0);
  }
  banks.updateVerticesData(B.VertexBuffer.PositionKind, pos);
  banks.refreshBoundingInfo();
  const mat = shaderMat(scene, 'monet-bank-mat', 'monetBank', ['eye']);
  bindEye(scene, mat);
  banks.material = mat;
  banks.parent = root;
  return banks;
}

function buildWillows(scene, root, start) {
  const spots = [];
  // Ring the far shores, plus two close by that frame the view from the dock.
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * Math.PI * 2 + 0.2;
    const k = 1.12 + Math.sin(i * 2.7) * 0.06;
    const x = POND.x + Math.sin(a) * POND.rx * k;
    const z = POND.z + Math.cos(a) * POND.rz * k;
    if (Math.hypot(x - DECK.x, z - DECK.z) < 16) continue;
    spots.push([x, z, 1 + Math.sin(i * 1.9) * 0.2]);
  }
  spots.push([15, 17, 0.9], [-16, 15, 1.0]);

  const barkMat = new B.StandardMaterial('willow-bark', scene);
  barkMat.diffuseColor = new B.Color3(0.25, 0.22, 0.24);
  barkMat.emissiveColor = new B.Color3(0.1, 0.09, 0.11);
  const crownMat = new B.StandardMaterial('willow-crown', scene);
  crownMat.diffuseColor = new B.Color3(0.2, 0.34, 0.22);
  crownMat.emissiveColor = new B.Color3(0.12, 0.2, 0.13);
  crownMat.specularColor = B.Color3.Black();

  spots.forEach(([x, z, s], i) => {
    const tree = new B.TransformNode(`willow-${i}`, scene);
    tree.parent = root;
    tree.position.set(x, WATER_Y, z);
    tree.scaling.setAll(s);
    const trunk = B.MeshBuilder.CreateCylinder('willow-trunk', { diameterTop: 0.7, diameterBottom: 1.2, height: 9, tessellation: 10 }, scene);
    trunk.position.y = 4.5;
    trunk.material = barkMat;
    trunk.parent = tree;
    // Same width as the top of the curtain, so the strands spill straight out of the canopy.
    const crown = B.MeshBuilder.CreateSphere('willow-crown', { diameter: 10.8, segments: 14 }, scene);
    crown.scaling.y = 0.8;
    crown.position.y = 11.2;
    crown.material = crownMat;
    crown.parent = tree;
    // The weeping curtain: an open cone of strands from the crown down to just above the water.
    const curtain = B.MeshBuilder.CreateCylinder(
      'willow-curtain',
      { diameterTop: 10.6, diameterBottom: 13.5, height: 10, tessellation: 48, cap: B.Mesh.NO_CAP },
      scene,
    );
    curtain.position.y = 6.2;
    const mat = shaderMat(scene, `willow-mat-${i}`, 'willow', ['time', 'seed', 'eye'], ['position', 'uv']);
    mat.setFloat('seed', i * 3.7);
    tickTime(mat, start, i);
    bindEye(scene, mat);
    curtain.material = mat;
    curtain.parent = tree;
    curtain.getBoundingInfo().boundingBox.reConstruct(new B.Vector3(-7, -5, -7), new B.Vector3(7, 5, 7));
    for (const m of [trunk, crown, curtain]) m.isPickable = false;
  });
}

/** Lily pads in floating clusters, some with pink or white blossoms (GPU thin instances). */
function buildLilies(scene, root) {
  const rand = (() => {
    let s = 4321;
    return () => ((s = (s * 16807) % 2147483647) / 2147483647);
  })();
  const padMats = [
    [0.28, 0.48, 0.3],
    [0.36, 0.56, 0.32],
    [0.24, 0.42, 0.38],
  ].map((c, i) => {
    const m = new B.StandardMaterial(`lily-pad-${i}`, scene);
    m.diffuseColor = new B.Color3(...c);
    m.emissiveColor = new B.Color3(c[0] * 0.45, c[1] * 0.45, c[2] * 0.45);
    m.specularColor = new B.Color3(0.15, 0.15, 0.15);
    return m;
  });
  const pads = padMats.map((mat, i) => {
    const pad = B.MeshBuilder.CreateDisc(`lily-pad-${i}`, { radius: 0.55, tessellation: 22, arc: 0.9, sideOrientation: B.Mesh.DOUBLESIDE }, scene);
    pad.material = mat;
    pad.isPickable = false;
    pad.parent = root;
    return { mesh: pad, matrices: [] };
  });
  const flowerTypes = [
    ['pink', [0.96, 0.62, 0.74]],
    ['white', [0.98, 0.95, 0.92]],
  ].map(([name, c]) => {
    const flower = B.MeshBuilder.CreateCylinder(`lily-${name}`, { diameterTop: 0.42, diameterBottom: 0.1, height: 0.2, tessellation: 8 }, scene);
    const m = new B.StandardMaterial(`lily-${name}-mat`, scene);
    m.diffuseColor = new B.Color3(...c);
    m.emissiveColor = new B.Color3(c[0] * 0.55, c[1] * 0.5, c[2] * 0.5);
    flower.material = m;
    flower.isPickable = false;
    flower.parent = root;
    return { mesh: flower, matrices: [] };
  });

  for (let c = 0; c < 46; c++) {
    // Cluster centres anywhere on the pond, except right under the dock.
    let cx;
    let cz;
    do {
      cx = POND.x + (rand() * 2 - 1) * POND.rx * 0.9;
      cz = POND.z + (rand() * 2 - 1) * POND.rz * 0.9;
    } while (pondDistance(cx, cz) > 0.88 || Math.hypot(cx - DECK.x, cz - DECK.z) < DECK.r + 2.5);
    const count = 6 + Math.floor(rand() * 14);
    for (let k = 0; k < count; k++) {
      const x = cx + (rand() - 0.5) * 7;
      const z = cz + (rand() - 0.5) * 4;
      if (Math.hypot(x - DECK.x, z - DECK.z) < DECK.r + 1) continue;
      const s = 0.6 + rand() * 0.9;
      const m = B.Matrix.Compose(
        new B.Vector3(s, s, s),
        B.Quaternion.FromEulerAngles(Math.PI / 2, rand() * Math.PI * 2, 0),
        new B.Vector3(x, WATER_Y + 0.02, z),
      );
      pads[Math.floor(rand() * pads.length)].matrices.push(m);
      if (rand() < 0.18) {
        const fs = s * (0.8 + rand() * 0.4);
        const fm = B.Matrix.Compose(new B.Vector3(fs, fs, fs), B.Quaternion.FromEulerAngles(0, rand() * 3, 0), new B.Vector3(x, WATER_Y + 0.12, z));
        flowerTypes[rand() < 0.6 ? 0 : 1].matrices.push(fm);
      }
    }
  }
  for (const group of [...pads, ...flowerTypes]) {
    const buf = new Float32Array(group.matrices.length * 16);
    group.matrices.forEach((m, i) => m.copyToArray(buf, i * 16));
    group.mesh.thinInstanceSetBuffer('matrix', buf, 16, true);
  }
}

/** Monet's green Japanese footbridge, arching across the far end of the pond. */
function buildBridge(scene, root) {
  const green = new B.StandardMaterial('bridge-green', scene);
  green.diffuseColor = new B.Color3(0.34, 0.56, 0.38);
  green.emissiveColor = new B.Color3(0.13, 0.22, 0.15);
  green.specularColor = B.Color3.Black();
  const z = -40;
  const span = 34;
  const rise = 4.2;
  const arc = (x) => WATER_Y + 0.6 + rise * Math.cos((x / span) * Math.PI);
  const parts = [];
  // Deck planks along the arch.
  for (let i = 0; i <= 34; i++) {
    const x = -span / 2 + (i / 34) * span;
    const plank = B.MeshBuilder.CreateBox('bridge-plank', { width: 1.1, height: 0.18, depth: 3.2 }, scene);
    plank.position.set(x, arc(x), z);
    plank.rotation.z = Math.atan(-rise * (Math.PI / span) * Math.sin((x / span) * Math.PI));
    parts.push(plank);
  }
  // Railings: posts, a curved top rail and a lattice rail on each side.
  for (const side of [-1.5, 1.5]) {
    for (let i = 0; i <= 12; i++) {
      const x = -span / 2 + (i / 12) * span;
      const post = B.MeshBuilder.CreateBox('bridge-post', { width: 0.16, height: 1.3, depth: 0.16 }, scene);
      post.position.set(x, arc(x) + 0.65, z + side);
      parts.push(post);
    }
    for (const h of [1.25, 0.65]) {
      const path = Array.from({ length: 25 }, (_, i) => {
        const x = -span / 2 + (i / 24) * span;
        return new B.Vector3(x, arc(x) + h, z + side);
      });
      parts.push(B.MeshBuilder.CreateTube('bridge-rail', { path, radius: 0.07, tessellation: 6 }, scene));
    }
  }
  // Supports down into the water.
  for (const x of [-span / 2 + 1, -span / 4, span / 4, span / 2 - 1]) {
    const leg = B.MeshBuilder.CreateBox('bridge-leg', { width: 0.3, height: arc(x) - WATER_Y + 0.5, depth: 0.3 }, scene);
    leg.position.set(x, (arc(x) + WATER_Y) / 2 - 0.25, z);
    parts.push(leg);
  }
  const bridge = B.Mesh.MergeMeshes(parts, true, true);
  bridge.material = green;
  bridge.parent = root;
  bridge.isPickable = false;
}

/** The wooden dock you stand on, with a low rail. */
function buildDeck(scene, root) {
  const oak = woodTexture(scene);
  oak.uScale = oak.vScale = 3;
  const wood = new B.StandardMaterial('dock-wood', scene);
  wood.diffuseTexture = oak;
  wood.emissiveColor = new B.Color3(0.25, 0.2, 0.16);
  wood.specularColor = new B.Color3(0.08, 0.07, 0.06);
  const deck = B.MeshBuilder.CreateCylinder('dock', { diameter: DECK.r * 2, height: 0.35, tessellation: 48 }, scene);
  deck.position.set(DECK.x, -0.175, DECK.z);
  deck.material = wood;
  deck.parent = root;

  const railMat = new B.StandardMaterial('dock-rail', scene);
  railMat.diffuseColor = new B.Color3(0.34, 0.56, 0.38);
  railMat.emissiveColor = new B.Color3(0.12, 0.2, 0.14);
  const parts = [];
  const rr = DECK.r - 0.15;
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2;
    const post = B.MeshBuilder.CreateBox('dock-post', { width: 0.12, height: 0.95, depth: 0.12 }, scene);
    post.position.set(DECK.x + Math.sin(a) * rr, 0.47, DECK.z + Math.cos(a) * rr);
    parts.push(post);
  }
  const rail = B.MeshBuilder.CreateTorus('dock-rail', { diameter: rr * 2, thickness: 0.09, tessellation: 64 }, scene);
  rail.position.set(DECK.x, 0.95, DECK.z);
  parts.push(rail);
  const merged = B.Mesh.MergeMeshes(parts, true, true);
  merged.material = railMat;
  merged.parent = root;
  merged.isPickable = false;
  return deck;
}

/**
 * Build the Water Lilies room. Same handle shape as the other room props, plus
 * `setWindowView(texture)` for the window back to the room you came from.
 */
export function createWaterLilies(scene, { returnTo = '3d-art' } = {}) {
  const root = new B.TransformNode('water-lilies', scene);
  const start = performance.now();
  buildSky(scene, root, start);
  const water = buildWater(scene, root, start);
  const banks = buildBanks(scene, root);
  buildWillows(scene, root, start);
  buildLilies(scene, root);
  buildBridge(scene, root);
  const deck = buildDeck(scene, root);
  const windowZ = DECK.z + DECK.r - 0.9;
  const windowView = buildReturnWindow(scene, root, returnTo, windowZ, 'lilies-window');

  const haze = new B.Color3(0.86, 0.85, 0.93);
  let saved = null;
  const setEnabled = (on) => {
    root.setEnabled(on);
    if (on) {
      saved = { fog: scene.fogDensity };
      scene.fogDensity = 0.006; // soft lavender haze over the standard-material pieces too
      scene.fogColor = haze.clone();
      scene.clearColor = haze.toColor4(1);
    } else if (saved) {
      scene.fogDensity = saved.fog;
      saved = null;
    }
  };
  setEnabled(false);

  deck.isPickable = true; // VR teleport target
  return {
    colliders: [wall(DECK.x, DECK.z, DECK.r - 0.45), circle(0, windowZ, 1.2)],
    floors: [deck, banks],
    setEnabled,
    setWindowView: (tex) => windowView.setView(tex),
  };
}
