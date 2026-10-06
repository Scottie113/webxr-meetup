import https from 'node:https';
import http from 'node:http';
import { loadConfig } from './config.js';
import { JsonStore } from './store/jsonStore.js';
import { createApp } from './app.js';
import { attachRealtime } from './realtime/socket.js';
import { ensureCerts } from './lib/certs.js';
import { lanAddresses } from './lib/network.js';

const config = loadConfig();
const store = await JsonStore.open(config.dataFile);
const tls = await ensureCerts(config);
if (tls.generated) console.log(`[tls] generated self-signed certificate for: ${tls.hosts.join(', ')}`);

let realtime;
const app = createApp({ store, config, presence: { roomCounts: () => realtime?.roomCounts() ?? {} } });
const server = https.createServer({ key: tls.key, cert: tls.cert, minVersion: 'TLSv1.2' }, app);
realtime = attachRealtime(server, { store, config });

// Plain HTTP only redirects to HTTPS (WebXR requires a secure context).
const redirect = http.createServer((req, res) => {
  const hostname = (req.headers.host || 'localhost').replace(/:\d+$/, '');
  const safeHost = /^[\w.\-[\]:]+$/.test(hostname) ? hostname : 'localhost';
  res.writeHead(301, { Location: `https://${safeHost}:${config.httpsPort}${req.url}` });
  res.end();
});

server.listen(config.httpsPort, config.host, () => {
  console.log('\nWebXR Meetup is running:');
  console.log(`  this PC:      https://localhost:${config.httpsPort}`);
  for (const ip of lanAddresses()) console.log(`  your network: https://${ip}:${config.httpsPort}`);
  console.log('\nOn a headset/phone, open the network URL and accept the self-signed certificate warning.\n');
});
server.on('error', (err) => {
  console.error(`[https] cannot listen on port ${config.httpsPort}: ${err.message} (set HTTPS_PORT to use another)`);
  process.exit(1);
});
// The redirect is a convenience; if its port is busy, keep running without it.
redirect.on('error', (err) => {
  console.warn(`[http] redirect disabled, port ${config.httpPort} unavailable (${err.code}). Set HTTP_PORT to change it.`);
});
redirect.listen(config.httpPort, config.host);

async function shutdown(signal) {
  console.log(`\n${signal} received, shutting down...`);
  redirect.close();
  await realtime.close();
  server.close();
  await store.save();
  process.exit(0);
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
