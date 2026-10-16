/* global BABYLON */
// Munch's "The Scream" as a place: you stand on the boardwalk high above the Oslofjord at sunset.
// The planked road runs away from you along the hillside with its railing on the right, the fjord
// swirls deep blue far below, dark shores curve round it, and the sky flows in bands of blood red,
// orange and yellow. The screaming figure stands right in front of you, hands to its face, and the
// two dark walkers stroll far down the bridge (modelled characters from the models repo).
// Shaders are procedural, painted in Munch's long, wavy strokes.
import { room, circle } from './collision.js';
import { NOISE, shaderMat, buildReturnWindow } from './starryNight.js';
import { loadModel, roomReflections, applyReflections } from './props.js';
import { bakeSky } from './skyBake.js';

const B = BABYLON;

const MODELS_REPO = 'https://raw.githubusercontent.com/Scottie113/Models-for-Meetup-room/main/munch-characters/';
// The boardwalk runs along -Z (away from where you arrive at z ~8.5); its top is at y = 0.
const DECK = { minX: -2.6, maxX: 2.6, minZ: -70, maxZ: 13 };
const WATER_Y = -14;
// The screamer stands just ahead of you, facing you (+Z, as modelled); the walkers are far down
// the bridge near the railing, as in the painting.
const FIGURES = [
  { file: 'foreground-scream.glb', x: -1.75, z: 3.6, r: 0.45 },
  { file: 'distant-walker-1.glb', x: -1.6, z: -15, r: 0.35 },
  { file: 'distant-walker-2.glb', x: -0.9, z: -16.6, r: 0.35 },
];

// ---- the sky: flowing bands of red, orange and yellow, with a little blue-green up high --------
B.Effect.ShadersStore.screamSkyVertexShader = `
precision highp float;
attribute vec3 position;
uniform mat4 worldViewProjection;
varying vec3 vDir;
void main() { vDir = position; gl_Position = worldViewProjection * vec4(position, 1.0); }`;

B.Effect.ShadersStore.screamSkyFragmentShader = `
precision highp float;
varying vec3 vDir;
uniform float time;
${NOISE}
void main() {
  vec3 d = normalize(vDir);
  float az = atan(d.x, -d.z);
  float el = d.y;
  float t = time * 0.12;
  // Long wavy bands: elevation bent by slow swells round the horizon and by noise, all drifting.
  float v = el * 7.0 + 0.9 * sin(az * 2.0 + el * 4.0 + t) + 0.7 * fbm(vec2(az * 2.5 + t * 0.4, el * 5.0));
  float band = 0.5 + 0.5 * sin(v * 2.2);
  vec3 red = vec3(0.78, 0.16, 0.08);
  vec3 orange = vec3(0.94, 0.45, 0.13);
  vec3 yellow = vec3(0.97, 0.76, 0.34);
  vec3 col = band < 0.5 ? mix(red, orange, band * 2.0) : mix(orange, yellow, (band - 0.5) * 2.0);
  // Higher up the fire cools into streaks of blue-green, as at the top of the painting.
  float cool = smoothstep(0.35, 0.75, el + 0.15 * sin(az * 3.0 + t));
  col = mix(col, mix(vec3(0.32, 0.48, 0.42), vec3(0.55, 0.6, 0.38), band), cool * 0.75);
  // Brush streaks running along the bands (long and horizontal, never vertical).
  float streak = fbm(vec2(az * 3.0, v * 14.0));
  col *= 0.82 + 0.3 * streak;
  // Below the horizon (hidden by land and water) fade to the fjord's dark blue.
  col = mix(vec3(0.08, 0.12, 0.3), col, smoothstep(-0.12, 0.02, el));
  gl_FragColor = vec4(col, 1.0);
}`;

// ---- the fjord: deep blue water in long curving swirls, with a glow of the sky in it -----------
B.Effect.ShadersStore.screamWaterVertexShader = `
precision highp float;
attribute vec3 position;
uniform mat4 world;
uniform mat4 worldViewProjection;
varying vec3 vPos;
void main() { vPos = (world * vec4(position, 1.0)).xyz; gl_Position = worldViewProjection * vec4(position, 1.0); }`;

B.Effect.ShadersStore.screamWaterFragmentShader = `
precision highp float;
varying vec3 vPos;
uniform float time;
${NOISE}
void main() {
  vec2 p = vPos.xz * 0.02;
  float t = time * 0.05;
  // Curving bands that follow the bay round, distorted so they read as brushwork.
  float w = length(p - vec2(-1.6, -1.2)) * 6.0 + fbm(p * 3.0 + t) * 2.2 - t * 2.0;
  float band = 0.5 + 0.5 * sin(w * 3.0);
  vec3 col = mix(vec3(0.05, 0.08, 0.26), vec3(0.16, 0.3, 0.6), band);
  col = mix(col, vec3(0.3, 0.42, 0.62), smoothstep(0.85, 1.0, band) * 0.6);
  // The sunset reflected in streaks.
  float glow = smoothstep(0.72, 0.95, fbm(vec2(p.x * 2.0 + t, p.y * 14.0)));
  col = mix(col, vec3(0.9, 0.45, 0.2), glow * 0.45);
  gl_FragColor = vec4(col, 1.0);
}`;

// ---- the land: hillside and far shores, dark green and blue with ochre swirls ---------------------
B.Effect.ShadersStore.screamLandVertexShader = B.Effect.ShadersStore.screamWaterVertexShader;

B.Effect.ShadersStore.screamLandFragmentShader = `
precision highp float;
varying vec3 vPos;
${NOISE}
void main() {
  vec2 p = vPos.xz * 0.05;
  float h = clamp((vPos.y - ${WATER_Y.toFixed(1)}) / 30.0, 0.0, 1.0);
  // Low shores are bluish-black; higher ground turns green and ochre.
  vec3 col = mix(vec3(0.07, 0.1, 0.18), vec3(0.16, 0.3, 0.16), smoothstep(0.0, 0.35, h));
  col = mix(col, vec3(0.62, 0.45, 0.2), smoothstep(0.35, 0.9, h) * 0.6);
  // Wavy strokes following the slope.
  float s = 0.5 + 0.5 * sin(vPos.y * 1.4 + fbm(p * 2.5) * 6.0);
  col *= 0.75 + 0.45 * s;
  col = mix(col, vec3(0.8, 0.42, 0.15), smoothstep(0.8, 0.95, fbm(p * 4.0 + 7.0)) * 0.35);
  gl_FragColor = vec4(col, 1.0);
}`;

// ---- the boardwalk: orange-brown planks laid across the road, painted in streaks --------------
B.Effect.ShadersStore.screamDeckVertexShader = B.Effect.ShadersStore.screamWaterVertexShader;

B.Effect.ShadersStore.screamDeckFragmentShader = `
precision highp float;
varying vec3 vPos;
${NOISE}
void main() {
  vec2 p = vPos.xz;
  // Planks run across the road: one every ~25 cm along Z, each a slightly different tone.
  float plank = floor(p.y * 4.0);
  float seam = smoothstep(0.0, 0.06, fract(p.y * 4.0));
  vec3 col = mix(vec3(0.5, 0.25, 0.1), vec3(0.78, 0.44, 0.17), hash(vec2(plank, 2.0)));
  // Munch's long streaks running down the road.
  col *= 0.75 + 0.4 * fbm(vec2(p.x * 3.0, p.y * 0.4));
  col = mix(col, vec3(0.92, 0.66, 0.3), smoothstep(0.78, 0.95, fbm(vec2(p.x * 8.0, p.y * 0.6))) * 0.5);
  col *= 0.6 + 0.4 * seam;
  gl_FragColor = vec4(col, 1.0);
}`;

function buildSky(scene, root, start) {
  const sky = B.MeshBuilder.CreateSphere('scream-sky', { diameter: 900, segments: 40, sideOrientation: B.Mesh.BACKSIDE }, scene);
  const mat = shaderMat(scene, 'scream-sky-mat', 'screamSky', ['time']);
  mat.onBindObservable.add(() => mat.setFloat('time', (performance.now() - start) / 1000));
  sky.material = mat;
  sky.infiniteDistance = true;
  sky.isPickable = false;
  sky.parent = root;
  bakeSky(scene, sky, { animated: true }); // drawn into a cube map, not per pixel every frame
}

function buildWater(scene, root, start) {
  const water = B.MeshBuilder.CreateGround('scream-water', { width: 900, height: 900 }, scene);
  water.position.y = WATER_Y;
  const mat = shaderMat(scene, 'scream-water-mat', 'screamWater', ['time']);
  mat.onBindObservable.add(() => mat.setFloat('time', (performance.now() - start) / 1000));
  water.material = mat;
  water.isPickable = false;
  water.parent = root;
}

/**
 * Height of the land around the fjord: the hillside the road is cut into slopes down on your left,
 * the far shore rises in hills across the water on the right, and more hills close the bay ahead
 * and behind. Anywhere lower than the water is simply under it.
 */
function landHeight(x, z) {
  const n = Math.sin(x * 0.07 + z * 0.05) * 1.5 + Math.sin(z * 0.11 - x * 0.03) * 1.0;
  const hillside = x > 0 ? -0.5 - Math.max(0, x - 3.4) * 0.32 + n * 0.3 : -99;
  const farShore = WATER_Y + (-x - 90) * 0.12 + n * 1.5 + 4 * Math.sin(z * 0.025);
  const ahead = WATER_Y + (-z - 170) * 0.12 + n * 1.5 + 4 * Math.sin(x * 0.02);
  const behind = (z - 45) * 0.35 + n;
  // Far hills stay low, so the wide fjord and the sky fill the view as in the painting.
  return Math.min(6, Math.max(hillside, farShore, ahead, behind, WATER_Y - 6));
}

function buildLand(scene, root) {
  const land = B.MeshBuilder.CreateGround('scream-land', { width: 560, height: 560, subdivisions: 180, updatable: true }, scene);
  const pos = land.getVerticesData(B.VertexBuffer.PositionKind);
  for (let i = 0; i < pos.length; i += 3) pos[i + 1] = landHeight(pos[i], pos[i + 2]);
  land.updateVerticesData(B.VertexBuffer.PositionKind, pos);
  land.material = shaderMat(scene, 'scream-land-mat', 'screamLand', []);
  land.isPickable = false;
  land.parent = root;
}

/** The planked road with its railing on the fjord side (right; -X as you face down the road), propped on posts from the shore. */
function buildBoardwalk(scene, root) {
  const length = DECK.maxZ - DECK.minZ;
  const width = DECK.maxX - DECK.minX;
  const deck = B.MeshBuilder.CreateBox('scream-deck', { width, height: 0.3, depth: length }, scene);
  deck.position.set((DECK.minX + DECK.maxX) / 2, -0.15, (DECK.minZ + DECK.maxZ) / 2);
  deck.material = shaderMat(scene, 'scream-deck-mat', 'screamDeck', []);
  deck.parent = root;

  const wood = new B.StandardMaterial('scream-rail-mat', scene);
  wood.diffuseColor = new B.Color3(0.62, 0.32, 0.12);
  wood.emissiveColor = new B.Color3(0.22, 0.1, 0.04);
  wood.specularColor = B.Color3.Black();
  const parts = [];
  const railX = DECK.minX + 0.08;
  // Two long rails, slightly irregular like the painted ones.
  for (const [y, h] of [[1.05, 0.1], [0.55, 0.07]]) {
    const rail = B.MeshBuilder.CreateBox('scream-rail', { width: 0.09, height: h, depth: length }, scene);
    rail.position.set(railX, y, deck.position.z);
    parts.push(rail);
  }
  // Posts every 1.8 m, and long legs down to the shore under the fjord side.
  for (let z = DECK.maxZ - 0.3; z > DECK.minZ; z -= 1.8) {
    const post = B.MeshBuilder.CreateBox('scream-post', { width: 0.12, height: 1.15, depth: 0.12 }, scene);
    post.position.set(railX, 0.57, z);
    parts.push(post);
  }
  for (let z = DECK.maxZ - 2; z > DECK.minZ; z -= 9) {
    const leg = B.MeshBuilder.CreateBox('scream-leg', { width: 0.25, height: 16, depth: 0.25 }, scene);
    leg.position.set(DECK.minX + 0.4, -8.2, z);
    leg.rotation.z = 0.12; // splayed out toward the water
    parts.push(leg);
  }
  // A low curb on the hillside (left) edge.
  const curb = B.MeshBuilder.CreateBox('scream-curb', { width: 0.15, height: 0.18, depth: length }, scene);
  curb.position.set(DECK.maxX - 0.08, 0.09, deck.position.z);
  parts.push(curb);
  const merged = B.Mesh.MergeMeshes(parts, true, true);
  merged.material = wood;
  merged.isPickable = false;
  merged.parent = root;
  return deck;
}

/** The three figures, each loaded from its own file in the models repo. */
async function buildFigures(scene, root) {
  const all = [];
  await Promise.all(
    FIGURES.map(async (f) => {
      const anchor = new B.TransformNode(`scream-${f.file}`, scene);
      anchor.parent = root;
      anchor.position.set(f.x, 0, f.z);
      const parts = await loadModel(scene, MODELS_REPO + f.file, anchor);
      for (const p of parts) p.isPickable = false;
      all.push(...parts);
    }),
  );
  // Their painted robes are PBR; give them the sunset to reflect.
  const reflections = roomReflections(scene, new B.Vector3(0, 1.4, 5), new Set(all));
  applyReflections(all, reflections);
  return reflections;
}

/**
 * Build the Scream room. Same handle shape as the other room props, plus `setWindowView` for the
 * window back to the room you came from.
 */
export function createScreamRoom(scene, { returnTo = '3d-art' } = {}) {
  const root = new B.TransformNode('scream-room', scene);
  const start = performance.now();
  buildSky(scene, root, start);
  buildWater(scene, root, start);
  buildLand(scene, root);
  const deck = buildBoardwalk(scene, root);
  const figures = buildFigures(scene, root).catch((err) => {
    console.warn('Could not load the Munch figures from the models repo', err);
    return null;
  });
  const windowZ = DECK.maxZ - 1.2;
  const windowView = buildReturnWindow(scene, root, returnTo, windowZ, 'scream-window');

  // Low sunset light from ahead-left, lighting the screamer's face red-orange.
  const sun = new B.PointLight('scream-sun', new B.Vector3(3, 4, 9), scene);
  sun.diffuse = new B.Color3(1, 0.6, 0.35);
  sun.intensity = 0.7;
  sun.range = 16;
  sun.parent = root;

  let saved = null;
  const setEnabled = (on) => {
    root.setEnabled(on);
    const hemi = scene.getLightByName('hemi');
    if (on) {
      saved = { fog: scene.fogDensity, hemiDiffuse: hemi?.diffuse.clone(), hemiGround: hemi?.groundColor.clone() };
      scene.fogDensity = 0;
      scene.clearColor = new B.Color4(0.85, 0.35, 0.12, 1);
      if (hemi) {
        hemi.diffuse = new B.Color3(1, 0.72, 0.5); // the sunset's glow
        hemi.groundColor = new B.Color3(0.18, 0.2, 0.38); // blue bounce from the fjord
      }
      figures.then((r) => r?.capture());
    } else if (saved) {
      scene.fogDensity = saved.fog;
      if (hemi && saved.hemiDiffuse) {
        hemi.diffuse = saved.hemiDiffuse;
        hemi.groundColor = saved.hemiGround;
      }
      saved = null;
    }
  };
  setEnabled(false);

  deck.isPickable = true; // VR teleport target
  return {
    colliders: [
      room(DECK.minX + 0.3, DECK.maxX - 0.25, DECK.minZ + 0.5, DECK.maxZ - 0.3),
      ...FIGURES.map((f) => circle(f.x, f.z, f.r)),
      circle(0, windowZ, 1.2),
    ],
    floors: [deck],
    root, // lets the world freeze the static scenery once it has loaded
    ready: figures,
    setEnabled,
    setWindowView: (tex) => windowView.setView(tex),
  };
}
