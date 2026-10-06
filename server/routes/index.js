import { Router } from 'express';
import healthRoutes from './health.js';
import playerRoutes from './players.js';
import roomRoutes from './rooms.js';
import leaderboardRoutes from './leaderboard.js';

/** All REST routes, mounted under /api by the middleware stack. */
export default function apiRoutes(config) {
  const router = Router();
  router.use('/', healthRoutes());
  router.use('/players', playerRoutes(config));
  router.use('/rooms', roomRoutes());
  router.use('/leaderboard', leaderboardRoutes());
  return router;
}
