/* global BABYLON */
// Painting portals: the shimmer that makes a painting/window read as a doorway, the gold beam
// VR controllers show while aiming at one, the fade used when travelling, and the snapshot that
// lets the window inside a painting show the room you came from.

const B = BABYLON;

B.Effect.ShadersStore.portalShimmerVertexShader = `
precision highp float;
attribute vec3 position;
attribute vec2 uv;
uniform mat4 worldViewProjection;
varying vec2 vUV;
void main() {
  vUV = uv;
  gl_Position = worldViewProjection * vec4(position, 1.0);
}`;

B.Effect.ShadersStore.portalShimmerFragmentShader = `
precision highp float;
varying vec2 vUV;
uniform float time;
uniform float intensity;
uniform vec3 tint;
uniform float aspect;
void main() {
  vec2 c = vUV - 0.5;
  c.x *= aspect;
  float r = length(c);
  float a = atan(c.y, c.x);
  float swirl = 0.5 + 0.5 * sin(a * 3.0 + r * 16.0 - time * 1.4);
  float ripple = 0.5 + 0.5 * sin(r * 34.0 - time * 2.6);
  float edgeDist = min(min(vUV.x, 1.0 - vUV.x), min(vUV.y, 1.0 - vUV.y));
  float inner = smoothstep(0.0, 0.12, edgeDist);
  float rim = 1.0 - smoothstep(0.0, 0.05, edgeDist);
  float glow = (0.3 * swirl * swirl + 0.18 * ripple) * inner;
  vec3 col = tint * (glow + rim * 0.9);
  gl_FragColor = vec4(col * intensity, 1.0);
}`;

/**
 * A softly swirling, additive overlay that sits just in front of a portal surface.
 * Idle it barely shows; `setActive(true)` (hovered / aimed at) makes it glow.
 */
export function portalShimmer(scene, name, width, height, tint = new B.Color3(1, 0.86, 0.5)) {
  const mesh = B.MeshBuilder.CreatePlane(name, { width, height }, scene);
  const mat = new B.ShaderMaterial(`${name}-mat`, scene, 'portalShimmer', {
    attributes: ['position', 'uv'],
    uniforms: ['worldViewProjection', 'time', 'intensity', 'tint', 'aspect'],
    needAlphaBlending: true,
  });
  mat.alphaMode = B.Engine.ALPHA_ADD;
  mat.backFaceCulling = false;
  mat.disableDepthWrite = true;
  mat.setColor3('tint', tint);
  mat.setFloat('aspect', width / height);
  mesh.material = mat;
  let target = 0.25;
  let current = 0.25;
  const start = performance.now();
  mat.onBindObservable.add(() => {
    current += (target - current) * 0.12;
    mat.setFloat('time', (performance.now() - start) / 1000);
    mat.setFloat('intensity', current);
  });
  return {
    mesh,
    setActive(on) {
      target = on ? 0.75 : 0.25; // bright enough to read as "aimed at", without washing out the art
    },
  };
}

/** A thin glowing beam from a controller to the spot it's aiming at on a portal. */
export function createAimBeam(scene, name) {
  const beam = B.MeshBuilder.CreateCylinder(name, { height: 1, diameter: 0.008, tessellation: 8 }, scene);
  // Re-shape so the beam runs from the origin along +Z: then lookAt() + scaling.z aim it.
  beam.bakeTransformIntoVertices(B.Matrix.Translation(0, 0.5, 0).multiply(B.Matrix.RotationX(Math.PI / 2)));
  const mat = new B.StandardMaterial(`${name}-mat`, scene);
  mat.emissiveColor = new B.Color3(1, 0.82, 0.35);
  mat.disableLighting = true;
  beam.material = mat;
  beam.isPickable = false;
  const dot = B.MeshBuilder.CreateSphere(`${name}-dot`, { diameter: 0.07, segments: 8 }, scene);
  dot.material = mat;
  dot.isPickable = false;
  const hide = () => {
    beam.setEnabled(false);
    dot.setEnabled(false);
  };
  hide();
  return {
    show(from, to) {
      beam.setEnabled(true);
      dot.setEnabled(true);
      beam.position.copyFrom(from);
      beam.scaling.z = B.Vector3.Distance(from, to);
      beam.lookAt(to);
      dot.position.copyFrom(to);
    },
    hide,
  };
}

/** Fades the view to deep blue and back, by wrapping the active camera in a sphere. */
export function createFader(scene) {
  const sphere = B.MeshBuilder.CreateSphere('portal-fade', { diameter: 0.6, segments: 12, sideOrientation: B.Mesh.BACKSIDE }, scene);
  const mat = new B.StandardMaterial('portal-fade-mat', scene);
  mat.emissiveColor = new B.Color3(0.05, 0.09, 0.28);
  mat.disableLighting = true;
  mat.alpha = 0;
  mat.fogEnabled = false;
  sphere.material = mat;
  sphere.isPickable = false;
  sphere.renderingGroupId = 3; // drawn last, over everything
  scene.setRenderingAutoClearDepthStencil(3, true);
  sphere.setEnabled(false);

  const animate = (to, ms) =>
    new Promise((resolve) => {
      sphere.parent = scene.activeCamera;
      sphere.position.setAll(0);
      sphere.setEnabled(true);
      const from = mat.alpha;
      const start = performance.now();
      const obs = scene.onBeforeRenderObservable.add(() => {
        const k = Math.min(1, (performance.now() - start) / ms);
        mat.alpha = from + (to - from) * k;
        if (k >= 1) {
          scene.onBeforeRenderObservable.remove(obs);
          if (to === 0) sphere.setEnabled(false);
          resolve();
        }
      });
      // If frames aren't being drawn (hidden tab), don't leave the caller waiting forever.
      setTimeout(() => {
        mat.alpha = to;
        if (to === 0) sphere.setEnabled(false);
        resolve();
      }, ms + 400);
    });
  return { fadeOut: (ms = 450) => animate(1, ms), fadeIn: (ms = 700) => animate(0, ms) };
}

/**
 * Render the scene once from a viewpoint and freeze it into a plain texture (the view through a
 * portal window). The pixels are copied out so later frames can't redraw it.
 */
export async function captureView(scene, position, target, width = 1024, height = 700) {
  const cam = new B.FreeCamera('portal-snapshot-cam', position.clone(), scene);
  cam.setTarget(target);
  cam.fov = 1.0;
  cam.minZ = 0.1;
  const rtt = new B.RenderTargetTexture('portal-window-capture', { width, height }, scene, false);
  rtt.activeCamera = cam;
  rtt.renderList = scene.meshes.filter((m) => m.isEnabled() && m.isVisible && m.name !== 'portal-fade');
  rtt.render();
  const pixels = await rtt.readPixels();
  rtt.dispose();
  cam.dispose();
  const tex = B.RawTexture.CreateRGBATexture(pixels, width, height, scene, false, false);
  tex.name = 'portal-window-view';
  return tex;
}
