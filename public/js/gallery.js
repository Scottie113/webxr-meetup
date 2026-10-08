/* global BABYLON */
import { wall } from './collision.js';
import { marbleTexture, plasterTextures, woodTexture } from './textures.js';

const B = BABYLON;

const RADIUS = 30; // room wall radius (the teleport booths sit at 14 m)
const WALL_HEIGHT = 10.4;
const CEILING_Y = 9.4; // the wave ceiling undulates about +-0.85 m around this height
const BORDER = 3.5; // width of the light-wood floor border around the marble
const WARM = new B.Color3(0.96, 0.93, 0.88);

// Gentle, slow, layered sine waves displaced on the GPU. Normals come from finite
// differences of the same height function, so the shading follows the motion.
B.Effect.ShadersStore.waveCeilingVertexShader = `
precision highp float;
attribute vec3 position;
uniform mat4 world;
uniform mat4 worldViewProjection;
uniform float time;
varying vec3 vWorld;
varying vec3 vNormal;
varying float vHeight;
varying vec2 vPlan;

// Wavelengths of roughly 7-15 m, so several soft rolling bands are visible at once.
float height(vec2 p, float t) {
  return 0.34 * sin(p.x * 0.55 + t * 0.55)
       + 0.26 * sin(p.y * 0.68 - t * 0.42)
       + 0.18 * sin((p.x + p.y) * 0.42 + t * 0.75)
       + 0.12 * sin(length(p) * 0.9 - t * 0.9);
}

void main() {
  vec2 p = position.xz;
  float h = height(p, time);
  float e = 0.4;
  float hx = height(p + vec2(e, 0.0), time) - height(p - vec2(e, 0.0), time);
  float hz = height(p + vec2(0.0, e), time) - height(p - vec2(0.0, e), time);
  vec3 n = normalize(vec3(-hx, 2.0 * e, -hz));
  vec3 displaced = vec3(position.x, h, position.z);
  vWorld = (world * vec4(displaced, 1.0)).xyz;
  vNormal = normalize(mat3(world) * n);
  vHeight = h;
  vPlan = p;
  gl_Position = worldViewProjection * vec4(displaced, 1.0);
}`;

B.Effect.ShadersStore.waveCeilingFragmentShader = `
precision highp float;
varying vec3 vWorld;
varying vec3 vNormal;
varying float vHeight;
varying vec2 vPlan;
uniform vec3 eye;
uniform float time;
uniform float radius;

void main() {
  if (length(vPlan) > radius) discard; // keep the square mesh inside the round room
  vec3 n = normalize(vNormal);
  vec3 v = normalize(eye - vWorld);
  if (dot(n, v) < 0.0) n = -n;

  // Soft light from the room below, a little fresnel sheen on the crests.
  // Low, raking light from below so each slope of a wave shades differently.
  vec3 toLight = normalize(vec3(-0.7, -0.55, -0.35));
  float lit = max(dot(n, toLight), 0.0);
  float sheen = pow(1.0 - max(dot(n, v), 0.0), 3.0);
  // Shaded slopes fall off to a soft lavender rather than grey, keeping the ceiling warm and airy.
  vec3 shade = mix(vec3(0.78, 0.76, 0.90), vec3(1.0), 0.25 + 0.75 * lit);
  // Troughs (hanging lowest, nearest the room) catch a little more light than the crests.
  float trough = 0.9 + 0.1 * smoothstep(0.9, -0.9, vHeight);

  // Pastel colours that drift slowly across the waves: warm white, blush, sky, mint.
  vec3 warm = vec3(0.99, 0.95, 0.89);
  vec3 blush = vec3(0.98, 0.82, 0.85);
  vec3 sky = vec3(0.78, 0.86, 0.99);
  vec3 mint = vec3(0.80, 0.95, 0.89);
  float a = 0.5 + 0.5 * sin(vHeight * 3.0 + time * 0.25 + vPlan.x * 0.04);
  float b = 0.5 + 0.5 * sin(vPlan.y * 0.05 - time * 0.18);
  vec3 col = mix(mix(warm, blush, a * 0.7), mix(sky, mint, b), 0.35 + 0.3 * b);

  col *= shade * trough;
  col += vec3(1.0, 0.98, 0.95) * sheen * 0.18;
  gl_FragColor = vec4(col, 1.0);
}`;

/**
 * The 3D Art Room's decor: warm white plaster walls, a polished marble floor framed by
 * light oak, oak skirting, and a softly moving 3D wave ceiling.
 */
export function createArtGallery(scene) {
  const root = new B.TransformNode('art-gallery', scene);

  // ---- floor: marble centre, oak border ----
  const oak = woodTexture(scene);
  const woodMat = new B.StandardMaterial('gallery-oak', scene);
  woodMat.diffuseTexture = oak;
  oak.uScale = oak.vScale = 10;
  woodMat.specularColor = new B.Color3(0.12, 0.1, 0.08);
  woodMat.specularPower = 48;
  const woodFloor = B.MeshBuilder.CreateDisc('gallery-wood-floor', { radius: RADIUS, tessellation: 128 }, scene);
  woodFloor.rotation.x = Math.PI / 2;
  woodFloor.position.y = 0.004;
  woodFloor.material = woodMat;

  const marble = marbleTexture(scene);
  marble.uScale = marble.vScale = 6;
  const marbleMat = new B.StandardMaterial('gallery-marble', scene);
  marbleMat.diffuseTexture = marble;
  marbleMat.specularColor = new B.Color3(0.45, 0.45, 0.45); // polished
  marbleMat.specularPower = 96;
  const marbleFloor = B.MeshBuilder.CreateDisc('gallery-marble-floor', { radius: RADIUS - BORDER, tessellation: 128 }, scene);
  marbleFloor.rotation.x = Math.PI / 2;
  marbleFloor.position.y = 0.008;
  marbleFloor.material = marbleMat;

  // Thin brass-coloured inlay where marble meets oak.
  const inlay = B.MeshBuilder.CreateTorus('gallery-inlay', { diameter: (RADIUS - BORDER) * 2, thickness: 0.06, tessellation: 128 }, scene);
  inlay.scaling.y = 0.15;
  inlay.position.y = 0.01;
  const inlayMat = new B.StandardMaterial('gallery-inlay-mat', scene);
  inlayMat.diffuseColor = new B.Color3(0.75, 0.6, 0.35);
  inlayMat.specularColor = new B.Color3(0.6, 0.5, 0.3);
  inlay.material = inlayMat;

  // ---- walls: warm white plaster with a subtle trowelled relief ----
  const plaster = plasterTextures(scene);
  const wallMat = new B.StandardMaterial('gallery-plaster', scene);
  wallMat.diffuseTexture = plaster.color;
  wallMat.bumpTexture = plaster.bump;
  for (const t of [plaster.color, plaster.bump]) {
    t.uScale = 24;
    t.vScale = 2;
  }
  wallMat.specularColor = new B.Color3(0.05, 0.05, 0.05);
  wallMat.emissiveColor = new B.Color3(0.2, 0.19, 0.17); // plaster bounces light: never goes grey
  const walls = B.MeshBuilder.CreateCylinder(
    'gallery-walls',
    { diameter: RADIUS * 2, height: WALL_HEIGHT, tessellation: 128, cap: B.Mesh.NO_CAP, sideOrientation: B.Mesh.BACKSIDE },
    scene,
  );
  walls.position.y = WALL_HEIGHT / 2;
  walls.material = wallMat;

  // Oak skirting board around the base of the wall.
  const skirting = B.MeshBuilder.CreateCylinder(
    'gallery-skirting',
    { diameter: RADIUS * 2 - 0.06, height: 0.22, tessellation: 128, cap: B.Mesh.NO_CAP, sideOrientation: B.Mesh.BACKSIDE },
    scene,
  );
  skirting.position.y = 0.11;
  skirting.material = woodMat;

  // ---- ceiling: animated 3D waves ----
  const ceiling = B.MeshBuilder.CreateGround('gallery-waves', { width: RADIUS * 2, height: RADIUS * 2, subdivisions: 160 }, scene);
  ceiling.position.y = CEILING_Y;
  const waveMat = new B.ShaderMaterial('gallery-wave-mat', scene, 'waveCeiling', {
    attributes: ['position'],
    uniforms: ['world', 'worldViewProjection', 'time', 'eye', 'radius'],
  });
  waveMat.backFaceCulling = false;
  waveMat.setFloat('radius', RADIUS);
  ceiling.material = waveMat;
  // The vertex shader moves vertices up to ~0.9 m, so widen the culling bounds to match.
  ceiling.refreshBoundingInfo();
  ceiling.getBoundingInfo().boundingBox.reConstruct(new B.Vector3(-RADIUS, -1, -RADIUS), new B.Vector3(RADIUS, 1, RADIUS));
  const start = performance.now();
  waveMat.onBindObservable.add(() => {
    waveMat.setFloat('time', (performance.now() - start) / 1000);
    waveMat.setVector3('eye', scene.activeCamera.globalPosition);
  });

  for (const m of [woodFloor, marbleFloor, inlay, walls, skirting, ceiling]) {
    m.parent = root;
    m.isPickable = false;
  }

  // Warm room lighting: a soft central light that washes the plaster and floors (and nothing
  // else, so avatars and booths keep their usual look).
  const roomLight = new B.PointLight('gallery-light', new B.Vector3(0, 7.5, 0), scene);
  roomLight.diffuse = new B.Color3(1, 0.94, 0.85);
  roomLight.specular = new B.Color3(0.5, 0.47, 0.42);
  roomLight.intensity = 0.85;
  roomLight.range = 60;
  roomLight.includedOnlyMeshes = [woodFloor, marbleFloor, inlay, walls, skirting];
  roomLight.parent = root;

  let savedFog = null;
  const setEnabled = (on) => {
    root.setEnabled(on);
    if (on) {
      // Indoors: warm white air instead of the tinted sky, and less haze so the far wall stays crisp.
      savedFog = scene.fogDensity;
      scene.fogDensity = 0.004;
      scene.fogColor = WARM.clone();
      scene.clearColor = WARM.toColor4(1);
    } else if (savedFog !== null) {
      scene.fogDensity = savedFog; // the next room's setRoom() restores its own colours
      savedFog = null;
    }
  };
  setEnabled(false);
  return { colliders: [wall(0, 0, RADIUS)], setEnabled };
}
