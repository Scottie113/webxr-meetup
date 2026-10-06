import { HttpError, notFound } from '../lib/errors.js';

export function notFoundHandler(req, res, next) {
  next(notFound(`no route for ${req.method} ${req.path}`));
}

// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, next) {
  // body-parser errors (bad JSON, payload too large) carry their own status.
  const status = err instanceof HttpError ? err.status : err.status || err.statusCode || 500;
  if (status >= 500) console.error('[http]', err);
  res.status(status).json({
    error: {
      code: err.code && typeof err.code === 'string' ? err.code : status >= 500 ? 'internal' : 'bad_request',
      message: status >= 500 ? 'Internal server error' : err.message,
    },
  });
}
