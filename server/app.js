import express from 'express';
import { applyMiddleware } from './middleware/index.js';

/**
 * Build the Express app without binding a port, so tests can drive it with supertest.
 * `presence` reports live player counts per room (provided by the realtime layer).
 */
export function createApp({ store, config, presence = { roomCounts: () => ({}) } }) {
  const app = express();
  app.locals.store = store;
  app.locals.config = config;
  app.locals.presence = presence;
  applyMiddleware(app);
  return app;
}
