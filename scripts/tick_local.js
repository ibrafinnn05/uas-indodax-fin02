import fs from 'node:fs';
import path from 'node:path';
import { runTick } from '../lib/tick.js';
import { exportLogs } from './export_logs.js';

function loadEnv(root) {
  const file = path.join(root, '.env');
  if (!fs.existsSync(file)) return;
  const txt = fs.readFileSync(file, 'utf8');
  for (const line of txt.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i < 0) continue;
    const k = t.slice(0, i).trim();
    const v = t.slice(i + 1).trim().replace(/^["']|["']$/g, '');
    if (k && process.env[k] == null) process.env[k] = v;
  }
}

const root = process.cwd();
loadEnv(root);

console.log('Tick lokal FINN 02 ·', new Date().toISOString());
console.log('Storage:', process.env.UPSTASH_REDIS_REST_URL ? 'Upstash Redis' : 'file lokal (data/local_store.json)');
console.log('Kill switch:', process.env.KILL_SWITCH || '0');

const out = await runTick({ source: 'local' });
console.log(JSON.stringify(out, null, 2));

try {
  await exportLogs(root);
} catch (e) {
  console.error('Ekspor log gagal:', e.message);
  process.exitCode = 1;
}
