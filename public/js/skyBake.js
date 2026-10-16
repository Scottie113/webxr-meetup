/* global BABYLON */
// Painted skies are procedural shaders that are costly per pixel, and a headset draws millions of
// pixels per eye every frame. Instead of running the sky shader for every pixel on screen, render
// it into a cube map now and then and show that cube map on a cheap textured dome. Static skies
// are drawn once; slowly animated ones are redrawn every few frames, only while their room is open.

const B = BABYLON;

// Look the sky up in the cube map by direction. Render-target cube faces come out upside down
// relative to a plain direction lookup, hence the flipped Y.
B.Effect.ShadersStore.bakedSkyVertexShader = `
precision highp float;
attribute vec3 position;
uniform mat4 worldViewProjection;
varying vec3 vDir;
void main() { vDir = position; gl_Position = worldViewProjection * vec4(position, 1.0); }`;

B.Effect.ShadersStore.bakedSkyFragmentShader = `
precision highp float;
varying vec3 vDir;
uniform samplerCube cube;
void main() { gl_FragColor = vec4(textureCube(cube, normalize(vDir) * vec3(1.0, -1.0, 1.0)).rgb, 1.0); }`;

/**
 * Replace `sky` (a procedural dome with infiniteDistance) by a baked copy.
 * `animated` skies refresh every `every` frames; others render once each time you enter the room.
 */
export function bakeSky(scene, sky, { animated = false, size = animated ? 768 : 1024, every = 20 } = {}) {
  const probe = new B.ReflectionProbe(`${sky.name}-bake`, size, scene, false);
  probe.position.setAll(0);
  probe.renderList.push(sky);
  const cube = probe.cubeTexture;
  cube.refreshRate = B.RenderTargetTexture.REFRESHRATE_RENDER_ONCE; // we render it on demand below
  // The procedural dome only draws into the cube map, never to the screen.
  sky.isVisible = false;
  cube.onBeforeRenderObservable.add(() => (sky.isVisible = true));
  cube.onAfterRenderObservable.add(() => (sky.isVisible = false));

  const shown = B.MeshBuilder.CreateSphere(`${sky.name}-baked`, { diameter: sky.getBoundingInfo().boundingSphere.radius * 2, segments: 24, sideOrientation: B.Mesh.BACKSIDE }, scene);
  const mat = new B.ShaderMaterial(`${sky.name}-baked-mat`, scene, 'bakedSky', { attributes: ['position'], uniforms: ['worldViewProjection'], samplers: ['cube'] });
  mat.setTexture('cube', cube);
  mat.backFaceCulling = false;
  shown.material = mat;
  shown.infiniteDistance = true;
  shown.isPickable = false;
  shown.parent = sky.parent;

  // Redraw on entering the room (and every few frames while there, if the sky moves). The scene
  // skips render targets whose meshes are all hidden, so render the cube map ourselves; wait
  // until the sky shader has compiled, or the bake would come out black.
  let wasOn = false;
  let pending = false;
  let frame = 0;
  scene.onBeforeRenderObservable.add(() => {
    const on = shown.isEnabled();
    if (on && (!wasOn || (animated && ++frame % every === 0))) pending = true;
    wasOn = on;
    if (on && pending && sky.isReady(true)) {
      cube.render();
      pending = false;
    }
  });
  return shown;
}
