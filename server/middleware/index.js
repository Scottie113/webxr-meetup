import path from 'node:path';
import { createRequire } from 'node:module';
import express from 'express';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import apiRoutes from '../routes/index.js';
import { notFoundHandler, errorHandler } from './errors.js';

const require = createRequire(import.meta.url);
const babylonDir = path.dirname(require.resolve('babylonjs'));
const loadersDir = path.dirname(require.resolve('babylonjs-loaders'));

// Babylon pulls XR controller models/profiles from these hosts at runtime.
const BABYLON_ASSET_HOSTS = [
  'https://assets.babylonjs.com',
  'https://controllers.babylonjs.com',
  'https://immersive-web.github.io',
];
// Some room models are loaded straight from the Models-for-Meetup-room GitHub repo.
const MODEL_HOSTS = ['https://raw.githubusercontent.com'];

/**
 * The whole middleware pipeline: security headers -> body parsing ->
 * rate-limited API routes -> static client -> 404 / error handling.
 */
export function applyMiddleware(app) {
  const { config } = app.locals;

  app.disable('x-powered-by');

  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          // Babylon's built-in "Enter VR" button injects a <style> tag; scripts stay strictly 'self'.
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", 'data:', 'blob:', ...BABYLON_ASSET_HOSTS],
          connectSrc: ["'self'", 'wss:', 'blob:', 'data:', ...BABYLON_ASSET_HOSTS, ...MODEL_HOSTS],
          workerSrc: ["'self'", 'blob:'],
          objectSrc: ["'none'"],
          frameAncestors: ["'none'"],
          upgradeInsecureRequests: [],
        },
      },
      strictTransportSecurity: config.enableHsts ? { maxAge: 15552000 } : false,
      crossOriginEmbedderPolicy: false,
    }),
  );

  // WebXR is only allowed for this origin, never for embedding sites.
  app.use((req, res, next) => {
    res.setHeader('Permissions-Policy', 'xr-spatial-tracking=(self), camera=(), microphone=(), geolocation=()');
    next();
  });

  app.use(express.json({ limit: '10kb' }));

  const apiLimiter = rateLimit({
    windowMs: config.rateLimit.windowMs,
    limit: config.rateLimit.api,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
  });
  app.use('/api', apiLimiter, (req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });
  app.use('/api', apiRoutes(config));

  // Babylon.js is served from node_modules so the game works on a LAN with no internet.
  app.use('/vendor/babylon', express.static(babylonDir, { maxAge: '7d' }));
  app.use('/vendor/babylon-loaders', express.static(loadersDir, { maxAge: '7d' }));
  app.use(express.static(config.publicDir, { extensions: ['html'] }));

  app.use(notFoundHandler);
  app.use(errorHandler);
}
