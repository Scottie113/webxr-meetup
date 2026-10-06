import os from 'node:os';

/** Non-internal IPv4 addresses of this machine (what phones/headsets on the LAN can reach). */
export function lanAddresses() {
  return Object.values(os.networkInterfaces())
    .flat()
    .filter((iface) => iface && iface.family === 'IPv4' && !iface.internal)
    .map((iface) => iface.address);
}
