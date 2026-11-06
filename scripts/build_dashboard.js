import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { renderHtml } from '../lib/render.js';
import { recompute } from './hitung_ulang.js';

const ROOT = process.cwd();
const FILE = path.join(ROOT, 'data', 'recompute.json');

function main() {
  let payload = null;
  if (fs.existsSync(FILE)) payload = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  if (!payload?.model) {
    console.log('data/recompute.json belum ada — menjalankan hitung ulang penuh...');
    payload = { model: recompute().model };
  }
  fs.mkdirSync(path.join(ROOT, 'public'), { recursive: true });
  const html = renderHtml(payload.model);
  fs.writeFileSync(path.join(ROOT, 'public', 'index.html'), html);
  console.log('Dashboard offline ditulis:', path.join(ROOT, 'public', 'index.html'));
  console.log(`Ukuran: ${(html.length / 1024).toFixed(1)} KB · status forward: ${payload.model.forward.status}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
