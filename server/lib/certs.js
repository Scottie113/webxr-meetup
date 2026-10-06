import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import selfsigned from 'selfsigned';
import { lanAddresses } from './network.js';

/**
 * Load certs/key.pem + certs/cert.pem, generating a self-signed pair if missing.
 * Drop in your own (e.g. from mkcert) to get a certificate devices already trust.
 */
export async function ensureCerts({ certDir, publicHosts = [] }, { force = false } = {}) {
  const keyPath = path.join(certDir, 'key.pem');
  const certPath = path.join(certDir, 'cert.pem');

  if (!force) {
    try {
      return { key: await fs.readFile(keyPath), cert: await fs.readFile(certPath), generated: false };
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
    }
  }

  const hosts = [...new Set(['localhost', os.hostname(), '127.0.0.1', '::1', ...lanAddresses(), ...publicHosts])];
  const altNames = hosts.map((h) => (net.isIP(h) ? { type: 7, ip: h } : { type: 2, value: h }));
  const notAfterDate = new Date();
  notAfterDate.setFullYear(notAfterDate.getFullYear() + 1);

  const pems = await selfsigned.generate([{ name: 'commonName', value: 'WebXR Meetup (dev)' }], {
    keySize: 2048,
    algorithm: 'sha256',
    notAfterDate,
    extensions: [
      { name: 'basicConstraints', cA: false },
      { name: 'keyUsage', digitalSignature: true, keyEncipherment: true },
      { name: 'extKeyUsage', serverAuth: true },
      { name: 'subjectAltName', altNames },
    ],
  });

  await fs.mkdir(certDir, { recursive: true });
  await fs.writeFile(keyPath, pems.private, { mode: 0o600 });
  await fs.writeFile(certPath, pems.cert);
  return { key: Buffer.from(pems.private), cert: Buffer.from(pems.cert), generated: true, hosts };
}
