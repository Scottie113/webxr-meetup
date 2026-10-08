/* global BABYLON */
// Procedural, seamlessly tiling textures painted into canvases at load time, so rooms can
// have marble, plaster and wood without downloading image files.

const B = BABYLON;

/** Small seeded PRNG (mulberry32) so textures look the same every visit. */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Fractal value noise that wraps every `size` pixels (so the texture tiles without seams).
 * Returns fn(x, y) -> roughly 0..1.
 */
function tileableNoise(size, seed, { baseCells = 4, octaves = 5 } = {}) {
  const rand = rng(seed);
  const layers = [];
  for (let o = 0; o < octaves; o++) {
    const cells = baseCells << o;
    const grid = new Float32Array(cells * cells).map(() => rand());
    layers.push({ cells, grid, amp: 0.5 ** o });
  }
  const total = layers.reduce((s, l) => s + l.amp, 0);
  const smooth = (t) => t * t * (3 - 2 * t);
  return (x, y) => {
    let v = 0;
    for (const { cells, grid, amp } of layers) {
      const gx = (x / size) * cells;
      const gy = (y / size) * cells;
      const x0 = Math.floor(gx);
      const y0 = Math.floor(gy);
      const fx = smooth(gx - x0);
      const fy = smooth(gy - y0);
      const at = (i, j) => grid[(((j % cells) + cells) % cells) * cells + (((i % cells) + cells) % cells)];
      const top = at(x0, y0) + (at(x0 + 1, y0) - at(x0, y0)) * fx;
      const bottom = at(x0, y0 + 1) + (at(x0 + 1, y0 + 1) - at(x0, y0 + 1)) * fx;
      v += (top + (bottom - top) * fy) * amp;
    }
    return v / total;
  };
}

function paint(scene, name, size, pixel) {
  const tex = new B.DynamicTexture(name, size, scene, true);
  const ctx = tex.getContext();
  const img = ctx.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const [r, g, b] = pixel(x, y);
      const i = (y * size + x) * 4;
      img.data[i] = r;
      img.data[i + 1] = g;
      img.data[i + 2] = b;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  tex.update();
  tex.wrapU = tex.wrapV = B.Texture.WRAP_ADDRESSMODE;
  return tex;
}

const mix = (a, b, t) => a + (b - a) * t;

/** White Carrara-style marble: soft cloudy base with thin grey veins. */
export function marbleTexture(scene, size = 512) {
  const n = tileableNoise(size, 7, { baseCells: 3, octaves: 6 });
  const cloud = tileableNoise(size, 11, { baseCells: 2, octaves: 4 });
  const TAU = Math.PI * 2;
  return paint(scene, 'marble', size, (x, y) => {
    // Integer frequencies keep the sine periodic across the tile, so it stays seamless.
    const t = Math.sin(((x * 2 + y) / size) * TAU + n(x, y) * 9);
    const vein = 1 - Math.pow(Math.abs(t), 0.18); // ~1 on thin vein lines
    const shade = 0.94 + (cloud(x, y) - 0.5) * 0.08;
    const base = [246 * shade, 243 * shade, 238 * shade];
    const veinColor = [138, 141, 150];
    const k = Math.min(1, vein * 0.85);
    return base.map((c, i) => mix(c, veinColor[i], k));
  });
}

/** Warm off-white plaster colour plus a matching normal map for a slightly textured surface. */
export function plasterTextures(scene, size = 512) {
  const n = tileableNoise(size, 23, { baseCells: 8, octaves: 5 });
  const color = paint(scene, 'plaster', size, (x, y) => {
    const v = 0.97 + (n(x, y) - 0.5) * 0.06;
    return [243 * v, 236 * v, 224 * v];
  });
  // Normal map from the same height field (central differences), so light catches the trowel texture.
  const strength = 2.2;
  const bump = paint(scene, 'plaster-normal', size, (x, y) => {
    const dx = (n(x + 1, y) - n(x - 1, y)) * strength;
    const dy = (n(x, y + 1) - n(x, y - 1)) * strength;
    const len = Math.hypot(dx, dy, 1);
    return [(-dx / len) * 127.5 + 127.5, (-dy / len) * 127.5 + 127.5, (1 / len) * 127.5 + 127.5];
  });
  return { color, bump };
}

/** Light oak floorboards: staggered planks with soft grain and fine seams. */
export function woodTexture(scene, size = 512) {
  const grain = tileableNoise(size, 41, { baseCells: 4, octaves: 4 });
  const planks = 8;
  const plankH = size / planks;
  const rand = rng(99);
  const tones = Array.from({ length: planks * 2 }, () => 0.92 + rand() * 0.1);
  const TAU = Math.PI * 2;
  return paint(scene, 'oak', size, (x, y) => {
    const row = Math.floor(y / plankH);
    // Boards are half the tile long; stagger the joints row by row.
    const shifted = (x + (row % 2) * (size / 4)) % size;
    const board = Math.floor(shifted / (size / 2));
    const tone = tones[row * 2 + board];
    const g = Math.sin((y / size) * TAU * 24 + grain(x, y) * 14) * 0.5 + 0.5;
    const v = tone * (0.9 + g * 0.1);
    const seam = y % plankH < 1.5 || shifted % (size / 2) < 1.5 ? 0.72 : 1;
    return [222 * v * seam, 190 * v * seam, 146 * v * seam];
  });
}
