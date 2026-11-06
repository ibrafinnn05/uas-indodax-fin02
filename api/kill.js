import crypto from 'node:crypto';
import { getStore } from '../lib/store.js';

const KEY = 'finn:kill';

function safeEqual(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

function authorized(req) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const header = req.headers?.authorization || '';
  const bearer = header.startsWith('Bearer ') ? header.slice(7) : '';
  const q = req.query?.secret || '';
  return safeEqual(bearer, secret) || safeEqual(q, secret);
}

function parseOn(req) {
  const q = String(req.query?.on ?? '').toLowerCase();
  if (['1', 'on', 'true', 'ya'].includes(q)) return true;
  if (['0', 'off', 'false', 'tidak'].includes(q)) return false;
  let body = req.body;
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body);
    } catch {
      body = null;
    }
  }
  if (body && typeof body === 'object' && 'on' in body) return !!body.on;
  return undefined;
}

// Kill switch manual tanpa deploy ulang: nilai disimpan di storage (Redis/lokal).
// Diproteksi CRON_SECRET yang sama dengan endpoint tick.
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (!['GET', 'POST'].includes(req.method)) {
    return res.status(405).json({ ok: false, error: 'method' });
  }
  if (!process.env.CRON_SECRET) {
    return res.status(500).json({ ok: false, error: 'CRON_SECRET belum diatur' });
  }
  if (!authorized(req)) {
    return res.status(401).json({ ok: false, error: 'unauthorized' });
  }
  const store = getStore();
  const on = parseOn(req);
  try {
    if (on === undefined) {
      const cur = await store.getValue?.(KEY);
      return res.status(200).json({
        ok: true,
        kill: String(cur || '0') === '1',
        hint: 'GET/POST ?on=1 untuk mengaktifkan, ?on=0 untuk mematikan',
        storage: store.mode,
      });
    }
    await store.setValue(KEY, on ? '1' : '0');
    return res.status(200).json({
      ok: true,
      kill: on,
      storage: store.mode,
      note: on
        ? 'Kill switch AKTIF: tick berikutnya tidak membuka posisi baru (exit tetap jalan).'
        : 'Kill switch nonaktif: tick berikutnya boleh membuka posisi baru.',
    });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
}
