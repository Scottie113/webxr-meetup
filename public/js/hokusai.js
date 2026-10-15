/* global BABYLON */
// Hokusai's "The Great Wave off Kanagawa" as a place: you ride in one of the long rowing boats,
// down in the trough of a Prussian-blue sea, with the rowers bent over their oars around you. The
// Great Wave towers on your left and curls overhead, its foam breaking into claw-like fingers that
// reach toward the boat, spray falling like snow, two more boats riding the swell, and tiny snowy
// Mount Fuji on the horizon under a cream and grey print sky. Everything here is procedural.
import { room, circle } from './collision.js';
import { NOISE, shaderMat, buildReturnWindow } from './starryNight.js';

const B = BABYLON;

const SEA_Y = -0.6;
// Your boat runs along Z with its bow toward -Z (where you face on arrival, at z ~8.5).
const BOAT = { width: 3.2, length: 19, z: 3.5 };
const WAVE_X = 4; // the wave's trough runs alongside the boat, just to its left (+X)
const WAVE_Z = -8; // its tallest point is ahead-left of you

// ---- sky: Hokusai's grey band at the top fading to warm cream at the horizon ---------------------
B.Effect.ShadersStore.waveSkyVertexShader = `
precision highp float;
attribute vec3 position;
uniform mat4 worldViewProjection;
varying vec3 vDir;
void main() { vDir = position; gl_Position = worldViewProjection * vec4(position, 1.0); }`;

B.Effect.ShadersStore.waveSkyFragmentShader = `
precision highp float;
varying vec3 vDir;
${NOISE}
void main() {
  vec3 d = normalize(vDir);
  float el = d.y;
  vec3 cream = vec3(0.94, 0.89, 0.77);
  vec3 grey = vec3(0.47, 0.45, 0.43);
  vec3 col = mix(cream, grey, smoothstep(0.25, 0.85, el));
  // Faint printed clouds: soft horizontal smudges low in the sky.
  float az = atan(d.x, -d.z);
  float cloud = smoothstep(0.55, 0.8, fbm(vec2(az * 3.0, el * 18.0))) * smoothstep(0.45, 0.1, el);
  col = mix(col, vec3(0.83, 0.78, 0.68), cloud * 0.5);
  // Paper grain.
  col *= 0.96 + 0.06 * hash(floor(d.xy * 900.0));
  gl_FragColor = vec4(col, 1.0);
}`;

// ---- the sea: rolling swell in Prussian blue, laced with white lines and foam -------------------
B.Effect.ShadersStore.waveSeaVertexShader = `
precision highp float;
attribute vec3 position;
uniform mat4 world;
uniform mat4 worldViewProjection;
uniform float time;
varying vec3 vPos;
varying float vH;
void main() {
  vec4 w = world * vec4(position, 1.0);
  float h = 0.6 * sin(w.x * 0.08 + time * 0.5) + 0.4 * sin(w.z * 0.12 - time * 0.7) + 0.25 * sin((w.x + w.z) * 0.2 + time);
  // Calm right around your boat, so the water never washes over the deck.
  float d = length(vec2(w.x, max(0.0, abs(w.z - ${BOAT.z.toFixed(1)}) - ${(BOAT.length / 2).toFixed(1)})));
  h *= mix(0.15, 1.0, smoothstep(2.0, 12.0, d));
  vH = h;
  vPos = w.xyz;
  gl_Position = worldViewProjection * vec4(position.x, position.y + h, position.z, 1.0);
}`;

B.Effect.ShadersStore.waveSeaFragmentShader = `
precision highp float;
varying vec3 vPos;
varying float vH;
uniform float time;
${NOISE}
void main() {
  vec3 deep = vec3(0.06, 0.16, 0.36);
  vec3 light = vec3(0.32, 0.5, 0.72);
  vec3 col = mix(deep, light, smoothstep(-0.8, 1.0, vH));
  // Hokusai's fine white lines tracing the swell.
  float phase = vPos.x * 0.08 + vPos.z * 0.05 + fbm(vPos.xz * 0.05) * 3.0;
  float ln = abs(fract(phase * 3.0 - time * 0.03) - 0.5);
  col = mix(col, vec3(0.78, 0.86, 0.92), smoothstep(0.05, 0.0, ln) * 0.55);
  // Foam on the highest crests.
  float foam = smoothstep(0.75, 1.1, vH + 0.3 * noise(vPos.xz * 0.6));
  col = mix(col, vec3(0.95, 0.93, 0.86), foam);
  gl_FragColor = vec4(col, 1.0);
}`;

// ---- the Great Wave: blue face with flowing lines, cream foam at the crest and lip --------------
B.Effect.ShadersStore.greatWaveVertexShader = `
precision highp float;
attribute vec3 position;
attribute vec2 uv;
uniform mat4 world;
uniform mat4 worldViewProjection;
varying vec2 vUV;
varying vec3 vPos;
void main() { vUV = uv; vPos = (world * vec4(position, 1.0)).xyz; gl_Position = worldViewProjection * vec4(position, 1.0); }`;

B.Effect.ShadersStore.greatWaveFragmentShader = `
precision highp float;
varying vec2 vUV;
varying vec3 vPos;
uniform float time;
uniform float foamStart;
uniform float shade;
${NOISE}
void main() {
  float u = vUV.x; // along the wave's profile: from the sea up over the crest to the lip
  float v = vUV.y; // along the wave's length
  vec3 deep = vec3(0.05, 0.14, 0.34);
  vec3 mid = vec3(0.2, 0.4, 0.66);
  vec3 col = mix(deep, mid, smoothstep(0.05, foamStart, u)) * shade;
  // Bands of fine white lines following the curve of the wave.
  float ln = abs(fract(u * 22.0 + 0.4 * noise(vec2(v * 30.0, u * 5.0)) - time * 0.02) - 0.5);
  col = mix(col, vec3(0.78, 0.87, 0.94), smoothstep(0.07, 0.0, ln) * 0.6 * smoothstep(0.15, 0.5, u));
  // Darker streaks running up the face, like the print's carved lines.
  col *= 0.86 + 0.14 * smoothstep(0.1, 0.4, abs(fract(v * 140.0 + u * 4.0) - 0.5));
  // Cream foam over the crest and lip, freckled with blue.
  float f = smoothstep(foamStart, foamStart + 0.06, u + 0.05 * noise(vec2(v * 80.0, 1.0)));
  vec3 foam = vec3(0.95, 0.93, 0.85);
  foam = mix(foam, vec3(0.55, 0.7, 0.86), step(0.82, hash(floor(vec2(u * 90.0, v * 500.0)))) * 0.7);
  col = mix(col, foam, f);
  gl_FragColor = vec4(col, 1.0);
}`;

// ---- Mount Fuji: blue slopes under a jagged snow cap ----------------------------------------------
B.Effect.ShadersStore.waveFujiVertexShader = B.Effect.ShadersStore.greatWaveVertexShader;

B.Effect.ShadersStore.waveFujiFragmentShader = `
precision highp float;
varying vec3 vPos;
varying vec2 vUV;
${NOISE}
void main() {
  float h = clamp((vPos.y + 1.0) / 22.0, 0.0, 1.0);
  float az = atan(vPos.x + 40.0, vPos.z + 340.0);
  float snowline = 0.62 + 0.07 * sin(az * 26.0) + 0.04 * sin(az * 61.0);
  vec3 col = mix(vec3(0.12, 0.22, 0.42), vec3(0.3, 0.42, 0.6), h);
  col = mix(col, vec3(0.95, 0.94, 0.9), smoothstep(snowline, snowline + 0.01, h));
  col = mix(col, vec3(0.1, 0.16, 0.3), smoothstep(0.012, 0.0, abs(h - snowline)) * 0.8);
  gl_FragColor = vec4(col, 1.0);
}`;

function buildSky(scene, root) {
  const sky = B.MeshBuilder.CreateSphere('wave-sky', { diameter: 900, segments: 32, sideOrientation: B.Mesh.BACKSIDE }, scene);
  sky.material = shaderMat(scene, 'wave-sky-mat', 'waveSky', []);
  sky.infiniteDistance = true;
  sky.isPickable = false;
  sky.parent = root;
}

function timed(scene, mat, start) {
  mat.onBindObservable.add(() => mat.setFloat('time', (performance.now() - start) / 1000));
  return mat;
}

function buildSea(scene, root, start) {
  const sea = B.MeshBuilder.CreateGround('wave-sea', { width: 700, height: 700, subdivisions: 220 }, scene);
  sea.position.y = SEA_Y;
  sea.material = timed(scene, shaderMat(scene, 'wave-sea-mat', 'waveSea', ['time']), start);
  sea.isPickable = false;
  sea.parent = root;
}

// The wave's cross-section (x across, y up) at full height, from the sea behind it up over the
// crest, then curling forward toward the boat (-X) and hooking back down into the lip.
const OUTER = [
  [45, -2], [30, 1.5], [21, 5], [16, 9.5], [13.5, 13.5], [11.5, 16.5], [9, 18.2], [6, 18.3],
  [3, 17.5], [0.5, 15.5], [-1.2, 12.5], [-0.8, 10], [0.8, 8.8], [2.4, 9.4], [3, 10.8],
];
// The hollow front face, rising from the trough beside the boat up under the lip.
const INNER = [
  [1.5, -2], [3.5, 0.6], [5.5, 2.5], [7.2, 5.2], [8.3, 8.3], [8.4, 11], [7.6, 13.2], [6, 14.6],
  [4, 14.3], [2.6, 12.8], [3, 10.8],
];

function smoothProfile(points) {
  return B.Curve3.CreateCatmullRomSpline(points.map(([x, y]) => new B.Vector3(x, y, 0)), 6, false).getPoints();
}

/** How tall the wave is at a given z: towering ahead-left, sinking into ordinary swell at the ends. */
const waveScale = (z) => 0.1 + 0.9 * Math.exp(-(((z - WAVE_Z) / 16) ** 2));

/** Place a profile point at height `s`: the wave's foot stays by the boat as it shrinks. */
const placed = (p, s, z) => new B.Vector3(WAVE_X + p.x * (0.45 + 0.55 * s), SEA_Y + (p.y - SEA_Y) * s, z);

function waveRibbon(scene, root, start, name, profile, foamStart, shade) {
  const paths = [];
  const uvs = [];
  const zs = [];
  for (let z = -75; z <= 40; z += 1.5) zs.push(z);
  zs.forEach((z, j) => {
    const s = waveScale(z);
    paths.push(profile.map((p) => placed(p, s, z)));
    profile.forEach((_, i) => uvs.push(new B.Vector2(i / (profile.length - 1), j / (zs.length - 1))));
  });
  const ribbon = B.MeshBuilder.CreateRibbon(name, { pathArray: paths, uvs }, scene);
  const mat = timed(scene, shaderMat(scene, `${name}-mat`, 'greatWave', ['time', 'foamStart', 'shade'], ['position', 'uv']), start);
  mat.onBindObservable.add(() => {
    mat.setFloat('foamStart', foamStart);
    mat.setFloat('shade', shade);
  });
  ribbon.material = mat;
  ribbon.isPickable = false;
  ribbon.parent = root;
}

/** The foam fingers: claws of spray reaching from the lip toward the boat, curling at the tips. */
function buildClaws(scene, root, outer) {
  // The lip's leading edge: the outer profile's furthest-forward point among its last few.
  const tail = outer.slice(-Math.floor(outer.length / 3));
  const lip = tail.reduce((a, b) => (b.x < a.x ? b : a));
  const parts = [];
  for (let z = -40; z <= 18; z += 0.4) {
    const s = waveScale(z);
    if (s < 0.35) continue;
    const jitter = Math.sin(z * 12.7) * 0.5 + 0.5;
    const p0 = placed(lip, s, z);
    const reach = s * (2 + jitter * 2.5);
    const path = Array.from({ length: 7 }, (_, k) => {
      const t = k / 6;
      // Out toward the boat and down, then hooking back like a claw.
      const hook = t > 0.45 ? (t - 0.45) * 1.8 : 0;
      return new B.Vector3(p0.x - reach * t + hook * reach * 1.0, p0.y - reach * (0.25 * t + 0.45 * t * t) + hook * reach * 0.55, z + Math.sin(z * 3.1 + t * 2) * 0.12);
    });
    const r = 0.08 + 0.1 * s;
    parts.push(B.MeshBuilder.CreateTube('wave-claw', { path, radiusFunction: (i) => r * (1 - i / 7) ** 1.5 + 0.01, tessellation: 5 }, scene));
    const tip = B.MeshBuilder.CreateSphere('wave-claw-tip', { diameter: r * 0.9, segments: 4 }, scene);
    tip.position.copyFrom(path[6]);
    parts.push(tip);
  }
  const claws = B.Mesh.MergeMeshes(parts, true, true);
  const mat = new B.StandardMaterial('wave-claw-mat', scene);
  mat.diffuseColor = new B.Color3(0.95, 0.93, 0.85);
  mat.emissiveColor = new B.Color3(0.55, 0.54, 0.5);
  mat.specularColor = B.Color3.Black();
  claws.material = mat;
  claws.isPickable = false;
  claws.parent = root;
}

/** Spray from the breaking wave, drifting down over the boats like snow. */
function buildSpray(scene) {
  const tex = new B.DynamicTexture('wave-spray', 32, scene, false);
  const ctx = tex.getContext();
  ctx.clearRect(0, 0, 32, 32);
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.arc(16, 16, 11, 0, Math.PI * 2);
  ctx.fill();
  tex.update();
  tex.hasAlpha = true;
  const ps = new B.ParticleSystem('wave-spray', 900, scene);
  ps.particleTexture = tex;
  ps.emitter = new B.Vector3(WAVE_X + 4, 12, WAVE_Z);
  ps.minEmitBox = new B.Vector3(-6, -3, -22);
  ps.maxEmitBox = new B.Vector3(4, 6, 20);
  ps.color1 = new B.Color4(1, 1, 0.97, 0.95);
  ps.color2 = new B.Color4(0.9, 0.94, 1, 0.85);
  ps.colorDead = new B.Color4(1, 1, 1, 0);
  ps.minSize = 0.05;
  ps.maxSize = 0.16;
  ps.minLifeTime = 6;
  ps.maxLifeTime = 11;
  ps.emitRate = 80;
  ps.direction1 = new B.Vector3(-0.6, -0.4, -0.1);
  ps.direction2 = new B.Vector3(-0.2, -0.8, 0.1);
  ps.minEmitPower = 0.3;
  ps.maxEmitPower = 0.8;
  ps.gravity = new B.Vector3(0, -0.15, 0);
  ps.blendMode = B.ParticleSystem.BLENDMODE_STANDARD;
  ps.preWarmCycles = 200;
  ps.preWarmStepOffset = 5;
  return ps;
}

function buildFuji(scene, root) {
  const fuji = B.MeshBuilder.CreateCylinder('wave-fuji', { diameterTop: 4, diameterBottom: 80, height: 22, tessellation: 64 }, scene);
  fuji.position.set(-40, 10, -340);
  fuji.material = shaderMat(scene, 'wave-fuji-mat', 'waveFuji', [], ['position', 'uv']);
  fuji.isPickable = false;
  fuji.parent = root;
}

function stdMat(scene, name, rgb, glow = 0.35) {
  const m = new B.StandardMaterial(name, scene);
  m.diffuseColor = new B.Color3(...rgb);
  m.emissiveColor = new B.Color3(...rgb).scale(glow);
  m.specularColor = B.Color3.Black();
  return m;
}

/**
 * A long oshiokuri-bune rowing boat with its crew bent over their oars, built along local Z with
 * the bow toward -Z. Returns the deck (your boat's floor) and the crew's positions in local space.
 */
function buildBoat(scene, parent, mats, { width, length, crewZ }) {
  const node = new B.TransformNode('wave-boat', scene);
  node.parent = parent;
  const bucket = { hull: [], deck: [], coat: [], skin: [], oar: [] };
  const deck = B.MeshBuilder.CreateBox('wave-boat-deck', { width, height: 0.2, depth: length }, scene);
  deck.position.y = -0.1;
  const hull = B.MeshBuilder.CreateBox('wave-boat-hull', { width: width + 0.2, height: 0.7, depth: length }, scene);
  hull.position.y = -0.55;
  bucket.hull.push(hull);
  for (const side of [-1, 1]) {
    const gunwale = B.MeshBuilder.CreateBox('wave-boat-gunwale', { width: 0.14, height: 0.45, depth: length }, scene);
    gunwale.position.set(side * (width / 2 + 0.03), 0.12, 0);
    bucket.hull.push(gunwale);
  }
  // Pointed bow: a diamond-shaped block whose front corner forms the prow.
  const bow = B.MeshBuilder.CreateBox('wave-boat-bow', { width: width * 0.71, height: 1.1, depth: width * 0.71 }, scene);
  bow.position.set(0, -0.3, -length / 2);
  bow.rotation.y = Math.PI / 4;
  bucket.hull.push(bow);

  const crew = [];
  for (const z of crewZ) {
    for (const side of [-1, 1]) {
      const x = side * (width / 2 - 0.45);
      const coat = B.MeshBuilder.CreateSphere('wave-rower', { diameter: 1, segments: 8 }, scene);
      coat.scaling.set(0.55, 0.62, 0.72);
      coat.position.set(x, 0.42, z);
      coat.rotation.x = -0.45; // hunched forward over the oar
      bucket.coat.push(coat);
      const head = B.MeshBuilder.CreateSphere('wave-rower-head', { diameter: 0.26, segments: 8 }, scene);
      head.position.set(x, 0.78, z - 0.22);
      bucket.skin.push(head);
      const oar = B.MeshBuilder.CreateBox('wave-oar', { width: 2.6, height: 0.05, depth: 0.08 }, scene);
      oar.position.set(side * (width / 2 + 0.55), 0.2, z - 0.1);
      oar.rotation.z = side * 0.32; // dipping out into the sea
      bucket.oar.push(oar);
      crew.push({ x, z });
    }
  }
  for (const [key, list] of Object.entries(bucket)) {
    if (!list.length) continue;
    const merged = B.Mesh.MergeMeshes(list, true, true);
    merged.material = mats[key];
    merged.isPickable = false;
    merged.parent = node;
  }
  deck.material = mats.deck;
  deck.parent = node;
  deck.isPickable = false;
  return { node, deck, crew };
}

/**
 * Build the Great Wave room. Same handle shape as the other room props, plus `setWindowView` for
 * the window back to the room you came from.
 */
export function createGreatWaveRoom(scene, { returnTo = '3d-art' } = {}) {
  const root = new B.TransformNode('great-wave-room', scene);
  const start = performance.now();
  buildSky(scene, root);
  buildSea(scene, root, start);
  // The wave is built along Z, then swung about its peak so its hollow face turns toward you and
  // its far end sweeps across ahead of the bow, leaving Fuji framed in the trough.
  const wave = new B.TransformNode('great-wave', scene);
  wave.parent = root;
  wave.setPivotPoint(new B.Vector3(WAVE_X, 0, WAVE_Z));
  wave.rotation.y = 0.25;
  const outer = smoothProfile(OUTER);
  waveRibbon(scene, wave, start, 'great-wave-back', outer, 0.62, 1.0);
  waveRibbon(scene, wave, start, 'great-wave-face', smoothProfile(INNER), 0.8, 0.8);
  buildClaws(scene, wave, outer);
  const spray = buildSpray(scene);
  buildFuji(scene, root);

  const mats = {
    hull: stdMat(scene, 'wave-hull', [0.55, 0.42, 0.28]),
    deck: stdMat(scene, 'wave-deck', [0.58, 0.45, 0.3], 0.2),
    coat: stdMat(scene, 'wave-coat', [0.12, 0.2, 0.4]),
    skin: stdMat(scene, 'wave-skin', [0.9, 0.78, 0.62]),
    oar: stdMat(scene, 'wave-oar', [0.78, 0.68, 0.5]),
  };
  // Your boat: crew ahead of you, the stern (and the window home) behind you.
  const yours = buildBoat(scene, root, mats, { width: BOAT.width, length: BOAT.length, crewZ: [-4.5, -2.5, -0.5, 1.5, 3.5] });
  yours.node.position.z = BOAT.z;
  yours.deck.isPickable = true; // VR teleport target
  // Two more boats riding the swell, as in the print.
  const other = [
    { pos: [-7, 0.3, -30], rotY: 0.25, pitch: 0.12 },
    { pos: [-20, 0.3, -6], rotY: 0.9, pitch: -0.08 },
  ];
  for (const o of other) {
    const b = buildBoat(scene, root, mats, { width: 2.4, length: 14, crewZ: [-4, -2, 0, 2] });
    b.node.position.set(...o.pos);
    b.node.rotation.set(o.pitch, o.rotY, 0);
  }

  const windowZ = BOAT.z + BOAT.length / 2 - 1.2;
  const windowView = buildReturnWindow(scene, root, returnTo, windowZ, 'wave-window');

  let saved = null;
  const setEnabled = (on) => {
    root.setEnabled(on);
    const hemi = scene.getLightByName('hemi');
    if (on) {
      saved = { fog: scene.fogDensity, hemiDiffuse: hemi?.diffuse.clone(), hemiGround: hemi?.groundColor.clone() };
      scene.fogDensity = 0;
      scene.clearColor = new B.Color4(0.94, 0.89, 0.77, 1);
      if (hemi) {
        hemi.diffuse = new B.Color3(1, 0.96, 0.88); // soft, even daylight, like a print
        hemi.groundColor = new B.Color3(0.35, 0.42, 0.55);
      }
      spray.start();
    } else {
      spray.stop();
      spray.reset();
      if (saved) {
        scene.fogDensity = saved.fog;
        if (hemi && saved.hemiDiffuse) {
          hemi.diffuse = saved.hemiDiffuse;
          hemi.groundColor = saved.hemiGround;
        }
        saved = null;
      }
    }
  };
  setEnabled(false);

  const half = BOAT.width / 2;
  return {
    colliders: [
      room(-half + 0.3, half - 0.3, BOAT.z - BOAT.length / 2 + 0.4, BOAT.z + BOAT.length / 2 - 0.3),
      ...yours.crew.map((c) => circle(c.x, c.z + BOAT.z, 0.38)),
      circle(0, windowZ, 1.2),
    ],
    floors: [yours.deck],
    setEnabled,
    setWindowView: (tex) => windowView.setView(tex),
  };
}
