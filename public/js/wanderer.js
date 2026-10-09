/* global BABYLON */
// Friedrich's "Wanderer above the Sea of Fog" as a place: you stand on the rocky summit just
// behind the Wanderer (the modelled character from the models repo), who looks out from the
// edge with one boot up on a rock. Below, a sea of fog fills the valleys in slow, billowing
// layers, with crags and peaks breaking through it; blue mountain ridges fade into the haze,
// under Friedrich's luminous cream-to-blue-grey sky. Terrain, fog and sky are procedural.
import { wall, circle } from './collision.js';
import { NOISE, shaderMat, buildReturnWindow } from './starryNight.js';
import { loadModel, roomReflections, applyReflections } from './props.js';

const B = BABYLON;

const MODELS_REPO = 'https://raw.githubusercontent.com/Scottie113/Models-for-Meetup-room/main/';
const SUMMIT = { x: 0, z: 8, r: 6 }; // flat, walkable hilltop; players arrive at z ~8.5
const WANDERER = { x: 0.5, z: 2.9 }; // at the front edge, facing out over the fog (-Z)
const FOG_LEVELS = [-14, -18, -23]; // drifting fog layers; the lowest one is solid
const HAZE = 'vec3(0.86, 0.87, 0.89)';

// ---- sky ---------------------------------------------------------------------------
B.Effect.ShadersStore.friedrichSkyVertexShader = `
precision highp float;
attribute vec3 position;
uniform mat4 worldViewProjection;
varying vec3 vDir;
void main() { vDir = position; gl_Position = worldViewProjection * vec4(position, 1.0); }`;

B.Effect.ShadersStore.friedrichSkyFragmentShader = `
precision highp float;
varying vec3 vDir;
uniform float time;
uniform vec3 sunDir;
${NOISE}
void main() {
  vec3 d = normalize(vDir);
  float e = d.y;
  float az = atan(d.x, -d.z);
  // Warm, luminous cream at the horizon rising into cool blue-grey.
  vec3 horizon = vec3(0.96, 0.92, 0.83);
  vec3 mid = vec3(0.80, 0.82, 0.84);
  vec3 zenith = vec3(0.58, 0.65, 0.76);
  vec3 col = mix(horizon, mid, smoothstep(0.0, 0.25, e));
  col = mix(col, zenith, smoothstep(0.25, 0.75, e));
  // Long, soft cloud streaks, as if laid on with a broad brush.
  vec2 cp = vec2(az * 2.2 + time * 0.004, e * 9.0);
  float streak = fbm(vec2(cp.x * 1.2, cp.y * 3.0) + fbm(cp * 0.8) * 1.5);
  float cloud = smoothstep(0.5, 0.8, streak) * smoothstep(0.02, 0.15, e) * smoothstep(0.7, 0.3, e);
  col = mix(col, vec3(0.93, 0.92, 0.90), cloud * 0.6);
  col = mix(col, vec3(0.66, 0.68, 0.74), smoothstep(0.62, 0.85, streak) * cloud * 0.4);
  // Glow around the hidden sun, low ahead-left.
  float sun = max(dot(d, sunDir), 0.0);
  col += vec3(1.0, 0.92, 0.75) * (pow(sun, 12.0) * 0.25 + pow(sun, 120.0) * 0.4);
  // Fine canvas/brush grain.
  col *= 0.97 + 0.06 * hash(floor(vec2(az * 400.0, e * 300.0)));
  if (e < 0.0) col = mix(col, ${HAZE}, smoothstep(0.0, -0.1, e));
  gl_FragColor = vec4(col, 1.0);
}`;

// ---- rock: summit, crags and mountains --------------------------------------------------
B.Effect.ShadersStore.friedrichRockVertexShader = `
precision highp float;
attribute vec3 position;
attribute vec3 normal;
uniform mat4 world;
uniform mat4 worldViewProjection;
varying vec3 vPos;
varying vec3 vNormal;
void main() {
  vPos = (world * vec4(position, 1.0)).xyz;
  vNormal = normalize(mat3(world) * normal);
  gl_Position = worldViewProjection * vec4(position, 1.0);
}`;

B.Effect.ShadersStore.friedrichRockFragmentShader = `
precision highp float;
varying vec3 vPos;
varying vec3 vNormal;
uniform vec3 eye;
uniform vec3 sunDir;
uniform float far; // 1 for distant mountains: bluer, hazier
${NOISE}
void main() {
  vec3 n = normalize(vNormal);
  // Brushy streaks running down the rock faces.
  float streak = fbm(vec2(vPos.x * 1.3 + vPos.z * 0.7, vPos.y * 0.45));
  float grain = fbm(vPos.xz * 2.5 + vPos.y);
  vec3 umber = vec3(0.17, 0.14, 0.12);
  vec3 grey = vec3(0.36, 0.35, 0.34);
  vec3 ochre = vec3(0.50, 0.43, 0.33);
  vec3 col = mix(umber, grey, smoothstep(0.35, 0.7, streak));
  col = mix(col, ochre, smoothstep(0.62, 0.85, grain) * 0.6);
  float lit = 0.45 + 0.6 * max(dot(n, sunDir), 0.0);
  col *= lit;
  vec3 blue = vec3(0.52, 0.58, 0.68);
  col = mix(col, blue * (0.8 + 0.3 * lit), far);
  float dist = length(vPos - eye);
  col = mix(col, ${HAZE}, clamp((1.0 - exp(-dist * 0.006)) * 0.9 + far * 0.25, 0.0, 0.92));
  gl_FragColor = vec4(col, 1.0);
}`;

// ---- the sea of fog ---------------------------------------------------------------------
B.Effect.ShadersStore.seaFogVertexShader = `
precision highp float;
attribute vec3 position;
uniform mat4 world;
uniform mat4 worldViewProjection;
varying vec3 vPos;
void main() {
  vPos = (world * vec4(position, 1.0)).xyz;
  gl_Position = worldViewProjection * vec4(position, 1.0);
}`;

B.Effect.ShadersStore.seaFogFragmentShader = `
precision highp float;
varying vec3 vPos;
uniform float time;
uniform float opacity;
uniform float seed;
uniform vec3 eye;
${NOISE}
void main() {
  vec2 p = vPos.xz;
  float t = time;
  // Two scales of slowly drifting billows.
  float big = fbm(p * 0.011 + vec2(t * 0.006 + seed, t * 0.002));
  float small = fbm(p * 0.045 + vec2(-t * 0.01, t * 0.004 + seed));
  float n = big * 0.7 + small * 0.45;
  float density = smoothstep(0.32, 0.72, n);
  // Billow tops catch the light; the hollows between them are cool and grey.
  vec3 shadow = vec3(0.70, 0.73, 0.80);
  vec3 lit = vec3(0.97, 0.96, 0.93);
  vec3 col = mix(shadow, lit, smoothstep(0.45, 0.85, n));
  float dist = length(vPos - eye);
  col = mix(col, ${HAZE}, (1.0 - exp(-dist * 0.004)) * 0.6);
  float alpha = opacity >= 1.0 ? 1.0 : density * opacity;
  gl_FragColor = vec4(col, alpha);
}`;

const smooth = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Summit height: flat walkable top, then craggy cliffs plunging into the fog. */
function summitHeight(x, z) {
  const r = Math.hypot(x - SUMMIT.x, z - SUMMIT.z);
  if (r <= SUMMIT.r) return 0;
  const k = r - SUMMIT.r;
  const crag = (Math.sin(x * 1.7) * Math.cos(z * 1.3) + Math.sin(x * 0.6 + z * 0.9)) * 0.6 * smooth(0, 3, k);
  // Rock outcrops either side of the Wanderer frame the view, like the painting's foreground.
  const outcrops =
    1.4 * Math.exp(-((x + 3.6) ** 2 + (z - 2.3) ** 2) / 2.2) + 1.0 * Math.exp(-((x - 4.2) ** 2 + (z - 3.4) ** 2) / 1.6);
  return -Math.pow(k, 1.45) * 1.15 + crag + outcrops * smooth(0, 0.6, k);
}

/** A craggy rock mass: an icosphere pushed in and out by layered noise, stretched upward. */
function rockMass(scene, width, height, seed, x, y, z) {
  const rock = B.MeshBuilder.CreateIcoSphere('crag', { radius: 1, subdivisions: 3, updatable: true }, scene);
  const pos = rock.getVerticesData(B.VertexBuffer.PositionKind);
  for (let i = 0; i < pos.length; i += 3) {
    const [vx, vy, vz] = [pos[i], pos[i + 1], pos[i + 2]];
    const bump =
      0.22 * Math.sin(vx * 3.1 + seed) * Math.cos(vz * 2.7 + seed * 0.7) +
      0.14 * Math.sin(vy * 5.3 + vx * 2.1 + seed * 1.3) +
      0.08 * Math.sin(vz * 9.7 + vy * 7.1 + seed * 2.1);
    // Taper towards the top for a jagged, pointed crag.
    const taper = 1 - Math.max(0, vy) * 0.55;
    const k = 1 + bump;
    pos[i] = vx * k * taper;
    pos[i + 1] = vy * (1 + bump * 0.5);
    pos[i + 2] = vz * k * taper;
  }
  rock.updateVerticesData(B.VertexBuffer.PositionKind, pos);
  const normals = [];
  B.VertexData.ComputeNormals(pos, rock.getIndices(), normals);
  rock.updateVerticesData(B.VertexBuffer.NormalKind, normals);
  rock.scaling.set(width / 2, height / 2, width / 2);
  rock.rotation.y = seed;
  rock.position.set(x, y, z);
  return rock;
}

function rockMaterial(scene, name, { far = 0 } = {}) {
  const mat = shaderMat(scene, name, 'friedrichRock', ['eye', 'sunDir', 'far'], ['position', 'normal']);
  mat.setFloat('far', far);
  mat.onBindObservable.add(() => mat.setVector3('eye', scene.activeCamera.globalPosition));
  return mat;
}

function heightMesh(scene, name, size, subdivisions, fn, centre = [0, 0]) {
  const mesh = B.MeshBuilder.CreateGround(name, { width: size, height: size, subdivisions, updatable: true }, scene);
  mesh.position.set(centre[0], 0, centre[1]);
  const pos = mesh.getVerticesData(B.VertexBuffer.PositionKind);
  for (let i = 0; i < pos.length; i += 3) pos[i + 1] = fn(pos[i] + centre[0], pos[i + 2] + centre[1]);
  mesh.updateVerticesData(B.VertexBuffer.PositionKind, pos);
  const normals = [];
  B.VertexData.ComputeNormals(pos, mesh.getIndices(), normals);
  mesh.updateVerticesData(B.VertexBuffer.NormalKind, normals);
  mesh.refreshBoundingInfo();
  return mesh;
}

function buildSky(scene, root, start, sunDir) {
  const sky = B.MeshBuilder.CreateSphere('friedrich-sky', { diameter: 1600, segments: 32, sideOrientation: B.Mesh.BACKSIDE }, scene);
  const mat = shaderMat(scene, 'friedrich-sky-mat', 'friedrichSky', ['time', 'sunDir']);
  mat.setVector3('sunDir', sunDir);
  mat.onBindObservable.add(() => mat.setFloat('time', (performance.now() - start) / 1000));
  sky.material = mat;
  sky.infiniteDistance = true;
  sky.isPickable = false;
  sky.parent = root;
}

function buildLand(scene, root, sunDir) {
  const summit = heightMesh(scene, 'friedrich-summit', 56, 140, summitHeight, [SUMMIT.x, SUMMIT.z]);
  const mat = rockMaterial(scene, 'friedrich-summit-mat');
  mat.setVector3('sunDir', sunDir);
  summit.material = mat;
  summit.parent = root;

  // Crags rising out of the fog all around: clusters of lumpy, noise-displaced rock masses.
  const rand = (() => {
    let seed = 977;
    return () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  })();
  const pieces = [];
  for (let i = 0; i < 22; i++) {
    const a = rand() * Math.PI * 2;
    const r = 38 + rand() * 170;
    const cx = Math.sin(a) * r;
    const cz = SUMMIT.z + Math.cos(a) * r;
    const height = 26 + rand() * 24 - (r > 130 ? 8 : 0);
    // A formation is a few rock masses leaning together.
    const count = 2 + Math.floor(rand() * 3);
    for (let k = 0; k < count; k++) {
      const w = 5 + rand() * 9;
      const h = height * (0.55 + rand() * 0.45);
      pieces.push(rockMass(scene, w, h, rand() * 1000, cx + (rand() - 0.5) * w * 1.6, -38 + h * 0.5, cz + (rand() - 0.5) * w * 1.6));
    }
  }
  const crags = B.Mesh.MergeMeshes(pieces, true, true);
  const cragMat = rockMaterial(scene, 'friedrich-crag-mat');
  cragMat.setVector3('sunDir', sunDir);
  crags.material = cragMat;
  crags.parent = root;

  // Distant mountain ridges ringing the horizon.
  const ridgeHeight = (x, z) => {
    const r = Math.hypot(x, z);
    const a = Math.atan2(x, z);
    const ring = smooth(260, 330, r) * (1 - smooth(420, 470, r));
    return -45 + ring * (70 + 22 * Math.sin(a * 4 + 1) + 12 * Math.sin(a * 11) + 6 * Math.sin(a * 23));
  };
  const ridges = heightMesh(scene, 'friedrich-ridges', 1000, 120, ridgeHeight);
  const ridgeMat = rockMaterial(scene, 'friedrich-ridge-mat', { far: 1 });
  ridgeMat.setVector3('sunDir', sunDir);
  ridges.material = ridgeMat;
  ridges.parent = root;
  for (const m of [summit, crags, ridges]) m.isPickable = m === summit;
  return summit;
}

function buildFog(scene, root, start) {
  FOG_LEVELS.forEach((y, i) => {
    const solid = i === FOG_LEVELS.length - 1;
    const layer = B.MeshBuilder.CreateGround(`sea-of-fog-${i}`, { width: 1200, height: 1200, subdivisions: 1 }, scene);
    layer.position.y = y;
    const mat = new B.ShaderMaterial(`sea-of-fog-mat-${i}`, scene, 'seaFog', {
      attributes: ['position'],
      uniforms: ['world', 'worldViewProjection', 'time', 'opacity', 'seed', 'eye'],
      needAlphaBlending: !solid,
    });
    mat.backFaceCulling = false;
    mat.setFloat('opacity', solid ? 1 : 0.75);
    mat.setFloat('seed', i * 13.1);
    mat.onBindObservable.add(() => {
      mat.setFloat('time', (performance.now() - start) / 1000);
      mat.setVector3('eye', scene.activeCamera.globalPosition);
    });
    if (!solid) layer.alphaIndex = 10 + i; // draw top layers back to front
    layer.material = mat;
    layer.isPickable = false;
    layer.parent = root;
  });
}

/** The Wanderer himself, from the models repo, with a rock under his raised left boot. */
async function buildWanderer(scene, root) {
  const anchor = new B.TransformNode('the-wanderer', scene);
  anchor.parent = root;
  anchor.position.set(WANDERER.x, 0, WANDERER.z);
  anchor.rotation.y = 0.12; // gazing slightly left across the fog, as in the painting

  // His left sole rests ~0.19 m up, just in front of him: a low rock to step on.
  const step = B.MeshBuilder.CreateIcoSphere('wanderer-step', { radius: 0.36, subdivisions: 1 }, scene);
  step.scaling.set(1.15, 0.55, 1.3);
  step.position.set(0.12, -0.01, -0.22);
  const stepMat = new B.StandardMaterial('wanderer-step-mat', scene);
  stepMat.diffuseColor = new B.Color3(0.3, 0.27, 0.24);
  stepMat.specularColor = B.Color3.Black();
  step.material = stepMat;
  step.parent = anchor;

  const parts = await loadModel(scene, `${MODELS_REPO}wanderer-character/wanderer-character.glb`, anchor);
  for (const p of parts) p.isPickable = false;
  const reflections = roomReflections(scene, new B.Vector3(WANDERER.x, 1.4, WANDERER.z + 1.5), new Set(parts));
  applyReflections(parts, reflections);
  return reflections;
}

/**
 * Build the Wanderer room. Same handle shape as the other room props, plus
 * `setWindowView(texture)` for the window back to the room you came from.
 */
export function createWanderer(scene, { returnTo = '3d-art' } = {}) {
  const root = new B.TransformNode('wanderer-room', scene);
  const start = performance.now();
  // The light comes from low ahead-left, behind the fog bank (Babylon: facing -Z, left is +X).
  const sunDir = new B.Vector3(0.45, 0.22, -0.86).normalize();
  buildSky(scene, root, start, sunDir);
  const summit = buildLand(scene, root, sunDir);
  buildFog(scene, root, start);
  const wanderer = buildWanderer(scene, root).catch((err) => {
    console.warn('Could not load the Wanderer character from the models repo', err);
    return null;
  });
  const windowZ = SUMMIT.z + SUMMIT.r - 1.2;
  const windowView = buildReturnWindow(scene, root, returnTo, windowZ, 'wanderer-window');

  const haze = new B.Color3(0.86, 0.87, 0.89);
  let saved = null;
  const setEnabled = (on) => {
    root.setEnabled(on);
    if (on) {
      saved = { fog: scene.fogDensity };
      scene.fogDensity = 0.002;
      scene.fogColor = haze.clone();
      scene.clearColor = haze.toColor4(1);
      wanderer.then((r) => r?.capture());
    } else if (saved) {
      scene.fogDensity = saved.fog;
      saved = null;
    }
  };
  setEnabled(false);

  return {
    colliders: [wall(SUMMIT.x, SUMMIT.z, SUMMIT.r - 0.4), circle(WANDERER.x, WANDERER.z, 0.6), circle(0, windowZ, 1.2)],
    floors: [summit],
    setEnabled,
    setWindowView: (tex) => windowView.setView(tex),
  };
}
