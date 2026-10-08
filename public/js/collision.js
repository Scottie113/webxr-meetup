// Top-down (XZ) collision for the walking player. Obstacles are circles or rotated boxes;
// a "wall" is a round room boundary that keeps the player inside it.
// Resolution always pushes the player *out* to the nearest edge, so they slide along
// obstacles and can never end up trapped inside one. Pure math: no Babylon dependency.

export const circle = (x, z, r) => ({ kind: 'circle', x, z, r });

/** A box of `width` (local X) by `depth` (local Z), rotated by `angle` like Babylon's `rotation.y`. */
export const box = (x, z, width, depth, angle = 0) => ({ kind: 'box', x, z, hw: width / 2, hd: depth / 2, angle });

/** A circular room wall of radius `r` around (x, z): the player is kept inside it. */
export const wall = (x, z, r) => ({ kind: 'wall', x, z, r });

const clamp = (n, min, max) => Math.max(min, Math.min(max, n));

function keepInsideWall(p, r, c) {
  const dx = p.x - c.x;
  const dz = p.z - c.z;
  const d = Math.hypot(dx, dz);
  const max = c.r - r;
  if (d <= max) return false;
  p.x = c.x + (dx / d) * max;
  p.z = c.z + (dz / d) * max;
  return true;
}

function pushOutOfCircle(p, r, c) {
  const dx = p.x - c.x;
  const dz = p.z - c.z;
  const d = Math.hypot(dx, dz);
  const min = c.r + r;
  if (d >= min) return false;
  if (d < 1e-6) {
    p.x = c.x + min;
    return true;
  }
  p.x = c.x + (dx / d) * min;
  p.z = c.z + (dz / d) * min;
  return true;
}

function pushOutOfBox(p, r, c) {
  const cos = Math.cos(c.angle);
  const sin = Math.sin(c.angle);
  const wx = p.x - c.x;
  const wz = p.z - c.z;
  // World -> box-local space (inverse of Babylon's Y rotation).
  let lx = wx * cos - wz * sin;
  let lz = wx * sin + wz * cos;

  const cx = clamp(lx, -c.hw, c.hw);
  const cz = clamp(lz, -c.hd, c.hd);
  const dx = lx - cx;
  const dz = lz - cz;
  const d = Math.hypot(dx, dz);
  if (d >= r) return false;

  if (d > 1e-6) {
    // Overlapping an edge or corner: move to exactly `r` away from the closest point.
    lx = cx + (dx / d) * r;
    lz = cz + (dz / d) * r;
  } else if (c.hw - Math.abs(lx) < c.hd - Math.abs(lz)) {
    // Centre is inside the box: leave through the nearest face.
    lx = Math.sign(lx || 1) * (c.hw + r);
  } else {
    lz = Math.sign(lz || 1) * (c.hd + r);
  }

  // Box-local -> world space.
  p.x = c.x + lx * cos + lz * sin;
  p.z = c.z - lx * sin + lz * cos;
  return true;
}

/** Top-down distance from a point to a collider's edge (0 when inside it). */
export function distanceTo(pos, c) {
  if (c.kind === 'wall') return Math.max(0, c.r - Math.hypot(pos.x - c.x, pos.z - c.z));
  if (c.kind === 'circle') return Math.max(0, Math.hypot(pos.x - c.x, pos.z - c.z) - c.r);
  const cos = Math.cos(c.angle);
  const sin = Math.sin(c.angle);
  const wx = pos.x - c.x;
  const wz = pos.z - c.z;
  const lx = wx * cos - wz * sin;
  const lz = wx * sin + wz * cos;
  return Math.hypot(lx - clamp(lx, -c.hw, c.hw), lz - clamp(lz, -c.hd, c.hd));
}

/**
 * First collider tagged with `portal` that a player of `radius` is touching (within `margin`
 * of contact), or null. Solid portals push the player out first, so touch = walked into it.
 */
export function touchedPortal(pos, radius, colliders, margin = 0.08) {
  return colliders.find((c) => c.portal && distanceTo(pos, c) <= radius + margin) || null;
}

/**
 * Move `pos` ({x, z}, mutated in place) so a player of `radius` overlaps no collider.
 * Returns true if the position was adjusted.
 */
export function resolveCollisions(pos, radius, colliders) {
  let adjusted = false;
  // A few passes settle the rare case of being wedged between two obstacles.
  for (let pass = 0; pass < 4; pass++) {
    let moved = false;
    for (const c of colliders) {
      const push = c.kind === 'circle' ? pushOutOfCircle : c.kind === 'wall' ? keepInsideWall : pushOutOfBox;
      moved = push(pos, radius, c) || moved;
    }
    if (!moved) break;
    adjusted = true;
  }
  return adjusted;
}
