import { getStore } from '../lib/store.js';
import { LOG_KEYS, uptimeFromCalls } from '../lib/report.js';
import { CFG } from '../lib/config.js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const store = getStore();
  try {
    const state = await store.getState();
    const calls = await store.list(LOG_KEYS.calls, { limit: 240 });
    const names = ['orders', 'signals', 'equity', 'errors', 'depth', 'spreads'];
    const counts = await Promise.all(
      names.map(async (n) => [n, typeof store.len === 'function' ? await store.len(LOG_KEYS[n]) : null]),
    );
    const now = Date.now();
    const startedAt = state?.startedAt ? Date.parse(state.startedAt) : null;
    const processed = [...new Set(calls.flatMap((c) => c.processedCandles || []))].filter(Number.isFinite);
    const uptimeStart = processed.length ? Math.min(...processed) * 1000 : startedAt;
    const uptime = uptimeStart ? uptimeFromCalls(calls, uptimeStart, now) : null;
    const day = state?.day || null;
    const equity = Number(state?.equity ?? CFG.startEquity);
    const dayStart = Number(day?.startEquity ?? CFG.startEquity);
    return res.status(200).json({
      ok: true,
      now: new Date(now).toISOString(),
      storage: store.mode,
      killSwitch: String(process.env.KILL_SWITCH || '0') === '1',
      startedAt: state?.startedAt || null,
      equity,
      cash: state?.cash ?? null,
      day: day
        ? {
            ...day,
            pnlPct: dayStart > 0 ? equity / dayStart - 1 : null,
            limit: CFG.dailyLossLimit,
          }
        : null,
      positions: Object.entries(state?.positions || {}).map(([pair, p]) => ({
        pair,
        qty: p.qty,
        entryPrice: p.entryPrice,
        stop: p.stop,
        exitAt: p.exitAt,
      })),
      pending: Object.entries(state?.pending || {}).map(([pair, p]) => ({ pair, limit: p.limit, expiresAt: p.expiresAt })),
      lastTick: state?.lastTick || null,
      counts: Object.fromEntries(counts),
      uptime,
      note: 'Status operasional. Angka performa lengkap ada di /api/dashboard.',
    });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
}
