import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const list = (value) =>
  (value || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

/** Build runtime config from environment variables (overridable for tests). */
export function loadConfig(env = process.env) {
  return {
    host: env.HOST || '0.0.0.0',
    httpsPort: Number(env.HTTPS_PORT || 8443),
    httpPort: Number(env.HTTP_PORT || 8080),
    dataFile: env.DATA_FILE || path.join(ROOT, 'data', 'db.json'),
    certDir: env.CERT_DIR || path.join(ROOT, 'certs'),
    publicDir: path.join(ROOT, 'public'),
    // Extra hostnames / IPs to put in the self-signed cert (e.g. your PC's LAN IP when running in Docker).
    publicHosts: list(env.PUBLIC_HOSTS),
    // HSTS is off by default: on localhost it would force HTTPS for every other dev project too.
    enableHsts: env.ENABLE_HSTS === 'true',
    // Max horizontal distance (metres) between two players for a "connect" to count.
    connectDistance: Number(env.CONNECT_DISTANCE || 3),
    // Seconds a player has to move in UNO before they automatically draw and play passes on.
    unoTurnSeconds: Number(env.UNO_TURN_SECONDS || 60),
    rateLimit: {
      windowMs: 60_000,
      api: Number(env.RATE_LIMIT_API || 300),
      signup: Number(env.RATE_LIMIT_SIGNUP || 20),
    },
  };
}
