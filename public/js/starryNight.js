/* global BABYLON */
// "The Starry Night" as a place you can stand in: a hilltop clearing at night, the cypress
// flaring up on the left, the village with lit windows in the valley below, blue hills and
// mountains beyond, and Van Gogh's swirling sky - stars, halos, crescent moon - painted
// live on the GPU all the way around you. Everything is procedural (no downloads).
import { wall, circle } from './collision.js';
import { canvasPlane, drawLabel } from './world.js';
import { portalShimmer } from './portals.js';

const B = BABYLON;

// The walkable hilltop. Players arrive at z ~8.5 (the server's spawn), so the hilltop is centred
// behind them and its front edge is only a few metres ahead: you look straight out over the drop
// to the village, as in the painting.
const PLATEAU = 9;
const HILL_Z = 14;
const SKY_RADIUS = 450;
const DEG = Math.PI / 180;

/**
 * Direction for azimuth (0 = straight ahead, i.e. -Z; positive = to the right) and elevation.
 * Babylon is left-handed: facing -Z, your right is -X.
 */
const dirFromAzEl = (az, el) =>
  new B.Vector3(-Math.sin(az * DEG) * Math.cos(el * DEG), Math.sin(el * DEG), -Math.cos(az * DEG) * Math.cos(el * DEG));
/** Same projection the sky shader uses (stereographic from below, horizon at radius 4). */
const skyPlane = (d) => [(d.x / (1 + d.y)) * 4, (d.z / (1 + d.y)) * 4];

// Shared shader helpers: value noise + fbm.
const NOISE = `
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
}
float fbm(vec2 p) { float v = 0.0; float a = 0.5; for (int i = 0; i < 4; i++) { v += a * noise(p); p *= 2.03; a *= 0.5; } return v; }
`;

// ---- the sky -----------------------------------------------------------------
B.Effect.ShadersStore.starrySkyVertexShader = `
precision highp float;
attribute vec3 position;
uniform mat4 worldViewProjection;
varying vec3 vDir;
void main() { vDir = position; gl_Position = worldViewProjection * vec4(position, 1.0); }`;

B.Effect.ShadersStore.starrySkyFragmentShader = `
precision highp float;
varying vec3 vDir;
uniform float time;
uniform vec4 stars[14];   // xyz = direction, w = size (radians)
uniform vec4 swirls[7];   // xy = centre in sky plane, z = twist, w = radius
uniform vec3 moonDir;
${NOISE}
vec2 twist(vec2 p, vec4 s, float t) {
  vec2 d = p - s.xy;
  float a = s.z * exp(-dot(d, d) / (s.w * s.w)) * (1.0 + 0.06 * sin(t * 0.4 + s.x));
  float sn = sin(a); float cs = cos(a);
  return s.xy + vec2(cs * d.x - sn * d.y, sn * d.x + cs * d.y);
}
void main() {
  vec3 d = normalize(vDir);
  float t = time;
  // Stereographic sky plane: zenith at the centre, horizon on a circle of radius 4.
  vec2 p = d.xz / (1.0 + max(d.y, -0.6)) * 4.0;
  vec2 q = p;
  for (int i = 0; i < 7; i++) q = twist(q, swirls[i], t);

  // Rows of short brush dabs running round the sky (circles about the zenith), bent by the
  // swirls and drifting slowly. Every dab gets its own blue, like individual strokes of paint.
  float n = fbm(q * 1.6 + vec2(t * 0.03, 0.0));
  float band = length(q) * 13.0 + n * 3.0 - t * 0.15;
  float row = floor(band);
  float f = fract(band);
  float ang = atan(q.y, q.x);
  float segPos = ang * 9.0 + hash(vec2(row, 3.1)) * 6.2831;
  float seg = floor(segPos);
  float segF = fract(segPos);
  float h1 = mix(hash(vec2(row, seg)), hash(vec2(row, seg + 1.0)), smoothstep(0.75, 1.0, segF));
  vec3 c0 = vec3(0.06, 0.12, 0.38);
  vec3 c1 = vec3(0.12, 0.27, 0.62);
  vec3 c2 = vec3(0.22, 0.42, 0.76);
  vec3 c3 = vec3(0.44, 0.63, 0.86);
  vec3 c4 = vec3(0.72, 0.85, 0.90);
  vec3 dabCol = h1 < 0.32 ? c1 : (h1 < 0.58 ? c2 : (h1 < 0.76 ? c0 : (h1 < 0.93 ? c3 : c4)));
  // Dark gaps between rows, and dab ends that taper into each other.
  float body = smoothstep(0.0, 0.2, f) * smoothstep(1.0, 0.78, f);
  body *= 0.7 + 0.3 * smoothstep(0.0, 0.12, segF) * smoothstep(1.0, 0.88, segF);
  float bristle = 0.86 + 0.14 * sin(f * 38.0 + ang * 5.0 + h1 * 6.0);
  vec3 col = mix(c0 * 0.75, dabCol * bristle, body);

  // The swirls are painted in paler, brighter dabs.
  float swirlGlow = 0.0;
  for (int i = 0; i < 7; i++) {
    vec2 dd = p - swirls[i].xy;
    swirlGlow += exp(-dot(dd, dd) / (swirls[i].w * swirls[i].w * 0.8));
  }
  col = mix(col, mix(c3, c4, h1) * bristle, clamp(swirlGlow, 0.0, 1.0) * 0.55 * body);

  // Low sky over the hills is lighter, greener.
  float low = smoothstep(0.32, 0.0, d.y);
  col = mix(col, vec3(0.40, 0.60, 0.68) * bristle, low * 0.5 * body);

  // Stars: white-gold cores with concentric, slowly pulsing halos of yellow strokes.
  for (int i = 0; i < 14; i++) {
    float ang = sqrt(max(0.0, 2.0 * (1.0 - dot(d, stars[i].xyz))));
    float sz = stars[i].w;
    float ring = 0.55 + 0.45 * sin(ang / sz * 9.0 - t * 0.9 + float(i));
    float halo = smoothstep(sz * 2.6, sz * 0.5, ang) * ring;
    col = mix(col, vec3(0.96, 0.86, 0.42), clamp(halo * 0.75, 0.0, 1.0));
    col = mix(col, vec3(1.0, 0.98, 0.86), smoothstep(sz * 0.5, sz * 0.15, ang));
  }

  // Crescent moon with a big orange-gold halo.
  float am = sqrt(max(0.0, 2.0 * (1.0 - dot(d, moonDir))));
  float ms = 0.07;
  vec3 bite = normalize(moonDir + vec3(-0.035, 0.02, 0.0));
  float ab = sqrt(max(0.0, 2.0 * (1.0 - dot(d, bite))));
  float disc = smoothstep(ms, ms * 0.85, am);
  float crescent = disc * smoothstep(ms * 0.7, ms * 0.95, ab);
  float mhalo = smoothstep(ms * 3.8, ms, am) * (0.6 + 0.4 * sin(am / ms * 5.0 - t * 0.6));
  col = mix(col, vec3(0.98, 0.72, 0.22), clamp(mhalo * 0.8, 0.0, 1.0));
  col = mix(col, vec3(0.99, 0.80, 0.32), disc * 0.55);
  col = mix(col, vec3(1.0, 0.92, 0.55), crescent);

  if (d.y < 0.0) col *= 0.6; // below the horizon (only glimpsed past the hills)
  gl_FragColor = vec4(col, 1.0);
}`;

// ---- land: hilltop, valley and mountains, in blue-green brush strokes -----------
B.Effect.ShadersStore.starryLandVertexShader = `
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

B.Effect.ShadersStore.starryLandFragmentShader = `
precision highp float;
varying vec3 vPos;
varying vec3 vNormal;
uniform vec3 moonDir;
${NOISE}
void main() {
  vec2 p = vPos.xz;
  float r = length(p);
  float far = smoothstep(35.0, 210.0, r);
  // Near the viewer: short diagonal grass strokes. Further out: strokes follow the hill contours.
  float diag = p.x * 0.9 + p.y * 0.45 + fbm(p * 0.18) * 5.0;
  float contour = vPos.y * 1.4 + r * 0.12 + fbm(p * 0.03) * 6.0;
  float coord = mix(diag, contour, smoothstep(12.0, 40.0, r));
  float stroke = 0.5 + 0.5 * sin(coord * 2.4);
  float dab = fbm(p * vec2(0.9, 0.35));
  vec3 dark = vec3(0.04, 0.09, 0.12);
  vec3 teal = vec3(0.10, 0.25, 0.28);
  vec3 olive = vec3(0.20, 0.30, 0.19);
  vec3 blue = vec3(0.14, 0.22, 0.44);
  vec3 bluePale = vec3(0.32, 0.45, 0.64);
  vec3 near = mix(dark, mix(teal, olive, dab), stroke);
  vec3 distant = mix(blue, bluePale, stroke * (0.4 + dab));
  vec3 col = mix(near, distant, far);
  float lit = 0.6 + 0.5 * max(dot(normalize(vNormal), normalize(moonDir + vec3(0.0, 0.8, 0.0))), 0.0);
  gl_FragColor = vec4(col * lit, 1.0);
}`;

// ---- the cypress: tongues of dark green flame, swaying -------------------------
B.Effect.ShadersStore.cypressVertexShader = `
precision highp float;
attribute vec3 position;
attribute vec2 uv;
uniform mat4 world;
uniform mat4 worldViewProjection;
uniform float time;
uniform float height;
varying vec2 vUV;
varying float vSide;
void main() {
  vec3 p = position;
  float k = p.y / height;
  // Flame tongues: the surface ripples around and up the trunk, and the tip sways.
  // (CreateLathe: uv.y runs around the trunk, uv.x up it.)
  float tongue = sin(uv.y * 6.2831 * 5.0 + p.y * 0.9 - time * 0.8) * 0.18 * (0.3 + k);
  p.xz *= 1.0 + tongue;
  p.x += sin(time * 0.55 + p.y * 0.12) * k * k * 0.9;
  p.z += cos(time * 0.4 + p.y * 0.1) * k * k * 0.5;
  vUV = uv;
  vSide = 0.5 + 0.5 * sin(uv.y * 6.2831);
  gl_Position = worldViewProjection * vec4(p, 1.0);
}`;

B.Effect.ShadersStore.cypressFragmentShader = `
precision highp float;
varying vec2 vUV;
varying float vSide;
uniform float time;
${NOISE}
void main() {
  // Long vertical, wavy flame strokes: coordinate around the trunk, wobbling with height.
  float around = vUV.y;
  float up = vUV.x;
  float coord = around * 26.0 + sin(up * 14.0 + around * 6.0) * 0.8 + fbm(vec2(around * 8.0, up * 3.0)) * 2.0;
  float stroke = 0.5 + 0.5 * sin(coord * 3.1416);
  float dab = fbm(vec2(around * 30.0, up * 12.0 - time * 0.05));
  vec3 black = vec3(0.02, 0.04, 0.03);
  vec3 green = vec3(0.08, 0.16, 0.09);
  vec3 olive = vec3(0.22, 0.25, 0.12);
  vec3 blue = vec3(0.08, 0.13, 0.24);
  vec3 col = mix(black, green, stroke);
  col = mix(col, olive, smoothstep(0.6, 0.95, dab) * 0.7);
  col = mix(col, blue, smoothstep(0.65, 1.0, 1.0 - dab) * 0.4);
  col *= 0.75 + 0.5 * vSide;
  gl_FragColor = vec4(col, 1.0);
}`;

const smooth = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Ground height: flat hilltop, a slope down to the valley, rolling hills, a ring of mountains. */
export function terrainHeight(x, z) {
  const r = Math.hypot(x, z - HILL_Z); // from the hilltop
  if (r <= PLATEAU) return 0;
  const r0 = Math.hypot(x, z); // from the world centre
  const a = Math.atan2(x, z);
  const drop = -24 * smooth(PLATEAU, PLATEAU + 30, r);
  const hills = (Math.sin(x * 0.035) + Math.sin(z * 0.05 + 1.3)) * 3 * smooth(PLATEAU + 6, PLATEAU + 45, r);
  const ripples = Math.sin(x * 0.11 + z * 0.07) * 0.8 * smooth(PLATEAU, PLATEAU + 10, r);
  const mountains = smooth(150, 235, r0) * (32 + 14 * Math.sin(a * 5) + 8 * Math.sin(a * 11 + 1));
  return drop + hills + ripples + mountains;
}

function shaderMat(scene, name, shader, uniforms, attributes = ['position']) {
  const mat = new B.ShaderMaterial(name, scene, shader, { attributes, uniforms: ['world', 'worldViewProjection', ...uniforms] });
  mat.backFaceCulling = false;
  return mat;
}

function buildSky(scene, root, start) {
  const sky = B.MeshBuilder.CreateSphere('starry-sky', { diameter: SKY_RADIUS * 2, segments: 48, sideOrientation: B.Mesh.BACKSIDE }, scene);
  const mat = shaderMat(scene, 'starry-sky-mat', 'starrySky', ['time', 'stars', 'swirls', 'moonDir']);
  // Star positions loosely follow the painting ahead of you, and carry on all the way round.
  const stars = [
    [-58, 30, 0.035], [-38, 49, 0.03], [-21, 39, 0.03], [-4, 58, 0.028], [13, 48, 0.03], [24, 33, 0.034],
    [52, 52, 0.03], [-75, 15, 0.03], [72, 21, 0.03], [104, 40, 0.035], [-112, 34, 0.033], [158, 46, 0.03],
    [-158, 30, 0.03], [134, 19, 0.028],
  ];
  mat.setArray4('stars', stars.flatMap(([az, el, size]) => [...dirFromAzEl(az, el).asArray(), size]));
  // Swirl centres (az, el, twist, radius in sky-plane units): the great double swirl ahead-left.
  const swirls = [
    [-12, 22, 3.0, 0.75], [9, 27, -2.4, 0.55], [-60, 41, 1.7, 0.5], [70, 45, -1.6, 0.5],
    [180, 34, 2.0, 0.7], [118, 24, 1.5, 0.6], [-128, 27, -1.7, 0.6],
  ];
  mat.setArray4('swirls', swirls.flatMap(([az, el, twist, rad]) => [...skyPlane(dirFromAzEl(az, el)), twist, rad]));
  const moon = dirFromAzEl(42, 28);
  mat.setVector3('moonDir', moon);
  mat.onBindObservable.add(() => mat.setFloat('time', (performance.now() - start) / 1000));
  sky.material = mat;
  sky.infiniteDistance = true;
  sky.isPickable = false;
  sky.parent = root;
  return moon;
}

function buildLand(scene, root, moon) {
  const land = B.MeshBuilder.CreateGround('starry-land', { width: 520, height: 520, subdivisions: 220, updatable: true }, scene);
  const pos = land.getVerticesData(B.VertexBuffer.PositionKind);
  for (let i = 0; i < pos.length; i += 3) pos[i + 1] = terrainHeight(pos[i], pos[i + 2]);
  land.updateVerticesData(B.VertexBuffer.PositionKind, pos);
  const normals = [];
  B.VertexData.ComputeNormals(pos, land.getIndices(), normals);
  land.updateVerticesData(B.VertexBuffer.NormalKind, normals);
  land.refreshBoundingInfo();
  const mat = shaderMat(scene, 'starry-land-mat', 'starryLand', ['moonDir'], ['position', 'normal']);
  mat.setVector3('moonDir', moon);
  land.material = mat;
  land.parent = root;
  return land;
}

function buildCypress(scene, root, start) {
  const cypress = new B.TransformNode('cypress', scene);
  cypress.parent = root;
  cypress.position.set(5.5, 0, 8); // left foreground, like the painting (+X is left facing -Z)
  const flame = (scale) =>
    [[0, 0], [1.5, 0.4], [1.9, 2], [1.85, 4], [1.65, 6.5], [1.4, 8.5], [1.1, 10.5], [0.8, 12.5], [0.5, 14.3], [0.22, 15.8], [0, 17.2]].map(
      ([r, y]) => new B.Vector3(r * scale, y * scale, 0),
    );
  const parts = [
    { scale: 1, x: 0, z: 0, tilt: 0 },
    { scale: 0.72, x: 0.9, z: 0.5, tilt: 0.06 },
    { scale: 0.62, x: -0.8, z: 0.4, tilt: -0.07 },
    { scale: 0.5, x: 0.2, z: -0.9, tilt: 0.04 },
  ];
  for (const [i, part] of parts.entries()) {
    const mesh = B.MeshBuilder.CreateLathe(`cypress-${i}`, { shape: flame(part.scale), tessellation: 28 }, scene);
    const mat = shaderMat(scene, `cypress-mat-${i}`, 'cypress', ['time', 'height'], ['position', 'uv']);
    mat.setFloat('height', 17.2 * part.scale);
    mat.onBindObservable.add(() => mat.setFloat('time', (performance.now() - start) / 1000 + i * 1.7));
    mesh.material = mat;
    mesh.parent = cypress;
    mesh.position.set(part.x, 0, part.z);
    mesh.rotation.z = part.tilt;
    mesh.isPickable = false;
    // The vertex shader bends the tip ~1 m: widen culling bounds so it never pops out of view.
    mesh.getBoundingInfo().boundingBox.reConstruct(new B.Vector3(-3, 0, -3), new B.Vector3(3, 18, 3));
  }
  return circle(5.5, 8, 2.1);
}

function buildVillage(scene, root) {
  const rand = (() => {
    let s = 1234;
    return () => ((s = (s * 16807) % 2147483647) / 2147483647);
  })();
  const walls = [];
  const roofs = [];
  const windows = [];
  const place = (mesh, x, z, rotY, lift) => {
    mesh.position.set(x, terrainHeight(x, z) + lift, z);
    mesh.rotation.y = rotY;
  };
  const house = (x, z, w, d, h, rotY) => {
    const body = B.MeshBuilder.CreateBox('house', { width: w, depth: d, height: h }, scene);
    place(body, x, z, rotY, h / 2 - 0.4);
    walls.push(body);
    const roof = B.MeshBuilder.CreateBox('roof', { width: w * 0.74, height: w * 0.74, depth: d + 0.4 }, scene);
    place(roof, x, z, rotY, h - 0.4);
    roof.rotation.z = Math.PI / 4;
    roofs.push(roof);
    // Warm lit windows on the side facing the hill (+Z).
    const count = 1 + Math.floor(rand() * 3);
    for (let k = 0; k < count; k++) {
      const win = B.MeshBuilder.CreateBox('window', { width: 0.7, height: 0.8, depth: 0.12 }, scene);
      const offset = (k - (count - 1) / 2) * (w / (count + 0.5));
      const local = new B.Vector3(offset, 0, d / 2 + 0.02);
      const rotated = B.Vector3.TransformCoordinates(local, B.Matrix.RotationY(rotY));
      win.position.set(x + rotated.x, terrainHeight(x, z) + h * 0.45, z + rotated.z);
      win.rotation.y = rotY;
      windows.push(win);
    }
  };
  // Houses scattered along the valley floor ahead of the hill.
  for (let i = 0; i < 30; i++) {
    const x = -55 + rand() * 110;
    const z = -48 - rand() * 55;
    house(x, z, 3 + rand() * 3, 3 + rand() * 2.5, 2.6 + rand() * 1.8, (rand() - 0.5) * 0.8);
  }
  // The church, with its tall spire rising above the rooftops.
  const cx = -8; // a little right of centre, as in the painting
  const cz = -70;
  const church = B.MeshBuilder.CreateBox('church', { width: 5, depth: 9, height: 7 }, scene);
  place(church, cx, cz, 0.1, 3.1);
  walls.push(church);
  const tower = B.MeshBuilder.CreateBox('church-tower', { width: 2.6, depth: 2.6, height: 10 }, scene);
  place(tower, cx, cz + 4.5, 0.1, 4.6);
  walls.push(tower);
  const spire = B.MeshBuilder.CreateCylinder('church-spire', { diameterTop: 0, diameterBottom: 2.8, height: 13, tessellation: 4 }, scene);
  place(spire, cx, cz + 4.5, 0.1 + Math.PI / 4, 9.6 + 6.5);
  roofs.push(spire);
  const churchRoof = B.MeshBuilder.CreateBox('church-roof', { width: 3.8, height: 3.8, depth: 9.4 }, scene);
  place(churchRoof, cx, cz, 0.1, 6.6);
  churchRoof.rotation.z = Math.PI / 4;
  roofs.push(churchRoof);

  const mat = (name, color, emissive) => {
    const m = new B.StandardMaterial(name, scene);
    m.diffuseColor = color;
    m.emissiveColor = emissive;
    m.specularColor = B.Color3.Black();
    return m;
  };
  const merged = [
    [walls, mat('village-walls', new B.Color3(0.2, 0.26, 0.4), new B.Color3(0.06, 0.08, 0.14))],
    [roofs, mat('village-roofs', new B.Color3(0.1, 0.13, 0.24), new B.Color3(0.03, 0.04, 0.09))],
    [windows, mat('village-windows', new B.Color3(1, 0.8, 0.35), new B.Color3(1, 0.78, 0.3))],
  ].map(([meshes, material]) => {
    const m = B.Mesh.MergeMeshes(meshes, true, true);
    m.material = material;
    m.parent = root;
    m.isPickable = false;
    return m;
  });
  return merged;
}

/**
 * Dark round shrubs along the sides and back of the hilltop (the edge of where you can walk).
 * The front stays open so nothing hides the view down to the village.
 */
function buildShrubs(scene, root) {
  const shrubs = [];
  for (let i = 0; i < 40; i++) {
    const a = (i / 40) * Math.PI * 2 + Math.sin(i * 7.3) * 0.04; // 0 = +Z (behind you), PI = ahead
    if (Math.abs(Math.cos(a) + 1) < 0.65) continue; // leave the forward-facing edge open
    const r = PLATEAU + 0.9 + Math.sin(i * 3.1) * 0.35;
    const s = B.MeshBuilder.CreateSphere('shrub', { diameter: 1.6 + (Math.sin(i * 5.7) + 1) * 0.6, segments: 8 }, scene);
    s.scaling.y = 0.7;
    s.position.set(Math.sin(a) * r, 0.35, HILL_Z + Math.cos(a) * r);
    shrubs.push(s);
  }
  const merged = B.Mesh.MergeMeshes(shrubs, true, true);
  const mat = new B.StandardMaterial('shrub-mat', scene);
  mat.diffuseColor = new B.Color3(0.05, 0.12, 0.1);
  mat.emissiveColor = new B.Color3(0.03, 0.07, 0.08);
  mat.specularColor = B.Color3.Black();
  merged.material = mat;
  merged.parent = root;
  merged.isPickable = false;
}

/** The framed window behind you that looks back into the room you came from. */
function buildReturnWindow(scene, root, returnTo) {
  const node = new B.TransformNode('return-window', scene);
  node.parent = root;
  node.position.set(0, 1.75, HILL_Z + 6.5);
  const w = 2.2;
  const h = 1.5;

  const view = B.MeshBuilder.CreatePlane('return-window-view', { width: w, height: h }, scene);
  view.parent = node;
  const viewMat = new B.StandardMaterial('return-window-mat', scene);
  viewMat.disableLighting = true;
  viewMat.emissiveColor = B.Color3.Black(); // added to the texture, so keep it black: show the view as-is
  viewMat.fogEnabled = false;
  view.material = viewMat;

  // Until we have a real snapshot of the room, show a soft painted impression of it.
  const placeholder = new B.DynamicTexture('return-window-placeholder', { width: 512, height: 350 }, scene, true);
  const ctx = placeholder.getContext();
  const g = ctx.createLinearGradient(0, 0, 0, 350);
  g.addColorStop(0, '#efe6dc');
  g.addColorStop(0.6, '#f4ede4');
  g.addColorStop(0.62, '#c9a67a');
  g.addColorStop(0.66, '#f2efe9');
  g.addColorStop(1, '#e4e1db');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 512, 350);
  ctx.fillStyle = '#5b4a3a';
  ctx.font = 'bold 34px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('The 3D Art Room', 256, 160);
  placeholder.update();
  viewMat.emissiveTexture = placeholder;

  // Walnut frame.
  const frameMat = new B.StandardMaterial('return-window-frame', scene);
  frameMat.diffuseColor = new B.Color3(0.22, 0.13, 0.07);
  frameMat.emissiveColor = new B.Color3(0.08, 0.05, 0.03);
  const bar = (bw, bh, x, y) => {
    const m = B.MeshBuilder.CreateBox('return-window-bar', { width: bw, height: bh, depth: 0.12 }, scene);
    m.parent = node;
    m.position.set(x, y, 0.03);
    m.material = frameMat;
    m.isPickable = false;
  };
  const t = 0.12;
  bar(w + 2 * t, t, 0, h / 2 + t / 2);
  bar(w + 2 * t, t, 0, -h / 2 - t / 2);
  bar(t, h, -w / 2 - t / 2, 0);
  bar(t, h, w / 2 + t / 2, 0);

  const shimmer = portalShimmer(scene, 'return-window-shimmer', w, h, new B.Color3(0.75, 0.85, 1));
  shimmer.mesh.parent = node;
  shimmer.mesh.position.z = -0.02;
  const meta = { portal: returnTo, fx: shimmer, label: 'the 3D Art Room' };
  view.metadata = meta;
  shimmer.mesh.metadata = meta;

  const label = canvasPlane(scene, { name: 'return-window-label', width: 2.6, height: 0.36, res: 768, billboard: true });
  label.mesh.parent = root;
  label.mesh.position.set(0, 3.0, HILL_Z + 6.5);
  label.draw((ctx2, lw, lh) => drawLabel(ctx2, lw, lh, '🖼️ Back to the 3D Art Room', { color: '#ffe8a8' }));

  return {
    setView(texture) {
      viewMat.emissiveTexture = texture ?? placeholder;
    },
  };
}

/**
 * Build the Starry Night room. Returns the usual room-prop handle plus `setWindowView(texture)`
 * so the window can show a snapshot of the room the player just left.
 */
export function createStarryNight(scene, { returnTo = '3d-art' } = {}) {
  const root = new B.TransformNode('starry-night', scene);
  const start = performance.now();
  const moon = buildSky(scene, root, start);
  const land = buildLand(scene, root, moon);
  const tree = buildCypress(scene, root, start);
  buildVillage(scene, root);
  buildShrubs(scene, root);
  const windowView = buildReturnWindow(scene, root, returnTo);

  const night = new B.Color3(0.04, 0.08, 0.24);
  let saved = null;
  const setEnabled = (on) => {
    root.setEnabled(on);
    if (on) {
      saved = { fog: scene.fogDensity };
      scene.fogDensity = 0; // the sky dome is the backdrop; no haze
      scene.clearColor = night.toColor4(1);
    } else if (saved) {
      scene.fogDensity = saved.fog;
      saved = null;
    }
  };
  setEnabled(false);

  return {
    colliders: [wall(0, HILL_Z, PLATEAU), tree, circle(0, HILL_Z + 6.5, 1.2)],
    floors: [land],
    setEnabled,
    setWindowView: (tex) => windowView.setView(tex),
  };
}
