// Regenerate the self-signed HTTPS certificate (run again if your LAN IP changes).
// Usage: npm run cert            -> includes localhost + this PC's LAN IPs
//        PUBLIC_HOSTS=my-pc.local npm run cert
import { loadConfig } from '../server/config.js';
import { ensureCerts } from '../server/lib/certs.js';

const config = loadConfig();
const { hosts } = await ensureCerts(config, { force: true });
console.log(`Wrote ${config.certDir}/cert.pem and key.pem for:\n  ${hosts.join('\n  ')}`);
