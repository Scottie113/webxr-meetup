import { Router } from 'express';

export default function leaderboardRoutes() {
  const router = Router();

  router.get('/', (req, res) => {
    const limit = Number.parseInt(req.query.limit, 10) || 10;
    res.json(req.app.locals.store.leaderboard(limit));
  });

  return router;
}
