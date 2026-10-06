import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import { loadConfig } from '../server/config.js';

export function testConfig(overrides = {}) {
  return { ...loadConfig({}), ...overrides };
}

export async function tempFile(name = 'db.json') {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'webxr-meetup-'));
  return { file: path.join(dir, name), cleanup: () => fs.rm(dir, { recursive: true, force: true }) };
}
