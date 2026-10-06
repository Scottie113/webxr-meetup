import { Router } from 'express';
import * as v from '../lib/validate.js';
import { notFound } from '../lib/errors.js';
import { requireAuth } from '../middleware/auth.js';

export default function roomRoutes() {
  const router = Router();

  const withOnline = (req, room) => ({ ...room, online: req.app.locals.presence.roomCounts()[room.id] || 0 });

  router.get('/', (req, res) => {
    res.json(req.app.locals.store.listRooms().map((r) => withOnline(req, r)));
  });

  router.get('/:id', (req, res) => {
    const room = req.app.locals.store.getRoom(req.params.id);
    if (!room) throw notFound('room not found');
    res.json(withOnline(req, room));
  });

  router.post('/', requireAuth, async (req, res) => {
    const name = v.name(req.body?.name, { field: 'room name', max: 30 });
    const room = await req.app.locals.store.createRoom({ name, createdBy: req.player.id });
    res.status(201).json(withOnline(req, room));
  });

  return router;
}
