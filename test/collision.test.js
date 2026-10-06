import { test } from 'node:test';
import assert from 'node:assert/strict';
import { circle, box, resolveCollisions } from '../public/js/collision.js';

const R = 0.35;
const near = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;

test('free space is left untouched', () => {
  const p = { x: 10, z: 10 };
  assert.equal(resolveCollisions(p, R, [box(0, 0, 2, 0.5)]), false);
  assert.deepEqual(p, { x: 10, z: 10 });
});

test('walking into a box face stops at its edge instead of entering', () => {
  const p = { x: 0, z: 0.4 }; // overlapping the +Z face of a 2 x 0.5 bench
  resolveCollisions(p, R, [box(0, 0, 2, 0.5)]);
  assert.ok(near(p.z, 0.25 + R));
  assert.equal(p.x, 0); // no sideways jump: player keeps sliding along the face
});

test('a player whose centre ended up inside a box is pushed out (never stuck)', () => {
  const bench = box(0, 0, 2, 0.5);
  const p = { x: 0.3, z: 0.05 };
  resolveCollisions(p, R, [bench]);
  assert.ok(near(p.z, 0.25 + R), `expected exit through nearest face, got z=${p.z}`);
  // Resolving again is a no-op: the player is fully free.
  assert.equal(resolveCollisions(p, R, [bench]), false);
});

test('rotated boxes collide along their rotated long axis', () => {
  // Same bench rotated 90deg: its long side now runs along world Z.
  const bench = box(0, 0, 2, 0.5, Math.PI / 2);
  const p = { x: 0, z: 0.3 }; // mid-bench once rotated: nearest exit is the long side (world X)
  resolveCollisions(p, R, [bench]);
  assert.ok(Math.abs(p.x) >= 0.25 + R - 1e-6, `should be pushed off the side, got x=${p.x}`);
  assert.ok(near(p.z, 0.3), 'should not slide along the bench');
});

test('circles push the player radially outward', () => {
  const p = { x: 1, z: 0 };
  resolveCollisions(p, R, [circle(0, 0, 2.5)]);
  assert.ok(near(p.x, 2.5 + R));
  assert.ok(near(p.z, 0));
});

test('every bench in the plaza layout can be walked into and left freely', () => {
  // Mirrors the bench ring built in public/js/world.js.
  const benches = [];
  for (let i = 0; i < 6; i++) {
    const angle = (i / 6) * Math.PI * 2 + Math.PI / 6;
    benches.push(box(Math.sin(angle) * 6, Math.cos(angle) * 6, 2, 0.5, angle));
  }
  for (const b of benches) {
    // Start dead centre of the bench (worst case) and walk away in 8 directions.
    for (let k = 0; k < 8; k++) {
      const p = { x: b.x, z: b.z };
      resolveCollisions(p, R, benches);
      const dir = (k / 8) * Math.PI * 2;
      for (let step = 0; step < 20; step++) {
        p.x += Math.cos(dir) * 0.1;
        p.z += Math.sin(dir) * 0.1;
        resolveCollisions(p, R, benches);
      }
      const moved = Math.hypot(p.x - b.x, p.z - b.z);
      assert.ok(moved > 0.5, `stuck near bench at (${b.x.toFixed(2)}, ${b.z.toFixed(2)}) walking dir ${k}`);
    }
  }
});
