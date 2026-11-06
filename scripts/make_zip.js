import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const ROOT = process.cwd();
const DIST = path.join(ROOT, 'dist');
const ZIP = path.join(DIST, 'uas-indodax-submit.zip');
const stage = path.join(os.tmpdir(), 'uas-indodax-submit-' + Date.now());

const EXCLUDE_DIRS = new Set(['node_modules', '.vercel', 'dist', '.next', 'coverage']);
const EXCLUDE_FILES = new Set(['local_store.json', '.env', 'Thumbs.db', '.DS_Store']);

function keep(src) {
  const base = path.basename(src);
  if (src === ROOT) return true;
  if (EXCLUDE_DIRS.has(base)) return false;
  if (EXCLUDE_FILES.has(base)) return false;
  if (base.endsWith('.log')) return false;
  return true;
}

function main() {
  if (!fs.existsSync(path.join(ROOT, '.git'))) {
    console.error('Folder .git tidak ada. Jalankan git init + commit freeze dulu supaya bukti freeze ikut di ZIP.');
    process.exit(1);
  }
  fs.mkdirSync(DIST, { recursive: true });
  if (fs.existsSync(ZIP)) fs.rmSync(ZIP);
  fs.rmSync(stage, { recursive: true, force: true });

  console.log('Menyalin repo ke staging (tanpa node_modules, .env, local_store)...');
  fs.cpSync(ROOT, stage, { recursive: true, filter: keep });

  const hasGit = fs.existsSync(path.join(stage, '.git'));
  console.log('Staging siap. .git ikut:', hasGit ? 'ya' : 'TIDAK');

  const ps = [
    'Add-Type -AssemblyName System.IO.Compression.FileSystem;',
    `[System.IO.Compression.ZipFile]::CreateFromDirectory('${stage.replace(/'/g, "''")}','${ZIP.replace(/'/g, "''")}',[System.IO.Compression.CompressionLevel]::Optimal,$false);`,
  ].join(' ');

  const r = spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', ps], { encoding: 'utf8' });
  if (r.status !== 0) {
    console.error(r.stdout || '');
    console.error(r.stderr || '');
    console.error('Gagal membuat ZIP.');
    process.exit(1);
  }
  fs.rmSync(stage, { recursive: true, force: true });
  const size = fs.statSync(ZIP).size;
  console.log(`ZIP dibuat: ${ZIP}`);
  console.log(`Ukuran: ${(size / 1024 / 1024).toFixed(2)} MB · .git disertakan: ${hasGit ? 'ya' : 'tidak'}`);
}

main();
