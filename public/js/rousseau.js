/* global BABYLON */
// Rousseau's "The Sleeping Gypsy" as a place: a still, moonlit desert. The sleeper lies in a
// striped robe with a mandolin and a clay water jar beside them, and the lion stands over them,
// sniffing, tail raised (modelled characters from the models repo). Beyond the pale sand, a calm
// river reflects the full moon, with bare blue-grey hills on the far bank under a deep blue sky.
// Sky, sand, river and hills are procedural.
import { wall, box, circle } from './collision.js';
import { NOISE, shaderMat, buildReturnWindow } from './starryNight.js';
import { loadModel, roomReflections, applyReflections } from './props.js';

const B = BABYLON;

const MODELS_REPO = 'https://raw.githubusercontent.com/Scottie113/Models-for-Meetup-room/main/rousseau-models-fit/';
// The sleeper, lion and mandolin, as arranged in the file: the sleeper lies across X with their
// head to your right (-X) and the lion behind them, all facing +Z toward where you arrive (z ~8.5).
const GROUP = { x: 0, z: 2, scale: 1.2 };
const WALK_RADIUS = 34; // flat sand you can wander; dunes rise beyond
const RIVER = { near: -38, far: -58 };
const MOON_DIR = new B.Vector3(-0.42, 0.42, -0.8).normalize(); // high, ahead and to the right

// ---- night sky: deep blue fading paler at the horizon, a few stars and a big full moon ------------
B.Effect.ShadersStore.gypsySkyVertexShader = `
precision highp float;
attribute vec3 position;
uniform mat4 worldViewProjection;
varying vec3 vDir;
void main() { vDir = position; gl_Position = worldViewProjection * vec4(position, 1.0); }`;

B.Effect.ShadersStore.gypsySkyFragmentShader = `
precision highp float;
varying vec3 vDir;
uniform vec3 moonDir;
${NOISE}
void main() {
  vec3 d = normalize(vDir);
  float el = d.y;
  vec3 col = mix(vec3(0.3, 0.38, 0.55), vec3(0.05, 0.09, 0.24), smoothstep(-0.02, 0.6, el));
  // Sparse small stars.
  vec2 g = vec2(atan(d.x, -d.z) * 700.0, el * 700.0);
  float star = step(0.9985, hash(floor(g))) * smoothstep(0.35, 0.15, length(fract(g) - 0.5)) * smoothstep(0.08, 0.3, el);
  col = mix(col, vec3(0.92, 0.92, 0.85), star * 0.8);
  // The full moon: a flat cream disc with a soft halo, as Rousseau painted it.
  float m = dot(d, moonDir);
  col += vec3(0.25, 0.27, 0.3) * smoothstep(0.985, 0.9995, m) * 0.6;
  col = mix(col, vec3(0.97, 0.94, 0.82), smoothstep(0.99935, 0.99945, m));
  gl_FragColor = vec4(col, 1.0);
}`;

// ---- the land: pale moonlit sand with sparse tufts, then blue-grey hills on the far bank ----------
B.Effect.ShadersStore.gypsyLandVertexShader = `
precision highp float;
attribute vec3 position;
uniform mat4 world;
uniform mat4 worldViewProjection;
varying vec3 vPos;
void main() { vPos = (world * vec4(position, 1.0)).xyz; gl_Position = worldViewProjection * vec4(position, 1.0); }`;

B.Effect.ShadersStore.gypsyLandFragmentShader = `
precision highp float;
varying vec3 vPos;
${NOISE}
void main() {
  vec2 p = vPos.xz;
  // Smooth, softly graded sand: Rousseau's desert is flat and pale under the moon.
  vec3 sand = mix(vec3(0.5, 0.43, 0.32), vec3(0.66, 0.57, 0.42), fbm(p * 0.08));
  sand *= 0.92 + 0.12 * fbm(p * 0.6);
  // Small dark tufts of desert grass and pebbles, scattered thinly.
  vec2 g = p * 1.4;
  vec2 id = floor(g);
  float tuft = step(0.988, hash(id)) * smoothstep(0.2, 0.06, length(fract(g) - 0.5));
  sand = mix(sand, vec3(0.3, 0.33, 0.2), tuft * 0.8);
  float pebble = step(0.992, hash(id + 5.0)) * smoothstep(0.18, 0.08, length(fract(g) - 0.5));
  sand = mix(sand, vec3(0.3, 0.26, 0.22), pebble);
  // The far bank and hills: cool blue-grey with soft ridged shading.
  vec3 hill = mix(vec3(0.24, 0.27, 0.38), vec3(0.42, 0.44, 0.55), smoothstep(0.0, 14.0, vPos.y));
  hill *= 0.85 + 0.2 * sin(vPos.y * 1.6 + fbm(p * 0.05) * 5.0);
  float farBank = smoothstep(${(RIVER.far + 2).toFixed(1)}, ${(RIVER.far - 2).toFixed(1)}, vPos.z);
  vec3 col = mix(sand, hill, farBank);
  gl_FragColor = vec4(col, 1.0);
}`;

// ---- the river: still dark blue water with the moon's light laid across it ----------------------
B.Effect.ShadersStore.gypsyRiverVertexShader = B.Effect.ShadersStore.gypsyLandVertexShader;

B.Effect.ShadersStore.gypsyRiverFragmentShader = `
precision highp float;
varying vec3 vPos;
uniform float time;
${NOISE}
void main() {
  vec3 col = mix(vec3(0.1, 0.16, 0.32), vec3(0.2, 0.28, 0.46), fbm(vec2(vPos.x * 0.04, vPos.z * 0.3) + time * 0.02));
  // The moon's reflection: a soft column of light on the water in line with the moon.
  float lane = smoothstep(9.0, 0.0, abs(vPos.x - (vPos.z * ${(MOON_DIR.x / MOON_DIR.z).toFixed(3)})));
  float ripple = 0.5 + 0.5 * sin(vPos.z * 3.0 + fbm(vPos.xz * 0.5) * 4.0 + time * 0.6);
  col = mix(col, vec3(0.85, 0.85, 0.78), lane * ripple * 0.45);
  gl_FragColor = vec4(col, 1.0);
}`;

function buildSky(scene, root) {
  const sky = B.MeshBuilder.CreateSphere('gypsy-sky', { diameter: 900, segments: 32, sideOrientation: B.Mesh.BACKSIDE }, scene);
  const mat = shaderMat(scene, 'gypsy-sky-mat', 'gypsySky', ['moonDir']);
  mat.onBindObservable.add(() => mat.setVector3('moonDir', MOON_DIR));
  sky.material = mat;
  sky.infiniteDistance = true;
  sky.isPickable = false;
  sky.parent = root;
}

/**
 * Ground height: flat where you walk, low dunes beyond, a dip for the river ahead, and the far
 * bank rising into bare rounded hills.
 */
function landHeight(x, z) {
  const r = Math.hypot(x, z);
  // Dunes stay low and keep clear of the view ahead, so the river and hills show over the sand.
  const ahead = Math.max(0, Math.min(1, (z + 30) / 30));
  const rise = Math.max(0, r - WALK_RADIUS);
  const dunes = ahead * Math.min(6, rise * 0.012 * (1.2 + Math.sin(x * 0.05) + Math.sin(z * 0.07 + 1.3)) + 0.4 * Math.min(1, rise / 10) * Math.sin(x * 0.18 + z * 0.11));
  if (z > RIVER.near + 4) return Math.max(0, dunes);
  if (z > RIVER.far) return -1.2; // the river bed
  const hills = 1 + (-z + RIVER.far) * 0.12 + 7 * Math.max(0, Math.sin(x * 0.025 + 0.6)) ** 2 + 3 * Math.sin(x * 0.07 - 0.4) + 2 * Math.sin(x * 0.13);
  return Math.max(0.4, Math.min(22, hills));
}

function buildLand(scene, root) {
  const land = B.MeshBuilder.CreateGround('gypsy-land', { width: 520, height: 520, subdivisions: 200, updatable: true }, scene);
  const pos = land.getVerticesData(B.VertexBuffer.PositionKind);
  for (let i = 0; i < pos.length; i += 3) pos[i + 1] = landHeight(pos[i], pos[i + 2]);
  land.updateVerticesData(B.VertexBuffer.PositionKind, pos);
  land.refreshBoundingInfo();
  land.material = shaderMat(scene, 'gypsy-land-mat', 'gypsyLand', []);
  land.parent = root;
  return land;
}

function buildRiver(scene, root, start) {
  const river = B.MeshBuilder.CreateGround('gypsy-river', { width: 520, height: RIVER.near - RIVER.far + 6 }, scene);
  river.position.set(0, -0.35, (RIVER.near + RIVER.far) / 2);
  const mat = shaderMat(scene, 'gypsy-river-mat', 'gypsyRiver', ['time']);
  mat.onBindObservable.add(() => mat.setFloat('time', (performance.now() - start) / 1000));
  river.material = mat;
  river.isPickable = false;
  river.parent = root;
}

/** The sleeper's clay water jar: a round-bellied terracotta jug with a narrow neck and lip. */
function buildJar(scene, parent) {
  const profile = [
    [0, 0], [0.11, 0.0], [0.17, 0.08], [0.19, 0.2], [0.16, 0.32], [0.08, 0.4], [0.06, 0.48], [0.085, 0.53], [0.075, 0.55],
  ].map(([x, y]) => new B.Vector3(x, y, 0));
  const jar = B.MeshBuilder.CreateLathe('gypsy-jar', { shape: profile, tessellation: 28, sideOrientation: B.Mesh.DOUBLESIDE }, scene);
  const mat = new B.StandardMaterial('gypsy-jar-mat', scene);
  mat.diffuseColor = new B.Color3(0.66, 0.38, 0.22);
  mat.specularColor = new B.Color3(0.15, 0.12, 0.1);
  jar.material = mat;
  jar.isPickable = false;
  jar.parent = parent;
  jar.position.set(-1.6, 0, 0.05); // beside the sleeper's head, as in the painting
  jar.scaling.setAll(0.9);
  return jar;
}

/** The lion, the sleeper and the mandolin from the models repo (one file, arranged as painted). */
async function buildFigures(scene, anchor) {
  const parts = await loadModel(scene, `${MODELS_REPO}sleeping-gypsy-three-models.glb`, anchor);
  for (const p of parts) p.isPickable = false;
  const reflections = roomReflections(scene, new B.Vector3(GROUP.x, 1.2, GROUP.z + 2), new Set(parts));
  applyReflections(parts, reflections);
  return { parts, reflections };
}

/**
 * Build the Sleeping Gypsy room. Same handle shape as the other room props, plus `setWindowView`
 * for the window back to the room you came from.
 */
export function createSleepingGypsyRoom(scene, { returnTo = '3d-art' } = {}) {
  const root = new B.TransformNode('gypsy-room', scene);
  const start = performance.now();
  buildSky(scene, root);
  const land = buildLand(scene, root);
  buildRiver(scene, root, start);

  const anchor = new B.TransformNode('gypsy-figures', scene);
  anchor.parent = root;
  anchor.position.set(GROUP.x, 0, GROUP.z);
  anchor.scaling.setAll(GROUP.scale);
  const jar = buildJar(scene, anchor);

  // Cool, pale moonlight from the moon's direction, lighting only the figures and the jar.
  const moon = new B.DirectionalLight('gypsy-moon', MOON_DIR.scale(-1), scene);
  moon.diffuse = new B.Color3(0.85, 0.88, 1);
  moon.specular = new B.Color3(0.3, 0.3, 0.35);
  moon.intensity = 1.1;
  moon.parent = root;
  moon.includedOnlyMeshes = [jar];
  const figures = buildFigures(scene, anchor)
    .then((r) => {
      moon.includedOnlyMeshes = [jar, ...r.parts];
      return r.reflections;
    })
    .catch((err) => {
      console.warn('Could not load the Sleeping Gypsy models from the models repo', err);
      return null;
    });

  const windowZ = GROUP.z + 9.5;
  const windowView = buildReturnWindow(scene, root, returnTo, windowZ, 'gypsy-window');

  let saved = null;
  const setEnabled = (on) => {
    root.setEnabled(on);
    const hemi = scene.getLightByName('hemi');
    if (on) {
      saved = { fog: scene.fogDensity, hemiDiffuse: hemi?.diffuse.clone(), hemiGround: hemi?.groundColor.clone() };
      scene.fogDensity = 0;
      scene.clearColor = new B.Color4(0.05, 0.09, 0.24, 1);
      if (hemi) {
        hemi.diffuse = new B.Color3(0.5, 0.55, 0.75); // blue night light
        hemi.groundColor = new B.Color3(0.3, 0.26, 0.2); // warm bounce from the sand
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

  land.isPickable = true; // VR teleport target
  const s = GROUP.scale;
  return {
    colliders: [
      wall(0, 0, WALK_RADIUS - 1),
      // The lion, sleeper and mandolin together (model bounds x -1.2..1.4, z -0.7..1.25), plus the jar.
      box(GROUP.x + 0.1 * s, GROUP.z + 0.28 * s, 2.7 * s, 2.0 * s),
      box(GROUP.x - 1.6 * s, GROUP.z + 0.05 * s, 0.5 * s, 0.5 * s),
      circle(0, windowZ, 1.2),
    ],
    floors: [land],
    setEnabled,
    setWindowView: (tex) => windowView.setView(tex),
  };
}
