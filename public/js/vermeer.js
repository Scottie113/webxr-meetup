/* global BABYLON */
// A Delft interior in the manner of Vermeer's "The Milkmaid", entered through "Girl with a
// Pearl Earring": a whitewashed room lit by cool daylight from a leaded window on the left,
// a worn red clay tile floor edged with blue Delft tiles, dark oak beams, an oak table
// laid with a blue-green cloth, earthenware jug, bowl, bread and basket, a 17th-century
// Dutch chair, a wall map, the Milkmaid's wicker basket and brass pail, a foot warmer, and
// the seated girl (modelled character from the models repo) looking back over her shoulder.
import { room, box, circle } from './collision.js';
import { buildReturnWindow } from './starryNight.js';
import { loadModel, roomReflections, applyReflections } from './props.js';
import { plasterTextures, woodTexture } from './textures.js';

const B = BABYLON;

const MODELS_REPO = 'https://raw.githubusercontent.com/Scottie113/Models-for-Meetup-room/main/';
// Facing -Z from the spawn point (z ~8.5), +X is your LEFT: the window wall, as in the paintings.
const ROOM = { minX: -3.4, maxX: 3.4, minZ: 1.4, maxZ: 12.6, height: 3.8 };
const WINDOW = { z: 4.0, width: 1.5, sill: 0.95, top: 2.95 };
const TABLE = { x: 1.75, z: 4.2, w: 0.95, d: 1.7, h: 0.76 };
const CHAIR = { x: 0.7, z: 4.4 };
// Her body turns toward the window while her head looks back over her shoulder at the spawn.
const GIRL = { x: -1.4, z: 4.3, rotationY: -0.796 };

// ---- small helpers ------------------------------------------------------------------------
function mat(scene, name, color, { emissive = 0, specular = 0.05, texture = null } = {}) {
  const m = new B.StandardMaterial(name, scene);
  m.diffuseColor = new B.Color3(...color);
  m.emissiveColor = new B.Color3(...color).scale(emissive);
  m.specularColor = new B.Color3(specular, specular, specular);
  if (texture) m.diffuseTexture = texture;
  return m;
}

function canvasTexture(scene, name, w, h, paint) {
  const tex = new B.DynamicTexture(name, { width: w, height: h }, scene, true);
  paint(tex.getContext(), w, h);
  tex.update();
  tex.wrapU = tex.wrapV = B.Texture.WRAP_ADDRESSMODE;
  return tex;
}

/** Blue-and-white Delft tiles: four per texture row, each with a little painted motif. */
function delftTexture(scene) {
  return canvasTexture(scene, 'delft-tiles', 512, 128, (ctx) => {
    for (let i = 0; i < 4; i++) {
      const x = i * 128;
      ctx.fillStyle = '#f3f1ea';
      ctx.fillRect(x, 0, 128, 128);
      ctx.strokeStyle = '#c9ccd6';
      ctx.lineWidth = 4;
      ctx.strokeRect(x + 2, 2, 124, 124);
      ctx.strokeStyle = '#2b4c9b';
      ctx.fillStyle = '#2b4c9b';
      ctx.lineWidth = 3;
      // Corner "ox-head" ornaments and a central figure/flower, like classic Delft tiles.
      for (const [cx, cy] of [[14, 14], [114, 14], [14, 114], [114, 114]]) {
        ctx.beginPath();
        ctx.arc(x + cx, cy, 6, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.beginPath();
      if (i % 2 === 0) {
        ctx.arc(x + 64, 52, 10, 0, Math.PI * 2); // a little figure
        ctx.moveTo(x + 64, 62);
        ctx.lineTo(x + 64, 92);
        ctx.moveTo(x + 50, 74);
        ctx.lineTo(x + 78, 70);
        ctx.moveTo(x + 64, 92);
        ctx.lineTo(x + 54, 108);
        ctx.moveTo(x + 64, 92);
        ctx.lineTo(x + 74, 108);
      } else {
        for (let k = 0; k < 5; k++) {
          const a = (k / 5) * Math.PI * 2;
          ctx.moveTo(x + 64, 64);
          ctx.ellipse(x + 64 + Math.cos(a) * 14, 64 + Math.sin(a) * 14, 10, 5, a, 0, Math.PI * 2);
        }
      }
      ctx.stroke();
    }
  });
}

/**
 * Worn red clay (terracotta) floor tiles: 4 x 4 tiles per texture, each a slightly different
 * warm red-orange, mottled and sun-faded, with grimy patches, speckles, darker worn corners and
 * pale, slightly dirty grout.
 */
function terracottaTexture(scene) {
  const T = 128; // pixels per tile
  return canvasTexture(scene, 'vermeer-floor', T * 4, T * 4, (ctx, w, h) => {
    // Grout first; tiles are painted over it, leaving thin lines between them.
    ctx.fillStyle = '#cdc3b4';
    ctx.fillRect(0, 0, w, h);
    const grout = 3;
    const rnd = (a, b) => a + Math.random() * (b - a);
    for (let i = 0; i < 4; i++) {
      for (let j = 0; j < 4; j++) {
        const x = i * T + grout;
        const y = j * T + grout;
        const size = T - grout * 2;
        const r = rnd(166, 196);
        const g = rnd(72, 98);
        const b = rnd(44, 60);
        ctx.fillStyle = `rgb(${r},${g},${b})`;
        ctx.fillRect(x, y, size, size);
        ctx.save();
        ctx.beginPath();
        ctx.rect(x, y, size, size);
        ctx.clip();
        // Mottling: soft lighter (sun-faded) and darker (grimy) blotches.
        for (let k = 0; k < 26; k++) {
          const light = Math.random() < 0.45;
          const rr = rnd(8, 30);
          const gx = x + Math.random() * size;
          const gy = y + Math.random() * size;
          const grad = ctx.createRadialGradient(gx, gy, 0, gx, gy, rr);
          grad.addColorStop(0, light ? `rgba(222,150,110,${rnd(0.12, 0.3)})` : `rgba(70,35,20,${rnd(0.12, 0.3)})`);
          grad.addColorStop(1, 'rgba(0,0,0,0)');
          ctx.fillStyle = grad;
          ctx.fillRect(gx - rr, gy - rr, rr * 2, rr * 2);
        }
        // Fine speckles and pits in the clay.
        for (let k = 0; k < 160; k++) {
          ctx.fillStyle = Math.random() < 0.6 ? `rgba(60,30,18,${rnd(0.15, 0.45)})` : `rgba(235,185,150,${rnd(0.1, 0.35)})`;
          ctx.fillRect(x + Math.random() * size, y + Math.random() * size, rnd(1, 2.5), rnd(1, 2.5));
        }
        // Darker, dirtier edges and corners where grime collects.
        const edge = ctx.createRadialGradient(x + size / 2, y + size / 2, size * 0.35, x + size / 2, y + size / 2, size * 0.75);
        edge.addColorStop(0, 'rgba(0,0,0,0)');
        edge.addColorStop(1, `rgba(55,28,16,${rnd(0.25, 0.45)})`);
        ctx.fillStyle = edge;
        ctx.fillRect(x, y, size, size);
        ctx.restore();
      }
    }
    // Dirt worked into the grout lines.
    for (let k = 0; k < 900; k++) {
      const onX = Math.random() < 0.5;
      const line = Math.floor(Math.random() * 5) * T;
      const along = Math.random() * w;
      ctx.fillStyle = `rgba(90,70,55,${rnd(0.1, 0.35)})`;
      ctx.fillRect(onX ? along : line - 3, onX ? line - 3 : along, rnd(1, 4), rnd(1, 4));
    }
  });
}

/** Leaded window glass: small diamond panes, pale and luminous, one pane cracked. */
function leadedGlassTexture(scene) {
  return canvasTexture(scene, 'leaded-glass', 256, 512, (ctx, w, h) => {
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, '#f6f8ff');
    g.addColorStop(1, '#dfe7f2');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    // Slightly uneven glass.
    for (let k = 0; k < 120; k++) {
      ctx.fillStyle = `rgba(200,215,235,${Math.random() * 0.25})`;
      ctx.fillRect(Math.random() * w, Math.random() * h, 18, 18);
    }
    ctx.strokeStyle = '#4b4a48';
    ctx.lineWidth = 3;
    const step = 40;
    for (let d = -h; d < w + h; d += step) {
      ctx.beginPath();
      ctx.moveTo(d, 0);
      ctx.lineTo(d + h, h);
      ctx.moveTo(d, h);
      ctx.lineTo(d + h, 0);
      ctx.stroke();
    }
    ctx.lineWidth = 10;
    ctx.strokeStyle = '#3a2d22';
    ctx.strokeRect(0, 0, w, h);
    ctx.beginPath();
    ctx.moveTo(0, h / 2);
    ctx.lineTo(w, h / 2);
    ctx.stroke();
    // The broken pane from The Milkmaid.
    ctx.lineWidth = 2;
    ctx.strokeStyle = 'rgba(80,80,90,0.8)';
    ctx.beginPath();
    ctx.moveTo(150, 120);
    ctx.lineTo(170, 150);
    ctx.lineTo(160, 175);
    ctx.stroke();
  });
}

/** An old wall map in the style of the ones Vermeer painted: parchment, sea, coasts, cartouche. */
function mapTexture(scene) {
  return canvasTexture(scene, 'wall-map', 1024, 704, (ctx, w, h) => {
    ctx.fillStyle = '#cdb88c';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#9fae9e';
    ctx.fillRect(40, 90, w - 80, h - 130);
    // Land masses: lumpy ochre coastlines.
    ctx.fillStyle = '#c9a96b';
    ctx.strokeStyle = '#6b5434';
    ctx.lineWidth = 3;
    for (let k = 0; k < 7; k++) {
      const cx = 120 + Math.random() * (w - 240);
      const cy = 160 + Math.random() * (h - 260);
      const r = 50 + Math.random() * 110;
      ctx.beginPath();
      for (let a = 0; a <= Math.PI * 2 + 0.01; a += 0.25) {
        const rr = r * (0.7 + Math.random() * 0.5);
        ctx.lineTo(cx + Math.cos(a) * rr * 1.3, cy + Math.sin(a) * rr);
      }
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }
    ctx.strokeStyle = 'rgba(80,70,50,0.35)';
    ctx.lineWidth = 1.5;
    for (let x = 40; x < w - 40; x += 80) {
      ctx.beginPath();
      ctx.moveTo(x, 90);
      ctx.lineTo(x, h - 40);
      ctx.stroke();
    }
    for (let y = 90; y < h - 40; y += 80) {
      ctx.beginPath();
      ctx.moveTo(40, y);
      ctx.lineTo(w - 40, y);
      ctx.stroke();
    }
    ctx.fillStyle = '#e4d6b4';
    ctx.strokeStyle = '#6b5434';
    ctx.lineWidth = 4;
    ctx.fillRect(w / 2 - 230, 18, 460, 60);
    ctx.strokeRect(w / 2 - 230, 18, 460, 60);
    ctx.fillStyle = '#4a3a24';
    ctx.font = 'italic bold 40px Georgia, serif';
    ctx.textAlign = 'center';
    ctx.fillText('NOVA XVII PROVINCIARUM', w / 2, 62);
    ctx.strokeRect(20, 20, w - 40, h - 40);
  });
}

// ---- the room shell ---------------------------------------------------------------------------
function buildShell(scene, root, receivers) {
  const { minX, maxX, minZ, maxZ, height } = ROOM;
  const width = maxX - minX;
  const depth = maxZ - minZ;
  const cx = (minX + maxX) / 2;
  const cz = (minZ + maxZ) / 2;

  const plaster = plasterTextures(scene);
  // Warm, luminous whitewash with a fine, gentle texture (Vermeer's walls glow, they aren't grey).
  plaster.color.uScale = plaster.bump.uScale = 7;
  plaster.color.vScale = plaster.bump.vScale = 4;
  plaster.bump.level = 0.45;
  const wallMat = mat(scene, 'vermeer-plaster', [1.0, 0.98, 0.94], { emissive: 0.24 });
  wallMat.diffuseTexture = plaster.color;
  wallMat.bumpTexture = plaster.bump;

  const plane = (name, w, h, x, y, z, rotY) => {
    const p = B.MeshBuilder.CreatePlane(name, { width: w, height: h }, scene);
    p.position.set(x, y, z);
    p.rotation.y = rotY;
    p.material = wallMat;
    p.parent = root;
    receivers.push(p);
    return p;
  };
  // Planes face -Z by default; rotate each so it faces into the room.
  plane('vermeer-wall-front', width, height, cx, height / 2, minZ, Math.PI);
  plane('vermeer-wall-back', width, height, cx, height / 2, maxZ, 0);
  plane('vermeer-wall-right', depth, height, minX, height / 2, cz, -Math.PI / 2);
  // Left wall (+X) with an opening for the window.
  const w0 = WINDOW.z - WINDOW.width / 2;
  const w1 = WINDOW.z + WINDOW.width / 2;
  const left = (name, z0, z1, y0, y1) => plane(name, z1 - z0, y1 - y0, maxX, (y0 + y1) / 2, (z0 + z1) / 2, Math.PI / 2);
  left('vermeer-wall-left-a', minZ, w0, 0, height);
  left('vermeer-wall-left-b', w1, maxZ, 0, height);
  left('vermeer-wall-left-c', w0, w1, 0, WINDOW.sill);
  left('vermeer-wall-left-d', w0, w1, WINDOW.top, height);

  // Floor and ceiling.
  // Tiles are 40 cm square; one texture holds 4 x 4 of them (1.6 m).
  const floorTex = terracottaTexture(scene);
  floorTex.uScale = width / 1.6;
  floorTex.vScale = depth / 1.6;
  const floor = B.MeshBuilder.CreateGround('vermeer-floor', { width, height: depth }, scene);
  floor.position.set(cx, 0, cz);
  // Sealed but well-trodden clay: a soft sheen where the window light catches it.
  floor.material = mat(scene, 'vermeer-floor-mat', [1, 1, 1], { texture: floorTex, specular: 0.18 });
  floor.material.specularPower = 24;
  floor.parent = root;
  receivers.push(floor);
  const ceiling = B.MeshBuilder.CreateGround('vermeer-ceiling', { width, height: depth, sideOrientation: B.Mesh.BACKSIDE }, scene);
  ceiling.position.set(cx, height, cz);
  ceiling.material = wallMat;
  ceiling.parent = root;

  // Dark oak ceiling beams.
  const oak = woodTexture(scene);
  const darkOak = mat(scene, 'vermeer-dark-oak', [0.42, 0.3, 0.2], { texture: oak, specular: 0.08 });
  for (let z = minZ + 0.9; z < maxZ; z += 1.5) {
    const beam = B.MeshBuilder.CreateBox('vermeer-beam', { width, height: 0.24, depth: 0.22 }, scene);
    beam.position.set(cx, height - 0.12, z);
    beam.material = darkOak;
    beam.parent = root;
  }

  // Delft tile skirting along the foot of every wall.
  const skirt = (name, len, x, z, rotY) => {
    const t = delftTexture(scene); // one painted texture per wall (cloned canvas textures stay blank)
    t.uScale = len / 0.52;
    t.vScale = 0.3 / 0.13;
    const p = B.MeshBuilder.CreatePlane(name, { width: len, height: 0.3 }, scene);
    p.position.set(x, 0.15, z);
    p.rotation.y = rotY;
    p.material = mat(scene, `${name}-mat`, [1, 1, 1], { texture: t, specular: 0.3, emissive: 0.05 });
    p.parent = root;
    receivers.push(p);
  };
  skirt('delft-front', width, cx, minZ + 0.01, Math.PI);
  skirt('delft-back', width, cx, maxZ - 0.01, 0);
  skirt('delft-right', depth, minX + 0.01, cz, -Math.PI / 2);
  skirt('delft-left-a', w0 - minZ, maxX - 0.01, (minZ + w0) / 2, Math.PI / 2);
  skirt('delft-left-b', maxZ - w1, maxX - 0.01, (w1 + maxZ) / 2, Math.PI / 2);
  return { floor, darkOak };
}

function buildWindow(scene, root, darkOak) {
  const { maxX } = ROOM;
  const h = WINDOW.top - WINDOW.sill;
  const y = (WINDOW.sill + WINDOW.top) / 2;
  // Deep reveal: the wall is thick, the glass sits back in it.
  const glass = B.MeshBuilder.CreatePlane('vermeer-window-glass', { width: WINDOW.width, height: h }, scene);
  glass.position.set(maxX + 0.25, y, WINDOW.z);
  glass.rotation.y = Math.PI / 2;
  const glassMat = new B.StandardMaterial('vermeer-glass-mat', scene);
  glassMat.emissiveTexture = leadedGlassTexture(scene);
  glassMat.emissiveColor = new B.Color3(0.15, 0.17, 0.2);
  glassMat.disableLighting = true;
  glass.material = glassMat;
  glass.parent = root;
  const reveal = (name, w, hh, d, px, py, pz) => {
    const b = B.MeshBuilder.CreateBox(name, { width: d, height: hh, depth: w }, scene);
    b.position.set(px, py, pz);
    b.material = darkOak;
    b.parent = root;
  };
  reveal('window-sill', WINDOW.width + 0.1, 0.06, 0.32, maxX + 0.13, WINDOW.sill, WINDOW.z);
  reveal('window-head', WINDOW.width + 0.1, 0.08, 0.32, maxX + 0.13, WINDOW.top, WINDOW.z);
  reveal('window-jamb-a', 0.08, h, 0.32, maxX + 0.13, y, WINDOW.z - WINDOW.width / 2);
  reveal('window-jamb-b', 0.08, h, 0.32, maxX + 0.13, y, WINDOW.z + WINDOW.width / 2);
  reveal('window-transom', WINDOW.width, 0.06, 0.06, maxX + 0.24, y, WINDOW.z);

  // A faint shaft of daylight falling from the window across the room.
  const shaft = B.MeshBuilder.CreatePlane('vermeer-light-shaft', { width: 3.2, height: h * 1.1 }, scene);
  shaft.position.set(maxX - 1.3, y - 0.55, WINDOW.z);
  shaft.rotation.set(0, Math.PI / 2, -0.62);
  const shaftTex = canvasTexture(scene, 'light-shaft', 256, 64, (ctx, w) => {
    const g = ctx.createLinearGradient(0, 0, w, 0);
    g.addColorStop(0, 'rgba(255,250,235,0)');
    g.addColorStop(0.15, 'rgba(255,250,235,0.35)');
    g.addColorStop(0.7, 'rgba(255,250,235,0.12)');
    g.addColorStop(1, 'rgba(255,250,235,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, 64);
  });
  const shaftMat = new B.StandardMaterial('vermeer-shaft-mat', scene);
  shaftMat.emissiveTexture = shaftTex;
  shaftMat.opacityTexture = shaftTex;
  shaftMat.disableLighting = true;
  shaftMat.alphaMode = B.Engine.ALPHA_ADD;
  shaftMat.backFaceCulling = false;
  shaftMat.alpha = 0.35;
  shaft.material = shaftMat;
  shaft.isPickable = false;
  shaft.parent = root;
}

// ---- furniture and things -------------------------------------------------------------------
function lathe(scene, name, profile, material, x, y, z, root, casters) {
  const m = B.MeshBuilder.CreateLathe(name, { shape: profile.map(([r, h]) => new B.Vector3(r, h, 0)), tessellation: 24, sideOrientation: B.Mesh.DOUBLESIDE }, scene);
  m.position.set(x, y, z);
  m.material = material;
  m.parent = root;
  casters.push(m);
  return m;
}

function buildTable(scene, root, darkOak, casters, receivers) {
  const { x, z, w, d, h } = TABLE;
  const top = B.MeshBuilder.CreateBox('table-top', { width: w, height: 0.06, depth: d }, scene);
  top.position.set(x, h - 0.03, z);
  top.material = darkOak;
  top.parent = root;
  casters.push(top);
  receivers.push(top);
  // Bulbous turned legs and low stretchers.
  for (const [lx, lz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    const px = x + lx * (w / 2 - 0.08);
    const pz = z + lz * (d / 2 - 0.1);
    const leg = B.MeshBuilder.CreateCylinder('table-leg', { diameter: 0.08, height: h - 0.06, tessellation: 12 }, scene);
    leg.position.set(px, (h - 0.06) / 2, pz);
    const bulb = B.MeshBuilder.CreateSphere('table-bulb', { diameter: 0.17, segments: 12 }, scene);
    bulb.scaling.y = 1.5;
    bulb.position.set(px, 0.42, pz);
    for (const m of [leg, bulb]) {
      m.material = darkOak;
      m.parent = root;
      casters.push(m);
    }
  }
  for (const [sx, sz, sw, sd] of [[x, z - d / 2 + 0.1, w - 0.16, 0.05], [x, z + d / 2 - 0.1, w - 0.16, 0.05], [x - w / 2 + 0.08, z, 0.05, d - 0.2], [x + w / 2 - 0.08, z, 0.05, d - 0.2]]) {
    const s = B.MeshBuilder.CreateBox('table-stretcher', { width: sw, height: 0.05, depth: sd }, scene);
    s.position.set(sx, 0.1, sz);
    s.material = darkOak;
    s.parent = root;
  }
  // The blue-green tablecloth, draping over the room side of the table.
  const clothMat = mat(scene, 'tablecloth', [0.2, 0.36, 0.4], { specular: 0.02 });
  const cloth = B.MeshBuilder.CreateBox('tablecloth', { width: w * 0.8, height: 0.012, depth: d * 0.75 }, scene);
  cloth.position.set(x - w * 0.1, h + 0.006, z + d * 0.08);
  const drape = B.MeshBuilder.CreateBox('tablecloth-drape', { width: 0.012, height: 0.38, depth: d * 0.75 }, scene);
  drape.position.set(x - w / 2 - 0.006, h - 0.18, z + d * 0.08);
  for (const m of [cloth, drape]) {
    m.material = clothMat;
    m.parent = root;
    casters.push(m);
    receivers.push(m);
  }

  // On the table: earthenware jug, a bowl, bread and a basket, as in The Milkmaid.
  const y = h + 0.012;
  const earthen = mat(scene, 'earthenware', [0.55, 0.32, 0.18], { specular: 0.35 });
  earthen.specularPower = 40;
  lathe(scene, 'jug', [[0.0, 0], [0.07, 0], [0.1, 0.06], [0.11, 0.14], [0.08, 0.22], [0.05, 0.26], [0.06, 0.29], [0.0, 0.29]], earthen, x - 0.1, y, z - 0.35, root, casters);
  const bowlMat = mat(scene, 'bowl', [0.62, 0.45, 0.28], { specular: 0.3 });
  lathe(scene, 'bowl', [[0.0, 0], [0.06, 0], [0.13, 0.05], [0.15, 0.09], [0.14, 0.095]], bowlMat, x + 0.15, y, z - 0.05, root, casters);
  const bread = mat(scene, 'bread', [0.74, 0.5, 0.25], { specular: 0.05 });
  for (const [bx, bz, s] of [[x - 0.2, z + 0.25, 0.2], [x - 0.05, z + 0.4, 0.15], [x + 0.18, z + 0.32, 0.12], [x - 0.25, z + 0.48, 0.1]]) {
    const loaf = B.MeshBuilder.CreateSphere('bread', { diameter: s, segments: 10 }, scene);
    loaf.scaling.set(1.3, 0.6, 1);
    loaf.position.set(bx, y + s * 0.28, bz);
    loaf.material = bread;
    loaf.parent = root;
    casters.push(loaf);
  }
  const wicker = mat(scene, 'wicker', [0.6, 0.47, 0.28]);
  const basket = B.MeshBuilder.CreateCylinder('bread-basket', { diameterTop: 0.36, diameterBottom: 0.26, height: 0.16, tessellation: 20 }, scene);
  basket.position.set(x + 0.15, y + 0.08, z + 0.6);
  basket.material = wicker;
  basket.parent = root;
  casters.push(basket);
  return wicker;
}

/** A 17th-century Dutch chair: blue leather seat and back with brass nails, lion-head finials. */
function buildChair(scene, root, darkOak, casters) {
  const node = new B.TransformNode('dutch-chair', scene);
  node.parent = root;
  node.position.set(CHAIR.x, 0, CHAIR.z);
  node.rotation.y = -Math.PI / 2; // back to the room, seat facing the table (+X)
  const leather = mat(scene, 'blue-leather', [0.16, 0.24, 0.46], { specular: 0.25 });
  const brass = mat(scene, 'chair-brass', [0.75, 0.58, 0.28], { specular: 0.8 });
  const add = (m, material) => {
    m.material = material;
    m.parent = node;
    casters.push(m);
  };
  const s = 0.46;
  for (const [lx, lz, h] of [[-1, -1, 0.48], [1, -1, 0.48], [-1, 1, 1.02], [1, 1, 1.02]]) {
    const leg = B.MeshBuilder.CreateBox('chair-leg', { width: 0.045, height: h, depth: 0.045 }, scene);
    leg.position.set((lx * s) / 2, h / 2, (lz * s) / 2);
    add(leg, darkOak);
  }
  const seat = B.MeshBuilder.CreateBox('chair-seat', { width: s, height: 0.05, depth: s }, scene);
  seat.position.y = 0.48;
  add(seat, leather);
  const back = B.MeshBuilder.CreateBox('chair-back', { width: s - 0.04, height: 0.32, depth: 0.025 }, scene);
  back.position.set(0, 0.78, s / 2);
  add(back, leather);
  for (const bx of [-1, 1]) {
    const finial = B.MeshBuilder.CreateSphere('chair-finial', { diameter: 0.08, segments: 10 }, scene);
    finial.position.set((bx * s) / 2, 1.06, s / 2);
    add(finial, brass);
  }
  for (let i = 0; i < 7; i++) {
    const nail = B.MeshBuilder.CreateSphere('chair-nail', { diameter: 0.014, segments: 6 }, scene);
    nail.position.set(-s / 2 + 0.03 + (i / 6) * (s - 0.06), 0.505, -s / 2 + 0.01);
    add(nail, brass);
  }
  for (const [sy, sz] of [[0.12, -s / 2], [0.12, s / 2]]) {
    const st = B.MeshBuilder.CreateBox('chair-stretcher', { width: s, height: 0.035, depth: 0.03 }, scene);
    st.position.set(0, sy, sz);
    add(st, darkOak);
  }
}

function buildWallThings(scene, root, darkOak, wicker, casters) {
  const { minZ, maxX } = ROOM;
  // The wall map, hung on wooden rods.
  const map = B.MeshBuilder.CreatePlane('wall-map', { width: 1.7, height: 1.17 }, scene);
  map.position.set(-1.3, 2.2, minZ + 0.03);
  map.rotation.y = Math.PI;
  map.material = mat(scene, 'wall-map-mat', [1, 1, 1], { texture: mapTexture(scene), emissive: 0.06 });
  map.parent = root;
  for (const ry of [2.2 + 0.6, 2.2 - 0.6]) {
    const rod = B.MeshBuilder.CreateCylinder('map-rod', { diameter: 0.045, height: 1.85, tessellation: 10 }, scene);
    rod.rotation.z = Math.PI / 2;
    rod.position.set(-1.3, ry, minZ + 0.05);
    rod.material = darkOak;
    rod.parent = root;
  }
  // The Milkmaid's wicker basket and brass pail hanging on the wall by the window.
  const basket = B.MeshBuilder.CreateCylinder('hanging-basket', { diameterTop: 0.42, diameterBottom: 0.3, height: 0.3, tessellation: 18 }, scene);
  basket.position.set(maxX - 1.0, 2.15, minZ + 0.24);
  basket.material = wicker;
  basket.parent = root;
  casters.push(basket);
  const pail = B.MeshBuilder.CreateCylinder('brass-pail', { diameterTop: 0.3, diameterBottom: 0.26, height: 0.28, tessellation: 20 }, scene);
  pail.position.set(maxX - 0.45, 1.75, minZ + 0.2);
  const brassMat = mat(scene, 'pail-brass', [0.8, 0.6, 0.28], { specular: 0.9 });
  brassMat.specularPower = 32;
  pail.material = brassMat;
  pail.parent = root;
  casters.push(pail);
  // A foot warmer on the floor, a little wooden box with a pierced top.
  const warmer = B.MeshBuilder.CreateBox('foot-warmer', { width: 0.3, height: 0.2, depth: 0.3 }, scene);
  warmer.position.set(0.4, 0.1, minZ + 1.6);
  warmer.material = darkOak;
  warmer.parent = root;
  casters.push(warmer);
}

/** The girl on her stool (modelled character from the models repo). */
async function buildGirl(scene, root, casters) {
  const anchor = new B.TransformNode('vermeer-girl', scene);
  anchor.parent = root;
  anchor.position.set(GIRL.x, 0, GIRL.z);
  anchor.rotation.y = GIRL.rotationY;
  const parts = await loadModel(scene, `${MODELS_REPO}vermeer-seated-person-v2/seated-person-with-stool.glb`, anchor);
  for (const p of parts) {
    p.isPickable = false;
    casters.push(p);
  }
  const reflections = roomReflections(scene, new B.Vector3(GIRL.x + 0.8, 1.3, GIRL.z + 0.8), new Set(parts));
  applyReflections(parts, reflections);
  return { reflections, parts };
}

/**
 * Build the Vermeer room. Same handle shape as the other room props, plus `setWindowView`
 * for the framed window back to the room you came from.
 */
export function createVermeerRoom(scene, { returnTo = '3d-art' } = {}) {
  const root = new B.TransformNode('vermeer-room', scene);
  const casters = [];
  const receivers = [];
  const { floor, darkOak } = buildShell(scene, root, receivers);
  buildWindow(scene, root, darkOak);
  const wicker = buildTable(scene, root, darkOak, casters, receivers);
  buildChair(scene, root, darkOak, casters);
  buildWallThings(scene, root, darkOak, wicker, casters);
  const windowZ = ROOM.maxZ - 0.38;
  const windowView = buildReturnWindow(scene, root, returnTo, windowZ, 'vermeer-window');

  // Cool daylight pouring in through the window (from +X), with soft shadows.
  const daylight = new B.DirectionalLight('vermeer-daylight', new B.Vector3(-1, -0.55, -0.12).normalize(), scene);
  daylight.position.set(ROOM.maxX + 3, 4.5, WINDOW.z + 0.5);
  daylight.diffuse = new B.Color3(1.0, 0.97, 0.92);
  daylight.specular = new B.Color3(0.6, 0.6, 0.6);
  daylight.intensity = 1.5;
  daylight.parent = root;
  const shadows = new B.ShadowGenerator(1024, daylight);
  shadows.usePercentageCloserFiltering = true;
  shadows.filteringQuality = B.ShadowGenerator.QUALITY_MEDIUM;
  shadows.bias = 0.002;
  shadows.normalBias = 0.02;
  for (const m of casters) shadows.addShadowCaster(m);
  for (const m of receivers) m.receiveShadows = true;
  // Nothing in the room moves, so draw the shadow map once (again when the girl arrives or you
  // come back in) instead of every frame.
  const shadowMap = shadows.getShadowMap();
  shadowMap.refreshRate = B.RenderTargetTexture.REFRESHRATE_RENDER_ONCE;
  const redrawShadows = () => shadowMap.resetRefreshCounter();

  const girl = buildGirl(scene, root, casters).then(
    (g) => {
      for (const p of g.parts) shadows.addShadowCaster(p);
      redrawShadows();
      return g.reflections;
    },
    (err) => {
      console.warn('Could not load the seated figure from the models repo', err);
      return null;
    },
  );

  // While inside: dim the outdoor lights so the window is the light source.
  let saved = null;
  const setEnabled = (on) => {
    root.setEnabled(on);
    const hemi = scene.getLightByName('hemi');
    const sun = scene.getLightByName('sun');
    if (on) {
      saved = { fog: scene.fogDensity, hemi: hemi?.intensity, sun: sun?.intensity };
      scene.fogDensity = 0;
      scene.clearColor = new B.Color4(0.16, 0.14, 0.12, 1);
      if (hemi) hemi.intensity = 0.42;
      if (sun) sun.intensity = 0;
      redrawShadows();
      girl.then((r) => r?.capture());
    } else if (saved) {
      scene.fogDensity = saved.fog;
      if (hemi) hemi.intensity = saved.hemi;
      if (sun) sun.intensity = saved.sun;
      saved = null;
    }
  };
  setEnabled(false);

  floor.isPickable = true; // VR teleport target
  return {
    colliders: [
      room(ROOM.minX, ROOM.maxX, ROOM.minZ, ROOM.maxZ),
      box(TABLE.x, TABLE.z, TABLE.w + 0.1, TABLE.d + 0.1),
      box(CHAIR.x, CHAIR.z, 0.5, 0.5),
      circle(GIRL.x, GIRL.z, 0.55),
      box(0.4, ROOM.minZ + 1.6, 0.35, 0.35),
      circle(0, windowZ, 1.2),
    ],
    floors: [floor],
    root, // lets the world freeze the static scenery once it has loaded
    ready: girl,
    setEnabled,
    setWindowView: (tex) => windowView.setView(tex),
  };
}
