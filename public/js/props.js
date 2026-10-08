/* global BABYLON */
import { box } from './collision.js';

const B = BABYLON;

// The piano model spans local z -2.3 (tail) .. 1.1 (bench), so its footprint is centred 0.6 behind the origin.
const CENTRE_Z_OFFSET = 0.6;

/**
 * Room decorations loaded from glTF models in /models.
 * Models come from https://github.com/Scottie113/Models-for-Meetup-room.
 */

/**
 * The model's PBR materials (ebony lacquer, ivory/black keys, brass, gold frame, felt,
 * spruce) only look right with something to reflect. Capture the surrounding room into a
 * cube map once and use it as their environment, so the piano looks like the Blender
 * render without needing an internet-hosted HDR file.
 */
export function roomReflections(scene, position, excluded) {
  const probe = new B.ReflectionProbe('prop-env', 256, scene, true, true);
  probe.position.copyFrom(position);
  probe.refreshRate = B.RenderTargetTexture.REFRESHRATE_RENDER_ONCE;
  const capture = () => {
    probe.renderList.length = 0;
    probe.renderList.push(...scene.meshes.filter((m) => !excluded.has(m) && m.isEnabled() && m.isVisible));
    probe.cubeTexture.resetRefreshCounter();
  };
  return { texture: probe.cubeTexture, capture };
}

/**
 * Collapse a loaded model into a few meshes (267 parts -> about one per material), which
 * matters for frame rate on standalone headsets. Babylon can only merge meshes whose vertex
 * data has the same attributes (e.g. all with UVs), so group by material + attribute set.
 */
function mergeByMaterial(meshes) {
  const groups = new Map();
  for (const mesh of meshes) {
    if (!mesh.material || !mesh.getTotalVertices()) continue;
    const key = `${mesh.material.uniqueId}|${mesh.getVerticesDataKinds().sort().join(',')}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(mesh);
  }
  // MergeMeshes returns null if a group can't be merged; keep the original parts in that case.
  return [...groups.values()].flatMap((group) => (group.length === 1 ? group : (B.Mesh.MergeMeshes(group, true, true) ?? group)));
}

/**
 * Load a glTF model, merge its parts and hang them off `parent`. Returns the merged meshes.
 * `file` is a name in /models, or a full https:// URL (e.g. straight from the models repo).
 * Loading happens unparented at the origin, so merged meshes hold the model's geometry
 * (glTF transforms baked in) in model space, ready to attach as-is.
 */
export async function loadModel(scene, file, parent) {
  const slash = file.lastIndexOf('/');
  const [base, name] = file.startsWith('http') ? [file.slice(0, slash + 1), file.slice(slash + 1)] : ['/models/', file];
  const result = await B.SceneLoader.ImportMeshAsync('', base, name, scene);
  const root = result.meshes[0]; // glTF "__root__": converts the file to Babylon's handedness
  const parts = mergeByMaterial(result.meshes.filter((m) => m !== root));
  // Any part that couldn't be merged still sits under __root__, so move the whole root too.
  root.parent = parent;
  for (const part of parts) if (part.parent !== root) part.parent = parent;
  return parts;
}

/** Point a model's PBR materials at a reflection capture (see roomReflections). */
export function applyReflections(parts, reflections) {
  for (const mat of new Set(parts.map((p) => p.material).filter(Boolean))) {
    mat.reflectionTexture = reflections.texture;
    mat.realTimeFiltering = true; // blur reflections by each material's roughness
  }
}

/**
 * Grand piano on a small stage rug. Returns a handle the world uses to show/hide it per room.
 * `rotationY` follows Babylon's convention; the model's keyboard faces local +Z and its
 * lid opens toward local -X.
 */
export async function loadGrandPiano(scene, { position, rotationY = 0 }) {
  const anchor = new B.TransformNode('grand-piano', scene);
  anchor.position.copyFrom(position);
  anchor.rotation.y = rotationY;

  const rug = B.MeshBuilder.CreateDisc('piano-rug', { radius: 2.6, tessellation: 64 }, scene);
  rug.rotation.x = Math.PI / 2;
  rug.position.y = 0.012;
  const rugMat = new B.StandardMaterial('piano-rug-mat', scene);
  rugMat.diffuseColor = B.Color3.FromHexString('#6b1a2a');
  rugMat.specularColor = B.Color3.Black();
  rug.material = rugMat;
  rug.parent = anchor;
  rug.position.z = -CENTRE_Z_OFFSET; // centre under the piano body + bench
  rug.isPickable = false;

  const parts = await loadModel(scene, 'grand_piano.glb', anchor);
  for (const part of parts) part.isPickable = false;
  const reflections = roomReflections(scene, position.add(new B.Vector3(0, 1.4, 0)), new Set(parts));
  applyReflections(parts, reflections);

  // One box covering the piano + bench. The model's footprint centre is local (0, -0.6);
  // rotate that offset the same way Babylon rotates the anchor.
  const collider = box(
    position.x - CENTRE_Z_OFFSET * Math.sin(rotationY),
    position.z - CENTRE_Z_OFFSET * Math.cos(rotationY),
    1.6,
    3.45,
    rotationY,
  );

  const setEnabled = (on) => {
    anchor.setEnabled(on);
    if (on) reflections.capture(); // re-capture: each room has its own sky tint
  };
  setEnabled(false);

  return { collider, setEnabled };
}
