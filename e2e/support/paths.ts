import path from 'node:path';

export const ROOT = path.resolve(import.meta.dirname, '../..');
export const SERVER_DIR = path.join(ROOT, 'server');
export const SERVER_ENTRY = path.join(SERVER_DIR, 'dist/server/src/index.js');
export const WEB_DIST = path.join(ROOT, 'web/dist');
export const SHOTS = path.join(ROOT, 'docs/screenshots');
