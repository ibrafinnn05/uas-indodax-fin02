import crypto from 'node:crypto';
import { runTick } from '../lib/tick.js';
import { getStore } from '../lib/store.js';

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
  try {
    const out = await runTick({ source: 'vercel' });
    if (out?.error === 'locked') {
      console.warn('tick locked', JSON.stringify({ ts: out.ts, mode: getStore()?.mode }));
    }
    return res.status(out.ok ? 200 : 207).json(out);
  } catch (e) {
    console.error('tick error:', e?.stack || String(e));
    return res.status(500).json({ ok: false, error: e.message });
  }
}
