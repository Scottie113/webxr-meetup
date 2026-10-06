import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import * as v from '../lib/validate.js';
import { notFound } from '../lib/errors.js';
import { requireAuth } from '../middleware/auth.js';

export default function playerRoutes(config) {
  const router = Router();
  const signupLimiter = rateLimit({
    windowMs: config.rateLimit.windowMs,
    limit: config.rateLimit.signup,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
  });

  // Register a new player. The returned token is shown once; only its hash is stored.
  router.post('/', signupLimiter, async (req, res) => {
    const body = req.body ?? {};
    const result = await req.app.locals.store.createPlayer({
      name: v.name(body.name),
      color: v.color(body.color),
      interests: v.interests(body.interests),
    });
    res.status(201).json(result);
  });

  router.get('/me', requireAuth, (req, res) => {
    res.json(req.player);
  });

  router.patch('/me', requireAuth, async (req, res) => {
    const body = req.body ?? {};
    const changes = {};
    if (body.name !== undefined) changes.name = v.name(body.name);
    if (body.color !== undefined) changes.color = v.color(body.color);
    if (body.interests !== undefined) changes.interests = v.interests(body.interests);
    res.json(await req.app.locals.store.updatePlayer(req.player.id, changes));
  });

  router.get('/:id', (req, res) => {
    const player = req.app.locals.store.getPlayer(req.params.id);
    if (!player) throw notFound('player not found');
    res.json(player);
  });

  return router;
}
