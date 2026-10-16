/* global BABYLON */
// CPU savers for the painting rooms, whose scenery never moves once it's built.

const B = BABYLON;

/**
 * Freeze everything static under `root`: world matrices (no per-frame transform maths) and
 * standard / PBR materials (no per-frame readiness and shader-define checks). Call it once the
 * room's models have loaded and their materials are final. Skips skies (they follow the camera),
 * billboards, the window home (its view texture is swapped in later) and shader materials
 * (their uniforms animate).
 */
export function freezeStatic(root) {
  for (const mesh of root.getChildMeshes()) {
    if (mesh.infiniteDistance || mesh.billboardMode || /window/.test(mesh.name)) continue;
    mesh.freezeWorldMatrix();
    mesh.doNotSyncBoundingInfo = true;
    const mat = mesh.material;
    if (mat && !(mat instanceof B.ShaderMaterial) && !mat.isFrozen && !/window/.test(mat.name)) mat.freeze();
  }
}
