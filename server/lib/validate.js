import { badRequest } from './errors.js';

export const INTERESTS = Object.freeze([
  'webxr',
  'gamedev',
  '3d-art',
  'music',
  'ai',
  'hardware',
  'design',
  'web',
  'fitness',
  'startups',
]);

// Every interest also has its own built-in room (room id === interest id).
export const INTEREST_LABELS = Object.freeze({
  webxr: 'WebXR',
  gamedev: 'Game Dev',
  '3d-art': '3D Art',
  music: 'Music',
  ai: 'AI',
  hardware: 'Hardware',
  design: 'Design',
  web: 'Web',
  fitness: 'Fitness',
  startups: 'Startups',
});

export const EMOTES = Object.freeze(['wave', 'cheer', 'heart', 'laugh']);

const NAME_RE = /^[\p{L}\p{N} _.\-']+$/u;
const COLOR_RE = /^#[0-9a-f]{6}$/i;

export function name(value, { field = 'name', max = 20 } = {}) {
  if (typeof value !== 'string') throw badRequest(`${field} is required`);
  const v = value.trim().replace(/\s+/g, ' ');
  if (v.length < 1 || v.length > max) throw badRequest(`${field} must be 1-${max} characters`);
  if (!NAME_RE.test(v)) throw badRequest(`${field} contains invalid characters`);
  return v;
}

export function color(value) {
  if (value === undefined) return '#4f8cff';
  if (typeof value !== 'string' || !COLOR_RE.test(value)) throw badRequest('color must be a hex colour like #33aaff');
  return value.toLowerCase();
}

export function interests(value) {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw badRequest('interests must be an array');
  const unique = [...new Set(value)];
  if (unique.length > 3) throw badRequest('pick at most 3 interests');
  for (const i of unique) if (!INTERESTS.includes(i)) throw badRequest(`unknown interest: ${String(i).slice(0, 20)}`);
  return unique;
}

export function chatText(value) {
  if (typeof value !== 'string') return null;
  // Strip control characters; the client renders text via canvas/textContent, never innerHTML.
  const v = value.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 200);
  return v || null;
}

const isNum = (n) => typeof n === 'number' && Number.isFinite(n);
const BOUND = 60;

/** A pose is [x, y, z, qx, qy, qz, qw]. Returns a sanitised copy or null. */
export function pose(value) {
  if (!Array.isArray(value) || value.length !== 7 || !value.every(isNum)) return null;
  const [x, y, z, ...q] = value;
  const clamp = (n) => Math.max(-BOUND, Math.min(BOUND, n));
  return [clamp(x), Math.max(-5, Math.min(10, y)), clamp(z), ...q.map((n) => Math.max(-1, Math.min(1, n)))].map(
    (n) => Math.round(n * 1000) / 1000,
  );
}
