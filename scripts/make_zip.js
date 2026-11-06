import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';

const ROOT = process.cwd();
const DIST = path.join(ROOT, 'dist');
const ZIP = path.join(DIST, 'uas-indodax-submit.zip');

const EXCLUDE_DIRS = new Set(['node_modules', '.vercel', 'dist', '.next', 'coverage']);
const EXCLUDE_FILES = new Set(['local_store.json', '.env', 'Thumbs.db', '.DS_Store', '.tick_secret']);

function keep(src) {
  const base = path.basename(src);
  if (src === ROOT) return true;
  if (EXCLUDE_DIRS.has(base)) return false;
  if (EXCLUDE_FILES.has(base)) return false;
  // Semua file .env* kecuali contoh, dan log pemicu lokal.
  if (base.startsWith('.env') && base !== '.env.example') return false;
  if (base.endsWith('.log')) return false;
  if (path.relative(ROOT, src).split(path.sep).join('/').startsWith('logs/remote/')) return false;
  return true;
}

function walk(dir, out = []) {
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    if (!keep(full)) continue;
    const st = fs.lstatSync(full);
    if (st.isDirectory()) walk(full, out);
    else if (st.isFile()) out.push({ full, size: st.size, mtime: st.mtime });
  }
  return out;
}

// CRC-32 (IEEE) untuk header ZIP.
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function dosDateTime(d) {
  const year = Math.max(1980, d.getFullYear());
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (Math.floor(d.getSeconds() / 2) & 0x1f);
  const date = ((year - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  return { time, date };
}

// Penulis ZIP manual supaya pemisah path selalu "/" (bukan "\\"), sehingga
// ZIP bisa diekstrak di Linux/macOS dan folder .git tetap utuh.
function createZip(files, target) {
  const chunks = [];
  const central = [];
  let offset = 0;

  for (const f of files) {
    const rel = path.relative(ROOT, f.full).split(path.sep).join('/');
    const raw = fs.readFileSync(f.full);
    const data = zlib.deflateRawSync(raw, { level: 9 });
    const crc = crc32(raw);
    const { time, date } = dosDateTime(f.mtime);
    const nameBuf = Buffer.from(rel, 'utf8');

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6); // UTF-8 names
    local.writeUInt16LE(8, 8); // deflate
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);

    chunks.push(local, nameBuf, data);

    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0);
    c.writeUInt16LE(20, 4);
    c.writeUInt16LE(20, 6);
    c.writeUInt16LE(0x0800, 8);
    c.writeUInt16LE(8, 10);
    c.writeUInt16LE(time, 12);
    c.writeUInt16LE(date, 14);
    c.writeUInt32LE(crc, 16);
    c.writeUInt32LE(data.length, 20);
    c.writeUInt32LE(raw.length, 24);
    c.writeUInt16LE(nameBuf.length, 28);
    c.writeUInt16LE(0, 30);
    c.writeUInt16LE(0, 32);
    c.writeUInt16LE(0, 34);
    c.writeUInt16LE(0, 36);
    c.writeUInt32LE(((0o100644 << 16) >>> 0), 38);
    c.writeUInt32LE(offset, 42);
    central.push(Buffer.concat([c, nameBuf]));

    offset += local.length + nameBuf.length + data.length;
  }

  const centralBuf = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);

  fs.writeFileSync(target, Buffer.concat([...chunks, centralBuf, eocd]));
  return { count: files.length, bytes: offset + centralBuf.length + eocd.length };
}

function main() {
  if (!fs.existsSync(path.join(ROOT, '.git'))) {
    console.error('Folder .git tidak ada. Jalankan git init + commit freeze dulu supaya bukti freeze ikut di ZIP.');
    process.exit(1);
  }
  fs.mkdirSync(DIST, { recursive: true });
  if (fs.existsSync(ZIP)) fs.rmSync(ZIP);

  const files = walk(ROOT);
  const hasGit = files.some((f) => path.relative(ROOT, f.full).split(path.sep)[0] === '.git');
  const { count, bytes } = createZip(files, ZIP);

  console.log(`ZIP dibuat: ${ZIP}`);
  console.log(`File: ${count} · ukuran: ${(bytes / 1024 / 1024).toFixed(2)} MB · .git disertakan: ${hasGit ? 'ya' : 'TIDAK'}`);
  console.log('Tidak ikut: node_modules, .env, data/local_store.json, dist/');
}

main();
