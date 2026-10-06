import { Router } from 'express';
import { INTERESTS, EMOTES } from '../lib/validate.js';

export default function healthRoutes() {
  const router = Router();

  router.get('/health', (req, res) => {
    res.json({ status: 'ok', uptime: Math.round(process.uptime()) });
  });

  // Static game metadata the client needs to build the lobby UI.
  router.get('/meta', (req, res) => {
    res.json({ interests: INTERESTS, emotes: EMOTES, connectDistance: req.app.locals.config.connectDistance });
  });

  return router;
}
