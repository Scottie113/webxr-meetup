import { unauthorized } from '../lib/errors.js';

/**
 * Expects `Authorization: Bearer <playerId>.<token>`.
 * On success attaches the public player record as `req.player`.
 */
export function requireAuth(req, res, next) {
  const header = req.get('authorization') || '';
  const match = /^Bearer ([0-9a-f-]{36})\.([A-Za-z0-9_-]{16,64})$/.exec(header);
  const player = match && req.app.locals.store.authenticate(match[1], match[2]);
  if (!player) throw unauthorized();
  req.player = player;
  next();
}
