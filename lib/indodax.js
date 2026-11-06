import { sleep, TF_MS } from './time.js';

const BASE = 'https://indodax.com';
let lastRequestAt = 0;

async function pace(minGapMs = 350) {
  const wait = minGapMs - (Date.now() - lastRequestAt);
  if (wait > 0) await sleep(wait);
  lastRequestAt = Date.now();
}

export async function fetchJson(url, { timeoutMs = 12000, retries = 3, minGapMs = 350 } = {}) {
  let lastErr;
  for (let attempt = 1; attempt <= retries; attempt++) {
    await pace(minGapMs);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        signal: ctrl.signal,
        headers: { 'user-agent': 'finn02-dryrun/1.0 (UAS; contact: student)' },
      });
      clearTimeout(timer);
      if (res.status === 429 || res.status >= 500) {
        throw new Error(`HTTP ${res.status} untuk ${url}`);
      }
      if (!res.ok) throw new Error(`HTTP ${res.status} untuk ${url}`);
      const text = await res.text();
      if (!text) throw new Error('Respons kosong untuk ' + url);
      return JSON.parse(text);
    } catch (e) {
      clearTimeout(timer);
      lastErr = e;
      if (attempt < retries) await sleep(500 * 2 ** (attempt - 1));
    }
  }
  throw lastErr || new Error('Gagal fetch ' + url);
}

export async function getServerTime() {
  const r = await fetchJson(`${BASE}/api/server_time`);
  // API mengirim milidetik (bukan detik).
  return +r.server_time;
}

export async function getPairs() {
  const r = await fetchJson(`${BASE}/api/pairs`);
  return Array.isArray(r) ? r : Object.values(r);
}

export async function getPriceIncrements() {
  const r = await fetchJson(`${BASE}/api/price_increments`);
  return r.increments || {};
}

export async function getTickerAll() {
  const r = await fetchJson(`${BASE}/api/ticker_all`);
  return r.tickers || {};
}

export async function getDepth(pairId) {
  const r = await fetchJson(`${BASE}/api/depth/${pairId}`);
  if (!r || !Array.isArray(r.buy) || !Array.isArray(r.sell)) throw new Error('Depth kosong: ' + pairId);
  return r;
}

// Satu request history_v2. tf dalam menit ('1','15','30','60','240','1D').
export async function getHistory(symbol, tf, fromSec, toSec) {
  const url = `${BASE}/tradingview/history_v2?symbol=${encodeURIComponent(symbol)}&tf=${tf}&from=${fromSec}&to=${toSec}`;
  const r = await fetchJson(url);
  if (!Array.isArray(r)) throw new Error('History bukan array: ' + symbol);
  return r
    .map((b) => ({
      Time: +b.Time,
      Open: +b.Open,
      High: +b.High,
      Low: +b.Low,
      Close: +b.Close,
      Volume: +b.Volume,
    }))
    .filter((b) => b.Time > 0)
    .sort((a, b) => a.Time - b.Time);
}

// Tarik mundur sampai fromSec. API membatasi jumlah bar per request.
// Jangan paralel; pace() sudah membatasi 3 request/detik.
export async function getHistoryPaged(symbol, tf, fromSec, toSec, { maxPages = 40 } = {}) {
  const tfMs = tf === '1D' ? 86400_000 : +tf * 60_000;
  const byTime = new Map();
  let to = toSec;
  let pages = 0;
  while (to > fromSec && pages < maxPages) {
    const arr = await getHistory(symbol, tf, fromSec, to);
    pages++;
    if (!arr.length) break;
    for (const b of arr) if (b.Time >= fromSec && b.Time <= toSec) byTime.set(b.Time, b);
    const earliest = arr[0].Time;
    if (earliest <= fromSec) break;
    const nextTo = earliest - Math.ceil(tfMs / 1000);
    if (nextTo >= to) break;
    to = nextTo;
  }
  return { bars: [...byTime.values()].sort((a, b) => a.Time - b.Time), pages };
}

// Hanya candle tertutup. Elemen terakhir history_v2 masih berjalan.
export function dropRunning(bars, serverTimeMs) {
  return bars.filter((b) => b.Time * 1000 + (b.tfMs || TF_MS) <= serverTimeMs);
}

export function validateCandles(bars, serverTimeMs, { tfMs = TF_MS, minBars = 120 } = {}) {
  if (!Array.isArray(bars) || bars.length < minBars) return { ok: false, reason: `bar kurang (${bars?.length || 0})` };
  const closed = dropRunning(bars, serverTimeMs);
  if (closed.length < minBars) return { ok: false, reason: `bar tertutup kurang (${closed.length})` };
  const last = closed[closed.length - 1];
  const age = serverTimeMs - (last.Time * 1000 + tfMs);
  if (age > 2 * tfMs) return { ok: false, reason: `candle terakhir terlalu tua (${Math.round(age / 60000)} menit)` };
  for (const b of closed.slice(-minBars)) {
    if (!(b.Open > 0 && b.High > 0 && b.Low > 0 && b.Close > 0)) return { ok: false, reason: 'harga nol/negatif' };
    if (!(b.Volume >= 0)) return { ok: false, reason: 'volume tidak valid' };
  }
  // celah: harus tepat satu tf, hanya di jendela indikator terakhir
  const fromGap = Math.max(1, closed.length - minBars);
  for (let i = fromGap; i < closed.length; i++) {
    const gap = closed[i].Time - closed[i - 1].Time;
    if (gap !== tfMs / 1000) return { ok: false, reason: `candle hilang di ${new Date(closed[i].Time * 1000).toISOString()}` };
  }
  return { ok: true, closed, last, age };
}
