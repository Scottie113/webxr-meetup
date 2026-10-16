/* global BABYLON */
// Klimt's "The Kiss" as a place: you stand on the painting's flower meadow, a dark green carpet
// dense with blossoms that ends in a cliff edge hung with golden tendrils. The embracing couple
// (modelled characters from the models repo) kneel near the edge, and all around is a shimmering
// void of gold leaf: flakes that glint as you move, faint spirals and speckles, and loose flecks
// of gold drifting in the air. Shaders and textures are procedural.
import { wall, circle } from './collision.js';
import { NOISE, shaderMat, buildReturnWindow } from './starryNight.js';
import { loadModel, roomReflections, applyReflections } from './props.js';
import { bakeSky } from './skyBake.js';

const B = BABYLON;

const MODELS_REPO = 'https://raw.githubusercontent.com/Scottie113/Models-for-Meetup-room/main/';
const MEADOW = { x: 0, z: 8, r: 9.5, depth: 1.4 }; // players arrive at z ~8.5; the cliff edge is ahead
const COUPLE = { x: 0.1, z: 1.4 }; // near the edge; their faces turn toward you (+Z) as modelled

// ---- the gold-leaf void ------------------------------------------------------------------------
B.Effect.ShadersStore.goldLeafVertexShader = `
precision highp float;
attribute vec3 position;
uniform mat4 worldViewProjection;
varying vec3 vDir;
void main() { vDir = position; gl_Position = worldViewProjection * vec4(position, 1.0); }`;

B.Effect.ShadersStore.goldLeafFragmentShader = `
precision highp float;
varying vec3 vDir;
uniform float time;
uniform vec3 eyeDir;
${NOISE}
void main() {
  vec3 d = normalize(vDir);
  // Square-ish gold leaf flakes laid in slightly irregular rows over the whole dome.
  vec2 uv = vec2(atan(d.x, -d.z) * 58.0, asin(clamp(d.y, -1.0, 1.0)) * 58.0);
  uv.x += hash(vec2(floor(uv.y), 5.0)) * 0.5;
  vec2 id = floor(uv);
  vec2 f = fract(uv);
  float h = hash(id);
  float h2 = hash(id + 17.0);
  // Each flake has its own tone and catches the light at its own moment, so the gold glints.
  vec3 deepGold = vec3(0.68, 0.50, 0.18);
  vec3 gold = vec3(0.82, 0.63, 0.26);
  vec3 bright = vec3(1.0, 0.86, 0.48);
  vec3 col = mix(deepGold, gold, h);
  float glint = pow(max(0.0, sin(time * 0.6 + h2 * 6.2831 + dot(d, eyeDir) * 4.0)), 18.0);
  col = mix(col, bright, glint * 0.8);
  // Thin darker seams between flakes and crinkles in the leaf.
  float seam = smoothstep(0.0, 0.06, f.x) * smoothstep(1.0, 0.94, f.x) * smoothstep(0.0, 0.06, f.y) * smoothstep(1.0, 0.94, f.y);
  col *= 0.9 + 0.1 * seam;
  // Broad, gentle variation across the leaf (burnished and duller areas).
  col *= 0.88 + 0.24 * fbm(uv * 0.08);
  // Klimt's scattered speckles: tiny dark and bright flecks.
  float speck = hash(floor(uv * 6.0));
  col = mix(col, vec3(0.22, 0.14, 0.06), step(0.985, speck) * 0.8);
  col = mix(col, bright * 1.1, step(0.992, hash(floor(uv * 6.0) + 3.0)));
  // Faint golden spirals drifting in the leaf.
  vec2 sp = vec2(atan(d.x, -d.z), d.y) * 3.0;
  vec2 cell = fract(sp) - 0.5;
  float r = length(cell);
  float spiral = smoothstep(0.03, 0.0, abs(fract(r * 9.0 - atan(cell.y, cell.x) / 6.2831 - time * 0.02) - 0.5) - 0.42) * smoothstep(0.45, 0.2, r);
  col = mix(col, bright, spiral * 0.18 * step(0.6, hash(floor(sp))));
  gl_FragColor = vec4(col, 1.0);
}`;

// ---- the flower meadow ---------------------------------------------------------------------------
B.Effect.ShadersStore.klimtMeadowVertexShader = `
precision highp float;
attribute vec3 position;
uniform mat4 world;
uniform mat4 worldViewProjection;
varying vec3 vPos;
void main() {
  vPos = (world * vec4(position, 1.0)).xyz;
  gl_Position = worldViewProjection * vec4(position, 1.0);
}`;

B.Effect.ShadersStore.klimtMeadowFragmentShader = `
precision highp float;
varying vec3 vPos;
uniform float time;
${NOISE}
void main() {
  vec2 p = vPos.xz;
  // Dark green ground with mossy variation.
  vec3 col = mix(vec3(0.05, 0.16, 0.09), vec3(0.12, 0.27, 0.13), fbm(p * 0.9));
  // Leafy strokes.
  float leaf = smoothstep(0.62, 0.8, fbm(vec2(p.x * 3.0 + p.y, p.y * 6.0)));
  col = mix(col, vec3(0.22, 0.42, 0.18), leaf * 0.6);
  // Dense round blossoms on a jittered grid, each a ring of colour around a bright centre.
  vec2 g = p * 3.2;
  vec2 id = floor(g);
  vec2 f = fract(g) - 0.5;
  float h = hash(id);
  vec2 off = vec2(hash(id + 3.1), hash(id + 7.7)) - 0.5;
  float d = length(f - off * 0.5);
  float size = 0.12 + 0.16 * hash(id + 1.3);
  vec3 petal = h < 0.25 ? vec3(0.22, 0.32, 0.78) : (h < 0.45 ? vec3(0.82, 0.22, 0.2) : (h < 0.62 ? vec3(0.62, 0.32, 0.72) : (h < 0.8 ? vec3(0.95, 0.92, 0.85) : vec3(0.96, 0.62, 0.72))));
  float flower = smoothstep(size, size * 0.8, d) * step(0.18, hash(id + 9.0));
  col = mix(col, petal, flower);
  col = mix(col, vec3(1.0, 0.82, 0.3), smoothstep(size * 0.35, size * 0.2, d) * flower);
  // Specks of gold in the grass.
  col = mix(col, vec3(0.95, 0.75, 0.3), step(0.993, hash(floor(p * 18.0))));
  gl_FragColor = vec4(col, 1.0);
}`;

function buildVoid(scene, root, start) {
  const dome = B.MeshBuilder.CreateSphere('gold-void', { diameter: 400, segments: 40, sideOrientation: B.Mesh.BACKSIDE }, scene);
  const mat = shaderMat(scene, 'gold-void-mat', 'goldLeaf', ['time', 'eyeDir']);
  mat.onBindObservable.add(() => {
    mat.setFloat('time', (performance.now() - start) / 1000);
    mat.setVector3('eyeDir', scene.activeCamera.getDirection(B.Axis.Z));
  });
  dome.material = mat;
  dome.infiniteDistance = true;
  dome.isPickable = false;
  dome.parent = root;
  bakeSky(scene, dome, { animated: true }); // drawn into a cube map, not per pixel every frame
}

function buildMeadow(scene, root, start) {
  const meadow = B.MeshBuilder.CreateCylinder('klimt-meadow', { diameter: MEADOW.r * 2, height: MEADOW.depth, tessellation: 72 }, scene);
  meadow.position.set(MEADOW.x, -MEADOW.depth / 2, MEADOW.z);
  const mat = shaderMat(scene, 'klimt-meadow-mat', 'klimtMeadow', ['time']);
  mat.onBindObservable.add(() => mat.setFloat('time', (performance.now() - start) / 1000));
  meadow.material = mat;
  meadow.parent = root;

  // Golden tendrils hanging over the edge of the meadow, like the cliff in the painting.
  const vineMat = new B.StandardMaterial('klimt-vine', scene);
  vineMat.diffuseColor = new B.Color3(0.75, 0.6, 0.22);
  vineMat.emissiveColor = new B.Color3(0.35, 0.26, 0.08);
  vineMat.specularColor = new B.Color3(0.6, 0.5, 0.3);
  const vines = [];
  for (let i = 0; i < 70; i++) {
    const a = Math.PI + (i / 70 - 0.5) * 2.6 + Math.sin(i * 12.9) * 0.03; // the forward half of the rim
    // Start just outside the rim (the meadow is a thick slab) and curl outward as they fall.
    const x = MEADOW.x + Math.sin(a) * (MEADOW.r + 0.04);
    const z = MEADOW.z + Math.cos(a) * (MEADOW.r + 0.04);
    const len = 1.6 + (Math.sin(i * 7.7) + 1) * 1.8;
    const sway = Math.sin(i * 3.3) * 0.35;
    const path = Array.from({ length: 8 }, (_, k) => {
      const t = k / 7;
      const out = 0.1 + 0.45 * Math.sin(t * Math.PI * 0.9); // bows outward over the edge
      return new B.Vector3(x + Math.sin(a) * out + sway * t * t, 0.02 - len * t, z + Math.cos(a) * out);
    });
    vines.push(B.MeshBuilder.CreateTube('klimt-vine', { path, radius: 0.025 + 0.015 * Math.abs(Math.sin(i)), tessellation: 5 }, scene));
    // A few blossoms dangling on the tendrils.
    if (i % 3 === 0) {
      const bloom = B.MeshBuilder.CreateSphere('klimt-vine-bloom', { diameter: 0.14, segments: 6 }, scene);
      bloom.position.copyFrom(path[7]);
      vines.push(bloom);
    }
  }
  const merged = B.Mesh.MergeMeshes(vines, true, true);
  merged.material = vineMat;
  merged.isPickable = false;
  merged.parent = root;
  return meadow;
}

/** Thin-instanced 3D blossoms scattered on the meadow, so the flowers have depth up close. */
function buildBlossoms(scene, root) {
  const colours = [
    [0.25, 0.35, 0.82],
    [0.85, 0.25, 0.22],
    [0.65, 0.35, 0.75],
    [0.97, 0.95, 0.9],
    [0.98, 0.65, 0.75],
  ];
  let seed = 31;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (const [i, c] of colours.entries()) {
    const bloom = B.MeshBuilder.CreateCylinder(`klimt-blossom-${i}`, { diameterTop: 0.1, diameterBottom: 0.035, height: 0.045, tessellation: 12 }, scene);
    const m = new B.StandardMaterial(`klimt-blossom-mat-${i}`, scene);
    m.diffuseColor = new B.Color3(...c);
    m.emissiveColor = new B.Color3(...c).scale(0.35);
    bloom.material = m;
    bloom.isPickable = false;
    bloom.parent = root;
    const mats = [];
    for (let k = 0; k < 90; k++) {
      const a = rand() * Math.PI * 2;
      const r = Math.sqrt(rand()) * (MEADOW.r - 0.4);
      const x = MEADOW.x + Math.sin(a) * r;
      const z = MEADOW.z + Math.cos(a) * r;
      const s = 0.7 + rand() * 0.8;
      mats.push(B.Matrix.Compose(new B.Vector3(s, s, s), B.Quaternion.FromEulerAngles(0, rand() * 6, 0), new B.Vector3(x, 0.04, z)));
    }
    const buf = new Float32Array(mats.length * 16);
    mats.forEach((mx, j) => mx.copyToArray(buf, j * 16));
    bloom.thinInstanceSetBuffer('matrix', buf, 16, true);
  }
}

/** Loose flecks of gold leaf drifting slowly through the air. */
function buildFlecks(scene, root) {
  const tex = new B.DynamicTexture('gold-fleck', 32, scene, false);
  const ctx = tex.getContext();
  ctx.clearRect(0, 0, 32, 32);
  ctx.fillStyle = '#ffd77a';
  ctx.fillRect(9, 9, 14, 14);
  tex.update();
  tex.hasAlpha = true;
  const ps = new B.ParticleSystem('gold-flecks', 600, scene);
  ps.particleTexture = tex;
  ps.emitter = new B.Vector3(MEADOW.x, 0, MEADOW.z - 2);
  ps.minEmitBox = new B.Vector3(-16, -6, -16);
  ps.maxEmitBox = new B.Vector3(16, 7, 14);
  ps.color1 = new B.Color4(1, 0.85, 0.45, 0.9);
  ps.color2 = new B.Color4(0.9, 0.65, 0.25, 0.8);
  ps.colorDead = new B.Color4(0.8, 0.6, 0.2, 0);
  ps.minSize = 0.03;
  ps.maxSize = 0.09;
  ps.minLifeTime = 8;
  ps.maxLifeTime = 16;
  ps.emitRate = 40;
  ps.direction1 = new B.Vector3(-0.1, 0.05, -0.1);
  ps.direction2 = new B.Vector3(0.1, 0.18, 0.1);
  ps.minEmitPower = 0.05;
  ps.maxEmitPower = 0.2;
  ps.minAngularSpeed = -1.2;
  ps.maxAngularSpeed = 1.2;
  ps.blendMode = B.ParticleSystem.BLENDMODE_ADD;
  ps.preWarmCycles = 200;
  ps.preWarmStepOffset = 5;
  return ps;
}

/** The embracing couple, from the models repo (both figures in one file, shared coordinates). */
async function buildCouple(scene, root) {
  const anchor = new B.TransformNode('klimt-couple', scene);
  anchor.parent = root;
  anchor.position.set(COUPLE.x, 0, COUPLE.z);
  const parts = await loadModel(scene, `${MODELS_REPO}klimt-couple/klimt-couple-posed.glb`, anchor);
  for (const p of parts) p.isPickable = false;
  // Gold robes need something golden to reflect: capture the gold-leaf room around them.
  const reflections = roomReflections(scene, new B.Vector3(COUPLE.x, 1.0, COUPLE.z + 1.2), new Set(parts));
  applyReflections(parts, reflections);
  return reflections;
}

/**
 * Build the Kiss room. Same handle shape as the other room props, plus `setWindowView` for the
 * window back to the room you came from.
 */
export function createKlimtRoom(scene, { returnTo = '3d-art' } = {}) {
  const root = new B.TransformNode('klimt-room', scene);
  const start = performance.now();
  buildVoid(scene, root, start);
  const meadow = buildMeadow(scene, root, start);
  buildBlossoms(scene, root);
  const flecks = buildFlecks(scene, root);
  const couple = buildCouple(scene, root).catch((err) => {
    console.warn('Could not load the Klimt couple from the models repo', err);
    return null;
  });
  const windowZ = MEADOW.z + MEADOW.r - 2.2;
  const windowView = buildReturnWindow(scene, root, returnTo, windowZ, 'klimt-window');

  // A warm golden key light on the couple.
  const glow = new B.PointLight('klimt-glow', new B.Vector3(COUPLE.x + 1.5, 3, COUPLE.z + 2.5), scene);
  glow.diffuse = new B.Color3(1, 0.85, 0.55);
  glow.intensity = 0.9;
  glow.range = 14;
  glow.parent = root;

  let saved = null;
  const setEnabled = (on) => {
    root.setEnabled(on);
    const hemi = scene.getLightByName('hemi');
    if (on) {
      saved = { fog: scene.fogDensity, hemiDiffuse: hemi?.diffuse.clone(), hemiGround: hemi?.groundColor.clone() };
      scene.fogDensity = 0;
      scene.clearColor = new B.Color4(0.7, 0.53, 0.2, 1);
      if (hemi) {
        hemi.diffuse = new B.Color3(1, 0.9, 0.7); // golden ambient light
        hemi.groundColor = new B.Color3(0.45, 0.33, 0.12);
      }
      flecks.start();
      couple.then((r) => r?.capture());
    } else {
      flecks.stop();
      flecks.reset(); // no stray gold flecks drifting into the next room
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

  meadow.isPickable = true; // VR teleport target
  return {
    colliders: [wall(MEADOW.x, MEADOW.z, MEADOW.r - 0.5), circle(COUPLE.x - 0.1, COUPLE.z, 0.85), circle(0, windowZ, 1.2)],
    floors: [meadow],
    root, // lets the world freeze the static scenery once it has loaded
    ready: couple,
    setEnabled,
    setWindowView: (tex) => windowView.setView(tex),
  };
}
